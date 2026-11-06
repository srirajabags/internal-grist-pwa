// Running printing: what is waiting, how a batch is made, and what a job and its
// plates write when the work is done.
//
// Three levels (user, 5 Nov 2026):
//
//   batch    one machine type on one day
//   job      one ink set on that machine -- the setup the operator dresses once,
//            started and completed as one, with one wastage figure
//   output   one shop's orders within the job, like production's output groups,
//            each with its own printed count and weights
//
// The order of a batch on the floor:
//
//   1. made        from the queue
//   2. plates out  the plates incharge collects them off the racks (pick list)
//   3. jobs        each ink set started, then completed with every shop's output
//   4. plates back every plate returned to its slot, or retired
//
// A job cannot start before its plates are out -- there is nothing to print
// with -- and plates cannot go back while a job is still running on them.

import {
    isReusable, kindOfOrder, rackFor, STATUS, afterJobAction, actionProblem, plateActionBundle,
    ordersServedBy, PLATES_TABLE, MOVEMENTS_TABLE
} from './printingPlates.js';
import { colourKey } from './printingMachines.js';
import { parseRackCodes } from './rackCodes.js';

export const BATCHES_TABLE = 'Printing_Job_Batches';
export const JOBS_TABLE = 'Printing_Jobs';
export const OUTPUTS_TABLE = 'Printing_Job_Outputs';

// The queue starts at release: production finished before this has, as far as
// the app knows, been printed already, and listing a thousand old orders would
// bury the new ones (user, 1 Nov 2026). Midnight IST, 2 Nov 2026.
export const PRINTING_RELEASED_AT = 1793557800;

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// Reference lists arrive as SQL JSON or the API's ['L', …].
const refList = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== 'L').map(num);
    try { return (JSON.parse(v || '[]') || []).map(num); } catch { return []; }
};

const SUB_ORDER_COLUMNS = `
    so.id AS id, so.Model AS model, so.Print AS print, so.Plate AS plate, so.Material AS material,
    so.Printing_Colour AS printing_colour, so.Plate_Count AS plate_count,
    so.Quantity AS qty, so.Quantity_Type AS qty_type,
    so.Bag_Width AS bag_w, so.Bag_Height AS bag_h, so.Sheet_Size AS sheet_size,
    so.Bag_Colour AS bag_colour, so.Bag_GSM AS bag_gsm,
    so.Reused_Plates AS reused_plates, so.Factory_Updated_Date AS factory_date,
    so.Order_Form_Date AS order_date,
    so.Customer AS customer, c.Shop_Name AS shop, c.City AS city, o.Order_ID AS order_id`;

// Sub-orders a completed production job has cut since release and no printing
// job has taken yet. The completed jobs are few, so they are expanded first and
// joined to, rather than asking a correlated question of every sub-order --
// Grist's /sql gives up at about a second.
export const queueSql = () => `
    WITH done AS (
        SELECT pj.id AS job_id, CAST(je.value AS INTEGER) AS so_id
        FROM Factory_Production_Jobs pj,
             json_each(CASE WHEN json_valid(pj.Sub_Orders) THEN pj.Sub_Orders ELSE '[]' END) je
        WHERE pj.Production_Completed = 1 AND pj.Production_Completed_At >= ${PRINTING_RELEASED_AT}
    ),
    src AS (SELECT so_id, MAX(job_id) AS job_id FROM done GROUP BY so_id),
    taken AS (
        SELECT DISTINCT CAST(je.value AS INTEGER) AS so_id
        FROM ${JOBS_TABLE} j,
             json_each(CASE WHEN json_valid(j.Sub_Orders) THEN j.Sub_Orders ELSE '[]' END) je
    )
    SELECT ${SUB_ORDER_COLUMNS}, src.job_id AS source_job
    FROM src
    JOIN Sub_Orders so ON so.id = src.so_id
    LEFT JOIN taken ON taken.so_id = so.id
    LEFT JOIN Customers c ON c.id = so.Customer
    LEFT JOIN Orders o ON o.id = so."Order"
    WHERE taken.so_id IS NULL AND so.Status = 'UPDATED TO FACTORY'
    ORDER BY so.Factory_Updated_Date, so.id`;

// Open batches and the last fortnight's closed ones, with their jobs. A batch is
// open until its plates are back. Outputs and the orders behind them are read
// after, by id (outputsSql, subOrdersQuery).
export const treeSql = () => `
    SELECT b.id AS batch_id, b.Date AS batch_date, b.Machine AS machine, b.Job_Batch_ID AS batch_name,
           b.Plates_Collected AS plates_collected, b.Plates_Returned AS plates_returned,
           b.Notes AS batch_notes,
           j.id AS job_id, j.Printing_Colours AS colours, j.Sub_Orders AS sub_orders,
           j.Printing_Started AS started, j.Printing_Started_At AS started_at,
           j.Printing_Completed AS completed, j.Printing_Completed_At AS completed_at,
           j.Wastage_Weight_Kg_ AS wastage_kg, j.Plates AS plates, j.Damaged_Plates AS damaged_plates
    FROM ${BATCHES_TABLE} b
    LEFT JOIN ${JOBS_TABLE} j ON j.Printing_Job_Batch = b.id
    WHERE COALESCE(b.Plates_Returned, 0) = 0 OR b.Date >= CAST(strftime('%s', 'now', '-14 days') AS INTEGER)
    ORDER BY b.Date DESC, b.id DESC, j.Printing_Colours, j.id`;

export const outputsQuery = (jobIds) => {
    const ids = [...new Set((jobIds || []).map(num).filter(Boolean))];
    if (!ids.length) return null;
    return {
        sql: `SELECT op.id, op.Printing_Job AS job_id, op.Customer AS customer, c.Shop_Name AS shop, c.City AS city,
                     op.Sub_Orders AS sub_orders, op.Printed_Count AS printed_count,
                     op.Printed_Weight_Kg_ AS printed_kg, op.Misprint_Weight_Kg_ AS misprint_kg
              FROM ${OUTPUTS_TABLE} op LEFT JOIN Customers c ON c.id = op.Customer
              WHERE op.Printing_Job IN (${ids.map(() => '?').join(',')})
              ORDER BY c.Shop_Name, op.id`,
        args: ids
    };
};

export const subOrdersQuery = (ids) => {
    const list = [...new Set((ids || []).map(num).filter(Boolean))];
    if (!list.length) return null;
    return {
        sql: `SELECT ${SUB_ORDER_COLUMNS}
              FROM Sub_Orders so
              LEFT JOIN Customers c ON c.id = so.Customer
              LEFT JOIN Orders o ON o.id = so."Order"
              WHERE so.id IN (${list.map(() => '?').join(',')})`,
        args: list
    };
};

// The register rows a batch's pick list needs: plates made for its orders, old
// plates confirmed for its repeat orders, and -- for a repeat order that names
// none -- its customers' plates to choose from.
export const platesQuery = (subOrderIds, plateIds, customerIds = []) => {
    const so = [...new Set((subOrderIds || []).map(num).filter(Boolean))];
    const ids = [...new Set((plateIds || []).map(num).filter(Boolean))];
    const cust = [...new Set((customerIds || []).map(num).filter(Boolean))];
    if (!so.length && !ids.length && !cust.length) return null;
    const where = [
        so.length ? `Source_Sub_Order IN (${so.map(() => '?').join(',')})` : null,
        ids.length ? `id IN (${ids.map(() => '?').join(',')})` : null,
        cust.length ? `Customer IN (${cust.map(() => '?').join(',')})` : null
    ].filter(Boolean).join(' OR ');
    return {
        sql: `SELECT id, Plate_No AS plate_no, Customer AS customer, Source_Sub_Order AS source_sub_order,
                     Plate_Type AS plate_type, Material AS material, Rack AS rack, Slot AS slot,
                     Rack_Code AS rack_code, Plate_Count AS plate_count, Stereo_Size AS stereo_size,
                     Orders AS orders, Made_On AS made_on, Last_Used_On AS last_used_on, Expires_On AS expires_on,
                     Status AS status, Issued_To_Job AS issued_to_job, Bag_Width AS bag_w, Bag_Height AS bag_h
              FROM ${PLATES_TABLE} WHERE ${where}`,
        args: [...so, ...ids, ...cust]
    };
};

// Readers for the SQL rows above, so the page and the tests speak one shape.
export const plateFromRow = (r) => ({
    id: num(r.id), plateNo: r.plate_no, customer: num(r.customer),
    sourceSubOrder: num(r.source_sub_order), plateType: r.plate_type, material: r.material,
    rack: r.rack || '', slot: num(r.slot) || null, rackCode: r.rack_code || '', plateCount: num(r.plate_count),
    stereoSize: r.stereo_size || '', orders: refList(r.orders),
    madeOn: r.made_on || null, lastUsedOn: r.last_used_on || null, expiresOn: r.expires_on || null,
    status: r.status, issuedToJob: num(r.issued_to_job),
    bagW: r.bag_w, bagH: r.bag_h
});

export const subOrderFromRow = (r) => ({
    id: num(r.so_id ?? r.id), model: r.model, print: r.print, plate: r.plate, material: r.material,
    printingColour: r.printing_colour, plateCount: r.plate_count, qty: r.qty, qtyType: r.qty_type,
    bagW: r.bag_w, bagH: r.bag_h, sheetSize: r.sheet_size, bagColour: r.bag_colour, bagGsm: r.bag_gsm,
    reusedPlates: refList(r.reused_plates), customer: num(r.customer), shop: r.shop, city: r.city,
    orderId: r.order_id, sourceJob: num(r.source_job), factoryDate: r.factory_date,
    orderDate: r.order_date
});

// The tree: batches, their jobs, each job's shop outputs, and the orders behind
// both. `outputRows` and `subOrders` are the follow-up reads.
export const batchesFromRows = (rows, outputRows = [], subOrders = []) => {
    const soById = new Map((subOrders || []).map((so) => [so.id, so]));
    const outputsByJob = new Map();
    for (const r of outputRows || []) {
        const jobId = num(r.job_id);
        if (!outputsByJob.has(jobId)) outputsByJob.set(jobId, []);
        const ids = refList(r.sub_orders);
        outputsByJob.get(jobId).push({
            id: num(r.id), customer: num(r.customer), shop: r.shop, city: r.city,
            subOrderIds: ids, subOrders: ids.map((id) => soById.get(id)).filter(Boolean),
            printedCount: r.printed_count, printedKg: r.printed_kg, misprintKg: r.misprint_kg
        });
    }
    const byId = new Map();
    for (const r of rows || []) {
        const id = num(r.batch_id);
        if (!byId.has(id)) {
            byId.set(id, {
                id, date: r.batch_date, machine: r.machine, name: r.batch_name,
                platesCollected: truthy(r.plates_collected), platesReturned: truthy(r.plates_returned),
                notes: r.batch_notes, jobs: []
            });
        }
        if (r.job_id == null) continue;
        const ids = refList(r.sub_orders);
        byId.get(id).jobs.push({
            id: num(r.job_id), colours: r.colours || '',
            subOrderIds: ids, subOrders: ids.map((x) => soById.get(x)).filter(Boolean),
            outputs: outputsByJob.get(num(r.job_id)) || [],
            started: truthy(r.started), startedAt: r.started_at,
            completed: truthy(r.completed), completedAt: r.completed_at,
            wastageKg: r.wastage_kg, plates: refList(r.plates), damagedPlates: refList(r.damaged_plates)
        });
    }
    return [...byId.values()];
};

// Where a batch is, as one word the card can show.
export const batchStage = (batch) => {
    const jobs = batch?.jobs || [];
    if (batch?.platesReturned) return 'CLOSED';
    if (!batch?.platesCollected) return 'PLATES TO COLLECT';
    if (jobs.length && jobs.every((j) => j.completed)) return 'PLATES TO RETURN';
    if (jobs.some((j) => j.started)) return 'PRINTING';
    return 'READY';
};

// ---- 1. making a batch -----------------------------------------------------

export const batchProblem = (machine, subOrders) => {
    if (!machine) return 'Choose the machine.';
    if (!subOrders?.length) return 'Pick at least one order.';
    return null;
};

export const batchFields = ({ date, machine }) => ({ Date: date, Machine: machine });

// The jobs and outputs a batch is made of: one job per ink set, and inside it one
// output per shop. Shops come in the order their names sort, so the floor reads
// the list the way the office does.
export const batchPlan = (subOrders) => {
    const jobs = new Map();
    for (const so of subOrders || []) {
        const colours = colourKey(so);
        if (!jobs.has(colours)) jobs.set(colours, { colours, subOrders: [], outputs: new Map() });
        const job = jobs.get(colours);
        job.subOrders.push(so);
        const key = num(so.customer) || `so-${so.id}`;
        if (!job.outputs.has(key)) job.outputs.set(key, { customer: num(so.customer) || null, shop: so.shop || '', subOrders: [] });
        job.outputs.get(key).subOrders.push(so);
    }
    return [...jobs.values()]
        .sort((a, b) => a.colours.localeCompare(b.colours))
        .map((j) => ({
            ...j,
            outputs: [...j.outputs.values()].sort((a, b) => String(a.shop).localeCompare(String(b.shop)))
        }));
};

const refs = (ids) => ['L', ...ids];

export const jobFields = (batchId, job) => ({
    Printing_Job_Batch: batchId,
    Printing_Colours: job.colours,
    Sub_Orders: refs(job.subOrders.map((so) => so.id)),
    Source_Jobs: refs([...new Set(job.subOrders.map((so) => so.sourceJob).filter(Boolean))])
});

export const outputFields = (jobId, output) => ({
    Printing_Job: jobId,
    Customer: output.customer,
    Sub_Orders: refs(output.subOrders.map((so) => so.id))
});

// ---- 2. plates out ---------------------------------------------------------

// An order with no plate in the register: a new design, its plates fresh from
// the vendor. They are registered as they are picked -- the first time anyone
// has them in hand -- as one row, like every other set in a slot, counting how
// many plates the order was made with. If the office has already written a code
// of this kind into the shop's name, that is its slot; otherwise it has none
// yet.
export const newPlateRecords = (job, so) => {
    const kind = kindOfOrder(so) || 'PLATE';
    const code = parseRackCodes(so.shop).find((c) => c.kind === kind);
    return [{
        Customer: so.customer || null,
        Source_Sub_Order: so.id,
        Plate_Type: kind,
        Material: so.material || '',
        Print: so.print || '',
        Printing_Colours: colourKey(so),
        Bag_Width: num(so.bagW) || null,
        Bag_Height: num(so.bagH) || null,
        Plate_Count: Math.max(1, num(so.plateCount)),
        Bag_Model: so.model || '',
        Orders: ['L', so.id],
        Made_On: so.orderDate || null,
        Last_Used_On: so.orderDate || null,
        Reusable: isReusable({ material: so.material, plateType: kind }),
        Rack: code?.rack || rackFor(so.city),
        Slot: code?.slot || null,
        Status: STATUS.ISSUED,
        Issued_To_Job: job.id,
        Verified: true,
        Notes: 'Registered when first picked'
    }];
};

// What stops the plates going out. A plate already out with another job is on
// someone else's machine; picking it here would leave that job short.
export const collectionProblems = (lines) => lines
    .filter(({ job, plate }) => plate.status === STATUS.ISSUED && plate.issuedToJob && plate.issuedToJob !== job.id)
    .map(({ plate }) => `${plate.rackCode || plate.plateNo || `Plate ${plate.id}`} is out with job ${plate.issuedToJob}.`);

// Every listed plate issued to its job, each job told which plates it runs
// with, and the batch marked collected -- one bundle. `newPlates` are the ids of
// plates registered moments ago for orders that had none.
export const collectionBundle = (batch, lines, newPlates = []) => {
    const actions = [];
    const byJob = new Map();
    for (const { job, plate } of lines) {
        if (!byJob.has(job.id)) byJob.set(job.id, []);
        byJob.get(job.id).push(plate.id);
        // A plate already issued to this job (a retried collection) is not
        // issued twice.
        if (plate.status === STATUS.ISSUED && plate.issuedToJob === job.id) continue;
        actions.push(...plateActionBundle(plate, 'ISSUED', { jobId: job.id }));
    }
    for (const { jobId, plateId } of newPlates) {
        if (!byJob.has(jobId)) byJob.set(jobId, []);
        byJob.get(jobId).push(plateId);
        actions.push(['AddRecord', MOVEMENTS_TABLE, null, {
            Plate: plateId, Action: 'ISSUED', Status_After: STATUS.ISSUED,
            Printing_Job: jobId, Notes: 'New plate, registered when first picked'
        }]);
    }
    for (const [jobId, ids] of byJob) {
        actions.push(['UpdateRecord', JOBS_TABLE, jobId, { Plates: ['L', ...new Set(ids)] }]);
    }
    actions.push(['UpdateRecord', BATCHES_TABLE, batch.id, { Plates_Collected: true }]);
    return actions;
};

// ---- 3. jobs ---------------------------------------------------------------

export const canStart = (batch, job) => Boolean(batch?.platesCollected && !job?.started && job?.plates?.length);

// The completion form, checked: for every shop its printed count, printed
// weight and misprint weight; once for the job its wastage (user, 1 Nov 2026).
// The count is what the customer gets, the weight is what the scale says, and
// the two together catch a slip in either. Zero is a real answer, blank is not.
//
// form = { outputs: { [outputId]: { printedCount, printedKg, misprintKg } }, wastageKg, damaged: [plateId] }
const weightProblem = (raw, label, mustBePositive) => {
    const v = Number(raw);
    if (raw === '' || raw == null || !Number.isFinite(v) || v < 0) return `Enter the ${label} in kg (0 if none).`;
    if (mustBePositive && v === 0) return `The ${label} cannot be 0 when something was printed.`;
    return null;
};

export const completionProblems = (job, form) => {
    const problems = [];
    for (const out of job?.outputs || []) {
        const f = form?.outputs?.[out.id] || {};
        const who = out.shop || `shop ${out.id}`;
        const count = Number(f.printedCount);
        if (f.printedCount === '' || f.printedCount == null || !Number.isInteger(count) || count <= 0) {
            problems.push(`${who}: enter how many were printed, as a whole number.`);
        }
        for (const p of [weightProblem(f.printedKg, 'printed weight', true), weightProblem(f.misprintKg, 'misprint weight', false)]) {
            if (p) problems.push(`${who}: ${p.charAt(0).toLowerCase()}${p.slice(1)}`);
        }
    }
    const w = weightProblem(form?.wastageKg, 'wastage for the job', false);
    if (w) problems.push(w);
    return problems;
};

// Every shop's figures and the job's own, as one bundle.
export const completionActions = (job, form) => [
    ...(job.outputs || []).map((out) => {
        const f = form.outputs[out.id];
        return ['UpdateRecord', OUTPUTS_TABLE, out.id, {
            Printed_Count: Number(f.printedCount),
            Printed_Weight_Kg_: Number(f.printedKg),
            Misprint_Weight_Kg_: Number(f.misprintKg)
        }];
    }),
    ['UpdateRecord', JOBS_TABLE, job.id, {
        Printing_Completed: true,
        Wastage_Weight_Kg_: Number(form.wastageKg),
        Damaged_Plates: ['L', ...(form.damaged || []).filter((id) => (job.plates || []).includes(id))]
    }]
];

// ---- 4. plates back ----------------------------------------------------------

export const canReturnPlates = (batch) => Boolean(batch?.platesCollected && !batch?.platesReturned
    && (batch.jobs || []).length && batch.jobs.every((j) => j.completed));

// Each plate the batch ran with goes where the operator's word sends it: back to
// its slot, retired when marked damaged, or discarded when it was single-use.
// Plates already handled (a retried return) are left alone.
export const returnPlan = (batch, plates) => {
    const byId = new Map((plates || []).map((p) => [p.id, p]));
    const plan = [];
    for (const job of batch?.jobs || []) {
        for (const id of job.plates || []) {
            const plate = byId.get(id);
            if (!plate || plate.status !== STATUS.ISSUED) continue;
            const condition = (job.damagedPlates || []).includes(id) ? 'DAMAGED' : 'REUSABLE';
            plan.push({ job, plate, action: afterJobAction(plate, condition) });
        }
    }
    return plan;
};

// Nothing stops plates going back: each returns to the slot the register has
// for it (user, 5 Nov 2026). Kept so the page can ask, and so a rule can be
// added here rather than in the page.
export const returnPlanProblems = (plan) => plan
    .filter((p) => p.action === 'RETURNED' && actionProblem(p.plate, 'RETURNED', p))
    .map((p) => `${p.plate.rackCode || p.plate.plateNo || `Plate ${p.plate.id}`} cannot go back: ${actionProblem(p.plate, 'RETURNED', p)}`);

// Each plate's move, and for every plate that ran -- kept or not -- the orders
// of its job it printed added to its history and `today` (a Grist Date, epoch
// seconds) as its last use.
export const returnBundle = (batch, plan, today) => [
    ...plan.flatMap((p) => [
        ...plateActionBundle(p.plate, p.action, { jobId: p.job.id }),
        ['UpdateRecord', PLATES_TABLE, p.plate.id, {
            Last_Used_On: today,
            Orders: ['L', ...new Set([...(p.plate.orders || []), ...ordersServedBy(p.job, p.plate)])]
        }]
    ]),
    ['UpdateRecord', BATCHES_TABLE, batch.id, { Plates_Returned: true }]
];
