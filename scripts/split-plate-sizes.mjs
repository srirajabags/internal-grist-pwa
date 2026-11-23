#!/usr/bin/env node
// One design per bag size (user, 23 Nov 2026: "for different sizes different
// plates are done").
//
// The register built before then put a repeat order of a bigger bag on a
// smaller plate that "fits" it, so 772 designs held orders of more than one
// size (PL-00114: its 12x14 orders and the 14x18 ones) -- and 12x14 with 14x12,
// which are different plates too (user, 23 Nov 2026). This splits each such
// design: the group of orders holding its own plate order stays on it, every
// other size becomes a new design in the same slot (splitBySize in
// src/domain/printing/plateRegister.js). The new designs' facts -- size,
// material, print, plate count, plate order -- come from their plate order by
// the trigger formulas; their sides come from scripts/plate-sides.mjs, run
// after this; their pictures from the nightly picture job.
//
//   GRIST_API_KEY=xxxx node scripts/split-plate-sizes.mjs [--dry-run]
//
// Safe to run again: a design whose orders are one size is left alone.

import { splitBySize } from '../src/domain/printing/plateRegister.js';
import { designNo } from '../src/domain/printing/plateSets.js';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
if (!KEY) throw new Error('GRIST_API_KEY is required (an owner key).');
const DRY_RUN = process.argv.includes('--dry-run');

const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
        method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
};
const sql = async (q) => ((await api('POST', '/sql', { sql: q })).records || []).map((r) => r.fields);
const refs = (v) => { try { return (JSON.parse(v || '[]') || []).filter((x) => typeof x === 'number'); } catch { return []; } };
const size = ([w, h]) => `${w}x${h}`;
const say = (m) => console.log(`${DRY_RUN ? '[dry run] ' : ''}${m}`);

const designs = await sql(`SELECT id, Customer AS customer, Plate_Type AS plate_type, Rack AS rack, Slot AS slot,
    Source_Sub_Order AS source, Bag_Width AS bag_w, Bag_Height AS bag_h, Orders AS orders
    FROM Printing_Plates WHERE Orders IS NOT NULL AND Orders NOT IN ('', '[]')`);
const subOrders = new Map((await sql(`SELECT id, Plate AS plate, Print AS print, Material AS material, Bag_Width AS bag_w,
    Bag_Height AS bag_h, Plate_Count AS plate_count, Order_Form_Date AS order_date, Design_Version AS design_version,
    Old_Plate_Available AS old_plate_available FROM Sub_Orders`)).map((o) => [o.id, {
    id: o.id, plate: o.plate, print: o.print, material: o.material, bagW: o.bag_w, bagH: o.bag_h,
    plateCount: o.plate_count, orderDate: o.order_date, designVersion: o.design_version, oldPlateAvailable: o.old_plate_available
}]));

const updates = [];
const adds = [];
const report = [];
for (const d of designs) {
    const orders = refs(d.orders).map((id) => subOrders.get(id)).filter(Boolean);
    const { keep, split } = splitBySize({ sourceSubOrder: d.source, bagW: d.bag_w, bagH: d.bag_h }, orders);
    if (!keep || !split.length) continue;
    const lastOf = (g) => Math.max(...g.orders.map((o) => Number(o.orderDate) || 0)) || null;
    // The size too: a trigger fills it only when the plate order changes, and
    // the old register wrote the first order's size while a repeat of another
    // size could be the plate order (PL-00114: 12x14 written, its plate order
    // the 14x18 one made again on 21 Sep).
    updates.push(['UpdateRecord', 'Printing_Plates', d.id, {
        Orders: ['L', ...keep.orders.map((o) => o.id)], Last_Used_On: lastOf(keep),
        Bag_Width: keep.size[0] || null, Bag_Height: keep.size[1] || null
    }]);
    for (const g of split) {
        const maker = g.madeBy || g.orders[0];
        adds.push(['AddRecord', 'Printing_Plates', null, {
            Customer: d.customer, Source_Sub_Order: maker.id, Orders: ['L', ...g.orders.map((o) => o.id)],
            Plate_Type: d.plate_type, Rack: d.rack, Slot: d.slot, Made_On: g.madeOn || null, Last_Used_On: lastOf(g),
            Notes: [`Split from ${designNo(d.id)}: its ${size(g.size)} orders are a plate of their own (each bag size has its own plate, 23 Nov 2026)`,
                g.madeOn ? null : 'made before Oct 2025 records'].filter(Boolean).join('; ')
        }]);
    }
    report.push(`${designNo(d.id)} keeps ${size(keep.size)} (${keep.orders.length} orders); new: ${split.map((g) => `${size(g.size)} (${g.orders.length})`).join(', ')}`);
}

say(`${designs.length} designs with orders; ${updates.length} hold more than one bag size; ${adds.length} new designs to add`);
for (const line of report.slice(0, 8)) say(`  ${line}`);
const pl114 = report.find((l) => l.startsWith('PL-00114'));
if (pl114) say(`  ... ${pl114}`);
if (DRY_RUN) {
    const sized = await sql(`SELECT COUNT(*) AS n FROM Printing_Plates p JOIN Sub_Orders so ON so.id = p.Source_Sub_Order
        WHERE so.Bag_Width > 0 AND so.Bag_Height > 0 AND (p.Bag_Width IS NOT so.Bag_Width OR p.Bag_Height IS NOT so.Bag_Height)`);
    say(`${sized[0].n} designs' size differs from their plate order's width x height (fixed after the split)`);
    say('Nothing written.');
    process.exit(0);
}

// The new designs first, then the old ones narrowed: a failure part-way leaves
// orders on two designs at worst, never on none. Run again to finish.
const CHUNK = 200;
for (let i = 0; i < adds.length; i += CHUNK) {
    await api('POST', '/apply', adds.slice(i, i + CHUNK));
    say(`  designs added: ${Math.min(i + CHUNK, adds.length)}/${adds.length}`);
}
for (let i = 0; i < updates.length; i += CHUNK) {
    await api('POST', '/apply', updates.slice(i, i + CHUNK));
    say(`  designs narrowed: ${Math.min(i + CHUNK, updates.length)}/${updates.length}`);
}
// Every design's size as its plate order wrote it: width x height, never turned
// round -- 12x14 and 14x12 are different plates (user, 23 Nov 2026). The old
// register wrote the smaller side first.
const sized = await sql(`SELECT p.id, p.Bag_Width AS w, p.Bag_Height AS h, so.Bag_Width AS sw, so.Bag_Height AS sh
    FROM Printing_Plates p JOIN Sub_Orders so ON so.id = p.Source_Sub_Order`);
const turned = sized.filter((r) => Number(r.sw) > 0 && Number(r.sh) > 0 && (Number(r.w) !== Number(r.sw) || Number(r.h) !== Number(r.sh)))
    .map((r) => ['UpdateRecord', 'Printing_Plates', r.id, { Bag_Width: Number(r.sw), Bag_Height: Number(r.sh) }]);
say(`${turned.length} designs' size set to their plate order's width x height`);
for (let i = 0; i < turned.length; i += CHUNK) await api('POST', '/apply', turned.slice(i, i + CHUNK));
say('Done. Now run scripts/plate-sides.mjs to give the new designs their sides.');
