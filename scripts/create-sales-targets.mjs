#!/usr/bin/env node
// Creates the Sales_Targets table the Sales report reads (Reports → Sales →
// Regular, Other & New Orders), and fills in the targets already agreed.
//
// One row per month. Value_Target is the month's target for the value of every
// order except new customers' first orders (Is_Repeat_Order unticked) —
// salesmen's orders included. The report shows Regular + Other value as a
// percentage of it. This is the same figure the telecallers' target pay is
// worked out from.
//
// Creating a table is a document *structure* change, which the PWA's proxy key is
// not allowed to make, so run this with an owner API key:
//
//   GRIST_URL=https://grist.srirajabags.in GRIST_API_KEY=xxxxxxxx \
//   node scripts/create-sales-targets.mjs [--dry-run]
//
// Additive: if the table exists it is left alone, and no rows are added.

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!KEY) {
    console.error('Set GRIST_API_KEY (an owner key) and try again.');
    process.exit(1);
}

const TABLE = 'Sales_Targets';
// Grist shows a page's leading emoji as its icon; the API would otherwise name
// the page "Sales_Targets" with a bare letter.
const PAGE = '🏁 Sales Targets';

// Plain data columns: a target is typed in, never worked out.
const col = (id, type, extra = {}) => ({ id, fields: { label: id.replace(/_/g, ' '), type, isFormula: false, ...extra } });
const COLUMNS = [
    // The first day of the month.
    col('Month', 'Date', { widgetOptions: JSON.stringify({ dateFormat: 'MMM YYYY', isCustomDateFormat: true }) }),
    col('Value_Target', 'Numeric', {
        description: 'Target for the value of all orders except new customers\' first orders (salesmen\'s orders included).',
        widgetOptions: JSON.stringify({ numMode: 'currency', currency: 'INR', decimals: 0, maxDecimals: 0 })
    }),
    col('Order_Target', 'Int', { description: 'Target number of orders, excluding new customers\' first orders. For reference.' }),
    col('Notes', 'Text')
];

// Grist Date: seconds at UTC midnight of the day.
const month = (y, m) => Date.UTC(y, m - 1, 1) / 1000;
const ROWS = [
    // Set by the owner for the October 2026 telecaller salaries (16 Nov 2026).
    { Month: month(2026, 10), Value_Target: 8000000, Notes: 'Set for the October salaries' },
    // The November target sheet: includes the extra 10%, leaves out brand-new customers.
    { Month: month(2026, 11), Value_Target: 6930000, Order_Target: 548, Notes: 'November target sheet (includes the extra 10%)' }
];

const api = async (path, method = 'GET', body) => {
    const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${method} ${path}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
};

const existing = new Set((await api('/tables')).tables.map((t) => t.id));
if (existing.has(TABLE)) {
    console.log(`${TABLE} already exists; nothing done.`);
    process.exit(0);
}
if (DRY_RUN) {
    console.log(`Would create ${TABLE} (${COLUMNS.map((c) => c.id).join(', ')}), name its page "${PAGE}", and add ${ROWS.length} rows.`);
    process.exit(0);
}

await api('/tables', 'POST', { tables: [{ id: TABLE, columns: COLUMNS }] });
console.log(`Created ${TABLE}`);

const view = (await api('/sql', 'POST', {
    sql: 'select v.id as view from _grist_Views v join _grist_Tables t on t.primaryViewId = v.id where t.tableId = ?',
    args: [TABLE]
})).records?.[0]?.fields?.view;
if (view) {
    await api('/apply', 'POST', [['UpdateRecord', '_grist_Views', view, { name: PAGE }]]);
    console.log(`Page named "${PAGE}"`);
} else {
    console.log(`Page not found; name it "${PAGE}" by hand`);
}

await api(`/tables/${TABLE}/records`, 'POST', { records: ROWS.map((fields) => ({ fields })) });
console.log(`Added ${ROWS.length} rows`);
