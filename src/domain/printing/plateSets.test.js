// One row per physical plate (user, 12 Nov 2026): "while there are two plates
// the verify process should be separate for each plate. Individual plates might
// get damaged and need to get replacement." And (15 Nov 2026): "another table
// with just the image as the identifier and the actions that the godown team
// takes for each individual side". These hold the line on a design's sides --
// Plate_Sides rows read with their Printing_Plates design -- being found,
// missed, damaged, replaced and pictured one at a time.

import { describe, it, expect } from 'vitest';
import {
    plateSets, setKey, positionText, plateLabel, statusGroups, setExpiresOn, canReplace, designStatus,
    replacementRecord, replacementMovement, designRow, setNoText, sideNo, sideRecords,
    picturesOf, platesTold, canTakePhoto, photoActions, photoPlace, photoName
} from './plateSets';
import { STATUS, repeatShortlist, platesForSubOrder, pickList, plateActionBundle, designActionBundle } from './printingPlates';
import { platesQuery, plateFromRow } from './printingJobs';
import { filterPlates } from './plateTable';
import { confirmPlateAction, confirmRepeatAnswer, confirmReplacement, confirmPhoto } from './plateConfirm';

// A-284 as in the 12 Nov screenshot: Kiran Mobiles, design PL-06124, two sides.
const p1 = {
    id: 501, designId: 6124, plateInSet: 1, plateCount: 2, plateNo: 'PL-06124-1', rackCode: 'A-284', rack: 'A', slot: 284,
    customer: 26630, sourceSubOrder: 900, plateType: 'PLATE', material: 'NON-WOVEN', colours: 'BLACK', bagW: 10, bagH: 14,
    bagModel: 'DCUT', orders: [900], madeOn: 100, lastUsedOn: 100, expiresOn: 1000, status: STATUS.UNVERIFIED, shop: 'Kiran Mobiles'
};
const p2 = { ...p1, id: 502, plateInSet: 2, plateNo: 'PL-06124-2' };

describe('plateSets — a design\'s sides gathered', () => {
    it('groups sides by their design', () => {
        const single = { id: 7, designId: 70, plateCount: 1, status: STATUS.IN_RACK };
        const sets = plateSets([p2, single, p1]);
        expect(sets).toHaveLength(2);
        expect(sets.find((s) => s.key === 6124).plates.map((p) => p.id)).toEqual([501, 502]);
        expect(setKey(single)).toBe(70);
    });

    it('flags the place of a damaged side with no new one as a gap', () => {
        const [set] = plateSets([p1, { ...p2, status: STATUS.DAMAGED }]);
        expect(set.gaps.map((g) => g.at)).toEqual([2]);
        expect(set.live.map((p) => p.id)).toEqual([501]);
    });

    it('closes the gap once a new side is recorded for it', () => {
        const damaged = { ...p2, status: STATUS.DAMAGED };
        const fresh = { ...p2, id: 503, replaces: 502, status: STATUS.IN_RACK };
        const [set] = plateSets([p1, damaged, fresh]);
        expect(set.gaps).toEqual([]);
        // The new side sits above the one it replaced.
        expect(set.plates.map((p) => p.id)).toEqual([501, 503, 502]);
        expect(canReplace(damaged, set)).toBe(false);
    });

    it('does not invent a side the register never had', () => {
        expect(plateSets([p1])[0].gaps).toEqual([]);
    });

    it('lets the first live side speak for the design', () => {
        const [set] = plateSets([{ ...p1, status: STATUS.DAMAGED }, p2]);
        expect(set.lead.id).toBe(502);
    });

    it('reports each side\'s status when they disagree', () => {
        const [set] = plateSets([{ ...p1, status: STATUS.IN_RACK }, { ...p2, status: STATUS.NOT_FOUND }]);
        expect(statusGroups(set).map((g) => [g.status, g.plates.map((p) => p.plateInSet)]))
            .toEqual([[STATUS.IN_RACK, [1]], [STATUS.NOT_FOUND, [2]]]);
    });

    it('dates the design by its first live side to expire', () => {
        const [set] = plateSets([{ ...p1, expiresOn: 3000 }, { ...p2, expiresOn: 2000 }]);
        expect(setExpiresOn(set)).toBe(2000);
    });

    it('numbers a side after its design, and the design on its own', () => {
        expect(sideNo(p2)).toBe('PL-06124-2');
        expect(sideNo({ ...p2, replaces: 502 })).toBe('PL-06124-2R');
        expect(sideNo({ id: 9, designId: 42, plateCount: 1 })).toBe('PL-00042');
        expect(positionText(p2)).toBe('plate 2 of 2');
        expect(positionText({ ...p1, plateType: 'STEREO' })).toBe('stereo 1 of 2');
        expect(plateLabel(p2)).toBe('A-284 · plate 2 of 2');
        expect(designRow(plateSets([p1, p2])[0]).plateNo).toBe('PL-06124');
        expect(setNoText({ key: 6124 })).toBe('PL-06124');
    });
});

// Printing_Plates.Status becomes a formula over the sides at the switch -- the
// same rule as designStatus (scripts/create-printing-tables.mjs).
describe('a design\'s status, from its sides', () => {
    const st = (...statuses) => designStatus(plateSets(statuses.map((s, i) => ({ ...p1, id: 600 + i, plateInSet: i + 1, status: s })))[0]);

    it('is the sides\' status when they agree', () => {
        expect(st(STATUS.IN_RACK, STATUS.IN_RACK)).toBe(STATUS.IN_RACK);
    });

    it('is the least ready live side\'s status when they differ', () => {
        expect(st(STATUS.IN_RACK, STATUS.NOT_FOUND)).toBe(STATUS.NOT_FOUND);
        expect(st(STATUS.IN_RACK, STATUS.UNVERIFIED)).toBe(STATUS.UNVERIFIED);
        expect(st(STATUS.ISSUED, STATUS.IN_RACK)).toBe(STATUS.ISSUED);
    });

    it('is DAMAGED while a place is empty, though the other side is in its rack', () => {
        expect(st(STATUS.IN_RACK, STATUS.DAMAGED)).toBe(STATUS.DAMAGED);
    });

    it('is DISCARDED only when every side was discarded', () => {
        expect(st(STATUS.DISCARDED, STATUS.DISCARDED)).toBe(STATUS.DISCARDED);
        expect(st(STATUS.DISCARDED, STATUS.DAMAGED)).toBe(STATUS.DAMAGED);
    });

    it('is back to IN RACK once the damaged side is replaced', () => {
        const sets = plateSets([{ ...p1, status: STATUS.IN_RACK }, { ...p2, status: STATUS.DAMAGED },
            { ...p2, id: 503, replaces: 502, status: STATUS.IN_RACK }]);
        expect(designStatus(sets[0])).toBe(STATUS.IN_RACK);
    });
});

describe('a design\'s sides as rows', () => {
    it('makes one row per plate, each its place, all starting alike', () => {
        expect(sideRecords(6124, 2, { Status: STATUS.ISSUED, Issued_To_Job: 3 })).toEqual([
            { Design: 6124, Side_No: 1, Status: STATUS.ISSUED, Issued_To_Job: 3 },
            { Design: 6124, Side_No: 2, Status: STATUS.ISSUED, Issued_To_Job: 3 }
        ]);
        // A design with no plate count is one plate.
        expect(sideRecords(7, null)).toEqual([{ Design: 7, Side_No: 1 }]);
    });

    it('reads a side with its design\'s facts, numbered and dated by its own making', () => {
        const plate = plateFromRow({
            id: 503, design_id: 6124, side_no: 2, status: 'IN RACK', picture: '[902]', replaces: 502,
            side_made_on: Date.UTC(2026, 10, 1) / 1000, made_on: Date.UTC(2026, 8, 1) / 1000,
            plate_type: 'PLATE', plate_count: 2, rack: 'A', slot: 284, rack_code: 'A-284', orders: '[900]'
        });
        expect(plate).toMatchObject({ id: 503, designId: 6124, plateInSet: 2, plateNo: 'PL-06124-2R', preview: [902], replaces: 502 });
        // Made in November, so it lasts six months from then, not from the design's September.
        expect(plate.expiresOn).toBe(Date.UTC(2027, 4, 1) / 1000);
    });
});

describe('acting on one side', () => {
    it('writes the side, and a movement naming the design and the side', () => {
        expect(plateActionBundle(p2, 'DAMAGED')).toEqual([
            ['UpdateRecord', 'Plate_Sides', 502, { Status: STATUS.DAMAGED, Issued_To_Job: null }],
            ['AddRecord', 'Printing_Plate_Movements', null, {
                Plate: 6124, Side: 502, Action: 'DAMAGED', Status_After: STATUS.DAMAGED, Rack: 'A', Slot: 284, Printing_Job: null, Notes: ''
            }]
        ]);
    });

    it('issues both sides of a plate together, logged once for the plate', () => {
        const bundle = designActionBundle([p1, p2], 'ISSUED', { jobId: 3 });
        expect(bundle.filter(([op]) => op === 'UpdateRecord').map((a) => a[2])).toEqual([501, 502]);
        const moves = bundle.filter(([, table]) => table === 'Printing_Plate_Movements');
        expect(moves).toHaveLength(1);
        expect(moves[0][3]).toMatchObject({ Plate: 6124, Action: 'ISSUED', Printing_Job: 3 });
        expect(moves[0][3]).not.toHaveProperty('Side');
    });

    it('names which side of the slot is being marked, and a move by the plate alone', () => {
        expect(confirmPlateAction(p2, 'DAMAGED').heading).toBe('Mark A-284 · plate 2 of 2 as damaged?');
        expect(confirmPlateAction({ ...p1, status: STATUS.IN_RACK }, 'MOVED', { rack: 'B', slot: 12 }).heading).toBe('Move A-284 to B-12?');
    });

    it('finds a design by status when any one of its sides has it', () => {
        const row = designRow(plateSets([p1, { ...p2, status: STATUS.DAMAGED }])[0]);
        expect(filterPlates([row], { status: STATUS.DAMAGED })).toHaveLength(1);
        expect(filterPlates([row], { status: STATUS.IN_RACK })).toHaveLength(0);
        expect(filterPlates([row], { text: 'pl061242' })).toHaveLength(1);
    });
});

describe('replacing one damaged side', () => {
    const damaged = { ...p2, status: STATUS.DAMAGED, preview: [902] };

    it('offers a new plate only for a retired side whose place is empty', () => {
        const [set] = plateSets([p1, damaged]);
        expect(canReplace(damaged, set)).toBe(true);
        expect(canReplace(p1, set)).toBe(false);
    });

    it('adds a side in the same place of the same design, made today, in the rack, with the same picture', () => {
        expect(replacementRecord(damaged, 5000)).toEqual({
            Design: 6124, Side_No: 2, Replaces: 502, Picture: ['L', 902], Made_On: 5000,
            Status: STATUS.IN_RACK, Verified: true, Notes: 'New plate for PL-06124-2'
        });
        expect(replacementRecord({ ...damaged, preview: [] }, 1)).not.toHaveProperty('Picture');
    });

    it('logs the new side as added to the design, saying what it replaces', () => {
        const [[, table, , fields]] = replacementMovement(503, damaged, 'cracked');
        expect(table).toBe('Printing_Plate_Movements');
        expect(fields).toMatchObject({ Plate: 6124, Side: 503, Action: 'ADDED', Status_After: STATUS.IN_RACK, Rack: 'A', Slot: 284 });
        expect(fields.Notes).toBe('Replaces PL-06124-2 (damaged) · cracked');
    });

    it('asks in words which plate is being replaced', () => {
        const c = confirmReplacement(damaged);
        expect(c.heading).toBe('Record a new plate for A-284 · plate 2 of 2?');
        expect(c.lines.join(' ')).toContain('PL-06124-2 stays DAMAGED');
    });
});

describe('a design in repeat orders and printing batches', () => {
    const order = { id: 950, customer: 26630, plate: 'PLATE', print: 'SINGLE COLOUR', bagW: 10, bagH: 14 };

    it('offers the design once, with both its sides, and picks it by its design id', () => {
        const { shortlist, pick } = repeatShortlist(order, [p1, p2], 0);
        expect(shortlist).toHaveLength(1);
        expect(shortlist[0].plates.map((p) => p.id)).toEqual([501, 502]);
        // Sub_Orders.Reused_Plates names designs.
        expect(pick).toBe(6124);
    });

    it('still offers a design short of a side, saying which one is gone', () => {
        const { shortlist } = repeatShortlist(order, [p1, { ...p2, status: STATUS.DAMAGED }], 0);
        expect(shortlist[0].plates.map((p) => p.id)).toEqual([501]);
        expect(shortlist[0].gaps.map((g) => g.at)).toEqual([2]);
        const c = confirmRepeatAnswer({ shop: 'Kiran Mobiles' }, shortlist[0]);
        expect(c.lines).toContain('A-284 · plate 2 of 2 is damaged — a new one is needed.');
    });

    it('does not pick a design with either side past its date', () => {
        // Side 1 made this month; side 2 three years ago, long past its six months.
        const today = Date.UTC(2026, 10, 12) / 1000;
        const fresh = { ...p1, madeOn: Date.UTC(2026, 10, 1) / 1000 };
        const old = { ...p2, madeOn: Date.UTC(2023, 10, 1) / 1000 };
        expect(repeatShortlist(order, [fresh, { ...old, madeOn: fresh.madeOn }], today).pick).toBe(6124);
        expect(repeatShortlist(order, [fresh, old], today).pick).toBe(null);
    });

    it('runs a repeat order on every live side of the design it reuses', () => {
        expect(platesForSubOrder({ ...order, reusedPlates: [6124] }, [p1, p2]).map((p) => p.id)).toEqual([501, 502]);
        // ... and, with none confirmed, on its likeliest design's.
        expect(platesForSubOrder({ ...order, reusedPlates: [] }, [p1, p2]).map((p) => p.id)).toEqual([501, 502]);
    });

    it('flags a design short of a side on the pick list without registering a new one', () => {
        const job = { id: 3, subOrders: [{ ...order, reusedPlates: [6124] }] };
        const { lines, missing, short } = pickList([job], [p1, { ...p2, status: STATUS.DAMAGED }]);
        expect(lines.map((l) => l.plate.id)).toEqual([501]);
        expect(missing).toEqual([]);
        expect(short.map((s) => s.set.gaps.map((g) => g.at))).toEqual([[2]]);
    });

    it('reads a batch\'s sides by design, and a job\'s by side', () => {
        const q = platesQuery([], [6124], [], [], [501]);
        expect(q.sql).toContain('FROM Plate_Sides s JOIN Printing_Plates p ON p.id = s.Design');
        expect(q.sql).toContain('p.id IN (?)');
        expect(q.sql).toContain('s.id IN (?)');
        expect(q.args).toEqual([6124, 501]);
    });
});

// 15 Nov 2026: a picture of each side, made from its design file, is how the
// person holding it knows which one it is -- PL-06124's Telugu and English
// sides. Where there is none, the godown takes a photo of the plate.
describe('a picture of each side', () => {
    it('reads a side\'s picture as its own place', () => {
        expect(picturesOf({ ...p2, preview: [902] })).toEqual([{ at: 2, id: 902 }]);
        expect(picturesOf(p1)).toEqual([]);
    });

    it('tells a design\'s sides apart by their pictures, with nothing typed', () => {
        expect(platesTold(plateSets([{ ...p1, preview: [901] }, { ...p2, preview: [902] }])[0])).toBe(true);
        expect(platesTold(plateSets([{ ...p1, preview: [901] }, p2])[0])).toBe(false);
        // One picture on both is no help.
        expect(platesTold(plateSets([{ ...p1, preview: [901] }, { ...p2, preview: [901] }])[0])).toBe(false);
        expect(platesTold(plateSets([{ id: 9, designId: 9, plateCount: 1 }])[0])).toBe(true);
    });
});

describe('a photo when a side has no picture', () => {
    it('is offered for a kept plate or stereo with nothing to show', () => {
        expect(canTakePhoto({ id: 9, plateCount: 1, plateType: 'STEREO', status: STATUS.UNVERIFIED })).toBe(true);
        expect(canTakePhoto({ id: 9, plateCount: 1, status: STATUS.IN_RACK, preview: [5] })).toBe(false);
        expect(canTakePhoto({ id: 9, plateCount: 1, status: STATUS.DAMAGED })).toBe(false);
        expect(photoPlace(p2)).toBe(2);
    });

    it('becomes the side\'s picture, named after it', () => {
        expect(photoActions(p2, 77)).toEqual([['UpdateRecord', 'Plate_Sides', 502, { Picture: ['L', 77] }]]);
        expect(photoName(p2)).toBe('PL-06124-2 photo.jpg');
        expect(photoName({ id: 9, designId: 42, plateCount: 1 })).toBe('PL-00042 photo.jpg');
    });

    it('says which plate the photo will be filed as', () => {
        expect(confirmPhoto(p2).heading).toBe('Save this photo as the picture of A-284 · plate 2 of 2?');
        expect(confirmPhoto({ id: 9, rackCode: 'KS-43', plateCount: 1 }).heading).toBe('Save this photo as the picture of KS-43?');
    });
});
