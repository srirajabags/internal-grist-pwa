// Model-design runs: printing a model number (F12, M3, ...) onto plain sheets
// before any customer's details go on them (user, 12 Nov 2026).
//
// A model-number order is a stitching bag on a sheet that carries one of the
// factory's own designs. Production cuts those sheets plain with the rest of the
// job, for the plate's full run -- 1,000 sheets on 16x19, 1,100 with the overage
// -- because the plate is only worth setting up for that many. Then:
//
//   production   all 1,100 plain sheets         -> PRINTING AREA
//   model run    1,100 plain sheets out of PRINTING AREA, model design printed
//                on the multi-colour machine off the company plate:
//                  the orders' 440 F12 sheets   -> PRINTING AREA (customer print next)
//                  the other 660 F12 sheets     -> BAGS GODOWN (ready for next time)
//   customer     the 440 get the shop's details on the single-colour machine,
//                as an ordinary printing job, once the run is done
//
// Job 945 (5 Nov) went wrong at the first step: its 660 extra sheets went to
// the godown plain, and the F12 design was printed on all 1,100 off the books.

import { modelSheetRuns, isModelNumberSheet, groupOutputCount, finishedSheetDims, SHEET_TYPES } from '../production/productionBatch.js';
import { PRINTING_RELEASED_AT, JOBS_TABLE } from './printingJobs.js';
import { MACHINES } from './printingMachines.js';
import { COMPANY_PLATE } from './printingPlates.js';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
const refList = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== 'L').map(num);
    try { return (JSON.parse(v || '[]') || []).map(num); } catch { return []; }
};
const firstChoice = (v) => {
    if (Array.isArray(v)) return v.filter((x) => x !== 'L')[0] ?? '';
    try {
        const parsed = JSON.parse(v);
        return Array.isArray(parsed) ? parsed[0] ?? '' : String(v ?? '');
    } catch { return String(v ?? ''); }
};

// The full design runs on the multi-colour machine, whatever ink the customer's
// details are printed in afterwards.
export const MODEL_RUN_MACHINE = MACHINES.MULTI;

export const TXN_TABLE = 'Inventory_Transactions';
export const PRINTING_AREA = 'PRINTING AREA';
export const BAGS_GODOWN = 'BAGS GODOWN';

// What a model run's job is called where an ink set would be.
export const runColours = (model) => `${norm(model)} DESIGN`;

// Sizes compared as smaller x bigger, the way the factory writes them.
const sizeKey = (w, h) => {
    const [a, b] = [num(w), num(h)].sort((x, y) => x - y);
    return a && b ? `${a}x${b}` : '';
};
const sheetSizeKey = (text) => {
    const m = String(text ?? '').match(/(\d+(?:\.\d+)?)\s*[xX×*]\s*(\d+(?:\.\d+)?)/);
    return m ? sizeKey(m[1], m[2]) : '';
};

// ---- the queue -------------------------------------------------------------

// Model-number sub-orders of sheet jobs completed since printing was released.
// Grist column names, because modelSheetRuns speaks them.
export const runQueueSql = () => `
    WITH done AS (
        SELECT pj.id AS job_id, pj.Type AS job_type, pj.Job_Overage AS rate, pj.Job_ID AS job_name,
               CAST(je.value AS INTEGER) AS so_id
        FROM Factory_Production_Jobs pj,
             json_each(CASE WHEN json_valid(pj.Sub_Orders) THEN pj.Sub_Orders ELSE '[]' END) je
        WHERE pj.Production_Completed = 1 AND pj.Production_Completed_At >= ${PRINTING_RELEASED_AT}
          AND pj.Type IN (${[...SHEET_TYPES].map((t) => `'${t}'`).join(', ')})
    )
    SELECT done.job_id, done.job_type, done.rate, done.job_name,
           so.id AS id, so.Material, so.Model, so.Print, so.Roll_Material, so.Quantity, so.Quantity_Type,
           so.Bag_Colour, so.Bag_GSM, so.Bag_Width, so.Bag_Height, so.Sheet_Size,
           so.Sidepatty_Colour, so.Sidepatty_GSM, so.Sidepatty_Width, so.Handle_Colour,
           so.Customer AS customer, c.Shop_Name AS shop, c.City AS city
    FROM done
    JOIN Sub_Orders so ON so.id = done.so_id
    LEFT JOIN Customers c ON c.id = so.Customer
    WHERE so.Print = 'MODEL NUMBER'
    ORDER BY done.job_id, so.id`;

// Model runs already made, done or not: a run is made once.
export const madeRunsSql = () => `
    SELECT j.id, j.Model_Design AS model, j.Source_Jobs AS source_jobs, j.Sub_Orders AS sub_orders,
           j.Printing_Completed AS completed
    FROM ${JOBS_TABLE} j
    WHERE COALESCE(j.Model_Design, '') != ''`;

// What the jobs moved that a run depends on: the plain sheets they booked into
// the printing area (the run draws on those), and model sheets already printed
// that they took off the shelf (those answered their orders without a run).
export const jobStockQuery = (jobIds) => {
    const ids = [...new Set((jobIds || []).map(num).filter(Boolean))];
    if (!ids.length) return null;
    return {
        sql: `SELECT t.Production_Job AS job_id, t.Transaction_Type AS type, t.Location AS location,
                     t.Item_ID AS item, c.Type AS code_type, c.Material AS material, c.GSM AS gsm,
                     c.Colour AS colour, c.Width_Inches_ AS w, c.Height_Inches_ AS h,
                     SUM(t.Count_Bundles_) AS count
              FROM Inventory_Transactions t
              JOIN Inventory_Items i ON i.id = t.Item_ID
              JOIN Inventory_Item_Codes c ON c.id = i.Item_Code
              WHERE t.Production_Job IN (${ids.map(() => '?').join(',')})
                AND ((t.Transaction_Type = 'ADD' AND t.Location = 'PRINTING AREA' AND c.Type = 'SHEET')
                  OR (t.Transaction_Type = 'LESS' AND t.Location = 'BAGS GODOWN' AND c.Type = 'MODEL NUMBER SHEET'))
              GROUP BY 1, 2, 3, 4`,
        args: ids
    };
};

// Every printed-model-sheet item of these designs, to book a run's output on.
export const modelItemsQuery = (models) => {
    const list = [...new Set((models || []).map(norm).filter(Boolean))];
    if (!list.length) return null;
    return {
        sql: `SELECT i.id AS item, i.Item_ID AS item_id, c.Material AS material, c.GSM AS gsm,
                     c.Colour AS colour, c.Width_Inches_ AS w, c.Height_Inches_ AS h
              FROM Inventory_Items i JOIN Inventory_Item_Codes c ON c.id = i.Item_Code
              WHERE c.Type = 'MODEL NUMBER SHEET' AND UPPER(TRIM(c.Colour)) IN (${list.map(() => '?').join(',')})`,
        args: list
    };
};

// The name the office would give a missing printed-model-sheet code.
const codeName = (plain, model, size) =>
    `MODEL NUMBER SHEET - ${plain?.material || '?'} - ${norm(model)} - ${plain?.gsm || '?'}GSM (${size})`;

// The runs waiting to be printed, one per (production job, model). Each says how
// many sheets the run prints, how many of them its orders take on, and which two
// stock items it moves; `problem` says why it cannot be made yet.
//
//   runSheets    the plate's run, or the orders if they are more
//   orderSheets  the orders' sheets less what printed stock already answered
//   stockSheets  the rest, back to the godown printed
//
// A model whose orders the shelf answered in full needs no run at all -- the
// planner gave the roll no floor for it.
export const waitingRuns = ({ subOrderRows = [], stockRows = [], modelItemRows = [], madeRuns = [] }) => {
    const made = new Set();
    for (const r of madeRuns) {
        for (const jobId of refList(r.source_jobs)) made.add(`${jobId}|${norm(r.model)}`);
    }
    const byJob = new Map();
    for (const r of subOrderRows) {
        const jobId = num(r.job_id);
        if (!byJob.has(jobId)) byJob.set(jobId, { jobId, jobType: norm(r.job_type), rate: r.rate, jobName: r.job_name, subOrders: [] });
        byJob.get(jobId).subOrders.push(r);
    }
    const runs = [];
    for (const job of byJob.values()) {
        if (!SHEET_TYPES.has(job.jobType)) continue;
        const sheets = job.subOrders.filter(isModelNumberSheet);
        // Every design and size the job cut needs its run. Where the size has a
        // plate minimum the run is at least that (modelSheetRuns); where it has
        // none -- 12x17, job 997 -- the run is the orders' own sheets.
        const floors = modelSheetRuns(job.jobType, sheets, job.rate);
        const groups = new Map();
        for (const so of sheets) {
            const model = norm(firstChoice(so.Bag_Colour));
            const size = sheetSizeKey(so.Sheet_Size);
            if (!model || !size) continue;
            const key = `${model}|${size}`;
            if (!groups.has(key)) groups.set(key, { model, size, subOrders: [] });
            groups.get(key).subOrders.push(so);
        }
        for (const { model, size, subOrders } of groups.values()) {
            if (made.has(`${job.jobId}|${model}`)) continue;
            const floor = floors.find((f) => f.model === model && sizeKey(...f.sheetSize.split('x')) === size);
            const ordered = Math.ceil(num(groupOutputCount('ROLLS TO SHEETS', subOrders, job.rate).count) - 1e-9);
            // No minimum: the run is just what the orders still need (taken below).
            const r = { model, orderSheets: ordered, runSheets: floor ? floor.runSheets : 0 };
            // A sheet that holds two bags (a 12x16 bag's 24x17) is printed with the
            // design twice and cut in half; the halves are what is stocked and what
            // the orders take (productionBatch.finishedSheetDims). The run is
            // counted in plain sheets cut, everything after it in halves.
            const fin = finishedSheetDims(subOrders[0]);
            const finishedSize = fin ? sizeKey(fin.w, fin.h) : size;
            const [cw, ch] = size.split('x').map(Number);
            const [fw, fh] = finishedSize.split('x').map(Number);
            const cutInto = fw && fh ? Math.max(1, Math.round((cw * ch) / (fw * fh))) : 1;
            const ready = stockRows
                .filter((s) => num(s.job_id) === job.jobId && norm(s.type) === 'LESS' && norm(s.code_type) === 'MODEL NUMBER SHEET'
                    && norm(s.colour) === r.model && sizeKey(s.w, s.h) === finishedSize)
                .reduce((t, s) => t + num(s.count), 0);
            const orderSheets = Math.max(r.orderSheets * cutInto - ready, 0);
            if (orderSheets <= 0) continue;
            const runSheets = Math.max(r.runSheets, Math.ceil(orderSheets / cutInto));
            const plains = [...new Map(stockRows
                .filter((s) => num(s.job_id) === job.jobId && norm(s.type) === 'ADD' && norm(s.code_type) === 'SHEET'
                    && sizeKey(s.w, s.h) === size)
                .map((s) => [num(s.item), s])).values()];
            const plain = plains.length === 1 ? plains[0] : null;
            const models = plain
                ? modelItemRows.filter((m) => norm(m.colour) === r.model && sizeKey(m.w, m.h) === finishedSize
                    && norm(m.material) === norm(plain.material) && String(m.gsm) === String(plain.gsm))
                : [];
            let problem = null;
            if (plains.length === 0) problem = `Job ${job.jobId} booked no ${size} sheets into the printing area to print on.`;
            else if (plains.length > 1) problem = `Job ${job.jobId} booked ${plains.length} different ${size} sheets into the printing area; say which one the run prints on.`;
            else if (models.length === 0) problem = `No stock item for ${codeName(plain, r.model, finishedSize)}. Ask the office to add it.`;
            else if (models.length > 1) problem = `${models.length} stock items for ${codeName(plain, r.model, finishedSize)}; the office should keep one.`;
            runs.push({
                key: `${job.jobId}|${r.model}`,
                sourceJob: job.jobId,
                sourceJobName: job.jobName,
                model: r.model,
                sheetSize: size,
                finishedSize,
                cutInto,
                // Plain sheets into the machine.
                runSheets,
                // Printed sheets as stocked -- halves, on a sheet cut in two.
                orderSheets,
                readySheets: ready,
                stockSheets: runSheets * cutInto - orderSheets,
                subOrders: subOrders.map((so) => ({ id: num(so.id), customer: num(so.customer), shop: so.shop, city: so.city })),
                plainItem: plain ? num(plain.item) : null,
                modelItem: models.length === 1 ? num(models[0].item) : null,
                problem
            });
        }
    }
    return runs;
};

// The model-number orders whose design is not printed yet: their customer's
// print has nothing to go on until it is. Orders of a run still waiting in the
// queue, and of a run made but not completed.
export const ordersAwaitingRun = (runs = [], madeRuns = []) => {
    const ids = new Set();
    for (const run of runs) for (const so of run.subOrders) ids.add(num(so.id));
    for (const r of madeRuns) {
        if (truthy(r.completed)) continue;
        for (const id of refList(r.sub_orders)) ids.add(id);
    }
    return ids;
};

// ---- making a batch of runs ------------------------------------------------

export const runBatchProblem = (runs) => {
    if (!runs?.length) return 'Pick at least one model run.';
    const stuck = runs.find((r) => r.problem);
    return stuck ? stuck.problem : null;
};

export const runBatchFields = ({ date }) => ({ Date: date, Machine: MODEL_RUN_MACHINE });

export const runJobFields = (batchId, run) => ({
    Printing_Job_Batch: batchId,
    Printing_Colours: runColours(run.model),
    Sub_Orders: ['L', ...run.subOrders.map((so) => so.id)],
    Source_Jobs: ['L', run.sourceJob],
    Model_Design: norm(run.model),
    Sheet_Size: run.sheetSize,
    Run_Sheets: run.runSheets,
    Order_Sheets: run.orderSheets,
    Cut_Into: run.cutInto || 1,
    Plain_Item: run.plainItem,
    Model_Item: run.modelItem
});

// One output for the whole run: it is printed for no one shop.
export const runOutputFields = (jobId, run) => ({
    Printing_Job: jobId,
    Customer: null,
    Sub_Orders: ['L', ...run.subOrders.map((so) => so.id)]
});

// ---- the company plate -----------------------------------------------------

// A company plate seen for the first time, registered as it is picked. It sits
// on no city rack; the plates incharge says where it lives on the register.
export const companyPlateRecord = (job) => ({
    Plate_Type: COMPANY_PLATE,
    Model_Design: norm(job.modelDesign),
    Material: 'NON-WOVEN',
    Print: 'MODEL NUMBER',
    Printing_Colours: 'MULTI COLOUR',
    Plate_Count: 1,
    Orders: ['L', ...(job.subOrderIds || [])],
    Reusable: true,
    Notes: 'Company model plate, registered when first picked'
});
// Its one physical plate, out with the run (printingJobs.registrationSides):
// a design's status comes from its sides (plateSets.designStatus).
export const companySideFields = (job) => ({ Status: 'ISSUED', Issued_To_Job: job.id, Verified: true });

// ---- completing a run --------------------------------------------------------

// form = { sheetsUsed, printedCount, printedKg, misprintKg, wastageKg }
//
// sheetsUsed   plain sheets that went into the machine (the run, unless told otherwise)
// printedCount good sheets that came out with the design on
export const runCompletionProblems = (job, form) => {
    const problems = [];
    const whole = (raw, label) => {
        const v = Number(raw);
        if (raw === '' || raw == null || !Number.isInteger(v) || v <= 0) problems.push(`Enter the ${label}, as a whole number.`);
        return v;
    };
    const weight = (raw, label, positive) => {
        const v = Number(raw);
        if (raw === '' || raw == null || !Number.isFinite(v) || v < 0) problems.push(`Enter the ${label} in kg (0 if none).`);
        else if (positive && v === 0) problems.push(`The ${label} cannot be 0 when something was printed.`);
    };
    const used = whole(form?.sheetsUsed, 'plain sheets used');
    const printed = whole(form?.printedCount, 'sheets printed');
    if (used > 0 && printed > used) problems.push(`${printed} printed is more than the ${used} plain sheets used.`);
    if (!num(job?.plainItem) || !num(job?.modelItem)) problems.push('This run has no stock items to book; it was made before they were set.');
    weight(form?.printedKg, 'printed weight', true);
    weight(form?.misprintKg, 'misprint weight', false);
    weight(form?.wastageKg, 'wastage for the job', false);
    return problems;
};

// Where a run's printed sheets go: its orders' share stays in the printing area
// for the customer's print, the rest goes to the shelf. A short run fills the
// orders first -- they are what is owed.
//
// printedCount is good sheets off the machine; on a sheet cut in two each is two
// stocked sheets (cutInto), and the orders' share is counted in those.
export const runSplit = (job, printedCount) => {
    const printed = Math.max(Math.floor(num(printedCount)), 0) * Math.max(1, num(job?.cutInto) || 1);
    const toOrders = Math.min(printed, Math.max(num(job?.orderSheets), 0));
    return { toOrders, toStock: printed - toOrders, short: Math.max(num(job?.orderSheets) - printed, 0) };
};

// The stock a completed run moves, as Inventory_Transactions records. Left for
// the area incharges to acknowledge, like every other booking by the floor.
export const runBooking = (job, form, now) => {
    const { toOrders, toStock } = runSplit(job, form.printedCount);
    const tag = `${norm(job.modelDesign)} design run, printing job ${job.id}`;
    const row = (Item_ID, Transaction_Type, Location, count, note) => ({
        Item_ID, Transaction_Type, Location, Count_Bundles_: count,
        Printing_Job: job.id, Transaction_Time: now, Note: `${tag}: ${note}`
    });
    return [
        row(num(job.plainItem), 'LESS', PRINTING_AREA, Math.floor(num(form.sheetsUsed)), 'plain sheets into the machine'),
        toOrders > 0 && row(num(job.modelItem), 'ADD', PRINTING_AREA, toOrders, 'printed for the orders, customer print next'),
        toStock > 0 && row(num(job.modelItem), 'ADD', BAGS_GODOWN, toStock, 'printed beyond the orders, to stock')
    ].filter(Boolean);
};

// The run's figures, its stock, and the job closed -- one bundle, so stock is
// never booked for a run that is not marked done, nor the other way round.
export const runCompletionActions = (job, form, now) => {
    const out = (job.outputs || [])[0];
    return [
        ...(out ? [['UpdateRecord', 'Printing_Job_Outputs', out.id, {
            Printed_Count: Number(form.printedCount),
            Printed_Weight_Kg_: Number(form.printedKg),
            Misprint_Weight_Kg_: Number(form.misprintKg)
        }]] : []),
        ...runBooking(job, form, now).map((fields) => ['AddRecord', TXN_TABLE, null, fields]),
        ['UpdateRecord', JOBS_TABLE, job.id, {
            Printing_Completed: true,
            Wastage_Weight_Kg_: Number(form.wastageKg),
            Damaged_Plates: ['L', ...(form.damaged || []).filter((id) => (job.plates || []).includes(id))]
        }]
    ];
};
