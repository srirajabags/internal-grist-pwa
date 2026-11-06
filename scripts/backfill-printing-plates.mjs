#!/usr/bin/env node
// Fills Printing_Plates from the sub-orders, ahead of the one on-ground check
// that confirms what is really on the racks.
//
//   GRIST_URL=https://grist.srirajabags.in GRIST_API_KEY=xxxx \
//   node scripts/backfill-printing-plates.mjs [--dry-run] [--replace]
//
// Sub-orders are the source of truth (user, 1 Nov 2026): every customer whose
// orders used a plate or a stereo gets the rows registerRows makes -- one per
// design, filed in the slot the shop's name gives for its kind. See
// domain/printing/plateRegister.js for how orders become designs.
//
// Every row starts TO BE VERIFIED, and its movement log starts with ADDED.
//
// Re-running skips customers who already have plates. --replace instead clears
// the register first and rebuilds it -- refused if anyone has touched a plate
// (checked it, moved it, picked it for a job, named it on a repeat order),
// because those are facts from the floor that a rebuild would throw away.

import { registerRows } from '../src/domain/printing/plateRegister.js';
import { STATUS } from '../src/domain/printing/printingPlates.js';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');
const REPLACE = process.argv.includes('--replace');
const CHUNK = 400;

if (!KEY) {
    console.error('Set GRIST_API_KEY and try again.');
    process.exit(1);
}

const api = async (path, method = 'GET', body) => {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
                method,
                headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
                body: body ? JSON.stringify(body) : undefined
            });
            const text = await res.text();
            if (!res.ok) throw new Error(`${res.status} ${method} ${path}: ${text.slice(0, 500)}`);
            return text ? JSON.parse(text) : null;
        } catch (err) {
            // A dropped connection is retried; a refusal from Grist is not.
            if (attempt >= 3 || !/fetch failed/.test(err.message)) throw err;
        }
    }
};
const sql = async (q) => ((await api('/sql', 'POST', { sql: q })).records || []).map((r) => r.fields);
const one = async (q) => Object.values((await sql(q))[0] || {})[0];

// ---- replace: only an untouched register may be thrown away -------------------

if (REPLACE) {
    const touched = {
        'plates checked, moved or retired': await one(`SELECT COUNT(*) FROM Printing_Plates
            WHERE Verified = 1 OR Status != '${STATUS.UNVERIFIED}'`),
        'movements other than ADDED': await one(`SELECT COUNT(*) FROM Printing_Plate_Movements WHERE Action != 'ADDED'`),
        'plates named on repeat orders': await one(`SELECT COUNT(*) FROM Sub_Orders
            WHERE Reused_Plates IS NOT NULL AND Reused_Plates NOT IN ('', '[]')`),
        'plates on printing jobs': await one(`SELECT COUNT(*) FROM Printing_Jobs
            WHERE Plates IS NOT NULL AND Plates NOT IN ('', '[]')`)
    };
    const found = Object.entries(touched).filter(([, n]) => n > 0);
    if (found.length) {
        console.error('Refusing to replace: the floor has already worked with this register.');
        for (const [what, n] of found) console.error(`  ${n} ${what}`);
        process.exit(1);
    }
    const plates = (await sql('SELECT id FROM Printing_Plates')).map((r) => r.id);
    const moves = (await sql('SELECT id FROM Printing_Plate_Movements')).map((r) => r.id);
    console.log(`Clearing ${plates.length} plates and ${moves.length} movements.`);
    if (!DRY_RUN) {
        for (let i = 0; i < moves.length; i += 2000) {
            await api('/apply', 'POST', [['BulkRemoveRecord', 'Printing_Plate_Movements', moves.slice(i, i + 2000)]]);
        }
        for (let i = 0; i < plates.length; i += 2000) {
            await api('/apply', 'POST', [['BulkRemoveRecord', 'Printing_Plates', plates.slice(i, i + 2000)]]);
        }
    }
}

// ---- build ---------------------------------------------------------------------

const orders = await sql(`
    SELECT so.id, so.Customer AS customer, so.Plate AS plate, so.Print AS print,
           so.Material AS material, so.Model AS model, so.Bag_Width AS bag_w, so.Bag_Height AS bag_h,
           so.Plate_Count AS plate_count, so.Order_Form_Date AS order_date,
           so.Printing_Colour AS printing_colour, so.Design_Version AS design_version,
           so.Old_Plate_Available AS old_plate_available, so.Status AS status, so.Cancelled AS cancelled,
           c.Shop_Name AS shop, c.City AS city
    FROM Sub_Orders so
    JOIN Customers c ON c.id = so.Customer
    WHERE so.Plate IN ('PLATE', 'STEREO')`);

// In a dry run of --replace the old rows are still there; count as if cleared.
const have = REPLACE ? new Set() : new Set((await sql(
    'SELECT DISTINCT Customer AS c FROM Printing_Plates WHERE Customer > 0')).map((r) => r.c));

const byCustomer = new Map();
for (const o of orders) {
    if (!byCustomer.has(o.customer)) byCustomer.set(o.customer, { customer: o.customer, shop: o.shop, city: o.city, subOrders: [] });
    byCustomer.get(o.customer).subOrders.push({
        id: o.id, plate: o.plate, print: o.print, material: o.material, model: o.model,
        bagW: o.bag_w, bagH: o.bag_h, plateCount: o.plate_count, orderDate: o.order_date,
        printingColour: o.printing_colour, designVersion: o.design_version,
        oldPlateAvailable: o.old_plate_available, status: o.status, cancelled: Boolean(o.cancelled)
    });
}

const rows = [];
let skipped = 0;
for (const group of byCustomer.values()) {
    if (have.has(group.customer)) { skipped++; continue; }
    rows.push(...registerRows(group));
}

const tally = (key) => rows.reduce((m, r) => ({ ...m, [r[key]]: (m[r[key]] || 0) + 1 }), {});
console.log(`${orders.length} sub-orders with a plate, from ${byCustomer.size} customers` +
    (skipped ? ` (${skipped} already in the register, skipped)` : '') + '.');
console.log(`${rows.length} plates to add:`, tally('Plate_Type'));
console.log(`  with a rack code: ${rows.filter((r) => r.Slot).length}, without: ${rows.filter((r) => !r.Slot).length}`);
console.log(`  slots with no order on record: ${rows.filter((r) => !r.Orders).length}`);
console.log(`  designs made before the records: ${rows.filter((r) => r.Orders && !r.Made_On).length}`);
if (DRY_RUN) {
    console.log(rows.slice(0, 2));
    process.exit(0);
}

let added = 0;
for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const keys = Object.keys(chunk[0]);
    const cols = Object.fromEntries(keys.map((k) => [k, chunk.map((p) => p[k])]));
    const res = await api('/apply', 'POST', [['BulkAddRecord', 'Printing_Plates', chunk.map(() => null), cols]]);
    const ids = res.retValues[0];
    // The log's first line for each plate, so its history starts where it did.
    await api('/apply', 'POST', [['BulkAddRecord', 'Printing_Plate_Movements', ids.map(() => null), {
        Plate: ids,
        Action: ids.map(() => 'ADDED'),
        Status_After: ids.map(() => STATUS.UNVERIFIED),
        Rack: chunk.map((p) => p.Rack),
        Slot: chunk.map((p) => p.Slot),
        Notes: ids.map(() => 'Built from Sub_Orders, 1 Nov 2026')
    }]]);
    added += ids.length;
    console.log(`  ${added}/${rows.length}`);
}
console.log('Done.');
