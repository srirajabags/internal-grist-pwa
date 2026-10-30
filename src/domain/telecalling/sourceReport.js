// Where the inbound enquiries came from, and the orders they led to: each
// registry row is matched to its customer by phone (Inbound_Calls_Registry.
// Customer, a lookup on Customers.Phone_Numbers_List), and the customer's
// orders are credited back to the enquiry's Source.

import { dateToGrist, istDay } from './inboundCallReport';

// One row per enquiry: a fortnight of the registry is a few hundred rows.
// Created_Date is a Grist Date (seconds at UTC midnight of the IST day).
export const ENQUIRIES_SQL = `
    SELECT c.id, c.Created_Date AS day, c.Created_at AS createdAt, c.Source AS source,
           COALESCE(c.Customer, 0) AS customer
    FROM Inbound_Calls_Registry c
    WHERE c.Created_Date >= ? AND c.Created_Date <= ?`;

// Only the orders of customers who enquired in the range. The IN list is a
// plain subquery, run once: a correlated one is what times /sql out.
export const ORDERS_SQL = `
    SELECT o.id, o.Customer AS customer, o.Order_Form_Date AS day, o.Order_Value AS value
    FROM Orders o
    WHERE o.Order_Form_Date >= ? AND o.Order_Form_Date <= ?
      AND o.Customer IN (
          SELECT DISTINCT c.Customer FROM Inbound_Calls_Registry c
          WHERE c.Created_Date >= ? AND c.Created_Date <= ? AND c.Customer > 0)`;

// ---- Sources ----------------------------------------------------------------

// Source mixes how a buyer found us (Website, Ads) with the team line and
// medium they used ("9177056061 - W"). The 18 team numbers fold into two
// groups, WhatsApp and call, so the report has a handful of rows, not twenty.
export const NO_SOURCE = 'No source';
export const SOURCE_GROUPS = [
    'Website',
    'Google Ads',
    'WhatsApp API',
    'AI Calls',
    'Team WhatsApp',
    'Team call',
    'Other',
    NO_SOURCE
];

export const sourceGroup = (raw) => {
    const s = String(raw ?? '').trim();
    if (!s) return NO_SOURCE;
    const lower = s.toLowerCase();
    if (lower === 'website') return 'Website';
    if (lower === 'google ads visitor') return 'Google Ads';
    if (lower === 'whatsapp api') return 'WhatsApp API';
    if (lower === 'ai calls') return 'AI Calls';
    if (/-\s*w$/i.test(s)) return 'Team WhatsApp';
    if (/-\s*p$/i.test(s)) return 'Team call';
    return 'Other';
};

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// ---- Crediting orders -------------------------------------------------------

// An order goes to the customer's latest enquiry on or before the order's
// day: the call that led to it. Each order is credited once, so a customer who
// rang twice is not counted twice, and an order dated before any enquiry (a
// regular customer's standing order) goes to no one.
export const creditOrders = (enquiries, orders) => {
    const byCustomer = new Map();
    for (const e of enquiries) {
        const c = num(e.customer);
        if (!c) continue;
        if (!byCustomer.has(c)) byCustomer.set(c, []);
        byCustomer.get(c).push(e);
    }
    for (const list of byCustomer.values()) {
        list.sort((a, b) => num(a.day) - num(b.day) || num(a.createdAt) - num(b.createdAt) || num(a.id) - num(b.id));
    }
    const credited = [];
    for (const o of orders) {
        const list = byCustomer.get(num(o.customer));
        if (!list) continue;
        let lead = null;
        for (const e of list) {
            if (num(e.day) <= num(o.day)) lead = e;
            else break;
        }
        if (lead) credited.push({ order: o, enquiry: lead });
    }
    return credited;
};

const emptyLine = () => ({ enquiries: 0, matched: 0, orders: 0, value: 0 });

// The table for one day: that day's enquiries by source, how many matched a
// customer, and the orders they have led to so far (on any day since).
export const dayTable = (enquiries, credited, day) => {
    const d = num(day);
    const lines = new Map();
    const line = (g) => {
        if (!lines.has(g)) lines.set(g, emptyLine());
        return lines.get(g);
    };
    const total = emptyLine();
    for (const e of enquiries) {
        if (num(e.day) !== d) continue;
        const l = line(sourceGroup(e.source));
        l.enquiries += 1;
        total.enquiries += 1;
        if (num(e.customer)) {
            l.matched += 1;
            total.matched += 1;
        }
    }
    for (const { order, enquiry } of credited) {
        if (num(enquiry.day) !== d) continue;
        const l = line(sourceGroup(enquiry.source));
        l.orders += 1;
        l.value += num(order.value);
        total.orders += 1;
        total.value += num(order.value);
    }
    const rows = SOURCE_GROUPS.filter((g) => lines.has(g)).map((g) => ({ source: g, ...lines.get(g) }));
    return { rows, total };
};

// Day by day over the range, per source: enquiries on the day they came in,
// and orders (count and value) on the day of the order.
export const trend = (enquiries, credited, from, to) => {
    const start = num(from);
    const end = num(to);
    const days = [];
    for (let t = start; t <= end; t += 86400) days.push(t);
    const index = new Map(days.map((t, i) => [t, i]));
    const series = new Map();
    const of = (g) => {
        if (!series.has(g)) {
            series.set(g, {
                enquiries: days.map(() => 0),
                orders: days.map(() => 0),
                value: days.map(() => 0)
            });
        }
        return series.get(g);
    };
    for (const e of enquiries) {
        const i = index.get(num(e.day));
        if (i != null) of(sourceGroup(e.source)).enquiries[i] += 1;
    }
    for (const { order, enquiry } of credited) {
        const i = index.get(num(order.day));
        if (i == null) continue;
        const s = of(sourceGroup(enquiry.source));
        s.orders[i] += 1;
        s.value[i] += num(order.value);
    }
    return {
        days,
        sources: SOURCE_GROUPS.filter((g) => series.has(g)).map((g) => ({ source: g, ...series.get(g) }))
    };
};

// ---- Range ------------------------------------------------------------------

export const TREND_DAYS = 14;

// The table's day, from the address (?day=), or today in India. A day in the
// future is pulled back to today: there is nothing to show for it yet.
export const tableDay = (text, now = new Date()) => {
    const today = istDay(now);
    const t = dateToGrist(text);
    if (t == null || t > dateToGrist(today)) return today;
    return text;
};

// What the page fetches, in Grist Date seconds: the fortnight up to today for
// the chart, reaching further back when the table's day is older than that.
// Orders run to today either way, as an older day's enquiries can still have
// led to an order this week.
export const fetchRange = (day, now = new Date()) => {
    const today = dateToGrist(istDay(now));
    const trendFrom = today - (TREND_DAYS - 1) * 86400;
    return { from: Math.min(trendFrom, dateToGrist(day)), to: today, trendFrom };
};
