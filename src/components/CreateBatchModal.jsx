import React, { useState, useEffect } from 'react';
import {
    X, Loader2, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft,
    Search, Layers, Package, CalendarDays, ClipboardCheck
} from 'lucide-react';
import Button from './Button';
import {
    BATCH_TYPES, HARD_START_DATE, OUTPUT_TYPE, PRIORITY_LABEL, buildPlan
} from '../utils/productionBatch';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const JOBS_TABLE = 'Factory_Production_Jobs';
const SUB_ORDERS_TABLE = 'Sub_Orders';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// 'YYYY-MM-DD' -> epoch seconds (UTC midnight), matching how Grist stores DATE
// columns elsewhere in the app (see FactoryView).
const dateToEpoch = (d) => new Date(d).getTime() / 1000;
const epochToDate = (v) => {
    if (!v || typeof v === 'object') return null;
    const d = new Date(num(v) * 1000);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA');
};

// Parse a Grist reference-list ("[\"L\",1,2]" / [ 'L', 1, 2 ]) into integer ids.
const parseRefList = (v) => {
    if (!v) return [];
    let a = v;
    if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x !== 'L').map(Number).filter(Number.isInteger);
};

const toRefList = (ids) => ['L', ...ids];

const attrText = (a) => [a.material, a.colour, a.gsm && `${a.gsm} GSM`, a.width && `${a.width}"`]
    .filter(Boolean).join(' · ') || '—';

const PriorityBadge = ({ priority }) => {
    const tone = priority <= 2 ? 'green' : priority === 3 ? 'blue' : priority === 4 ? 'amber' : 'slate';
    const cls = {
        green: 'text-green-700 bg-green-50 ring-green-200',
        blue: 'text-blue-700 bg-blue-50 ring-blue-200',
        amber: 'text-amber-800 bg-amber-50 ring-amber-200',
        slate: 'text-slate-600 bg-slate-100 ring-slate-200'
    }[tone];
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${cls}`}>
            P{priority} · {PRIORITY_LABEL[priority]}
        </span>
    );
};

const Step = ({ n, label, active, done }) => (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${active ? 'text-amber-700' : done ? 'text-green-600' : 'text-slate-400'}`}>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${active ? 'bg-amber-600 text-white' : done ? 'bg-green-100 text-green-700' : 'bg-slate-100'}`}>
            {done ? <CheckCircle2 size={12} /> : n}
        </span>
        <span className="hidden sm:inline">{label}</span>
    </div>
);

const CreateBatchModal = ({ onClose, onCreated, getHeaders, getUrl }) => {
    const [step, setStep] = useState('setup'); // setup | review | confirm | writing | done
    const [batchType, setBatchType] = useState('');
    const [startDate, setStartDate] = useState(HARD_START_DATE);
    const [availableDates, setAvailableDates] = useState([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [plan, setPlan] = useState(null);
    const [createdBatchId, setCreatedBatchId] = useState(null);

    const runSql = async (sql, args = []) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Query failed: ${res.statusText}${t ? ` - ${t}` : ''}`);
        }
        const data = await res.json();
        return (data.records || []).map((r) => r.fields);
    };

    const postRecords = async (table, records) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Create in ${table} failed: ${res.statusText}${t ? ` - ${t}` : ''}`);
        }
        return (await res.json()).records || [];
    };

    const patchRecords = async (table, records) => {
        if (records.length === 0) return;
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Update in ${table} failed: ${res.statusText}${t ? ` - ${t}` : ''}`);
        }
    };

    // Distinct factory-update dates (desc) for the quick-pick, from the hard floor.
    useEffect(() => {
        (async () => {
            try {
                const rows = await runSql(
                    `SELECT DISTINCT Factory_Updated_Date d FROM Sub_Orders
                     WHERE Status='UPDATED TO FACTORY' AND Factory_Updated_Date >= ?
                     ORDER BY d DESC`,
                    [dateToEpoch(HARD_START_DATE)]
                );
                setAvailableDates(rows.map((r) => epochToDate(r.d)).filter(Boolean));
            } catch {
                // Quick-pick is optional; the date input still works.
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const findSubOrders = async () => {
        setLoading(true);
        setError(null);
        try {
            // 1. Candidate sub-orders: updated to factory on/after the start date.
            //    Already-postponed (No_Stock_Identified) ones are kept on purpose —
            //    inventory may have changed since they were postponed.
            const subOrders = await runSql(
                `SELECT so.id AS id, so.Model AS Model, so.Roll_Material AS Roll_Material,
                        so.Bag_Colour AS Bag_Colour, so.Bag_GSM AS Bag_GSM,
                        so.Bag_Width AS Bag_Width, so.Bag_Height AS Bag_Height,
                        so.Sidepatty_Colour AS Sidepatty_Colour, so.Sidepatty_GSM AS Sidepatty_GSM,
                        so.Sidepatty_Width AS Sidepatty_Width, so.Handle_Colour AS Handle_Colour,
                        so.Sheet_Size AS Sheet_Size,
                        so.Quantity AS Quantity, so.Quantity_Type AS Quantity_Type,
                        so.Factory_Updated_Date AS Factory_Updated_Date,
                        so.No_Stock_Identified AS No_Stock_Identified,
                        so.Factory_Production_Jobs AS Factory_Production_Jobs,
                        c.Shop_Name AS Shop
                 FROM Sub_Orders so
                 LEFT JOIN Customers c ON c.id = so.Customer
                 WHERE so.Status = 'UPDATED TO FACTORY' AND so.Factory_Updated_Date >= ?`,
                [dateToEpoch(startDate)]
            );

            // 2. Map every existing job -> its batch type, then drop sub-orders that
            //    already have a job of the chosen type.
            const jobs = await runSql(
                `SELECT j.id AS id, b.Type AS type
                 FROM Factory_Production_Jobs j
                 LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch`
            );
            const jobType = new Map(jobs.map((j) => [num(j.id), j.type]));
            const eligible = subOrders.filter((so) => {
                const myJobs = parseRefList(so.Factory_Production_Jobs);
                return !myJobs.some((jid) => jobType.get(jid) === batchType);
            });

            // 3. Inventory item codes + available stock per physical item.
            const itemCodes = await runSql(
                `SELECT id, Type, Material, Colour, GSM, Width_Inches_, Height_Inches_
                 FROM Inventory_Item_Codes`
            );
            const invRows = await runSql(
                `SELECT s.Item_ID AS itemId, s.Item_Code AS codeId,
                        ic.Type AS type, ic.Material AS material, ic.Colour AS colour,
                        ic.GSM AS gsm, ic.Width_Inches_ AS width,
                        s.Available_Weight_Kg_ AS availWeight
                 FROM Inventory_Transactions_summary_Item_Code_Item_ID s
                 LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
                 WHERE s.Available_Weight_Kg_ > 0`
            );
            const inventory = invRows.map((r) => ({
                itemId: num(r.itemId),
                codeId: num(r.codeId),
                type: r.type, material: r.material, colour: r.colour, gsm: r.gsm, width: r.width,
                availWeight: num(r.availWeight),
                // Per-physical-item bundle counts aren't available; piece-type
                // (sidepatty/handle) allocation therefore stays conservative.
                availBundles: 0
            }));

            const built = buildPlan({ batchType, subOrders: eligible, itemCodes, inventory });
            setPlan(built);
            setStep('review');
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    const confirmCreate = async () => {
        setStep('writing');
        setError(null);
        try {
            const today = new Date().toLocaleDateString('en-CA');

            // 1. The batch.
            const [batch] = await postRecords(BATCHES_TABLE, [{
                fields: { Type: batchType, Date: dateToEpoch(today) }
            }]);
            const batchId = batch.id;
            setCreatedBatchId(batchId);

            // 2. One job per group that has at least one fulfilled sub-order.
            //    Two-way refs mean setting Factory_Production_Job_Batch + Sub_Orders
            //    auto-populates batch.Jobs and each sub-order's Factory_Production_Jobs.
            const jobGroups = plan.groups.filter((g) => g.fulfilled.length > 0);
            const jobRecords = jobGroups.map((g) => {
                const itemIds = [...new Set(g.picks.map((p) => p.itemId))];
                const assignedWeight = plan.isPieces ? 0 : g.picks.reduce((s, p) => s + p.take, 0);
                return {
                    fields: {
                        Factory_Production_Job_Batch: batchId,
                        Sub_Orders: toRefList(g.fulfilled.map((so) => so.id)),
                        Inventory_Item_Code: g.matchedCodeId || null,
                        Inventory_Items: toRefList(itemIds),
                        Available_Weight_Kg_: assignedWeight,
                        Estimated_Wastage_Weight_Kg_: 0
                    }
                };
            });
            if (jobRecords.length > 0) await postRecords(JOBS_TABLE, jobRecords);

            // 3. No_Stock_Identified flags: clear for fulfilled orders that were
            //    previously postponed; set for everything postponed this run.
            const patches = [];
            for (const g of plan.groups) {
                for (const so of g.fulfilled) {
                    if (truthy(so.No_Stock_Identified)) {
                        patches.push({ id: so.id, fields: { No_Stock_Identified: false } });
                    }
                }
                for (const so of g.postponed) {
                    patches.push({ id: so.id, fields: { No_Stock_Identified: true } });
                }
            }
            await patchRecords(SUB_ORDERS_TABLE, patches);

            setStep('done');
        } catch (err) {
            setError(err.message || String(err));
            setStep('confirm');
        }
    };

    const totalSubOrders = plan ? plan.groups.reduce((s, g) => s + g.subOrders.length, 0) : 0;
    const unit = plan?.isPieces ? '' : ' kg';

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-3xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sm:rounded-t-2xl">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">Create Production Job Batch</h2>
                        {batchType && <p className="text-xs text-slate-500 truncate">{batchType}</p>}
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                {/* Stepper */}
                <div className="bg-white px-4 py-2 border-b border-slate-100 flex items-center gap-3 justify-between">
                    <Step n={1} label="Setup" active={step === 'setup'} done={['review', 'confirm', 'writing', 'done'].includes(step)} />
                    <ChevronRight size={14} className="text-slate-300" />
                    <Step n={2} label="Review" active={step === 'review'} done={['confirm', 'writing', 'done'].includes(step)} />
                    <ChevronRight size={14} className="text-slate-300" />
                    <Step n={3} label="Allocation & Confirm" active={step === 'confirm' || step === 'writing'} done={step === 'done'} />
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div><p className="font-medium">Error</p><p className="text-sm break-words">{error}</p></div>
                        </div>
                    )}

                    {/* STEP 1 — SETUP */}
                    {step === 'setup' && (
                        <div className="space-y-5">
                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Batch Type</p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {BATCH_TYPES.map((t) => (
                                        <button
                                            key={t}
                                            onClick={() => setBatchType(t)}
                                            className={`text-left px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors ${batchType === t
                                                ? 'bg-amber-600 text-white border-amber-600'
                                                : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'}`}
                                        >
                                            {t}
                                            <span className={`block text-[11px] mt-0.5 ${batchType === t ? 'text-amber-100' : 'text-slate-400'}`}>
                                                Output: {OUTPUT_TYPE[t]}
                                            </span>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <CalendarDays size={14} /> Include sub-orders from
                                </p>
                                <input
                                    type="date"
                                    value={startDate}
                                    min={HARD_START_DATE}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                                />
                                {availableDates.length > 0 && (
                                    <div className="-mx-1 mt-2 flex gap-1.5 overflow-x-auto pb-1">
                                        {availableDates.slice(0, 12).map((d) => (
                                            <button
                                                key={d}
                                                onClick={() => setStartDate(d)}
                                                className={`px-2.5 py-1 rounded-full text-xs whitespace-nowrap border transition-colors ${startDate === d
                                                    ? 'bg-amber-100 text-amber-800 border-amber-300'
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-amber-300'}`}
                                            >
                                                {d}
                                            </button>
                                        ))}
                                    </div>
                                )}
                                <p className="text-[11px] text-slate-400 mt-1.5">
                                    Pulls UPDATED-TO-FACTORY sub-orders from this date with no {batchType || 'matching'} job yet
                                    (including previously postponed ones).
                                </p>
                            </div>

                            <Button
                                variant="primary"
                                className="w-full bg-amber-600 hover:bg-amber-700"
                                disabled={!batchType || !startDate || loading}
                                icon={loading ? Loader2 : Search}
                                onClick={findSubOrders}
                            >
                                {loading ? 'Finding sub-orders…' : 'Find sub-orders'}
                            </Button>
                        </div>
                    )}

                    {/* STEP 2 — REVIEW GROUPS */}
                    {step === 'review' && plan && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-3 text-sm">
                                <Stat label="Groups" value={plan.groups.length} />
                                <Stat label="Sub-orders" value={totalSubOrders} />
                                <Stat label="Jobs to create" value={plan.jobCount} />
                                <Stat label="Postponed" value={plan.postponedCount} tone={plan.postponedCount ? 'amber' : 'slate'} />
                            </div>

                            {plan.groups.length === 0 ? (
                                <Empty label="No qualifying sub-orders for this type and date." />
                            ) : plan.groups.map((g) => (
                                <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-3">
                                    <div className="flex items-start justify-between gap-2 mb-2">
                                        <div className="min-w-0">
                                            <p className="font-semibold text-slate-800 text-sm break-words">{attrText(g.attrs)}</p>
                                            <p className="text-[11px] text-slate-400">
                                                {g.matchedCodeId ? `Item code #${g.matchedCodeId}` : 'No matching item code'}
                                            </p>
                                        </div>
                                        <span className="text-xs font-semibold text-slate-600 shrink-0">{num(g.requiredQty)}{unit}</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {g.subOrders.map((so) => (
                                            <span key={so.id} className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] bg-slate-100 text-slate-600">
                                                <Layers size={11} /> {so.Shop || `#${so.id}`} · {num(so.Quantity)}{unit}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* STEP 3 — ALLOCATION + CONFIRM */}
                    {(step === 'confirm' || step === 'writing') && plan && (
                        <div className="space-y-3">
                            <div className="flex flex-wrap gap-3 text-sm">
                                <Stat label="Jobs" value={plan.jobCount} />
                                <Stat label={`Planned${plan.isPieces ? ' (pcs)' : ' kg'}`} value={num(plan.totalPlannedQty)} />
                                <Stat label="Postponed" value={plan.postponedCount} tone={plan.postponedCount ? 'amber' : 'slate'} />
                            </div>

                            {plan.groups.map((g) => (
                                <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-3">
                                    <div className="flex items-start justify-between gap-2 mb-1.5">
                                        <p className="font-semibold text-slate-800 text-sm break-words min-w-0">{attrText(g.attrs)}</p>
                                        <PriorityBadge priority={g.priority} />
                                    </div>
                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                        <span>Required {num(g.requiredQty)}{unit}</span>
                                        <span>Fulfilled {num(g.fulfilledQty)}{unit}</span>
                                        {g.picks.length > 0 && (
                                            <span className="flex items-center gap-1">
                                                <Package size={12} /> {[...new Set(g.picks.map((p) => p.itemId))].length} stock item(s)
                                            </span>
                                        )}
                                    </div>
                                    {g.postponed.length > 0 && (
                                        <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                                            {g.postponed.length} sub-order(s) postponed → No_Stock_Identified
                                        </p>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* DONE */}
                    {step === 'done' && (
                        <div className="text-center py-12">
                            <CheckCircle2 size={56} className="mx-auto mb-4 text-green-600" />
                            <p className="text-lg font-bold text-slate-800">Batch Created</p>
                            <p className="text-sm text-slate-500 mt-1">
                                {batchType} · {plan?.jobCount} job(s){plan?.postponedCount ? ` · ${plan.postponedCount} postponed` : ''}
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-2 sm:rounded-b-2xl">
                    {step === 'review' && (
                        <>
                            <Button variant="ghost" icon={ChevronLeft} onClick={() => { setStep('setup'); setPlan(null); }}>Back</Button>
                            <Button
                                variant="primary" className="bg-amber-600 hover:bg-amber-700"
                                icon={ChevronRight} disabled={!plan || plan.groups.length === 0}
                                onClick={() => setStep('confirm')}
                            >
                                Review allocation
                            </Button>
                        </>
                    )}
                    {step === 'confirm' && (
                        <>
                            <Button variant="ghost" icon={ChevronLeft} onClick={() => setStep('review')}>Back</Button>
                            <Button
                                variant="primary" className="bg-green-600 hover:bg-green-700"
                                icon={ClipboardCheck} disabled={!plan || plan.jobCount === 0}
                                onClick={confirmCreate}
                            >
                                Confirm &amp; Create ({plan?.jobCount} job{plan?.jobCount !== 1 ? 's' : ''})
                            </Button>
                        </>
                    )}
                    {step === 'writing' && (
                        <div className="w-full flex items-center justify-center gap-2 text-slate-500 text-sm py-1">
                            <Loader2 size={18} className="animate-spin" /> Writing batch, jobs and sub-orders…
                        </div>
                    )}
                    {step === 'done' && (
                        <Button variant="primary" className="w-full bg-amber-600 hover:bg-amber-700"
                            onClick={() => onCreated?.(createdBatchId)}>
                            Done
                        </Button>
                    )}
                    {step === 'setup' && <div className="text-[11px] text-slate-400">Nothing is written until you confirm.</div>}
                </div>
            </div>
        </div>
    );
};

const Stat = ({ label, value, tone = 'slate' }) => {
    const cls = tone === 'amber' ? 'text-amber-700' : 'text-slate-800';
    return (
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-1.5">
            <span className="text-[11px] text-slate-400 mr-2">{label}</span>
            <span className={`font-bold ${cls}`}>{value}</span>
        </div>
    );
};

const Empty = ({ label }) => (
    <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        <Search size={40} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm">{label}</p>
    </div>
);

export default CreateBatchModal;
