import { describe, it, expect } from 'vitest';
import { allocateStock, groupAttrs, effectiveQty, PRIORITY_LABEL } from './productionBatch';

// A side-patty group: every sub-order in it is cuttable from the same roll width,
// and the strips differ only in length. This is the shape job 25-216 had.
const BT = 'ROLLS TO SIDEPATTY';
const so = (id, bagW, bagH, qty) => ({
    id, Model: 'STITCHING', Material: 'NON-WOVEN', Print: 'SINGLE COLOUR',
    Quantity: qty, Quantity_Type: 'PIECES',
    Bag_Width: String(bagW), Bag_Height: String(bagH), Bag_GSM: '75',
    Bag_Colour: '["RED"]', Roll_Material: 'NW REGULAR',
    Sidepatty_Width: '6', Sidepatty_Colour: 'RED', Sidepatty_GSM: '75'
});

// An inventory row as the joined stock summary hands it over.
const stock = (over) => ({
    itemId: 'X', codeId: 1, material: 'NW REGULAR', colour: 'RED', gsm: '75',
    width: null, height: null, availWeight: 0, type: 'SIDEPATTY', ...over
});
// A side-patty group cuts 6" strips two across a 12" roll, so the group asks for
// a roll of exactly that width -- see groupAttrs.rollWidth. A 36" roll is not an
// alternative it will take.
const rollRow = (itemId, kg, width = '12') =>
    stock({ itemId, type: 'ROLL', gsm: '75', width, height: null, availWeight: kg });
const pattyRow = (itemId, h, kg) =>
    stock({ itemId, type: 'SIDEPATTY', width: '6', height: String(h), availWeight: kg });

const attrsFor = (s) => groupAttrs(BT, s);
const allocate = (subs, inventory, rate = 0.1) =>
    allocateStock(attrsFor(subs[0]), subs, inventory, BT, undefined, undefined, rate);
const need = (subs, rate = 0.1) => subs.reduce((t, s) => t + effectiveQty(BT, s, rate), 0);
const took = (res, itemId) =>
    res.picks.filter((p) => p.itemId === itemId).reduce((t, p) => t + p.take, 0);

describe('allocateStock — which stock a job is given', () => {
    it('answers the whole order from the shelf when the shelf can (priority 1)', () => {
        const subs = [so(1, 16, 18, 300)];
        const res = allocate(subs, [pattyRow('P54', 54, 100)]);
        expect(res.priority).toBe(1);
        expect(res.picks.every((p) => p.source === 'finished')).toBe(true);
        expect(res.postponed).toEqual([]);
        expect(res.fulfilledQty).toBeCloseTo(need(subs), 6);
    });

    it('cuts from a roll when a roll can cover the lot (priority 2)', () => {
        const subs = [so(1, 16, 18, 300)];
        const res = allocate(subs, [rollRow('R1', 500)]);
        expect(res.priority).toBe(2);
        expect(res.picks.every((p) => p.source === 'roll')).toBe(true);
    });

    it('mixes roll and shelf when neither covers it alone (priority 3)', () => {
        const subs = [so(1, 16, 18, 1000)];
        const want = need(subs);
        // Neither leg covers it alone; together they do.
        const res = allocate(subs, [rollRow('R1', want * 0.6), pattyRow('P54', 54, want * 0.6)]);
        expect(res.priority).toBe(3);
        expect(new Set(res.picks.map((p) => p.source))).toEqual(new Set(['roll', 'finished']));
        expect(res.postponed).toEqual([]);
    });

    it('postpones what will not fit rather than half-answering an order (priority 4)', () => {
        // A sub-order is fulfilled whole or not at all.
        const subs = [so(1, 16, 18, 300), so(2, 16, 18, 300), so(3, 16, 18, 300)];
        const res = allocate(subs, [pattyRow('P54', 54, effectiveQty(BT, subs[0], 0.1) * 1.2)]);
        expect(res.priority).toBe(4);
        expect(res.fulfilled.length + res.postponed.length).toBe(3);
        expect(res.postponed.length).toBeGreaterThan(0);
    });

    it('postpones everything when there is nothing to give (priority 5)', () => {
        const res = allocate([so(1, 16, 18, 300)], []);
        expect(res.priority).toBe(5);
        expect(res.picks).toEqual([]);
        expect(res.postponed).toHaveLength(1);
        expect(PRIORITY_LABEL[res.priority]).toMatch(/postponed/i);
    });
});

describe('allocateStock — ready stock may only answer what it fits', () => {
    it('will not let a 6x46 strip answer a bag that needs 6x54', () => {
        // A strip cut for one bag is eight inches short for another. One batch drew
        // 175 bundles that way and left the orders it was meant to answer unanswered
        // while looking satisfied.
        const subs = [so(1, 16, 18, 300)];                 // wants 6x54
        const res = allocate(subs, [pattyRow('P46', 46, 1000)]);
        expect(took(res, 'P46')).toBe(0);
        expect(res.priority).toBe(5);
    });

    it('caps each size at its own orders, not at the job\'s whole requirement', () => {
        // The 25-216 shape: plenty of one length on the shelf, an order that barely
        // wants it, and a different length that is short.
        const subs = [so(1, 12, 16, 300), so(2, 16, 18, 1100)];   // 6x46 and 6x54
        const res = allocate(subs, [pattyRow('P46', 46, 500), pattyRow('P54', 54, 5)]);
        const want46 = effectiveQty(BT, subs[0], 0.1);
        expect(took(res, 'P46')).toBeLessThanOrEqual(want46 + 1e-9);
        expect(took(res, 'P46')).toBeGreaterThan(0);
    });

    it('drops a size nobody ordered entirely', () => {
        const subs = [so(1, 16, 18, 300)];
        const res = allocate(subs, [pattyRow('P54', 54, 100), pattyRow('P40', 40, 100)]);
        expect(took(res, 'P40')).toBe(0);
    });
});

describe('allocateStock — the roll pools', () => {
    it('never gives a job less than it asked for when stock is there', () => {
        const subs = [so(1, 16, 18, 500)];
        const want = need(subs);
        const res = allocate(subs, [rollRow('R1', want * 10)]);
        const taken = res.picks.reduce((t, p) => t + p.take, 0);
        expect(taken).toBeGreaterThanOrEqual(want - 1e-9);
    });

    it('reserves only what the sub-orders that fit will consume', () => {
        // Taking the whole shelf deducted stock later groups in the same run could
        // not then see, and left the review claiming a job had drawn several times
        // the weight it was planned for.
        const subs = [so(1, 16, 18, 100)];
        const res = allocate(subs, [pattyRow('P54', 54, 10_000)]);
        const taken = res.picks.reduce((t, p) => t + p.take, 0);
        expect(taken).toBeLessThan(1000);
    });

    it('gives every pick an item to draw against and a positive amount', () => {
        const subs = [so(1, 16, 18, 1000)];
        const want = need(subs);
        const res = allocate(subs, [rollRow('R1', want * 0.5), pattyRow('P54', 54, want)]);
        for (const p of res.picks) {
            expect(p.itemId).toBeTruthy();
            expect(p.take).toBeGreaterThan(0);
            expect(['roll', 'finished', 'blank']).toContain(p.source);
        }
    });
});

describe('allocateStock — a model number is answered by its own model', () => {
    const ST = 'ROLLS TO SHEETS';
    const modelSo = (id, model, qty) => ({
        id, Model: 'STITCHING', Material: 'NON-WOVEN', Print: 'MODEL NUMBER',
        Quantity: qty, Quantity_Type: 'PIECES', Sheet_Size: '16x19',
        Bag_Width: '16', Bag_Height: '18', Bag_GSM: '110',
        Bag_Colour: `["${model}"]`, Roll_Material: 'NW VIRGIN'
    });
    const sheetRow = (itemId, colour, kg, type = 'MODEL NUMBER SHEET') => stock({
        itemId, type, material: 'NW VIRGIN', colour, gsm: '110',
        width: '16', height: '19', availWeight: kg
    });

    it('will not answer an M11 order out of a stack of K9 sheets', () => {
        const subs = [modelSo(1, 'M11', 500)];
        const res = allocateStock(groupAttrs(ST, subs[0]), subs,
            [sheetRow('K9', 'K9', 500)], ST, undefined, undefined, 0.1);
        expect(took(res, 'K9')).toBe(0);
    });

    it('answers it out of its own model', () => {
        const subs = [modelSo(1, 'M11', 500)];
        const res = allocateStock(groupAttrs(ST, subs[0]), subs,
            [sheetRow('M11', 'M11', 500)], ST, undefined, undefined, 0.1);
        expect(took(res, 'M11')).toBeGreaterThan(0);
    });

    it('treats a plain white sheet as a blank to be printed, not as finished stock', () => {
        // Counting it as finished told the planner the order was already answered,
        // so no plate and no press run were set up for it.
        const subs = [modelSo(1, 'M11', 500)];
        const res = allocateStock(groupAttrs(ST, subs[0]), subs,
            [sheetRow('W', 'WHITE', 500, 'SHEET')], ST, undefined, undefined, 0.1);
        const blank = res.picks.filter((p) => p.itemId === 'W');
        expect(blank.every((p) => p.source === 'blank')).toBe(true);
    });
});
