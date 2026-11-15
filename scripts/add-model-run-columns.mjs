#!/usr/bin/env node
// The columns a model-design printing run needs (user, 12 Nov 2026).
//
// A model-number sheet (F12, M3, ...) is cut plain with the rest of a sheet job,
// for the plate's full run (1,100 sheets on 16x19). All of it goes to the
// printing area, takes the model design on the multi-colour machine off the
// company's model plate, and then splits: the orders' sheets go on to the
// customer's print, the rest back to the bags godown already printed.
//
//   Printing_Jobs.Model_Design   F12 -- blank on an ordinary ink-set job
//   Printing_Jobs.Sheet_Size     16x19
//   Printing_Jobs.Run_Sheets     sheets the run prints (the plate's minimum or the orders, whichever is more)
//   Printing_Jobs.Order_Sheets   printed sheets the orders take on to their own print (halves when cut in two)
//   Printing_Jobs.Cut_Into       2 when each printed sheet is cut into two stocked sheets
//   Printing_Jobs.Plain_Item     the plain sheet the run draws from the printing area
//   Printing_Jobs.Model_Item     the printed model sheet it books
//   Printing_Plates.Model_Design the design a company plate prints
//   Printing_Plates.Plate_Type   + COMPANY
//
//   GRIST_URL=https://grist.srirajabags.in GRIST_API_KEY=xxxx \
//   node scripts/add-model-run-columns.mjs [--dry-run]
//
// Safe to run again: a column or choice already there is left alone.

import { COMPANY_PLATE } from '../src/domain/printing/printingPlates.js';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
if (!KEY) throw new Error('GRIST_API_KEY is required (an owner key).');

const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${await res.text()}`);
    return res.json();
};

const columnsOf = async (table) => (await api('GET', `/tables/${table}/columns`)).columns;

const addColumns = async (table, wanted) => {
    const have = new Set((await columnsOf(table)).map((c) => c.id));
    const missing = wanted.filter((c) => !have.has(c.id));
    for (const c of wanted) console.log(`${table}.${c.id}: ${have.has(c.id) ? 'already there' : 'adding'}`);
    if (missing.length && !DRY_RUN) await api('POST', `/tables/${table}/columns`, { columns: missing });
};

await addColumns('Printing_Jobs', [
    { id: 'Model_Design', fields: { type: 'Text', label: 'Model_Design' } },
    { id: 'Sheet_Size', fields: { type: 'Text', label: 'Sheet_Size' } },
    { id: 'Run_Sheets', fields: { type: 'Int', label: 'Run_Sheets' } },
    { id: 'Order_Sheets', fields: { type: 'Int', label: 'Order_Sheets' } },
    // A 12x16 bag's 24x17 sheet is printed twice and cut in two: 2. Blank is 1.
    { id: 'Cut_Into', fields: { type: 'Int', label: 'Cut_Into' } },
    { id: 'Plain_Item', fields: { type: 'Ref:Inventory_Items', label: 'Plain_Item' } },
    { id: 'Model_Item', fields: { type: 'Ref:Inventory_Items', label: 'Model_Item' } }
]);
await addColumns('Printing_Plates', [
    { id: 'Model_Design', fields: { type: 'Text', label: 'Model_Design' } }
]);

const plateType = (await columnsOf('Printing_Plates')).find((c) => c.id === 'Plate_Type');
const options = JSON.parse(plateType.fields.widgetOptions || '{}');
const choices = options.choices || [];
if (choices.includes(COMPANY_PLATE)) {
    console.log(`Printing_Plates.Plate_Type: ${COMPANY_PLATE} already a choice`);
} else {
    console.log(`Printing_Plates.Plate_Type: adding choice ${COMPANY_PLATE}`);
    if (!DRY_RUN) {
        await api('PATCH', '/tables/Printing_Plates/columns', {
            columns: [{ id: 'Plate_Type', fields: { widgetOptions: JSON.stringify({ ...options, choices: [...choices, COMPANY_PLATE] }) } }]
        });
    }
}
