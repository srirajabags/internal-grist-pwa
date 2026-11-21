// Orders by area group and month, split three ways: new orders, repeat orders
// from Regular customers, and repeat orders from every other customer. A count
// and a rupee value for each.
//
// Regular is the customer's TEMP_FALLBACK_SALES_CATEGORY (Customers), read live,
// so a customer tagged Regular today counts as Regular in every month shown.

// Grouped in Grist, so the page pulls a few hundred figures, not every order.
// Order_Form_Date is a Grist Date (seconds at UTC midnight of the day), so the
// month comes out of strftime with no time-zone shift. Is_Repeat_Order is a
// formula column; when it errors (a customer with no Date_of_Entry) SQLite
// holds an error blob, which matches neither 0 nor 1 and comes back as null.
export const ORDER_MIX_SQL = `
    SELECT strftime('%Y-%m', o.Order_Form_Date, 'unixepoch') AS month,
           o.Area_Group AS areaId, g.Area_Group AS area,
           CASE WHEN o.Is_Repeat_Order = 0 THEN 0 WHEN o.Is_Repeat_Order = 1 THEN 1 END AS repeat,
           UPPER(TRIM(COALESCE(c.TEMP_FALLBACK_SALES_CATEGORY, ''))) AS category,
           COUNT(*) AS orders, SUM(o.Order_Value) AS value
    FROM Orders o
    LEFT JOIN Customers c ON c.id = o.Customer
    LEFT JOIN Area_Groups g ON g.id = o.Area_Group
    WHERE o.Order_Form_Date >= ? AND o.Order_Form_Date < ?
    GROUP BY 1, 2, 3, 4, 5`;

export const REGULAR = 'regular';
export const OTHER = 'other';
export const NEW = 'new';
export const KINDS = [REGULAR, OTHER, NEW];
export const KIND_LABEL = { [REGULAR]: 'Regular', [OTHER]: 'Other', [NEW]: 'New' };

export const NO_AREA = 'No area group';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// Which of the three an order is. New wins: 1,129 of the 1,219 first orders
// (Nov 2026) are from customers since tagged Regular, and counting those as
// Regular would hide nearly every new customer the team brought in. Only a
// definite "not a repeat" is new; an errored flag goes by the category.
export const orderKind = ({ repeat, category }) => {
    if (repeat === 0 || repeat === false) return NEW;
    return String(category ?? '').trim().toUpperCase() === 'REGULAR' ? REGULAR : OTHER;
};

const emptyLine = () => ({
    [REGULAR]: { orders: 0, value: 0 },
    [OTHER]: { orders: 0, value: 0 },
    [NEW]: { orders: 0, value: 0 },
    total: { orders: 0, value: 0 }
});

const add = (line, kind, orders, value) => {
    line[kind].orders += orders;
    line[kind].value += value;
    line.total.orders += orders;
    line.total.value += value;
};

export const areaName = (row) => (num(row.areaId) ? String(row.area ?? '').trim() || `Area ${num(row.areaId)}` : NO_AREA);

// Area groups A–Z, with orders that have no area group at the bottom.
const byArea = (a, b) => (a.area === NO_AREA) - (b.area === NO_AREA) || a.area.localeCompare(b.area);

const areaRows = (map) => [...map.entries()].map(([area, line]) => ({ area, ...line })).sort(byArea);

// The grouped rows as the page shows them: each month (newest first) with its
// area groups, the area groups over the whole range, and the grand total.
// `areas` narrows it to those area groups (by name); empty means all of them,
// so an untouched filter shows everything rather than nothing.
export const buildOrderMix = (rows, areas = []) => {
    const only = areas.length ? new Set(areas) : null;
    const months = new Map();
    const rangeAreas = new Map();
    const total = emptyLine();
    for (const r of rows) {
        if (!r.month) continue;
        const kind = orderKind(r);
        const orders = num(r.orders);
        const value = num(r.value);
        const area = areaName(r);
        if (only && !only.has(area)) continue;
        if (!months.has(r.month)) months.set(r.month, { total: emptyLine(), areas: new Map() });
        const m = months.get(r.month);
        if (!m.areas.has(area)) m.areas.set(area, emptyLine());
        if (!rangeAreas.has(area)) rangeAreas.set(area, emptyLine());
        add(m.areas.get(area), kind, orders, value);
        add(m.total, kind, orders, value);
        add(rangeAreas.get(area), kind, orders, value);
        add(total, kind, orders, value);
    }
    return {
        months: [...months.keys()].sort().reverse().map((month) => ({
            month,
            ...months.get(month).total,
            areas: areaRows(months.get(month).areas)
        })),
        areas: areaRows(rangeAreas),
        total
    };
};

// ---- Months -----------------------------------------------------------------

export const DEFAULT_MONTHS = 3;

const MONTH_RE = /^(\d{4})-(\d{2})$/;
const validMonth = (text) => {
    const m = MONTH_RE.exec(String(text || ''));
    return m && Number(m[2]) >= 1 && Number(m[2]) <= 12 ? text : null;
};

// The month in India, as 'YYYY-MM'.
export const istMonth = (date = new Date()) =>
    new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 7);

const shiftMonth = (text, by) => {
    const [y, m] = text.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + by, 1));
    return d.toISOString().slice(0, 7);
};

// The months shown, from the address (?from=&to=, 'YYYY-MM'): this month and
// the two before it by default. A month in the future is pulled back to this
// month, and a range given backwards is turned round.
export const monthRange = (fromText, toText, now = new Date()) => {
    const current = istMonth(now);
    const cap = (t) => (t > current ? current : t);
    let to = cap(validMonth(toText) || current);
    let from = cap(validMonth(fromText) || shiftMonth(to, -(DEFAULT_MONTHS - 1)));
    if (from > to) [from, to] = [to, from];
    return { from, to };
};

// The range as Grist Date seconds: the first day of `from` up to, not
// including, the first day of the month after `to`.
export const monthBounds = ({ from, to }) => {
    const start = (text) => {
        const [y, m] = text.split('-').map(Number);
        return Date.UTC(y, m - 1, 1) / 1000;
    };
    return { from: start(from), to: start(shiftMonth(to, 1)) };
};

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthLabel = (text) => {
    const m = MONTH_RE.exec(String(text || ''));
    return m ? `${MONTH_NAMES[Number(m[2]) - 1]} ${m[1]}` : String(text || '');
};

// ---- Area filter ------------------------------------------------------------

// The chosen area groups travel in the address as ?areas=Adoni|Guntur. A pipe,
// not a comma, as area names are typed by hand and could carry one.
export const AREA_SEP = '|';
export const parseAreas = (text) =>
    [...new Set(String(text || '').split(AREA_SEP).map((a) => a.trim()).filter(Boolean))];
export const areasParam = (areas) => areas.join(AREA_SEP);

// How the filter reads in a heading and in a shared picture.
export const areasLabel = (areas) => {
    if (!areas.length) return 'All area groups';
    if (areas.length <= 3) return areas.join(', ');
    return `${areas.slice(0, 2).join(', ')} +${areas.length - 2} more`;
};

// ---- Targets ----------------------------------------------------------------

// Each month's value target (Grist Sales_Targets, one row per month, Month the
// first day). The target covers every order except new customers' first
// orders, salesmen's included, so what counts against it is Regular + Other.
// It is the same figure the telecallers' target pay is worked out from.
export const TARGETS_SQL = `
    SELECT strftime('%Y-%m', Month, 'unixepoch') AS month, Value_Target AS target
    FROM Sales_Targets
    WHERE Month >= ? AND Month < ?`;

// Month → target. A blank or zero target is no target (a row typed in ahead of
// time and not filled yet must not show 0% or divide by zero). Two rows for one
// month: the later one wins, as it is the correction.
export const targetMap = (rows = []) => {
    const map = new Map();
    for (const r of rows) {
        const target = num(r.target);
        if (r.month && target > 0) map.set(r.month, target);
    }
    return map;
};

// The value that counts against the target: everything but new orders.
export const targetValue = (line) => line[REGULAR].value + line[OTHER].value;

// A line against its target: what counts, the target, and the share reached
// (0.628 for 62.8%). Null with no target, so the page shows nothing rather
// than a made-up 0%.
export const targetProgress = (line, target) => {
    if (!line || !(target > 0)) return null;
    const achieved = targetValue(line);
    return { achieved, target, share: achieved / target };
};

// Each kind as its own share of the target: Regular and Other add up to the
// figure above; New is beside it for reference only, as the target leaves new
// customers out. Null with no target.
export const kindShares = (line, target) => {
    if (!line || !(target > 0)) return null;
    return Object.fromEntries(KINDS.map((k) => [k, line[k].value / target]));
};

// Every month from `from` to `to`, oldest first.
export const monthsBetween = ({ from, to }) => {
    const out = [];
    for (let m = from; m <= to && out.length < 1200; m = shiftMonth(m, 1)) out.push(m);
    return out;
};

// The range's total target, only when every month in it has one: adding up
// two months' targets against three months' orders would flatter the figure.
export const rangeTarget = (range, targets) => {
    const months = monthsBetween(range);
    if (!months.length || months.some((m) => !targets.has(m))) return null;
    return months.reduce((sum, m) => sum + targets.get(m), 0);
};

// "62.8%": one decimal, so a month that is close shows its last lakh moving.
export const percentText = (share) => `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
