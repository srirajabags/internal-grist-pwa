import { describe, it, expect } from 'vitest';
import {
    pattyDims, readyDemand, readyKeyForSubOrder, readyKeyForStock, effectiveQty,
    outputCodeSpec, outputDims, missingOutputCodes, buildPlan, groupKeyFor, rollWeightFactor,
    requiredRollWidth, missingCodesCsvRows, MISSING_CODES_CSV_HEADERS, codeLabel,
    missingItemsCsvRows, MISSING_ITEMS_CSV_HEADERS, itemIdFor
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

// Order #115052 (sub-order 12290), Sept 2026: a 14x21 IVORY 110 GSM sheet sat in
// "no matching roll width" while a 14" roll of exactly that stock (#0471) was on
// the shelf. Neither side is a standard sheet roll width, and nothing looked
// further. The standard widths still come first; only what they cannot cut is
// given a roll as wide as one of its own sides.
describe('sheet roll widths — standard first, then the sheet\'s own sides', () => {
    const BT = 'ROLLS TO SHEETS';
    let nextId = 1;
    const sheet = (Sheet_Size, over) => stitching({
        id: nextId++, Sheet_Size, Bag_Colour: '["IVORY"]', Bag_GSM: '110',
        Bag_Width: '14', Bag_Height: '20', Quantity: 200, ...over
    });
    const widthsOf = (subOrders, inventory = []) => {
        const plan = buildPlan({ batchType: BT, subOrders, itemCodes: [], inventory, overrides: {}, excluded: [] });
        expect(plan.unmatched).toEqual([]);
        return Object.fromEntries(plan.groups.flatMap((g) =>
            g.subOrders.map((so) => [so.Sheet_Size + (so.Bag_Colour.includes('RED') ? ' red' : ''), Number(g.attrs.width)])));
    };

    it('keeps a sheet with a standard side on the standard roll', () => {
        expect(requiredRollWidth(BT, sheet('15x16'))).toBe(16);   // 16" before a smaller listed side
        expect(requiredRollWidth(BT, sheet('13x20'))).toBe(13);   // then the smaller side
        expect(requiredRollWidth(BT, sheet('14x19'))).toBe(19);   // then the larger
        expect(requiredRollWidth(BT, sheet('14x21'))).toBeNull(); // neither: left to the plan
        expect(requiredRollWidth(BT, sheet('cancel'))).toBe('ignore');
    });

    it('cuts a 14x21 sheet from a roll as wide as one of its sides', () => {
        expect(widthsOf([sheet('14x21')])).toEqual({ '14x21': 14 });
    });

    it('does not pull a standard-width sheet onto an off-list roll', () => {
        // 14x19 could share the 14" job, but it has a 19" roll to go to.
        expect(widthsOf([sheet('14x21'), sheet('14x19')])).toEqual({ '14x21': 14, '14x19': 19 });
    });

    it('picks the sides that need the fewest jobs', () => {
        // 21 is common to both: one job, not a 14" and a 22".
        expect(widthsOf([sheet('14x21'), sheet('21x22')])).toEqual({ '14x21': 21, '21x22': 21 });
        // 14 is common to both: one job, not a 14" and a 20".
        expect(widthsOf([sheet('14x21'), sheet('14x20')])).toEqual({ '14x21': 14, '14x20': 14 });
        // Two jobs are unavoidable; a sheet whose sides are both being cut goes to the narrower.
        expect(widthsOf([sheet('14x21'), sheet('20x22'), sheet('14x20')]))
            .toEqual({ '14x21': 14, '20x22': 20, '14x20': 14 });
    });

    it('still finds the shared side when there are too many sizes to try every set', () => {
        // 17 sheets, 18 different sides: past the exhaustive search, onto the greedy one.
        const many = Array.from({ length: 17 }, (_, i) => sheet(`${20 + i}x40`));
        expect(new Set(Object.values(widthsOf(many)))).toEqual(new Set([40]));
    });

    // Fewest jobs is only worth having if the shelf can fill them. A 14" roll that
    // covers one of two orders does not make one 14" job; it makes a 14" job and
    // sends the other order to the roll that can cut it.
    describe('against the rolls on the shelf', () => {
        const roll = (itemId, width, kg) => ({
            itemId, codeId: itemId, type: 'ROLL', material: 'NW REGULAR', colour: 'IVORY',
            gsm: '110', width: String(width), intakeAt: 1, availWeight: kg, availBundles: 0
        });
        const kgOrder = (size) => sheet(size, { Quantity_Type: 'KG', Quantity: 8 });
        const need = effectiveQty(BT, kgOrder('14x21'));

        it('breaks the group when one roll cannot cover it, and another roll can', () => {
            expect(widthsOf([kgOrder('14x21'), kgOrder('14x20')], [roll(1, 14, need * 1.2), roll(2, 20, need * 1.2)]))
                .toEqual({ '14x21': 14, '14x20': 20 });
        });

        it('splits two orders of the same size across the two rolls that fit them', () => {
            const plan = buildPlan({
                batchType: BT, subOrders: [kgOrder('14x21'), kgOrder('14x21')], itemCodes: [],
                inventory: [roll(1, 14, need * 1.2), roll(2, 21, need * 1.2)], overrides: {}, excluded: []
            });
            expect(plan.groups.map((g) => Number(g.attrs.width)).sort()).toEqual([14, 21]);
            expect(plan.groups.every((g) => g.fulfilled.length === 1)).toBe(true);
        });

        it('keeps them together when one roll covers both', () => {
            expect(widthsOf([kgOrder('14x21'), kgOrder('14x20')], [roll(1, 14, need * 3), roll(2, 20, need * 3)]))
                .toEqual({ '14x21': 14, '14x20': 14 });
        });

        it('still breaks the group when there are too many orders to try every split', () => {
            // 11 orders: past the exhaustive search. The 14" roll fits six, the 21" five.
            const plan = buildPlan({
                batchType: BT, subOrders: Array.from({ length: 11 }, () => kgOrder('14x21')), itemCodes: [],
                inventory: [roll(1, 14, need * 6.2), roll(2, 21, need * 5.2)], overrides: {}, excluded: []
            });
            expect(plan.groups.flatMap((g) => g.fulfilled)).toHaveLength(11);
        });

        it('takes the wider roll when that is the one on the shelf', () => {
            expect(widthsOf([kgOrder('14x21')], [roll(2, 21, need * 2)])).toEqual({ '14x21': 21 });
        });
    });

    it('chooses per colour, since colours never share a job', () => {
        // The red 21x22 cannot share the ivory job, so it must not pull ivory onto 21".
        expect(widthsOf([sheet('14x21'), sheet('21x22', { Bag_Colour: '["RED"]' })]))
            .toEqual({ '14x21': 14, '21x22 red': 21 });
    });
});

// The missing-codes panel hands over a CSV for Grist to import, so the codes it
// asks for are added as written rather than retyped. Item_Code is a formula in
// Inventory_Item_Codes: the CSV carries only the columns it is built from.
describe('missing item codes as a CSV for Inventory_Item_Codes', () => {
    it('writes one row per code in the data columns, sizes as plain numbers', () => {
        const spec = { type: 'SHEET', material: 'NW REGULAR', colour: 'IVORY', gsm: '110', w: '14', h: 21 };
        expect(MISSING_CODES_CSV_HEADERS).toEqual(['Type', 'Material', 'Colour', 'GSM', 'Width_Inches_', 'Height_Inches_']);
        expect(missingCodesCsvRows([{ spec, label: codeLabel(spec) }]))
            .toEqual([['SHEET', 'NW REGULAR', 'IVORY', '110', '14', '21']]);
        expect(missingCodesCsvRows([{ spec: { ...spec, w: '14.50', h: '21.0' } }])[0].slice(4)).toEqual(['14.5', '21']);
        expect(missingCodesCsvRows(undefined)).toEqual([]);
    });
});

// Completion books output onto an Inventory_Items row, so a code without its
// item still leaves the floor unable to book. Both CSVs, and the item's code
// written exactly as Grist's Item_Code formula will write it, so the reference
// links on import.
describe('missing items as a CSV for Inventory_Items', () => {
    const spec = { type: 'SHEET', material: 'NW REGULAR', colour: 'IVORY', gsm: '110', w: '14', h: '21' };

    it('names the item the godown\'s way and its code the formula\'s way', () => {
        expect(MISSING_ITEMS_CSV_HEADERS).toEqual(['Item_ID', 'Item_Code']);
        expect(missingItemsCsvRows([{ spec }]))
            .toEqual([['SHEET_NW_REGULAR_IVORY_110_14X21', 'SHEET - NW REGULAR - IVORY - 110GSM (14x21)']]);
    });

    it('writes a half inch as _5, spaces as _, and a model sheet by its model', () => {
        expect(itemIdFor({ type: 'BOTTOMPATTY', material: 'NW REGULAR', colour: 'LEMON YELLOW', gsm: '90', w: 4.5, h: 16 }))
            .toBe('BOTTOMPATTY_NW_REGULAR_LEMON_YELLOW_90_4_5X16');
        expect(itemIdFor({ type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', colour: 'K9', gsm: '110', w: 16, h: 19 }))
            .toBe('MODELSHEET_K9_16X19');
    });

    it('marks a 16x21 model sheet as the stick-bag sheet, as the godown does', () => {
        expect(itemIdFor({ type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', colour: 'W1', gsm: '110', w: '16', h: '21' }))
            .toBe('MODELSHEET_W1_16X21_STICK');
        // Only model sheets: a plain 16x21 sheet carries no such suffix.
        expect(itemIdFor({ type: 'SHEET', material: 'NW REGULAR', colour: 'RED', gsm: '110', w: '16', h: '21' }))
            .toBe('SHEET_NW_REGULAR_RED_110_16X21');
    });

    it('leaves the height off a code that has none, as the formula does', () => {
        const roll = { type: 'ROLL', material: 'NW REGULAR', colour: 'IVORY', gsm: '110', w: 14, h: null };
        expect(missingCodesCsvRows([{ spec: roll }])[0].slice(4)).toEqual(['14', '']);
        expect(missingItemsCsvRows([{ spec: roll }])[0][1]).toBe('ROLL - NW REGULAR - IVORY - 110GSM (14)');
    });
});
