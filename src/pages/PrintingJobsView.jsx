import React, { useState, useEffect, useMemo } from 'react';
import {
    ArrowLeft, AlertCircle, Loader2, RefreshCw, Printer, Layers, ChevronRight, ChevronLeft,
    CheckCircle2, Circle, PlayCircle, X, Inbox, PackageCheck, Undo2, Tag, Store
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import WriteFailureModal from '../components/WriteFailureModal';
import { newJournal } from '../grist/writeJournal';
import { choiceText } from '../grist/gristValues';
import { MACHINE_LIST, groupQueue, machinesFor, operatorRoleFor, suggestedMachine, SUPERVISOR_ROLES } from '../domain/printing/printingMachines';
import { pickList, PLATES_INCHARGE, STATUS } from '../domain/printing/printingPlates';
import { designText } from '../domain/printing/plateTable';
import {
    queueSql, treeSql, outputsQuery, subOrdersQuery, platesQuery, plateFromRow, subOrderFromRow, batchesFromRows,
    batchStage, batchProblem, batchFields, batchPlan, jobFields, outputFields, newPlateRecords, collectionProblems,
    collectionBundle, canStart, completionProblems, completionActions, canReturnPlates, returnPlan,
    returnPlanProblems, returnBundle, BATCHES_TABLE, JOBS_TABLE, OUTPUTS_TABLE
} from '../domain/printing/printingJobs';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const todayStr = () => new Date().toLocaleDateString('en-CA');
// A Grist Date is midnight UTC of that day.
const dateToEpoch = (d) => Date.parse(`${d}T00:00:00Z`) / 1000;
const dateText = (v) => {
    if (!v || typeof v === 'object') return '—';
    const d = new Date(num(v) * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};
const sizeText = (so) => {
    if (so.sheetSize) return so.sheetSize;
    return so.bagW && so.bagH ? `${so.bagW}x${so.bagH}` : '';
};
const qtyText = (so) => (so.qty ? `${so.qty} ${String(so.qtyType || '').toUpperCase() === 'PIECES' ? 'pcs' : 'kg'}` : '');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

const STAGE_STYLE = {
    'PLATES TO COLLECT': 'text-amber-700 bg-amber-50 ring-amber-200',
    READY: 'text-sky-700 bg-sky-50 ring-sky-200',
    PRINTING: 'text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200',
    'PLATES TO RETURN': 'text-amber-700 bg-amber-50 ring-amber-200',
    CLOSED: 'text-emerald-700 bg-emerald-50 ring-emerald-200'
};

const Pill = ({ children, className }) => (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 whitespace-nowrap ${className}`}>{children}</span>
);

const JobStatus = ({ job }) => {
    if (job.completed) return <Pill className="text-emerald-700 bg-emerald-50 ring-emerald-200"><CheckCircle2 size={11} /> Done</Pill>;
    if (job.started) return <Pill className="text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200"><PlayCircle size={11} /> Printing</Pill>;
    return <Pill className="text-slate-500 bg-slate-100 ring-slate-200"><Circle size={11} /> Not started</Pill>;
};

// One order, in the terms the floor uses.
const orderText = (so) => [so.orderId, so.model, sizeText(so), choiceText(so.bagColour), qtyText(so)].filter(Boolean).join(' · ');

// A shop's orders within a job: the shop, then one line per order.
const ShopOutput = ({ shop, city, subOrders, right }) => (
    <div className="flex items-start gap-2">
        <Store size={14} className="mt-0.5 text-slate-400 shrink-0" />
        <div className="min-w-0 flex-1">
            <div className="text-sm font-medium text-slate-800 leading-snug">{shop || 'Unknown shop'}</div>
            {city && <div className="text-[11px] text-slate-400">{city}</div>}
            {(subOrders || []).map((so) => (
                <div key={so.id} className="text-xs text-slate-500 truncate">{orderText(so)}</div>
            ))}
        </div>
        {right}
    </div>
);

// Printing, in three levels (user, 5 Nov 2026): a batch per machine type, a job
// per ink set on it, and within each job an output per shop -- from the queue of
// what production has cut, through plates out, printing, and plates back. The
// rules live in domain/printing; this page reads, shows and writes.
const PrintingJobsView = ({ onBack, getHeaders, getUrl, userRoles = [] }) => {
    const [tab, setTab] = useState('batches');
    const [batches, setBatches] = useState([]);
    const [queue, setQueue] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [selectedId, setSelectedId] = useState(null);
    const [writeFailure, setWriteFailure] = useState(null);

    const machines = useMemo(() => machinesFor(userRoles), [userRoles]);
    const isSupervisor = userRoles.some((r) => SUPERVISOR_ROLES.includes(r));
    const isPlatesIncharge = isSupervisor || userRoles.includes(PLATES_INCHARGE);
    const runsMachine = (machine) => isSupervisor || userRoles.includes(operatorRoleFor(machine));

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

    // One Grist bundle: applied whole or not at all.
    const apply = async (actions) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/apply`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(actions)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Saving failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
        }
        return (await res.json())?.retValues || [];
    };

    const fetchData = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const [tree, waiting] = await Promise.all([
                runSql(treeSql()),
                isSupervisor ? runSql(queueSql()) : Promise.resolve([])
            ]);
            // The jobs' shops and the orders behind them, by id.
            const jobIds = tree.map((r) => r.job_id).filter(Boolean);
            const outQ = outputsQuery(jobIds);
            const outputs = outQ ? await runSql(outQ.sql, outQ.args) : [];
            const soIds = tree.flatMap((r) => { try { return JSON.parse(r.sub_orders || '[]'); } catch { return []; } });
            const soQ = subOrdersQuery(soIds);
            const subOrders = soQ ? (await runSql(soQ.sql, soQ.args)).map(subOrderFromRow) : [];
            setBatches(batchesFromRows(tree, outputs, subOrders));
            setQueue(waiting.map(subOrderFromRow));
        } catch (err) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { fetchData(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // A multi-step write, run through a journal so a stop part way says exactly
    // what landed.
    const runSteps = async (title, steps) => {
        const journal = newJournal();
        try {
            for (const [label, fn] of steps) await journal.run(label, fn);
            await fetchData(true);
            return true;
        } catch (err) {
            setWriteFailure({ title, error: err.message, steps: journal.steps });
            await fetchData(true);
            return false;
        }
    };

    const visible = batches.filter((b) => machines.includes(b.machine));
    const selected = batches.find((b) => b.id === selectedId) || null;

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className="max-w-3xl mx-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={selected ? () => setSelectedId(null) : onBack} className="!px-2 shrink-0">
                        {selected ? <ChevronLeft size={20} /> : <ArrowLeft size={20} />}
                    </Button>
                    <div className="w-8 h-8 bg-fuchsia-600 rounded-lg flex items-center justify-center text-white shrink-0">
                        <Printer size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-bold text-slate-800 leading-tight truncate">{selected ? selected.machine : 'Printing Jobs'}</h1>
                        <p className="text-xs text-slate-500 truncate">
                            {selected ? `${dateText(selected.date)} · batch ${selected.id}` : 'A batch per machine, a job per ink colour, an output per shop'}
                        </p>
                    </div>
                    <Button variant="secondary" onClick={() => fetchData()} disabled={loading} className="!px-2.5 shrink-0">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </header>

            <main className="max-w-3xl mx-auto p-4 space-y-4">
                {error && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm">
                        <AlertCircle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
                    </div>
                )}

                {!isSupervisor && machines.length === 0 && !isPlatesIncharge && (
                    <div className="p-3 rounded-lg bg-amber-50 text-amber-800 text-sm">
                        Your roles do not name a printing machine. Ask for the operator role of the machine you run.
                    </div>
                )}

                {loading && batches.length === 0 ? (
                    <div className="flex justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>
                ) : selected ? (
                    <BatchDetail
                        batch={selected}
                        runSql={runSql}
                        apply={apply}
                        runSteps={runSteps}
                        canHandlePlates={isPlatesIncharge}
                        canRun={runsMachine(selected.machine)}
                    />
                ) : (
                    <>
                        {isSupervisor && (
                            <div className="flex gap-2">
                                {[['batches', `Batches (${visible.length})`], ['queue', `Queue (${queue.length})`]].map(([key, label]) => (
                                    <button
                                        key={key}
                                        onClick={() => setTab(key)}
                                        className={`flex-1 py-2 rounded-lg text-sm font-semibold ${tab === key ? 'bg-fuchsia-600 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}
                                    >
                                        {label}
                                    </button>
                                ))}
                            </div>
                        )}
                        {tab === 'queue' && isSupervisor ? (
                            <QueuePanel queue={queue} apply={apply} runSteps={runSteps} onCreated={() => setTab('batches')} />
                        ) : (
                            <BatchList batches={(isSupervisor || isPlatesIncharge) ? batches : visible} onOpen={setSelectedId} />
                        )}
                    </>
                )}
            </main>

            {writeFailure && (
                <WriteFailureModal
                    title={writeFailure.title}
                    error={writeFailure.error}
                    steps={writeFailure.steps}
                    onClose={() => setWriteFailure(null)}
                />
            )}
        </div>
    );
};

const BatchList = ({ batches, onOpen }) => {
    if (batches.length === 0) {
        return (
            <Card className="p-8 text-center text-slate-500">
                <Layers className="mx-auto mb-2 text-slate-300" size={32} />
                No printing batches yet.
            </Card>
        );
    }
    return (
        <div className="space-y-2">
            {batches.map((b) => {
                const stage = batchStage(b);
                const done = b.jobs.filter((j) => j.completed).length;
                const shops = b.jobs.reduce((n, j) => n + j.outputs.length, 0);
                return (
                    <Card key={b.id} className="p-3 cursor-pointer hover:border-fuchsia-300" onClick={() => onOpen(b.id)}>
                        <div className="flex items-center gap-3">
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-slate-800 truncate">{b.machine}</div>
                                <div className="text-xs text-slate-500">
                                    {dateText(b.date)} · {plural(b.jobs.length, 'colour job')} ({done} done) · {plural(shops, 'shop')}
                                </div>
                                <div className="text-[11px] text-slate-400 truncate">{b.jobs.map((j) => j.colours).join(' · ')}</div>
                            </div>
                            <Pill className={STAGE_STYLE[stage]}>{stage}</Pill>
                            <ChevronRight size={18} className="text-slate-400" />
                        </div>
                    </Card>
                );
            })}
        </div>
    );
};

// ---- queue -----------------------------------------------------------------

// What production has cut and printing has not taken, laid out the way a batch
// will be: machine, then ink colour (a job), then shop (an output).
const QueuePanel = ({ queue, apply, runSteps, onCreated }) => {
    const { machines, held } = useMemo(() => groupQueue(queue), [queue]);
    const [open, setOpen] = useState(null);

    if (queue.length === 0) {
        return (
            <Card className="p-8 text-center text-slate-500">
                <Inbox className="mx-auto mb-2 text-slate-300" size={32} />
                Nothing waiting. Orders appear here once production completes their job.
            </Card>
        );
    }

    const plain = held.filter((h) => h.state === 'PLAIN');
    const conflicts = held.filter((h) => h.state === 'CONFLICT');

    return (
        <div className="space-y-2">
            {machines.map((m) => (
                <MachineQueue
                    key={m.machine}
                    group={m}
                    open={open === m.machine}
                    onToggle={() => setOpen(open === m.machine ? null : m.machine)}
                    apply={apply}
                    runSteps={runSteps}
                    onCreated={onCreated}
                />
            ))}
            {conflicts.length > 0 && (
                <Card className="p-3 border-rose-200 space-y-1">
                    <div className="text-sm font-semibold text-rose-700">Check these orders ({conflicts.length})</div>
                    <p className="text-xs text-slate-500">They name a printing colour but say NO PRINT. Correct the order before it is batched.</p>
                    {conflicts.map(({ so }) => <ShopOutput key={so.id} shop={so.shop} city={so.city} subOrders={[so]} />)}
                </Card>
            )}
            {plain.length > 0 && (
                <Card className="p-3 space-y-1">
                    <div className="text-sm font-semibold text-slate-700">Plain bags, no printing ({plain.length})</div>
                    <p className="text-xs text-slate-500">No printing colour, so these go straight to the packing area.</p>
                    {plain.map(({ so }) => <ShopOutput key={so.id} shop={so.shop} city={so.city} subOrders={[so]} />)}
                </Card>
            )}
        </div>
    );
};

// One machine's waiting work. Shops are picked whole -- an output is all of a
// shop's orders in that colour -- and every picked shop goes into one batch.
const MachineQueue = ({ group, open, onToggle, apply, runSteps, onCreated }) => {
    const shopKey = (job, out) => `${job.colours}|${out.customer || out.subOrders[0].id}`;
    const [picked, setPicked] = useState(() => new Set(group.jobs.flatMap((j) => j.outputs.map((o) => shopKey(j, o)))));
    const [machine, setMachine] = useState(group.machine);
    const [date, setDate] = useState(todayStr());
    const [busy, setBusy] = useState(false);

    const chosen = group.jobs.flatMap((j) => j.outputs.filter((o) => picked.has(shopKey(j, o))).flatMap((o) => o.subOrders));
    const plan = batchPlan(chosen);
    const problem = batchProblem(machine, chosen);
    const offMachine = chosen.filter((so) => suggestedMachine(so) !== machine).length;
    const shopCount = plan.reduce((n, j) => n + j.outputs.length, 0);

    const toggle = (key) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });

    const create = async () => {
        setBusy(true);
        let batchId = null;
        let jobIds = [];
        const ok = await runSteps(`Create ${machine} batch`, [
            ['Create the batch', async () => {
                [batchId] = await apply([['AddRecord', BATCHES_TABLE, null, batchFields({ date: dateToEpoch(date), machine })]]);
            }],
            [`Add ${plural(plan.length, 'colour job')}`, async () => {
                jobIds = await apply(plan.map((job) => ['AddRecord', JOBS_TABLE, null, jobFields(batchId, job)]));
            }],
            [`Add ${plural(shopCount, 'shop output')}`, () => apply(plan.flatMap((job, i) => job.outputs
                .map((out) => ['AddRecord', OUTPUTS_TABLE, null, outputFields(jobIds[i], out)])))]
        ]);
        setBusy(false);
        if (ok) onCreated();
    };

    return (
        <Card className="p-3">
            <button className="w-full flex items-center gap-3 text-left" onClick={onToggle}>
                <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800">{group.machine}</div>
                    <div className="text-xs text-slate-500 truncate">{group.jobs.map((j) => j.colours).join(' · ')}</div>
                </div>
                <span className="text-sm font-bold text-fuchsia-700">{group.subOrders.length}</span>
                <ChevronRight size={18} className={`text-slate-400 transition-transform ${open ? 'rotate-90' : ''}`} />
            </button>
            {open && (
                <div className="mt-3 space-y-3">
                    {group.jobs.map((job) => (
                        <div key={job.colours} className="rounded-lg border border-slate-200">
                            <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 text-xs font-semibold text-slate-600">
                                {job.colours} · {plural(job.outputs.length, 'shop')}
                            </div>
                            <div className="divide-y divide-slate-100">
                                {job.outputs.map((out) => {
                                    const key = shopKey(job, out);
                                    return (
                                        <label key={key} className="flex items-start gap-3 px-3 py-2">
                                            <input type="checkbox" checked={picked.has(key)} onChange={() => toggle(key)} className="w-4 h-4 mt-0.5" />
                                            <ShopOutput shop={out.shop} city={out.city} subOrders={out.subOrders} />
                                        </label>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                    <div className="grid grid-cols-2 gap-2">
                        <label className="text-xs text-slate-500">Machine
                            <select value={machine} onChange={(e) => setMachine(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800">
                                {MACHINE_LIST.map((m) => <option key={m} value={m}>{m}</option>)}
                            </select>
                        </label>
                        <label className="text-xs text-slate-500">Date
                            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-sm text-slate-800" />
                        </label>
                    </div>
                    {offMachine > 0 && (
                        <p className="text-xs text-amber-700">{plural(offMachine, 'order')} would normally run on another machine.</p>
                    )}
                    {problem && <p className="text-xs text-rose-600">{problem}</p>}
                    <Button className="w-full !bg-fuchsia-600 hover:!bg-fuchsia-700" disabled={busy || Boolean(problem)} onClick={create} icon={busy ? Loader2 : Layers}>
                        Create batch · {plural(plan.length, 'colour job')} · {plural(shopCount, 'shop')}
                    </Button>
                </div>
            )}
        </Card>
    );
};

// ---- one batch -------------------------------------------------------------

const BatchDetail = ({ batch, runSql, apply, runSteps, canHandlePlates, canRun }) => {
    const [plates, setPlates] = useState([]);
    const [platesError, setPlatesError] = useState(null);
    const [busy, setBusy] = useState(null);
    const [completing, setCompleting] = useState(null);
    const stage = batchStage(batch);

    // The batch's plates: made for its orders, confirmed for its repeat orders,
    // whatever its jobs already hold, and its shops' others to fall back on.
    const loadPlates = async () => {
        setPlatesError(null);
        const subOrders = batch.jobs.flatMap((j) => j.subOrders);
        const q = platesQuery(
            subOrders.map((so) => so.id),
            [...subOrders.flatMap((so) => so.reusedPlates), ...batch.jobs.flatMap((j) => j.plates)],
            subOrders.map((so) => so.customer)
        );
        if (!q) { setPlates([]); return; }
        try {
            setPlates((await runSql(q.sql, q.args)).map(plateFromRow));
        } catch (err) {
            setPlatesError(err.message);
        }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { loadPlates(); }, [batch]);

    const pick = useMemo(() => pickList(batch.jobs, plates), [batch, plates]);
    const blockers = collectionProblems(pick.lines);
    const plan = useMemo(() => returnPlan(batch, plates), [batch, plates]);
    const planProblems = returnPlanProblems(plan);
    const plateById = new Map(plates.map((p) => [p.id, p]));

    const collect = async () => {
        setBusy('collect');
        const newPlates = [];
        const steps = [];
        if (pick.missing.length) {
            steps.push([`Register new plates for ${plural(pick.missing.length, 'order')}`, async () => {
                const actions = pick.missing.flatMap(({ job, so }) => newPlateRecords(job, so)
                    .map((fields) => ['AddRecord', 'Printing_Plates', null, fields]));
                const owners = pick.missing.map(({ job }) => job.id);
                const ids = await apply(actions);
                ids.forEach((plateId, i) => newPlates.push({ jobId: owners[i], plateId }));
            }]);
        }
        steps.push(['Take the plates out and mark the batch collected', () => apply(collectionBundle(batch, pick.lines, newPlates))]);
        await runSteps(`Collect plates for ${batch.name}`, steps);
        setBusy(null);
    };

    const start = async (job) => {
        setBusy(`start-${job.id}`);
        await runSteps(`Start ${job.colours}`, [
            ['Start printing', () => apply([['UpdateRecord', JOBS_TABLE, job.id, { Printing_Started: true }]])]
        ]);
        setBusy(null);
    };

    const complete = async (job, form) => {
        setBusy(`complete-${job.id}`);
        const ok = await runSteps(`Complete ${job.colours}`, [
            ['Record every shop\'s output and the job\'s wastage', () => apply(completionActions(job, form))]
        ]);
        setBusy(null);
        if (ok) setCompleting(null);
    };

    const giveBack = async () => {
        setBusy('return');
        await runSteps(`Return plates for ${batch.name}`, [
            [`Put back or retire ${plural(plan.length, 'plate')} and close the batch`, () => apply(returnBundle(batch, plan, dateToEpoch(todayStr())))]
        ]);
        setBusy(null);
    };

    return (
        <div className="space-y-4">
            <Card className="p-3 flex items-center justify-between gap-2">
                <div className="text-sm text-slate-600">
                    {plural(batch.jobs.length, 'colour job')} · {plural(batch.jobs.reduce((n, j) => n + j.outputs.length, 0), 'shop')}
                </div>
                <Pill className={STAGE_STYLE[stage]}>{stage}</Pill>
            </Card>

            {platesError && <p className="text-sm text-rose-600">{platesError}</p>}

            {/* 1. plates out */}
            {!batch.platesCollected && (
                <Card className="p-3 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-800"><Tag size={16} /> Plates to collect</div>
                    {pick.lines.length === 0 && pick.missing.length === 0 && <p className="text-sm text-slate-500">No plates found.</p>}
                    <div className="divide-y divide-slate-100">
                        {pick.lines.map(({ job, so, plate }) => (
                            <div key={`${job.id}-${plate.id}`} className="py-2 flex items-center gap-3">
                                <div className="w-20 shrink-0">
                                    <div className="text-base font-bold text-rose-700 tabular-nums">{plate.rackCode || plate.rack || '?'}</div>
                                    {plate.plateNo && <div className="text-[11px] text-slate-400 tabular-nums">{plate.plateNo}</div>}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-800">{designText(plate)}</div>
                                    <div className="text-xs text-slate-500 truncate">{so.shop} · {job.colours}</div>
                                </div>
                                {plate.status !== STATUS.IN_RACK && <Pill className="text-amber-700 bg-amber-50 ring-amber-200">{plate.status}</Pill>}
                            </div>
                        ))}
                    </div>
                    {pick.missing.length > 0 && (
                        <div className="p-2 rounded-lg bg-sky-50 text-sky-800 text-xs">
                            {plural(pick.missing.length, 'order')} have no plate in the register yet — new designs, fresh from the vendor.
                            Their plates are registered as you collect them: {[...new Set(pick.missing.map(({ so }) => so.shop))].join(', ')}.
                        </div>
                    )}
                    {blockers.map((b) => <p key={b} className="text-xs text-rose-600">{b}</p>)}
                    {canHandlePlates ? (
                        <Button className="w-full" disabled={Boolean(busy) || blockers.length > 0} onClick={collect} icon={busy === 'collect' ? Loader2 : PackageCheck}>
                            Plates collected
                        </Button>
                    ) : (
                        <p className="text-xs text-slate-500">The plates incharge collects these.</p>
                    )}
                </Card>
            )}

            {/* 2. jobs: one per ink colour, each with its shops */}
            <div className="space-y-3">
                {batch.jobs.map((job) => (
                    <Card key={job.id} className="overflow-hidden">
                        <div className="px-3 py-2 bg-slate-50 border-b border-slate-200 flex items-center gap-2">
                            <div className="min-w-0 flex-1">
                                <div className="font-semibold text-slate-800">{job.colours}</div>
                                <div className="text-[11px] text-slate-500">
                                    Job {job.id} · {plural(job.outputs.length, 'shop')}
                                    {job.plates.length > 0 && ` · plates ${job.plates.map((id) => plateById.get(id)?.rackCode || plateById.get(id)?.plateNo || id).join(', ')}`}
                                </div>
                            </div>
                            <JobStatus job={job} />
                        </div>
                        <div className="divide-y divide-slate-100">
                            {job.outputs.map((out) => (
                                <div key={out.id} className="px-3 py-2">
                                    <ShopOutput
                                        shop={out.shop}
                                        city={out.city}
                                        subOrders={out.subOrders}
                                        right={job.completed ? (
                                            <div className="text-right text-xs text-slate-600 tabular-nums shrink-0">
                                                <div className="font-semibold">{out.printedCount}</div>
                                                <div>{num(out.printedKg).toFixed(2)} kg</div>
                                                {num(out.misprintKg) > 0 && <div className="text-rose-600">misprint {num(out.misprintKg).toFixed(2)}</div>}
                                            </div>
                                        ) : null}
                                    />
                                </div>
                            ))}
                        </div>
                        {job.completed && (
                            <div className="px-3 py-1.5 border-t border-slate-100 text-xs text-slate-500">
                                Wastage {num(job.wastageKg).toFixed(2)} kg
                                {job.damagedPlates.length > 0 && ` · damaged ${job.damagedPlates.map((id) => plateById.get(id)?.rackCode || id).join(', ')}`}
                            </div>
                        )}
                        {canRun && !job.completed && (
                            <div className="p-3 border-t border-slate-100">
                                {job.started ? (
                                    <Button className="w-full !bg-fuchsia-600 hover:!bg-fuchsia-700" disabled={Boolean(busy)} onClick={() => setCompleting(job)} icon={CheckCircle2}>
                                        Complete {job.colours}
                                    </Button>
                                ) : (
                                    <Button variant="outline" className="w-full" disabled={Boolean(busy) || !canStart(batch, job)} onClick={() => start(job)} icon={busy === `start-${job.id}` ? Loader2 : PlayCircle}>
                                        {batch.platesCollected ? `Start ${job.colours}` : 'Start (plates not collected yet)'}
                                    </Button>
                                )}
                            </div>
                        )}
                    </Card>
                ))}
            </div>

            {/* 3. plates back */}
            {canReturnPlates(batch) && (
                <Card className="p-3 space-y-2">
                    <div className="flex items-center gap-2 font-semibold text-slate-800"><Undo2 size={16} /> Plates back</div>
                    <div className="divide-y divide-slate-100">
                        {plan.map((p) => (
                            <div key={p.plate.id} className="py-2 flex items-center gap-2">
                                <div className="min-w-0 flex-1">
                                    <div className="text-sm font-semibold text-slate-800">{p.plate.rackCode || p.plate.plateNo}</div>
                                    <div className="text-xs text-slate-500 truncate">{designText(p.plate)} · {p.job.colours}</div>
                                </div>
                                {p.action === 'RETURNED' ? (
                                    <span className="text-xs text-slate-500">back to {p.plate.rackCode || 'its rack'}</span>
                                ) : (
                                    <Pill className="text-rose-700 bg-rose-50 ring-rose-200">{p.action}</Pill>
                                )}
                            </div>
                        ))}
                    </div>
                    {planProblems.map((m) => <p key={m} className="text-xs text-rose-600">{m}</p>)}
                    {canHandlePlates ? (
                        <Button className="w-full" disabled={Boolean(busy) || planProblems.length > 0} onClick={giveBack} icon={busy === 'return' ? Loader2 : Undo2}>
                            Plates returned
                        </Button>
                    ) : (
                        <p className="text-xs text-slate-500">The plates incharge puts these back.</p>
                    )}
                </Card>
            )}

            {completing && (
                <CompleteModal
                    job={completing}
                    plates={completing.plates.map((id) => plateById.get(id)).filter(Boolean)}
                    busy={busy === `complete-${completing.id}`}
                    onClose={() => setCompleting(null)}
                    onSubmit={(form) => complete(completing, form)}
                />
            )}
        </div>
    );
};

// Completing an ink-colour job: each shop's printed count, printed weight and
// misprint weight; the job's wastage once; and any plate worn out.
const CompleteModal = ({ job, plates, busy, onClose, onSubmit }) => {
    const [outputs, setOutputs] = useState(() => Object.fromEntries(job.outputs.map((o) => [o.id, { printedCount: '', printedKg: '', misprintKg: '' }])));
    const [wastageKg, setWastageKg] = useState('');
    const [damaged, setDamaged] = useState(() => new Set());
    const [tried, setTried] = useState(false);
    const form = { outputs, wastageKg, damaged: [...damaged] };
    const problems = completionProblems(job, form);
    const setOut = (id, key) => (e) => setOutputs((prev) => ({ ...prev, [id]: { ...prev[id], [key]: e.target.value } }));
    const toggleDamaged = (id) => setDamaged((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id); else next.add(id);
        return next;
    });
    const input = 'mt-1 w-full border border-slate-200 rounded-lg px-2 py-2 text-base text-slate-800';

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-3 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between">
                    <h2 className="font-semibold text-slate-800">Complete {job.colours}</h2>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
                </div>
                {job.outputs.map((out) => {
                    const unit = out.subOrders.every((so) => String(so.model || '').toUpperCase() === 'STITCHING') ? 'Sheets' : 'Bags';
                    return (
                        <div key={out.id} className="rounded-lg border border-slate-200 p-2.5 space-y-2">
                            <ShopOutput shop={out.shop} subOrders={out.subOrders} />
                            <div className="grid grid-cols-3 gap-2">
                                <label className="text-[11px] text-slate-500">{unit} printed
                                    <input inputMode="numeric" value={outputs[out.id].printedCount} onChange={setOut(out.id, 'printedCount')} className={input} />
                                </label>
                                <label className="text-[11px] text-slate-500">Printed kg
                                    <input inputMode="decimal" value={outputs[out.id].printedKg} onChange={setOut(out.id, 'printedKg')} className={input} />
                                </label>
                                <label className="text-[11px] text-slate-500">Misprint kg
                                    <input inputMode="decimal" value={outputs[out.id].misprintKg} onChange={setOut(out.id, 'misprintKg')} className={input} />
                                </label>
                            </div>
                        </div>
                    );
                })}
                <label className="block text-xs text-slate-500">Wastage for the whole job (kg)
                    <input inputMode="decimal" value={wastageKg} onChange={(e) => setWastageKg(e.target.value)} className={input} />
                </label>
                {plates.length > 0 && (
                    <div>
                        <div className="text-xs text-slate-500 mb-1">Tap any plate that cannot be used again</div>
                        <div className="flex flex-wrap gap-1.5">
                            {plates.map((p) => (
                                <button key={p.id} type="button" onClick={() => toggleDamaged(p.id)}
                                    className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${damaged.has(p.id) ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-slate-600 border-slate-200'}`}>
                                    {p.rackCode || p.plateNo}{damaged.has(p.id) ? ' · damaged' : ''}
                                </button>
                            ))}
                        </div>
                    </div>
                )}
                {tried && problems.map((p) => <p key={p} className="text-xs text-rose-600">{p}</p>)}
                <Button className="w-full !bg-fuchsia-600 hover:!bg-fuchsia-700" disabled={busy}
                    onClick={() => { setTried(true); if (problems.length === 0) onSubmit(form); }}
                    icon={busy ? Loader2 : CheckCircle2}>
                    Complete
                </Button>
            </div>
        </div>
    );
};

export default PrintingJobsView;
