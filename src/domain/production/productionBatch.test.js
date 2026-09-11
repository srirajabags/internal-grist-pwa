import { describe, it, expect } from 'vitest';
import {
    pattyDims, readyDemand, readyKeyForSubOrder, readyKeyForStock, effectiveQty
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

describe('effectiveQty', () => {
    it('adds the overage a run is allowed', () => {
        const so = stitching({ Bag_Width: '16', Bag_Height: '18', Sidepatty_Width: '6', Sidepatty_GSM: '75', Quantity: 1000 });
        expect(effectiveQty('ROLLS TO SIDEPATTY', so, 0.1))
            .toBeCloseTo(effectiveQty('ROLLS TO SIDEPATTY', so, 0) * 1.1, 6);
    });
});
