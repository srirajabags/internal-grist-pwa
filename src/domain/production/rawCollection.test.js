import { describe, it, expect } from 'vitest';
import { collectionLines, uncollectedLines } from './rawCollection';

const roll = (id, kg) => ({ id, kg, type: 'ROLL', location: 'ROLLS GODOWN' });
const job = (id, items) => ({ id, type: 'ROLLS TO HANDLES', invItemOptions: items });
const NOW = 1792300829;

// 2026-08-31 - ROLLS TO SHEETS - 12 - 88 listed roll 1248 twice in its
// Inventory_Items ([1248,1252,1248,1249]), and collecting it booked the 32.4 kg
// roll out twice -- the roll then stood at -32.4 kg. Job 387 did the same with
// roll 2735. One roll leaves the shelf once, however often the plan names it.
describe('the lines a raw-stock collection books', () => {
    it('books a roll the job names twice only once', () => {
        const lines = collectionLines(job(88, [roll(1248, 32.4), roll(1252, 30), roll(1248, 32.4), roll(1249, 31)]), 0, NOW);
        expect(lines.map((l) => l.fields.Item_ID)).toEqual([1248, 1252, 1249]);
    });

    it('takes each roll whole, from its own godown', () => {
        expect(collectionLines(job(739, [roll(2895, 27.34)]), 1, NOW)).toEqual([{
            fields: {
                Item_ID: 2895, Production_Job: 739, Transaction_Type: 'LESS',
                Weight_Kg_: 27.34, Location: 'ROLLS GODOWN', Transaction_Time: NOW
            }
        }]);
    });

    it('books nothing on the roll trip for a job met entirely from ready stock', () => {
        expect(collectionLines(job(232, [{ id: 150, kg: 5, type: 'SIDEPATTY', location: 'BAGS GODOWN' }]), 5, NOW)).toEqual([]);
    });
});

// Batch 2026-10-17 - ROLLS TO HANDLES - 81. Factory Team marked its rolls collected
// at 10:50:29 on 18 Oct; Bashira's phone, loaded before that, still showed the
// button and marked them collected again at 10:52:43. Four rolls were booked out
// twice, the incharge acknowledged both sets, and job 739's card read 54.68 kg for
// a 27.34 kg roll. A collection books only what the books do not already hold.
describe('what a collection still has to book', () => {
    const lines = [
        collectionLines(job(735, [roll(1908, 24)]), 0, NOW),
        collectionLines(job(739, [roll(2895, 27.34)]), 0, NOW)
    ].flat();

    it('books nothing when another phone has already collected every roll', () => {
        const booked = [
            { job: 735, item: 1908, who: 'Factory Team', at: NOW },
            { job: 739, item: 2895, who: 'Factory Team', at: NOW }
        ];
        const { toWrite, already } = uncollectedLines(lines, booked);
        expect(toWrite).toEqual([]);
        expect(already).toEqual(booked);
    });

    it('books only the rolls not yet taken', () => {
        const { toWrite, already } = uncollectedLines(lines, [{ job: 735, item: 1908, who: 'Factory Team', at: NOW }]);
        expect(toWrite.map((l) => l.fields.Item_ID)).toEqual([2895]);
        expect(already).toHaveLength(1);
    });

    it('does not count the same roll taken by a different job', () => {
        const { toWrite } = uncollectedLines(lines, [{ job: 649, item: 2895, who: 'Bashira', at: NOW - 86400 }]);
        expect(toWrite).toHaveLength(2);
    });

    it('matches a job collected with no item against its no-item line', () => {
        const noItem = collectionLines(job(500, []), 12, NOW);
        expect(noItem[0].fields.Item_ID).toBeNull();
        expect(uncollectedLines(noItem, [{ job: 500, item: null, who: 'Factory Team', at: NOW }]).toWrite).toEqual([]);
        expect(uncollectedLines(noItem, [{ job: 500, item: 0, who: 'Factory Team', at: NOW }]).toWrite).toEqual([]);
    });

    it('books everything when nothing is booked yet', () => {
        expect(uncollectedLines(lines, []).toWrite).toEqual(lines);
        expect(uncollectedLines(lines).toWrite).toEqual(lines);
    });
});
