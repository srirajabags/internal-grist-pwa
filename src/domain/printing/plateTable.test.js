import { describe, it, expect } from 'vitest';
import {
    plateCountText, stereoText, sharedCodes, filterPlates, sortForSheet, rackLabel, slotsOfRack, designText, plateDetails, leftOutOrders, leftOutText
} from './plateTable';

describe('plateCountText and stereoText — the sheet\'s PLATE and STEREO columns', () => {
    it('words the plate count the way the sheet does', () => {
        expect(plateCountText({ plateType: 'PLATE', plateCount: 1 })).toBe('SINGLE');
        expect(plateCountText({ plateType: 'DIGITAL', plateCount: 4 })).toBe('FOUR');
        expect(plateCountText({ plateType: 'PLATE', plateCount: null })).toBe('SINGLE');
    });

    it('leaves a stereo out of the plate column and shows it in its own', () => {
        expect(plateCountText({ plateType: 'STEREO', plateCount: 2 })).toBe('');
        expect(stereoText({ plateType: 'STEREO', stereoSize: '10 x 12' })).toBe('10 x 12');
        expect(stereoText({ plateType: 'STEREO' })).toBe('size not taken');
        expect(stereoText({ plateType: 'PLATE' })).toBe('');
        expect(stereoText({ plateType: 'STEREO', plateCount: 2 })).toBe('TWO · size not taken');
    });
});

describe('sharedCodes — one slot written on two shops', () => {
    it('flags a code on two customers, not two plates of one customer', () => {
        const plates = [
            { rackCode: 'VS-42', customer: 1 }, { rackCode: 'VS-42', customer: 2 },
            { rackCode: 'K-1', customer: 3 }, { rackCode: 'K-1', customer: 3 },
            { rackCode: '', customer: 4 }, { rackCode: '', customer: 5 }
        ];
        expect([...sharedCodes(plates)]).toEqual(['VS-42']);
    });
});

describe('filterPlates — narrowing the register', () => {
    const plates = [
        { id: 1, shop: 'BHAVANI MENS WEAR', city: 'Kurnool', rackCode: 'K-1290', plateNo: 'PL-00001', rack: 'K', plateType: 'PLATE', status: 'TO BE VERIFIED' },
        { id: 2, shop: 'Om Pavan', city: 'Dhone', rackCode: 'DS-128', plateNo: 'PL-00002', rack: 'D', plateType: 'STEREO', status: 'IN RACK' }
    ];

    it('finds a rack code typed without its dash, in any case', () => {
        expect(filterPlates(plates, { text: 'k1290' }).map((p) => p.id)).toEqual([1]);
        expect(filterPlates(plates, { text: 'ds 128' }).map((p) => p.id)).toEqual([2]);
    });

    it('finds a shop by its customer ID', () => {
        const withIds = plates.map((p, i) => ({ ...p, customerNo: [17126, 27717][i] }));
        expect(filterPlates(withIds, { text: '17126' }).map((p) => p.id)).toEqual([1]);
    });

    it('combines rack, kind and status', () => {
        expect(filterPlates(plates, { rack: 'D', kind: 'STEREO', status: 'IN RACK' }).map((p) => p.id)).toEqual([2]);
        expect(filterPlates(plates, { rack: 'D', status: 'TO BE VERIFIED' })).toEqual([]);
    });
});

describe('sortForSheet — rack, then slot by number', () => {
    it('puts slot 9 before slot 1290 and unnumbered plates last', () => {
        const out = sortForSheet([
            { id: 1, rack: 'K', slot: 1290 }, { id: 2, rack: 'K', slot: null }, { id: 3, rack: 'K', slot: 9 }, { id: 4, rack: 'A', slot: 5 }
        ]);
        expect(out.map((p) => p.id)).toEqual([4, 3, 1, 2]);
    });
});

describe('rack check sections — A, AS and AD are three different racks', () => {
    it('labels a rack by its section', () => {
        expect(rackLabel('A', 'PLATE')).toBe('A');
        expect(rackLabel('A', 'STEREO')).toBe('AS');
        expect(rackLabel('A', 'DIGITAL')).toBe('AD');
    });

    it('groups a shop\'s designs under its one slot, in slot order', () => {
        const groups = slotsOfRack([
            { id: 1, customer: 5, shop: 'Yuvaraj', rack: 'A', slot: 502, rackCode: 'A-502' },
            { id: 2, customer: 6, shop: 'Other', rack: 'A', slot: 9, rackCode: 'A-9' },
            { id: 3, customer: 5, shop: 'Yuvaraj', rack: 'A', slot: 502, rackCode: 'A-502' },
            { id: 4, customer: 7, shop: 'No code', rack: 'A', slot: null, rackCode: '' }
        ]);
        expect(groups.map((g) => [g.rackCode || g.shop, g.plates.map((p) => p.id)]))
            .toEqual([['A-9', [2]], ['A-502', [1, 3]], ['No code', [4]]]);
    });
});

describe('designText and plateDetails — one column for what is known of a design', () => {
    it('names the kind and how many plates it was made with', () => {
        expect(designText({ plateType: 'STEREO', plateCount: 2 })).toBe('Stereo · 2 stereos');
        expect(designText({ plateType: 'DIGITAL', plateCount: 1 })).toBe('Digital · 1 plate');
        expect(designText({ plateType: 'PLATE', plateCount: null })).toBe('Plate');
    });

    it('lists only the details on record', () => {
        expect(plateDetails({ plateType: 'STEREO', bagW: 14, bagH: 20, colours: 'RED + BLUE', bagModel: 'DCUT' }))
            .toEqual(['14x20 bag', 'RED + BLUE', 'DCUT']);
        expect(plateDetails({ plateType: 'STEREO', stereoSize: '10 x 12', bagModel: 'DCUT' }))
            .toEqual(['stereo 10 x 12', 'DCUT']);
        // A numbered slot with no order behind it.
        expect(plateDetails({ plateType: 'PLATE' })).toEqual([]);
    });

    it('never shows a stereo size on a plate', () => {
        expect(plateDetails({ plateType: 'PLATE', stereoSize: '10 x 12' })).toEqual([]);
    });
});

// PL-06086 (JK Fashions, A-86, 23 Nov 2026): the slot on the shop's name had
// no order on record, because the customer's one plate order was plastic and
// the register leaves plastic and BOPP plates out (binned after the run). The
// card shows that order's material and plate type instead of "nothing on record".
describe('leftOutOrders', () => {
    const slot = { id: 6086, plateType: 'PLATE', sourceSubOrder: 0, orders: [] };
    const plastic = { id: 11297, orderId: 'JK1', orderDate: 100, material: 'PLASTIC', plate: 'PLATE', print: 'SINGLE COLOUR', status: 'UPDATED TO FACTORY' };

    it("names the customer's plastic plate order on a slot with no order", () => {
        expect(leftOutOrders(slot, [plastic]).map((o) => o.id)).toEqual([11297]);
        expect(leftOutText(plastic)).toEqual(['Plastic', 'Plate']);
        expect(leftOutText({ ...plastic, material: 'BOPP LAMINATED', print: 'MULTI COLOUR' })).toEqual(['BOPP laminated', 'Digital plate']);
    });

    it('latest first, and only orders the register left out', () => {
        const later = { ...plastic, id: 12000, orderDate: 200 };
        const nonWoven = { ...plastic, id: 3, material: 'NON-WOVEN' };
        const stereo = { ...plastic, id: 4, plate: 'STEREO' };
        const cancelled = { ...plastic, id: 5, cancelled: true };
        const notYet = { ...plastic, id: 6, status: 'NEW' };
        expect(leftOutOrders(slot, [plastic, nonWoven, stereo, cancelled, notYet, later]).map((o) => o.id)).toEqual([12000, 11297]);
    });

    it('says nothing for a design that has its own orders, or a stereo slot', () => {
        expect(leftOutOrders({ ...slot, sourceSubOrder: 9 }, [plastic])).toEqual([]);
        expect(leftOutOrders({ ...slot, orders: [9] }, [plastic])).toEqual([]);
        expect(leftOutOrders({ ...slot, plateType: 'STEREO' }, [plastic])).toEqual([]);
    });
});
