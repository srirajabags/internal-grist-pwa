import { describe, it, expect } from 'vitest';
import {
    pattyDims, readyDemand, readyKeyForSubOrder, readyKeyForStock, effectiveQty,
    outputCodeSpec, outputDims, missingOutputCodes, buildPlan, groupKeyFor, rollWeightFactor
} from './productionBatch';

const stitching = (over) => ({
    Model: 'STITCHING', Material: 'NON-WOVEN', Print: 'SINGLE COLOUR',
    Quantity_Type: 'PIECES', Roll_Material: 'NW REGULAR', ...over
});

describe('pattyDims — the strip that wraps the bag', () => {
    it('runs up one side, across the bottom and down the other', () => {
        // length = bag width + 2 x (height + 1); the inch each side is the stitched mouth
        expect(pattyDims(stitching({ Bag_Width: '10', Bag_Height: '14', Sidepatty_Width: '6', Sidepatty_GSM: '75' })))
            .toMatchObject({ kind: 'SIDEPATTY', width: 6, length: 40 });
        expect(pattyDims(stitching({ Bag_Width: '12', Bag_Height: '16', Sidepatty_Width: '6', Sidepatty_GSM: '75' })))
            .toMatchObject({ length: 46 });
        expect(pattyDims(stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '6', Sidepatty_GSM: '75' })))
            .toMatchObject({ length: 54 });
    });

    it('stops two inches short on a stick bag, which has no folded mouth', () => {
        const stick = stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '6', Sidepatty_GSM: '75', Handle_Colour: 'STICK' });
        expect(pattyDims(stick).length).toBe(16 + 2 * 16);
    });

    it('says it cannot tell rather than guessing, when the geometry is missing', () => {
        expect(pattyDims(stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_GSM: '75' }))).toBeNull();
        expect(pattyDims(stitching({ Bag_Width: '16', Sidepatty_Width: '6', Sidepatty_GSM: '75' }))).toBeNull();
    });
});

describe('the article key — what may answer what', () => {
    const so = (over) => stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '6', Sidepatty_GSM: '75', Quantity: 100, ...over });

    it('matches an order to the stock that fits it', () => {
        expect(readyKeyForSubOrder('ROLLS TO SIDEPATTY', so()))
            .toBe(readyKeyForStock({ type: 'SIDEPATTY', width: '6', height: '54', colour: 'RED' }));
    });

    it('will not let a 6x46 strip answer a bag that needs 6x54', () => {
        expect(readyKeyForSubOrder('ROLLS TO SIDEPATTY', so()))
            .not.toBe(readyKeyForStock({ type: 'SIDEPATTY', width: '6', height: '46', colour: 'RED' }));
    });

    it('keeps a model number sheet apart from a plain one of the same size', () => {
        const model = stitching({ Print: 'MODEL NUMBER', Sheet_Size: '16x19', Bag_Width: '16', Bag_Height: '19', Bag_Colour: '["K9"]', Quantity: 100 });
        const plain = stitching({ Print: 'MULTI COLOUR', Sheet_Size: '16x19', Bag_Width: '16', Bag_Height: '19', Bag_Colour: '["WHITE"]', Quantity: 100 });
        expect(readyKeyForSubOrder('ROLLS TO SHEETS', model))
            .not.toBe(readyKeyForSubOrder('ROLLS TO SHEETS', plain));
        // ... and a K9 sheet is no use to an M11 order
        expect(readyKeyForStock({ type: 'MODEL NUMBER SHEET', width: '16', height: '19', colour: 'K9' }))
            .not.toBe(readyKeyForStock({ type: 'MODEL NUMBER SHEET', width: '16', height: '19', colour: 'M11' }));
    });

    it('stocks a model number at the printed half sheet, not the run size', () => {
        // A 16x38 run sheet holding two 16x19 bags is shelved as the 16x19 half.
        const model = stitching({ Print: 'MODEL NUMBER', Sheet_Size: '16x38', Bag_Width: '16', Bag_Height: '19', Bag_Colour: '["K9"]', Quantity: 100 });
        expect(readyKeyForSubOrder('ROLLS TO SHEETS', model))
            .toBe(readyKeyForStock({ type: 'MODEL NUMBER SHEET', width: '16', height: '19', colour: 'K9' }));
    });
});

describe('readyDemand — how much of each article the orders can absorb', () => {
    const patty = (bagW, bagH, qty, id) => stitching({
        id, Bag_Width: String(bagW), Bag_Height: String(bagH), Quantity: qty,
        Sidepatty_Width: '6', Sidepatty_Colour: 'RED', Sidepatty_GSM: '75'
    });

    it('keeps each size on its own line rather than one figure for the job', () => {
        const demand = readyDemand('ROLLS TO SIDEPATTY',
            [patty(10, 14, 300, 1), patty(12, 16, 300, 2), patty(16, 18, 1100, 3)], 'finished', 0.1);
        expect([...demand.keys()].sort())
            .toEqual(['SIDEPATTY||6x40', 'SIDEPATTY||6x46', 'SIDEPATTY||6x54']);
        // and the biggest order is on the line its own bags need
        expect(demand.get('SIDEPATTY||6x54')).toBeGreaterThan(demand.get('SIDEPATTY||6x46'));
    });

    it('adds orders of the same size together', () => {
        const one = readyDemand('ROLLS TO SIDEPATTY', [patty(16, 18, 1100, 1)], 'finished', 0.1);
        const split = readyDemand('ROLLS TO SIDEPATTY',
            [patty(16, 18, 300, 1), patty(16, 18, 500, 2), patty(16, 18, 300, 3)], 'finished', 0.1);
        expect(split.get('SIDEPATTY||6x54')).toBeCloseTo(one.get('SIDEPATTY||6x54'), 6);
    });

    it('carries the overage the job was planned with, not the one configured today', () => {
        const at10 = readyDemand('ROLLS TO SIDEPATTY', [patty(16, 18, 1000, 1)], 'finished', 0.1);
        const atNone = readyDemand('ROLLS TO SIDEPATTY', [patty(16, 18, 1000, 1)], 'finished', null);
        expect(at10.get('SIDEPATTY||6x54')).toBeGreaterThan(atNone.get('SIDEPATTY||6x54') * 0.999);
    });

    it('says it cannot tell when no order has a size to go on', () => {
        expect(readyDemand('ROLLS TO SIDEPATTY', [stitching({ Quantity: 100 })], 'finished')).toBeNull();
        expect(readyDemand('ROLLS TO SIDEPATTY', [], 'finished')).toBeNull();
    });
});

// Job 2026-09-12 - ROLLS TO SIDEPATTY - 28 - 255. The order wanted a 110 GSM 12x54
// side patty; no 110 GSM roll was on the shelf, so an 80 GSM one was assigned by
// hand. The batch check and the completion form both named the output by the
// order's GSM, so 80 GSM fabric was about to be booked into stock as 110.
describe('a side patty is booked at the GSM of the roll it is cut from', () => {
    const BT = 'ROLLS TO SIDEPATTY';
    const order = stitching({
        id: 10672, Quantity: 500, Bag_Width: '20', Bag_Height: '16',
        Sidepatty_Width: '12', Sidepatty_Colour: 'RED', Sidepatty_GSM: '110', Handle_Colour: 'RED'
    });
    const code = (id, gsm, w, h, type = 'SIDEPATTY') => ({
        id, Item_Code: `${type} ${gsm} ${w}x${h}`, Type: type, Material: 'NW REGULAR',
        Colour: 'RED', GSM: gsm, Width_Inches_: w, Height_Inches_: h
    });
    const roll80 = { material: 'NW REGULAR', colour: 'RED', gsm: '80' };

    it('names the code by the roll, not the order', () => {
        expect(outputCodeSpec(BT, order, roll80)).toMatchObject({ gsm: '80', w: 12, h: 54 });
    });

    it('asks for the roll-weight code when a lighter roll is assigned by hand', () => {
        const rollCode = { ...code(945, '80', '36', ''), Type: 'ROLL' };
        const roll = {
            itemId: 2460, codeId: 945, type: 'ROLL', material: 'NW REGULAR', colour: 'RED',
            gsm: '80', width: '36', intakeAt: 1, availWeight: 37.1, availBundles: 0
        };
        const plan = (itemCodes) => buildPlan({
            batchType: BT, subOrders: [order], itemCodes, inventory: [roll],
            overrides: { [groupKeyFor(BT, order)]: [2460] }, excluded: []
        });
        const has110 = [rollCode, code(1235, '110', '12', '54')];
        expect(missingOutputCodes(BT, plan(has110).groups, has110).map((m) => m.label))
            .toEqual(['SIDEPATTY - NW REGULAR - RED - 80GSM (12x54)']);
        const has80 = [rollCode, code(2000, '80', '12', '54')];
        expect(missingOutputCodes(BT, plan(has80).groups, has80)).toEqual([]);
    });

    it('sizes the output at the roll weight at completion, and the order weight until a roll is known', () => {
        expect(outputDims(BT, order, '80')).toEqual({ w: 12, h: 54, gsm: '80' });
        expect(outputDims(BT, order)).toEqual({ w: 12, h: 54, gsm: '110' });
    });

    it('converts bundles to kg at the roll weight, so the form can balance against the roll', () => {
        // 11 bundles came to 25.29 kg at 110 GSM; the 37.1 kg roll less 18.4 kg
        // returned left 18.7, and the form refused a wastage of -6.59 kg.
        expect(rollWeightFactor(BT, order, '80')).toBeCloseTo(80 / 110, 9);
        expect(25.29 * rollWeightFactor(BT, order, '80')).toBeLessThan(37.1 - 18.4);
        expect(rollWeightFactor(BT, order, '110')).toBe(1);
        expect(rollWeightFactor(BT, order, null)).toBe(1);
        expect(rollWeightFactor('ROLLS TO SHEETS', order, '80')).toBe(1);
    });

    it('keeps a bottom patty at 90 GSM whatever roll it came off', () => {
        const printed = stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '5', Sidepatty_Colour: 'PRINTED', Sidepatty_GSM: '110', Handle_Colour: 'PINK' });
        expect(outputCodeSpec(BT, printed, { ...roll80, colour: 'PINK' })).toMatchObject({ gsm: '90' });
        expect(outputDims(BT, printed, '80')).toMatchObject({ gsm: '90' });
        expect(rollWeightFactor(BT, printed, '80')).toBe(1);
    });
});

describe('effectiveQty', () => {
    it('adds the overage a run is allowed', () => {
        const so = stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '6', Sidepatty_GSM: '75', Quantity: 1000 });
        expect(effectiveQty('ROLLS TO SIDEPATTY', so, 0.1))
            .toBeCloseTo(effectiveQty('ROLLS TO SIDEPATTY', so, 0) * 1.1, 6);
    });
});
