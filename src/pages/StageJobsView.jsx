import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, AlertCircle, Loader2, RefreshCw, Plus, X, CheckCircle2, Circle,
    PlayCircle, ChevronRight, ChevronLeft, Layers, Printer, Scissors, Package
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { ItemVisual } from '../components/itemVisuals';
import { STAGES, treeSql, queueSql, needsStitching, FINISHED_LOCATION } from '../utils/stageJobs';
import { firstChoice } from '../utils/gristValues';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const TXN_TABLE = 'Inventory_Transactions';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
const dateToEpoch = (d) => new Date(d).getTime() / 1000;
const todayStr = () => new Date().toLocaleDateString('en-CA');
const dateText = (v) => {
    if (!v || typeof v === 'object') return '—';
    const d = new Date(num(v) * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
const toRefList = (ids) => ['L', ...ids];

const STAGE_ICON = { printing: Printer, stitching: Scissors };

// Tailwind needs whole class names, so each accent is spelled out.
const ACCENT = {
    fuchsia: { bg: 'bg-fuchsia-600', hover: 'hover:bg-fuchsia-700', text: 'text-fuchsia-700', soft: 'bg-fuchsia-50', ring: 'ring-fuchsia-200' },
    violet: { bg: 'bg-violet-600', hover: 'hover:bg-violet-700', text: 'text-violet-700', soft: 'bg-violet-50', ring: 'ring-violet-200' }
};

const sizeText = (so) => {
    if (so.so_sheet_size) return so.so_sheet_size;
    const w = so.so_bag_w, h = so.so_bag_h;
    return w && h ? `${w}" × ${h}"` : w ? `${w}" wide` : '—';
};

const StatusPill = ({ started, completed, accent }) => {
    if (completed) {
        return (
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200">
                <CheckCircle2 size={11} /> Done
            </span>
        );
    }
    if (started) {
        return (
            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ${accent.text} ${accent.soft} ring-1 ${accent.ring}`}>
                <PlayCircle size={11} /> In progress
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold text-slate-500 bg-slate-100 ring-1 ring-slate-200">
            <Circle size={11} /> Not started
        </span>
    );
};

// One floor stage: batches of jobs, one job per sub-order, each started and then
// completed with the output actually produced. `stage` selects the config in
// utils/stageJobs.
const StageJobsView = ({ stage, onBack, getHeaders, getUrl }) => {
    const cfg = STAGES[stage];
    const accent = ACCENT[cfg.accent];
    const Icon = STAGE_ICON[stage] || Layers;

    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedBatchId, setSelectedBatchId] = useState(null);
    const [busyJobId, setBusyJobId] = useState(null);
    const [completing, setCompleting] = useState(null);
    const [showCreate, setShowCreate] = useState(false);

    const runSql = async (sql, args = []) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Query failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
        }
        return ((await res.json()).records || []).map((r) => r.fields);
    };

    const write = async (table, method, records) => {
        if (records.length === 0) return [];
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`${method} ${table} failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
        }
        return (await res.json())?.records || [];
    };

    // Flatten the joined rows into batches -> jobs.
    const fetchData = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const rows = await runSql(treeSql(cfg));
            const byBatch = new Map();
            for (const r of rows) {
                const bid = num(r.batch_id);
                if (!byBatch.has(bid)) {
                    byBatch.set(bid, { id: bid, date: r.batch_date, notes: r.batch_notes, jobs: [] });
                }
                if (r.job_id == null) continue;
                byBatch.get(bid).jobs.push({
                    id: num(r.job_id),
                    itemCodeId: num(r.job_item_code),
                    itemName: r.item_name, itemType: r.item_type, itemColour: r.item_colour,
                    itemMaterial: r.item_material, itemGsm: r.item_gsm,
                    invItems: r.job_inv_items,
                    inputLocation: r.job_input_location,
                    requiredKg: num(r.job_required_kg),
                    availableKg: num(r.job_available_kg),
                    outputKg: num(r.job_output_kg),
                    outputCount: num(r.job_output_count),
                    wastageKg: num(r.job_wastage_kg),
                    started: truthy(r.job_started), startedAt: r.job_started_at,
                    completed: truthy(r.job_completed), completedAt: r.job_completed_at,
                    so: {
                        so_id: num(r.so_id), so_model: r.so_model, so_print: r.so_print,
                        so_qty: r.so_qty, so_qty_type: r.so_qty_type,
                        so_bag_w: r.so_bag_w, so_bag_h: r.so_bag_h, so_sheet_size: r.so_sheet_size,
                        so_bag_colour: r.so_bag_colour, so_bag_gsm: r.so_bag_gsm,
                        so_order_id: r.so_order_id, so_shop: r.so_shop,
                        so_factory_updated_date: r.so_factory_updated_date
                    }
                });
            }
            setBatches([...byBatch.values()]);
        } catch (err) {
            setError(err.message || String(err));
            setBatches([]);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        setSelectedBatchId(null);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [stage]);

    const startJob = async (job) => {
        setBusyJobId(job.id);
        setError(null);
        try {
            await write(cfg.jobTable, 'PATCH', [{
                id: job.id,
                fields: { [cfg.startedCol]: true, [`${cfg.startedCol}_At`]: Date.now() / 1000 }
            }]);
            await fetchData(true);
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setBusyJobId(null);
        }
    };

    // Completing a job records what came off the floor and moves the stock that
    // moved with it. Transactions are written without Incharge_Ack, so they queue
    // for the godown incharge like every other movement the app books.
    const completeJob = async (job, outputKg, outputCount) => {
        setBusyJobId(job.id);
        setError(null);
        try {
            const now = Date.now() / 1000;
            const itemIds = (() => {
                let v = job.invItems;
                if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
                return Array.isArray(v) ? v.filter((x) => x !== 'L').map(Number).filter(Number.isInteger) : [];
            })();
            const txns = [];
            // Draw down what this stage consumed, where that stock is real godown
            // stock (printing consumes from the printing area; stitching consumes
            // work in progress, which is tracked by the job, not by location).
            if (cfg.inputLocation && itemIds.length > 0 && outputKg > 0) {
                txns.push({
                    fields: {
                        Item_ID: itemIds[0], Transaction_Type: 'LESS',
                        Weight_Kg_: outputKg, Location: cfg.inputLocation, Transaction_Time: now
                    }
                });
            }
            // Credit the finished goods only once they really are finished: a
            // stitching bag is finished after stitching, everything else after print.
            const finished = stage === 'stitching' || !needsStitching(job.so.so_model);
            if (finished && itemIds.length > 0 && outputKg > 0) {
                txns.push({
                    fields: {
                        Item_ID: itemIds[0], Transaction_Type: 'ADD',
                        Weight_Kg_: outputKg, Location: FINISHED_LOCATION, Transaction_Time: now
                    }
                });
            }
            if (txns.length > 0) await write(TXN_TABLE, 'POST', txns);

            await write(cfg.jobTable, 'PATCH', [{
                id: job.id,
                fields: {
                    [cfg.completedCol]: true,
                    [`${cfg.completedCol}_At`]: now,
                    ...(job.started ? {} : { [cfg.startedCol]: true, [`${cfg.startedCol}_At`]: now }),
                    Output_Weight_Kg_: outputKg,
                    Output_Count_: outputCount
                }
            }]);
            setCompleting(null);
            await fetchData(true);
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setBusyJobId(null);
        }
    };

    // A batch is one day's worth of work: one job per chosen sub-order.
    const createBatch = async (subOrders, date) => {
        const [batch] = await write(cfg.batchTable, 'POST', [{ fields: { Date: dateToEpoch(date) } }]);
        const jobs = subOrders.map((so) => ({
            fields: {
                [cfg.batchRef]: batch.id,
                Sub_Order: num(so.so_id),
                Source_Job: num(so.source_job) || null,
                Inventory_Item_Code: num(so.source_code) || null,
                Inventory_Items: toRefList([]),
                Input_Location: cfg.inputLocation || '',
                Required_Quantity_Kg_: 0
            }
        }));
        await write(cfg.jobTable, 'POST', jobs);
        setShowCreate(false);
        await fetchData();
    };

    const selectedBatch = batches.find((b) => b.id === selectedBatchId) || null;
    const totals = (jobs) => ({
        total: jobs.length,
        done: jobs.filter((j) => j.completed).length,
        running: jobs.filter((j) => j.started && !j.completed).length
    });

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className="max-w-3xl mx-auto flex items-center gap-2">
                    <Button
                        variant="ghost"
                        onClick={() => (selectedBatch ? setSelectedBatchId(null) : onBack())}
                        className="!px-2 shrink-0"
                    >
                        <ArrowLeft size={20} />
                    </Button>
                    <div className={`w-8 h-8 ${accent.bg} rounded-lg flex items-center justify-center text-white shrink-0`}>
                        <Icon size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-bold text-slate-800 leading-tight truncate">
                            {selectedBatch ? `Batch #${selectedBatch.id}` : cfg.title}
                        </h1>
                        <p className="text-xs text-slate-500 truncate">
                            {selectedBatch ? dateText(selectedBatch.date) : cfg.subtitle}
                        </p>
                    </div>
                    {!selectedBatch && (
                        <Button
                            variant="primary"
                            onClick={() => setShowCreate(true)}
                            className={`!px-2.5 shrink-0 ${accent.bg} ${accent.hover}`}
                            icon={Plus}
                        >
                            <span className="hidden sm:inline">Create Batch</span>
                        </Button>
                    )}
                    <Button variant="secondary" onClick={() => fetchData()} disabled={loading} className="!px-2.5 shrink-0">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </header>

            {showCreate && (
                <CreateStageBatchModal
                    cfg={cfg}
                    accent={accent}
                    runSql={runSql}
                    onClose={() => setShowCreate(false)}
                    onCreate={createBatch}
                />
            )}

            {completing && (
                <CompleteJobModal
                    cfg={cfg}
                    accent={accent}
                    job={completing}
                    busy={busyJobId === completing.id}
                    onClose={() => setCompleting(null)}
                    onSubmit={(kg, count) => completeJob(completing, kg, count)}
                />
            )}

            <main className="flex-1 p-3 overflow-auto">
                <div className="max-w-3xl mx-auto">
                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Error</p>
                                <p className="text-sm break-words">{error}</p>
                            </div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                            <Loader2 size={36} className={`animate-spin mb-3 ${accent.text}`} />
                            <p>Loading {cfg.title.toLowerCase()}…</p>
                        </div>
                    ) : selectedBatch ? (
                        <div className="space-y-2">
                            {selectedBatch.jobs.length === 0 ? (
                                <Empty label="This batch has no jobs." />
                            ) : selectedBatch.jobs.map((job) => (
                                <JobCard
                                    key={job.id}
                                    job={job}
                                    cfg={cfg}
                                    accent={accent}
                                    busy={busyJobId === job.id}
                                    onStart={() => startJob(job)}
                                    onComplete={() => setCompleting(job)}
                                />
                            ))}
                        </div>
                    ) : batches.length === 0 ? (
                        <Empty label={`No ${cfg.title.toLowerCase()} yet — create a batch to get started.`} />
                    ) : (
                        <div className="space-y-2">
                            {batches.map((b) => {
                                const t = totals(b.jobs);
                                return (
                                    <Card
                                        key={b.id}
                                        className="p-3 cursor-pointer hover:border-slate-300"
                                        onClick={() => setSelectedBatchId(b.id)}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className="min-w-0 flex-1">
                                                <p className="font-semibold text-slate-800 text-sm">Batch #{b.id}</p>
                                                <p className="text-xs text-slate-500">{dateText(b.date)}</p>
                                                <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                                                    <span>{t.total} job{t.total !== 1 ? 's' : ''}</span>
                                                    {t.running > 0 && <span className={accent.text}>{t.running} in progress</span>}
                                                    <span className="text-emerald-700">{t.done} done</span>
                                                </div>
                                            </div>
                                            <ChevronRight size={18} className="text-slate-300 shrink-0" />
                                        </div>
                                        <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
                                            <div
                                                className="h-full bg-emerald-500"
                                                style={{ width: `${t.total ? (t.done / t.total) * 100 : 0}%` }}
                                            />
                                        </div>
                                    </Card>
                                );
                            })}
                        </div>
                    )}
                </div>
            </main>
        </div>
    );
};

const Empty = ({ label }) => (
    <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        <Package size={44} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm">{label}</p>
    </div>
);

const JobCard = ({ job, cfg, accent, busy, onStart, onComplete }) => (
    <Card className="p-3">
        <div className="flex items-start gap-3">
            <div className="w-10 shrink-0">
                <ItemVisual colour={job.itemColour || firstChoice(job.so.so_bag_colour)} type={job.itemType} name={job.itemName} size="sm" />
            </div>
            <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-800 text-sm leading-tight truncate">
                    {job.so.so_shop || `Sub-order #${job.so.so_id}`}
                </p>
                <p className="text-[11px] text-slate-500 truncate">
                    {[job.so.so_model, job.so.so_print, sizeText(job.so)].filter(Boolean).join(' · ')}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                    {job.so.so_order_id != null && <span>Order #{job.so.so_order_id}</span>}
                    <span>{num(job.so.so_qty)} {String(job.so.so_qty_type || '').toUpperCase() === 'PIECES' ? 'pcs' : 'kg'}</span>
                    {job.itemName && <span className="truncate">{job.itemName}</span>}
                    {job.completed && <span className="text-emerald-700 font-medium">{fmtKg(job.outputKg)} kg out</span>}
                </div>
            </div>
            <div className="shrink-0 text-right">
                <StatusPill started={job.started} completed={job.completed} accent={accent} />
            </div>
        </div>
        {!job.completed && (
            <div className="flex justify-end gap-2 mt-2">
                {!job.started && (
                    <Button variant="ghost" onClick={onStart} disabled={busy} icon={busy ? Loader2 : PlayCircle}>
                        {cfg.startLabel}
                    </Button>
                )}
                <Button
                    variant="primary"
                    className={`${accent.bg} ${accent.hover}`}
                    onClick={onComplete}
                    disabled={busy}
                    icon={CheckCircle2}
                >
                    {cfg.completeLabel}
                </Button>
            </div>
        )}
    </Card>
);

// Output actually produced, which is what moves the stock.
const CompleteJobModal = ({ cfg, accent, job, busy, onClose, onSubmit }) => {
    const [kg, setKg] = useState('');
    const [count, setCount] = useState('');
    const weight = num(kg);
    const valid = weight > 0 && !busy;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">{cfg.completeLabel}</h2>
                        <p className="text-xs text-slate-500 truncate">{job.so.so_shop || `Sub-order #${job.so.so_id}`}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>
                <div className="p-4 space-y-3">
                    <label className="block">
                        <span className="block text-[11px] text-slate-500 mb-1">{cfg.outputLabel} (kg)</span>
                        <input
                            type="number" inputMode="decimal" step="0.01" min="0"
                            value={kg} onChange={(e) => setKg(e.target.value)} autoFocus
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-slate-400"
                        />
                    </label>
                    <label className="block">
                        <span className="block text-[11px] text-slate-500 mb-1">Pieces produced (optional)</span>
                        <input
                            type="number" inputMode="numeric" step="1" min="0"
                            value={count} onChange={(e) => setCount(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-slate-400"
                        />
                    </label>
                    <p className="text-[11px] text-slate-400">
                        {cfg.inputLocation
                            ? `${fmtKg(weight)} kg will be drawn from ${cfg.inputLocation}`
                            : 'Work in progress is tracked by the job, so nothing is drawn from a godown'}
                        {(cfg.key === 'stitching' || !needsStitching(job.so.so_model))
                            ? ` and added to ${FINISHED_LOCATION}.`
                            : ', and the printed stock carries forward to stitching.'}
                    </p>
                </div>
                <div className="border-t border-slate-200 px-4 py-3 flex gap-2 justify-end">
                    <Button variant="ghost" onClick={onClose} disabled={busy}>Cancel</Button>
                    <Button
                        variant="primary" className={`${accent.bg} ${accent.hover}`}
                        onClick={() => onSubmit(weight, num(count))}
                        disabled={!valid} icon={busy ? Loader2 : CheckCircle2}
                    >
                        {cfg.completeLabel}
                    </Button>
                </div>
            </div>
        </div>
    );
};

// Everything ready for this stage, to pick from. One job is created per chosen
// sub-order, which is how the floor groups this work.
const CreateStageBatchModal = ({ cfg, accent, runSql, onClose, onCreate }) => {
    const [queue, setQueue] = useState([]);
    const [picked, setPicked] = useState([]);
    const [date, setDate] = useState(todayStr);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    useEffect(() => {
        (async () => {
            try {
                const rows = await runSql(queueSql(cfg));
                setQueue(rows);
                setPicked(rows.map((r) => num(r.so_id)));
            } catch (err) {
                setError(err.message || String(err));
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const toggle = (id) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
    const chosen = queue.filter((r) => picked.includes(num(r.so_id)));

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            await onCreate(chosen, date);
        } catch (err) {
            setError(err.message || String(err));
            setSaving(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sm:rounded-t-2xl">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">New {cfg.title.replace(' Jobs', '')} Batch</h2>
                        <p className="text-xs text-slate-500">
                            {loading ? 'Finding ready work…' : `${chosen.length} of ${queue.length} selected`}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3">
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div><p className="font-medium">Error</p><p className="text-sm break-words">{error}</p></div>
                        </div>
                    )}
                    <label className="block">
                        <span className="block text-[11px] text-slate-500 mb-1">Batch date</span>
                        <input
                            type="date" value={date} onChange={(e) => setDate(e.target.value)}
                            className="px-3 py-2 border border-slate-300 rounded-lg bg-white outline-none focus:ring-2 focus:ring-slate-400"
                        />
                    </label>

                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-40 text-slate-400">
                            <Loader2 size={30} className={`animate-spin mb-2 ${accent.text}`} />
                        </div>
                    ) : queue.length === 0 ? (
                        <Empty label={cfg.key === 'printing'
                            ? 'Nothing is waiting to be printed — complete some production jobs first.'
                            : 'Nothing is waiting to be stitched — complete the printing for stitching bags first.'} />
                    ) : (
                        <div className="space-y-1.5">
                            {queue.map((r) => {
                                const on = picked.includes(num(r.so_id));
                                return (
                                    <button
                                        key={r.so_id}
                                        onClick={() => toggle(num(r.so_id))}
                                        className={`w-full text-left px-3 py-2 rounded-xl border flex items-start gap-2 transition-colors ${on
                                            ? `bg-white ${accent.ring} ring-1 border-transparent`
                                            : 'bg-white border-slate-200 hover:border-slate-300'}`}
                                    >
                                        <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? `${accent.bg} border-transparent` : 'border-slate-300'}`}>
                                            {on && <CheckCircle2 size={12} className="text-white" />}
                                        </span>
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-sm font-medium text-slate-800 truncate">
                                                {r.so_shop || `Sub-order #${r.so_id}`}
                                            </span>
                                            <span className="block text-[11px] text-slate-500 truncate">
                                                {[r.so_model, r.so_print, sizeText(r)].filter(Boolean).join(' · ')}
                                                {r.so_order_id != null ? ` · Order #${r.so_order_id}` : ''}
                                            </span>
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-2 sm:rounded-b-2xl">
                    <Button variant="ghost" icon={ChevronLeft} onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button
                        variant="primary" className={`${accent.bg} ${accent.hover}`}
                        disabled={chosen.length === 0 || saving}
                        icon={saving ? Loader2 : Plus}
                        onClick={submit}
                    >
                        Create ({chosen.length} job{chosen.length !== 1 ? 's' : ''})
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default StageJobsView;
