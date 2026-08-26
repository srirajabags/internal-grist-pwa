import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Boxes, AlertCircle, Loader2, RefreshCw, Package,
    PlayCircle, CheckCircle2, Circle, Clock, ChevronRight, Layers, FileText, ArrowRight, Plus, X, Warehouse,
    AlertTriangle, Trash2, Lock
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import CreateBatchModal from '../components/CreateBatchModal';
import CollectionChecklistModal from '../components/CollectionChecklistModal';
import ReturnChecklistModal from '../components/ReturnChecklistModal';
import DeleteBatchModal from '../components/DeleteBatchModal';
import WriteFailureModal from '../components/WriteFailureModal';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { itemForm, FORM_LABEL, splitJobType } from '../utils/itemForms';
import {
    outputTypeFor, ROLL_WIDTH_TYPES, effectiveQty, outputSizeLabel,
    groupOutputCount, outputCount, pattyDims, bottomSheetDims,
    OUTPUT_COUNT_UNIT, outputColour
} from '../utils/productionBatch';
import { choiceText } from '../utils/gristValues';
import { parseAttachmentId } from '../utils/attachments';
import {
    attrText, PIECES_PER_BUNDLE, countToKg, primaryUnitFor, SHEET_FORMS, countUnitFor
} from '../utils/txnDisplay';
import { writableRecords } from '../utils/gristWrites';
import { newJournal } from '../utils/writeJournal';
import { godownOf, godownForJob, splitStock, PRINTING_AREA, BAGS_GODOWN } from '../utils/godown';

// Grist document holding the factory production tables
const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const JOBS_TABLE = 'Factory_Production_Jobs';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const TXN_TABLE = 'Inventory_Transactions';
// Acknowledged stock per physical item, for the "what is still on the shelf"
// figure the collection list shows against each roll.
const SUMMARY_BY_ID_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';
// Counts live only on the by-code summary.
const SUMMARY_BY_CODE_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Location';
const ITEMS_TABLE = 'Inventory_Items';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const roundWeight = (v) => Math.round(num(v) * 1000) / 1000;

// Which output dimension a job type is ticked by when marking it complete, plus
// the heading shown for that dimension's summary table.
const SIZE_DIM = {
    'ROLLS TO SHEETS': 'sheet',
    'ROLLS TO MODEL SHEETS': 'sheet',
    'ROLLS TO DCUT': 'bag',
    'ROLLS TO UCUT': 'bag',
    'ROLLS TO WCUT': 'bag',
    'ROLLS TO SIDEPATTY': 'patty',
    'ROLLS TO BOTTOMPATTY SHEETS': 'patty',
    // A handle is the same strip whatever bag it ends up on, so grouping by bag
    // size would give the operator a list of sizes that make no difference to the
    // work. Handle jobs are ticked off one sub-order at a time instead.
    'ROLLS TO HANDLES': 'suborder',
    'ROLLS TO PRESSING HANDLES': 'suborder'
};
const SIZE_TITLE = {
    sheet: 'Sheet Sizes', bag: 'Bag Sizes', patty: 'Patty Sizes', suborder: 'Sub-Orders'
};

// Parse a Grist reference-list (stored as JSON like "[1,2]") into integer ids.
const parseRefList = (v) => {
    if (!v) return [];
    let a = v;
    if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x !== 'L').map(Number).filter(Number.isInteger);
};

// The alternates come back as a nested JSON array from the item subquery.
const parseSwaps = (v) => {
    let parsed = v;
    if (typeof v === 'string') { try { parsed = JSON.parse(v); } catch { return []; } }
    return Array.isArray(parsed)
        ? parsed.map((x) => ({ id: num(x?.id), itemId: x?.itemId || `Item #${num(x?.id)}`, kg: num(x?.kg) }))
            .filter((x) => Number.isInteger(x.id) && x.id > 0)
        : [];
};

const parseInventoryItemOptions = (v, fallbackIds = []) => {
    let parsed = v;
    if (typeof v === 'string') { try { parsed = JSON.parse(v); } catch { parsed = []; } }
    const options = Array.isArray(parsed)
        ? parsed
            .map((item) => ({
                id: num(item?.id),
                itemId: item?.itemId || `Item #${num(item?.id)}`,
                code: item?.code || null,
                type: item?.type || null,
                material: item?.material || null,
                colour: item?.colour || null,
                gsm: item?.gsm || null,
                w: item?.w || null,
                h: item?.h || null,
                // Weight leads; a count-only line converts from its geometry, or
                // the godown's ready stock would look empty.
                kg: num(item?.kg) > 0
                    ? num(item.kg)
                    : countToKg({ w: item?.w, h: item?.h, gsm: item?.gsm, type: item?.type, name: item?.code, count: num(item?.count) }),
                count: num(item?.count),
                collectedKg: item?.collectedKg == null ? null : num(item.collectedKg),
                returnedKg: item?.returnedKg == null ? null : num(item.returnedKg),
                swaps: parseSwaps(item?.swaps),
                returnPending: num(item?.returnedAcked) > 0,
                location: item?.location || null
            }))
            .filter((item) => Number.isInteger(item.id) && item.id > 0)
        : [];
    if (options.length > 0) return options;
    return fallbackIds.map((id) => ({
        id, itemId: `Item #${id}`, kg: null, collectedKg: null, returnedKg: null,
        returnPending: false, location: null
    }));
};

// One joined query fetches the whole tree (open batches -> jobs -> sub-orders),
// plus inventory item details and the sub-order's customer/order. Reference-list
// columns are stored as JSON, so json_each() expands them for the joins.
// LEFT JOINs keep batches with no jobs and jobs with no sub-orders.
const TREE_SQL = `
    SELECT
        b.id AS batch_id, b.Type AS batch_type, b.Date AS batch_date,
        b.Job_Batch_ID AS batch_name,
        b.Production_Started_At AS batch_started_at,
        b.Production_Completed_At AS batch_completed_at,
        b.Required_Inventory_Collected AS batch_inv_collected,
        b.Inventory_Collected_At AS batch_inv_collected_at,
        b.Finished_Stock_Collected AS batch_fin_collected,
        b.Finished_Stock_Collected_At AS batch_fin_collected_at,
        b.Remaining_Inventory_Returned AS batch_inv_returned,
        b.Inventory_Returned_At AS batch_inv_returned_at,

        j.id AS job_id, j.Job_ID AS job_name,
        -- The overage this job was planned with, so a later config change cannot
        -- silently re-price work that has already been run.
        j.Job_Overage AS job_overage,
        j.Inventory_Items AS job_inv_items,
        (
            SELECT json_group_array(json_object(
                'id', it.id, 'itemId', it.Item_ID,
                -- The item's OWN code, not the job's: a job can be assigned stock
                -- before its Inventory_Item_Code is resolved, and the collection
                -- list still has to name and draw what is on the shelf.
                'code', ic2.Item_Code, 'type', ic2.Type, 'material', ic2.Material,
                'colour', ic2.Colour, 'gsm', ic2.GSM,
                'w', ic2.Width_Inches_, 'h', ic2.Height_Inches_,
                -- What the godown still shows against this item, so the collection
                -- list can say which roll to look for and how heavy it should be.
                'kg', (SELECT ROUND(SUM(s.Available_Weight_Kg_), 2)
                       FROM ${SUMMARY_BY_ID_TABLE} s
                       WHERE s.Item_ID = it.id AND s.Incharge_Ack = 1),
                -- Sheets and patty in the bags godown are booked by COUNT and carry
                -- 0 kg, so the weight alone reads as "nothing there". Only the
                -- by-code summary holds counts; each non-roll code has one physical
                -- item, so it maps one to one.
                'count', COALESCE((SELECT c.Available_Count_Bundles_
                                   FROM ${SUMMARY_BY_CODE_TABLE} c
                                   WHERE c.Item_Code = it.Item_Code AND c.Incharge_Ack = 1
                                   LIMIT 1), 0),
                -- Other rolls of the same code the operator could take instead,
                -- when the planned one is buried or damaged. Oldest first, since
                -- that is the order the godown should be clearing.
                'swaps', (SELECT json_group_array(json_object('id', a.id, 'itemId', a.Item_ID, 'kg', ak.kg))
                          FROM Inventory_Items a
                          JOIN (SELECT s3.Item_ID AS iid, ROUND(SUM(s3.Available_Weight_Kg_), 2) AS kg
                                FROM ${SUMMARY_BY_ID_TABLE} s3
                                WHERE s3.Incharge_Ack = 1 AND s3.Location = 'ROLLS GODOWN'
                                GROUP BY s3.Item_ID HAVING SUM(s3.Available_Weight_Kg_) > 0) ak ON ak.iid = a.id
                          WHERE a.Item_Code = it.Item_Code AND a.id != it.id
                          ORDER BY a.Item_ID LIMIT 40),
                -- Which godown to walk to. Where an item has stock in more than
                -- one, the heaviest holding is the one worth sending them to.
                'location', (SELECT s2.Location
                             FROM ${SUMMARY_BY_ID_TABLE} s2
                             WHERE s2.Item_ID = it.id AND s2.Incharge_Ack = 1
                             ORDER BY s2.Available_Weight_Kg_ DESC LIMIT 1),
                -- What this job actually took off the shelf. Once collection is
                -- booked the item's available weight is 0, so the shelf figure is
                -- no longer what the operator is holding -- this is.
                'collectedKg', (SELECT ROUND(SUM(ABS(tx.Weight_Kg_)), 2)
                                FROM ${TXN_TABLE} tx
                                WHERE tx.Production_Job = j.id AND tx.Item_ID = it.id
                                  AND tx.Transaction_Type = 'LESS'),
                -- What the finished job already put back, and whether the godown
                -- has signed for it yet.
                'returnedKg', (SELECT ROUND(SUM(ABS(tx.Weight_Kg_)), 2)
                               FROM ${TXN_TABLE} tx
                               WHERE tx.Production_Job = j.id AND tx.Item_ID = it.id
                                 AND tx.Transaction_Type = 'ADD'),
                'returnedAcked', (SELECT COUNT(*)
                                  FROM ${TXN_TABLE} tx
                                  WHERE tx.Production_Job = j.id AND tx.Item_ID = it.id
                                    AND tx.Transaction_Type = 'ADD'
                                    AND COALESCE(tx.Incharge_Ack, 0) = 0)))
            FROM json_each(CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END) ji
            LEFT JOIN Inventory_Items it ON it.id = ji.value
            LEFT JOIN Inventory_Item_Codes ic2 ON ic2.id = it.Item_Code
            WHERE ji.value != 'L'
        ) AS job_inv_item_options,
        -- What the job actually moved, cross-referenced from the transactions that
        -- carry its reference rather than mirrored into columns on the job. A LESS
        -- is stock it took out; an ADD against one of its OWN items is stock handed
        -- back; any other ADD is what it produced.
        (SELECT ROUND(SUM(ABS(tx.Weight_Kg_)), 2) FROM ${TXN_TABLE} tx
         WHERE tx.Production_Job = j.id AND tx.Transaction_Type = 'LESS') AS job_collected_kg,
        -- Every item the job was assigned needs an ACKNOWLEDGED collection entry.
        -- Counting the items rather than the transactions catches both halves of
        -- it: one booked but not signed for, and one never booked at all. Until
        -- the incharge signs, the books show the stock still on the shelf whatever
        -- the floor has in its hands.
        (SELECT COUNT(*)
         FROM json_each(CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END) ji
         WHERE ji.value != 'L'
           AND NOT EXISTS (
               SELECT 1 FROM ${TXN_TABLE} tx
               WHERE tx.Production_Job = j.id AND tx.Item_ID = ji.value
                 AND tx.Transaction_Type = 'LESS' AND COALESCE(tx.Incharge_Ack, 0) = 1)
        ) AS job_collect_unacked,
        -- The same test, narrowed to ready-made stock: the raw trip waits on it.
        (SELECT COUNT(*)
         FROM json_each(CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END) ji
         LEFT JOIN Inventory_Items fi ON fi.id = ji.value
         LEFT JOIN Inventory_Item_Codes fc ON fc.id = fi.Item_Code
         WHERE ji.value != 'L' AND UPPER(COALESCE(fc.Type, '')) != 'ROLL'
           AND NOT EXISTS (
               SELECT 1 FROM ${TXN_TABLE} tx
               WHERE tx.Production_Job = j.id AND tx.Item_ID = ji.value
                 AND tx.Transaction_Type = 'LESS' AND COALESCE(tx.Incharge_Ack, 0) = 1)
        ) AS job_finished_unacked,
        (SELECT ROUND(SUM(tx.Weight_Kg_), 2) FROM ${TXN_TABLE} tx
         WHERE tx.Production_Job = j.id AND tx.Transaction_Type = 'ADD'
           AND tx.Item_ID IN (SELECT value FROM json_each(
               CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END))
        ) AS job_returned_kg,
        (SELECT ROUND(SUM(tx.Weight_Kg_), 2) FROM ${TXN_TABLE} tx
         WHERE tx.Production_Job = j.id AND tx.Transaction_Type = 'ADD'
           AND tx.Item_ID NOT IN (SELECT value FROM json_each(
               CASE WHEN json_valid(j.Inventory_Items) THEN j.Inventory_Items ELSE '[]' END))
        ) AS job_produced_kg,
        -- Of what it took out, how much was ready-made stock rather than raw roll.
        -- The item's own code says which it is, so the planned figure on the job
        -- row can be checked against what was actually drawn.
        (SELECT ROUND(SUM(ABS(tx.Weight_Kg_)), 2) FROM ${TXN_TABLE} tx
         LEFT JOIN Inventory_Items ti ON ti.id = tx.Item_ID
         LEFT JOIN Inventory_Item_Codes tc ON tc.id = ti.Item_Code
         WHERE tx.Production_Job = j.id AND tx.Transaction_Type = 'LESS'
           AND UPPER(COALESCE(tc.Type, '')) != 'ROLL') AS job_finished_taken_kg,

        j.Production_Started AS job_started, j.Production_Started_At AS job_started_at,
        j.Production_Completed AS job_completed, j.Production_Completed_At AS job_completed_at,
        j.From_Date AS job_from_date, j.To_Date AS job_to_date,

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
        so.Handle_Colour AS so_handle_colour, so.Print AS so_print,
        o.Order_ID AS so_order_id, o.Order_Form AS so_order_form,
        c.Shop_Name AS so_shop, ag.Area_Group AS so_area_group
    FROM Factory_Production_Job_Batches b
    LEFT JOIN Factory_Production_Jobs j ON j.id IN (SELECT value FROM json_each(b.Jobs))
    LEFT JOIN Sub_Orders so ON so.id IN (SELECT value FROM json_each(j.Sub_Orders))
    LEFT JOIN Orders o ON o.id = so."Order"
    LEFT JOIN Customers c ON c.id = so.Customer
    LEFT JOIN Area_Groups ag ON ag.id = so.Area_Group
    -- Completing the last job is not the end of the batch: the rolls are still on
    -- the floor until somebody walks them back. Keep it visible until they have.
    WHERE b.Production_Completed_At IS NULL
       OR COALESCE(b.Remaining_Inventory_Returned, 0) = 0
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

// The order's own quantity, said the way a person would: "50 kg", "500 pcs" —
// not the raw Quantity_Type choice, which reads as "50 WEIGHT (KG)".
const orderedText = (so) => {
    const qty = so?.qty;
    if (qty === null || qty === undefined || qty === '') return null;
    const unit = String(so.qtyType ?? '').trim().toUpperCase() === 'PIECES' ? 'pcs' : 'kg';
    return `${qty} ${unit}`;
};

// The planning helpers all speak Sub_Orders column names; this page carries the
// same rows in camelCase. One mapper, so a helper is never fed half a sub-order.
const planShape = (so) => ({
    id: so.id,
    Model: so.model, Material: so.material, Print: so.print,
    Roll_Material: so.rollMaterial, Quantity: so.qty, Quantity_Type: so.qtyType,
    Bag_Colour: so.bagColour, Bag_GSM: so.bagGsm, Bag_Width: so.bagW, Bag_Height: so.bagH,
    Sheet_Size: so.sheetSize,
    Sidepatty_Colour: so.sidepattyColour, Sidepatty_GSM: so.sidepattyGsm,
    Sidepatty_Width: so.sidepattyWidth,
    Handle_Colour: so.handleColour
});

// Grist's Job_Batch_ID, which is what the batch is called on paper. Only falls
// back to a constructed label when the column has not computed yet.
const batchLabel = (batch) => batch?.name || `${formatDate(batch?.date)} · ${batch?.type || 'Batch'}`;

// Likewise for a job: its Job_ID, never a row number dressed up as a name.
const jobLabel = (job) => job?.name || `${job?.type || 'Job'} #${job?.id}`;

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
                // Grist's own Job_Batch_ID -- the name printed on the paperwork.
                name: f.batch_name,
                startedAt: f.batch_started_at,
                completedAt: f.batch_completed_at,
                invCollected: !!f.batch_inv_collected,
                invCollectedAt: f.batch_inv_collected_at,
                finCollected: !!f.batch_fin_collected,
                finCollectedAt: f.batch_fin_collected_at,
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
                const invItemOptions = parseInventoryItemOptions(f.job_inv_item_options, invItems);
                const assigned = invItemOptions[0] || {};
                job = {
                    id: f.job_id,
                    // Grist's Job_ID formula. Everything the floor and the office
                    // say to each other uses this, so the app has to as well
                    // rather than inventing "TYPE #rowid".
                    name: f.job_name,
                    type: batch.type,   // inferred from the parent batch
                    // Everything about the material now comes from the stock the
                    // job was actually assigned; there is no item-code column on
                    // the job to mirror it.
                    itemName: assigned.code,
                    itemType: assigned.type,
                    overage: f.job_overage,
                    invItems, // physical Inventory_Items refs
                    invItemOptions,
                    material: assigned.material,
                    colour: assigned.colour,
                    gsm: assigned.gsm,
                    width: assigned.w,
                    height: assigned.h,
                    started: !!f.job_started,
                    startedAt: f.job_started_at,
                    completed: !!f.job_completed,
                    completedAt: f.job_completed_at,
                    // Movement figures come from the transactions, not the job row:
                    // the row would only ever be a stale copy of them.
                    collectedKg: num(f.job_collected_kg),
                    collectUnacked: num(f.job_collect_unacked),
                    finishedUnacked: num(f.job_finished_unacked),
                    returnedKg: num(f.job_returned_kg),
                    producedKg: num(f.job_produced_kg),
                    finishedTakenKg: num(f.job_finished_taken_kg),
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
                    sidepattyWidth: f.so_sidepatty_width,
                    handleColour: f.so_handle_colour,
                    print: f.so_print,
                    orderId: f.so_order_id,
                    orderForm: f.so_order_form
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
    // The batch whose collection checklist is open. Collecting is a walk round the
    // godown, so it is confirmed item by item before the flag is set.
    const [collectingBatch, setCollectingBatch] = useState(null);
    const [returningBatch, setReturningBatch] = useState(null);
    const [collectingFinished, setCollectingFinished] = useState(null);
    // The batch whose delete confirmation is open, with the safety check's result.
    const [deleting, setDeleting] = useState(null);
    // A part-finished write, shown as a modal rather than a line of red text: the
    // operator has to be able to tell their manager exactly what needs reversing.
    const [writeFailure, setWriteFailure] = useState(null);
    // Order-form attachment preview, so the floor can check the original paper.
    const [previewImage, setPreviewImage] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);
    // Fetch the whole tree in a single joined query. `silent` skips the full-page
    // spinner (used after an update to refresh data without flashing the tree).
    const viewOrderForm = async (attachmentValue) => {
        const attId = parseAttachmentId(attachmentValue);
        if (!attId) return;
        setLoadingPreview(true);
        setPreviewImage(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`), { headers });
            if (!res.ok) throw new Error(`Failed to download (${res.status})`);
            const blob = await res.blob();
            if (blob.size === 0) throw new Error('The order form came back empty');
            setPreviewImage(URL.createObjectURL(blob));
        } catch (err) {
            setWriteFailure({
                title: 'Could not open the order form',
                error: err.message || String(err),
                steps: [{ label: 'Download the order-form attachment', status: 'failed', detail: err.message }]
            });
        } finally {
            setLoadingPreview(false);
        }
    };

    const closePreview = () => {
        if (previewImage) URL.revokeObjectURL(previewImage);
        setPreviewImage(null);
        setLoadingPreview(false);
    };

    // Swap one planned roll for another of the same item code. The pick is made
    // days before anyone walks the shelf, and by then a roll can be buried,
    // damaged or already gone -- so the floor can substitute rather than abandon
    // the job. Restricted to the same code, so the job still gets its material.
    const swapRoll = async (job, fromId, toId) => {
        setUpdatingBatchId(collectingBatch?.id ?? null);
        const journal = newJournal();
        try {
            const ids = (job.invItems || []).map(num).filter(Number.isInteger);
            const next = ids.map((id) => (id === num(fromId) ? num(toId) : id));
            await journal.run(
                `Swap a roll on ${jobLabel(job)}`,
                () => writeRecords(JOBS_TABLE, 'PATCH', {
                    records: writableRecords(JOBS_TABLE, [
                        { id: job.id, fields: { Inventory_Items: ['L', ...next] } }
                    ])
                })
            );
            await fetchData(true);
        } catch (err) {
            setWriteFailure({
                title: 'The roll could not be swapped',
                error: err.message || String(err),
                steps: journal.steps
            });
        } finally {
            setUpdatingBatchId(null);
        }
    };

    // The job row behind an id, so a message can name it the way Grist does.
    const jobById = (id) => batches.flatMap((b) => b.jobs).find((j) => j.id === id);

    // Every write to Grist goes through here so a refusal always arrives as an
    // error carrying the server's own words, never as a quietly ignored response.
    const writeRecords = async (table, method, body) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method,
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(
                `${method === 'POST' ? 'Create' : 'Update'} in ${table} refused (${res.status} ${res.statusText})`
                + (text ? `: ${text}` : '')
            );
        }
        return res.json().catch(() => ({}));
    };

    const deleteRecords = async (table, ids) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/data/delete`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(ids)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Delete from ${table} refused (${res.status} ${res.statusText})${text ? `: ${text}` : ''}`);
        }
    };

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
        const journal = newJournal();
        setBatches((prev) => prev.map((b) => ({
            ...b,
            jobs: b.jobs.map((j) => (j.id === jobId ? { ...j, ...localPatch } : j))
        })));
        try {
            await journal.run(
                `Update ${jobLabel(jobById(jobId))} (${Object.keys(gristFields).join(', ')})`,
                () => writeRecords(JOBS_TABLE, 'PATCH', {
                    records: writableRecords(JOBS_TABLE, [{ id: jobId, fields: gristFields }])
                })
            );
            await fetchData(true);
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Production Jobs (update) Error:', message);
            setWriteFailure({ title: `${jobLabel(jobById(jobId))} was not updated`, error: message, steps: journal.steps });
            await fetchData(true);
        } finally {
            setUpdatingJobId(null);
        }
    };

    const markStarted = (job, batch) => {
        const block = startBlocker({ batch, job, runningJob });
        if (block) {
            setError(
                block.kind === 'collect'
                    ? 'Mark the batch inventory collected before starting a job — the stock is still in the godown.'
                    : block.kind === 'ack'
                        ? `The incharge has not acknowledged ${block.count} of this job's collected item(s) yet, so the books still show the stock in the godown.`
                        : `${jobLabel(block.job)} is still running. Finish it before starting another job in this batch.`
            );
            return;
        }
        const now = Date.now() / 1000;
        // Only the flag is written; Grist's trigger stamps the time. `now` is
        // still used for the optimistic row, which the refresh then replaces.
        updateJob(
            job.id,
            { Production_Started: true },
            { started: true, startedAt: now }
        );
    };

    // Compact, deterministic Item_ID label for a freshly produced output item,
    // mirroring the existing finished-goods convention (e.g. "DB_W_NN_110_36").
    // `sizeTag` separates articles that share one item code -- a 14x18 DCUT bag and
    // a 16x20 one are stocked under the same code, and without it the two would be
    // booked onto the same row and the size would be lost the moment it was typed.
    // Stock still totals by code; the size stays legible on the item, its label and
    // the movement history.
    const outputItemSlug = (job, outputType, sizeTag = '') => {
        const abbr = (s) => String(s ?? '').trim().split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase();
        return [abbr(outputType), abbr(job.colour), abbr(job.material), job.gsm, job.width, sizeTag]
            .filter((v) => v !== '' && v !== null && v !== undefined)
            .join('_');
    };

    // Resolve the Inventory_Item_Codes id for one of a job's output products. For
    // roll-width jobs the output code shares the consumed roll's material/colour/gsm
    // and roll width, so we look it up by (output type · those attributes). Other
    // jobs carry their single output code directly. Returns null if none exists yet.
    // The item code for a produced output, resolved from what the job is made of
    // rather than a column on the job. The output's identity is its type plus the
    // material it came from, which the assigned stock already carries.
    // `dims` are the finished article's own measurements, when the line knows
    // them. Sheets are stocked under a code per size, so a job cutting three sheet
    // sizes has three codes to find; bags and patty share one code per
    // specification, and fall through to the job-level match as before.
    const resolveOutputCode = async (headers, job, outputType, dims = null) => {
        const resp = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: 'SELECT id, GSM, Width_Inches_, Height_Inches_ FROM Inventory_Item_Codes WHERE Type = ? AND Material = ? AND Colour = ?',
                args: [outputType, job.material, job.colour]
            })
        });
        if (!resp.ok) return null;
        return pickOutputCode((await resp.json()).records || [], job, dims);
    };

    // Finished goods are tracked as one Inventory_Items row per output code. Reuse
    // the existing row for a code, or create one labelled by `slug`.
    const findOrCreateOutputItem = async (headers, codeId, slug) => {
        const sqlResp = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: 'SELECT id FROM Inventory_Items WHERE Item_ID = ? LIMIT 1', args: [slug] })
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
        const journal = newJournal();
        try {
            const headers = await getHeaders();
            const now = Date.now() / 1000;
            const txnRecords = [];
            const remainingRolls = Array.isArray(form.remainingRolls) ? form.remainingRolls : [];

            // One or more produced outputs, each crediting its own item code.
            for (const o of form.outputs) {
                const output = num(o.weight);
                if (output <= 0) continue;
                const codeId = await resolveOutputCode(headers, job, o.outputType, o.dims);
                if (!codeId) {
                    throw new Error(`No ${o.outputType} item code for ${[job.material, job.colour, job.gsm && `${job.gsm} GSM`, o.sizeLabel].filter(Boolean).join(' · ')} — add it to Inventory_Item_Codes first.`);
                }
                // This can create an Inventory_Items row, so it is a write worth
                // recording: a later failure leaves it behind.
                const outItemId = await journal.run(
                    `Find or create the stock item for ${o.sizeLabel || o.outputType}`,
                    () => findOrCreateOutputItem(headers, codeId, outputItemSlug(job, o.outputType, o.sizeTag))
                );
                for (const half of outputSplit(o)) {
                    txnRecords.push({
                        fields: {
                            Item_ID: outItemId, Production_Job: job.id, Transaction_Type: 'ADD',
                            Location: half.location, Transaction_Time: now, ...half.fields
                        }
                    });
                }
            }

            // Leftover roll goes back to ROLLS GODOWN as soon as the run ends: the
            // roll is free at that moment, which is what the stock figure should
            // reflect. It stays unacknowledged until the incharge actually receives
            // it, and the batch's "Mark Returned" step records that handover.
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
                        Weight_Kg_: remaining, Location: godownForJob(job), Transaction_Time: now
                    }
                });
            }

            if (txnRecords.length > 0) {
                await journal.run(
                    `Book ${txnRecords.length} output transaction(s) into PRINTING AREA / the godown`,
                    () => writeRecords(TXN_TABLE, 'POST', { records: txnRecords })
                );
            } else {
                journal.skip('Book output transactions', 'Nothing was produced or returned');
            }

            // Production_Completed_At and Production_Started_At are trigger
            // formulas off these flags, so they are left for Grist to stamp.
            // Nothing about quantities is written here. What the job took, gave
            // back and produced all read off these very transactions, and wastage
            // is what those three leave over -- storing a copy would only let it
            // disagree with them.
            const jobFields = { Production_Completed: true };
            if (!job.started) jobFields.Production_Started = true;
            await journal.run(
                `Mark ${jobLabel(job)} completed`,
                () => writeRecords(JOBS_TABLE, 'PATCH', {
                    records: writableRecords(JOBS_TABLE, [{ id: job.id, fields: jobFields }])
                })
            );

            setCompletingJob(null);
            await fetchData(true);
        } catch (err) {
            // Completing a job books stock in several writes. If it stops half way
            // the operator has to be told which of them landed, because those are
            // the ones a manager has to reverse.
            setWriteFailure({
                title: `Completing ${jobLabel(job)} did not finish`,
                error: err.message || String(err),
                steps: journal.steps
            });
            await fetchData(true);
            throw err;   // the completion form stays open with its own message
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
        const journal = newJournal();
        try {
            // 1. The movements themselves.
            // Weight_Change_Kg_ / Count_Change_Bundle_ are formula columns (sign
            // derived from Transaction_Type), so we write the magnitude to
            // Weight_Kg_. Item_Code is also a formula (derived from Item_ID), so we
            // set Item_ID (Ref:Inventory_Items) + Production_Job + Location. Without
            // a Location the by-location stock summaries never see the movement, so
            // it must always be set.
            // Some actions only set a flag — the stock has already moved.
            const txnRecords = cfg.linesFor ? batch.jobs.flatMap((j) => cfg.linesFor(j, now)) : [];
            if (txnRecords.length > 0) {
                await journal.run(
                    `Book ${txnRecords.length} ${cfg.type} inventory transaction(s) against this batch's jobs`,
                    () => writeRecords(TXN_TABLE, 'POST', { records: txnRecords })
                );
            } else {
                journal.skip('Book inventory transactions', 'This batch has no jobs to book against');
            }

            // 2. Mark the batch flag. Its timestamp is a trigger formula.
            await journal.run(
                `Mark the batch ${cfg.boolField.replace(/_/g, ' ').toLowerCase()}`,
                () => writeRecords(BATCHES_TABLE, 'PATCH', {
                    records: writableRecords(BATCHES_TABLE, [{ id: batch.id, fields: { [cfg.boolField]: true } }])
                })
            );

            await fetchData(true);
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Production Jobs (inventory action) Error:', message);
            // Never just a red line: the transactions may already be in Grist while
            // the flag is not, and only the operator can get that reversed.
            setWriteFailure({
                title: `${cfg.type === 'LESS' ? 'Collecting' : 'Returning'} inventory did not finish`,
                error: message,
                steps: journal.steps
            });
            await fetchData(true);
        } finally {
            setUpdatingBatchId(null);
        }
    };

    // Collecting takes each assigned item off its own shelf, whole: a roll is
    // never split at the godown, and Available_Weight_Kg_ is the sum of exactly
    // these figures. One line per item, so every movement names the item it moved
    // and the godown it left -- a single job-level line could do neither once a
    // job draws on more than one item.
    const collectionLines = (job, now) => {
        // Only the raw stock. Finished stock never sits on the production floor as
        // raw material -- it goes shelf-to-printing in one move, handled by its own
        // action, so mixing it in here would book it out twice.
        const assigned = job.invItemOptions || [];
        const items = splitStock(assigned).raw;
        const needKg = jobWorkPlan(job).totals.kg;
        // A job whose stock is entirely ready-made has nothing on the roll trip.
        // Falling through to the no-item line below booked a phantom LESS against
        // no item at all, in whichever godown the job type guessed.
        if (items.length === 0 && assigned.length > 0) return [];
        if (items.length === 0) {
            return [{
                fields: {
                    Item_ID: null,
                    Production_Job: job.id,
                    Transaction_Type: 'LESS',
                    Weight_Kg_: roundWeight(needKg),
                    Location: godownForJob(job),
                    Transaction_Time: now
                }
            }];
        }
        return items
            .map((item) => ({
                fields: {
                    Item_ID: item.id,
                    Production_Job: job.id,
                    Transaction_Type: 'LESS',
                    Weight_Kg_: item.kg != null ? num(item.kg) : roundWeight(needKg / items.length),
                    Location: godownOf(item),
                    Transaction_Time: now
                }
            }))
            .filter((r) => num(r.fields.Weight_Kg_) > 0);
    };

    // Ready-made stock does not get cut, so it never joins a production run as raw
    // material: it leaves the bags godown and arrives in the printing area in one
    // movement. Two transactions per item, and no batch flag -- whether it has
    // happened is simply whether those transactions exist.
    // What a finished-stock trip would pull: each ready item the batch has not
    // booked yet, drawn down to the job's requirement rather than emptied off the
    // shelf the way a roll is taken whole. Built once and used for both the sheet
    // the operator ticks and the transactions written, so they cannot disagree.
    const finishedCollectionPlan = (batch) => (batch?.jobs || []).flatMap((job) => {
        const pending = splitStock(job.invItemOptions).finished.filter((it) => it.collectedKg == null);
        if (pending.length === 0) return [];
        let remaining = jobWorkPlan(job).totals.kg;
        return pending.map((item) => {
            const take = roundWeight(Math.min(num(item.kg), Math.max(remaining, 0)));
            remaining -= take;
            // Ready stock is picked off the shelf by count, so say how many, not
            // just how heavy. Derived from the item's own kg-per-count.
            const perCount = num(item.count) > 0 ? num(item.kg) / num(item.count) : 0;
            return {
                key: `${job.id}:${item.id}`, job, item, godown: godownOf(item), take,
                takeCount: perCount > 0 ? Math.ceil(take / perCount - 1e-9) : null
            };
        }).filter((l) => l.take > 0);
    });

    const collectFinishedStock = async (batch, picks) => {
        setUpdatingBatchId(batch.id);
        const journal = newJournal();
        const now = Date.now() / 1000;
        try {
            const records = (picks || []).flatMap(({ job, item, take, takeCount }) => {
                const base = {
                    Item_ID: item.id, Production_Job: job.id, Transaction_Time: now,
                    ...quantityFields({ type: item.type, name: item.code, kg: take, count: roundCount(item.type, takeCount) })
                };
                return [
                    { fields: { ...base, Transaction_Type: 'LESS', Location: godownOf(item) } },
                    { fields: { ...base, Transaction_Type: 'ADD', Location: PRINTING_AREA } }
                ];
            });
            if (records.length === 0) {
                journal.skip('Move finished stock to the printing area', 'Nothing left to move');
            } else {
                await journal.run(
                    `Move ${records.length / 2} finished item(s) from ${BAGS_GODOWN} to ${PRINTING_AREA}`,
                    () => writeRecords(TXN_TABLE, 'POST', { records })
                );
            }
            await journal.run(
                'Mark the batch finished stock collected',
                () => writeRecords(BATCHES_TABLE, 'PATCH', {
                    records: writableRecords(BATCHES_TABLE, [{ id: batch.id, fields: { Finished_Stock_Collected: true } }])
                })
            );
            await fetchData(true);
        } catch (err) {
            setWriteFailure({
                title: 'Collecting the finished stock did not finish',
                error: err.message || String(err),
                steps: journal.steps
            });
            await fetchData(true);
        } finally {
            setUpdatingBatchId(null);
        }
    };

    const markInventoryCollected = (batch) => {
        const finished = batch.jobs.flatMap((job) => splitStock(job.invItemOptions).finished);
        const unacked = batch.jobs.reduce((t, job) => t + num(job.finishedUnacked), 0);
        if (finished.length > 0 && !batch.finCollected) {
            setError('Collect the finished stock first — it leaves the bags godown before the roll does.');
            return Promise.resolve();
        }
        if (unacked > 0) {
            setError(`The incharge has not acknowledged ${unacked} finished item(s) yet, so the books still show them in the bags godown.`);
            return Promise.resolve();
        }
        return collectRawStock(batch);
    };

    const collectRawStock = (batch) => runInventoryAction(batch, {
        boolField: 'Required_Inventory_Collected',
        localDone: 'invCollected',
        localAt: 'invCollectedAt',
        type: 'LESS',
        linesFor: collectionLines
    });

    // The leftover was already booked back when each job finished — the roll was
    // free from that moment. This step records that the godown has physically
    // taken it, which closes the batch; the incharge acknowledges the transactions
    // themselves separately, when the stock is in front of them.
    const markInventoryReturned = (batch) => runInventoryAction(batch, {
        boolField: 'Remaining_Inventory_Returned',
        localDone: 'invReturned',
        localAt: 'invReturnedAt',
        type: 'ADD'
    });

    const openReturn = (batch) => {
        const allJobsCompleted = batch.jobs.length > 0 && batch.jobs.every((j) => j.completed);
        if (!allJobsCompleted) {
            setError('All jobs in the batch must be completed before returning the remaining inventory.');
            return;
        }
        setReturningBatch(batch);
    };

    // Undoing a batch creation. Creation only writes records -- a batch, a job per
    // group, and the two-way references those pull in -- so removing the jobs and
    // the batch is a complete reversal, provided nothing has been done against it
    // since. That is what the transaction count checks.
    const openDeleteBatch = async (batch) => {
        setDeleting({ batch, checking: true, txnCount: 0, busy: false, error: null });
        const jobIds = batch.jobs.map((j) => j.id).filter(Number.isInteger);
        if (jobIds.length === 0) {
            setDeleting((d) => (d ? { ...d, checking: false } : d));
            return;
        }
        try {
            const headers = await getHeaders();
            const resp = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: `SELECT COUNT(*) AS n FROM ${TXN_TABLE} WHERE Production_Job IN (${jobIds.map(() => '?').join(',')})`,
                    args: jobIds
                })
            });
            if (!resp.ok) throw new Error(resp.statusText);
            const data = await resp.json();
            setDeleting((d) => (d ? { ...d, checking: false, txnCount: num(data.records?.[0]?.fields?.n) } : d));
        } catch (err) {
            // A check that could not run must not read as "nothing has moved".
            setDeleting((d) => (d ? {
                ...d, checking: false, txnCount: 0,
                error: `Could not check for stock movements against this batch (${err.message || err}). Delete is blocked until that check succeeds.`,
                checkFailed: true
            } : d));
        }
    };

    const runDeleteBatch = async () => {
        const batch = deleting?.batch;
        if (!batch) return;
        setDeleting((d) => ({ ...d, busy: true, error: null }));
        const journal = newJournal();
        const jobIds = batch.jobs.map((j) => j.id).filter(Number.isInteger);
        try {
            // Jobs first: a batch whose jobs outlived it would be unreachable.
            if (jobIds.length > 0) {
                await journal.run(
                    `Delete ${jobIds.length} job(s) — ${batch.jobs.map(jobLabel).join('; ')}`,
                    () => deleteRecords(JOBS_TABLE, jobIds)
                );
            } else {
                journal.skip('Delete jobs', 'This batch had none');
            }
            await journal.run(`Delete batch ${batchLabel(batch)}`, () => deleteRecords(BATCHES_TABLE, [batch.id]));
            setDeleting(null);
            setSelectedJobId(null);
            setSelectedBatchId(null);
            await fetchData();
        } catch (err) {
            // Deleting the jobs but not the batch leaves an empty batch behind,
            // which somebody has to clear up -- so say so plainly.
            setDeleting(null);
            setWriteFailure({
                title: 'The batch was not fully deleted',
                error: err.message || String(err),
                steps: journal.steps
            });
            await fetchData(true);
        }
    };

    // --- Derived navigation state ---
    const types = [...new Set(batches.map((b) => b.type).filter(Boolean))].sort();
    const filteredBatches = selectedType ? batches.filter((b) => b.type === selectedType) : batches;
    const selectedBatch = batches.find((b) => b.id === selectedBatchId);
    const selectedJob = selectedBatch?.jobs.find((j) => j.id === selectedJobId);
    // Only one job in a batch can be on the machine at a time.
    const runningJob = selectedBatch?.jobs.find((j) => j.started && !j.completed) || null;
    const level = selectedJob ? 'job' : selectedBatch ? 'jobs' : 'batches';

    const handleBack = () => {
        if (level === 'job') setSelectedJobId(null);
        else if (level === 'jobs') setSelectedBatchId(null);
        else onBack();
    };

    const headerTitle =
        level === 'job' ? jobLabel(selectedJob)
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

            {(loadingPreview || previewImage) && (
                <ImagePreviewModal src={previewImage} loading={loadingPreview && !previewImage} onClose={closePreview} />
            )}

            {writeFailure && (
                <WriteFailureModal
                    title={writeFailure.title}
                    error={writeFailure.error}
                    steps={writeFailure.steps}
                    onClose={() => setWriteFailure(null)}
                />
            )}

            {deleting && (
                <DeleteBatchModal
                    batch={deleting.batch}
                    checking={deleting.checking}
                    txnCount={deleting.txnCount}
                    checkFailed={deleting.checkFailed}
                    busy={deleting.busy}
                    error={deleting.error}
                    onClose={() => { if (!deleting.busy) setDeleting(null); }}
                    onDelete={runDeleteBatch}
                />
            )}

            {returningBatch && (
                <ReturnChecklistModal
                    batch={returningBatch}
                    updating={updatingBatchId === returningBatch.id}
                    onClose={() => setReturningBatch(null)}
                    onConfirm={async () => {
                        await markInventoryReturned(returningBatch);
                        setReturningBatch(null);
                    }}
                />
            )}

            {collectingFinished && (
                <CollectionChecklistModal
                    batch={collectingFinished}
                    lines={finishedCollectionPlan(collectingFinished)}
                    title="Collect the finished stock"
                    note="These go straight from the bags godown to the printing area — no roll is cut for them."
                    emptyText="Nothing left to pull from the bags godown for this batch."
                    updating={updatingBatchId === collectingFinished.id}
                    onClose={() => setCollectingFinished(null)}
                    onConfirm={async () => {
                        await collectFinishedStock(collectingFinished, finishedCollectionPlan(collectingFinished));
                        setCollectingFinished(null);
                    }}
                />
            )}

            {collectingBatch && (
                <CollectionChecklistModal
                    batch={collectingBatch}
                    updating={updatingBatchId === collectingBatch.id}
                    onClose={() => setCollectingBatch(null)}
                    onSwap={swapRoll}
                    onConfirm={async () => {
                        await markInventoryCollected(collectingBatch);
                        setCollectingBatch(null);
                    }}
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
                                            {filteredBatches.map((batch) => {
                                            // A batch is what its jobs add up to, worked
                                            // out the same way each job page works it out.
                                            const batchTotals = batch.jobs.reduce((t, j) => {
                                                const { totals } = jobWorkPlan(j);
                                                return {
                                                    count: t.count + totals.count,
                                                    kg: t.kg + totals.kg,
                                                    fromStock: t.fromStock + num(j.finishedTakenKg),
                                                    unit: totals.unit || t.unit
                                                };
                                            }, { count: 0, kg: 0, fromStock: 0, unit: '' });
                                            return (
                                                <button
                                                    key={batch.id}
                                                    onClick={() => setSelectedBatchId(batch.id)}
                                                    className="w-full text-left p-4 rounded-xl border bg-white border-slate-200 hover:border-amber-300 active:bg-amber-50 transition-all"
                                                >
                                                    <div className="mb-2.5 pb-2.5 border-b border-slate-100">
                                                        <BatchFlow batch={batch} size="sm" />
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
                                                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-2">
                                                        {batchTotals.count > 0 ? (
                                                            <>
                                                                <span className="text-lg font-bold text-slate-800 tabular-nums">
                                                                    {batchTotals.count.toLocaleString('en-IN')}
                                                                </span>
                                                                <span className="text-xs font-medium text-slate-500">{batchTotals.unit}</span>
                                                                <span className="text-xs text-slate-400">≈ {fmtKg(batchTotals.kg)} kg</span>
                                                            </>
                                                        ) : (
                                                            <span className="text-lg font-bold text-slate-800 tabular-nums">{fmtKg(batchTotals.kg)} kg</span>
                                                        )}
                                                    </div>
                                                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                                                        <span className="flex items-center gap-1"><Package size={13} /> {batch.jobs.length} job{batch.jobs.length !== 1 ? 's' : ''}</span>
                                                        {batchTotals.fromStock > 0 && <StockPill kg={batchTotals.fromStock} />}
                                                    </div>
                                                    {batch.startedAt && (
                                                        <div className="mt-2 inline-flex items-center gap-1 text-xs font-medium text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                                                            <PlayCircle size={12} /> In Progress
                                                        </div>
                                                    )}
                                                </button>
                                            );
                                            })}
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
                                        onCollect={() => setCollectingBatch(selectedBatch)}
                                        onCollectFinished={() => setCollectingFinished(selectedBatch)}
                                        onReturn={() => openReturn(selectedBatch)}
                                    />

                                    {selectedBatch.jobs.length === 0 ? (
                                        <Empty icon={Package} title="No jobs in this batch" />
                                    ) : (
                                        <div className="space-y-2.5">
                                            {selectedBatch.jobs.map((job) => {
                                            const isUpdating = updatingJobId === job.id;
                                            const plan = jobWorkPlan(job);
                                            const isRunning = job.started && !job.completed;
                                            const block = job.started ? null : startBlocker({ batch: selectedBatch, job, runningJob });
                                            return (
                                                <Card key={job.id} className={`p-4 ${isRunning ? 'job-running ring-1 ring-blue-200' : ''}`}>
                                                    <button onClick={() => setSelectedJobId(job.id)} className="w-full text-left active:opacity-70 transition-opacity">
                                                        <div className="mb-2 pb-2 border-b border-slate-100">
                                                            <JobFlow job={job} size="sm" />
                                                        </div>
                                                        <div className="flex items-start justify-between gap-2">
                                                            <div className="min-w-0">
                                                                <div className="flex items-center gap-2 flex-wrap">
                                                                    <h3 className="font-bold text-slate-800 break-words min-w-0">{jobLabel(job)}</h3>
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
                                                        {/* The same figures the job page leads
                                                            with — one job cannot be quoted two
                                                            different outputs on two screens. */}
                                                        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1 mt-2">
                                                            {plan.totals.count > 0 ? (
                                                                <>
                                                                    <span className="text-lg font-bold text-slate-800 tabular-nums">
                                                                        {plan.totals.count.toLocaleString('en-IN')}
                                                                    </span>
                                                                    <span className="text-xs font-medium text-slate-500">{plan.totals.unit}</span>
                                                                    <span className="text-xs text-slate-400">≈ {fmtKg(plan.totals.kg)} kg</span>
                                                                </>
                                                            ) : (
                                                                <span className="text-lg font-bold text-slate-800 tabular-nums">{fmtKg(plan.totals.kg)} kg</span>
                                                            )}
                                                        </div>
                                                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-slate-500">
                                                            <span className="flex items-center gap-1"><Layers size={13} /> {plan.subOrderCount} sub-order{plan.subOrderCount !== 1 ? 's' : ''}</span>
                                                            {plan.orderCount > 0 && <span>{plan.orderCount} order{plan.orderCount !== 1 ? 's' : ''}</span>}
                                                            {plan.sizeDim !== 'suborder' && (
                                                                <span>{plan.sizeGroups.length} {plan.sizeGroups.length === 1 ? plan.sizeNoun : `${plan.sizeNoun}s`}</span>
                                                            )}
                                                            {collectedKgOf(job) != null && <span>{fmtKg(collectedKgOf(job))} kg collected</span>}
                                                            {num(job.finishedTakenKg) > 0 && <StockPill kg={job.finishedTakenKg} />}
                                                        </div>
                                                    </button>

                                                    <div className="flex gap-2 mt-3 pt-3 border-t border-slate-100">
                                                        {!job.started && (
                                                            <Button variant="primary" className="flex-1 text-sm bg-blue-600 hover:bg-blue-700"
                                                                onClick={() => markStarted(job, selectedBatch)}
                                                                disabled={isUpdating || !!block}
                                                                icon={isUpdating ? Loader2 : block ? Lock : PlayCircle}>
                                                                {!block ? 'Start'
                                                                    : block.kind === 'collect' ? 'Not collected'
                                                                        : block.kind === 'ack' ? 'Not acknowledged' : 'Waiting'}
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
                                                    {block && (
                                                        <p className="text-[11px] text-slate-400 text-center mt-2 break-words">
                                                            {block.kind === 'collect'
                                                                ? 'Collect the batch inventory before starting.'
                                                                : block.kind === 'ack'
                                                                    ? `Waiting on the incharge to acknowledge ${block.count} collected item${block.count === 1 ? '' : 's'}.`
                                                                    : `Finish ${jobLabel(block.job)} before starting this one.`}
                                                        </p>
                                                    )}
                                                </Card>
                                            );
                                        })}
                                        </div>
                                    )}

                                    {/* Undoing a whole batch is a rare, destructive
                                        act, so it sits below the work rather than
                                        beside the buttons the floor presses daily. */}
                                    <div className="mt-6 pt-4 border-t border-slate-200 flex justify-center">
                                        <button
                                            onClick={() => openDeleteBatch(selectedBatch)}
                                            className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-400 hover:text-rose-600 transition-colors"
                                        >
                                            <Trash2 size={14} /> Delete this batch
                                        </button>
                                    </div>
                                </>
                            )}

                            {/* ---------- LEVEL 3: JOB DETAIL + SUB-ORDERS ---------- */}
                            {level === 'job' && selectedJob && (
                                <JobDetail
                                    key={selectedJob.id}
                                    job={selectedJob}
                                    onViewForm={viewOrderForm}
                                    startBlock={startBlocker({ batch: selectedBatch, job: selectedJob, runningJob })}
                                    updating={updatingJobId === selectedJob.id}
                                    onStart={() => markStarted(selectedJob, selectedBatch)}
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
// What the batch has taken out of the godown and is now sitting on the floor.
// Shown only once collection is marked: it is a custody list, so the crew can see
// at a glance what is in their hands and put every piece of it back.
const CollectedItems = ({ batch }) => {
    const [openKey, setOpenKey] = useState(null);
    // Only the raw stock. Ready-made items went bags-godown to printing area in
    // one move -- they were never on the production floor and never come back, so
    // listing them here would put the crew on the hook for stock they do not hold.
    const items = batch.jobs.flatMap((job) =>
        splitStock(job.invItemOptions).raw.map((item) => ({ key: `${job.id}:${item.id}`, job, item }))
    );
    if (items.length === 0) return null;

    // The whole story of one item, for the tooltip and the tapped-open caption.
    const metaFor = ({ job, item }) => [
        item.itemId,
        attrText({ mat: item.material, col: item.colour, gsm: item.gsm, w: item.w, h: item.h }),
        (item.collectedKg ?? item.kg) != null ? `${num(item.collectedKg ?? item.kg).toFixed(2)} kg` : null,
        `from ${godownOf(item)}`,
        jobLabel(job)
    ].filter(Boolean).join(' · ');

    const open = items.find((i) => i.key === openKey);

    return (
        <div className="mt-3 pt-3 border-t border-slate-100">
            <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                On the floor · {items.length} item{items.length === 1 ? '' : 's'}
            </p>
            <div className="flex flex-wrap gap-2">
                {items.map((entry) => {
                    const on = entry.key === openKey;
                    return (
                        <button
                            key={entry.key}
                            type="button"
                            title={metaFor(entry)}
                            onClick={() => setOpenKey(on ? null : entry.key)}
                            className={`flex flex-col items-center gap-0.5 p-1.5 rounded-lg border transition-colors ${on ? 'border-teal-300 bg-teal-50' : 'border-slate-200 bg-white hover:bg-slate-50'
                                }`}
                        >
                            <span style={{ width: 44 }}>
                                <ItemVisual colour={entry.item.colour} type={entry.item.type} name={entry.item.code} size="sm" />
                            </span>
                            <span className="text-[9px] font-mono text-slate-400 max-w-[72px] truncate">
                                {entry.item.itemId}
                            </span>
                        </button>
                    );
                })}
            </div>
            {/* A title attribute is nothing on a touchscreen, so tapping says the
                same thing in place. */}
            {open && (
                <p className="mt-2 text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-1.5 break-words">
                    {metaFor(open)}
                </p>
            )}
        </div>
    );
};

const BatchInventory = ({ batch, updating, onCollect, onCollectFinished, onReturn }) => {
    const collectedAt = formatDateTime(batch.invCollectedAt);
    const returnedAt = formatDateTime(batch.invReturnedAt);
    const allJobsCompleted = batch.jobs.length > 0 && batch.jobs.every((job) => job.completed);
    const finishedItems = batch.jobs.flatMap((job) => splitStock(job.invItemOptions).finished);
    const finishedAt = formatDateTime(batch.finCollectedAt);
    // The two trips are to different godowns and are made by different people, in
    // whichever order the floor manages. Neither waits on the other.
    //
    // Nothing is lost by letting them run independently: a job still cannot START
    // until every item assigned to it has an acknowledged collection, finished
    // stock included -- see startBlocker. That gate is where the real protection
    // is, and it does not care which trip was made first.

    return (
        <Card className="p-4 mb-3">
            <h2 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Package size={14} /> Batch Inventory
            </h2>

            <div className="space-y-3">
                {finishedItems.length > 0 && (
                    <InventoryAction
                        label={`Finished stock collected (${finishedItems.length})`}
                        hint="Straight from the bags godown to the printing area"
                        done={batch.finCollected}
                        at={finishedAt}
                        actionLabel="Mark Collected"
                        doneLabel="Collected"
                        updating={updating}
                        onClick={onCollectFinished}
                    />
                )}
                <InventoryAction
                    label="Raw roll collected"
                    hint="From the rolls godown"
                    done={batch.invCollected}
                    at={collectedAt}
                    actionLabel="Mark Collected"
                    doneLabel="Collected"
                    updating={updating}
                    onClick={onCollect}
                />
                <InventoryAction
                    label="Remaining roll returned"
                    done={batch.invReturned}
                    at={returnedAt}
                    actionLabel="Mark Returned"
                    doneLabel="Returned"
                    updating={updating}
                    disabled={!allJobsCompleted}
                    onClick={onReturn}
                />
            </div>

            {batch.invCollected && !batch.invReturned && <CollectedItems batch={batch} />}
        </Card>
    );
};

const InventoryAction = ({ label, hint, done, at, actionLabel, doneLabel, updating, disabled = false, onClick }) => (
    <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
            <p className="text-sm font-medium text-slate-700">{label}</p>
            {hint && !done && <p className="text-[11px] text-slate-400">{hint}</p>}
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

// One side of a batch's flow. The items are stacked like a hand of cards rather
// than laid out side by side: five colours in a row wrapped onto a second line
// and pushed the numbers off the card, and the operator only needs to see at a
// glance which colours are in play, not study each one.
const STACK_MAX = 5;
const STACK_OVERLAP = 0.52;      // fraction of a cell hidden behind the next

const FlowRow = ({ items, label, cellW, size }) => {
    const shown = items.slice(0, STACK_MAX);
    return (
        <div className="flex flex-col items-center min-w-0">
            <div className="flex items-end">
                {shown.map((e, i) => (
                    <div
                        key={`${e.type}-${e.colour}-${i}`}
                        className="relative shrink-0"
                        style={{
                            width: cellW,
                            marginLeft: i === 0 ? 0 : -cellW * STACK_OVERLAP,
                            // Earlier items sit in front, so the stack reads
                            // left-to-right like a fanned deck.
                            zIndex: shown.length - i,
                            // A white halo keeps two adjacent shapes legible where
                            // they overlap, without drawing a border on the artwork.
                            filter: 'drop-shadow(0 0 1.5px white) drop-shadow(0 0 1.5px white)'
                        }}
                    >
                        <ItemVisual colour={e.colour} type={e.type} name={e.name} size={size} />
                    </div>
                ))}
                {items.length > STACK_MAX && (
                    <span className="relative z-0 ml-1 text-[11px] font-semibold text-slate-400 self-center">
                        +{items.length - STACK_MAX}
                    </span>
                )}
            </div>
            <span className="text-[11px] font-medium text-slate-500 mt-0.5 whitespace-nowrap">{label}</span>
        </div>
    );
};

// A batch runs several jobs, each on its own roll and often in its own colour.
// Showing only the first job's colour told the operator the batch was red when
// half of it is white — so every distinct raw and every distinct output appears,
// deduplicated on what actually differs: the item type and its colour.
const BatchFlow = ({ batch, size = 'sm' }) => {
    const { inRaw } = splitJobType(batch.type);
    const inForm = itemForm(inRaw);
    const cellW = size === 'sm' ? 56 : 80;

    const uniq = (entries) => {
        const map = new Map();
        for (const e of entries) {
            const key = `${e.type}|${String(e.colour || '').trim().toUpperCase()}`;
            if (!map.has(key)) map.set(key, e);
        }
        return [...map.values()];
    };

    // Ready-made stock is not raw material — it is the finished article, pulled
    // off a shelf. Drawing it here labelled "Raw" said the batch cuts something it
    // does not, so it gets its own group.
    const raws = uniq((batch.jobs || []).flatMap((job) => {
        const { raw } = splitStock(job.invItemOptions);
        return raw.length > 0
            ? raw.map((it) => ({ type: inRaw, colour: it.colour, name: it.code }))
            : (job.invItemOptions || []).length === 0 ? [{ type: inRaw, colour: job.colour, name: job.itemName }] : [];
    }));
    const ready = uniq((batch.jobs || []).flatMap((job) =>
        splitStock(job.invItemOptions).finished.map((it) => ({ type: it.type, colour: it.colour, name: it.code }))
    ));

    const outs = uniq((batch.jobs || []).flatMap((job) =>
        jobOutputs(job).flatMap((out) => {
            const subs = job.subOrders || [];
            return subs.length > 0
                ? subs.map((so) => ({ type: out, colour: outputColour((job.type || '').trim().toUpperCase(), planShape(so)) }))
                : [{ type: out, colour: job.colour }];
        })
    ));

    return (
        <div className="flex items-center justify-center gap-2 min-w-0 flex-wrap">
            {raws.length > 0 && (
                <FlowRow items={raws} label={`Raw · ${FORM_LABEL[inForm]}`} cellW={cellW} size={size} />
            )}
            {ready.length > 0 && (
                <FlowRow
                    items={ready}
                    label={`Ready · ${[...new Set(ready.map((r) => FORM_LABEL[itemForm(r.type)] || r.type))].join(' / ')}`}
                    cellW={cellW}
                    size={size}
                />
            )}
            {outs.length > 0 && (raws.length > 0 || ready.length > 0) && (
                <ArrowRight size={size === 'sm' ? 16 : 22} className="text-slate-300 shrink-0" />
            )}
            {outs.length > 0 && (
                <FlowRow
                    items={outs}
                    label={`Output · ${[...new Set(outs.map((o) => FORM_LABEL[itemForm(o.type)]))].join(' / ')}`}
                    cellW={cellW}
                    size={size}
                />
            )}
        </div>
    );
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

// How long a job has been running, in the units the floor thinks in.
const elapsedText = (fromEpoch, toEpoch) => {
    const start = num(fromEpoch);
    if (!start) return null;
    const mins = Math.max(0, Math.round((num(toEpoch) || Date.now() / 1000) - start) / 60);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${Math.round(mins)}m`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ${Math.round(mins % 60)}m`;
    return `${Math.floor(hrs / 24)}d ${hrs % 24}h`;
};

// One headline figure per job, in the unit that job is counted in: pressing
// handles come off the roll as pieces, side patty is bundled, sheets are sheets.
// The kg is what leaves the godown, and stays alongside because the roll is
// issued by weight whatever the output is counted in.
const OutputHeadline = ({ totals }) => {
    const { count, kg, unit } = totals;
    return (
        <div className="rounded-xl bg-slate-900 text-white px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">To produce</p>
            <div className="flex items-baseline gap-2 flex-wrap mt-0.5">
                {count > 0 ? (
                    <>
                        <span className="text-2xl font-bold tabular-nums">{count.toLocaleString('en-IN')}</span>
                        <span className="text-sm font-medium text-slate-300">{unit}</span>
                    </>
                ) : (
                    <span className="text-2xl font-bold tabular-nums">{fmtKg(kg)} kg</span>
                )}
                {count > 0 && kg > 0 && <span className="text-sm text-slate-400">≈ {fmtKg(kg)} kg</span>}
            </div>
            {(!totals.exact || totals.unknown > 0) && (
                <p className="text-[10px] text-amber-300/90 mt-1">
                    {totals.unknown > 0
                        ? `${totals.unknown} sub-order(s) could not be counted`
                        : 'Approximate — backed out of weight-quoted orders'}
                </p>
            )}
        </div>
    );
};

// What the job draws on, split by where it comes from. A job can be part raw
// roll and part ready-made stock off the shelf, and those are different errands:
// one gets cut, the other gets carried. The item's own code says which it is, so
// no extra column is needed to tell them apart.
const StockGroup = ({ title, items, tone }) => {
    if (items.length === 0) return null;
    return (
        <div>
            <p className={`text-[10px] font-semibold uppercase tracking-wider mb-1.5 ${tone}`}>{title}</p>
            <div className="space-y-1.5">
                {items.map((item) => (
                    <div key={item.id} className="flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-1.5">
                        <span className="w-9 shrink-0">
                            <ItemVisual colour={item.colour} type={item.type} name={item.code} size="sm" />
                        </span>
                        <span className="min-w-0 flex-1">
                            <span className="block font-mono text-[11px] font-semibold text-slate-800 break-all">{item.itemId}</span>
                            <span className="block text-[10px] text-slate-500 break-words">
                                {attrText({ mat: item.material, col: item.colour, gsm: item.gsm, w: item.w, h: item.h })}
                            </span>
                        </span>
                        {(item.collectedKg != null || item.kg != null) && (
                            <span className="text-right shrink-0">
                                <span className="block text-[11px] font-semibold text-slate-700 tabular-nums">
                                    {fmtKg(item.collectedKg ?? item.kg)} kg
                                </span>
                                <span className="block text-[9px] text-slate-400">
                                    {item.collectedKg != null ? 'collected' : 'on the shelf'}
                                </span>
                            </span>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

const JobStock = ({ job }) => {
    const items = job.invItemOptions || [];
    if (items.length === 0) return null;
    const isRoll = (it) => String(it.type ?? '').trim().toUpperCase() === 'ROLL';
    const rolls = items.filter(isRoll);
    const finished = items.filter((it) => !isRoll(it));
    return (
        <div className="space-y-2.5">
            <StockGroup title={rolls.length === 1 ? 'Roll to cut' : `${rolls.length} rolls to cut`} items={rolls} tone="text-amber-600" />
            <StockGroup
                title={finished.length === 1 ? 'Ready stock to pull' : `${finished.length} ready items to pull`}
                items={finished}
                tone="text-sky-600"
            />
        </div>
    );
};

// A labelled row of tags. Renders nothing at all when the group has no values,
// so a bag-only order does not show three empty headings.
const TagGroup = ({ label, tags }) => {
    const shown = tags.filter((t) => t && t.value !== null && t.value !== undefined && String(t.value).trim() !== '' && String(t.value) !== '—');
    if (shown.length === 0) return null;
    return (
        <div className="flex items-start gap-2 py-1.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 w-[68px] shrink-0 pt-1">{label}</span>
            <span className="flex flex-wrap gap-1 min-w-0">
                {shown.map((t) => (
                    <span
                        key={`${t.key}`}
                        className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-medium ${t.tone === 'size' ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200' : 'bg-slate-100 text-slate-700'}`}
                    >
                        {t.value}
                    </span>
                ))}
            </span>
        </div>
    );
};

// The roll weight this job has taken off the shelf, or null before collection.
// Once collected the item's available weight is 0, so the shelf figure stops
// being the thing the operator is holding.
const collectedKgOf = (job) => {
    // Raw stock only. The job's total LESS also covers ready-made stock pulled
    // straight to the printing area, which was never cut from and must not count
    // towards the roll the run has to account for.
    if (num(job.collectedKg) > 0) return roundWeight(num(job.collectedKg) - num(job.finishedTakenKg));
    const items = splitStock(job.invItemOptions).raw.filter((it) => it.collectedKg != null);
    if (items.length === 0) return null;
    return items.reduce((t, it) => t + num(it.collectedKg), 0);
};

// Book a movement in the unit the godown actually handles that form: sheets and
// patty are counted, rolls and finished bags are weighed. Writing both moves two
// balances for one movement, and writing the wrong one moves neither -- which is
// why bags-godown sheets read 0 kg against a real count.
const quantityFields = ({ type, name, kg, count }) => {
    // A counted form is booked by count even when the count is zero: falling back
    // to a weight there would move a balance the godown does not keep for it.
    if (primaryUnitFor(type, name) === 'count') {
        return count == null ? { Weight_Kg_: roundWeight(kg) } : { Count_Bundles_: num(count) };
    }
    return { Weight_Kg_: roundWeight(kg) };
};

// How one produced output divides between the printing area and the shelf, in
// both units. The modal shows exactly what the writer books, because they are the
// same function -- apportioning it twice is how the counts drifted apart before.
const outputSplit = (o) => {
    const output = num(o.weight);
    const planned = num(o.planned);
    const surplus = o.allToPrinting ? 0 : Math.max(0, output - planned);
    const printingQty = output - surplus;
    const count = num(o.count) / countDivisor(o.outputType, o.unit);
    const share = output > 0 ? printingQty / output : 1;
    // Split the count the way the weight split, then take the remainder as the
    // surplus so the two halves add back to exactly what was produced.
    const printingCount = roundCount(o.outputType, count * share);
    const halves = [
        { location: PRINTING_AREA, kg: printingQty, count: printingCount },
        ...(surplus > 0
            ? [{ location: BAGS_GODOWN, kg: surplus, count: roundCount(o.outputType, count - printingCount) }]
            : [])
    ];
    return halves
        .map((h) => ({ ...h, fields: quantityFields({ type: o.outputType, kg: h.kg, count: h.count }) }))
        // A half that rounds to nothing is not booked at all.
        .filter((h) => num(h.fields.Count_Bundles_) !== 0 || num(h.fields.Weight_Kg_) !== 0);
};

// Sheets are counted one at a time, so their count has to be a whole number. A
// bundle can be a fraction -- a pressing handle is never physically bundled, and
// 8,065 pieces really is 80.65 bundles -- so those keep two decimals.
const roundCount = (type, v) =>
    (SHEET_FORMS.has(itemForm(type)) ? Math.round(num(v)) : Math.round(num(v) * 100) / 100);

// Count_Bundles_ stores the godown's own unit. A count the app planned in pieces
// has to be divided down to that unit before it is stored; a count already in
// sheets or bundles goes in as it is.
const countDivisor = (outputType, unit) => {
    if (String(unit || '').trim().toLowerCase() !== 'pieces') return 1;
    return PIECES_PER_BUNDLE[itemForm(outputType)] || 1;
};

// Which of the candidate item codes an output belongs to.
//
// `dims` are the finished article's own measurements, where the line knows them.
// A code matching those is unambiguously the right one -- a 16x20 sheet is not a
// 16x24 sheet -- so size leads. Bags and patty share one code per specification
// and leave the size fields blank, which means "any"; those fall through to the
// job-level ladder that has always been used.
const pickOutputCode = (rows, job, dims = null) => {
    const same = (a, b) => String(a ?? '').trim().toUpperCase() === String(b ?? '').trim().toUpperCase();
    const dim = (a, b) => num(a) > 0 && num(b) > 0 && Math.abs(num(a) - num(b)) < 1e-6;
    const blank = (v) => !String(v ?? '').trim();
    const f = (r) => r.fields ?? r;
    const ladder = [
        ...(dims ? [
            (r) => same(f(r).GSM, job.gsm) && dim(f(r).Width_Inches_, dims.w) && dim(f(r).Height_Inches_, dims.h),
            (r) => dim(f(r).Width_Inches_, dims.w) && dim(f(r).Height_Inches_, dims.h),
            (r) => same(f(r).GSM, job.gsm) && dim(f(r).Width_Inches_, dims.w) && blank(f(r).Height_Inches_)
        ] : []),
        (r) => same(f(r).GSM, job.gsm) && same(f(r).Width_Inches_, job.width),
        (r) => same(f(r).GSM, job.gsm)
    ];
    for (const test of ladder) {
        const hit = (rows || []).find(test);
        if (hit) return f(hit).id ?? null;
    }
    return f((rows || [])[0] ?? {}).id ?? null;
};

// Why a job cannot be started yet, or null when it can. The stock has to be off
// the shelf before the machine runs, and the machine runs one job at a time.
const startBlocker = ({ batch, job, runningJob }) => {
    if (!batch?.invCollected) return { kind: 'collect' };
    // Collected is the floor's word for it; acknowledged is the godown's. Running
    // on stock the incharge has not signed out leaves the books showing it still
    // on the shelf while it is being cut.
    if (num(job?.collectUnacked) > 0) return { kind: 'ack', count: num(job.collectUnacked) };

    if (runningJob && runningJob.id !== job.id) return { kind: 'running', job: runningJob };
    return null;
};

// Everything about a job that both the batch list and the job page have to agree
// on: how the work splits into lines, what each line produces, and the totals.
// Computed once, here, because the two screens showing different numbers for the
// same job is worse than either number being wrong.
const jobWorkPlan = (job) => {
    const jobType = (job.type || '').trim().toUpperCase();
    // ROLLS TO SHEETS groups by sheet size, side patty by the strip it cuts, DCUT
    // by MODEL + bag size (a DCUT job mixes DCUT and HANDLE bags), handles by
    // sub-order (the strip is identical whatever bag it goes on).
    const sizeDim = SIZE_DIM[jobType] || 'bag';
    const isDcut = jobType === 'ROLLS TO DCUT';
    const cell = (v) => (v === null || v === undefined || v === '' || typeof v === 'object') ? '—' : v;
    // The floor is ticking off what it has cut, so a patty line has to name the
    // strip it produces -- width by the length that wraps the bag -- not just the
    // width the order asked for. Same figure the batch review showed.
    const pattySize = (so) => outputSizeLabel(jobType, planShape(so)).value;
    // The dimensions of the thing this line turns out -- not of the roll it comes
    // from. Used to find the right item code (a 16x20 sheet and a 16x24 sheet are
    // different codes) and to name the stock item where one code covers every size.
    const dimsFor = (so) => {
        if (sizeDim === 'sheet') {
            const m = String(so.sheetSize ?? '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
            return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
        }
        if (sizeDim === 'patty') {
            if (jobType === 'ROLLS TO BOTTOMPATTY SHEETS') {
                const d = bottomSheetDims(planShape(so));
                return d ? { w: num(d.sheetW), h: num(d.sheetH) } : null;
            }
            // A side patty's code is keyed on the strip width; the length that
            // wraps the bag varies by line and lives in the stock item's name.
            const d = pattyDims(planShape(so));
            return d ? { w: num(d.width), h: null } : null;
        }
        // A handle is the same strip whatever bag it goes on, so its lines carry
        // no size of their own.
        if (sizeDim === 'suborder') return null;
        return { w: num(so.bagW), h: num(so.bagH) };
    };
    // A token safe to put in an item id, from the label the operator sees.
    const tagFor = (so) => {
        const d = dimsFor(so);
        if (!d || !d.w) return '';
        return d.h ? `${d.w}X${d.h}` : `${d.w}`;
    };
    const sizeKeyFor = (so) => {
        if (sizeDim === 'suborder') return String(so.id);
        if (sizeDim === 'sheet') return String(cell(so.sheetSize));
        if (sizeDim === 'patty') return pattySize(so);
        const bag = `${cell(so.bagW)}×${cell(so.bagH)}`;
        return isDcut ? `${cell(so.model)} | ${bag}` : bag;
    };
    const sizeLabelFor = (so) => {
        if (sizeDim === 'suborder') return so.shop || `Sub-order #${so.id}`;
        if (sizeDim === 'sheet') return String(cell(so.sheetSize));
        if (sizeDim === 'patty') return pattySize(so);
        const bag = `${cell(so.bagW)}″ × ${cell(so.bagH)}″`;
        return isDcut ? `${cell(so.model)} · ${bag}` : bag;
    };

    // Quantity in the batch's unit: STITCHING piece counts are converted to kg via
    // sheet geometry (reusing the batch-creation rule); pieces/weight pass through.
    // A job is measured with the overage it was planned with, not whatever the
    // config says today. An empty Grist column reads as 0, and a job created
    // before the column existed has nothing in it — neither is a rate the job was
    // planned with, so those fall back to the config. A configured rate of 0
    // lands on the same answer either way.
    const rate = num(job.overage) > 0 ? num(job.overage) : null;
    const soQty = (so) => effectiveQty(jobType, planShape(so), rate);
    const countUnit = OUTPUT_COUNT_UNIT[jobType] || 'pieces';
    const soOutput = (so) => {
        const c = outputCount(jobType, planShape(so), rate);
        return c ? c.count : 0;
    };

    const subOrders = job.subOrders || [];
    // What the operator ticks off, with both figures a line needs: the items to
    // make and the roll weight they come out of. Biggest job first.
    const map = new Map();
    for (const so of subOrders) {
        const key = sizeKeyFor(so);
        if (!map.has(key)) {
            map.set(key, {
                key, label: sizeLabelFor(so), qty: 0, made: 0, count: 0,
                // Constant within a line: DCUT splits DCUT BAG from HANDLE BAG on
                // model, and model is part of the key, so a line never mixes them.
                outputType: outputTypeFor(job.type, planShape(so)),
                dims: dimsFor(so),
                sizeTag: tagFor(so),
                // On a per-sub-order list the label is the shop, so the bag size
                // is what tells two lines apart on the machine.
                chip: sizeDim === 'suborder' && so.bagW && so.bagH ? `${so.bagW}″ × ${so.bagH}″` : null
            });
        }
        const g = map.get(key);
        g.qty += soQty(so);
        g.made += soOutput(so);
        g.count += 1;
    }
    const sizeGroups = [...map.values()].sort((a, b) => b.made - a.made || b.qty - a.qty);

    // The line items follow the tick list exactly: an operator working down one
    // and looking things up in the other should not have to hunt.
    const groupRank = new Map(sizeGroups.map((g, i) => [g.key, i]));
    const orderedSubOrders = [...subOrders].sort((a, b) =>
        (groupRank.get(sizeKeyFor(a)) ?? 0) - (groupRank.get(sizeKeyFor(b)) ?? 0)
        || soOutput(b) - soOutput(a)
        || num(a.id) - num(b.id)
    );

    // The headline is the sum of the very lines beneath it. Counting it separately
    // and rounding once left the two disagreeing by a piece or two, which reads as
    // a bug to whoever is holding the tally sheet.
    const rollup = groupOutputCount(jobType, subOrders.map(planShape), rate);
    const totals = {
        count: sizeGroups.reduce((t, g) => t + (g.made > 0 ? Math.ceil(g.made - 1e-9) : 0), 0),
        kg: sizeGroups.reduce((t, g) => t + g.qty, 0),
        unit: countUnit,
        exact: rollup.exact,
        unknown: rollup.unknown
    };

    return {
        jobType, sizeDim, isDcut, sizeKeyFor, sizeLabelFor, soQty, countUnit, rate,
        sizeGroups, orderedSubOrders, totals,
        // Several sub-orders can belong to one customer order — different bag
        // sizes on the same sheet of paper — so the two counts are not the same
        // thing and must not be labelled as though they were.
        subOrderCount: subOrders.length,
        orderCount: new Set(subOrders.map((so) => so.orderId).filter((v) => v != null)).size,
        sizeTitle: isDcut ? 'Output (model · size)' : SIZE_TITLE[sizeDim],
        // Singular, lower case, for prose: "3 bag sizes", "tick every sheet size".
        sizeNoun: isDcut ? 'variant' : (SIZE_TITLE[sizeDim] || 'Sizes').replace(/s$/, '').toLowerCase()
    };
};

const JobDetail = ({ job, updating, onStart, onComplete, onViewForm, startBlock }) => {
    const startedAt = formatDateTime(job.startedAt);
    const completedAt = formatDateTime(job.completedAt);
    const {
        jobType, sizeDim, sizeKeyFor, soQty, countUnit,
        sizeGroups, orderedSubOrders, totals, sizeTitle, sizeNoun,
        subOrderCount, orderCount
    } = jobWorkPlan(job);

    const [checked, setChecked] = useState({});
    const toggle = (key) => setChecked((prev) => ({ ...prev, [key]: !prev[key] }));
    const total = sizeGroups.length;
    const doneCount = sizeGroups.filter((g) => checked[g.key]).length;
    const allChecked = total === 0 || doneCount === total;

    return (
        <div className="space-y-3">
            {/* Everything the operator needs before touching the machine, in one
                thumb-reachable card: what to make, from what, and where it is up to. */}
            <Card className={`p-3.5 ${job.started && !job.completed ? 'job-running ring-1 ring-blue-200' : ''}`}>
                <div className="flex items-start justify-between gap-2 mb-2">
                    <h3 className="font-bold text-slate-800 text-sm break-words min-w-0 leading-snug">{jobLabel(job)}</h3>
                    <StatusBadge started={job.started} completed={job.completed} />
                </div>

                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-3">
                    {job.started ? (
                        <span className="inline-flex items-center gap-1">
                            <Clock size={12} className="shrink-0" />
                            {job.completed
                                ? `Ran ${elapsedText(job.startedAt, job.completedAt) || '—'}`
                                : `Running ${elapsedText(job.startedAt) || '—'}`}
                        </span>
                    ) : (
                        <span className="inline-flex items-center gap-1"><Clock size={12} /> Not started</span>
                    )}
                    {startedAt && <span>Started {startedAt}</span>}
                    {completedAt && <span>Done {completedAt}</span>}
                </div>

                <div className="mb-3">
                    <JobFlow job={job} size="sm" />
                </div>

                <OutputHeadline totals={totals} />

                <div className="flex flex-wrap gap-1.5 my-3">
                    <Chip>{subOrderCount} sub-order{subOrderCount === 1 ? '' : 's'}</Chip>
                    {orderCount > 0 && <Chip>{orderCount} order{orderCount === 1 ? '' : 's'}</Chip>}
                    {/* On a per-sub-order job the line count IS the sub-order count,
                        so repeating it just prints the same chip twice. */}
                    {sizeDim !== 'suborder' && (
                        <Chip>{sizeGroups.length} {sizeGroups.length === 1 ? sizeNoun : `${sizeNoun}s`}</Chip>
                    )}
                    {num(job.finishedTakenKg) > 0 && <Chip>{fmtKg(job.finishedTakenKg)} kg from stock</Chip>}
                    {job.material && <Chip>{job.material}</Chip>}
                    {job.colour && <Chip>{job.colour}</Chip>}
                    {job.gsm && <Chip>{job.gsm} GSM</Chip>}
                    {job.width && <Chip>{job.width}{job.height ? ` × ${job.height}` : '"'}</Chip>}
                </div>

                <JobStock job={job} />

                {/* Starting is the only action here; finishing belongs with the
                    list the operator ticks off. */}
                {!job.started && (
                    <div className="mt-3 pt-3 border-t border-slate-100">
                        <Button variant="primary" className="w-full py-3 bg-blue-600 hover:bg-blue-700"
                            onClick={onStart} disabled={updating || !!startBlock}
                            icon={updating ? Loader2 : startBlock ? Lock : PlayCircle}>
                            {!startBlock ? 'Mark Started'
                                : startBlock.kind === 'collect' ? 'Inventory not collected'
                                    : startBlock.kind === 'ack' ? 'Awaiting incharge' : 'Another job is running'}
                        </Button>
                        {startBlock && (
                            <p className="text-[11px] text-slate-400 text-center mt-2 break-words">
                                {startBlock.kind === 'collect'
                                    ? 'The stock is still on the godown shelf — mark the batch inventory collected first.'
                                    : startBlock.kind === 'ack'
                                        ? `${startBlock.count} of this job's collected item${startBlock.count === 1 ? ' is' : 's are'} not acknowledged by the incharge yet. Until every one is, the books still show the stock in the godown.`
                                        : `Finish ${jobLabel(startBlock.job)} first — the machine is set up for it.`}
                            </p>
                        )}
                    </div>
                )}
                {job.completed && (
                    <div className="mt-3 pt-3 border-t border-slate-100 flex items-center justify-center gap-2 text-sm font-semibold text-green-700">
                        <CheckCircle2 size={18} /> Job completed
                    </div>
                )}
            </Card>

            {/* The work list: tick each line as it comes off the machine, then
                finish the job from the same card -- the operator should not have
                to scroll back up to a button. */}
            {sizeGroups.length > 0 && (
                <Card className="p-3.5">
                    <h2 className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                        <Layers size={14} /> {sizeTitle}
                        <span className="ml-auto font-normal text-slate-400 normal-case tracking-normal">{doneCount}/{total} done</span>
                    </h2>
                    <div className="divide-y divide-slate-100">
                        {sizeGroups.map((g) => {
                            const on = !!checked[g.key];
                            const made = g.made > 0 ? Math.ceil(g.made - 1e-9) : null;
                            return (
                                <label key={g.key} className="flex items-center gap-3 py-3 cursor-pointer select-none">
                                    <input
                                        type="checkbox"
                                        checked={on}
                                        onChange={() => toggle(g.key)}
                                        disabled={job.completed}
                                        className="w-6 h-6 rounded border-slate-300 text-green-600 focus:ring-green-500 shrink-0"
                                    />
                                    <span className="min-w-0 flex-1">
                                        <span className="flex items-start gap-2">
                                            <span className={`font-semibold text-sm break-words min-w-0 flex-1 ${on ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                                                {g.label}
                                            </span>
                                            {g.chip && (
                                                <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                                                    {g.chip}
                                                </span>
                                            )}
                                        </span>
                                        <span className="block text-[11px] text-slate-500">
                                            {[
                                                made != null ? `${made.toLocaleString('en-IN')} ${countUnit}` : null,
                                                `${fmtKg(g.qty)} kg`,
                                                sizeDim === 'suborder' ? null : `${g.count} sub-order${g.count !== 1 ? 's' : ''}`
                                            ].filter(Boolean).join(' · ')}
                                        </span>
                                    </span>
                                </label>
                            );
                        })}
                    </div>

                    {job.started && !job.completed && (
                        <div className="mt-3 pt-3 border-t border-slate-100">
                            <Button variant="primary" className="w-full py-3"
                                onClick={onComplete} disabled={updating || !allChecked} icon={updating ? Loader2 : CheckCircle2}>
                                Mark Completed
                            </Button>
                            {!allChecked && (
                                <p className="text-[11px] text-amber-600 text-center mt-2">
                                    Tick every {sizeNoun} to finish ({doneCount}/{total} done)
                                </p>
                            )}
                        </div>
                    )}
                    {!job.started && (
                        <p className="text-[11px] text-slate-400 text-center mt-3 pt-3 border-t border-slate-100">
                            Start the job to tick these off.
                        </p>
                    )}
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
                        {orderedSubOrders.map((so) => {
                            const shaped = planShape(so);
                            const outputType = outputTypeFor(job.type, shaped);
                            const outForm = itemForm(outputType);
                            const counted = outputCount(jobType, shaped);
                            const madeCount = counted ? Math.ceil(counted.count - 1e-9) : null;
                            const convKg = soQty(so);
                            const ordered = orderedText(so);
                            // The gusset this bag needs, sized the way the floor cuts
                            // it — the order only carries the strip width.
                            const patty = pattyDims(shaped);
                            const bottom = bottomSheetDims(shaped);
                            // "2″ × 14.5″" -> two pills; anything else stays whole.
                            const outSize = outputSizeLabel(jobType, shaped);
                            const outDims = /^\s*[\d.]+″\s*×\s*[\d.]+″\s*$/.test(outSize.value)
                                ? outSize.value.split('×').map((v) => v.trim())
                                : [];
                            return (
                            <Card key={so.id} className={`p-3.5 ${checked[sizeKeyFor(so)] ? 'ring-1 ring-green-300 bg-green-50/40' : ''}`}>
                                <div className="flex items-start justify-between gap-2 mb-2.5">
                                    <h4 className="font-semibold text-slate-800 text-sm break-words min-w-0 flex-1 leading-snug">
                                        {so.shop || `Sub-order #${so.id}`}
                                    </h4>
                                    {/* The bag this line is for. Never the tick-list
                                        label — on a handle job that is the shop name,
                                        and printing it twice wrecked the layout. */}
                                    {so.bagW && so.bagH && (
                                        <span className="shrink-0 inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-600 whitespace-nowrap">
                                            {so.bagW}″ × {so.bagH}″
                                        </span>
                                    )}
                                </div>

                                {/* What this line turns into, at the size it is made */}
                                <div className="flex items-center gap-3 mb-2.5 pb-2.5 border-b border-slate-100">
                                    <div className="w-14 shrink-0">
                                        {/* A handle is the handle's colour, not the
                                            bag's -- a RED handle on a WHITE bag was
                                            being drawn white. */}
                                        <ItemVisual colour={outputColour(jobType, shaped) || job.colour} type={outputType} size="md" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-[11px] font-semibold text-slate-600">Output: {FORM_LABEL[outForm]}</p>
                                        <div className="flex flex-wrap gap-1.5 mt-1">
                                            {/* The size of the thing being made. For a
                                                handle that is the strip, not the bag it
                                                will be sewn onto. */}
                                            {outDims.length > 0
                                                ? outDims.map((d) => <Dim key={d}>{d}</Dim>)
                                                : <Dim>{outSize.value}</Dim>}
                                        </div>
                                        <p className="text-[11px] text-slate-500 mt-1.5">
                                            {[
                                                ordered,
                                                madeCount != null ? `${madeCount.toLocaleString('en-IN')} ${countUnit}` : null,
                                                `${fmtKg(convKg)} kg`
                                            ].filter(Boolean).join(' · ')}
                                        </p>
                                    </div>
                                </div>

                                {/* Specification, grouped the way the floor reads it */}
                                <div className="divide-y divide-slate-50">
                                    <TagGroup label="Bag" tags={[
                                        { key: 'size', value: so.bagW && so.bagH ? `${so.bagW}″ × ${so.bagH}″` : null },
                                        { key: 'gsm', value: so.bagGsm && `${so.bagGsm} GSM` },
                                        { key: 'col', value: choiceText(so.bagColour) },
                                        { key: 'mat', value: so.rollMaterial },
                                        { key: 'print', value: so.print },
                                        { key: 'sheet', value: so.sheetSize && `sheet ${so.sheetSize}` }
                                    ]} />
                                    <TagGroup label="Side patty" tags={patty?.kind === 'SIDEPATTY' ? [
                                        { key: 'size', value: `${patty.width}″ × ${patty.length}″` },
                                        { key: 'gsm', value: patty.gsm && `${patty.gsm} GSM` },
                                        { key: 'col', value: so.sidepattyColour }
                                    ] : [
                                        { key: 'w', value: so.sidepattyWidth && `${so.sidepattyWidth}″ wide` },
                                        { key: 'gsm', value: so.sidepattyGsm && `${so.sidepattyGsm} GSM` },
                                        { key: 'col', value: so.sidepattyColour }
                                    ]} />
                                    <TagGroup label="Bottom patty" tags={patty?.kind === 'BOTTOMPATTY' ? [
                                        { key: 'size', value: `${patty.width}″ × ${patty.length}″` },
                                        { key: 'gsm', value: patty.gsm && `${patty.gsm} GSM` },
                                        { key: 'col', value: so.handleColour },
                                        { key: 'sheet', value: bottom && `from ${bottom.sheetW}″ × ${bottom.sheetH}″ · ${bottom.piecesPerSheet}/sheet` }
                                    ] : []} />
                                    <TagGroup label="Handle" tags={[
                                        { key: 'col', value: so.handleColour }
                                    ]} />
                                </div>

                                <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
                                    <span className="text-[10px] text-slate-400 min-w-0 break-words">
                                        {so.orderId != null ? `Order #${so.orderId} · ` : ''}
                                        Ordered {formatDate(so.orderFormDate)} · Factory {formatDate(so.factoryUpdatedDate)}
                                        {so.areaGroup ? ` · ${so.areaGroup}` : ''}
                                    </span>
                                    {parseAttachmentId(so.orderForm) != null && onViewForm && (
                                        <button
                                            onClick={() => onViewForm(so.orderForm)}
                                            className="shrink-0 inline-flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold text-indigo-700 bg-indigo-50 hover:bg-indigo-100"
                                        >
                                            <FileText size={13} /> Order Form
                                        </button>
                                    )}
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
// A roll the job drew on, with enough of it drawn and spelled out that the
// operator can check the roll in their hands is the one on the screen before
// booking weight against it.
const RollRow = ({ item, value, onChange, children }) => (
    <div className="rounded-lg border border-slate-200 p-2.5">
        <div className="flex items-center gap-2.5">
            <span className="w-10 shrink-0">
                <ItemVisual colour={item.colour} type={item.type} name={item.code} size="sm" />
            </span>
            <span className="min-w-0 flex-1">
                <span className="block font-mono text-[11px] font-semibold text-slate-800 break-all">{item.itemId}</span>
                <span className="block text-[10px] text-slate-500 break-words">
                    {attrText({ mat: item.material, col: item.colour, gsm: item.gsm, w: item.w, h: item.h })}
                </span>
            </span>
            {onChange && (
                <input
                    type="number" inputMode="decimal" min="0" step="any" value={value}
                    onChange={(e) => onChange(e.target.value)}
                    placeholder="Kg"
                    className="w-24 shrink-0 px-2.5 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm text-right"
                />
            )}
        </div>
        {children}
    </div>
);

const OutputModal = ({ job, updating, onClose, onSubmit }) => {
    const { jobType, countUnit, soQty, sizeGroups, sizeTitle, sizeNoun } = jobWorkPlan(job);
    // A pressing handle is pressed straight onto the bag, so it is never shelved:
    // everything produced belongs to the run, with no surplus to the bags godown.
    // It is counted and entered like any other output.
    const neverStocked = jobType === 'ROLLS TO PRESSING HANDLES';

    // How much of the requirement still has to be PRODUCED, rather than having
    // been pulled ready-made off the shelf. Taken from the ready stock the job
    // actually drew (a LESS against a non-roll item), which is more truthful than
    // the plan: pull less than planned and you have to make more.
    const requiredKg = (job.subOrders || []).reduce((t, so) => t + soQty(so), 0);
    const outRatio = requiredKg > 0
        ? Math.max(requiredKg - num(job.finishedTakenKg), 0) / requiredKg
        : 1;
    // One line per size, exactly the lines the job page ticks off. A job that cuts
    // three sheet sizes made three different articles, and a single total for all
    // of them cannot say how many of each -- so each size is entered on its own and
    // is booked on its own.
    const outputs = sizeGroups.map((g) => {
        const planned = roundWeight(num(g.qty) * outRatio);
        const plannedCount = Math.ceil(num(g.made) * outRatio - 1e-9);
        return {
            key: g.key,
            label: g.label,
            chip: g.chip,
            outputType: g.outputType,
            dims: g.dims,
            sizeTag: g.sizeTag,
            colour: g.colour,
            required: roundWeight(num(g.qty)),
            planned,
            plannedCount,
            // The operator counts items; the godown books kg. One item's share of
            // the planned weight converts between the two.
            kgPerItem: plannedCount > 0 ? planned / plannedCount : 0
        };
    });

    // Only raw stock can be left over. Ready-made items were pulled to the
    // printing area to be used, not cut from -- offering them here invited the
    // operator to hand back side patty that never was a roll.
    const rollOptions = job.invItemOptions?.length
        ? splitStock(job.invItemOptions).raw
        : (job.invItems || []).map((id) => ({ id, itemId: `Item #${id}` }));
    const hasRoll = rollOptions.length > 0;
    // A job whose whole requirement was met from ready stock has no roll to cut
    // and nothing to make: the finished-stock collection already moved the goods
    // to the printing area, so completing it is just recording that it is done.
    const nothingToProduce = !hasRoll;
    // Once collection is booked the shelf figure is 0; what the job actually holds
    // is what it took out.
    const heldKg = collectedKgOf(job) ?? 0;

    const [counts, setCounts] = useState({});
    const [returnRoll, setReturnRoll] = useState(false);
    const [returns, setReturns] = useState({});      // item id -> kg string
    const [wastageAccepted, setWastageAccepted] = useState(false);
    const [err, setErr] = useState('');

    const touched = () => { setWastageAccepted(false); setErr(''); };

    // A bag is held in kg, so a bag job is entered in kg -- asking for a count and
    // converting would put a derived figure into the books where the real one was
    // already on the scale. Counted forms stay as counts.
    const byWeight = (o) => primaryUnitFor(o.outputType) === 'kg';
    const entered = (o) => Number(counts[o.key]) || 0;
    const outputKg = (o) => (byWeight(o) ? entered(o) : entered(o) * o.kgPerItem);
    const outputCountOf = (o) => (byWeight(o) ? 0 : entered(o));
    const totalOut = roundWeight(outputs.reduce((s, o) => s + outputKg(o), 0));
    const returnedRows = rollOptions
        .map((item) => ({ itemId: item.id, weight: Number(returns[item.id]) || 0 }))
        .filter((row) => row.weight > 0);
    const totalReturned = returnRoll ? roundWeight(returnedRows.reduce((s, r) => s + r.weight, 0)) : 0;
    // Whatever did not come back was consumed by the run.
    // Wastage is worked out here, from what the job took out against what it
    // produced and handed back. The operator agrees the figure rather than typing
    // one, and that agreement is what gates completion.
    const wastageKg = roundWeight(heldKg - totalOut - totalReturned);
    const overReturned = totalReturned > heldKg + 1e-6;

    const valid = !updating && !overReturned && (nothingToProduce
        || (totalOut > 0 && wastageKg >= 0 && (wastageKg === 0 || wastageAccepted)));

    const submit = async () => {
        setErr('');
        if (overReturned) {
            setErr('More roll is being returned than this job took out.');
            return;
        }
        if (!nothingToProduce && wastageKg < 0) {
            setErr('Output plus returned roll cannot exceed the roll this job took out.');
            return;
        }
        if (!nothingToProduce && wastageKg > 0 && !wastageAccepted) {
            setErr('Agree the wastage figure before completing the job.');
            return;
        }
        try {
            await onSubmit({
                outputs: nothingToProduce ? [] : outputs
                    // A size nobody made is not booked at all.
                    .filter((o) => outputKg(o) > 0 || outputCountOf(o) > 0)
                    .map((o) => ({
                        outputType: o.outputType,
                        planned: o.planned,
                        count: outputCountOf(o),
                        unit: countUnit,
                        weight: roundWeight(outputKg(o)),
                        allToPrinting: neverStocked,
                        // What was made, so the booking can find the right item
                        // code and name the stock item by its size.
                        sizeTag: o.sizeTag,
                        sizeLabel: o.label,
                        dims: o.dims
                    })),
                remainingRolls: returnRoll ? returnedRows : [],
                wastageKg
            });
        } catch (e) {
            setErr(e.message || String(e) || 'Failed to complete job.');
        }
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800 break-words text-sm leading-snug">Complete {jobLabel(job)}</h2>
                        <p className="text-xs text-slate-500">
                            {nothingToProduce
                                ? 'Nothing to make — the stock came ready'
                                : outputs.length > 1
                                    ? `Record what was produced — one figure per ${sizeNoun}`
                                    : 'Record produced output'}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="p-4 space-y-3 overflow-auto">
                    {err && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start text-sm">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="break-words">{err}</p>
                        </div>
                    )}

                    {nothingToProduce && (
                        <div className="rounded-lg border border-sky-200 bg-sky-50 p-3 flex items-center gap-3">
                            <span className="w-11 shrink-0">
                                <ItemVisual colour={outputs[0]?.colour || job.colour} type={outputs[0]?.outputType} size="md" />
                            </span>
                            <p className="text-xs text-sky-900">
                                This job&apos;s whole requirement was met from ready stock, which already moved to
                                the printing area. There is no roll to cut and nothing to count — completing it
                                just records that it is done.
                            </p>
                        </div>
                    )}

                    {!nothingToProduce && outputs.map((o) => {
                        const inKg = byWeight(o);
                        const typed = entered(o);
                        const kg = outputKg(o);
                        const split = outputSplit({
                            outputType: o.outputType, unit: countUnit, planned: o.planned,
                            count: outputCountOf(o), weight: kg, allToPrinting: neverStocked
                        });
                        // What the godown will call these: sheets one at a time,
                        // everything else in bundles.
                        const bookedUnit = countUnitFor(o.outputType);
                        return (
                            <div key={o.key} className="rounded-lg border border-slate-200 p-3">
                                <div className="flex items-center gap-2.5 mb-2">
                                    <span className="w-10 shrink-0">
                                        <ItemVisual colour={o.colour || job.colour} type={o.outputType} size="sm" />
                                    </span>
                                    <span className="min-w-0 flex-1">
                                        <span className="block text-sm font-semibold text-slate-800 break-words">{o.label}</span>
                                        <span className="flex flex-wrap items-center gap-1.5 mb-0.5">
                                            <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-600">
                                                {o.outputType}
                                            </span>
                                            {o.chip && (
                                                <span className="inline-block px-1.5 py-0.5 rounded bg-slate-100 text-[10px] font-medium text-slate-600">
                                                    {o.chip}
                                                </span>
                                            )}
                                        </span>
                                        <span className="block text-[11px] text-slate-400">
                                            {inKg || !(o.plannedCount > 0)
                                                ? `${fmtKg(o.planned)} kg to produce`
                                                : `${o.plannedCount.toLocaleString('en-IN')} ${countUnit} to produce`}
                                            {o.planned < o.required && <span className="text-sky-600"> · {fmtKg(o.required - o.planned)} kg from stock</span>}
                                        </span>
                                    </span>
                                </div>
                                <div className="relative">
                                    <input
                                        type="number" inputMode="numeric" min="0" step="any"
                                        value={counts[o.key] ?? ''}
                                        onChange={(e) => { touched(); setCounts((c) => ({ ...c, [o.key]: e.target.value })); }}
                                        placeholder={inKg ? 'Produced kg' : `Produced ${countUnit}`}
                                        className="w-full px-3 py-2 pr-20 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none"
                                    />
                                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-slate-400">{inKg ? 'kg' : countUnit}</span>
                                </div>
                                {typed > 0 && (
                                    <>
                                        <p className="text-[11px] text-slate-500 mt-1.5">
                                            {inKg
                                                ? (o.kgPerItem > 0 && (
                                                    <>≈ <span className="font-semibold text-slate-700">
                                                        {Math.round(kg / o.kgPerItem).toLocaleString('en-IN')} {countUnit}
                                                    </span></>
                                                ))
                                                : (<>≈ <span className="font-semibold text-slate-700">{fmtKg(kg)} kg</span> of roll
                                                    {countDivisor(o.outputType, countUnit) > 1 && (
                                                        <> · booked as <span className="font-semibold text-slate-700">
                                                            {(outputCountOf(o) / countDivisor(o.outputType, countUnit)).toFixed(2)} bundles
                                                        </span></>
                                                    )}</>)}
                                        </p>
                                        {/* Exactly the lines that will be written, in
                                            the unit each is stored in. */}
                                        <div className="mt-1.5 space-y-0.5">
                                            {split.map((half) => (
                                                <div key={half.location} className="flex justify-between gap-3 text-[11px]">
                                                    <span className="text-slate-500">→ {half.location}</span>
                                                    <span className="font-semibold text-slate-700 tabular-nums">
                                                        {half.fields.Count_Bundles_ != null
                                                            ? `${num(half.fields.Count_Bundles_).toLocaleString('en-IN')} ${bookedUnit}`
                                                            : `${fmtKg(half.fields.Weight_Kg_)} kg`}
                                                        <span className="font-normal text-slate-400"> · {fmtKg(half.kg)} kg</span>
                                                    </span>
                                                </div>
                                            ))}
                                        </div>
                                    </>
                                )}
                            </div>
                        );
                    })}

                    {hasRoll && (
                        <div className="rounded-lg border border-slate-200 p-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none mb-2.5">
                                <input type="checkbox" checked={returnRoll}
                                    onChange={(e) => { touched(); setReturnRoll(e.target.checked); }}
                                    className="w-4 h-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500" />
                                <span className="text-sm font-medium text-slate-700">Roll left over — back to Rolls Godown</span>
                            </label>
                            {returnRoll && (
                                <div className="space-y-2">
                                    {/* One row per roll the job took out: there is
                                        nothing else it could legitimately return, and
                                        picking from a dropdown of ids invited the
                                        wrong roll being credited. */}
                                    {rollOptions.map((item) => (
                                        <RollRow
                                            key={item.id}
                                            item={item}
                                            value={returns[item.id] ?? ''}
                                            onChange={(v) => { touched(); setReturns((r) => ({ ...r, [item.id]: v })); }}
                                        >
                                            {item.collectedKg != null && (
                                                <p className="text-[10px] text-slate-400 mt-1.5 pl-[3.25rem]">
                                                    {fmtKg(item.collectedKg)} kg taken out
                                                    {Number(returns[item.id]) > 0 && (
                                                        <span className="text-slate-500"> · {fmtKg(Math.max(num(item.collectedKg) - Number(returns[item.id]), 0))} kg used</span>
                                                    )}
                                                </p>
                                            )}
                                        </RollRow>
                                    ))}
                                    <p className="text-[10px] text-slate-400">
                                        Booked back to the godown now — the incharge acknowledges it when the
                                        roll reaches them.
                                    </p>
                                </div>
                            )}
                        </div>
                    )}

                    {!nothingToProduce && outputs.length > 1 && (
                        <div className="flex justify-between items-baseline rounded-lg bg-slate-100 px-3 py-2 text-xs">
                            <span className="text-slate-500">
                                {outputs.filter((o) => entered(o) > 0).length} of {outputs.length} {sizeTitle.toLowerCase()} entered
                            </span>
                            <span className="font-bold text-slate-800 tabular-nums">{fmtKg(totalOut)} kg in all</span>
                        </div>
                    )}

                    {/* Where the roll went */}
                    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3 text-xs space-y-1">
                        <div className="flex justify-between">
                            <span className="text-slate-500">{nothingToProduce ? 'Pulled from ready stock' : 'Roll taken out'}</span>
                            <span className="font-semibold text-slate-700">
                                {fmtKg(nothingToProduce ? num(job.finishedTakenKg) : heldKg)} kg
                            </span>
                        </div>
                        {!nothingToProduce && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">− Produced output</span>
                                <span className="font-medium text-slate-600">{fmtKg(totalOut)} kg</span>
                            </div>
                        )}
                        {returnRoll && (
                            <div className="flex justify-between">
                                <span className="text-slate-500">− Returned roll</span>
                                <span className="font-medium text-slate-600">{fmtKg(totalReturned)} kg</span>
                            </div>
                        )}
                        {!nothingToProduce && (
                        <div className="flex justify-between border-t border-slate-200 pt-1">
                            <span className="text-slate-500">= Wastage</span>
                            <span className={`font-bold ${wastageKg < 0 ? 'text-red-600' : 'text-slate-800'}`}>
                                {fmtKg(wastageKg)} kg
                            </span>
                        </div>
                        )}
                    </div>

                    {overReturned && (
                        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                            More roll is being returned than this job took out.
                        </div>
                    )}

                    {!nothingToProduce && wastageKg > 0 && (
                        <label className="flex items-start gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={wastageAccepted}
                                onChange={(e) => setWastageAccepted(e.target.checked)}
                                className="mt-0.5 w-4 h-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500 shrink-0"
                            />
                            <span className="w-9 shrink-0">
                                <ItemVisual colour={job.colour} type={rollOptions[0]?.type || 'ROLL'} name={rollOptions[0]?.code} size="sm" />
                            </span>
                            <span className="text-sm text-amber-900 min-w-0">
                                <span className="font-semibold">{fmtKg(wastageKg)} kg</span> was wasted — what the job
                                took out, less what it produced and handed back. Tick to agree.
                            </span>
                        </label>
                    )}

                    {!nothingToProduce && wastageKg < 0 && (
                        <div className="rounded-lg border border-red-100 bg-red-50 p-3 text-sm text-red-700">
                            Output plus returned roll exceeds the roll this job took out by <span className="font-semibold">{fmtKg(Math.abs(wastageKg))} kg</span>.
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
