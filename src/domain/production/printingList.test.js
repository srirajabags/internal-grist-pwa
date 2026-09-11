import { describe, it, expect } from 'vitest';
import {
    SHEETS_TYPE, DCUT_TYPE, SHEETS_PER_BAG, jobRate, bagCount, sheetCount,
    dcutBagCount, isPrintingListType, printingListHeaders, printingListRows,
    printingListName
} from './printingList';

const sheetSo = (over = {}) => ({
    id: 1, orderId: 114631, shop: 'Sri Dhamodhara', city: 'Bellary',
    qty: 1000, qtyType: 'PIECES', bagW: '16', bagH: '20', bagGsm: '110',
    bagColour: '["WHITE"]', sheetSize: '16x20', sidepattyWidth: '6',
    sidepattyColour: '["RED"]', sidepattyGsm: '75', model: 'STITCHING',
    material: 'NON-WOVEN', print: 'MULTI COLOUR', rollMaterial: 'NW VIRGIN', ...over
});

describe('jobRate — the overage the job was actually planned with', () => {
    it('uses the job\'s own stored rate', () => {
        expect(jobRate({ overage: 0.1 })).toBe(0.1);
    });

    it('falls back to the configured rate rather than reading 0 as a choice', () => {
        // A job created before the column existed reads as 0, which is not a rate
        // anyone chose; null means "use the config".
        expect(jobRate({ overage: 0 })).toBeNull();
        expect(jobRate({})).toBeNull();
    });
});

describe('bagCount / sheetCount — what the printer actually prints', () => {
    it('lifts the order by the overage, because that is what gets cut', () => {
        expect(bagCount(sheetSo(), 0.1)).toBe(1100);
        expect(sheetCount(sheetSo(), 0.1)).toBe(1100 * SHEETS_PER_BAG);
    });

    it('rounds a fraction of a bag up, never down', () => {
        // Rounding down would quietly under-serve the order.
        expect(bagCount(sheetSo({ qty: 505 }), 0.1)).toBe(556);   // 555.5
    });

    it('does not let floating point turn 500 into 501', () => {
        expect(bagCount(sheetSo({ qty: 500 }), 0.1)).toBe(550);
    });

    it('leaves the column blank for a weight-quoted order rather than inventing one', () => {
        // A derived figure in a column the printer reads as fact is worse than a gap.
        expect(bagCount(sheetSo({ qtyType: 'WEIGHT (KG)' }), 0.1)).toBeNull();
        expect(sheetCount(sheetSo({ qtyType: 'WEIGHT (KG)' }), 0.1)).toBeNull();
    });

    it('prints two sheets to a bag — a front and a back', () => {
        expect(SHEETS_PER_BAG).toBe(2);
        expect(sheetCount(sheetSo({ qty: 10 }), 0)).toBe(20);
    });
});

describe('dcutBagCount — backed out of the cloth, because the order is in kilos', () => {
    const dcutSo = (over = {}) => ({
        id: 2, shop: 'Kidz Planet', qty: 50, qtyType: 'WEIGHT (KG)',
        model: 'DCUT', material: 'NON-WOVEN', bagW: '12', bagH: '16', bagGsm: '75',
        bagColour: '["RED"]', rollMaterial: 'NW REGULAR', ...over
    });

    it('derives a count a weight-quoted order does not carry', () => {
        const n = dcutBagCount(dcutSo(), 0.1);
        expect(n).toBeGreaterThan(0);
        expect(Number.isInteger(n)).toBe(true);
    });

    it('gives more bags for more cloth', () => {
        expect(dcutBagCount(dcutSo({ qty: 100 }), 0.1))
            .toBeGreaterThan(dcutBagCount(dcutSo({ qty: 50 }), 0.1));
    });

    it('is blank when the geometry to derive it is missing', () => {
        expect(dcutBagCount(dcutSo({ bagW: '', bagH: '' }), 0.1)).toBeNull();
    });
});

describe('isPrintingListType — only two batch types print', () => {
    it('knows which', () => {
        expect(isPrintingListType(SHEETS_TYPE)).toBe(true);
        expect(isPrintingListType(DCUT_TYPE)).toBe(true);
        expect(isPrintingListType('ROLLS TO SIDEPATTY')).toBe(false);
        expect(isPrintingListType('ROLLS TO HANDLES')).toBe(false);
        expect(isPrintingListType(undefined)).toBe(false);
    });

    it('reads the type however it was typed', () => {
        expect(isPrintingListType('  rolls to sheets ')).toBe(true);
    });
});

describe('printingListRows', () => {
    it('lists a sub-order once however many jobs reach it', () => {
        // A batch splits its orders across jobs by roll and size, so the same
        // sub-order can be reached twice; printing it twice prints it twice.
        const so = sheetSo();
        const batch = { type: SHEETS_TYPE, jobs: [
            { overage: 0.1, subOrders: [so] },
            { overage: 0.1, subOrders: [so] }
        ] };
        expect(printingListRows(batch)).toHaveLength(1);
    });

    it('carries the rate of the job that will cut it, not one rate for the sheet', () => {
        const rows = printingListRows({ type: SHEETS_TYPE, jobs: [
            { overage: 0.1, subOrders: [sheetSo({ id: 1, shop: 'A' })] },
            { overage: 0, subOrders: [sheetSo({ id: 2, shop: 'B' })] }
        ] });
        const headers = printingListHeaders({ type: SHEETS_TYPE });
        const col = headers.indexOf('Bag Count (incl. overage)');
        expect(rows[0][col]).toBe(1100);      // planned at 10%
        expect(rows[1][col]).toBe(1100);      // 0 stored -> config default, also 10%
    });

    it('sits in the order the floor works in — customer, then what is made', () => {
        const rows = printingListRows({ type: SHEETS_TYPE, jobs: [{ overage: 0.1, subOrders: [
            sheetSo({ id: 3, shop: 'Zeta', sheetSize: '16x20' }),
            sheetSo({ id: 1, shop: 'Alpha', sheetSize: '16x21' }),
            sheetSo({ id: 2, shop: 'Alpha', sheetSize: '16x19' })
        ] }] });
        const headers = printingListHeaders({ type: SHEETS_TYPE });
        const shop = headers.indexOf('Shop Name');
        const size = headers.indexOf('Sheet Size');
        expect(rows.map((r) => [r[shop], r[size]]))
            .toEqual([['Alpha', '16x19'], ['Alpha', '16x21'], ['Zeta', '16x20']]);
    });

    it('gives a row for every heading, and no list for a type that does not print', () => {
        const batch = { type: SHEETS_TYPE, jobs: [{ overage: 0.1, subOrders: [sheetSo()] }] };
        expect(printingListRows(batch)[0]).toHaveLength(printingListHeaders(batch).length);
        expect(printingListRows({ type: 'ROLLS TO SIDEPATTY', jobs: [{ subOrders: [sheetSo()] }] })).toEqual([]);
        expect(printingListHeaders({ type: 'ROLLS TO SIDEPATTY' })).toEqual([]);
        expect(printingListRows({})).toEqual([]);
    });

    it('reads a Grist choice list as a plain name', () => {
        const batch = { type: SHEETS_TYPE, jobs: [{ overage: 0.1, subOrders: [sheetSo()] }] };
        const col = printingListHeaders(batch).indexOf('Bag Colour');
        expect(printingListRows(batch)[0][col]).toBe('WHITE');
    });
});

describe('printingListName', () => {
    it('makes a filename a filesystem will accept', () => {
        expect(printingListName({ name: '2026-09-11 - ROLLS TO SHEETS - 27' }))
            .toBe('printing-list_2026-09-11---ROLLS-TO-SHEETS---27.csv');
        expect(printingListName({})).toBe('printing-list_batch.csv');
        expect(printingListName({ name: '///' })).toBe('printing-list_batch.csv');
    });
});
