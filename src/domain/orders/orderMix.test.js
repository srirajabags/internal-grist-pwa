import { describe, it, expect } from 'vitest';
import {
    orderKind, buildOrderMix, monthRange, monthBounds, monthLabel, istMonth, NEW, REGULAR, OTHER, NO_AREA,
    parseAreas, areasParam, areasLabel,
    targetMap, targetProgress, rangeTarget, monthsBetween, percentText
} from './orderMix';

const row = (month, areaId, area, repeat, category, orders, value) => ({ month, areaId, area, repeat, category, orders, value });

describe('orderKind — new, Regular or other', () => {
    it('counts a first order as new even when the customer is now tagged Regular (1,129 such orders, Nov 2026)', () => {
        expect(orderKind({ repeat: 0, category: 'REGULAR' })).toBe(NEW);
        expect(orderKind({ repeat: 0, category: '' })).toBe(NEW);
    });
    it('splits repeat orders by the customer\'s TEMP_FALLBACK_SALES_CATEGORY, ignoring case and spaces', () => {
        expect(orderKind({ repeat: 1, category: 'REGULAR' })).toBe(REGULAR);
        expect(orderKind({ repeat: 1, category: ' regular ' })).toBe(REGULAR);
        expect(orderKind({ repeat: 1, category: '' })).toBe(OTHER);
        expect(orderKind({ repeat: 1, category: 'NO SHOP' })).toBe(OTHER);
    });
    it('does not call an order new when Is_Repeat_Order errored (customer with no Date_of_Entry)', () => {
        expect(orderKind({ repeat: null, category: 'REGULAR' })).toBe(REGULAR);
        expect(orderKind({ repeat: null, category: '' })).toBe(OTHER);
    });
});

describe('buildOrderMix — months by area group', () => {
    const rows = [
        row('2025-10', 3, 'Adoni', 1, 'REGULAR', 10, 215700),
        row('2025-10', 3, 'Adoni', 1, '', 1, 15750),
        row('2025-10', 3, 'Adoni', 0, 'REGULAR', 2, 10800),
        row('2025-10', 0, null, 0, '', 1, 5000),
        row('2025-10', 5, 'Anantapur', 1, 'REGULAR', 4, 123400),
        row('2025-11', 3, 'Adoni', 1, 'REGULAR', 3, 60000)
    ];
    const mix = buildOrderMix(rows);

    it('lists months newest first', () => {
        expect(mix.months.map((m) => m.month)).toEqual(['2025-11', '2025-10']);
    });
    it('adds up each kind and the total for an area in a month', () => {
        const adoni = mix.months[1].areas.find((a) => a.area === 'Adoni');
        expect(adoni[REGULAR]).toEqual({ orders: 10, value: 215700 });
        expect(adoni[OTHER]).toEqual({ orders: 1, value: 15750 });
        expect(adoni[NEW]).toEqual({ orders: 2, value: 10800 });
        expect(adoni.total).toEqual({ orders: 13, value: 242250 });
    });
    it('keeps orders with no area group, at the bottom', () => {
        expect(mix.months[1].areas.map((a) => a.area)).toEqual(['Adoni', 'Anantapur', NO_AREA]);
    });
    it('totals each month, each area over the range, and the range', () => {
        expect(mix.months[1].total).toEqual({ orders: 18, value: 370650 });
        expect(mix.months[1][REGULAR]).toEqual({ orders: 14, value: 339100 });
        expect(mix.areas.find((a) => a.area === 'Adoni').total).toEqual({ orders: 16, value: 302250 });
        expect(mix.total.total).toEqual({ orders: 21, value: 430650 });
        expect(mix.total[NEW]).toEqual({ orders: 3, value: 15800 });
    });
    it('reads counts and values that arrive as text', () => {
        const m = buildOrderMix([row('2026-01', 3, 'Adoni', 1, 'REGULAR', '2', '1500')]);
        expect(m.total.total).toEqual({ orders: 2, value: 1500 });
    });
});

describe('months', () => {
    const now = new Date('2026-11-11T06:00:00Z');
    it('defaults to this month and the two before it', () => {
        expect(monthRange(null, null, now)).toEqual({ from: '2026-09', to: '2026-11' });
    });
    it('takes the month in India: 31 Oct 19:00 UTC is already November', () => {
        expect(istMonth(new Date('2026-10-31T19:00:00Z'))).toBe('2026-11');
    });
    it('turns a backwards range round and pulls a future month back to this one', () => {
        expect(monthRange('2026-08', '2026-05', now)).toEqual({ from: '2026-05', to: '2026-08' });
        expect(monthRange('2026-10', '2027-02', now)).toEqual({ from: '2026-10', to: '2026-11' });
    });
    it('ignores a month that is not one', () => {
        expect(monthRange('2026-13', 'junk', now)).toEqual({ from: '2026-09', to: '2026-11' });
    });
    it('runs from the first of the first month to the first of the month after the last, across a year end', () => {
        expect(monthBounds({ from: '2025-12', to: '2025-12' })).toEqual({
            from: Date.UTC(2025, 11, 1) / 1000,
            to: Date.UTC(2026, 0, 1) / 1000
        });
    });
    it('names a month', () => {
        expect(monthLabel('2025-10')).toBe('Oct 2025');
    });
});

describe('area group filter', () => {
    const rows = [
        row('2025-10', 3, 'Adoni', 1, 'REGULAR', 10, 215700),
        row('2025-10', 5, 'Anantapur', 1, 'REGULAR', 4, 123400),
        row('2025-10', 0, null, 0, '', 1, 5000),
        row('2025-11', 5, 'Anantapur', 0, '', 2, 9000)
    ];
    it('shows every area group when none is chosen', () => {
        expect(buildOrderMix(rows, []).total.total).toEqual({ orders: 17, value: 353100 });
    });
    it('narrows months, area groups and the total to the chosen ones', () => {
        const mix = buildOrderMix(rows, ['Anantapur']);
        expect(mix.areas.map((a) => a.area)).toEqual(['Anantapur']);
        expect(mix.months.map((m) => m.month)).toEqual(['2025-11', '2025-10']);
        expect(mix.months[1].total).toEqual({ orders: 4, value: 123400 });
        expect(mix.total.total).toEqual({ orders: 6, value: 132400 });
    });
    it('can pick the orders with no area group', () => {
        expect(buildOrderMix(rows, [NO_AREA]).total.total).toEqual({ orders: 1, value: 5000 });
    });
    it('drops a month the chosen area groups had no orders in', () => {
        expect(buildOrderMix(rows, ['Adoni']).months.map((m) => m.month)).toEqual(['2025-10']);
    });
    it('reads the address back, ignoring blanks and repeats, keeping names with brackets and commas', () => {
        expect(parseAreas('Kurnool (a)|Adoni||Adoni| ')).toEqual(['Kurnool (a)', 'Adoni']);
        expect(parseAreas(areasParam(['A, B', 'Guntur']))).toEqual(['A, B', 'Guntur']);
        expect(parseAreas(null)).toEqual([]);
    });
    it('names the filter, shortening a long choice', () => {
        expect(areasLabel([])).toBe('All area groups');
        expect(areasLabel(['Adoni', 'Guntur'])).toBe('Adoni, Guntur');
        expect(areasLabel(['Adoni', 'Guntur', 'Kolar', 'Ongole'])).toBe('Adoni, Guntur +2 more');
    });
});

describe('targets — Regular + Other value against the month\'s target', () => {
    // November 2026 as the report showed it on 21 Nov: Regular ₹36,72,943,
    // Other ₹6,77,675, New ₹8,08,425, against the ₹69.3L target sheet.
    const nov = buildOrderMix([
        row('2026-11', 1, 'Adoni', 1, 'REGULAR', 223, 3672943),
        row('2026-11', 1, 'Adoni', 1, '', 66, 677675),
        row('2026-11', 1, 'Adoni', 0, 'REGULAR', 64, 808425)
    ]).months[0];

    it('leaves new customers\' orders out, as the target sheet does', () => {
        const p = targetProgress(nov, 6930000);
        expect(p.achieved).toBe(3672943 + 677675);
        expect(percentText(p.share)).toBe('62.8%');
    });
    it('matches the October salary figure: ₹63.8L of ₹80L is 79.8%', () => {
        const oct = buildOrderMix([row('2026-10', 1, 'Adoni', 1, 'REGULAR', 456, 6382690)]).months[0];
        expect(percentText(targetProgress(oct, 8000000).share)).toBe('79.8%');
    });
    it('shows nothing for a month without a target, never 0%', () => {
        expect(targetProgress(nov, undefined)).toBeNull();
        expect(targetProgress(nov, 0)).toBeNull();
    });
    it('treats a blank or zero target row as no target, and lets a later row correct an earlier one', () => {
        const map = targetMap([
            { month: '2026-09', target: null },
            { month: '2026-10', target: 0 },
            { month: '2026-11', target: 7000000 },
            { month: '2026-11', target: 6930000 }
        ]);
        expect([...map.entries()]).toEqual([['2026-11', 6930000]]);
    });
    it('totals a range only when every month in it has a target', () => {
        const targets = targetMap([{ month: '2026-10', target: 8000000 }, { month: '2026-11', target: 6930000 }]);
        expect(rangeTarget({ from: '2026-10', to: '2026-11' }, targets)).toBe(14930000);
        expect(rangeTarget({ from: '2026-09', to: '2026-11' }, targets)).toBeNull();
    });
    it('walks months across a year end', () => {
        expect(monthsBetween({ from: '2026-11', to: '2027-02' })).toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
    });
    it('rounds to one decimal and can pass 100%', () => {
        expect(percentText(0.62849)).toBe('62.8%');
        expect(percentText(1.2)).toBe('120.0%');
    });
});
