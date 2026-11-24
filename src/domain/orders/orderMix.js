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

// Each month's targets (Grist Sales_Targets, one row per month, Month the first
// day). A month is set one of two ways:
//
// - One figure (Value_Target alone, as October 2026): it covers every order
//   except new customers' first orders, salesmen's included, so Regular + Other
//   counts against it and New is shown for reference only.
// - By category (Regular_Target, Other_Target, New_Target, each with an
//   optional orders target; from November 2026): Regular, Other and New each
//   have their own target, kept separate, and all three count towards the
//   month. Value_Target is then the month's overall figure (₹1 crore for
//   November); left blank, it is the three added up.
export const TARGETS_SQL = `
    SELECT strftime('%Y-%m', Month, 'unixepoch') AS month, Value_Target AS target,
           Regular_Target AS regularTarget, Regular_Orders_Target AS regularOrders,
           Other_Target AS otherTarget, Other_Orders_Target AS otherOrders,
           New_Target AS newTarget, New_Orders_Target AS newOrders
    FROM Sales_Targets
    WHERE Month >= ? AND Month < ?`;

// Blank, zero or not a number is no target: a row typed in ahead of time and
// not filled yet must not show 0% or divide by zero.
const positive = (v) => (num(v) > 0 ? num(v) : null);

// One Sales_Targets row as { value, kinds }. `kinds` is null for a one-figure
// month, else { regular, other, new } with { value, orders } each (either may
// be null: a category with no target of its own). Null when the row sets no
// target at all.
export const parseTarget = (r = {}) => {
    const fields = { [REGULAR]: ['regularTarget', 'regularOrders'], [OTHER]: ['otherTarget', 'otherOrders'], [NEW]: ['newTarget', 'newOrders'] };
    const kinds = Object.fromEntries(KINDS.map((k) => [k, { value: positive(r[fields[k][0]]), orders: positive(r[fields[k][1]]) }]));
    const split = KINDS.some((k) => kinds[k].value);
    const value = positive(r.target) ?? (split ? KINDS.reduce((s, k) => s + (kinds[k].value || 0), 0) : null);
    return value ? { value, kinds: split ? kinds : null } : null;
};

// Month → target ({ value, kinds }). Two rows for one month: the later one
// wins, as it is the correction.
export const targetMap = (rows = []) => {
    const map = new Map();
    for (const r of rows) {
        const target = parseTarget(r);
        if (r.month && target) map.set(r.month, target);
    }
    return map;
};

// A plain number is a one-figure target (how older callers and tests pass it).
const asTarget = (t) => (typeof t === 'number' ? (t > 0 ? { value: t, kinds: null } : null) : t || null);

// Whether New counts towards the month: only when it has a target of its own.
export const countsNew = (t) => !!asTarget(t)?.kinds?.[NEW]?.value;

// The value that counts against the month's figure: Regular + Other, and New
// too when the month gives New its own target.
export const targetValue = (line, t) =>
    line[REGULAR].value + line[OTHER].value + (countsNew(t) ? line[NEW].value : 0);

// A line against its month's figure: what counts, the figure, the share
// reached (0.628 for 62.8%) and whether New is in it. Null with no target, so
// the page shows nothing rather than a made-up 0%.
export const targetProgress = (line, target) => {
    const t = asTarget(target);
    if (!line || !t) return null;
    const achieved = targetValue(line, t);
    return { achieved, target: t.value, share: achieved / t.value, withNew: countsNew(t) };
};

// Under each column, kind → { share, own, counted, orders }:
// - by category: the share of that column's own target (own), and its orders
//   target; a column with no target of its own gets nothing.
// - one figure: the share of the month's figure; Regular and Other add up to
//   it, New is beside it for reference only (counted false).
// Null with no target.
export const kindShares = (line, target) => {
    const t = asTarget(target);
    if (!line || !t) return null;
    if (t.kinds) {
        return Object.fromEntries(KINDS.map((k) => {
            const own = t.kinds[k];
            return [k, own.value ? { share: line[k].value / own.value, own: true, counted: true, orders: own.orders } : null];
        }));
    }
    return Object.fromEntries(KINDS.map((k) => [k, { share: line[k].value / t.value, own: false, counted: k !== NEW, orders: null }]));
};

// Every month from `from` to `to`, oldest first.
export const monthsBetween = ({ from, to }) => {
    const out = [];
    for (let m = from; m <= to && out.length < 1200; m = shiftMonth(m, 1)) out.push(m);
    return out;
};

// The range's targets added up, only when every month in it has one: adding up
// two months' targets against three months' orders would flatter the figure.
// By category only when every month is set by category; a range mixing the two
// ways keeps just the overall figure (mixed: no column shares for it).
export const rangeTarget = (range, targets) => {
    const months = monthsBetween(range);
    if (!months.length || months.some((m) => !targets.has(m))) return null;
    const ts = months.map((m) => asTarget(targets.get(m)));
    const value = ts.reduce((s, t) => s + t.value, 0);
    if (!ts.every((t) => t.kinds)) return { value, kinds: null, months: ts, mixed: ts.some((t) => t.kinds) };
    const sum = (k, f) => {
        const vals = ts.map((t) => t.kinds[k][f]);
        return vals.every((v) => v) ? vals.reduce((s, v) => s + v, 0) : null;
    };
    const kinds = Object.fromEntries(KINDS.map((k) => [k, { value: sum(k, 'value'), orders: sum(k, 'orders') }]));
    return { value, kinds, months: ts, mixed: false };
};

// The range against its added-up figure. Each month counts the way its own
// target does (New in for a month set by category, out for a one-figure month),
// so the months' lines are passed in. Null with no range target.
export const rangeProgress = (monthLines, range, targets) => {
    const t = rangeTarget(range, targets);
    if (!t) return null;
    const byMonth = new Map(monthLines.map((m) => [m.month, m]));
    const achieved = monthsBetween(range).reduce((s, m) => {
        const line = byMonth.get(m);
        return s + (line ? targetValue(line, targets.get(m)) : 0);
    }, 0);
    const withNew = t.months.some(countsNew);
    return { achieved, target: t.value, share: achieved / t.value, withNew, split: !!t.kinds, targets: t };
};

// What counts towards a figure, in words. A range mixing the two ways counts
// New in some months only, so it says just "Counted orders".
export const countedLabel = (progress) => {
    if (progress?.targets?.mixed) return 'Counted orders';
    return progress?.withNew ? 'Regular + Other + New' : 'Regular + Other';
};

// "62.8%": one decimal, so a month that is close shows its last lakh moving.
export const percentText = (share) => `${(Math.round(share * 1000) / 10).toFixed(1)}%`;
