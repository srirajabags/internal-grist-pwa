// The godown runbook: every movement, in the order it happened, with the balance
// it left behind.
//
// The stock views answer "what is on the shelf"; roll movements answers "what
// changed, per roll". This answers "what happened, and in what order" -- the view
// you want when a figure looks wrong and you need to walk back through how it got
// there. So the unit here is one transaction, not one item.
//
// Bags godown is the main subject, but rolls and the printing area are the same
// kind of record and are included; the filters decide what is on screen.

import { countUnitFor } from './txnDisplay';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

export const LOCATIONS = ['BAGS GODOWN', 'ROLLS GODOWN', 'PRINTING AREA'];

// A date input hands back YYYY-MM-DD. The godown thinks in local days, so a window
// runs from local midnight to local midnight, the `to` date included.
export const dayStart = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d).getTime() / 1000 : null;
};
export const dayAfter = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    return y && m && d ? new Date(y, m - 1, d + 1).getTime() / 1000 : null;
};
export const isoDay = (date) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

// A week, ending today -- long enough to hold a run of work, short enough to read.
export const defaultWindow = () => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7);
    return { from: isoDay(from), to: isoDay(today) };
};

// Every movement in the window, with what it moved, who booked it and why.
// Deliberately unfiltered beyond the dates: the whole document holds a few
// thousand rows, so a window is small, and filtering in the browser lets the
// filters answer instantly instead of costing a round trip each.
export const LEDGER_SQL = `
    SELECT
        tx.id                     AS id,
        tx.Transaction_Time       AS ts,
        tx.Transaction_Type       AS type,
        tx.Weight_Change_Kg_      AS wkg,
        tx.Count_Change_Bundle_   AS cbund,
        tx.Location               AS loc,
        tx.Incharge_Ack           AS ack,
        tx.Item_ID                AS itemRef,
        it.Item_ID                AS item,
        ic.id                     AS codeId,
        ic.Item_Code              AS code,
        ic.Type                   AS itype,
        ic.Material               AS material,
        ic.Colour                 AS colour,
        ic.GSM                    AS gsm,
        ic.Width_Inches_          AS w,
        ic.Height_Inches_         AS h,
        tm.Name                   AS who,
        j.Job_ID                  AS job
    FROM Inventory_Transactions tx
    LEFT JOIN Inventory_Items it ON it.id = tx.Item_ID
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = it.Item_Code
    LEFT JOIN Team tm ON tm.id = tx.Created_by
    LEFT JOIN Factory_Production_Jobs j ON j.id = tx.Production_Job
    WHERE tx.Transaction_Time >= ? AND tx.Transaction_Time < ?
    ORDER BY tx.Transaction_Time ASC, tx.id ASC
`;

// Where each item stood when the window opened. Without this a balance would
// start from zero half way through an item's life and every figure after it would
// be wrong -- convincingly wrong, which is worse.
export const OPENING_SQL = `
    SELECT tx.Item_ID AS itemRef, tx.Location AS loc,
           ROUND(SUM(tx.Weight_Change_Kg_), 3) AS kg,
           ROUND(SUM(tx.Count_Change_Bundle_), 3) AS cnt
    FROM Inventory_Transactions tx
    WHERE tx.Transaction_Time < ? AND COALESCE(tx.Incharge_Ack, 0) = 1
    GROUP BY tx.Item_ID, tx.Location
`;

// Stock is kept per item per location, so a balance is only meaningful per pair.
const keyOf = (r) => `${num(r.itemRef)}@${r.loc || ''}`;

// Walk the window in the order it happened, carrying each item's balance forward.
//
// Only acknowledged movements move the balance -- they are the ones the stock
// figures are built from, so a runbook that counted the others would not reconcile
// with the shelf. An unacknowledged row is still listed, and still shows its own
// delta; it simply leaves the balance where it was, and is flagged so the gap
// between the two is visible rather than mysterious.
export const withBalances = (rows, openings = []) => {
    const balance = new Map();
    for (const o of openings) {
        balance.set(keyOf(o), { kg: num(o.kg), cnt: num(o.cnt) });
    }
    const out = [];
    for (const r of [...rows].sort((a, b) => num(a.ts) - num(b.ts) || num(a.id) - num(b.id))) {
        const k = keyOf(r);
        const at = balance.get(k) || { kg: 0, cnt: 0 };
        const acked = truthy(r.ack);
        if (acked) {
            at.kg += num(r.wkg);
            at.cnt += num(r.cbund);
            balance.set(k, at);
        }
        out.push({
            ...r,
            acked,
            countUnit: countUnitFor(r.itype, r.code),
            balanceKg: Math.round(at.kg * 1000) / 1000,
            balanceCount: Math.round(at.cnt * 1000) / 1000
        });
    }
    return out;
};

// What the filter chips offer, taken from the rows on hand rather than a fixed
// list: a type nobody has moved is a filter that can only ever return nothing.
export const optionsFrom = (rows) => ({
    types: [...new Set(rows.map((r) => r.itype).filter(Boolean))].sort(),
    locations: LOCATIONS.filter((l) => rows.some((r) => r.loc === l)),
    items: [...new Map(rows.filter((r) => r.item)
        .map((r) => [num(r.itemRef), { ref: num(r.itemRef), name: r.item, code: r.code, itype: r.itype }]))
        .values()].sort((a, b) => String(a.name).localeCompare(String(b.name)))
});

// An empty selection means "everything", which is what an untouched filter should
// do -- not "nothing", which would open the view on a blank screen.
const passes = (chosen, value) => chosen.length === 0 || chosen.includes(value);

export const applyFilters = (rows, { types = [], locations = [], items = [], search = '' } = {}) => {
    const needle = String(search || '').trim().toUpperCase();
    return rows.filter((r) => passes(types, r.itype)
        && passes(locations, r.loc)
        && passes(items.map(num), num(r.itemRef))
        && (!needle || `${r.item} ${r.code} ${r.who} ${r.job} ${r.material} ${r.colour}`.toUpperCase().includes(needle)));
};

// Totals for what is on screen. Weight and count are separate columns in the
// document and separate denominations on the floor, so they are never added
// together into one number.
export const ledgerTotals = (rows) => rows.reduce((t, r) => ({
    moves: t.moves + 1,
    inKg: t.inKg + (num(r.wkg) > 0 ? num(r.wkg) : 0),
    outKg: t.outKg + (num(r.wkg) < 0 ? -num(r.wkg) : 0),
    inCount: t.inCount + (num(r.cbund) > 0 ? num(r.cbund) : 0),
    outCount: t.outCount + (num(r.cbund) < 0 ? -num(r.cbund) : 0),
    unacked: t.unacked + (r.acked ? 0 : 1)
}), { moves: 0, inKg: 0, outKg: 0, inCount: 0, outCount: 0, unacked: 0 });

export const csvName = (from, to) => `godown-ledger_${from}_to_${to}.csv`;

export const LEDGER_CSV_COLUMNS = [
    ['Date', (r) => new Date(num(r.ts) * 1000).toLocaleDateString('en-CA')],
    ['Time', (r) => new Date(num(r.ts) * 1000).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })],
    ['Location', (r) => r.loc ?? ''],
    ['Item ID', (r) => r.item ?? ''],
    ['Item Code', (r) => r.code ?? ''],
    ['Type', (r) => r.itype ?? ''],
    ['Material', (r) => r.material ?? ''],
    ['Colour', (r) => r.colour ?? ''],
    ['GSM', (r) => r.gsm ?? ''],
    ['Movement', (r) => r.type ?? ''],
    ['Delta Kg', (r) => (num(r.wkg) ? num(r.wkg).toFixed(2) : '')],
    ['Delta Count', (r) => (num(r.cbund) ? num(r.cbund) : '')],
    ['Count Unit', (r) => (num(r.cbund) ? r.countUnit : '')],
    ['Balance Kg', (r) => num(r.balanceKg).toFixed(2)],
    ['Balance Count', (r) => num(r.balanceCount)],
    ['Acknowledged', (r) => (r.acked ? 'YES' : 'NO')],
    ['Entered By', (r) => r.who ?? ''],
    ['Production Job', (r) => r.job ?? '']
];

export const LEDGER_CSV_HEADERS = LEDGER_CSV_COLUMNS.map(([h]) => h);
export const ledgerCsvRows = (rows) => rows.map((r) => LEDGER_CSV_COLUMNS.map(([, read]) => read(r)));

export { norm, truthy };
