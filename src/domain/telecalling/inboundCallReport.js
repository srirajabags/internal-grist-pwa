// The inbound call registry as a pivot: who dealt with the calls, day by day,
// against what each call came to, and how many of them turned into an order.

// Counted in Grist, one row per (person, day, status), so the page pulls a few
// hundred figures rather than every call. Created_Date is a Grist Date: seconds
// at UTC midnight of the day the call came in.
export const INBOUND_PIVOT_SQL = `
    SELECT c.Dealt_By AS dealtBy, t.Name AS name, c.Created_Date AS day,
           c.Status_Update AS status, COUNT(*) AS calls
    FROM Inbound_Calls_Registry c
    LEFT JOIN Team t ON t.id = c.Dealt_By
    WHERE c.Created_Date >= ? AND c.Created_Date <= ?
    GROUP BY c.Dealt_By, t.Name, c.Created_Date, c.Status_Update`;

export const ORDER_STATUS = 'GIVEN ORDER';
export const NO_STATUS = 'No status';
export const NOT_DEALT = 'Not dealt yet';
// Not a status of its own: every call that did not give an order, the ones with
// no status yet included. Used to list the calls behind the "not given" share.
export const NOT_ORDER = 'Not given order';

// Status_Update's choices, in the order the column offers them. A status typed
// in by hand ("same customer") is not lost: it gets its own column after these.
export const STATUS_ORDER = [
    'GIVEN ORDER',
    'SALESMAN VISIT REQUESTED',
    'WAITING FOR ADVANCE',
    'SAMPLES SENT',
    'PHONE NUMBER INVALID',
    'FOLLOWUP DATE',
    'ORDER END',
    'NOT RESPOND-SAMPLE SENT - CALL DONE'
];

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// A stray trailing space must not split one status into two columns.
export const statusOf = (raw) => String(raw ?? '').trim() || NO_STATUS;

// The statuses that occur, as columns: the known choices in their own order,
// then anything typed in, then calls with no status at all.
export const statusColumns = (rows) => {
    const seen = new Set(rows.map((r) => statusOf(r.status)));
    const known = STATUS_ORDER.filter((s) => seen.has(s));
    const extra = [...seen]
        .filter((s) => !STATUS_ORDER.includes(s) && s !== NO_STATUS)
        .sort((a, b) => a.localeCompare(b));
    return [...known, ...extra, ...(seen.has(NO_STATUS) ? [NO_STATUS] : [])];
};

// Orders as a share of every call in the row, calls not yet dealt with
// included. Null when there were no calls, so a blank is not read as 0%.
export const orderPct = (line) => (line.total > 0 ? (line.counts[ORDER_STATUS] || 0) / line.total * 100 : null);
export const notOrderCount = (line) => line.total - (line.counts[ORDER_STATUS] || 0);
// The rest of the row, so the two shares always make 100.
export const notOrderPct = (line) => (line.total > 0 ? notOrderCount(line) / line.total * 100 : null);

const emptyLine = () => ({ counts: {}, total: 0 });
const add = (line, status, calls) => {
    line.counts[status] = (line.counts[status] || 0) + calls;
    line.total += calls;
};

// The busiest person first, and calls nobody has dealt with yet last, so they
// do not sit among the telecallers.
const byPerson = (a, b) => (!a.id - !b.id) || (b.total - a.total) || a.name.localeCompare(b.name);

// One block per day, oldest first, and under it the people who dealt with that
// day's calls.
export const pivot = (rows) => {
    const days = new Map();
    const grand = emptyLine();
    for (const r of rows) {
        const id = num(r.dealtBy);
        const calls = num(r.calls);
        const status = statusOf(r.status);
        const day = num(r.day);
        if (!days.has(day)) days.set(day, { day, people: new Map(), ...emptyLine() });
        const block = days.get(day);
        if (!block.people.has(id)) {
            block.people.set(id, { id, name: id ? (r.name || `Team #${id}`) : NOT_DEALT, ...emptyLine() });
        }
        add(block.people.get(id), status, calls);
        add(block, status, calls);
        add(grand, status, calls);
    }
    const list = [...days.values()]
        .map((d) => ({ ...d, people: [...d.people.values()].sort(byPerson) }))
        .sort((a, b) => a.day - b.day);
    return { columns: statusColumns(rows), days: list, grand };
};

// ---- Date range -------------------------------------------------------------

// 'YYYY-MM-DD' to the seconds Grist stores for that Date, or null.
export const dateToGrist = (text) => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ''));
    if (!m) return null;
    const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return Number.isNaN(ms) ? null : ms / 1000;
};

// The calendar day in India, as 'YYYY-MM-DD'. The registry is kept in IST, so
// "today" has to be India's today, not the phone's or UTC's.
export const istDay = (date = new Date()) =>
    new Date(date.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);

export const DEFAULT_DAYS = 7;

// The last seven days, today included, unless the address says otherwise. A
// range given backwards is turned round rather than shown empty.
export const reportRange = (fromText, toText, now = new Date()) => {
    const today = istDay(now);
    const weekAgo = new Date((dateToGrist(today) - (DEFAULT_DAYS - 1) * 86400) * 1000).toISOString().slice(0, 10);
    let from = dateToGrist(fromText) != null ? fromText : weekAgo;
    let to = dateToGrist(toText) != null ? toText : today;
    if (dateToGrist(from) > dateToGrist(to)) [from, to] = [to, from];
    return { from, to };
};

// ---- The calls behind a figure ---------------------------------------------

const DETAIL_SELECT = `
    SELECT c.id, c.Phone_Number AS phone, c.Created_at AS createdAt, c.Created_Date AS day,
           c.Status_Update AS status, COALESCE(c.Dealt_By, 0) AS dealtBy, t.Name AS dealtByName,
           c.Dealt_At AS dealtAt, c.Comments AS comments, c.Telecaller_Comments AS telecallerComments,
           c.Verifier_Comments AS verifierComments, c.Calculated_Sales_Category AS category,
           c.Shop_Name_New_Customers_ AS newShop, a.City AS newCity,
           cu.Shop_Name AS shop, cu.Customer_Firstname AS firstName, cu.Customer_Lastname AS lastName,
           cu.City AS city, ag.Area_Group AS areaGroup
    FROM Inbound_Calls_Registry c
    LEFT JOIN Team t ON t.id = c.Dealt_By
    LEFT JOIN Customers cu ON cu.id = c.Customer
    LEFT JOIN Areas a ON a.id = c.City_New_Customers_
    LEFT JOIN Area_Groups ag ON ag.id = cu.Area_Group`;

// A figure in the table names a cell: a day (or the whole range, for the grand
// total), a person (or everyone, for a day's line) and a status (or every
// status, for Total). The calls behind it are the same filters, so the list
// always adds up to the figure that was tapped.
export const detailQuery = ({ from, to }, { day = null, dealtBy = null, status = null } = {}) => {
    const where = ['c.Created_Date >= ?', 'c.Created_Date <= ?'];
    const args = day != null ? [num(day), num(day)] : [dateToGrist(from), dateToGrist(to)];
    if (dealtBy != null) {
        where.push('COALESCE(c.Dealt_By, 0) = ?');
        args.push(num(dealtBy));
    }
    if (status === NOT_ORDER) {
        where.push("TRIM(COALESCE(c.Status_Update, '')) <> ?");
        args.push(ORDER_STATUS);
    } else if (status != null) {
        // Trimmed, as statusOf does, or "same customer " would list nothing.
        where.push("TRIM(COALESCE(c.Status_Update, '')) = ?");
        args.push(status === NO_STATUS ? '' : status);
    }
    return { sql: `${DETAIL_SELECT}\n    WHERE ${where.join(' AND ')}\n    ORDER BY c.Created_at, c.id`, args };
};

// A known customer's own record first; for a new caller, what the telecaller
// typed in on the call.
export const shopOf = (call) => String(call.shop || call.newShop || '').trim();
export const placeOf = (call) => String(call.city || call.newCity || '').trim();
export const contactOf = (call) => [call.firstName, call.lastName].map((s) => String(s || '').trim()).filter(Boolean).join(' ');
