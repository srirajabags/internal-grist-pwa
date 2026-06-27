import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Boxes, AlertCircle, Loader2, RefreshCw, Package,
    PlayCircle, CheckCircle2, Circle, Clock, ChevronRight, Layers, FileText, ArrowRight, Plus
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import CreateBatchModal from '../components/CreateBatchModal';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { itemForm, FORM_LABEL, splitJobType } from '../utils/itemForms';

// Grist document holding the factory production tables
const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const JOBS_TABLE = 'Factory_Production_Jobs';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const TXN_TABLE = 'Inventory_Transactions';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// Parse a Grist reference-list (stored as JSON like "[1,2]") into integer ids.
const parseRefList = (v) => {
    if (!v) return [];
    let a = v;
    if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x !== 'L').map(Number).filter(Number.isInteger);
};

// One joined query fetches the whole tree (open batches -> jobs -> sub-orders),
// plus inventory item details and the sub-order's customer/order. Reference-list
// columns are stored as JSON, so json_each() expands them for the joins.
// LEFT JOINs keep batches with no jobs and jobs with no sub-orders.
const TREE_SQL = `
    SELECT
        b.id AS batch_id, b.Type AS batch_type, b.Date AS batch_date,
        b.Total_Planned_Weight_Kg_ AS batch_planned_kg,
        b.Total_Estimated_Wastage_Weight_Kg_ AS batch_wastage_kg,
        b.Production_Started_At AS batch_started_at,
        b.Production_Completed_At AS batch_completed_at,
        b.Required_Inventory_Collected AS batch_inv_collected,
        b.Inventory_Collected_At AS batch_inv_collected_at,
        b.Remaining_Inventory_Returned AS batch_inv_returned,
        b.Inventory_Returned_At AS batch_inv_returned_at,

        j.id AS job_id,
        j.Inventory_Item_Code AS job_item_code, j.Inventory_Items AS job_inv_items,
        j.Production_Started AS job_started, j.Production_Started_At AS job_started_at,
        j.Production_Completed AS job_completed, j.Production_Completed_At AS job_completed_at,
        j.Planned_Weight_Kg_ AS job_planned_kg, j.Available_Weight_Kg_ AS job_available_kg,
        j.Estimated_Wastage_Weight_Kg_ AS job_wastage_kg, j.Planned_Count_Bundles_ AS job_bundles,
        j.From_Date AS job_from_date, j.To_Date AS job_to_date,

        ic.Item_Code AS item_name, ic.Type AS item_type,
        ic.Material AS item_material, ic.Colour AS item_colour,
        ic.GSM AS item_gsm, ic.Width_Inches_ AS item_width, ic.Height_Inches_ AS item_height,

        so.id AS so_id,
        so.Quantity AS so_qty, so.Quantity_Type AS so_qty_type,
        so.Order_Form_Date AS so_order_form_date,
        so.Factory_Updated_Date AS so_factory_updated_date,
        so.Model AS so_model, so.Material AS so_material,
        so.Roll_Material AS so_roll_material,
        so.Bag_Colour AS so_bag_colour, so.Bag_GSM AS so_bag_gsm,
        so.Sidepatty_Colour AS so_sidepatty_colour, so.Sidepatty_GSM AS so_sidepatty_gsm,
        so.Sheet_Size AS so_sheet_size,
        so.Bag_Width AS so_bag_w, so.Bag_Height AS so_bag_h,
        so.Sidepatty_Width AS so_sidepatty_width,
        c.Shop_Name AS so_shop, ag.Area_Group AS so_area_group
    FROM Factory_Production_Job_Batches b
    LEFT JOIN Factory_Production_Jobs j ON j.id IN (SELECT value FROM json_each(b.Jobs))
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = j.Inventory_Item_Code
    LEFT JOIN Sub_Orders so ON so.id IN (SELECT value FROM json_each(j.Sub_Orders))
    LEFT JOIN Customers c ON c.id = so.Customer
    LEFT JOIN Area_Groups ag ON ag.id = so.Area_Group
    WHERE b.Production_Completed_At IS NULL
    ORDER BY b.Date DESC, b.id DESC, j.id, so.id
`;

// Format an epoch-seconds value as a date (YYYY-MM-DD).
const formatDate = (val) => {
    if (val === null || val === undefined || val === '' || val === 0 || typeof val === 'object') return '—';
    const date = new Date(Number(val) * 1000);
    if (isNaN(date.getTime())) return '—';
    return date.toLocaleDateString('en-CA');
};

// Format an epoch-seconds value as a date + time, or null if absent.
const formatDateTime = (val) => {
    if (val === null || val === undefined || val === '' || val === 0 || typeof val === 'object') return null;
    const date = new Date(Number(val) * 1000);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
    });
};

// A short, human label for a batch built from Date + Type (no Job_Batch_ID).
const batchLabel = (batch) => `${formatDate(batch.date)} · ${batch.type || 'Batch'}`;

// Group the flat joined rows into batches -> jobs -> sub-orders.
const groupRows = (rows) => {
    const batches = new Map();

    for (const row of rows) {
        const f = row.fields;

        let batch = batches.get(f.batch_id);
        if (!batch) {
            batch = {
                id: f.batch_id,
                type: f.batch_type,
                date: f.batch_date,
                plannedKg: f.batch_planned_kg,
                wastageKg: f.batch_wastage_kg,
                startedAt: f.batch_started_at,
                completedAt: f.batch_completed_at,
                invCollected: !!f.batch_inv_collected,
                invCollectedAt: f.batch_inv_collected_at,
                invReturned: !!f.batch_inv_returned,
                invReturnedAt: f.batch_inv_returned_at,
                _jobs: new Map()
            };
            batches.set(f.batch_id, batch);
        }

        if (f.job_id != null) {
            let job = batch._jobs.get(f.job_id);
            if (!job) {
                job = {
                    id: f.job_id,
                    type: batch.type,   // inferred from the parent batch
                    itemName: f.item_name,                 // readable code (Inventory_Item_Codes)
                    invItems: parseRefList(f.job_inv_items), // physical Inventory_Items refs
                    material: f.item_material,
                    colour: f.item_colour,
                    gsm: f.item_gsm,
                    width: f.item_width,
                    height: f.item_height,
                    started: !!f.job_started,
                    startedAt: f.job_started_at,
                    completed: !!f.job_completed,
                    completedAt: f.job_completed_at,
                    plannedKg: f.job_planned_kg,
                    availableKg: f.job_available_kg,
                    wastageKg: f.job_wastage_kg,
                    bundles: f.job_bundles,
                    fromDate: f.job_from_date,
                    toDate: f.job_to_date,
                    _subs: new Map()
                };
                batch._jobs.set(f.job_id, job);
            }

            if (f.so_id != null && !job._subs.has(f.so_id)) {
                job._subs.set(f.so_id, {
                    id: f.so_id,
                    shop: f.so_shop,
                    qty: f.so_qty,
                    qtyType: f.so_qty_type,
                    areaGroup: f.so_area_group,
                    orderFormDate: f.so_order_form_date,
                    factoryUpdatedDate: f.so_factory_updated_date,
                    model: f.so_model,
                    material: f.so_material,
                    rollMaterial: f.so_roll_material,
                    bagColour: f.so_bag_colour,
                    bagGsm: f.so_bag_gsm,
                    sidepattyColour: f.so_sidepatty_colour,
                    sidepattyGsm: f.so_sidepatty_gsm,
                    sheetSize: f.so_sheet_size,
                    bagW: f.so_bag_w,
                    bagH: f.so_bag_h,
                    sidepattyWidth: f.so_sidepatty_width
                });
            }
        }
    }

    return [...batches.values()].map((b) => ({
        ...b,
        jobs: [...b._jobs.values()].map((j) => ({ ...j, subOrders: [...j._subs.values()] }))
    }));
};

const StatusBadge = ({ started, completed }) => {
    if (completed) {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700 bg-green-50 px-2 py-0.5 rounded-full">
                <CheckCircle2 size={12} /> Completed
            </span>
        );
    }
    if (started) {
        return (
            <span className="inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                <PlayCircle size={12} /> Started
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
            <Circle size={12} /> Not started
        </span>
    );
};

const ProductionJobsView = ({ onBack, getHeaders, getUrl }) => {
    const [batches, setBatches] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    const [selectedType, setSelectedType] = useState('');
    const [selectedBatchId, setSelectedBatchId] = useState(null);
    const [selectedJobId, setSelectedJobId] = useState(null);
    const [updatingJobId, setUpdatingJobId] = useState(null);
    const [updatingBatchId, setUpdatingBatchId] = useState(null);
    const [showCreate, setShowCreate] = useState(false);

    // Fetch the whole tree in a single joined query. `silent` skips the full-page
    // spinner (used after an update to refresh data without flashing the tree).
    const fetchData = async (silent = false) => {
        if (!silent) setLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);
            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: TREE_SQL, args: [] })
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`Query failed: ${response.statusText}${text ? ` - ${text}` : ''}`);
            }
            const data = await response.json();
            setBatches(groupRows(data.records || []));
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Production Jobs Error:', message);
            setError(message);
            if (!silent) setBatches([]);
        } finally {
            if (!silent) setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Patch a job's fields by row id (optimistic), then silently refresh.
    const updateJob = async (jobId, gristFields, localPatch) => {
        setUpdatingJobId(jobId);
        setBatches((prev) => prev.map((b) => ({
            ...b,
            jobs: b.jobs.map((j) => (j.id === jobId ? { ...j, ...localPatch } : j))
        })));
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/tables/${JOBS_TABLE}/records`);
            const response = await fetch(url, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id: jobId, fields: gristFields }] })
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`Update failed: ${response.statusText}${text ? ` - ${text}` : ''}`);
            }
            await fetchData(true);
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Production Jobs (update) Error:', message);
            setError(message);
            await fetchData(true);
        } finally {
            setUpdatingJobId(null);
        }
    };

    const markStarted = (job) => {
        const now = Date.now() / 1000;
        updateJob(
            job.id,
            { Production_Started: true, Production_Started_At: now },
            { started: true, startedAt: now }
        );
    };

    const markCompleted = (job) => {
        const now = Date.now() / 1000;
        const gristFields = { Production_Completed: true, Production_Completed_At: now };
        const localPatch = { completed: true, completedAt: now };
        if (!job.started) {
            gristFields.Production_Started = true;
            gristFields.Production_Started_At = job.startedAt || now;
            localPatch.started = true;
            localPatch.startedAt = job.startedAt || now;
        }
        updateJob(job.id, gristFields, localPatch);
    };

    // Mark a batch-level inventory flag and record one Inventory_Transactions row
    // per job in the batch. Optimistic flag update, then silent refresh.
    const runInventoryAction = async (batch, cfg) => {
        setUpdatingBatchId(batch.id);
        const now = Date.now() / 1000;
        setBatches((prev) => prev.map((b) => (
            b.id === batch.id ? { ...b, [cfg.localDone]: true, [cfg.localAt]: now } : b
        )));
        try {
            const headers = await getHeaders();

            // 1. One transaction per job in the batch.
            // Weight_Change_Kg_ / Count_Change_Bundle_ are formula columns (sign
            // derived from Transaction_Type), so we write the magnitude to
            // Weight_Kg_. Item_Code is also a formula now (derived from Item_ID),
            // so we only set Item_ID (Ref:Inventory_Items) + Production_Job.
            const txnRecords = batch.jobs.map((j) => ({
                fields: {
                    Item_ID: j.invItems && j.invItems.length === 1 ? j.invItems[0] : null,
                    Production_Job: j.id,             // Reference to Factory_Production_Jobs
                    Transaction_Type: cfg.type,
                    Weight_Kg_: cfg.weightFn(j),
                    Transaction_Time: now
                }
            }));
            if (txnRecords.length > 0) {
                const txnUrl = getUrl(`/api/docs/${DOC_ID}/tables/${TXN_TABLE}/records`);
                const txnResp = await fetch(txnUrl, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: txnRecords })
                });
                if (!txnResp.ok) {
                    const text = await txnResp.text().catch(() => '');
                    throw new Error(`Failed to record inventory transactions: ${txnResp.statusText}${text ? ` - ${text}` : ''}`);
                }
            }

            // 2. Mark the batch flag + timestamp.
            const batchUrl = getUrl(`/api/docs/${DOC_ID}/tables/${BATCHES_TABLE}/records`);
            const batchResp = await fetch(batchUrl, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id: batch.id, fields: { [cfg.boolField]: true, [cfg.atField]: now } }] })
            });
            if (!batchResp.ok) {
                const text = await batchResp.text().catch(() => '');
                throw new Error(`Update failed: ${batchResp.statusText}${text ? ` - ${text}` : ''}`);
            }

            await fetchData(true);
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Production Jobs (inventory action) Error:', message);
            setError(message);
            await fetchData(true);
        } finally {
            setUpdatingBatchId(null);
        }
    };

    const markInventoryCollected = (batch) => runInventoryAction(batch, {
        boolField: 'Required_Inventory_Collected',
        atField: 'Inventory_Collected_At',
        localDone: 'invCollected',
        localAt: 'invCollectedAt',
        type: 'LESS',
        weightFn: (j) => num(j.availableKg)
    });

    const markInventoryReturned = (batch) => runInventoryAction(batch, {
        boolField: 'Remaining_Inventory_Returned',
        atField: 'Inventory_Returned_At',
        localDone: 'invReturned',
        localAt: 'invReturnedAt',
        type: 'ADD',
        weightFn: (j) => num(j.availableKg) - num(j.plannedKg)
    });

    // --- Derived navigation state ---
    const types = [...new Set(batches.map((b) => b.type).filter(Boolean))].sort();
    const filteredBatches = selectedType ? batches.filter((b) => b.type === selectedType) : batches;
    const selectedBatch = batches.find((b) => b.id === selectedBatchId);
    const selectedJob = selectedBatch?.jobs.find((j) => j.id === selectedJobId);
    const level = selectedJob ? 'job' : selectedBatch ? 'jobs' : 'batches';

    const handleBack = () => {
        if (level === 'job') setSelectedJobId(null);
        else if (level === 'jobs') setSelectedBatchId(null);
        else onBack();
    };

    const headerTitle =
        level === 'job' ? `${selectedJob?.type || 'Job'} #${selectedJobId}`
            : level === 'jobs' ? batchLabel(selectedBatch)
                : 'Production Jobs';

    const headerSubtitle =
        level === 'job' ? batchLabel(selectedBatch)
            : level === 'jobs' ? `${selectedBatch.jobs.length} job${selectedBatch.jobs.length !== 1 ? 's' : ''}`
                : 'Open batches';

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className="max-w-3xl mx-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={handleBack} className="!px-2 shrink-0">
                        <ArrowLeft size={20} />
                    </Button>
                    <div className="w-8 h-8 bg-amber-600 rounded-lg flex items-center justify-center text-white shrink-0">
                        <Boxes size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-bold text-slate-800 leading-tight truncate">{headerTitle}</h1>
                        {headerSubtitle && <p className="text-xs text-slate-500 truncate">{headerSubtitle}</p>}
                    </div>
                    {level === 'batches' && (
                        <Button variant="primary" onClick={() => setShowCreate(true)} className="!px-2.5 shrink-0 bg-amber-600 hover:bg-amber-700" icon={Plus}>
                            <span className="hidden sm:inline">Create Batch</span>
                        </Button>
                    )}
                    <Button variant="secondary" onClick={() => fetchData()} disabled={loading} className="!px-2.5 shrink-0">
                        <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </header>

            {showCreate && (
                <CreateBatchModal
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                    onClose={() => setShowCreate(false)}
                    onCreated={() => { setShowCreate(false); fetchData(); }}
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
                        <Loading label="Loading production jobs..." />
                    ) : batches.length === 0 ? (
                        <Empty icon={Boxes} title="No Open Batches" subtitle="All production job batches are completed." />
                    ) : (
                        <>
                            {/* ---------- LEVEL 1: BATCHES ---------- */}
                            {level === 'batches' && (
                                <>
                                    {/* Job type filter */}
                                    <div className="-mx-3 px-3 mb-3 overflow-x-auto">
                                        <div className="flex gap-2 w-max">
                                            <TypeChip label="All Types" active={selectedType === ''} onClick={() => setSelectedType('')} />
                                            {types.map((t) => (
                                                <TypeChip key={t} label={t} active={selectedType === t} onClick={() => setSelectedType(t)} />
                                            ))}
                                        </div>
                                    </div>

                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1">
                                        {filteredBatches.length} batch{filteredBatches.length !== 1 ? 'es' : ''}
                                    </p>

                                    {filteredBatches.length === 0 ? (
                                        <Empty icon={Boxes} title="No batches of this type" subtitle="Try a different job type." />
                                    ) : (
                                        <div className="space-y-2.5">
                                            {filteredBatches.map((batch) => (
                                                <button
                                                    key={batch.id}
                                                    onClick={() => setSelectedBatchId(batch.id)}
                                                    className="w-full text-left p-4 rounded-xl border bg-white border-slate-200 hover:border-amber-300 active:bg-amber-50 transition-all"
                                                >
                                                    <div className="mb-2.5 pb-2.5 border-b border-slate-100">
                                                        <JobFlow job={{ type: batch.type, colour: batch.jobs[0]?.colour }} size="sm" />
                                                    </div>
                                                    <div className="flex items-start justify-between gap-2">
                                                        <div className="min-w-0">
                                                            <p className="font-semibold text-slate-800 break-words">{batch.type || 'Batch'}</p>
                                                            <span className="inline-flex items-center gap-1 mt-1 px-2 py-0.5 rounded-md text-xs font-semibold text-amber-800 bg-amber-100 ring-1 ring-amber-200">
                                                                <Clock size={12} /> {formatDate(batch.date)}
                                                            </span>
                                                        </div>
                                                        <ChevronRight size={20} className="shrink-0 mt-0.5 text-slate-300" />
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2.5 text-xs text-slate-500">
                                                        <span className="flex items-center gap-1"><Package size={13} /> {batch.jobs.length} job{batch.jobs.length !== 1 ? 's' : ''}</span>
                                                        <span>{batch.plannedKg ?? 0} kg planned</span>
                                                    </div>
                                                    {batch.startedAt && (
                                                        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                                                            <PlayCircle size={12} /> In Progress
                                                        </div>
                                                    )}
                                                </button>
                                            ))}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ---------- LEVEL 2: JOBS ---------- */}
                            {level === 'jobs' && (
                                <>
                                    <BatchInventory
                                        batch={selectedBatch}
                                        updating={updatingBatchId === selectedBatch.id}
                                        onCollect={() => markInventoryCollected(selectedBatch)}
                                        onReturn={() => markInventoryReturned(selectedBatch)}
                                    />

                                    {selectedBatch.jobs.length === 0 ? (
                                        <Empty icon={Package} title="No jobs in this batch" />
                                    ) : (
                                        <div className="space-y-2.5">
                                            {selectedBatch.jobs.map((job) => {
                                            const isUpdating = updatingJobId === job.id;
                                            return (
                                                <Card key={job.id} className="p-4">
                                                    <button onClick={() => setSelectedJobId(job.id)} className="w-full text-left active:opacity-70 transition-opacity">
                                                        <div className="mb-2 pb-2 border-b border-slate-100">
                                                            <JobFlow job={job} size="sm" />
                                                        </div>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <h3 className="font-bold text-slate-800">{job.type || 'Job'} #{job.id}</h3>
                                                                    <StatusBadge started={job.started} completed={job.completed} />
                                                                </div>
                                                                {(job.material || job.colour || job.gsm || job.width) && (
                                                                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                                                                        {job.material && <Chip>{job.material}</Chip>}
                                                                        {job.colour && <Chip>{job.colour}</Chip>}
                                                                        {job.gsm && <Chip>{job.gsm} GSM</Chip>}
                                                                        {job.width && <Chip>{job.width}{job.height ? ` × ${job.height}` : '"'}</Chip>}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <ChevronRight size={20} className="shrink-0 mt-0.5 text-slate-300" />
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-2 text-xs text-slate-500">
                                                            <span className="flex items-center gap-1"><Layers size={13} /> {job.subOrders.length} sub-order{job.subOrders.length !== 1 ? 's' : ''}</span>
                                                            <span>{job.plannedKg ?? 0} kg planned</span>
                                                            <span>{job.availableKg ?? 0} kg available</span>
                                                        </div>
                                                    </button>

                                                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                                                        {!job.started && (
                                                            <Button variant="primary" className="flex-1 text-sm bg-blue-600 hover:bg-blue-700"
                                                                onClick={() => markStarted(job)} disabled={isUpdating} icon={isUpdating ? Loader2 : PlayCircle}>
                                                                Start
                                                            </Button>
                                                        )}
                                                        {job.started && !job.completed && (
                                                            <Button variant="secondary" className="flex-1 text-sm"
                                                                onClick={() => setSelectedJobId(job.id)} disabled={isUpdating} icon={ChevronRight}>
                                                                Review &amp; Complete
                                                            </Button>
                                                        )}
                                                        {job.completed && (
                                                            <div className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-green-700 py-1">
                                                                <CheckCircle2 size={18} /> Completed
                                                            </div>
                                                        )}
                                                    </div>
                                                </Card>
                                            );
                                        })}
                                        </div>
                                    )}
                                </>
                            )}

                            {/* ---------- LEVEL 3: JOB DETAIL + SUB-ORDERS ---------- */}
                            {level === 'job' && selectedJob && (
                                <JobDetail
                                    key={selectedJob.id}
                                    job={selectedJob}
                                    updating={updatingJobId === selectedJob.id}
                                    onStart={() => markStarted(selectedJob)}
                                    onComplete={() => markCompleted(selectedJob)}
                                />
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
};

// --- Small presentational helpers ---

const TypeChip = ({ label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${active
            ? 'bg-amber-600 text-white border-amber-600'
            : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
            }`}
    >
        {label}
    </button>
);

const Loading = ({ label }) => (
    <div className="flex flex-col items-center justify-center h-64 text-slate-400">
        <Loader2 size={36} className="animate-spin mb-3 text-amber-600" />
        <p>{label}</p>
    </div>
);

const Empty = ({ icon, title, subtitle }) => {
    const Icon = icon;
    return (
        <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
            <Icon size={44} className="mx-auto mb-3 text-slate-300" />
            <p className="text-base font-medium mb-1">{title}</p>
            {subtitle && <p className="text-sm">{subtitle}</p>}
        </div>
    );
};

// Grist /sql can return non-scalar (marshalled) values as { type, data } objects,
// which React can't render. Coerce anything non-primitive to a dash.
const safeValue = (v) =>
    (v === null || v === undefined || v === '' || typeof v === 'object') ? '—' : v;

const DetailRow = ({ label, value }) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
        <span className="text-slate-500 text-sm">{label}</span>
        <span className="font-medium text-slate-800 text-sm text-right break-words">{safeValue(value)}</span>
    </div>
);

const Chip = ({ children }) => (
    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">{children}</span>
);

const Field = ({ label, value }) => (
    <div className="min-w-0">
        <p className="text-[11px] text-slate-400 truncate">{label}</p>
        <p className="text-sm font-medium text-slate-700 break-words">{safeValue(value)}</p>
    </div>
);

// Batch-level inventory actions (marked by the production team).
const BatchInventory = ({ batch, updating, onCollect, onReturn }) => {
    const collectedAt = formatDateTime(batch.invCollectedAt);
    const returnedAt = formatDateTime(batch.invReturnedAt);

    return (
        <Card className="p-4 mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Package size={14} /> Batch Inventory
            </h2>

            <div className="space-y-3">
                <InventoryAction
                    label="Required Inventory Collected"
                    done={batch.invCollected}
                    at={collectedAt}
                    actionLabel="Mark Collected"
                    doneLabel="Collected"
                    updating={updating}
                    onClick={onCollect}
                />
                <InventoryAction
                    label="Remaining Inventory Returned"
                    done={batch.invReturned}
                    at={returnedAt}
                    actionLabel="Mark Returned"
                    doneLabel="Returned"
                    updating={updating}
                    onClick={onReturn}
                />
            </div>
        </Card>
    );
};

const InventoryAction = ({ label, done, at, actionLabel, doneLabel, updating, onClick }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">{label}</p>
            {done && at && (
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5"><Clock size={11} /> {at}</p>
            )}
        </div>
        {done ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-green-700 shrink-0">
                <CheckCircle2 size={18} /> {doneLabel}
            </span>
        ) : (
            <Button variant="secondary" className="text-sm shrink-0" onClick={onClick} disabled={updating}
                icon={updating ? Loader2 : Circle}>
                {actionLabel}
            </Button>
        )}
    </div>
);

// Raw material -> output illustration derived from the job Type (e.g. "ROLLS TO SHEETS").
const JobFlow = ({ job, size = 'md' }) => {
    const { inRaw, outRaw } = splitJobType(job.type);
    const inForm = itemForm(inRaw);
    const outForm = outRaw ? itemForm(outRaw) : null;
    const cellW = size === 'sm' ? 56 : 80;
    return (
        <div className="flex items-center justify-center gap-3">
            <div className="flex flex-col items-center">
                <div style={{ width: cellW }}>
                    <ItemVisual colour={job.colour} type={inRaw} size={size} />
                </div>
                <span className="text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">Raw · {FORM_LABEL[inForm]}</span>
            </div>
            {outForm && (
                <>
                    <ArrowRight size={size === 'sm' ? 16 : 22} className="text-slate-300 shrink-0" />
                    <div className="flex flex-col items-center">
                        <div style={{ width: cellW }}>
                            <ItemVisual colour={job.colour} type={outRaw} size={size} />
                        </div>
                        <span className="text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">Output · {FORM_LABEL[outForm]}</span>
                    </div>
                </>
            )}
        </div>
    );
};

const JobDetail = ({ job, updating, onStart, onComplete }) => {
    const startedAt = formatDateTime(job.startedAt);
    const completedAt = formatDateTime(job.completedAt);
    const { outRaw } = splitJobType(job.type);

    // Each sub-order must be ticked before the job can be marked completed.
    const [checked, setChecked] = useState({});
    const toggle = (id) => setChecked((prev) => ({ ...prev, [id]: !prev[id] }));
    const total = job.subOrders.length;
    const doneCount = job.subOrders.filter((so) => checked[so.id]).length;
    const allChecked = total === 0 || doneCount === total;

    return (
        <div className="space-y-4">
            {/* Job summary */}
            <Card className="p-4">
                <div className="flex items-center justify-between gap-2 mb-3">
                    <h3 className="font-bold text-slate-800">{job.type || 'Job'} #{job.id}</h3>
                    <StatusBadge started={job.started} completed={job.completed} />
                </div>

                {/* Raw material -> output */}
                <div className="mb-3 pb-3 border-b border-slate-100">
                    <JobFlow job={job} size="md" />
                </div>

                {(job.material || job.colour || job.gsm || job.width) && (
                    <div className="flex flex-wrap gap-1.5 mb-3">
                        {job.material && <Chip>{job.material}</Chip>}
                        {job.colour && <Chip>{job.colour}</Chip>}
                        {job.gsm && <Chip>{job.gsm} GSM</Chip>}
                        {job.width && <Chip>{job.width}{job.height ? ` × ${job.height}` : '"'}</Chip>}
                    </div>
                )}

                <div className="mt-1">
                    <DetailRow label="Type" value={job.type || '—'} />
                    <DetailRow label="Inventory Item" value={job.itemName || '—'} />
                    <DetailRow label="Available Weight (Kg)" value={`${job.availableKg ?? 0} kg`} />
                    <DetailRow label="Sub Orders" value={job.subOrders.length} />
                    <DetailRow label="From Date" value={formatDate(job.fromDate)} />
                    <DetailRow label="To Date" value={formatDate(job.toDate)} />
                    <DetailRow label="Planned Weight (Kg)" value={`${job.plannedKg ?? 0} kg`} />
                    <DetailRow label="Planned Count (Bundles)" value={job.bundles ?? 0} />
                    <DetailRow label="Production Started" value={job.started ? 'Yes' : 'No'} />
                    <DetailRow label="Production Started At" value={startedAt || '—'} />
                    <DetailRow label="Production Completed" value={job.completed ? 'Yes' : 'No'} />
                    <DetailRow label="Production Completed At" value={completedAt || '—'} />
                    <DetailRow label="Estimated Wastage Weight (Kg)" value={`${job.wastageKg ?? 0} kg`} />
                </div>

                <div className="mt-3 pt-3 border-t border-slate-100">
                    <div className="flex gap-2">
                        {!job.started && (
                            <Button variant="primary" className="flex-1 bg-blue-600 hover:bg-blue-700"
                                onClick={onStart} disabled={updating} icon={updating ? Loader2 : PlayCircle}>
                                Mark Started
                            </Button>
                        )}
                        {job.started && !job.completed && (
                            <Button variant="primary" className="flex-1"
                                onClick={onComplete} disabled={updating || !allChecked} icon={updating ? Loader2 : CheckCircle2}>
                                Mark Completed
                            </Button>
                        )}
                        {job.completed && (
                            <div className="flex-1 flex items-center justify-center gap-2 text-sm font-medium text-green-700 py-2">
                                <CheckCircle2 size={18} /> Job Completed
                            </div>
                        )}
                    </div>
                    {job.started && !job.completed && !allChecked && (
                        <p className="text-xs text-amber-600 text-center mt-2">
                            Tick all sub-orders to complete ({doneCount}/{total} done)
                        </p>
                    )}
                </div>
            </Card>

            {/* Sub-order line items */}
            <div>
                <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 px-1 flex items-center gap-1.5">
                    <FileText size={14} /> Sub-Order Line Items
                </h2>

                {job.subOrders.length === 0 ? (
                    <Empty icon={FileText} title="No sub-orders linked to this job" />
                ) : (
                    <div className="space-y-2.5">
                        {job.subOrders.map((so) => {
                            const outForm = itemForm(outRaw || so.model);
                            return (
                            <Card key={so.id} className={`p-4 ${checked[so.id] ? 'ring-1 ring-green-300 bg-green-50/40' : ''}`}>
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <h4 className="font-semibold text-slate-800 break-words min-w-0">{so.shop || `Sub-order #${so.id}`}</h4>
                                    <label className="flex items-center gap-1.5 shrink-0 cursor-pointer select-none">
                                        <input
                                            type="checkbox"
                                            checked={!!checked[so.id]}
                                            onChange={() => toggle(so.id)}
                                            className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
                                        />
                                        <span className={`text-xs font-medium ${checked[so.id] ? 'text-green-700' : 'text-slate-500'}`}>Done</span>
                                    </label>
                                </div>

                                {/* Expected output with highlighted dimensions */}
                                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-100">
                                    <div className="w-16 shrink-0">
                                        <ItemVisual colour={so.bagColour || job.colour} type={outRaw || so.model} size="md" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-xs font-semibold text-slate-600">Output: {FORM_LABEL[outForm]}</p>
                                        <div className="flex flex-wrap gap-1.5 mt-1.5">
                                            <Dim>W {so.bagW || '—'}″</Dim>
                                            <Dim>H {so.bagH || '—'}″</Dim>
                                        </div>
                                    </div>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <Field label="Quantity" value={(so.qty === null || so.qty === undefined || so.qty === '') ? '—' : `${so.qty}${so.qtyType ? ` ${so.qtyType}` : ''}`} />
                                    <Field label="Order Form Date" value={formatDate(so.orderFormDate)} />
                                    <Field label="Factory Updated Date" value={formatDate(so.factoryUpdatedDate)} />
                                    <Field label="Area Group" value={so.areaGroup} />
                                    <Field label="Material" value={so.material} />
                                    <Field label="Model" value={so.model} />
                                    <Field label="Roll Material" value={so.rollMaterial} />
                                    <Field label="Bag Colour" value={so.bagColour} />
                                    <Field label="Bag GSM" value={so.bagGsm} />
                                    <Field label="Sidepatty Colour" value={so.sidepattyColour} />
                                    <Field label="Sidepatty GSM" value={so.sidepattyGsm} />
                                    <Field label="Sheet Size" value={so.sheetSize} />
                                    <Field label="Bag Width" value={so.bagW} />
                                    <Field label="Bag Height" value={so.bagH} />
                                    <Field label="Sidepatty Width" value={so.sidepattyWidth} />
                                </div>
                            </Card>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ProductionJobsView;
