// The batch-wise report: the rolls godown before a group of batches, what the
// group drew, made, handed back and lost, and the rolls godown after it.
//
// The group is whatever the floor treats as one: on paper a batch number covered
// every type run around the same days -- D cut, sheets, side patty, handles --
// while here each type is its own batch. So the report takes any set of batches
// and reads them as one, a row per type, the way the paper form lays them out.
//
// It is the paper "BATCH WISE REPORT" the floor fills in by hand, read off the
// transactions instead. The batch figures come from jobLedger -- the same
// function the production page uses -- so the report and the batch card can
// never disagree about what a batch did.

import { jobLedger } from './jobLedger';
import { ROLLS_GODOWN } from '../inventory/godown';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();
const round = (v) => Math.round(num(v) * 100) / 100;
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// The roll materials, in the order the paper form lists them. Keys are the
// Inventory_Item_Codes.Material values; labels are what the floor calls them.
export const ROLL_MATERIALS = [
    { key: 'NW REGULAR', label: 'NW Regular' },
    { key: 'NW VIRGIN', label: 'NW Virgin' },
    { key: 'NW BOPP', label: 'NW BOPP' },
    { key: 'NW OUTSIDE LAMINATION', label: 'Out L', hint: 'Outside lamination' },
    { key: 'NW INNER LAMINATION', label: 'Inner L', hint: 'Inner lamination' }
];
export const OTHER_MATERIAL = { key: 'OTHER', label: 'Other' };

// A roll is still a roll on the shelf until less than this is left on it -- the
// same cut-off the roll movements view uses for "emptied".
export const EMPTY_ROLL_KG = 0.005;

const isRoll = (t) => norm(t?.itype) === 'ROLL';

// Every batch, newest first, for the picker.
export const BATCH_LIST_SQL = `
    SELECT id, Job_Batch_ID AS name, Type AS type, Date AS date,
           Production_Started_At AS startedAt,
           Production_Completed_At AS completedAt,
           Remaining_Inventory_Returned AS returned,
           Inventory_Returned_At AS returnedAt,
           Jobs AS jobs
    FROM Factory_Production_Job_Batches
    ORDER BY COALESCE(Date, 0) DESC, id DESC
`;

// Every movement the batch's jobs wrote. Read by the item's own code, as the
// production page reads them, so a line is a roll or an article on the same
// terms there and here. One argument: batchIdsArg(ids).
export const BATCH_TXN_SQL = `
    SELECT t.id AS id, t.Production_Job AS job, j.Job_ID AS jobName,
           t.Transaction_Type AS type, t.Weight_Kg_ AS kg, t.Count_Bundles_ AS cnt,
           t.Location AS loc, COALESCE(t.Incharge_Ack, 0) AS ack,
           t.Transaction_Time AS ts,
           it.Item_ID AS item, ic.Item_Code AS code, ic.Type AS itype,
           ic.Material AS material, ic.Width_Inches_ AS w,
           ic.Height_Inches_ AS h, ic.GSM AS gsm
    FROM Inventory_Transactions t
    LEFT JOIN Inventory_Items it ON it.id = t.Item_ID
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = it.Item_Code
    LEFT JOIN Factory_Production_Jobs j ON j.id = t.Production_Job
    WHERE t.Production_Job IN (
        SELECT jj.value
        FROM Factory_Production_Job_Batches b
        JOIN json_each(CASE WHEN json_valid(b.Jobs) THEN b.Jobs ELSE '[]' END) jj
        WHERE b.id IN (SELECT value FROM json_each(?)) AND jj.value != 'L')
    ORDER BY t.Transaction_Time, t.id
`;

// Each roll's acknowledged weight in the rolls godown at two moments: strictly
// before the first, and up to and including the second. Per roll rather than per
// material so the rolls can be counted as well as weighed. Acknowledged only,
// because that is what every stock figure in the app is built from.
export const ROLL_BALANCE_SQL = `
    SELECT t.Item_ID AS item, ic.Material AS material,
           SUM(CASE WHEN t.Transaction_Time < ? THEN t.Weight_Change_Kg_ ELSE 0 END) AS beforeKg,
           SUM(CASE WHEN t.Transaction_Time <= ? THEN t.Weight_Change_Kg_ ELSE 0 END) AS afterKg
    FROM Inventory_Transactions t
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
    WHERE t.Location = 'ROLLS GODOWN'
      AND t.Incharge_Ack = 1
      AND t.Item_ID != 0
      AND ic.Type LIKE '%ROLL%'
    GROUP BY t.Item_ID
`;

// Everything that moved in the rolls godown between the two moments, by material
// and by who moved it. The window is exactly the gap between the two balances
// (from the before moment, through the after moment), so its sum is the change.
// Arguments: batchIdsArg(ids), then the two moments.
export const ROLL_CHANGE_SQL = `
    SELECT ic.Material AS material,
           CASE WHEN t.Production_Job IN (
                    SELECT jj.value
                    FROM Factory_Production_Job_Batches b
                    JOIN json_each(CASE WHEN json_valid(b.Jobs) THEN b.Jobs ELSE '[]' END) jj
                    WHERE b.id IN (SELECT value FROM json_each(?)) AND jj.value != 'L')
                THEN 1 ELSE 0 END AS inBatch,
           CASE WHEN COALESCE(t.Production_Job, 0) > 0 THEN 1 ELSE 0 END AS hasJob,
           SUM(t.Weight_Change_Kg_) AS kg
    FROM Inventory_Transactions t
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
    WHERE t.Location = 'ROLLS GODOWN'
      AND t.Incharge_Ack = 1
      AND t.Item_ID != 0
      AND ic.Type LIKE '%ROLL%'
      AND t.Transaction_Time >= ? AND t.Transaction_Time <= ?
    GROUP BY 1, 2, 3
`;

// The batch ids travel to the queries as one JSON array argument, so the SQL
// text is the same however many are picked.
export const batchIdsArg = (ids = []) => JSON.stringify((ids || []).map(num).filter((n) => n > 0));

// The picked batches as the URL carries them ("56,57"): whole positive ids, each
// once, in a stable order. Anything else in the string is ignored rather than
// failing the page.
export const parseBatchIds = (text) => [...new Set(String(text ?? '')
    .split(',')
    .map((p) => Number(p.trim()))
    .filter((n) => Number.isInteger(n) && n > 0))]
    .sort((a, b) => a - b);

// Batches.Jobs is a Grist reference list: JSON text such as "[531,532]", with an
// "L" marker in some encodings.
export const jobIdsOf = (batch) => {
    let v = batch?.jobs;
    if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
    return Array.isArray(v) ? v.filter((x) => x !== 'L').map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
};

// The order of the type rows on the paper form. Types it does not name follow.
export const REPORT_TYPE_ORDER = [
    'ROLLS TO DCUT',
    'ROLLS TO SHEETS',
    'ROLLS TO SIDEPATTY',
    'ROLLS TO HANDLES',
    'ROLLS TO PRESSING HANDLES'
];
const typeOrder = (type) => {
    const i = REPORT_TYPE_ORDER.indexOf(norm(type));
    return i >= 0 ? i : REPORT_TYPE_ORDER.length;
};

// The picker's list: batches grouped by their batch date, newest day first, so a
// day's worth -- the usual group -- can be ticked in one go.
export const batchesByDay = (batches = []) => {
    const days = new Map();
    for (const b of batches || []) {
        const key = num(b.date);
        if (!days.has(key)) days.set(key, { date: key, batches: [] });
        days.get(key).batches.push(b);
    }
    return [...days.values()]
        .sort((a, b) => b.date - a.date)
        .map((d) => ({ ...d, batches: d.batches.sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || num(a.id) - num(b.id)) }));
};

// Same test the production page uses to move a batch into its history: the work
// is done and the rolls left over have been walked back.
export const isBatchClosed = (batch) =>
    num(batch?.completedAt) > 0 && truthy(batch?.returned);

export const batchStatus = (batch) => {
    if (isBatchClosed(batch)) return 'Closed';
    if (num(batch?.completedAt) > 0) return 'Rolls not returned';
    if (num(batch?.startedAt) > 0) return 'Running';
    return 'Not started';
};

// The "24" in "2026-09-09 - ROLLS TO SHEETS - 24": what the batch is called out
// loud. The row id is the fallback while Job_Batch_ID has not computed.
export const batchNumber = (batch) => {
    const last = String(batch?.name ?? '').split(' - ').map((p) => p.trim()).filter(Boolean).pop();
    return /^\d+$/.test(last || '') ? last : String(batch?.id ?? '');
};

// Rebuild each job the way the production page's query shapes it, so jobLedger
// reads both identically:
//
//   ROLL     LESS   collected        ROLL     ADD   returned
//   article  ADD    +1 output line   article  else  -1 (ready stock drawn)
//
// A job is filed under the material of the roll it drew most of. A job that drew
// no roll at all -- answered from ready stock -- has no material of its own.
export const jobsFromTxns = (txns = []) => {
    const jobs = new Map();
    for (const t of txns || []) {
        const id = num(t.job);
        if (!id) continue;
        if (!jobs.has(id)) {
            jobs.set(id, { id, name: t.jobName, collectedKg: 0, returnedKg: 0, outputLines: [], _rollKg: new Map() });
        }
        const job = jobs.get(id);
        const type = norm(t.type);
        const kg = Math.abs(num(t.kg));
        if (isRoll(t)) {
            if (type === 'LESS') {
                job.collectedKg += kg;
                const mat = norm(t.material) || OTHER_MATERIAL.key;
                job._rollKg.set(mat, (job._rollKg.get(mat) || 0) + kg);
            } else if (type === 'ADD') {
                job.returnedKg += kg;
            }
            continue;
        }
        job.outputLines.push({
            item: t.item, code: t.code, type: t.itype,
            w: t.w, h: t.h, gsm: t.gsm,
            kg, cnt: Math.abs(num(t.cnt)), loc: t.loc,
            dir: type === 'ADD' ? 1 : -1
        });
    }
    return [...jobs.values()].map(({ _rollKg, ...job }) => {
        let material = null;
        let most = -1;
        for (const [mat, kg] of _rollKg) {
            if (kg > most) { most = kg; material = mat; }
        }
        return { ...job, material };
    });
};

const materialMeta = (key) =>
    ROLL_MATERIALS.find((m) => m.key === key)
    || (key ? { key, label: key } : { key: null, label: 'No roll drawn' });

const materialOrder = (key) => {
    const i = ROLL_MATERIALS.findIndex((m) => m.key === key);
    return i >= 0 ? i : ROLL_MATERIALS.length + (key ? 0 : 1);
};

const ZERO = { collected: 0, produced: 0, returned: 0, wastage: 0 };
const add = (a, b) => ({
    collected: round(a.collected + b.collected),
    produced: round(a.produced + b.produced),
    returned: round(a.returned + b.returned),
    wastage: round(a.wastage + b.wastage)
});

// The batch section of the form: roll kg, made kg, return and waste, one row per
// roll material the batch cut, and the total. A job that has booked nothing is
// left out rather than shown as a row of zeroes.
export const batchFigures = (txns = []) => {
    const groups = new Map();
    for (const job of jobsFromTxns(txns)) {
        const l = jobLedger(job);
        if (l.empty) continue;
        const key = job.material;
        const g = groups.get(key) || { ...materialMeta(key), jobs: 0, ...ZERO };
        groups.set(key, { ...g, ...add(g, l), jobs: g.jobs + 1 });
    }
    const rows = [...groups.values()].sort((a, b) => materialOrder(a.key) - materialOrder(b.key));
    const total = rows.reduce((t, r) => add(t, r), ZERO);
    return { rows, total: { ...total, jobs: rows.reduce((n, r) => n + r.jobs, 0) } };
};

// The batch section for a group: one block per batch type, in the paper form's
// order, each with its batches, its figures by roll material and its own total;
// then the total of the whole group. A movement is filed under the type of the
// batch whose job wrote it. A picked type with nothing booked still gets its
// block, so the report shows it was in the group.
export const groupFigures = (batches = [], txns = []) => {
    const batchOfJob = new Map();
    for (const b of batches || []) {
        for (const j of jobIdsOf(b)) if (!batchOfJob.has(j)) batchOfJob.set(j, b);
    }
    const types = new Map();
    for (const b of batches || []) {
        const type = norm(b.type) || 'UNKNOWN';
        if (!types.has(type)) types.set(type, { type, batches: [], txns: [] });
        types.get(type).batches.push(b);
    }
    for (const t of txns || []) {
        const b = batchOfJob.get(num(t.job));
        if (b) types.get(norm(b.type) || 'UNKNOWN').txns.push(t);
    }
    const blocks = [...types.values()]
        .sort((a, b) => typeOrder(a.type) - typeOrder(b.type) || a.type.localeCompare(b.type))
        .map(({ type, batches: list, txns: own }) => ({
            type,
            batches: [...list].sort((a, b) => num(a.date) - num(b.date) || num(a.id) - num(b.id)),
            ...batchFigures(own)
        }));
    const total = blocks.reduce((t, k) => ({ ...add(t, k.total), jobs: t.jobs + k.total.jobs }), { ...ZERO, jobs: 0 });
    return { blocks, total };
};

// Wastage as a share of the roll that went into the machine -- the figure the
// floor actually compares batch to batch. Nothing to say when no roll went in.
export const wastagePct = (row) =>
    num(row?.collected) > 0 ? Math.round((num(row.wastage) / num(row.collected)) * 1000) / 10 : null;

// When "before" and "after" are, for a group of batches.
//
// Before is the instant the group first touched the rolls godown, so the balance
// is everything up to but not including its first draw. After is its last roll
// movement -- a return -- and only once every batch in the group is closed: until
// the leftover rolls are back, an "after" figure would be missing them. Movements
// of other kinds (ready stock, finished goods) only stand in when the group drew
// no roll.
//
// null means "not yet": the caller shows the stock as it stands now.
export const balanceMoments = (batches = [], txns = []) => {
    const all = (txns || []).filter((t) => num(t.ts) > 0);
    const rolls = all.filter((t) => isRoll(t) && norm(t.loc) === ROLLS_GODOWN);
    const times = (rolls.length > 0 ? rolls : all).map((t) => num(t.ts));
    if (times.length === 0) return { before: null, after: null };
    return {
        before: Math.min(...times),
        after: (batches || []).length > 0 && batches.every(isBatchClosed) ? Math.max(...times) : null
    };
};

// The rolls godown at one moment, by material. `field` names which of the two
// balances in ROLL_BALANCE_SQL to read.
//
// Weight is summed as the books hold it, negatives included, so the total agrees
// with the stock views. Rolls are counted only while they have something left on
// them: an emptied roll is still a row in the ledger, not a roll on the shelf.
export const rollBalances = (rows = [], field) => {
    const by = new Map(ROLL_MATERIALS.map((m) => [m.key, { ...m, kg: 0, rolls: 0 }]));
    for (const r of rows || []) {
        const key = by.has(norm(r.material)) ? norm(r.material) : OTHER_MATERIAL.key;
        if (!by.has(key)) by.set(key, { ...OTHER_MATERIAL, kg: 0, rolls: 0 });
        const at = by.get(key);
        const kg = num(r[field]);
        at.kg += kg;
        if (kg > EMPTY_ROLL_KG) at.rolls += 1;
    }
    const list = [...by.values()]
        // The five on the form always show; anything else only when it holds stock.
        .filter((m) => m.key !== OTHER_MATERIAL.key || Math.abs(m.kg) > EMPTY_ROLL_KG || m.rolls > 0)
        .map((m) => ({ ...m, kg: round(m.kg) }));
    return {
        rows: list,
        total: list.reduce((t, m) => ({ kg: round(t.kg + m.kg), rolls: t.rolls + m.rolls }), { kg: 0, rolls: 0 })
    };
};

// Why the rolls godown changed between before and after: this batch's own draws
// and returns, other jobs running at the same time, and everything booked
// against no job at all -- new stock arriving, manual corrections. Without it the
// change column reads as this batch's doing, when a delivery can dwarf it.
//
// A movement belongs to the batch if its job is one of the batch's; to "other
// batches" if it carries any other job; otherwise it is stock and adjustments.
export const changeBreakdown = (rows = []) => {
    const blank = () => ({ batch: 0, other: 0, stock: 0, net: 0 });
    const by = new Map(ROLL_MATERIALS.map((m) => [m.key, { ...m, ...blank() }]));
    for (const r of rows || []) {
        const key = by.has(norm(r.material)) ? norm(r.material) : OTHER_MATERIAL.key;
        if (!by.has(key)) by.set(key, { ...OTHER_MATERIAL, ...blank() });
        const at = by.get(key);
        const kg = num(r.kg);
        if (truthy(r.inBatch)) at.batch += kg;
        else if (truthy(r.hasJob)) at.other += kg;
        else at.stock += kg;
        at.net += kg;
    }
    const tidy = (m) => ({ ...m, batch: round(m.batch), other: round(m.other), stock: round(m.stock), net: round(m.net) });
    const list = [...by.values()]
        .filter((m) => m.key !== OTHER_MATERIAL.key || Math.abs(m.net) > EMPTY_ROLL_KG || Math.abs(m.batch) + Math.abs(m.other) + Math.abs(m.stock) > EMPTY_ROLL_KG)
        .map(tidy);
    const total = list.reduce((t, m) => ({
        batch: t.batch + m.batch, other: t.other + m.other, stock: t.stock + m.stock, net: t.net + m.net
    }), blank());
    return { rows: list, total: tidy(total) };
};

// Movements the godown has not signed for. They are in the batch figures (the
// production page counts them too) but not in either balance, so the report has
// to say so rather than leave the two not adding up.
export const unackedCount = (txns = []) => (txns || []).filter((t) => !truthy(t.ack)).length;
