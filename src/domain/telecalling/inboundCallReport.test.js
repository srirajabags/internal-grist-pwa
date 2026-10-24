import { describe, it, expect } from 'vitest';
import {
    pivot, statusColumns, statusOf, orderPct, dateToGrist, istDay, reportRange,
    detailQuery, shopOf, placeOf, contactOf, notOrderPct, notOrderCount, NOT_ORDER,
    NO_STATUS, NOT_DEALT
} from './inboundCallReport';

const DAY1 = 1792713600; // 2026-10-23
const DAY2 = 1792800000; // 2026-10-24
const row = (dealtBy, name, day, status, calls) => ({ dealtBy, name, day, status, calls });

describe('statusColumns — the pivot\'s columns', () => {
    it('keeps the Status_Update choice order, not the order rows arrive in', () => {
        const cols = statusColumns([row(1, 'A', DAY1, 'ORDER END', 1), row(1, 'A', DAY1, 'GIVEN ORDER', 1), row(1, 'A', DAY1, 'FOLLOWUP DATE', 1)]);
        expect(cols).toEqual(['GIVEN ORDER', 'FOLLOWUP DATE', 'ORDER END']);
    });
    it('keeps a hand-typed status as its own column, after the choices, and a blank one last', () => {
        const cols = statusColumns([row(0, null, DAY1, '', 1), row(1, 'A', DAY1, 'same customer ', 1), row(1, 'A', DAY1, 'GIVEN ORDER', 1)]);
        expect(cols).toEqual(['GIVEN ORDER', 'same customer', NO_STATUS]);
    });
    it('does not split one status in two over a trailing space (the registry has "same customer ")', () => {
        expect(statusOf('GIVEN ORDER ')).toBe('GIVEN ORDER');
        expect(statusOf(null)).toBe(NO_STATUS);
        expect(statusColumns([row(1, 'A', DAY1, 'GIVEN ORDER ', 1), row(1, 'A', DAY2, 'GIVEN ORDER', 1)])).toEqual(['GIVEN ORDER']);
    });
});

describe('pivot — rows by day, then person', () => {
    const rows = [
        row(2, 'Ravi', DAY1, 'GIVEN ORDER', 3),
        row(2, 'Ravi', DAY1, 'FOLLOWUP DATE', 1),
        row(2, 'Ravi', DAY2, 'GIVEN ORDER', 1),
        row(5, 'Sita', DAY2, 'ORDER END', 2),
        row(0, null, DAY2, '', 4)
    ];
    const p = pivot(rows);

    it('runs the days oldest first, as a calendar reads', () => {
        expect(p.days.map((d) => d.day)).toEqual([DAY1, DAY2]);
    });
    it('adds each person into their day and everything into the grand total', () => {
        const day1 = p.days.find((d) => d.day === DAY1);
        expect(day1.total).toBe(4);
        expect(day1.people.map((x) => [x.name, x.total, x.counts['GIVEN ORDER']])).toEqual([['Ravi', 4, 3]]);
        expect(p.days.find((d) => d.day === DAY2).total).toBe(7);
        expect(p.grand.total).toBe(11);
        expect(p.grand.counts[NO_STATUS]).toBe(4);
    });
    it('puts the busiest person first in a day and calls nobody has dealt with last, however many', () => {
        expect(p.days.find((d) => d.day === DAY2).people.map((x) => x.name)).toEqual(['Sita', 'Ravi', NOT_DEALT]);
    });
    it('names a person missing from Team by their id rather than dropping their calls', () => {
        expect(pivot([row(9, null, DAY1, 'GIVEN ORDER', 1)]).days[0].people[0].name).toBe('Team #9');
    });
});

describe('orderPct — GIVEN ORDER as a share of the row\'s total', () => {
    it('counts every call in the row, whatever its status', () => {
        expect(orderPct({ counts: { 'GIVEN ORDER': 1, 'ORDER END': 3 }, total: 4 })).toBe(25);
    });
    it('gives the rest of the row, no status included, as not given, so the two make 100', () => {
        const line = { counts: { 'GIVEN ORDER': 1, 'ORDER END': 2, [NO_STATUS]: 1 }, total: 4 };
        expect(notOrderCount(line)).toBe(3);
        expect(notOrderPct(line)).toBe(75);
        expect(notOrderPct({ counts: {}, total: 0 })).toBeNull();
    });
    it('is 0 when there were calls but no orders, and blank when there were no calls', () => {
        expect(orderPct({ counts: { 'ORDER END': 2 }, total: 2 })).toBe(0);
        expect(orderPct({ counts: {}, total: 0 })).toBeNull();
    });
});

describe('date range', () => {
    it('reads a date as Grist stores a Date: UTC midnight, in seconds', () => {
        expect(dateToGrist('2026-10-24')).toBe(DAY2);
        expect(dateToGrist('24/10/2026')).toBeNull();
        expect(dateToGrist('')).toBeNull();
    });
    it('takes today in India, not UTC — at 2am IST it is already the next day', () => {
        expect(istDay(new Date('2026-10-23T20:30:00Z'))).toBe('2026-10-24');
        expect(istDay(new Date('2026-10-23T18:00:00Z'))).toBe('2026-10-23');
    });
    it('defaults to the last 7 days, today included', () => {
        expect(reportRange(null, null, new Date('2026-10-24T06:00:00Z'))).toEqual({ from: '2026-10-18', to: '2026-10-24' });
    });
    it('counts the 7 days back across a month end', () => {
        expect(reportRange(null, null, new Date('2026-11-03T06:00:00Z'))).toEqual({ from: '2026-10-28', to: '2026-11-03' });
    });
    it('turns a backwards range round instead of showing nothing', () => {
        expect(reportRange('2026-10-20', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-20' });
    });
});

describe('detailQuery — the calls behind a tapped figure', () => {
    const range = { from: '2026-10-18', to: '2026-10-24' };
    it('a person\'s count under one status on one day narrows by all three', () => {
        const q = detailQuery(range, { day: DAY1, dealtBy: 2, status: 'GIVEN ORDER' });
        expect(q.args).toEqual([DAY1, DAY1, 2, 'GIVEN ORDER']);
        expect(q.sql).toContain('COALESCE(c.Dealt_By, 0) = ?');
    });
    it('a day\'s Total is everyone and every status on that day', () => {
        const q = detailQuery(range, { day: DAY2 });
        expect(q.args).toEqual([DAY2, DAY2]);
        expect(q.sql).not.toContain('Dealt_By, 0) = ?');
        expect(q.sql).not.toContain('TRIM(');
    });
    it('the grand total spans the whole range', () => {
        expect(detailQuery(range, {}).args).toEqual([dateToGrist('2026-10-18'), DAY2]);
    });
    it('"Not dealt yet" is Dealt_By 0, and "No status" is a blank status', () => {
        expect(detailQuery(range, { day: DAY1, dealtBy: 0, status: NO_STATUS }).args).toEqual([DAY1, DAY1, 0, '']);
    });
    it('lists the not-given calls as everything but GIVEN ORDER, blanks included', () => {
        const q = detailQuery(range, { day: DAY1, status: NOT_ORDER });
        expect(q.args).toEqual([DAY1, DAY1, 'GIVEN ORDER']);
        expect(q.sql).toContain("TRIM(COALESCE(c.Status_Update, '')) <> ?");
    });
    it('matches a status with a stray space, as the column header does', () => {
        expect(detailQuery(range, { status: 'same customer' }).sql).toContain("TRIM(COALESCE(c.Status_Update, '')) = ?");
    });
});

describe('who the caller is', () => {
    it('prefers the customer record, and falls back to what was typed for a new caller', () => {
        expect(shopOf({ shop: 'Lakshmi Stores', newShop: 'x' })).toBe('Lakshmi Stores');
        expect(shopOf({ shop: null, newShop: ' New Shop ' })).toBe('New Shop');
        expect(placeOf({ city: '', newCity: 'Kurnool' })).toBe('Kurnool');
        expect(shopOf({})).toBe('');
    });
    it('joins first and last name, skipping a blank', () => {
        expect(contactOf({ firstName: 'Ravi', lastName: '' })).toBe('Ravi');
        expect(contactOf({ firstName: 'Ravi', lastName: 'K' })).toBe('Ravi K');
    });
});

describe('detailQuery — order of the list', () => {
    it('lists calls oldest first, the same way the table runs its days', () => {
        expect(detailQuery({ from: '2026-10-18', to: '2026-10-24' }, {}).sql).toMatch(/ORDER BY c\.Created_at, c\.id$/);
    });
});
