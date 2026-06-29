import React, { useState, useEffect } from 'react';
import {
    X, Loader2, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft,
    Search, Layers, Package, CalendarDays, ClipboardCheck, Maximize2
} from 'lucide-react';
import Button from './Button';
import {
    BATCH_TYPES, HARD_START_DATE, OUTPUT_TYPE, PRIORITY_LABEL, buildPlan,
    effectiveQty, needsPieceConversion, cannotConvertQty
} from '../utils/productionBatch';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const JOBS_TABLE = 'Factory_Production_Jobs';
const SUB_ORDERS_TABLE = 'Sub_Orders';
const ACKED_GODOWN_FILTER = `
                    s.Location IN ('ROLLS GODOWN', 'BAGS GODOWN')
                    AND s.Incharge_Ack = 1
`;
const SUMMARY_BY_ID_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
// Compact quantity: whole numbers as-is, fractional kg to 1 dp (avoids long floats
// like 28.954838709677418 crowding the mobile layout).
// kg values are always shown with 2 decimals; piece counts stay integer.
const fmtKg = (v) => num(v).toFixed(2);
const fmtQty = (v, isPieces) => isPieces ? String(num(v)) : fmtKg(v);

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

// Grist attachment fields come through as a stringified array (e.g. "[24526]").
// Return the first attachment id, or null.
const parseAttachmentId = (val) => {
    if (!val) return null;
    if (typeof val === 'number') return val;
    if (Array.isArray(val)) return val[0] ?? null;
    try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed[0] ?? null;
        if (typeof parsed === 'number') return parsed;
    } catch { /* not parseable */ }
    return null;
};

const attrText = (a) => [a.material, a.colour, a.gsm && `${a.gsm} GSM`, a.width && `${a.width}"`]
    .filter(Boolean).join(' · ') || '—';

const dateText = (v) => epochToDate(v) || '—';

const sizeText = (batchType, so) => {
    const type = String(batchType || '').trim().toUpperCase();
    if (type === 'ROLLS TO SHEETS') {
        return { label: 'Sheet', value: so.Sheet_Size || '—' };
    }
    if (type === 'ROLLS TO SIDEPATTY') {
        const width = so.Sidepatty_Width;
        return { label: 'Side patty', value: width ? width + '" wide' : '—' };
    }
    const w = so.Bag_Width;
    const h = so.Bag_Height;
    const value = w && h ? w + '" × ' + h + '"' : w ? w + '" wide' : h ? h + '" high' : '—';
    return { label: 'Bag', value };
};

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
    const [batchTypes, setBatchTypes] = useState([]); // one or more types to build at once
    const [startDate, setStartDate] = useState(HARD_START_DATE);
    const [availableDates, setAvailableDates] = useState([]);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [plans, setPlans] = useState([]); // [{ batchType, plan }] — one per chosen type
    const [createdCount, setCreatedCount] = useState(0);

    const toggleType = (t) =>
        setBatchTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);

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

    // --- Order-form attachment preview (mirrors FactoryView) ---
    const [previewImage, setPreviewImage] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    const viewOrderForm = async (attachmentValue) => {
        const attId = parseAttachmentId(attachmentValue);
        if (!attId) return;
        setLoadingPreview(true);
        setPreviewImage(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`), { headers });
            if (!res.ok) throw new Error(`Failed to download (${res.status})`);
            const ct = res.headers.get('content-type');
            if (ct && ct.includes('application/json')) throw new Error('Server returned JSON, not an image');
            const blob = await res.blob();
            if (blob.size === 0) throw new Error('Empty image');
            setPreviewImage(URL.createObjectURL(blob));
        } catch (err) {
            alert(`Error loading order form: ${err.message}`);
            setPreviewImage(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    const closePreview = () => {
        if (previewImage) URL.revokeObjectURL(previewImage);
        setPreviewImage(null);
        setLoadingPreview(false);
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
                        so.Order_Form_Date AS Order_Form_Date,
                        so.Factory_Updated_Date AS Factory_Updated_Date,
                        so.No_Stock_Identified AS No_Stock_Identified,
                        so.Factory_Production_Jobs AS Factory_Production_Jobs,
                        o.Order_ID AS Order_ID, o.Order_Form AS Order_Form,
                        c.Shop_Name AS Shop
                 FROM Sub_Orders so
                 LEFT JOIN Customers c ON c.id = so.Customer
                 LEFT JOIN Orders o ON o.id = so."Order"
                 WHERE so.Status = 'UPDATED TO FACTORY' AND so.Factory_Updated_Date >= ?`,
                [dateToEpoch(startDate)]
            );

            // 2. Map every existing job -> its batch type so we can drop sub-orders
            //    that already have a job of a given type (checked per type below).
            const jobs = await runSql(
                `SELECT j.id AS id, b.Type AS type
                 FROM Factory_Production_Jobs j
                 LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch`
            );
            const jobType = new Map(jobs.map((j) => [num(j.id), j.type]));
            const eligibleFor = (bt) => subOrders.filter((so) => {
                const myJobs = parseRefList(so.Factory_Production_Jobs);
                return !myJobs.some((jid) => jobType.get(jid) === bt);
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
                 FROM ${SUMMARY_BY_ID_TABLE} s
                 LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
                 WHERE s.Item_Code != 0
                    AND ${ACKED_GODOWN_FILTER}
                    AND s.Available_Weight_Kg_ > 0`
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

            // 4. Build a plan per chosen type, sharing one working inventory so a
            //    physical roll/sheet consumed by an earlier type isn't offered again
            //    to a later one. (A sub-order can still feed several types — e.g. a
            //    STITCHING bag needs both a sheet and a side patty — that's intended.)
            const working = inventory.map((r) => ({ ...r }));
            const workingById = new Map(working.map((r) => [r.itemId, r]));
            const builtPlans = [];
            for (const bt of batchTypes) {
                const built = buildPlan({ batchType: bt, subOrders: eligibleFor(bt), itemCodes, inventory: working });
                for (const g of built.groups) {
                    for (const p of g.picks) {
                        const row = workingById.get(p.itemId);
                        if (!row) continue;
                        if (built.isPieces) row.availBundles = num(row.availBundles) - p.take;
                        else row.availWeight = num(row.availWeight) - p.take;
                    }
                }
                builtPlans.push({ batchType: bt, plan: built });
            }
            setPlans(builtPlans);
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

            let created = 0;
            // Aggregate the No_Stock_Identified decision across all plans: a sub-order
            // is "no stock" only if it's postponed everywhere it appears and fulfilled
            // nowhere. Track fulfilled/postponed/was-flagged per sub-order id.
            const soState = new Map(); // id -> { fulfilled, postponed, wasFlagged }
            const mark = (so, key) => {
                const s = soState.get(so.id) || { fulfilled: false, postponed: false, wasFlagged: truthy(so.No_Stock_Identified) };
                s[key] = true;
                soState.set(so.id, s);
            };

            // 1. One batch per chosen type, each with a job per fulfilled group.
            for (const { batchType, plan } of plans) {
                if (plan.jobCount === 0) continue;
                const [batch] = await postRecords(BATCHES_TABLE, [{
                    fields: { Type: batchType, Date: dateToEpoch(today) }
                }]);
                created += 1;

                // Two-way refs mean setting Factory_Production_Job_Batch + Sub_Orders
                // auto-populates batch.Jobs and each sub-order's Factory_Production_Jobs.
                const jobRecords = plan.groups.filter((g) => g.fulfilled.length > 0).map((g) => {
                    const itemIds = [...new Set(g.picks.map((p) => p.itemId))];
                    const assignedWeight = plan.isPieces ? 0 : g.picks.reduce((s, p) => s + p.take, 0);
                    return {
                        fields: {
                            Factory_Production_Job_Batch: batch.id,
                            Sub_Orders: toRefList(g.fulfilled.map((so) => so.id)),
                            Inventory_Item_Code: g.matchedCodeId || null,
                            Inventory_Items: toRefList(itemIds),
                            Available_Weight_Kg_: assignedWeight,
                            // Kg met from finished godown stock; the rest is the planned
                            // output to actually produce (Planned_Output is a Grist formula
                            // = Required − this). Pieces batches track bundles, not kg.
                            Finished_Stock_Quantity_Kg_: plan.isPieces ? 0 : Math.round((g.finishedQty || 0) * 1000) / 1000
                        }
                    };
                });
                if (jobRecords.length > 0) await postRecords(JOBS_TABLE, jobRecords);

                for (const g of plan.groups) {
                    g.fulfilled.forEach((so) => mark(so, 'fulfilled'));
                    g.postponed.forEach((so) => mark(so, 'postponed'));
                }
            }
            setCreatedCount(created);

            // 2. Apply the aggregated No_Stock_Identified flags.
            const patches = [];
            for (const [id, s] of soState) {
                if (s.fulfilled) { if (s.wasFlagged) patches.push({ id, fields: { No_Stock_Identified: false } }); }
                else if (s.postponed) { patches.push({ id, fields: { No_Stock_Identified: true } }); }
            }
            await patchRecords(SUB_ORDERS_TABLE, patches);

            setStep('done');
        } catch (err) {
            setError(err.message || String(err));
            setStep('confirm');
        }
    };

    // Roll-up across all plans for the header/footer summaries.
    const totalJobs = plans.reduce((s, p) => s + p.plan.jobCount, 0);
    const hasGroups = plans.some((p) => p.plan.groups.length > 0);

    return (
        <>
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-3xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sm:rounded-t-2xl">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">Create Production Job Batch</h2>
                        {batchTypes.length > 0 && <p className="text-xs text-slate-500 truncate">{batchTypes.join(' · ')}</p>}
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
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">
                                    Batch Type{batchTypes.length > 1 ? `s · ${batchTypes.length} selected` : ''}
                                </p>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {BATCH_TYPES.map((t) => {
                                        const on = batchTypes.includes(t);
                                        return (
                                            <button
                                                key={t}
                                                onClick={() => toggleType(t)}
                                                className={`text-left px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-start gap-2 ${on
                                                    ? 'bg-amber-600 text-white border-amber-600'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'}`}
                                            >
                                                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-white/20 border-white' : 'border-slate-300'}`}>
                                                    {on && <CheckCircle2 size={12} className="text-white" />}
                                                </span>
                                                <span className="min-w-0">
                                                    {t}
                                                    <span className={`block text-[11px] mt-0.5 ${on ? 'text-amber-100' : 'text-slate-400'}`}>
                                                        Output: {OUTPUT_TYPE[t]}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1.5">Pick one or more — a batch is created per type.</p>
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
                                    Pulls UPDATED-TO-FACTORY sub-orders from this date with no matching job yet
                                    (including previously postponed ones).
                                </p>
                            </div>

                            <Button
                                variant="primary"
                                className="w-full bg-amber-600 hover:bg-amber-700"
                                disabled={batchTypes.length === 0 || !startDate || loading}
                                icon={loading ? Loader2 : Search}
                                onClick={findSubOrders}
                            >
                                {loading ? 'Finding sub-orders…' : 'Find sub-orders'}
                            </Button>
                        </div>
                    )}

                    {/* STEP 2 — REVIEW GROUPS (per chosen type) */}
                    {step === 'review' && (
                        <div className="space-y-4">
                            {plans.map(({ batchType, plan }) => (
                                <ReviewSection key={batchType} batchType={batchType} plan={plan} onViewForm={viewOrderForm} />
                            ))}
                        </div>
                    )}

                    {/* STEP 3 — ALLOCATION + CONFIRM (per chosen type) */}
                    {(step === 'confirm' || step === 'writing') && (
                        <div className="space-y-4">
                            {plans.map(({ batchType, plan }) => (
                                <ConfirmSection key={batchType} batchType={batchType} plan={plan} onViewForm={viewOrderForm} />
                            ))}
                        </div>
                    )}

                    {/* DONE */}
                    {step === 'done' && (
                        <div className="text-center py-12">
                            <CheckCircle2 size={56} className="mx-auto mb-4 text-green-600" />
                            <p className="text-lg font-bold text-slate-800">{createdCount} Batch{createdCount !== 1 ? 'es' : ''} Created</p>
                            <p className="text-sm text-slate-500 mt-1">
                                {batchTypes.join(' · ')} · {totalJobs} job(s)
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-2 sm:rounded-b-2xl">
                    {step === 'review' && (
                        <>
                            <Button variant="ghost" icon={ChevronLeft} onClick={() => { setStep('setup'); setPlans([]); }}>Back</Button>
                            <Button
                                variant="primary" className="bg-amber-600 hover:bg-amber-700"
                                icon={ChevronRight} disabled={!hasGroups}
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
                                icon={ClipboardCheck} disabled={totalJobs === 0}
                                onClick={confirmCreate}
                            >
                                Confirm &amp; Create ({totalJobs} job{totalJobs !== 1 ? 's' : ''})
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
                            onClick={() => onCreated?.()}>
                            Done
                        </Button>
                    )}
                    {step === 'setup' && <div className="text-[11px] text-slate-400">Nothing is written until you confirm.</div>}
                </div>
            </div>
        </div>
        {(loadingPreview || previewImage) && (
            <ImagePreviewModal src={previewImage} loading={loadingPreview && !previewImage} onClose={closePreview} />
        )}
        </>
    );
};

const Stat = ({ label, value, tone = 'slate' }) => {
    const cls = { amber: 'text-amber-700', red: 'text-red-700', green: 'text-emerald-700', sky: 'text-sky-700' }[tone] || 'text-slate-800';
    return (
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-1.5">
            <span className="text-[11px] text-slate-400 mr-2">{label}</span>
            <span className={`font-bold ${cls}`}>{value}</span>
        </div>
    );
};

// Roll width a job will be cut from (roll-width batch types only).
const RollBadge = ({ width }) => width ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200">
        Roll {width}″
    </span>
) : null;

// Quantity label for a sub-order. STITCHING orders quoted in pieces show both the
// piece count and the converted kg (the unit allocation actually uses); when GSM
// is missing the kg can't be sized so it shows "?".
const qtyLabel = (batchType, so, unit) => {
    const pieces = num(so.Quantity);
    if (!needsPieceConversion(batchType, so)) return `${pieces}${unit}`;
    if (cannotConvertQty(batchType, so)) return `${pieces} pcs · ? kg`;
    return `${pieces} pcs · ${effectiveQty(batchType, so).toFixed(2)} kg`;
};

const SubOrderPill = ({ so, batchType, unit, tone = 'slate', onViewForm }) => {
    const size = sizeText(batchType, so);
    const orderId = so.Order_ID === null || so.Order_ID === undefined || so.Order_ID === '' ? null : so.Order_ID;
    const hasForm = onViewForm && parseAttachmentId(so.Order_Form) != null;
    const cls = tone === 'red'
        ? 'bg-white text-red-700 ring-red-200'
        : 'bg-slate-100 text-slate-600 ring-slate-200';
    return (
        <span className={'inline-flex flex-col gap-0.5 px-2 py-1 rounded-md text-[11px] ring-1 ' + cls}>
            <span className="inline-flex items-center gap-1 font-medium">
                <Layers size={11} /> {so.Shop || ('#' + so.id)} · {qtyLabel(batchType, so, unit)}
                {hasForm && (
                    <button
                        type="button"
                        onClick={() => onViewForm(so.Order_Form)}
                        title="View order form full screen"
                        className="ml-0.5 inline-flex items-center hover:opacity-60"
                    >
                        <Maximize2 size={11} />
                    </button>
                )}
            </span>
            <span>{size.label}: <span className="font-medium">{size.value}</span></span>
            <span>{orderId != null ? `Order #${orderId} · ` : ''}Ordered: {dateText(so.Order_Form_Date)} · Factory: {dateText(so.Factory_Updated_Date)}</span>
        </span>
    );
};

// Sub-orders that couldn't be placed in any job, for a stated reason. Rendered
// during review and confirm so the operator can fix the data and re-run.
const FlaggedPanel = ({ subOrders, batchType, unit, title, detail, onViewForm }) => {
    if (!subOrders || subOrders.length === 0) return null;
    return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5 mb-1">
                <AlertCircle size={15} /> {subOrders.length} sub-order{subOrders.length !== 1 ? 's' : ''} {title}
            </p>
            <p className="text-[11px] text-red-600 mb-2">{detail}</p>
            <div className="flex flex-wrap gap-1.5">
                {subOrders.map((so) => (
                    <SubOrderPill key={so.id} so={so} batchType={batchType} unit={unit} tone="red" onViewForm={onViewForm} />
                ))}
            </div>
        </div>
    );
};

// Sub-orders whose required roll width exceeds every available roll.
const UnmatchedPanel = ({ subOrders, batchType, unit, onViewForm }) => (
    <FlaggedPanel
        subOrders={subOrders} batchType={batchType} unit={unit} onViewForm={onViewForm}
        title="with no matching roll width"
        detail="Bag/sheet too large for any available roll — fix the size or add a wider roll. These are left out of every job."
    />
);

// STITCHING orders quoted in pieces that have no Bag_GSM, so their weight in kg
// can't be computed for allocation.
const MissingGsmPanel = ({ subOrders, batchType, unit, onViewForm }) => (
    <FlaggedPanel
        subOrders={subOrders} batchType={batchType} unit={unit} onViewForm={onViewForm}
        title="missing GSM — can't convert pieces to kg"
        detail="These pieces-quoted orders have no Bag_GSM, so their weight can't be sized. Add the GSM and re-run. They are left out of every job."
    />
);

// Full-screen order-form image preview (mirrors FactoryView's modal).
const ImagePreviewModal = ({ src, loading, onClose }) => (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={onClose}>
        <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-slate-300 p-2">
            <X size={32} />
        </button>
        <div className="max-w-4xl max-h-[90vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {loading ? (
                <div className="text-white flex flex-col items-center">
                    <Loader2 size={48} className="animate-spin mb-4" />
                    <p>Loading order form…</p>
                </div>
            ) : src ? (
                <img src={src} alt="Order form" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
            ) : (
                <div className="text-white text-center">
                    <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
                    <p>Order form not available</p>
                </div>
            )}
        </div>
    </div>
);

const Empty = ({ label }) => (
    <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        <Search size={40} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm">{label}</p>
    </div>
);

// Stacked bar splitting a job/batch quantity into production output (to make) vs.
// finished stock pulled from the godown. Hidden for piece-type batches.
const QtyBar = ({ output, finished, unit = ' kg' }) => {
    const o = num(output), f = num(finished), total = o + f;
    if (total <= 0) return null;
    return (
        <div className="mt-1.5">
            <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                {o > 0 && <div style={{ width: `${(o / total) * 100}%` }} className="bg-emerald-500" />}
                {f > 0 && <div style={{ width: `${(f / total) * 100}%` }} className="bg-sky-400" />}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                <span className="text-emerald-700">● {fmtKg(o)}{unit} to produce</span>
                {f > 0 && <span className="text-sky-700">● {fmtKg(f)}{unit} from stock</span>}
            </div>
        </div>
    );
};

// Section divider naming a batch type, used when several are built at once.
const TypeHeader = ({ batchType }) => (
    <div className="flex items-baseline gap-2 border-b border-slate-200 pb-1.5 pt-1">
        <span className="text-sm font-bold text-slate-800">{batchType}</span>
        <span className="text-[11px] text-slate-400">→ {OUTPUT_TYPE[batchType]}</span>
    </div>
);

// One chosen type's grouped sub-orders (review step).
const ReviewSection = ({ batchType, plan, onViewForm }) => {
    const unit = plan.isPieces ? '' : ' kg';
    const subOrders = plan.groups.reduce((s, g) => s + g.subOrders.length, 0);
    return (
        <div className="space-y-2">
            <TypeHeader batchType={batchType} />
            <div className="flex flex-wrap gap-2 text-sm">
                <Stat label="Groups" value={plan.groups.length} />
                <Stat label="Sub-orders" value={subOrders} />
                <Stat label="Jobs" value={plan.jobCount} />
                <Stat label="Postponed" value={plan.postponedCount} tone={plan.postponedCount ? 'amber' : 'slate'} />
                {plan.unmatchedCount > 0 && <Stat label="No roll width" value={plan.unmatchedCount} tone="red" />}
                {plan.missingGsmCount > 0 && <Stat label="No GSM" value={plan.missingGsmCount} tone="red" />}
            </div>
            {plan.groups.length === 0 ? (
                <Empty label="No qualifying sub-orders for this type and date." />
            ) : plan.groups.map((g) => (
                <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="min-w-0">
                            <p className="font-semibold text-slate-800 text-sm break-words">{attrText(g.attrs)}</p>
                            {g.rollWidth ? <div className="mt-1"><RollBadge width={g.rollWidth} /></div> : null}
                            <p className="text-[11px] text-slate-400 mt-1">
                                {g.matchedCodeId ? `Item code #${g.matchedCodeId}` : 'No matching item code'}
                            </p>
                        </div>
                        <span className="text-xs font-semibold text-slate-600 shrink-0 whitespace-nowrap">{fmtQty(g.requiredQty, plan.isPieces)}{unit}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                        {g.subOrders.map((so) => (
                            <SubOrderPill key={so.id} so={so} batchType={batchType} unit={unit} onViewForm={onViewForm} />
                        ))}
                    </div>
                </div>
            ))}
            <UnmatchedPanel subOrders={plan.unmatched} batchType={batchType} unit={unit} onViewForm={onViewForm} />
            <MissingGsmPanel subOrders={plan.missingGsm} batchType={batchType} unit={unit} onViewForm={onViewForm} />
        </div>
    );
};

// One chosen type's allocation summary (confirm step).
const ConfirmSection = ({ batchType, plan, onViewForm }) => {
    const unit = plan.isPieces ? '' : ' kg';
    return (
        <div className="space-y-2">
            <TypeHeader batchType={batchType} />
            <div className="flex flex-wrap gap-2 text-sm">
                <Stat label="Jobs" value={plan.jobCount} />
                <Stat label={`Planned${plan.isPieces ? ' (pcs)' : ' kg'}`} value={fmtQty(plan.totalPlannedQty, plan.isPieces)} />
                {!plan.isPieces && plan.totalFinishedQty > 0 && <Stat label="Output kg" value={fmtKg(plan.totalOutputQty)} tone="green" />}
                {!plan.isPieces && plan.totalFinishedQty > 0 && <Stat label="From stock kg" value={fmtKg(plan.totalFinishedQty)} tone="sky" />}
                <Stat label="Postponed" value={plan.postponedCount} tone={plan.postponedCount ? 'amber' : 'slate'} />
                {plan.unmatchedCount > 0 && <Stat label="No roll width" value={plan.unmatchedCount} tone="red" />}
                {plan.missingGsmCount > 0 && <Stat label="No GSM" value={plan.missingGsmCount} tone="red" />}
            </div>
            {plan.groups.map((g) => (
                <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-3">
                    <div className="flex items-start justify-between gap-2 mb-1.5">
                        <div className="min-w-0">
                            <p className="font-semibold text-slate-800 text-sm break-words">{attrText(g.attrs)}</p>
                            {g.rollWidth ? <div className="mt-1"><RollBadge width={g.rollWidth} /></div> : null}
                        </div>
                        <PriorityBadge priority={g.priority} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                        <span>Required {fmtQty(g.requiredQty, plan.isPieces)}{unit}</span>
                        <span>Fulfilled {fmtQty(g.fulfilledQty, plan.isPieces)}{unit}</span>
                        {g.picks.length > 0 && (
                            <span className="flex items-center gap-1">
                                <Package size={12} /> {[...new Set(g.picks.map((p) => p.itemId))].length} stock item(s)
                            </span>
                        )}
                    </div>
                    {!plan.isPieces && <QtyBar output={g.outputQty} finished={g.finishedQty} />}
                    {g.postponed.length > 0 && (
                        <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                            {g.postponed.length} sub-order(s) postponed → No_Stock_Identified
                        </p>
                    )}
                </div>
            ))}
            <UnmatchedPanel subOrders={plan.unmatched} batchType={batchType} unit={unit} onViewForm={onViewForm} />
            <MissingGsmPanel subOrders={plan.missingGsm} batchType={batchType} unit={unit} onViewForm={onViewForm} />
        </div>
    );
};

export default CreateBatchModal;
