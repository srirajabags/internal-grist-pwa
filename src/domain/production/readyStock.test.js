import { describe, it, expect } from 'vitest';
import { readyDraw, takeUpTo, itemArticleKey } from './readyStock';

// Weight of one bundle of side patty (50 strips) from its geometry.
const bundleKg = (w, h, gsm) => (w * h * gsm) / 1550000 * 50;
const patty = (id, h, bundles) => ({
    id, type: 'SIDEPATTY', w: '6', h: String(h), gsm: '75', colour: 'RED',
    code: `SIDEPATTY - NW REGULAR - RED - 75GSM (6x${h})`,
    count: bundles, kg: bundleKg(6, h, 75) * bundles, collectedKg: null
});
const bagOrder = (id, bagW, bagH, qty) => ({
    id, model: 'STITCHING', material: 'NON-WOVEN', print: 'SINGLE COLOUR',
    qty, qtyType: 'PIECES', bagW: String(bagW), bagH: String(bagH),
    sidepattyWidth: '6', sidepattyColour: 'RED', sidepattyGsm: '75',
    rollMaterial: 'NW REGULAR'
});

// 2026-09-10 - ROLLS TO SIDEPATTY - 25 - 216, as it actually stood.
// Five orders across three bag sizes, so three different patty lengths:
//   10x14 -> 6x40 (300 bags)   12x16 -> 6x46 (300)   16x18 -> 6x54 (1100)
// With 10% overage that is 7, 7 and 25 bundles.
const job216 = () => ({
    id: 216, type: 'ROLLS TO SIDEPATTY', overage: 0.1,
    subOrders: [
        bagOrder(11285, 10, 14, 300),
        bagOrder(11286, 12, 16, 300),
        bagOrder(11287, 16, 18, 300),
        bagOrder(11400, 16, 18, 500),
        bagOrder(11545, 16, 18, 300)
    ],
    // The shelf that day, in the order the job listed its items.
    invItemOptions: [
        { id: 1654, type: 'ROLL', w: '36', h: null, gsm: '80', colour: 'RED', kg: 14.42, collectedKg: null },
        patty(695, 46, 25),
        patty(146, 54, 7),
        patty(694, 40, 9)
    ]
});

const bundlesOf = (draw, item) => Math.ceil(draw.byItem.get(item.id) / (item.kg / item.count) - 1e-9);

describe('readyDraw — each size draws against its own line', () => {
    it('does not let one size drink the whole job (the 25-216 bug)', () => {
        const job = job216();
        const draw = readyDraw(job);
        const [, p46, p54, p40] = job.invItemOptions;
        // Before the fix this took 26, 7 and 9: the 6x46 was first in the list and
        // soaked up a requirement pooled across all three sizes, while the 6x54 --
        // the only size actually short -- got only what happened to be left.
        expect(bundlesOf(draw, p46)).toBe(7);
        expect(bundlesOf(draw, p54)).toBe(7);   // its whole holding; the rest is cut
        expect(bundlesOf(draw, p40)).toBe(7);
    });

    it('never draws more of a size than the orders for it want', () => {
        const job = job216();
        const draw = readyDraw(job);
        const wanted6x46 = bundleKg(6, 46, 75) * 7;      // 300 bags + 10%
        expect(draw.byArticle.get('SIDEPATTY||6x46')).toBeLessThanOrEqual(wanted6x46 + 1e-9);
    });

    it('never draws more of a size than the shelf is holding', () => {
        const job = job216();
        const draw = readyDraw(job);
        for (const item of job.invItemOptions.slice(1)) {
            expect(draw.byItem.get(item.id)).toBeLessThanOrEqual(item.kg);
        }
    });

    it('counts stock already collected as answered, and asks for no more of it', () => {
        const job = job216();
        job.invItemOptions[1].collectedKg = job.invItemOptions[1].kg;   // all 25 already carried
        const draw = readyDraw(job);
        expect(draw.byItem.get(695)).toBe(job.invItemOptions[1].kg);
        // The other two are unaffected: one size over-collected does not eat another's line.
        expect(bundlesOf(draw, job.invItemOptions[2])).toBe(7);
        expect(bundlesOf(draw, job.invItemOptions[3])).toBe(7);
    });

    it('gives up rather than guess when an item matches no line of the plan', () => {
        const job = job216();
        job.invItemOptions.push(patty(999, 60, 4));     // a length nobody ordered
        expect(readyDraw(job)).toBeNull();
    });

    it('has nothing to say about a job with no ready stock', () => {
        const job = job216();
        job.invItemOptions = [job.invItemOptions[0]];   // the roll alone
        expect(readyDraw(job).byItem.size).toBe(0);
    });
});

describe('takeUpTo — rounding must not invent stock', () => {
    it('does not round up past the shelf (the 251-of-250 bug)', () => {
        // 250 model sheets at 16x19, 110 GSM weigh 5.393548 kg. Rounded to the
        // gram that is 5.394, and 5.394 / one-sheet came back as 250.02 sheets.
        const perSheet = (16 * 19 * 110) / 1550000;
        const shelf = 250 * perSheet;
        const take = takeUpTo(shelf, 1e9);
        expect(take).toBeLessThanOrEqual(shelf);
        expect(Math.ceil(take / perSheet - 1e-9)).toBe(250);
    });

    it('holds for every count and geometry we stock', () => {
        for (const [w, h, gsm] of [[16, 19, 110], [16, 21, 110], [12, 17, 90], [24, 17, 110], [20, 30, 75]]) {
            const per = (w * h * gsm) / 1550000;
            for (let c = 1; c <= 500; c++) {
                const take = takeUpTo(c * per, Infinity);
                expect(Math.ceil(take / per - 1e-9)).toBeLessThanOrEqual(c);
            }
        }
    });

    it('takes only what is wanted when that is less than the shelf', () => {
        expect(takeUpTo(10, 4)).toBe(4);
        expect(takeUpTo(10, -5)).toBe(0);
        expect(takeUpTo(10, 25)).toBe(10);
    });
});

describe('itemArticleKey', () => {
    it('separates two patty lengths that differ in nothing else', () => {
        expect(itemArticleKey({ type: 'SIDEPATTY', w: '6', h: '46' }))
            .not.toBe(itemArticleKey({ type: 'SIDEPATTY', w: '6', h: '54' }));
    });

    it('separates two model sheets of the same size', () => {
        const k9 = itemArticleKey({ type: 'MODEL NUMBER SHEET', w: '16', h: '19', colour: 'K9' });
        const m11 = itemArticleKey({ type: 'MODEL NUMBER SHEET', w: '16', h: '19', colour: 'M11' });
        expect(k9).not.toBe(m11);
    });

    it('does not read an ordinary article\'s colour as a model', () => {
        // Or a white sheet could not answer the line that asked for a white sheet.
        expect(itemArticleKey({ type: 'SHEET', w: '16', h: '19', colour: 'WHITE' }))
            .toBe(itemArticleKey({ type: 'SHEET', w: '16', h: '19', colour: 'BLUE' }));
    });

    it('reads a size the same whichever way round it is catalogued', () => {
        expect(itemArticleKey({ type: 'SHEET', w: '26', h: '16' }))
            .toBe(itemArticleKey({ type: 'SHEET', w: '16', h: '26' }));
    });
});
