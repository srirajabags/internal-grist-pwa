import { describe, it, expect } from 'vitest';
import {
    lineKg, lineDir, drawnKg, jobLedger, lineSize, outputBreakdown, batchLedger
} from './jobLedger';
import { PRINTING_AREA } from '../inventory/godown';

// A produced line, as the transaction query hands it over. `dir` is +1 for what
// the job put down and -1 for ready stock it drew off the shelf.
const line = (over = {}) => ({
    item: 'X', code: 'SIDEPATTY - NW REGULAR - RED - 75GSM (6x54)', type: 'SIDEPATTY',
    w: '6', h: '54', gsm: '75', kg: 0, cnt: 0, loc: PRINTING_AREA, dir: 1, ...over
});
const bundleKg = (w, h, gsm) => (w * h * gsm) / 1550000 * 50;

// Collecting ready stock writes BOTH legs at once: a LESS off the bags godown and
// an ADD into the printing area. They cancel, which is the whole reason production
// is netted rather than summed -- the ADD is otherwise indistinguishable from
// something the machine made. A fixture with only one leg is not a stock trip.
const stockTrip = (over = {}) => [
    line({ ...over, dir: -1, loc: 'BAGS GODOWN' }),
    line({ ...over, dir: 1, loc: PRINTING_AREA })
];

describe('lineKg — a counted article still weighs something', () => {
    it('takes the booked weight when there is one', () => {
        expect(lineKg(line({ kg: 12.5, cnt: 3 }))).toBe(12.5);
    });

    it('derives the weight of a counted article from its own geometry', () => {
        // Patty and sheets book a COUNT and leave the weight column at zero. Summing
        // that column alone reported a whole sheet job as having produced nothing
        // and handed its entire roll to wastage.
        expect(lineKg(line({ kg: 0, cnt: 7 }))).toBeCloseTo(bundleKg(6, 54, 75) * 7, 9);
    });

    it('is 0 rather than a guess when there is neither weight nor geometry', () => {
        expect(lineKg(line({ kg: 0, cnt: 7, h: null }))).toBe(0);
        expect(lineKg(null)).toBe(0);
    });
});

describe('lineDir — which way the stock moved', () => {
    it('reads a drawn line as negative and everything else as output', () => {
        expect(lineDir(line({ dir: -1 }))).toBe(-1);
        expect(lineDir(line({ dir: 1 }))).toBe(1);
        // Lines from before the column existed are all output, which is what they were.
        expect(lineDir(line({ dir: undefined }))).toBe(1);
    });
});

describe('jobLedger — roll out, less what came back, less what was made', () => {
    it('charges the rest of the roll to wastage', () => {
        const job = { collectedKg: 100, returnedKg: 20, outputLines: [line({ kg: 70 })] };
        expect(jobLedger(job)).toMatchObject({ collected: 100, produced: 70, returned: 20, wastage: 10 });
    });

    it('nets ready stock out of production rather than counting it as made', () => {
        // A stock trip books an ADD in the printing area that is otherwise
        // indistinguishable from output, and a LESS off the shelf. Only the
        // difference was really made.
        const job = {
            collectedKg: 50, returnedKg: 0,
            outputLines: [line({ kg: 30, dir: 1 }), line({ kg: 12, dir: -1, loc: 'BAGS GODOWN' })]
        };
        expect(jobLedger(job).produced).toBe(18);
    });

    it('weighs a counted job rather than reporting it as nothing', () => {
        const job = { collectedKg: 10, returnedKg: 0, outputLines: [line({ kg: 0, cnt: 10 })] };
        expect(jobLedger(job).produced).toBeCloseTo(bundleKg(6, 54, 75) * 10, 2);
    });

    it('falls back to the job column when no lines came through', () => {
        expect(jobLedger({ collectedKg: 40, producedKg: 33, returnedKg: 2 }).produced).toBe(33);
    });

    it('says it is empty rather than showing a finished job that made nothing', () => {
        expect(jobLedger({}).empty).toBe(true);
        expect(jobLedger({ collectedKg: 10, outputLines: [] }).empty).toBe(false);
    });
});

describe('drawnKg — what came off the shelf instead of the machine', () => {
    it('counts only the drawn lines, weighing the counted ones', () => {
        const job = { outputLines: [line({ kg: 30 }), line({ kg: 0, cnt: 7, dir: -1 })] };
        expect(drawnKg(job)).toBeCloseTo(bundleKg(6, 54, 75) * 7, 2);
        expect(drawnKg({})).toBe(0);
    });
});

describe('lineSize', () => {
    it('names an article by the size on its own item code', () => {
        expect(lineSize({ w: '6', h: '54' })).toBe('6″ × 54″');
        expect(lineSize({ w: '36' })).toBe('36″');
        expect(lineSize({})).toBe('');
    });
});

describe('outputBreakdown — what each size was asked for against what it made', () => {
    const plan = (groups) => ({ sizeGroups: groups });
    const group = (w, h, made, kg) => ({ dims: { w, h }, made, qty: kg, sizeTag: null });

    it('does not charge the machine with what came off the shelf', () => {
        // The plan covers the whole requirement, ready stock included. A job that
        // filled its order exactly used to report as short by whatever it never
        // had to cut.
        const job = {
            outputLines: [
                line({ item: 'A', kg: 0, cnt: 18, dir: 1 }),
                ...stockTrip({ item: 'A', kg: 0, cnt: 7 })
            ]
        };
        const [row] = outputBreakdown(job, plan([group(6, 54, 25, 18.97)]));
        expect(row.asked).toBe(18);        // 25 ordered, 7 drawn
        expect(row.made).toBe(18);         // the trip's two legs cancel
        expect(row.short).toBe(0);
    });

    it('still reports a size the run genuinely missed', () => {
        const job = { outputLines: [line({ item: 'A', kg: 0, cnt: 10, dir: 1 })] };
        const [row] = outputBreakdown(job, plan([group(6, 54, 25, 18.97)]));
        expect(row.asked).toBe(25);
        expect(row.made).toBe(10);
        expect(row.short).toBe(15);
        expect(row.unit).toBe('bundles');
    });

    it('compares in the unit the article is counted in, kilos for a weighed one', () => {
        const bag = (over) => line({ type: 'DCUT BAG', code: 'DCUT BAG - NW REGULAR - RED - 75GSM (12x16)', w: '12', h: '16', ...over });
        const job = { outputLines: [bag({ item: 'B', kg: 40, cnt: 0 })] };
        const [row] = outputBreakdown(job, plan([{ dims: { w: 12, h: 16 }, made: 0, qty: 50 }]));
        expect(row.unit).toBe('kg');
        expect(row.made).toBe(40);
        expect(row.short).toBe(10);
    });

    it('drops a size that was handed over ready and never needed cutting', () => {
        // "0 / 0" in a list of what the run produced reads as a failure.
        const job = { outputLines: stockTrip({ item: 'A', kg: 0, cnt: 7 }) };
        expect(outputBreakdown(job, plan([group(6, 54, 7, 5.49)]))).toEqual([]);
    });

    it('sums the transactions that land on one article', () => {
        // The printing-area share and the surplus to the bags godown are two rows.
        const job = {
            outputLines: [
                line({ item: 'A', kg: 0, cnt: 20, loc: PRINTING_AREA }),
                line({ item: 'A', kg: 0, cnt: 5, loc: 'BAGS GODOWN' })
            ]
        };
        const [row] = outputBreakdown(job, plan([group(6, 54, 25, 18.97)]));
        expect(row.made).toBe(25);
        expect(row.byLocation[PRINTING_AREA]).toBeGreaterThan(0);
        expect(row.byLocation['BAGS GODOWN']).toBeGreaterThan(0);
    });

    it('books a drawn line against the printing area, not the shelf it left', () => {
        // Netting it at its own location would show the shelf as having been
        // handed stock it never saw.
        const job = { outputLines: [line({ item: 'A', kg: 0, cnt: 7, dir: -1, loc: 'BAGS GODOWN' })] };
        const rows = outputBreakdown(job, plan([group(6, 54, 25, 18.97)]));
        expect(rows[0].byLocation['BAGS GODOWN']).toBeUndefined();
        expect(rows[0].byLocation[PRINTING_AREA]).toBeLessThan(0);
    });

    it('puts the worst shortfall at the top', () => {
        const job = {
            outputLines: [
                line({ item: 'A', kg: 0, cnt: 24, w: '6', h: '54' }),
                line({ item: 'B', kg: 0, cnt: 2, w: '6', h: '46' })
            ]
        };
        const rows = outputBreakdown(job, plan([group(6, 54, 25, 18.97), group(6, 46, 25, 16.69)]));
        expect(rows[0].item).toBe('B');    // 23 short beats 1 short
        expect(rows[0].short).toBeGreaterThan(rows[1].short);
    });

    it('reports what was made even with no plan to compare against', () => {
        const job = { outputLines: [line({ item: 'A', kg: 0, cnt: 10 })] };
        const [row] = outputBreakdown(job);
        expect(row.asked).toBeNull();
        expect(row.short).toBe(0);
    });
});

describe('batchLedger — the rows and the summary cannot disagree', () => {
    it('is the jobs added up', () => {
        const a = { collectedKg: 100, returnedKg: 10, outputLines: [line({ kg: 80 })] };
        const b = { collectedKg: 50, returnedKg: 0, outputLines: [line({ kg: 45 })] };
        expect(batchLedger([a, b])).toEqual({ collected: 150, produced: 125, returned: 10, wastage: 15 });
        expect(batchLedger()).toEqual({ collected: 0, produced: 0, returned: 0, wastage: 0 });
    });
});
