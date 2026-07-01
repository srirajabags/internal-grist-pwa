import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Boxes, AlertCircle, Loader2, RefreshCw, Package,
    PlayCircle, CheckCircle2, Circle, Clock, ChevronRight, Layers, FileText, ArrowRight, Plus, X, Warehouse
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import CreateBatchModal from '../components/CreateBatchModal';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { itemForm, FORM_LABEL, splitJobType } from '../utils/itemForms';
import { outputTypeFor, ROLL_WIDTH_TYPES, effectiveQty } from '../utils/productionBatch';

// Grist document holding the factory production tables
const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const JOBS_TABLE = 'Factory_Production_Jobs';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const TXN_TABLE = 'Inventory_Transactions';
const ITEMS_TABLE = 'Inventory_Items';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const roundWeight = (v) => Math.round(num(v) * 1000) / 1000;

// Which output dimension a job type is ticked by when marking it complete, plus
// the heading shown for that dimension's summary table.
const SIZE_DIM = {
    'ROLLS TO SHEETS': 'sheet',
    'ROLLS TO DCUT': 'bag',
    'ROLLS TO UCUT': 'bag',
    'ROLLS TO WCUT': 'bag',
    'ROLLS TO SIDEPATTY': 'patty',
    'ROLLS TO HANDLES': 'bag',
    'ROLLS TO PRESSING HANDLES': 'bag'
};
const SIZE_TITLE = { sheet: 'Sheet Sizes', bag: 'Bag Sizes', patty: 'Side-Patty Sizes' };

// Parse a Grist reference-list (stored as JSON like "[1,2]") into integer ids.
const parseRefList = (v) => {
    if (!v) return [];
    let a = v;
    if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x !== 'L').map(Number).filter(Number.isInteger);
};

const parseInventoryItemOptions = (v, fallbackIds = []) => {
    let parsed = v;
    if (typeof v === 'string') { try { parsed = JSON.parse(v); } catch { parsed = []; } }
    const options = Array.isArray(parsed)
        ? parsed
            .map((item) => ({ id: num(item?.id), itemId: item?.itemId || `Item #${num(item?.id)}` }))
            .filter((item) => Number.isInteger(item.id) && item.id > 0)
        : [];
    if (options.length > 0) return options;
    return fallbackIds.map((id) => ({ id, itemId: `Item #${id}` }));
};

// One joined query fetches the whole tree (open batches -> jobs -> sub-orders),
// plus inventory item details and the sub-order's customer/order. Reference-list
// columns are stored as JSON, so json_each() expands them for the joins.
// LEFT JOINs keep batches with no jobs and jobs with no sub-orders.
const TREE_SQL = `
    SELECT
        b.id AS batch_id, b.Type AS batch_type, b.Date AS batch_date,
        b.Total_Required_Output_Kg_ AS batch_planned_kg,
        b.Total_Finished_Stock_Kg_ AS batch_finished_kg,
        b.Total_Planned_Output_Kg_ AS batch_output_kg,
        b.Total_Wastage_Weight_Kg_ AS batch_wastage_kg,
        b.Production_Started_At AS batch_started_at,
        b.Production_Completed_At AS batch_completed_at,
        b.Required_Inventory_Collected AS batch_inv_collected,
        b.Inventory_Collected_At AS batch_inv_collected_at,
        b.Remaining_Inventory_Returned AS batch_inv_returned,
        b.Inventory_Returned_At AS batch_inv_returned_at,

        j.id AS job_id,
        j.Inventory_Item_Code AS job_item_code, j.Inventory_Items AS job_inv_items,
        (
            SELECT json_group_array(json_object('id', it.id, 'itemId', it.Item_ID))
            FROM json_each(CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END) ji
            LEFT JOIN Inventory_Items it ON it.id = ji.value
            WHERE ji.value != 'L'
        ) AS job_inv_item_options,
        j.Production_Started AS job_started, j.Production_Started_At AS job_started_at,
        j.Production_Completed AS job_completed, j.Production_Completed_At AS job_completed_at,
        j.Required_Quantity_Kg_ AS job_planned_kg, j.Available_Weight_Kg_ AS job_available_kg,
        j.Finished_Stock_Quantity_Kg_ AS job_finished_kg, j.Planned_Output_Quantity_Kg_ AS job_output_kg,
        j.Wastage_Weight_Kg_ AS job_wastage_kg, j.Planned_Count_Bundles_ AS job_bundles,
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
                finishedKg: f.batch_finished_kg,
                outputKg: f.batch_output_kg,
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
                const invItems = parseRefList(f.job_inv_items);
                job = {
                    id: f.job_id,
                    type: batch.type,   // inferred from the parent batch
                    itemName: f.item_name,                 // readable code (Inventory_Item_Codes)
                    itemCodeId: f.job_item_code,           // Inventory_Item_Code ref (roll code for roll-width jobs, else output code)
                    itemType: f.item_type,                 // output Type (e.g. "DCUT BAG")
                    invItems, // physical Inventory_Items refs
                    invItemOptions: parseInventoryItemOptions(f.job_inv_item_options, invItems),
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
                    finishedKg: f.job_finished_kg,
                    outputKg: f.job_output_kg,
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

// Compact kg label: whole numbers as-is, fractions to 1 dp.
const fmtKg = (v) => num(v).toFixed(2);
// Piece-counted batch types are tracked in bundles, not kg — no kg split to show.
const isPieceBatch = (type) => type === 'ROLLS TO SIDEPATTY' || type === 'ROLLS TO HANDLES';

// Stacked bar splitting a quantity into production output (to make) and finished
// stock pulled from the godown. Returns null when there's nothing to show.
const QtyBar = ({ output, finished, required }) => {
    const o = num(output), f = num(finished);
    const total = o + f > 0 ? o + f : num(required);
    if (total <= 0) return null;
    const op = (o / total) * 100, fp = (f / total) * 100;
    return (
        <div className="mt-2">
            <div className="flex h-2 rounded-full overflow-hidden bg-slate-100">
                {o > 0 && <div style={{ width: `${op}%` }} className="bg-emerald-500" title={`${fmtKg(o)} kg to produce`} />}
                {f > 0 && <div style={{ width: `${fp}%` }} className="bg-sky-400" title={`${fmtKg(f)} kg from stock`} />}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[11px]">
                <span className="text-slate-500">Required <span className="font-semibold text-slate-700">{fmtKg(total)} kg</span></span>
                <span className="text-emerald-700">● {fmtKg(o)} kg to produce</span>
                {f > 0 && <span className="text-sky-700">● {fmtKg(f)} kg from stock</span>}
            </div>
        </div>
    );
};

// Small badge flagging that some quantity is met from finished godown stock.
const StockPill = ({ kg }) => num(kg) > 0 ? (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium text-sky-700 bg-sky-50 ring-1 ring-sky-200">
        <Warehouse size={12} /> {fmtKg(kg)} kg from stock
    </span>
) : null;

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
    const [completingJob, setCompletingJob] = useState(null);

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

    // Compact, deterministic Item_ID label for a freshly produced output item,
    // mirroring the existing finished-goods convention (e.g. "DB_W_NN_110_36").
    const outputItemSlug = (job, outputType) => {
        const abbr = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
        return [abbr(outputType), abbr(job.colour), abbr(job.material), job.gsm, job.width]
            .filter((v) => v !== '' && v !== null && v !== undefined)
            .join('_');
    };

    // Resolve the Inventory_Item_Codes id for one of a job's output products. For
    // roll-width jobs the output code shares the consumed roll's material/colour/gsm
    // and roll width, so we look it up by (output type · those attributes). Other
    // jobs carry their single output code directly. Returns null if none exists yet.
    const resolveOutputCode = async (headers, job, outputType) => {
        if (!ROLL_WIDTH_TYPES.has(job.type)) {
            return Number.isInteger(job.itemCodeId) && job.itemCodeId > 0 ? job.itemCodeId : null;
        }
        const resp = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: 'SELECT id, GSM, Width_Inches_ FROM Inventory_Item_Codes WHERE Type = ? AND Material = ? AND Colour = ?',
                args: [outputType, job.material, job.colour]
            })
        });
        if (!resp.ok) return null;
        const data = await resp.json();
        const norm = (v) => String(v ?? '').trim().toUpperCase();
        const hit = (data.records || []).find((r) =>
            norm(r.fields.GSM) === norm(job.gsm) && norm(r.fields.Width_Inches_) === norm(job.width));
        return hit && Number.isInteger(hit.fields.id) ? hit.fields.id : null;
    };

    // Finished goods are tracked as one Inventory_Items row per output code. Reuse
    // the existing row for a code, or create one labelled by `slug`.
    const findOrCreateOutputItem = async (headers, codeId, slug) => {
        const sqlResp = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT id FROM Inventory_Items WHERE Item_Code = ? LIMIT 1', args: [codeId] })
        });
        if (sqlResp.ok) {
            const data = await sqlResp.json();
            const found = (data.records || [])[0];
            if (found && Number.isInteger(found.fields?.id)) return found.fields.id;
        }
        const createResp = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${ITEMS_TABLE}/records`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records: [{ fields: { Item_ID: slug, Item_Code: codeId } }] })
        });
        if (!createResp.ok) {
            const text = await createResp.text().catch(() => '');
            throw new Error(`Failed to create output inventory item: ${createResp.statusText}${text ? ` - ${text}` : ''}`);
        }
        const created = await createResp.json();
        const newId = created.records?.[0]?.id;
        if (!Number.isInteger(newId)) throw new Error('Output inventory item was not created.');
        return newId;
    };

    // Complete a job from the output form. For each produced output (per model for
    // DCUT), the planned portion lands in PRINTING AREA and any surplus in BAGS
    // GODOWN. Any leftover roll the operator reports goes back to ROLLS GODOWN.
    // Sequential (txns -> job) and throws (not setError) so the modal can show the
    // failure and the job is only marked done once every transaction succeeds.
    const submitJobOutput = async (job, form) => {
        setUpdatingJobId(job.id);
        try {
            const headers = await getHeaders();
            const now = Date.now() / 1000;
            const txnRecords = [];
            const remainingRolls = Array.isArray(form.remainingRolls)
                ? form.remainingRolls
                : (num(form.remainingRoll) > 0 ? [{ itemId: job.invItems?.[0], weight: form.remainingRoll }] : []);
            const totalOutput = roundWeight((form.outputs || []).reduce((sum, o) => sum + num(o.weight), 0));
            const totalReturned = roundWeight(remainingRolls.reduce((sum, r) => sum + num(r.weight), 0));
            const wastageKg = roundWeight(num(job.availableKg) - totalOutput - totalReturned);
            if (wastageKg < 0) {
                throw new Error('Output plus returned roll weight cannot exceed the available job weight.');
            }

            // One or more produced outputs, each crediting its own item code.
            for (const o of form.outputs) {
                const output = num(o.weight);
                if (output <= 0) continue;
                const codeId = await resolveOutputCode(headers, job, o.outputType);
                if (!codeId) {
                    throw new Error(`No ${o.outputType} item code for ${[job.material, job.colour, job.gsm && `${job.gsm} GSM`, job.width && `${job.width}″`].filter(Boolean).join(' · ')} — add it to Inventory_Item_Codes first.`);
                }
                const outItemId = await findOrCreateOutputItem(headers, codeId, outputItemSlug(job, o.outputType));
                const planned = num(o.planned);
                const surplus = Math.max(0, output - planned);
                const printingQty = output - surplus; // = min(output, planned)
                txnRecords.push({
                    fields: {
                        Item_ID: outItemId, Production_Job: job.id, Transaction_Type: 'ADD',
                        Weight_Kg_: printingQty, Location: 'PRINTING AREA', Transaction_Time: now
                    }
                });
                if (surplus > 0) {
                    txnRecords.push({
                        fields: {
                            Item_ID: outItemId, Production_Job: job.id, Transaction_Type: 'ADD',
                            Weight_Kg_: surplus, Location: 'BAGS GODOWN', Transaction_Time: now
                        }
                    });
                }
            }

            // Leftover rolls returned to ROLLS GODOWN, credited to the selected
            // consumed physical Inventory_Items rows.
            for (const returnedRoll of remainingRolls) {
                const remaining = num(returnedRoll.weight);
                if (remaining <= 0) continue;
                const rollItemId = num(returnedRoll.itemId);
                if (!rollItemId) throw new Error('Select an Inventory Item for every returned roll weight.');
                if (job.invItems?.length && !job.invItems.includes(rollItemId)) {
                    throw new Error('Returned roll item must belong to this job.');
                }
                txnRecords.push({
                    fields: {
                        Item_ID: rollItemId, Production_Job: job.id, Transaction_Type: 'ADD',
                        Weight_Kg_: remaining, Location: 'ROLLS GODOWN', Transaction_Time: now
                    }
                });
            }

            if (txnRecords.length > 0) {
                const txnResp = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${TXN_TABLE}/records`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records: txnRecords })
                });
                if (!txnResp.ok) {
                    const text = await txnResp.text().catch(() => '');
                    throw new Error(`Failed to record output transactions: ${txnResp.statusText}${text ? ` - ${text}` : ''}`);
                }
            }

            const jobFields = {
                Production_Completed: true,
                Production_Completed_At: now,
                // Operator-entered produced weight; the job's Wastage_Weight_Kg_ formula
                // derives wastage as Available − Output.
                Output_Weight_Kg_: totalOutput
            };
            if (!job.started) {
                jobFields.Production_Started = true;
                jobFields.Production_Started_At = job.startedAt || now;
            }
            const jobResp = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${JOBS_TABLE}/records`), {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id: job.id, fields: jobFields }] })
            });
            if (!jobResp.ok) {
                const text = await jobResp.text().catch(() => '');
                throw new Error(`Failed to mark job completed: ${jobResp.statusText}${text ? ` - ${text}` : ''}`);
            }

            setCompletingJob(null);
            await fetchData(true);
        } finally {
            setUpdatingJobId(null);
        }
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

    const markInventoryReturned = (batch) => {
        const allJobsCompleted = batch.jobs.length > 0 && batch.jobs.every((j) => j.completed);
        if (!allJobsCompleted) {
            setError('All jobs in the batch must be completed before marking remaining inventory returned.');
            return;
        }
        runInventoryAction(batch, {
            boolField: 'Remaining_Inventory_Returned',
            atField: 'Inventory_Returned_At',
            localDone: 'invReturned',
            localAt: 'invReturnedAt',
            type: 'ADD',
            weightFn: (j) => num(j.availableKg) - num(j.plannedKg)
        });
    };

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

            {completingJob && (
                <OutputModal
                    job={completingJob}
                    updating={updatingJobId === completingJob.id}
                    onClose={() => setCompletingJob(null)}
                    onSubmit={(form) => submitJobOutput(completingJob, form)}
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
                                    <div className="-mx-3 px-3 mb-3 overflow-x-auto no-scrollbar">
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
                                                        <span>{fmtKg(batch.plannedKg ?? 0)} kg required</span>
                                                        {!isPieceBatch(batch.type) && num(batch.finishedKg) > 0 && <StockPill kg={batch.finishedKg} />}
                                                    </div>
                                                    {!isPieceBatch(batch.type) && (
                                                        <QtyBar output={batch.outputKg} finished={batch.finishedKg} required={batch.plannedKg} />
                                                    )}
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
                                                            <span>{fmtKg(job.plannedKg ?? 0)} kg required</span>
                                                            <span>{fmtKg(job.availableKg ?? 0)} kg available</span>
                                                            {!isPieceBatch(job.type) && num(job.finishedKg) > 0 && <StockPill kg={job.finishedKg} />}
                                                        </div>
                                                        {!isPieceBatch(job.type) && (
                                                            <QtyBar output={job.outputKg} finished={job.finishedKg} required={job.plannedKg} />
                                                        )}
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
                                    onComplete={() => setCompletingJob(selectedJob)}
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
    const allJobsCompleted = batch.jobs.length > 0 && batch.jobs.every((job) => job.completed);

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
                    disabled={!allJobsCompleted}
                    onClick={onReturn}
                />
            </div>
        </Card>
    );
};

const InventoryAction = ({ label, done, at, actionLabel, doneLabel, updating, disabled = false, onClick }) => (
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
            <Button variant="secondary" className="text-sm shrink-0" onClick={onClick} disabled={updating || disabled}
                icon={updating ? Loader2 : Circle}>
                {actionLabel}
            </Button>
        )}
    </div>
);

// Raw material -> output illustration derived from the job Type (e.g. "ROLLS TO
// SHEETS"). A ROLLS TO DCUT job can produce both DCUT and HANDLE bags, so it shows
// an output for each model present in the job's sub-orders.
const jobOutputs = (job) => {
    const { outRaw } = splitJobType(job.type);
    if ((job.type || '').trim().toUpperCase() === 'ROLLS TO DCUT' && job.subOrders?.length) {
        const models = new Set(job.subOrders.map((so) => String(so.model ?? '').trim().toUpperCase()));
        const outs = [];
        if (models.has('DCUT')) outs.push('DCUT BAG');
        if (models.has('HANDLE')) outs.push('HANDLE BAG');
        if (outs.length) return outs;
    }
    return outRaw ? [outRaw] : [];
};

const JobFlow = ({ job, size = 'md' }) => {
    const { inRaw } = splitJobType(job.type);
    const inForm = itemForm(inRaw);
    const outputs = jobOutputs(job);
    const cellW = size === 'sm' ? 56 : 80;
    return (
        <div className="flex items-center justify-center gap-3">
            <div className="flex flex-col items-center">
                <div style={{ width: cellW }}>
                    <ItemVisual colour={job.colour} type={inRaw} size={size} />
                </div>
                <span className="text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">Raw · {FORM_LABEL[inForm]}</span>
            </div>
            {outputs.length > 0 && (
                <>
                    <ArrowRight size={size === 'sm' ? 16 : 22} className="text-slate-300 shrink-0" />
                    <div className="flex items-center gap-2">
                        {outputs.map((out) => (
                            <div key={out} className="flex flex-col items-center">
                                <div style={{ width: cellW }}>
                                    <ItemVisual colour={job.colour} type={out} size={size} />
                                </div>
                                <span className="text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">Output · {FORM_LABEL[itemForm(out)]}</span>
                            </div>
                        ))}
                    </div>
                </>
            )}
        </div>
    );
};

const JobDetail = ({ job, updating, onStart, onComplete }) => {
    const startedAt = formatDateTime(job.startedAt);
    const completedAt = formatDateTime(job.completedAt);
    // Completion is ticked per output line rather than per sub-order: ROLLS TO
    // SHEETS groups by sheet size, side-patty by patty width, DCUT by MODEL + bag
    // size (a DCUT job mixes DCUT and HANDLE bags), every other type by bag W×H.
    const jobType = (job.type || '').trim().toUpperCase();
    const sizeDim = SIZE_DIM[jobType] || 'bag';
    const isDcut = jobType === 'ROLLS TO DCUT';
    // Handle outputs are counted in bundles; everything else (incl. side/bottom
    // patty, which is cut from rolls) in kg.
    const isPieces = jobType === 'ROLLS TO HANDLES' || jobType === 'ROLLS TO PRESSING HANDLES';
    const cell = (v) => (v === null || v === undefined || v === '' || typeof v === 'object') ? '—' : v;
    const sizeKeyFor = (so) => {
        if (sizeDim === 'sheet') return String(cell(so.sheetSize));
        if (sizeDim === 'patty') return String(cell(so.sidepattyWidth));
        const bag = `${cell(so.bagW)}×${cell(so.bagH)}`;
        return isDcut ? `${cell(so.model)} | ${bag}` : bag;
    };
    const sizeLabelFor = (so) => {
        if (sizeDim === 'sheet') return String(cell(so.sheetSize));
        if (sizeDim === 'patty') { const w = cell(so.sidepattyWidth); return w === '—' ? '—' : `${w}″ wide`; }
        const bag = `${cell(so.bagW)}″ × ${cell(so.bagH)}″`;
        return isDcut ? `${cell(so.model)} · ${bag}` : bag;
    };

    const sizeTitle = isDcut ? 'Output (model · size)' : SIZE_TITLE[sizeDim];

    // Quantity in the batch's unit: STITCHING piece counts are converted to kg via
    // sheet geometry (reusing the batch-creation rule); pieces/weight pass through.
    const soQty = (so) => effectiveQty(jobType, {
        Model: so.model, Quantity_Type: so.qtyType, Sheet_Size: so.sheetSize,
        Bag_GSM: so.bagGsm, Bag_Width: so.bagW, Bag_Height: so.bagH, Quantity: so.qty,
        Sidepatty_Width: so.sidepattyWidth, Sidepatty_GSM: so.sidepattyGsm, Sidepatty_Colour: so.sidepattyColour
    });

    const sizeGroups = (() => {
        const map = new Map();
        for (const so of job.subOrders) {
            const key = sizeKeyFor(so);
            if (!map.has(key)) map.set(key, { key, label: sizeLabelFor(so), qty: 0, count: 0 });
            const g = map.get(key);
            g.qty += soQty(so);
            g.count += 1;
        }
        return [...map.values()].sort((a, b) => b.qty - a.qty);
    })();

    const [checked, setChecked] = useState({});
    const toggle = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
    const total = sizeGroups.length;
    const doneCount = sizeGroups.filter((g) => checked[g.key]).length;
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

                {/* Required = production output + finished stock pulled from godown */}
                {!isPieces && (
                    <div className="mb-3 pb-3 border-b border-slate-100">
                        <QtyBar output={job.outputKg} finished={job.finishedKg} required={job.plannedKg} />
                    </div>
                )}

                <div className="mt-1">
                    <DetailRow label="Type" value={job.type || '—'} />
                    <DetailRow label="Inventory Item" value={job.itemName || '—'} />
                    <DetailRow label="Available Weight (Kg)" value={`${fmtKg(job.availableKg ?? 0)} kg`} />
                    <DetailRow label="Sub Orders" value={job.subOrders.length} />
                    <DetailRow label="From Date" value={formatDate(job.fromDate)} />
                    <DetailRow label="To Date" value={formatDate(job.toDate)} />
                    <DetailRow label="Required Quantity (Kg)" value={`${fmtKg(job.plannedKg ?? 0)} kg`} />
                    {!isPieces && <DetailRow label="Finished Stock Quantity (Kg)" value={`${fmtKg(job.finishedKg ?? 0)} kg`} />}
                    {!isPieces && <DetailRow label="Planned Output Quantity (Kg)" value={`${fmtKg(job.outputKg ?? 0)} kg`} />}
                    <DetailRow label="Planned Count (Bundles)" value={job.bundles ?? 0} />
                    <DetailRow label="Production Started" value={job.started ? 'Yes' : 'No'} />
                    <DetailRow label="Production Started At" value={startedAt || '—'} />
                    <DetailRow label="Production Completed" value={job.completed ? 'Yes' : 'No'} />
                    <DetailRow label="Production Completed At" value={completedAt || '—'} />
                    <DetailRow label="Estimated Wastage Weight (Kg)" value={`${fmtKg(job.wastageKg ?? 0)} kg`} />
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
                            Tick all {sizeTitle.toLowerCase()} to complete ({doneCount}/{total} done)
                        </p>
                    )}
                </div>
            </Card>

            {/* Size summary — tick each size to enable completion */}
            {sizeGroups.length > 0 && (
                <Card className="p-4">
                    <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                        <Layers size={14} /> {sizeTitle}
                        <span className="ml-auto font-normal text-slate-400 normal-case tracking-normal">{doneCount}/{total} done</span>
                    </h2>
                    <div className="divide-y divide-slate-100">
                        {sizeGroups.map((g) => (
                            <label key={g.key} className="flex items-center justify-between gap-3 py-2.5 cursor-pointer select-none">
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 break-words">{g.label}</p>
                                    <p className="text-[11px] text-slate-400">{g.count} sub-order{g.count !== 1 ? 's' : ''}</p>
                                </div>
                                <div className="flex items-center gap-3 shrink-0">
                                    <span className="text-sm font-semibold text-slate-700">{isPieces ? num(g.qty) : `${fmtKg(g.qty)} kg`}</span>
                                    <input
                                        type="checkbox"
                                        checked={!!checked[g.key]}
                                        onChange={() => toggle(g.key)}
                                        disabled={job.completed}
                                        className="w-5 h-5 rounded border-slate-300 text-green-600 focus:ring-green-500"
                                    />
                                </div>
                            </label>
                        ))}
                    </div>
                </Card>
            )}

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
                            const outputType = outputTypeFor(job.type, { Model: so.model, Sidepatty_Colour: so.sidepattyColour });
                            const outForm = itemForm(outputType);
                            const convKg = soQty(so);
                            const qtyLabel = (so.qty === null || so.qty === undefined || so.qty === '')
                                ? '—'
                                : `${so.qty}${so.qtyType ? ` ${so.qtyType}` : ''}${!isPieces && convKg !== num(so.qty) ? ` (≈ ${fmtKg(convKg)} kg)` : ''}`;
                            return (
                            <Card key={so.id} className={`p-4 ${checked[sizeKeyFor(so)] ? 'ring-1 ring-green-300 bg-green-50/40' : ''}`}>
                                <div className="flex items-start justify-between gap-2 mb-3">
                                    <h4 className="font-semibold text-slate-800 break-words min-w-0">{so.shop || `Sub-order #${so.id}`}</h4>
                                    <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">{sizeLabelFor(so)}</span>
                                </div>

                                {/* Expected output with highlighted dimensions */}
                                <div className="flex items-center gap-3 mb-3 pb-3 border-b border-slate-100">
                                    <div className="w-16 shrink-0">
                                        <ItemVisual colour={so.bagColour || job.colour} type={outputType} size="md" />
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
                                    <Field label="Quantity" value={qtyLabel} />
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

// Output form shown when completing a job. Captures produced weight per output
// product (per model for DCUT) and, optionally, leftover roll to return. Each
// product's planned portion goes to PRINTING AREA, surplus to BAGS GODOWN; the
// leftover roll goes to ROLLS GODOWN. Output codes are resolved on submit, so a
// missing code surfaces here as an error rather than silently failing.
const OutputModal = ({ job, updating, onClose, onSubmit }) => {
    // Output products present in the job, each with its planned weight (sum of the
    // quantities of the sub-orders that produce it). DCUT splits by bag model.
    // Planned weight per output, in the batch's unit: STITCHING piece counts are
    // converted to kg (sheet geometry), matching the rest of the app.
    const soKg = (so) => effectiveQty(job.type, {
        Model: so.model, Quantity_Type: so.qtyType, Sheet_Size: so.sheetSize,
        Bag_GSM: so.bagGsm, Bag_Width: so.bagW, Bag_Height: so.bagH, Quantity: so.qty,
        Sidepatty_Width: so.sidepattyWidth, Sidepatty_GSM: so.sidepattyGsm, Sidepatty_Colour: so.sidepattyColour
    });
    // Each output's planned PRODUCTION target is its required qty minus the share
    // already met from finished godown stock — i.e. the job's Planned Output, split
    // across outputs in proportion to their required qty. The printing-vs-godown
    // split keys off this (not the full Required), so produced surplus is correct.
    const outRatio = num(job.plannedKg) > 0
        ? Math.max(num(job.plannedKg) - num(job.finishedKg), 0) / num(job.plannedKg)
        : 1;
    const outputs = (() => {
        const map = new Map();
        for (const so of job.subOrders) {
            const ot = outputTypeFor(job.type, { Model: so.model, Sidepatty_Colour: so.sidepattyColour });
            if (!map.has(ot)) map.set(ot, { outputType: ot, required: 0 });
            map.get(ot).required += soKg(so);
        }
        return [...map.values()]
            .map((o) => ({ ...o, required: roundWeight(o.required), planned: roundWeight(o.required * outRatio) }))
            .sort((a, b) => b.planned - a.planned);
    })();

    const [weights, setWeights] = useState({});
    const [returnRoll, setReturnRoll] = useState(false);
    const rollOptions = job.invItemOptions?.length
        ? job.invItemOptions
        : (job.invItems || []).map((id) => ({ id, itemId: `Item #${id}` }));
    const emptyReturnRow = () => ({ itemId: rollOptions.length === 1 ? String(rollOptions[0].id) : '', weight: '' });
    const [rollReturns, setRollReturns] = useState(() => [emptyReturnRow()]);
    const [wastageAccepted, setWastageAccepted] = useState(false);
    const [err, setErr] = useState('');

    const hasRoll = rollOptions.length > 0;
    const totalOut = outputs.reduce((s, o) => s + (Number(weights[o.outputType]) || 0), 0);
    const validRollReturns = rollReturns
        .map((row) => ({ itemId: num(row.itemId), weight: Number(row.weight) || 0 }))
        .filter((row) => row.itemId > 0 || row.weight > 0);
    const totalReturned = returnRoll ? roundWeight(validRollReturns.reduce((sum, row) => sum + row.weight, 0)) : 0;
    const wastageKg = roundWeight(num(job.availableKg) - totalOut - totalReturned);
    const valid = !updating && totalOut > 0 && (!returnRoll || (
        validRollReturns.length > 0
        && validRollReturns.length === rollReturns.length
        && validRollReturns.every((row) => row.itemId > 0 && row.weight > 0)
    )) && wastageKg >= 0 && (wastageKg === 0 || wastageAccepted);

    const setRollReturn = (idx, patch) => {
        setWastageAccepted(false);
        setRollReturns((rows) => rows.map((row, i) => (i === idx ? { ...row, ...patch } : row)));
    };
    const addRollReturn = () => {
        setWastageAccepted(false);
        setRollReturns((rows) => [...rows, emptyReturnRow()]);
    };
    const removeRollReturn = (idx) => {
        setWastageAccepted(false);
        setRollReturns((rows) => rows.length > 1 ? rows.filter((_, i) => i !== idx) : [emptyReturnRow()]);
    };

    const submit = async () => {
        setErr('');
        if (wastageKg < 0) {
            setErr('Output plus returned roll weight cannot exceed the available job weight.');
            return;
        }
        if (wastageKg > 0 && !wastageAccepted) {
            setErr('Confirm the wastage quantity before completing the job.');
            return;
        }
        try {
            await onSubmit({
                outputs: outputs.map((o) => ({ outputType: o.outputType, planned: o.planned, weight: Number(weights[o.outputType]) || 0 })),
                remainingRolls: returnRoll
                    ? rollReturns.map((row) => ({ itemId: num(row.itemId), weight: Number(row.weight) || 0 }))
                    : []
            });
        } catch (e) {
            setErr(e.message || String(e) || 'Failed to complete job.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">Complete {job.type || 'Job'} #{job.id}</h2>
                        <p className="text-xs text-slate-500 truncate">Record produced output{outputs.length > 1 ? ' per product' : ''}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                <div className="p-4 space-y-3 overflow-auto">
                    {err && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start text-sm">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="break-words">{err}</p>
                        </div>
                    )}

                    {outputs.map((o) => {
                        const output = Number(weights[o.outputType]) || 0;
                        const surplus = Math.max(0, output - o.planned);
                        const printing = output - surplus;
                        return (
                            <div key={o.outputType} className="rounded-lg border border-slate-200 p-3">
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <span className="text-sm font-semibold text-slate-800">{o.outputType}</span>
                                    <span className="text-[11px] text-slate-400">
                                        {fmtKg(o.planned)} kg to produce
                                        {o.planned < o.required && <span className="text-sky-600"> · {fmtKg(o.required - o.planned)} kg from stock</span>}
                                    </span>
                                </div>
                                <input
                                    type="number" inputMode="decimal" min="0" step="any"
                                    value={weights[o.outputType] ?? ''}
                                    onChange={(e) => {
                                        setWastageAccepted(false);
                                        setWeights((w) => ({ ...w, [o.outputType]: e.target.value }));
                                    }}
                                    placeholder="Output weight (kg)"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                                />
                                {output > 0 && (
                                    <div className="flex justify-between gap-3 mt-2 text-[11px]">
                                        <span className="text-slate-500">→ Printing Area <span className="font-semibold text-slate-700">{fmtKg(printing)} kg</span></span>
                                        <span className="text-slate-500">→ Bags Godown <span className={`font-semibold ${surplus > 0 ? 'text-green-700' : 'text-slate-400'}`}>{fmtKg(surplus)} kg</span></span>
                                    </div>
                                )}
                            </div>
                        );
                    })}

                    {hasRoll && (
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input type="checkbox" checked={returnRoll} onChange={(e) => {
                                    setWastageAccepted(false);
                                    setReturnRoll(e.target.checked);
                                }}
                                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                                <span className="text-sm font-medium text-slate-700">Roll left over — return to Rolls Godown</span>
                            </label>
                            {returnRoll && (
                                <div className="mt-3 space-y-2">
                                    {rollReturns.map((row, idx) => (
                                        <div key={idx} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] gap-2 items-center">
                                            <select
                                                value={row.itemId}
                                                onChange={(e) => setRollReturn(idx, { itemId: e.target.value })}
                                                className="min-w-0 w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm bg-white"
                                            >
                                                <option value="">Inventory Item</option>
                                                {rollOptions.map((item) => (
                                                    <option key={item.id} value={item.id}>{item.itemId}</option>
                                                ))}
                                            </select>
                                            <input
                                                type="number" inputMode="decimal" min="0" step="any" value={row.weight}
                                                onChange={(e) => setRollReturn(idx, { weight: e.target.value })}
                                                placeholder="Kg"
                                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => removeRollReturn(idx)}
                                                className="h-9 w-9 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-100"
                                                aria-label="Remove returned roll"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>
                                    ))}
                                    <Button variant="secondary" className="w-full text-sm" onClick={addRollReturn} icon={Plus}>
                                        Add Roll
                                    </Button>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Wastage = Available − produced output − returned roll */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div className="flex justify-between">
                            <span className="text-slate-500">Available weight</span>
                            <span className="font-semibold text-slate-700">{fmtKg(job.availableKg)} kg</span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-slate-500">− Produced output</span>
                            <span className="font-medium text-slate-600">{fmtKg(totalOut)} kg</span>
                        </div>
                        {returnRoll && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">− Returned roll</span>
                                <span className="font-medium text-slate-600">{fmtKg(totalReturned)} kg</span>
                            </div>
                        )}
                        <div className="flex justify-between border-t border-slate-200 pt-1">
                            <span className="text-slate-500">= Wastage</span>
                            <span className={`font-bold ${wastageKg < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtKg(wastageKg)} kg</span>
                        </div>
                    </div>

                    {wastageKg > 0 && (
                        <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={wastageAccepted}
                                onChange={(e) => setWastageAccepted(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                            />
                            <span className="text-sm text-amber-900">
                                <span className="font-semibold">{fmtKg(wastageKg)} kg</span> will be allocated as wastage in this job.
                            </span>
                        </label>
                    )}

                    {wastageKg < 0 && (
                        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                            Output plus returned roll weight exceeds available job weight by <span className="font-semibold">{fmtKg(Math.abs(wastageKg))} kg</span>.
                        </div>
                    )}
                </div>

                <div className="border-t border-slate-200 px-4 py-3 flex gap-2 justify-end">
                    <Button variant="ghost" onClick={onClose} disabled={updating}>Cancel</Button>
                    <Button variant="primary" onClick={submit} disabled={!valid}
                        icon={updating ? Loader2 : CheckCircle2}>
                        Complete Job
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ProductionJobsView;
