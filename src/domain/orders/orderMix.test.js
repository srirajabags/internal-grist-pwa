import { describe, it, expect } from 'vitest';
import {
    orderKind, buildOrderMix, monthRange, monthBounds, monthLabel, istMonth, NEW, REGULAR, OTHER, NO_AREA,
    parseAreas, areasParam, areasLabel,
    targetMap, targetProgress, kindShares, rangeTarget, rangeProgress, monthsBetween, percentText, parseTarget, countedLabel
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
    it('gives Regular, Other and New each their own share; only Regular + Other make up the reached figure', () => {
        const shares = kindShares(nov, 6930000);
        expect(percentText(shares[REGULAR].share)).toBe('53.0%');
        expect(percentText(shares[OTHER].share)).toBe('9.8%');
        expect(percentText(shares[NEW].share)).toBe('11.7%');
        expect(shares[NEW].counted).toBe(false);
        expect(shares[REGULAR].own).toBe(false);
        expect(shares[REGULAR].share + shares[OTHER].share).toBeCloseTo(targetProgress(nov, 6930000).share, 10);
        expect(kindShares(nov, 0)).toBeNull();
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
        expect([...map.entries()]).toEqual([['2026-11', { value: 6930000, kinds: null }]]);
    });
    it('totals a range only when every month in it has a target', () => {
        const targets = targetMap([{ month: '2026-10', target: 8000000 }, { month: '2026-11', target: 6930000 }]);
        expect(rangeTarget({ from: '2026-10', to: '2026-11' }, targets).value).toBe(14930000);
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

describe('targets by category — Regular, Other and New kept separate (from Nov 2026)', () => {
    // November 2026 as the report showed it on 24 Nov, against the ₹1 crore
    // set by category: Regular ₹55L / 407, Other ₹14.3L / 141, New ₹30.7L.
    const nov = buildOrderMix([
        row('2026-11', 1, 'Adoni', 1, 'REGULAR', 230, 3743343),
        row('2026-11', 1, 'Adoni', 1, '', 67, 679725),
        row('2026-11', 1, 'Adoni', 0, 'REGULAR', 70, 885175)
    ]).months[0];
    const novRow = {
        month: '2026-11', target: 10000000,
        regularTarget: 5500000, regularOrders: 407, otherTarget: 1430000, otherOrders: 141, newTarget: 3070000, newOrders: null
    };
    const t = parseTarget(novRow);

    it('reads a row by category, and a blank Value_Target as the three added up', () => {
        expect(t.value).toBe(10000000);
        expect(t.kinds[REGULAR]).toEqual({ value: 5500000, orders: 407 });
        expect(t.kinds[NEW]).toEqual({ value: 3070000, orders: null });
        expect(parseTarget({ ...novRow, target: null }).value).toBe(10000000);
    });
    it('reads zeros in the category columns as a one-figure month (how October looks)', () => {
        expect(parseTarget({ month: '2026-10', target: 8000000, regularTarget: 0, otherTarget: 0, newTarget: 0 })).toEqual({ value: 8000000, kinds: null });
        expect(parseTarget({ month: '2026-12', target: 0, regularTarget: 0 })).toBeNull();
    });
    it('counts New towards the month once New has its own target', () => {
        const p = targetProgress(nov, t);
        expect(p.achieved).toBe(3743343 + 679725 + 885175);
        expect(percentText(p.share)).toBe('53.1%');
        expect(countedLabel(p)).toBe('Regular + Other + New');
    });
    it('measures each column against its own target, with its orders target', () => {
        const shares = kindShares(nov, t);
        expect(percentText(shares[REGULAR].share)).toBe('68.1%');
        expect(shares[REGULAR]).toMatchObject({ own: true, counted: true, orders: 407 });
        expect(percentText(shares[OTHER].share)).toBe('47.5%');
        expect(percentText(shares[NEW].share)).toBe('28.8%');
        expect(shares[NEW].orders).toBeNull();
    });
    it('gives no share to a column with no target of its own', () => {
        const shares = kindShares(nov, parseTarget({ ...novRow, otherTarget: null }));
        expect(shares[OTHER]).toBeNull();
        expect(shares[REGULAR].own).toBe(true);
    });
    it('totals a range month by month, each counting the way its own target does', () => {
        const months = buildOrderMix([
            row('2026-10', 1, 'Adoni', 1, 'REGULAR', 456, 6382690),
            row('2026-10', 1, 'Adoni', 0, 'REGULAR', 50, 400000),
            row('2026-11', 1, 'Adoni', 1, 'REGULAR', 230, 3743343),
            row('2026-11', 1, 'Adoni', 0, 'REGULAR', 70, 885175)
        ]).months;
        const targets = targetMap([{ month: '2026-10', target: 8000000 }, novRow]);
        const p = rangeProgress(months, { from: '2026-10', to: '2026-11' }, targets);
        // October without its New ₹4L, November with its New.
        expect(p.achieved).toBe(6382690 + 3743343 + 885175);
        expect(p.target).toBe(18000000);
        expect(p.targets.mixed).toBe(true);
        expect(p.targets.kinds).toBeNull();
        expect(countedLabel(p)).toBe('Counted orders');
    });
    it('adds up category targets over a range set by category throughout', () => {
        const targets = targetMap([novRow, { ...novRow, month: '2026-12' }]);
        const r = rangeTarget({ from: '2026-11', to: '2026-12' }, targets);
        expect(r.kinds[REGULAR]).toEqual({ value: 11000000, orders: 814 });
        expect(r.kinds[NEW]).toEqual({ value: 6140000, orders: null });
        expect(r.mixed).toBe(false);
    });
});
