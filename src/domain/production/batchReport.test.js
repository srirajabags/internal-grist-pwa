import { describe, it, expect } from 'vitest';
import {
    jobsFromTxns, batchFigures, balanceMoments, rollBalances, isBatchClosed,
    batchStatus, batchNumber, wastagePct, unackedCount, changeBreakdown, ROLL_MATERIALS,
    groupFigures, parseBatchIds, batchIdsArg, jobIdsOf, batchesByDay
} from './batchReport';

// A transaction as BATCH_TXN_SQL hands it over.
const roll = (over = {}) => ({
    job: 1, jobName: 'J1', type: 'LESS', kg: 40, cnt: 0, loc: 'ROLLS GODOWN', ack: 1, ts: 100,
    item: 'R1', code: 'ROLL - NW REGULAR - RED', itype: 'ROLL', material: 'NW REGULAR',
    w: '48', h: null, gsm: '75', ...over
});
const article = (over = {}) => ({
    job: 1, jobName: 'J1', type: 'ADD', kg: 30, cnt: 0, loc: 'BAGS GODOWN', ack: 1, ts: 200,
    item: 'B1', code: 'DCUT BAG - NW REGULAR - RED', itype: 'DCUT BAG', material: 'NW REGULAR',
    w: '12', h: '16', gsm: '75', ...over
});
const closed = { completedAt: 500, returned: 1 };

describe('jobsFromTxns — the same reading of a movement as the production page', () => {
    it('counts roll LESS as collected and roll ADD as returned', () => {
        const [job] = jobsFromTxns([roll({ kg: -40 }), roll({ type: 'ADD', kg: 5 })]);
        expect(job.collectedKg).toBe(40);
        expect(job.returnedKg).toBe(5);
        expect(job.outputLines).toEqual([]);
    });

    it('turns article movements into output lines, drawn stock pointing the other way', () => {
        const [job] = jobsFromTxns([article(), article({ type: 'LESS', kg: -8 })]);
        expect(job.outputLines.map((l) => [l.kg, l.dir])).toEqual([[30, 1], [8, -1]]);
    });

    it('files a job under the material it drew most roll of', () => {
        // A job that started on one BOPP roll and then ran on Regular is a Regular
        // job: by weight, not by which roll happened to be drawn first, and with
        // both Regular rolls added together even though each is lighter alone.
        const [job] = jobsFromTxns([
            roll({ kg: 50, material: 'NW BOPP' }),
            roll({ kg: 40 }), roll({ kg: 35 })
        ]);
        expect(job.material).toBe('NW REGULAR');
    });

    it('gives a job that drew no roll no material, rather than guessing one', () => {
        const [job] = jobsFromTxns([article({ type: 'LESS' }), article({ loc: 'PRINTING AREA' })]);
        expect(job.material).toBeNull();
    });

    it('ignores a movement that belongs to no job', () => {
        expect(jobsFromTxns([roll({ job: null })])).toEqual([]);
    });
});

describe('batchFigures — the roll kg / made kg / return / waste rows', () => {
    it('splits the batch by roll material and totals it', () => {
        const { rows, total } = batchFigures([
            roll({ job: 1, kg: 100 }), article({ job: 1, kg: 90 }), roll({ job: 1, type: 'ADD', kg: 4 }),
            roll({ job: 2, kg: 50, material: 'NW BOPP' }), article({ job: 2, kg: 45, material: 'NW BOPP' })
        ]);
        expect(rows.map((r) => [r.key, r.collected, r.produced, r.returned, r.wastage])).toEqual([
            ['NW REGULAR', 100, 90, 4, 6],
            ['NW BOPP', 50, 45, 0, 5]
        ]);
        expect(total).toEqual({ collected: 150, produced: 135, returned: 4, wastage: 11, jobs: 2 });
    });

    it('lists materials in the order of the paper form, not the order they were drawn', () => {
        const { rows } = batchFigures([
            roll({ job: 1, material: 'NW INNER LAMINATION' }),
            roll({ job: 2, material: 'NW VIRGIN' })
        ]);
        expect(rows.map((r) => r.key)).toEqual(['NW VIRGIN', 'NW INNER LAMINATION']);
    });

    it('does not charge ready stock walked to the printing area as made', () => {
        // The trip writes both legs; netted, it made nothing and wasted nothing.
        const { total } = batchFigures([
            roll({ kg: 100 }), article({ kg: 95 }),
            article({ type: 'LESS', kg: 20 }), article({ loc: 'PRINTING AREA', kg: 20 })
        ]);
        expect(total.produced).toBe(95);
        expect(total.wastage).toBe(5);
    });

    it('weighs counted output from its geometry instead of reading it as zero', () => {
        // Sheets carry Weight_Kg_ 0. Read off the weight column alone, the whole
        // roll would be booked to waste.
        const { total } = batchFigures([
            roll({ kg: 10 }),
            article({ kg: 0, cnt: 1000, itype: 'SHEET', code: 'SHEET', w: '17', h: '24', gsm: '75' })
        ]);
        expect(total.produced).toBeCloseTo(1000 * 17 * 24 * 75 / 1550000, 2);
        expect(total.wastage).toBeLessThan(10);
    });

    it('leaves out a job that has booked nothing', () => {
        const { rows, total } = batchFigures([roll({ job: 1 }), { ...roll({ job: 2 }), kg: 0 }]);
        expect(rows).toHaveLength(1);
        expect(total.jobs).toBe(1);
    });
});

describe('balanceMoments — when "before" and "after" are taken', () => {
    it('takes before at the first roll movement and after at the last', () => {
        expect(balanceMoments([closed], [roll({ ts: 300 }), roll({ ts: 100 }), roll({ type: 'ADD', ts: 450 })]))
            .toEqual({ before: 100, after: 450 });
    });

    it('ignores finished-stock movements when the batch drew roll', () => {
        // Collecting finished stock comes after the rolls are back; it is not a
        // rolls-godown event and must not push "after" past the return.
        expect(balanceMoments([closed], [roll({ ts: 100 }), article({ ts: 900 })]))
            .toEqual({ before: 100, after: 100 });
    });

    it('has no after until the leftover rolls are back', () => {
        expect(balanceMoments([{ completedAt: 500, returned: 0 }], [roll({ ts: 100 })]))
            .toEqual({ before: 100, after: null });
    });

    it('falls back to any movement when the batch drew no roll', () => {
        expect(balanceMoments([closed], [article({ ts: 700 })])).toEqual({ before: 700, after: 700 });
    });

    it('takes a group from its first draw to its last return', () => {
        expect(balanceMoments([closed, closed], [roll({ job: 1, ts: 300 }), roll({ job: 2, ts: 100 }), roll({ job: 2, type: 'ADD', ts: 800 })]))
            .toEqual({ before: 100, after: 800 });
    });

    it('has no after while any batch in the group is still open', () => {
        // One sheets batch still holding its leftover rolls keeps the whole
        // group's after balance open -- those rolls are not back on the shelf.
        expect(balanceMoments([closed, { completedAt: 500, returned: 0 }], [roll({ ts: 100 })]))
            .toEqual({ before: 100, after: null });
    });

    it('has neither when the batch has not moved anything', () => {
        expect(balanceMoments([closed], [])).toEqual({ before: null, after: null });
    });
});

describe('rollBalances — the rolls godown at one moment', () => {
    const rows = [
        { item: 1, material: 'NW REGULAR', beforeKg: 40, afterKg: 0 },
        { item: 2, material: 'nw regular ', beforeKg: 35.5, afterKg: 35.5 },
        { item: 3, material: 'NW BOPP', beforeKg: 0.001, afterKg: 0.001 }
    ];

    it('always lists the five materials on the form, in its order', () => {
        expect(rollBalances([], 'beforeKg').rows.map((r) => r.key)).toEqual(ROLL_MATERIALS.map((m) => m.key));
    });

    it('weighs and counts by material', () => {
        const { rows: out, total } = rollBalances(rows, 'beforeKg');
        expect(out[0]).toMatchObject({ key: 'NW REGULAR', kg: 75.5, rolls: 2 });
        expect(total).toEqual({ kg: 75.5, rolls: 2 });
    });

    it('does not count an emptied roll as a roll on the shelf', () => {
        expect(rollBalances(rows, 'afterKg').rows[0]).toMatchObject({ kg: 35.5, rolls: 1 });
        expect(rollBalances(rows, 'afterKg').rows[2]).toMatchObject({ key: 'NW BOPP', rolls: 0 });
    });

    it('sums a negative balance as the books hold it, so the total matches the stock views', () => {
        const { total } = rollBalances([...rows, { item: 4, material: 'NW VIRGIN', beforeKg: -2 }], 'beforeKg');
        expect(total).toEqual({ kg: 73.5, rolls: 2 });
    });

    it('puts a material the form does not name under Other, only when it holds stock', () => {
        expect(rollBalances(rows, 'beforeKg').rows.some((r) => r.key === 'OTHER')).toBe(false);
        const { rows: out } = rollBalances([{ item: 9, material: 'PP WOVEN', beforeKg: 12 }], 'beforeKg');
        expect(out.at(-1)).toMatchObject({ key: 'OTHER', kg: 12, rolls: 1 });
    });
});

describe('changeBreakdown — why the rolls godown moved between before and after', () => {
    // Batch 56 (2026-10-06 DCUT): NW Regular rose by 4,984 kg while the batch drew
    // 481 kg net, because 157 new rolls arrived mid-batch and batch 57 was drawing
    // alongside. Read as one change figure, it looked like the batch's doing.
    const rows = [
        { material: 'NW REGULAR', inBatch: 1, hasJob: 1, kg: -481.28 },
        { material: 'NW REGULAR', inBatch: 0, hasJob: 1, kg: -265.58 },
        { material: 'NW REGULAR', inBatch: 0, hasJob: 0, kg: 5731 },
        { material: 'NW BOPP', inBatch: 0, hasJob: 1, kg: -519.7 }
    ];

    it('splits each material into this batch, other batches, and stock with no job', () => {
        const { rows: out } = changeBreakdown(rows);
        expect(out[0]).toMatchObject({ key: 'NW REGULAR', batch: -481.28, other: -265.58, stock: 5731, net: 4984.14 });
        expect(out[2]).toMatchObject({ key: 'NW BOPP', batch: 0, other: -519.7, stock: 0, net: -519.7 });
    });

    it('totals every column so the net equals the change between the balances', () => {
        expect(changeBreakdown(rows).total).toEqual({ batch: -481.28, other: -785.28, stock: 5731, net: 4464.44 });
    });

    it('lists the five materials on the form even when nothing moved', () => {
        expect(changeBreakdown([]).rows.map((r) => r.key)).toEqual(ROLL_MATERIALS.map((m) => m.key));
    });

    it('files an unnamed material under Other', () => {
        const { rows: out } = changeBreakdown([{ material: 'PP WOVEN', inBatch: 0, hasJob: 0, kg: 20 }]);
        expect(out.at(-1)).toMatchObject({ key: 'OTHER', stock: 20, net: 20 });
    });
});

describe('groupFigures — a group of batches, one block per type', () => {
    const dcut = { id: 56, type: 'ROLLS TO DCUT', date: 2, jobs: '[1,2]' };
    const sheets = { id: 57, type: 'ROLLS TO SHEETS', date: 2, jobs: '[3]' };
    const dcutEarlier = { id: 51, type: 'ROLLS TO DCUT', date: 1, jobs: '["L",4]' };

    it('files each movement under the type of the batch whose job wrote it', () => {
        const { blocks } = groupFigures([sheets, dcut], [
            roll({ job: 1, kg: 100 }), roll({ job: 2, kg: 50, material: 'NW BOPP' }),
            roll({ job: 3, kg: 80, material: 'NW VIRGIN' })
        ]);
        expect(blocks.map((k) => [k.type, k.total.collected])).toEqual([
            ['ROLLS TO DCUT', 150], ['ROLLS TO SHEETS', 80]
        ]);
        expect(blocks[0].rows.map((r) => r.key)).toEqual(['NW REGULAR', 'NW BOPP']);
    });

    it('lays the types out in the paper form order, D cut first', () => {
        const side = { id: 58, type: 'ROLLS TO SIDEPATTY', date: 2, jobs: '[]' };
        expect(groupFigures([side, sheets, dcut], []).blocks.map((k) => k.type))
            .toEqual(['ROLLS TO DCUT', 'ROLLS TO SHEETS', 'ROLLS TO SIDEPATTY']);
    });

    it('puts two batches of one type in one block, oldest first', () => {
        const { blocks } = groupFigures([dcut, dcutEarlier], [roll({ job: 4, kg: 30 }), roll({ job: 1, kg: 70 })]);
        expect(blocks).toHaveLength(1);
        expect(blocks[0].batches.map((b) => b.id)).toEqual([51, 56]);
        expect(blocks[0].total.collected).toBe(100);
    });

    it('keeps a picked batch with nothing booked, so the group shows it was there', () => {
        const { blocks } = groupFigures([dcut, sheets], [roll({ job: 1 })]);
        expect(blocks[1]).toMatchObject({ type: 'ROLLS TO SHEETS', rows: [] });
    });

    it('totals the group as the sum of its type blocks', () => {
        const { total } = groupFigures([dcut, sheets], [
            roll({ job: 1, kg: 100 }), article({ job: 1, kg: 90 }),
            roll({ job: 3, kg: 50 }), roll({ job: 3, type: 'ADD', kg: 10 }), article({ job: 3, kg: 38 })
        ]);
        expect(total).toEqual({ collected: 150, produced: 128, returned: 10, wastage: 12, jobs: 2 });
    });
});

describe('the picked batches', () => {
    it('reads the URL list as unique whole ids, ignoring junk', () => {
        expect(parseBatchIds('57, 56,abc,,56,-3,1.5')).toEqual([56, 57]);
        expect(parseBatchIds(null)).toEqual([]);
    });

    it('sends the ids to the query as one JSON array', () => {
        expect(batchIdsArg([56, '57', 0])).toBe('[56,57]');
    });

    it("reads a batch's job list from Grist's reference-list encodings", () => {
        expect(jobIdsOf({ jobs: '[531,532]' })).toEqual([531, 532]);
        expect(jobIdsOf({ jobs: ['L', 7] })).toEqual([7]);
        expect(jobIdsOf({ jobs: 'not json' })).toEqual([]);
    });

    it('groups the picker by day, newest first, types in form order', () => {
        const days = batchesByDay([
            { id: 1, date: 10, type: 'ROLLS TO SHEETS' },
            { id: 2, date: 20, type: 'ROLLS TO SIDEPATTY' },
            { id: 3, date: 20, type: 'ROLLS TO DCUT' }
        ]);
        expect(days.map((d) => [d.date, d.batches.map((b) => b.id)])).toEqual([[20, [3, 2]], [10, [1]]]);
    });
});

describe('batch labels', () => {
    it('is closed only once completed AND the rolls are back', () => {
        expect(isBatchClosed(closed)).toBe(true);
        expect(isBatchClosed({ completedAt: 500, returned: 0 })).toBe(false);
        expect(isBatchClosed({ completedAt: null, returned: 1 })).toBe(false);
    });

    it('says where an open batch has got to', () => {
        expect(batchStatus({})).toBe('Not started');
        expect(batchStatus({ startedAt: 1 })).toBe('Running');
        expect(batchStatus({ startedAt: 1, completedAt: 2 })).toBe('Rolls not returned');
        expect(batchStatus(closed)).toBe('Closed');
    });

    it('reads the batch number off Job_Batch_ID, falling back to the row id', () => {
        expect(batchNumber({ id: 57, name: '2026-10-06 - ROLLS TO SHEETS - 57' })).toBe('57');
        expect(batchNumber({ id: 12, name: null })).toBe('12');
    });

    it('gives wastage as a share of roll in, and nothing when no roll went in', () => {
        expect(wastagePct({ collected: 200, wastage: 5 })).toBe(2.5);
        expect(wastagePct({ collected: 0, wastage: 0 })).toBeNull();
    });

    it('counts the movements nobody has signed for', () => {
        expect(unackedCount([roll(), roll({ ack: 0 }), roll({ ack: null })])).toBe(2);
    });
});
