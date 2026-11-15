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
    isReusable, kindOfOrder, rackFor, STATUS, afterJobAction, actionProblem, plateActionBundle, designActionBundle,
    ordersServedBy, PLATES_TABLE, SIDES_TABLE, MOVEMENTS_TABLE, COMPANY_PLATE, expiresOn
} from './printingPlates.js';
import { sideNo, sideRecords, setKey } from './plateSets.js';
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
    -- A model-design run lists the orders it prints the design for, but the
    -- customer's own print is still to come, so it takes none of them.
    taken AS (
        SELECT DISTINCT CAST(je.value AS INTEGER) AS so_id
        FROM ${JOBS_TABLE} j,
             json_each(CASE WHEN json_valid(j.Sub_Orders) THEN j.Sub_Orders ELSE '[]' END) je
        WHERE COALESCE(j.Model_Design, '') = ''
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
           j.Wastage_Weight_Kg_ AS wastage_kg, j.Plates AS plates, j.Damaged_Plates AS damaged_plates,
           j.Model_Design AS model_design, j.Sheet_Size AS sheet_size, j.Run_Sheets AS run_sheets,
           j.Order_Sheets AS order_sheets, j.Plain_Item AS plain_item, j.Model_Item AS model_item,
           j.Cut_Into AS cut_into
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

// A plate as the app reads it: one Plate_Sides row (a physical plate or
// stereo) with its design's facts from Printing_Plates (plateSets.js). Pages add
// their own design columns after these, off the same `p` alias.
export const SIDE_COLUMNS = `s.id AS id, s.Design AS design_id, s.Side_No AS side_no, s.Status AS status,
    s.Issued_To_Job AS issued_to_job, s.Picture AS picture, s.Replaces AS replaces, s.Made_On AS side_made_on,
    p.Customer AS customer, p.Source_Sub_Order AS source_sub_order, p.Plate_Type AS plate_type,
    p.Material AS material, p.Rack AS rack, p.Slot AS slot, p.Rack_Code AS rack_code,
    p.Plate_Count AS plate_count, p.Stereo_Size AS stereo_size, p.Orders AS orders, p.Made_On AS made_on,
    p.Last_Used_On AS last_used_on, p.Bag_Width AS bag_w, p.Bag_Height AS bag_h, p.Model_Design AS model_design`;
export const SIDES_FROM = `${SIDES_TABLE} s JOIN ${PLATES_TABLE} p ON p.id = s.Design`;

// The plates a batch's pick list needs: those made for its orders, those of the
// designs confirmed for its repeat orders, and -- for a repeat order that names
// none -- its customers' plates to choose from. A design brings all its sides.
// `models` are the designs of the batch's model runs, whose company plates are
// found by design rather than by any customer. `sideIds` are plates a job
// already holds (Printing_Jobs.Plates names sides).
const uniq = (xs) => [...new Set((xs || []).map(num).filter(Boolean))];
export const platesQuery = (subOrderIds, designIds, customerIds = [], models = [], sideIds = []) => {
    const so = uniq(subOrderIds);
    const ids = uniq(designIds);
    const cust = uniq(customerIds);
    const sides = uniq(sideIds);
    const designs = [...new Set((models || []).map((m) => String(m ?? '').trim().toUpperCase()).filter(Boolean))];
    if (!so.length && !ids.length && !cust.length && !designs.length && !sides.length) return null;
    const marks = (xs) => xs.map(() => '?').join(',');
    const where = [
        so.length ? `p.Source_Sub_Order IN (${marks(so)})` : null,
        ids.length ? `p.id IN (${marks(ids)})` : null,
        cust.length ? `p.Customer IN (${marks(cust)})` : null,
        designs.length ? `(p.Plate_Type = '${COMPANY_PLATE}' AND UPPER(TRIM(p.Model_Design)) IN (${marks(designs)}))` : null,
        sides.length ? `s.id IN (${marks(sides)})` : null
    ].filter(Boolean).join(' OR ');
    return { sql: `SELECT ${SIDE_COLUMNS} FROM ${SIDES_FROM} WHERE ${where}`, args: [...so, ...ids, ...cust, ...designs, ...sides] };
};

// Readers for the SQL rows above, so the page and the tests speak one shape.
// A side made later than its design (a replacement) dates from its own making,
// so it expires later too.
export const plateFromRow = (r) => {
    const plate = {
        id: num(r.id), designId: num(r.design_id), plateInSet: num(r.side_no) || 1,
        customer: num(r.customer), sourceSubOrder: num(r.source_sub_order), plateType: r.plate_type, material: r.material,
        rack: r.rack || '', slot: num(r.slot) || null, rackCode: r.rack_code || '', plateCount: num(r.plate_count),
        stereoSize: r.stereo_size || '', orders: refList(r.orders),
        madeOn: r.side_made_on || r.made_on || null, lastUsedOn: r.last_used_on || null,
        status: r.status, issuedToJob: num(r.issued_to_job),
        bagW: r.bag_w, bagH: r.bag_h, modelDesign: r.model_design || '',
        replaces: num(r.replaces) || null,
        // Its picture: from its design file (scripts/plate-previews.mjs) or a photo.
        preview: refList(r.picture)
    };
    return { ...plate, plateNo: sideNo(plate), expiresOn: expiresOn(plate) };
};

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
            wastageKg: r.wastage_kg, plates: refList(r.plates), damagedPlates: refList(r.damaged_plates),
            // A model-design run (modelRuns.js); blank on an ink-set job.
            modelDesign: String(r.model_design || '').trim(), sheetSize: r.sheet_size || '',
            runSheets: num(r.run_sheets), orderSheets: num(r.order_sheets), cutInto: num(r.cut_into) || 1,
            plainItem: num(r.plain_item) || null, modelItem: num(r.model_item) || null
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
// has them in hand: one design row, then a side for each plate the order was
// made with, out with this job (newSideRecords, once the design's id is known).
// If the office has already written a code of this kind into the shop's name,
// that is its slot; otherwise it has none yet.
export const newDesignRecord = (so) => {
    const kind = kindOfOrder(so) || 'PLATE';
    const code = parseRackCodes(so.shop).find((c) => c.kind === kind);
    return {
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
        Notes: 'Registered when first picked'
    };
};

export const newSideRecords = (job, so, designId) => sideRecords(designId, so.plateCount, {
    Status: STATUS.ISSUED,
    Issued_To_Job: job.id,
    Verified: true,
    Made_On: so.orderDate || null
});

// The side rows for designs registered moments ago, one entry of `missing`
// ({ job, so }; so is null for a model run's company plate) per design, given
// the design ids that came back in the same order. Returns the actions and,
// for each side, the job and design it belongs to -- collectionBundle's
// `newPlates` once the side ids are known.
export const registrationSides = (missing, designIds, companySide = (job) => ({ Status: STATUS.ISSUED, Issued_To_Job: job.id, Verified: true })) => {
    const actions = [];
    const owners = [];
    (missing || []).forEach(({ job, so }, i) => {
        const designId = num(designIds?.[i]);
        if (!designId) throw new Error(`No design id came back for ${so ? `order ${so.id}` : `job ${job.id}`}.`);
        const rows = so ? newSideRecords(job, so, designId) : sideRecords(designId, 1, companySide(job));
        for (const fields of rows) {
            actions.push(['AddRecord', SIDES_TABLE, null, fields]);
            owners.push({ jobId: job.id, designId });
        }
    });
    return { actions, owners };
};

// What stops the plates going out. A plate already out with another job is on
// someone else's machine; picking it here would leave that job short.
export const collectionProblems = (lines) => lines
    .filter(({ job, plate }) => plate.status === STATUS.ISSUED && plate.issuedToJob && plate.issuedToJob !== job.id)
    .map(({ plate }) => `${plate.rackCode || plate.plateNo || `Plate ${plate.id}`} is out with job ${plate.issuedToJob}.`);

// Every listed plate issued to its job, each job told which plates (sides) it
// runs with, and the batch marked collected -- one bundle. `newPlates` are
// { jobId, plateId, designId }: sides registered moments ago for orders that
// had none.
// A plate goes out whole: each design's sides for a job are issued together,
// with one movement for the plate.
export const collectionBundle = (batch, lines, newPlates = []) => {
    const actions = [];
    const byJob = new Map();
    const toIssue = new Map();
    for (const { job, plate } of lines) {
        if (!byJob.has(job.id)) byJob.set(job.id, []);
        byJob.get(job.id).push(plate.id);
        // A plate already issued to this job (a retried collection) is not
        // issued twice.
        if (plate.status === STATUS.ISSUED && plate.issuedToJob === job.id) continue;
        const key = `${job.id}:${setKey(plate)}`;
        if (!toIssue.has(key)) toIssue.set(key, { job, sides: [] });
        toIssue.get(key).sides.push(plate);
    }
    for (const { job, sides } of toIssue.values()) actions.push(...designActionBundle(sides, 'ISSUED', { jobId: job.id }));
    const newDesigns = new Map();
    for (const { jobId, plateId, designId } of newPlates) {
        if (!byJob.has(jobId)) byJob.set(jobId, []);
        byJob.get(jobId).push(plateId);
        newDesigns.set(`${jobId}:${designId}`, { jobId, designId });
    }
    for (const { jobId, designId } of newDesigns.values()) {
        actions.push(['AddRecord', MOVEMENTS_TABLE, null, {
            Plate: designId, Action: 'ISSUED', Status_After: STATUS.ISSUED,
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

// Each plate's move, and for every design that ran -- kept or not -- the orders
// of its jobs it printed added to its history and `today` (a Grist Date, epoch
// seconds) as its last use: once per design, however many of its sides ran.
export const returnBundle = (batch, plan, today) => {
    const designs = new Map();
    for (const p of plan) {
        const key = setKey(p.plate);
        const orders = designs.get(key) || new Set(p.plate.orders || []);
        for (const id of ordersServedBy(p.job, p.plate)) orders.add(id);
        designs.set(key, orders);
    }
    // Back on the rack the plate goes whole: one movement per design per job
    // for the sides returned. A side retired at the end of the job is its own.
    const returned = new Map();
    const retired = [];
    for (const p of plan) {
        if (p.action !== 'RETURNED') { retired.push(...plateActionBundle(p.plate, p.action, { jobId: p.job.id })); continue; }
        const key = `${p.job.id}:${setKey(p.plate)}`;
        if (!returned.has(key)) returned.set(key, { job: p.job, sides: [] });
        returned.get(key).sides.push(p.plate);
    }
    return [
        ...[...returned.values()].flatMap(({ job, sides }) => designActionBundle(sides, 'RETURNED', { jobId: job.id })),
        ...retired,
        ...[...designs].map(([id, orders]) => ['UpdateRecord', PLATES_TABLE, id, { Last_Used_On: today, Orders: ['L', ...orders] }]),
        ['UpdateRecord', BATCHES_TABLE, batch.id, { Plates_Returned: true }]
    ];
};
