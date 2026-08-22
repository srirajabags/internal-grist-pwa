#!/usr/bin/env node
// Creates the four Grist tables behind /printing and /stitching:
//
//   Printing_Job_Batches   Printing_Jobs
//   Stitching_Job_Batches  Stitching_Jobs
//
// A batch is one day's work at a stage; a job is one sub-order at that stage,
// mirroring Factory_Production_Job_Batches / Factory_Production_Jobs.
//
// Creating tables is a document *structure* change, which the PWA's proxy key is
// not allowed to make ("Blocked by table structure access rules"), so run this
// with an owner API key:
//
//   GRIST_URL=https://your-grist-host \
//   GRIST_API_KEY=xxxxxxxx \
//   node scripts/create-stage-tables.mjs
//
// It is additive and safe to re-read: it refuses to run if any of the tables
// already exist, so it can never clobber live data.

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || '').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;

if (!BASE || !KEY) {
    console.error('Set GRIST_URL and GRIST_API_KEY (an owner key) and try again.');
    process.exit(1);
}

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

const col = (id, type, extra = {}) => ({ id, fields: { label: id.replace(/_/g, ' ').trim(), type, ...extra } });
const formula = (id, type, f) => col(id, type, { isFormula: true, formula: f });

const stage = (name, ref, started, completed) => ([
    {
        id: `${name}_Job_Batches`,
        columns: [
            col('Date', 'Date'),
            col('Notes', 'Text')
        ]
    },
    {
        id: `${name}_Jobs`,
        columns: [
            col(ref, `Ref:${name}_Job_Batches`),
            col('Sub_Order', 'Ref:Sub_Orders'),
            // Where the work came from, so a job can be traced back up the line.
            col('Source_Job', 'Ref:Factory_Production_Jobs'),
            col('Inventory_Item_Code', 'Ref:Inventory_Item_Codes'),
            col('Inventory_Items', 'RefList:Inventory_Items'),
            col('Input_Location', 'Text'),
            col('Required_Quantity_Kg_', 'Numeric'),
            col('Available_Weight_Kg_', 'Numeric'),
            col(started, 'Bool'),
            col(`${started}_At`, 'DateTime:Asia/Calcutta'),
            col(completed, 'Bool'),
            col(`${completed}_At`, 'DateTime:Asia/Calcutta'),
            col('Output_Weight_Kg_', 'Numeric'),
            col('Output_Count_', 'Numeric'),
            formula('Wastage_Weight_Kg_', 'Numeric',
                `($Available_Weight_Kg_ - $Output_Weight_Kg_) if $${completed} else 0`),
            formula('Model', 'Any', '$Sub_Order.Model'),
            formula('Print', 'Any', '$Sub_Order.Print'),
            formula('Order_ID', 'Any', '$Sub_Order.Order.Order_ID if $Sub_Order else None'),
            formula('Shop', 'Any', '$Sub_Order.Customer.Shop_Name if $Sub_Order else None')
        ]
    }
]);

const tables = [
    ...stage('Printing', 'Printing_Job_Batch', 'Printing_Started', 'Printing_Completed'),
    ...stage('Stitching', 'Stitching_Job_Batch', 'Stitching_Started', 'Stitching_Completed')
];

const existing = new Set((await api('/tables')).tables.map((t) => t.id));
const clash = tables.map((t) => t.id).filter((id) => existing.has(id));
if (clash.length > 0) {
    console.error(`Already present, refusing to touch them: ${clash.join(', ')}`);
    process.exit(1);
}

const res = await api('/tables', 'POST', { tables });
console.log(`Created: ${res.tables.map((t) => t.id).join(', ')}`);
console.log('\n/printing and /stitching will work as soon as this lands.');
