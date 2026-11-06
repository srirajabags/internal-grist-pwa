// Building the plate register from the sub-orders, ahead of the on-ground
// check (user, 1 Nov 2026: sub-orders are the source of truth for what plates
// exist).
//
// How the godown is laid out (user, 5 Nov 2026): three sections, one per kind
// of plate -- plates (rack codes A..Z), stereos (AS..ZS), digital plates
// (AD..ZD) -- each with racks A to Z. Inside a rack every shop has one slot
// number, kept in the shop's name (K-1290, KS 43, KD 136), and ALL that shop's
// plates of that kind sit in that slot. So a slot holds one row per design, not
// one row per shop.
//
// A design is born when an order makes a plate for it: Design_Version NEW or
// CHANGE. An OLD order prints with a design already made -- the one of its
// kind whose plate fits its bag, the closest fit if several do. An OLD order
// whose plate was not found (Old_Plate_Available NO) had the plate made again
// from the old file: same design, a new plate, so the design's made date moves
// to that order. An OLD order with no design of its kind on record reaches back
// before the records start (Oct 2025), and starts a design of its own.
//
// Only orders that reached the factory count. An order stuck before it, or
// cancelled, never had a plate made or used.

import { parseRackCodes, KIND } from './rackCodes.js';
import { isReusable, kindOfOrder, rackFor, STATUS } from './printingPlates.js';
import { choiceText } from '../../grist/gristValues.js';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();

export const REACHED_FACTORY = 'UPDATED TO FACTORY';

// Sizes as smaller x bigger, the way the factory writes them.
const dims = (o) => [num(o.bagW), num(o.bagH)].sort((a, b) => a - b);
const area = ([a, b]) => a * b;
const fits = (plate, bag) => plate[0] > 0 && bag[0] > 0 && plate[0] <= bag[0] && plate[1] <= bag[1];

const byDate = (a, b) => num(a.orderDate) - num(b.orderDate) || num(a.id) - num(b.id);

// The designs one customer's orders of one kind describe, oldest first.
export const designsFromOrders = (orders) => {
    const designs = [];
    for (const o of [...orders].sort(byDate)) {
        const dv = norm(o.designVersion);
        const size = dims(o);
        if (dv !== 'OLD') {
            // NEW and CHANGE make a plate; so, as far as anyone can tell, did
            // the dozen early orders that never had a version recorded.
            designs.push({ size, madeBy: o, madeOn: o.orderDate, orders: [o] });
            continue;
        }
        const match = designs
            .filter((d) => fits(d.size, size))
            .sort((a, b) => area(b.size) - area(a.size) || num(b.orders.at(-1).orderDate) - num(a.orders.at(-1).orderDate))[0];
        if (!match) {
            // A design older than the records -- unless this order is the one
            // that had its plate made again, in which case the plate on the rack
            // dates from this order.
            const remade = norm(o.oldPlateAvailable) === 'NO';
            designs.push({ size, madeBy: remade ? o : null, madeOn: remade ? o.orderDate : null, orders: [o] });
            continue;
        }
        match.orders.push(o);
        if (norm(o.oldPlateAvailable) === 'NO') {
            match.madeBy = o;
            match.madeOn = o.orderDate;
        }
    }
    return designs;
};

const rowFrom = ({ customer, kind, design, rack, slot, notes }) => {
    const latest = design.orders.at(-1);
    const maker = design.madeBy || design.orders[0];
    const [w, h] = design.size;
    return {
        Customer: customer,
        Source_Sub_Order: maker.id,
        Orders: ['L', ...design.orders.map((o) => o.id)],
        Plate_Type: kind,
        Material: latest.material || '',
        Print: latest.print || '',
        Printing_Colours: choiceText(latest.printingColour),
        Bag_Width: w || null,
        Bag_Height: h || null,
        Plate_Count: Math.max(1, num(maker.plateCount), num(latest.plateCount)),
        Bag_Model: latest.model || '',
        Made_On: design.madeOn || null,
        Last_Used_On: latest.orderDate || null,
        Rack: rack,
        Slot: slot || null,
        Reusable: isReusable({ material: latest.material, plateType: kind }),
        Status: STATUS.UNVERIFIED,
        Notes: notes
    };
};

// The register rows for one customer: their shop name, city and sub-orders.
export const registerRows = ({ customer, shop, city, subOrders }) => {
    const reached = (subOrders || []).filter((o) => norm(o.status) === REACHED_FACTORY && !o.cancelled && kindOfOrder(o));
    // Plastic-cover and BOPP plates go in the bin after the run; only what is
    // kept belongs in the godown's register.
    const kept = reached.filter((o) => isReusable({ material: o.material, plateType: kindOfOrder(o) }));
    const codes = parseRackCodes(shop);
    const rows = [];

    for (const kind of [KIND.PLATE, KIND.STEREO, KIND.DIGITAL]) {
        const code = codes.find((c) => c.kind === kind);
        const designs = designsFromOrders(kept.filter((o) => kindOfOrder(o) === kind));
        const rack = code?.rack || rackFor(city);
        const slot = code?.slot || null;
        for (const design of designs) {
            const notes = [
                code ? `Slot from the shop name (${code.code})` : 'No slot for this kind in the shop name',
                design.madeOn ? null : 'made before Oct 2025 records'
            ].filter(Boolean).join('; ');
            rows.push(rowFrom({ customer, kind, design, rack, slot, notes }));
        }
        // A slot the office numbered but no order that reached the factory
        // explains: something is in it, and the check will say what.
        if (code && !designs.length) {
            rows.push({
                Customer: customer, Source_Sub_Order: null, Orders: null, Plate_Type: kind,
                Material: '', Print: '', Printing_Colours: '', Bag_Width: null, Bag_Height: null,
                Plate_Count: null, Bag_Model: '', Made_On: null, Last_Used_On: null,
                Rack: code.rack, Slot: code.slot, Reusable: true, Status: STATUS.UNVERIFIED,
                Notes: `Slot from the shop name (${code.code}); no order on record — check what is in it`
            });
        }
    }
    return rows;
};
