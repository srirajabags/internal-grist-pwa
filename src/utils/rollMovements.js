// Which physical rolls moved between two dates, and by how much.
//
// The stock views answer "what is on the shelf now". This answers "what changed",
// which is the question asked when a count is being reconciled against paperwork,
// or when a set of rolls has to be relabelled after a spell of activity.
//
// Only acknowledged transactions are counted, because those are the only ones the
// stock figures are built from -- a delta computed on a different basis would not
// reconcile against the shelf. Movements still waiting on the incharge are counted
// separately and surfaced, never silently folded in or silently dropped.

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// A date input hands back YYYY-MM-DD. The godown thinks in local days, so a window
// runs from local midnight to local midnight -- the `to` date is inclusive, which
// is what "22nd to 25th" means to the person asking.
export const dayStart = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d).getTime() / 1000;
};
export const dayAfter = (iso) => {
    const [y, m, d] = String(iso || '').split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y, m - 1, d + 1).getTime() / 1000;
};

export const isoDay = (date) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
};

// Today and the three days before it -- the span a shift-end reconciliation covers.
export const defaultWindow = () => {
    const today = new Date();
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 3);
    return { from: isoDay(from), to: isoDay(today) };
};

// Every roll transaction up to the end of the window, split at the start of it:
// what stood before, what moved inside. Grouping by Item_ID is what makes this
// per physical roll rather than per item code.
//
// The eight leading placeholders are all the window start; the last is its end.
export const MOVEMENT_SQL = `
    SELECT
        t.Item_ID   AS item_ref,
        it.Item_ID  AS iid,
        t.Item_Code AS code_ref,
        ic.Item_Code AS name, ic.Type AS itype,
        ic.Material AS mat, ic.Colour AS col, ic.GSM AS gsm,
        ic.Width_Inches_ AS w, ic.Height_Inches_ AS h,
        SUM(CASE WHEN t.Transaction_Time <  ? THEN t.Weight_Change_Kg_ ELSE 0 END) AS opening,
        SUM(CASE WHEN t.Transaction_Time >= ? THEN t.Weight_Change_Kg_ ELSE 0 END) AS delta,
        SUM(CASE WHEN t.Transaction_Time >= ? AND t.Weight_Change_Kg_ > 0
                 THEN t.Weight_Change_Kg_ ELSE 0 END) AS inKg,
        SUM(CASE WHEN t.Transaction_Time >= ? AND t.Weight_Change_Kg_ < 0
                 THEN -t.Weight_Change_Kg_ ELSE 0 END) AS outKg,
        SUM(CASE WHEN t.Transaction_Time >= ? THEN 1 ELSE 0 END) AS moves,
        MAX(CASE WHEN t.Transaction_Time >= ? THEN t.Transaction_Time ELSE 0 END) AS lastAt,
        MAX(CASE WHEN t.Transaction_Time >= ? AND upper(t.Transaction_Type) = 'NEW STOCK'
                 THEN 1 ELSE 0 END) AS isNew,
        GROUP_CONCAT(DISTINCT CASE WHEN t.Transaction_Time >= ? THEN j.Job_ID END) AS jobs
    FROM Inventory_Transactions t
    LEFT JOIN Inventory_Items it ON it.id = t.Item_ID
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
    LEFT JOIN Factory_Production_Jobs j ON j.id = t.Production_Job
    WHERE t.Location = 'ROLLS GODOWN'
      AND t.Incharge_Ack = 1
      AND t.Item_ID != 0
      AND ic.Type LIKE '%ROLL%'
      AND t.Transaction_Time < ?
    GROUP BY t.Item_ID
    HAVING moves > 0
`;

// Movements inside the window that nobody has signed off. They are not in the
// figures above, so the view has to say so rather than quietly under-report.
export const UNACKED_SQL = `
    SELECT COUNT(*) AS n, COUNT(DISTINCT t.Item_ID) AS rolls
    FROM Inventory_Transactions t
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
    WHERE t.Location = 'ROLLS GODOWN'
      AND (t.Incharge_Ack IS NULL OR t.Incharge_Ack = 0)
      AND ic.Type LIKE '%ROLL%'
      AND t.Transaction_Time >= ? AND t.Transaction_Time < ?
`;

export const movementArgs = (from, to) => [from, from, from, from, from, from, from, from, to];

// Closing weight is the opening plus what moved -- derived rather than queried, so
// the three figures on a row can never disagree with each other.
export const withClosing = (row) => ({
    ...row,
    opening: num(row.opening),
    delta: num(row.delta),
    closing: num(row.opening) + num(row.delta),
    inKg: num(row.inKg),
    outKg: num(row.outKg),
    moves: num(row.moves),
    jobList: String(row.jobs || '').split(',').map((s) => s.trim()).filter(Boolean)
});

// Biggest movers first: the point of the view is to see what changed most. Ties
// fall back to the roll id so the order is stable between runs.
export const byImpact = (a, b) =>
    Math.abs(b.delta) - Math.abs(a.delta) || String(a.iid || '').localeCompare(String(b.iid || ''));

export const totals = (rows) => rows.reduce((acc, r) => ({
    rolls: acc.rolls + 1,
    inKg: acc.inKg + r.inKg,
    outKg: acc.outKg + r.outKg,
    delta: acc.delta + r.delta,
    moves: acc.moves + r.moves,
    emptied: acc.emptied + (r.closing <= 0.005 && r.delta < 0 ? 1 : 0),
    arrived: acc.arrived + (r.isNew ? 1 : 0)
}), { rolls: 0, inKg: 0, outKg: 0, delta: 0, moves: 0, emptied: 0, arrived: 0 });

// A window's worth of labels wants a name that says which window.
export const zipName = (from, to) => `roll-labels_${from}_to_${to}.zip`;

// ---- CSV ----------------------------------------------------------------
// The same rows the view shows, for a spreadsheet. Deliberately plain: one line
// per roll, no totals row and no merged headings, so it can be sorted, filtered
// and pivoted on arrival rather than cleaned up first.

const csvCell = (v) => {
    const s = v == null ? '' : String(v);
    // A field containing a comma, quote or newline has to be quoted, and quotes
    // inside it doubled. Everything else goes through untouched.
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// Two decimals, plain minus sign, no thousands separator -- a spreadsheet has to
// read these as numbers, so they carry no formatting of their own.
const csvKg = (v) => num(v).toFixed(2);

const csvDate = (ts) => {
    if (num(ts) <= 0) return '';
    const d = new Date(num(ts) * 1000);
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

export const CSV_COLUMNS = [
    ['Roll ID', (r) => r.iid],
    ['Item Code', (r) => r.name],
    ['Material', (r) => r.mat],
    ['Colour', (r) => r.col],
    ['GSM', (r) => r.gsm],
    ['Width (in)', (r) => r.w],
    ['Opening Kg', (r) => csvKg(r.opening)],
    ['In Kg', (r) => csvKg(r.inKg)],
    ['Out Kg', (r) => csvKg(r.outKg)],
    ['Delta Kg', (r) => csvKg(r.delta)],
    ['Closing Kg', (r) => csvKg(r.closing)],
    ['Movements', (r) => r.moves],
    ['New Roll', (r) => (r.isNew ? 'YES' : '')],
    ['Emptied', (r) => (r.closing <= 0.005 && r.delta < 0 ? 'YES' : '')],
    ['Last Movement', (r) => csvDate(r.lastAt)],
    ['Jobs', (r) => r.jobList.join(' | ')]
];

export const movementsCsv = (rows) => {
    const lines = [CSV_COLUMNS.map(([head]) => csvCell(head)).join(',')];
    for (const row of rows) {
        lines.push(CSV_COLUMNS.map(([, read]) => csvCell(read(row))).join(','));
    }
    // CRLF and a BOM: Excel opens the file correctly on both Windows and Mac
    // without an import step, which is where these end up.
    return `\uFEFF${lines.join('\r\n')}\r\n`;
};

export const csvName = (from, to) => `roll-movements_${from}_to_${to}.csv`;
