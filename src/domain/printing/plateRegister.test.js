import { describe, it, expect } from 'vitest';
import { registerRows, designsFromOrders } from './plateRegister';

const order = (fields) => ({
    id: 1, plate: 'PLATE', print: 'SINGLE COLOUR', material: 'NON-WOVEN', model: 'DCUT',
    bagW: 12, bagH: 18, plateCount: 1, orderDate: 100, designVersion: 'NEW',
    status: 'UPDATED TO FACTORY', printingColour: '["RED"]', ...fields
});

// Yuvaraj Mens Wear - Type -3 (AFT) AS 1 A-502, Adoni: every sub-order on
// record (5 Nov 2026). The three from 6 Oct 2025 never reached the factory.
const yuvaraj = {
    customer: 16986,
    shop: 'Yuvaraj Mens Wear - Type -3 (AFT) AS 1   A-502',
    city: 'Adoni',
    subOrders: [
        order({ id: 116, orderDate: 10, plate: 'STEREO', print: 'DOUBLE COLOUR', material: 'PLASTIC', bagW: '10', bagH: '14', designVersion: '', status: 'CHECKING FOR DESIGN VERSION' }),
        order({ id: 117, orderDate: 10, plate: 'STEREO', print: 'DOUBLE COLOUR', material: 'PLASTIC', bagW: '12', bagH: '18', designVersion: '', status: 'CHECKING FOR DESIGN VERSION' }),
        order({ id: 118, orderDate: 10, model: 'STITCHING', bagW: '12', bagH: '16', designVersion: '', status: 'CHECKING FOR DESIGN VERSION' }),
        order({ id: 4130, orderDate: 20, plate: 'STEREO', print: 'DOUBLE COLOUR', material: 'PLASTIC', plateCount: 2, designVersion: 'OLD', oldPlateAvailable: 'YES' }),
        order({ id: 6766, orderDate: 30, plate: 'STEREO', print: 'DOUBLE COLOUR', material: 'PLASTIC', plateCount: 2, designVersion: 'OLD', oldPlateAvailable: 'YES' }),
        order({ id: 6767, orderDate: 30, plate: 'NONE', print: 'NO PRINT', material: 'PLASTIC', model: 'PLAIN' }),
        order({ id: 12422, orderDate: 40, plate: 'STEREO', print: 'DOUBLE COLOUR', material: 'PLASTIC', plateCount: 2, designVersion: 'OLD', oldPlateAvailable: 'YES', printingColour: '["MAGENTA","BLACK"]' })
    ]
};

describe('registerRows — Yuvaraj Mens Wear, the case the user checked (5 Nov 2026)', () => {
    const rows = registerRows(yuvaraj);

    it('sizes AS-1 by the stereo orders that were printed, not the stuck 10x14 one', () => {
        const stereo = rows.find((r) => r.Plate_Type === 'STEREO');
        expect(stereo).toMatchObject({
            Rack: 'A', Slot: 1, Bag_Width: 12, Bag_Height: 18, Plate_Count: 2,
            Printing_Colours: 'MAGENTA + BLACK', Last_Used_On: 40, Made_On: null
        });
        expect(stereo.Orders).toEqual(['L', 4130, 6766, 12422]);
        expect(stereo.Notes).toMatch(/before Oct 2025/);
    });

    it('keeps A-502 as a numbered slot with no order behind it, rather than guess its size', () => {
        const plate = rows.find((r) => r.Plate_Type === 'PLATE');
        expect(plate).toMatchObject({ Rack: 'A', Slot: 502, Bag_Width: null, Bag_Model: '', Orders: null });
        expect(plate.Notes).toMatch(/no order on record/);
    });

    it('makes exactly those two rows', () => {
        expect(rows).toHaveLength(2);
    });
});

describe('designsFromOrders — one row per design', () => {
    it('starts a design for every NEW or CHANGE order', () => {
        const ds = designsFromOrders([
            order({ id: 1, orderDate: 1 }),
            order({ id: 2, orderDate: 2, designVersion: 'CHANGE' })
        ]);
        expect(ds.map((d) => d.orders.map((o) => o.id))).toEqual([[1], [2]]);
    });

    it('puts an OLD order on the design whose plate fits it most closely', () => {
        const ds = designsFromOrders([
            order({ id: 1, orderDate: 1, bagW: 10, bagH: 14 }),
            order({ id: 2, orderDate: 2, bagW: 12, bagH: 18 }),
            order({ id: 3, orderDate: 3, bagW: 13, bagH: 18, designVersion: 'OLD' })
        ]);
        // Both plates fit a 13x18 bag; the 12x18 one is the closer.
        expect(ds.map((d) => d.orders.map((o) => o.id))).toEqual([[1], [2, 3]]);
    });

    it('never puts an OLD order on a plate made for a bigger bag', () => {
        const ds = designsFromOrders([
            order({ id: 1, orderDate: 1, bagW: 16, bagH: 20 }),
            order({ id: 2, orderDate: 2, bagW: 12, bagH: 18, designVersion: 'OLD' })
        ]);
        expect(ds).toHaveLength(2);
        expect(ds[1]).toMatchObject({ madeOn: null });
    });

    it('dates a plate made again by its repeat order even when the first design is older than the records', () => {
        // Srinivasa Handlooms MD-10: repeat orders 5544 and 5545 of 28 Feb 2026
        // had both plates made again; nothing earlier is on record.
        const ds = designsFromOrders([
            order({ id: 5544, orderDate: 50, print: 'MULTI COLOUR', bagW: 18, bagH: 16, designVersion: 'OLD', oldPlateAvailable: 'NO' })
        ]);
        expect(ds[0]).toMatchObject({ madeOn: 50 });
        expect(ds[0].madeBy.id).toBe(5544);
    });

    it('moves the made date when the old plate was missing and made again', () => {
        const ds = designsFromOrders([
            order({ id: 1, orderDate: 1 }),
            order({ id: 2, orderDate: 5, designVersion: 'OLD', oldPlateAvailable: 'NO' }),
            order({ id: 3, orderDate: 9, designVersion: 'OLD', oldPlateAvailable: 'YES' })
        ]);
        expect(ds).toHaveLength(1);
        expect(ds[0]).toMatchObject({ madeOn: 5 });
        expect(ds[0].madeBy.id).toBe(2);
    });
});

describe('registerRows — what goes in', () => {
    it('gives every design its own row in the shop\'s one slot', () => {
        const rows = registerRows({
            customer: 7, shop: 'Shop AFT K-9', city: 'Kurnool',
            subOrders: [order({ id: 1, bagW: 10, bagH: 14 }), order({ id: 2, bagW: 16, bagH: 20, orderDate: 200 })]
        });
        expect(rows.map((r) => [r.Rack, r.Slot, r.Bag_Width, r.Bag_Height])).toEqual([['K', 9, 10, 14], ['K', 9, 16, 20]]);
    });

    it('files each kind in its own section, by its own code', () => {
        const rows = registerRows({
            customer: 7, shop: 'Shop AFT K173 Ks 43 KD 160', city: 'Kurnool',
            subOrders: [
                order({ id: 1 }),
                order({ id: 2, plate: 'STEREO', material: 'PLASTIC' }),
                order({ id: 3, print: 'MULTI COLOUR' })
            ]
        });
        expect(rows.map((r) => [r.Plate_Type, r.Slot])).toEqual([['PLATE', 173], ['STEREO', 43], ['DIGITAL', 160]]);
    });

    it('leaves a design unnumbered when the shop has no code of its kind', () => {
        const rows = registerRows({ customer: 7, shop: 'Shop AFT K-9', city: 'Kurnool', subOrders: [order({ plate: 'STEREO' })] });
        expect(rows.map((r) => [r.Plate_Type, r.Slot])).toEqual([['PLATE', 9], ['STEREO', null]]);
    });

    it('counts only orders that reached the factory', () => {
        const rows = registerRows({
            customer: 7, shop: 'Shop AFT', city: 'Kurnool',
            subOrders: [order({ status: 'CHECKING FOR MISPRINT STOCK' }), order({ id: 2, cancelled: true })]
        });
        expect(rows).toEqual([]);
    });

    it('registers no plastic or BOPP plate, but keeps a plastic stereo', () => {
        const rows = registerRows({
            customer: 7, shop: 'Shop AFT', city: 'Kurnool',
            subOrders: [order({ id: 1, material: 'PLASTIC' }), order({ id: 2, material: 'PLASTIC', plate: 'STEREO' })]
        });
        expect(rows.map((r) => r.Plate_Type)).toEqual(['STEREO']);
    });
});
