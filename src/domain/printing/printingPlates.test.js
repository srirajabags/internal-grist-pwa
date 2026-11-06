import { describe, it, expect } from 'vitest';
import {
    STATUS, isReusable, kindOfOrder, expiry, expiresOn, isExpired, rackFor, plateFits, canDo, actionProblem, plateActionBundle,
    afterJobAction, platesForSubOrder, ordersServedBy, pickList, repeatCandidates, repeatShortlist
} from './printingPlates';

describe('isReusable — which plates are kept (user, 1 Nov 2026)', () => {
    it('throws away plastic-cover and BOPP plates', () => {
        expect(isReusable({ material: 'PLASTIC', plateType: 'PLATE' })).toBe(false);
        expect(isReusable({ material: 'BOPP LAMINATED', plateType: 'PLATE' })).toBe(false);
    });

    it('keeps stereos, plastic ones included, and non-woven plates', () => {
        expect(isReusable({ material: 'PLASTIC', plateType: 'STEREO' })).toBe(true);
        expect(isReusable({ material: 'NON-WOVEN', plateType: 'PLATE' })).toBe(true);
        expect(isReusable({ material: 'NON-WOVEN', plateType: 'DIGITAL' })).toBe(true);
    });

    it('throws away a BOPP digital plate like any other BOPP plate', () => {
        expect(isReusable({ material: 'BOPP LAMINATED', plateType: 'DIGITAL' })).toBe(false);
    });
});

describe('kindOfOrder — what an order prints with', () => {
    it('reads stereo, digital and ordinary plates', () => {
        expect(kindOfOrder({ plate: 'STEREO', print: 'DOUBLE COLOUR' })).toBe('STEREO');
        expect(kindOfOrder({ plate: 'PLATE', print: 'MULTI COLOUR' })).toBe('DIGITAL');
        expect(kindOfOrder({ plate: 'PLATE', print: 'SINGLE COLOUR' })).toBe('PLATE');
    });

    it('names nothing for an order with no plate', () => {
        expect(kindOfOrder({ plate: 'NONE', print: 'NO PRINT' })).toBeNull();
    });
});

describe('rackFor — racks are lettered by the shop city', () => {
    it('takes the first letter', () => {
        expect(rackFor(' kurnool')).toBe('K');
    });

    it('names no rack for a city that does not start with a letter', () => {
        expect(rackFor('9 Road')).toBe('');
        expect(rackFor('')).toBe('');
    });
});

describe('plateFits — a plate prints on the same bag or a bigger one', () => {
    const plate = { bagW: 12, bagH: 16 };

    it('fits a bigger bag, written either way round', () => {
        expect(plateFits(plate, { bagW: 14, bagH: 18 })).toBe(true);
        expect(plateFits(plate, { bagW: 18, bagH: 14 })).toBe(true);
        expect(plateFits(plate, { bagW: 12, bagH: 16 })).toBe(true);
    });

    it('does not fit a bag smaller in either direction', () => {
        expect(plateFits(plate, { bagW: 10, bagH: 18 })).toBe(false);
        expect(plateFits(plate, { bagW: 13, bagH: 15 })).toBe(false);
    });

    it('does not guess when a size is missing', () => {
        expect(plateFits({ bagW: 12 }, { bagW: 14, bagH: 18 })).toBeNull();
    });
});

describe('plate actions — only moves that make sense on the floor', () => {
    const inRack = { id: 7, status: STATUS.IN_RACK, rack: 'K', slot: 1290 };

    it('cannot return a plate that was never issued', () => {
        expect(canDo(inRack, 'RETURNED')).toBe(false);
        expect(() => plateActionBundle(inRack, 'RETURNED', { rack: 'K', slot: 1290 })).toThrow();
    });

    it('lets a plate be picked before its rack was checked', () => {
        // Finding it on the shelf is the check.
        expect(canDo({ status: STATUS.UNVERIFIED }, 'ISSUED')).toBe(true);
    });

    it('never brings back a retired plate', () => {
        for (const action of ['ISSUED', 'VERIFIED', 'RETURNED', 'MOVED']) {
            expect(canDo({ status: STATUS.DISCARDED }, action)).toBe(false);
            expect(canDo({ status: STATUS.DAMAGED }, action)).toBe(false);
        }
    });

    it('needs a rack letter and a slot number to record a move', () => {
        expect(actionProblem(inRack, 'MOVED', { rack: 'K', slot: '' })).toMatch(/rack and slot/);
        expect(actionProblem(inRack, 'MOVED', { rack: 'K', slot: '12a' })).toMatch(/rack and slot/);
        expect(actionProblem(inRack, 'MOVED', { rack: 'KD', slot: 3 })).toMatch(/rack and slot/);
        expect(actionProblem(inRack, 'MOVED', { rack: 'K', slot: ' 3 ' })).toBeNull();
    });

    it('writes the plate and its movement together', () => {
        const bundle = plateActionBundle(inRack, 'ISSUED', { jobId: 41 });
        expect(bundle).toEqual([
            ['UpdateRecord', 'Printing_Plates', 7, { Status: STATUS.ISSUED, Issued_To_Job: 41 }],
            ['AddRecord', 'Printing_Plate_Movements', null, {
                Plate: 7, Action: 'ISSUED', Status_After: STATUS.ISSUED,
                Rack: 'K', Slot: 1290, Printing_Job: 41, Notes: ''
            }]
        ]);
    });

    it('clears the job once the plate is back, leaving its slot as it was', () => {
        const [[, , , fields]] = plateActionBundle({ ...inRack, status: STATUS.ISSUED }, 'RETURNED', {});
        expect(fields).toEqual({ Status: STATUS.IN_RACK, Issued_To_Job: null });
    });

    it('confirms a plate where the register has it, without asking for a slot', () => {
        // The checker only verifies (user, 5 Nov 2026) -- a plate with no slot
        // number can still be found.
        const unnumbered = { id: 9, status: STATUS.UNVERIFIED, rack: 'A', slot: null };
        expect(actionProblem(unnumbered, 'VERIFIED', {})).toBeNull();
        const [[, , , fields], [, , , move]] = plateActionBundle(unnumbered, 'VERIFIED', {});
        expect(fields).toEqual({ Status: STATUS.IN_RACK, Issued_To_Job: null, Verified: true });
        expect(move).toMatchObject({ Action: 'VERIFIED', Rack: 'A', Slot: null });
    });

    it('records a stereo size measured during the check', () => {
        const [[, , , fields]] = plateActionBundle({ ...inRack, status: STATUS.UNVERIFIED }, 'VERIFIED',
            { rack: 'K', slot: 43, stereoSize: ' 10 x 12 ' });
        expect(fields.Stereo_Size).toBe('10 x 12');
    });
});

describe('afterJobAction — what the operator\'s plate condition does', () => {
    it('discards a single-use plate even when it is in good shape', () => {
        expect(afterJobAction({ material: 'PLASTIC', plateType: 'PLATE' }, 'REUSABLE')).toBe('DISCARDED');
    });

    it('returns a good kept plate and retires a worn one', () => {
        const kept = { material: 'NON-WOVEN', plateType: 'PLATE' };
        expect(afterJobAction(kept, 'REUSABLE')).toBe('RETURNED');
        expect(afterJobAction(kept, 'DAMAGED')).toBe('DAMAGED');
    });
});

describe('pickList — what to fetch for a batch', () => {
    const plates = [
        { id: 1, sourceSubOrder: 10, rack: 'K', slot: 10, status: STATUS.IN_RACK },
        { id: 2, sourceSubOrder: 11, rack: 'K', slot: 2, status: STATUS.IN_RACK },
        { id: 3, sourceSubOrder: 99, rack: 'A', slot: 1, status: STATUS.IN_RACK },
        { id: 4, sourceSubOrder: 13, rack: 'B', slot: 1, status: STATUS.DISCARDED }
    ];
    const job = (id, ...subOrders) => ({ id, subOrders });

    it('includes the old plate the office confirmed for a repeat order', () => {
        expect(platesForSubOrder({ id: 12, reusedPlates: [3] }, plates).map((p) => p.id)).toEqual([3]);
    });

    it('takes the plates of every order in a shop\'s job, walking racks and slots in order', () => {
        const { lines } = pickList([job(7, { id: 10 }, { id: 11 }), job(8, { id: 12, reusedPlates: [3] })], plates);
        // Slot 2 before slot 10, which text order would get wrong.
        expect(lines.map((l) => [l.job.id, l.plate.id])).toEqual([[8, 3], [7, 2], [7, 1]]);
    });

    it('takes a plate once when two orders of the job print with it', () => {
        const { lines } = pickList([job(7, { id: 20, reusedPlates: [3] }, { id: 21, reusedPlates: [3] })], plates);
        expect(lines.map((l) => l.plate.id)).toEqual([3]);
    });

    it('offers a repeat order that names no plate the customer\'s likeliest one', () => {
        // Confirmed in Grist before the register existed: registering a new
        // plate for it would put a second row on a plate already in the rack.
        const own = [
            { id: 20, customer: 5, plateType: 'PLATE', bagW: 14, bagH: 18, status: STATUS.UNVERIFIED },
            { id: 24, customer: 5, plateType: 'PLATE', bagW: 12, bagH: 16, status: STATUS.UNVERIFIED },
            { id: 21, customer: 5, plateType: 'STEREO', bagW: 14, bagH: 18, status: STATUS.UNVERIFIED },
            { id: 22, customer: 5, plateType: 'PLATE', bagW: 16, bagH: 20, status: STATUS.UNVERIFIED },
            { id: 23, customer: 6, plateType: 'PLATE', bagW: 14, bagH: 18, status: STATUS.UNVERIFIED }
        ];
        const so = { id: 50, customer: 5, plate: 'PLATE', print: 'SINGLE COLOUR', bagW: 14, bagH: 18 };
        // One plate, made for its size -- not the smaller one that also fits,
        // not the stereo, not the bigger plate, not another customer's.
        expect(platesForSubOrder(so, own).map((p) => p.id)).toEqual([20]);
    });

    it('prefers the plate the office named over the customer\'s others', () => {
        const own = [
            { id: 20, customer: 5, plateType: 'PLATE', status: STATUS.IN_RACK },
            { id: 30, customer: 5, plateType: 'PLATE', status: STATUS.IN_RACK }
        ];
        const so = { id: 50, reusedPlates: [30], customer: 5, plate: 'PLATE', print: 'SINGLE COLOUR' };
        expect(platesForSubOrder(so, own).map((p) => p.id)).toEqual([30]);
    });

    it('flags each order with no plate left to pick', () => {
        const { missing } = pickList([job(5, { id: 13 }, { id: 10 })], plates);
        expect(missing.map((m) => [m.job.id, m.so.id])).toEqual([[5, 13]]);
    });

    it('knows which of a job\'s orders a plate printed', () => {
        expect(ordersServedBy(job(7, { id: 10 }, { id: 11 }), plates[0])).toEqual([10]);
    });
});

describe('repeatCandidates — plates a repeat order might reuse', () => {
    const plates = [
        { id: 1, customer: 5, plateType: 'PLATE', bagW: 12, bagH: 16, status: STATUS.IN_RACK },
        { id: 2, customer: 5, plateType: 'PLATE', bagW: 16, bagH: 20, status: STATUS.IN_RACK },
        { id: 3, customer: 5, plateType: 'PLATE', bagW: 10, bagH: 12, status: STATUS.DAMAGED },
        { id: 4, customer: 6, plateType: 'PLATE', bagW: 10, bagH: 12, status: STATUS.IN_RACK }
    ];
    const plateOrder = { customer: 5, plate: 'PLATE', print: 'SINGLE COLOUR', bagW: 14, bagH: 18 };

    it('offers only the customer\'s kept plates, fitting ones first', () => {
        const out = repeatCandidates(plateOrder, plates);
        expect(out.map((c) => [c.plate.id, c.fits])).toEqual([[1, true], [2, false]]);
    });

    it('offers a stereo order only stereos (Mummy Daddy Shopping Mall, order 115723)', () => {
        // GS-160 is its stereo; G-171 is a plate, which a stereo order cannot use.
        const theirs = [
            { id: 10, customer: 9, plateType: 'STEREO', bagW: 12, bagH: 16, status: STATUS.UNVERIFIED },
            { id: 11, customer: 9, plateType: 'PLATE', status: STATUS.UNVERIFIED }
        ];
        const out = repeatCandidates({ customer: 9, plate: 'STEREO', print: 'SINGLE COLOUR', bagW: 12, bagH: 16 }, theirs);
        expect(out.map((c) => c.plate.id)).toEqual([10]);
    });

    it('offers a full-colour order only digital plates', () => {
        const theirs = [
            { id: 20, customer: 9, plateType: 'DIGITAL', status: STATUS.IN_RACK },
            { id: 21, customer: 9, plateType: 'PLATE', status: STATUS.IN_RACK }
        ];
        expect(repeatCandidates({ customer: 9, plate: 'PLATE', print: 'MULTI COLOUR' }, theirs).map((c) => c.plate.id)).toEqual([20]);
    });
});

describe('expiry — from the day the plate was made: plates 6 months, digital a year, stereos never (user, 5 Nov 2026)', () => {
    const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;

    it('counts from the day it was made, not its last use', () => {
        const plate = { plateType: 'PLATE', madeOn: day('2026-04-25'), lastUsedOn: day('2026-09-28') };
        expect(expiresOn(plate)).toBe(day('2026-10-25'));
        expect(expiresOn({ ...plate, plateType: 'DIGITAL' })).toBe(day('2027-04-25'));
    });

    it('bounds a plate made before the records by when they start', () => {
        // Used in 2026 with no making order on record: made by Oct 2025 at the latest.
        expect(expiry({ plateType: 'PLATE', madeOn: null, lastUsedOn: day('2026-09-28') }))
            .toEqual({ on: day('2026-04-01'), bound: true });
    });

    it('never expires a stereo, and says nothing of a slot with no order', () => {
        expect(expiresOn({ plateType: 'STEREO', madeOn: day('2020-01-01') })).toBeNull();
        expect(expiresOn({ plateType: 'PLATE', madeOn: null, lastUsedOn: null })).toBeNull();
    });

    it('is expired from its expiry day on', () => {
        const plate = { plateType: 'PLATE', madeOn: day('2026-05-05') };
        expect(isExpired(plate, day('2026-11-04'))).toBe(false);
        expect(isExpired(plate, day('2026-11-05'))).toBe(true);
    });
});

describe('repeatShortlist — one plate per repeat order, matched by size (user, 5 Nov 2026)', () => {
    const day = (iso) => Date.parse(`${iso}T00:00:00Z`) / 1000;
    const today = day('2026-11-05');
    // Rumaan Sports Wear, K-79: three plate designs; order 115726 is a 14x18 bag.
    const k79 = [
        { id: 1, customer: 3, plateType: 'PLATE', bagW: 14, bagH: 18, madeOn: day('2026-09-12'), status: STATUS.UNVERIFIED },
        { id: 2, customer: 3, plateType: 'PLATE', bagW: 12, bagH: 16, madeOn: day('2026-09-12'), status: STATUS.UNVERIFIED },
        { id: 3, customer: 3, plateType: 'PLATE', bagW: 10, bagH: 14, madeOn: day('2026-05-19'), status: STATUS.UNVERIFIED }
    ];
    const order = (w, h) => ({ customer: 3, plate: 'PLATE', print: 'SINGLE COLOUR', bagW: w, bagH: h });

    it('shortlists the plate made for the same bag and picks it', () => {
        const out = repeatShortlist(order(14, 18), k79, today);
        expect(out.shortlist.map((c) => c.plate.id)).toEqual([1]);
        expect(out.others.map((c) => c.plate.id).sort()).toEqual([2, 3]);
        expect(out.pick).toBe(1);
    });

    it('matches a size written the other way round', () => {
        expect(repeatShortlist(order(18, 14), k79, today).pick).toBe(1);
    });

    it('falls back to the closest fit when no plate was made for this bag', () => {
        // 13x17: the 12x16 plate is the biggest that still fits.
        const out = repeatShortlist(order(13, 17), k79, today);
        expect(out.shortlist.map((c) => c.plate.id)).toEqual([2]);
        expect(out.pick).toBe(2);
    });

    it('shortlists an expired plate but does not pick it', () => {
        const old = [{ ...k79[0], madeOn: day('2026-01-01') }];
        const out = repeatShortlist(order(14, 18), old, today);
        expect(out.shortlist).toHaveLength(1);
        expect(out.pick).toBeNull();
    });

    it('shortlists nothing when no plate fits', () => {
        const out = repeatShortlist(order(8, 10), k79, today);
        expect(out.shortlist).toEqual([]);
        expect(out.pick).toBeNull();
        expect(out.others).toHaveLength(3);
    });
});
