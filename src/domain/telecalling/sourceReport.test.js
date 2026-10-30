import { describe, it, expect } from 'vitest';
import { sourceGroup, creditOrders, dayTable, trend, tableDay, fetchRange, NO_SOURCE } from './sourceReport';

const D29 = 1793232000; // 2026-10-29
const D30 = 1793318400; // 2026-10-30
const D31 = 1793404800; // 2026-10-31
const enq = (id, day, source, customer = 0, createdAt = day + id) => ({ id, day, source, customer, createdAt });
const ord = (id, customer, day, value) => ({ id, customer, day, value });

describe('sourceGroup — Source folded into a few rows', () => {
    it('folds the 18 team numbers into WhatsApp and call by their "- W" / "- P" ending', () => {
        expect(sourceGroup('9177056061 - W')).toBe('Team WhatsApp');
        expect(sourceGroup('9177056061 - P')).toBe('Team call');
        expect(sourceGroup('9177056061 -P ')).toBe('Team call');
    });
    it('names the origins, ignoring case and stray spaces', () => {
        expect(sourceGroup('Website ')).toBe('Website');
        expect(sourceGroup('Google Ads Visitor')).toBe('Google Ads');
        expect(sourceGroup('Whatsapp API')).toBe('WhatsApp API');
        expect(sourceGroup('AI Calls')).toBe('AI Calls');
    });
    it('keeps a blank Source apart (every row before 29 Oct 2026) and anything else as Other', () => {
        expect(sourceGroup('')).toBe(NO_SOURCE);
        expect(sourceGroup(null)).toBe(NO_SOURCE);
        expect(sourceGroup('Walk in')).toBe('Other');
    });
});

describe('creditOrders — each order goes to the enquiry that led to it', () => {
    it('credits the first website order (srinivasa stationary, ₹6,450 on 30 Oct) to Website', () => {
        const c = creditOrders([enq(5372, D30, 'Website', 31807)], [ord(7947, 31807, D30, 6450)]);
        expect(c).toHaveLength(1);
        expect(c[0].enquiry.source).toBe('Website');
    });
    it('credits an order once, to the latest enquiry on or before its day, when the customer rang twice', () => {
        const c = creditOrders(
            [enq(1, D29, '9177056061 - P', 9), enq(2, D30, 'Website', 9), enq(3, D31, 'Website', 9)],
            [ord(50, 9, D30, 1000)]
        );
        expect(c).toHaveLength(1);
        expect(c[0].enquiry.id).toBe(2);
    });
    it('credits no one for an order dated before the customer\'s first enquiry', () => {
        expect(creditOrders([enq(1, D30, 'Website', 9)], [ord(50, 9, D29, 1000)])).toEqual([]);
    });
    it('ignores enquiries that matched no customer', () => {
        expect(creditOrders([enq(1, D30, 'Website', 0)], [ord(50, 0, D30, 1000)])).toEqual([]);
    });
});

describe('dayTable — one day\'s enquiries by source and the orders they led to', () => {
    const enquiries = [
        enq(1, D30, 'Website', 31807), enq(2, D30, 'Website'), enq(3, D30, '9177056061 - P', 7),
        enq(4, D29, 'Website', 8)
    ];
    const credited = creditOrders(enquiries, [ord(10, 31807, D30, 6450), ord(11, 8, D30, 900), ord(12, 7, D31, 2400)]);
    const t = dayTable(enquiries, credited, D30);

    it('counts the day\'s enquiries and matched customers per source, in the fixed source order', () => {
        expect(t.rows.map((r) => [r.source, r.enquiries, r.matched])).toEqual([['Website', 2, 1], ['Team call', 1, 1]]);
    });
    it('counts orders from the day\'s enquiries even when placed on a later day, and not orders credited to another day', () => {
        expect(t.rows.find((r) => r.source === 'Website')).toMatchObject({ orders: 1, value: 6450 });
        expect(t.rows.find((r) => r.source === 'Team call')).toMatchObject({ orders: 1, value: 2400 });
        expect(t.total).toEqual({ enquiries: 3, matched: 2, orders: 2, value: 8850 });
    });
});

describe('trend — the fortnight day by day', () => {
    const enquiries = [enq(1, D29, 'Website', 5), enq(2, D30, 'Website'), enq(3, D30, '')];
    const credited = creditOrders(enquiries, [ord(9, 5, D31, 3000)]);
    const tr = trend(enquiries, credited, D29, D31);

    it('has a slot for every day, quiet days included', () => {
        expect(tr.days).toEqual([D29, D30, D31]);
    });
    it('dates enquiries by when they came in and orders by the order\'s own day', () => {
        const w = tr.sources.find((s) => s.source === 'Website');
        expect(w.enquiries).toEqual([1, 1, 0]);
        expect(w.orders).toEqual([0, 0, 1]);
        expect(w.value).toEqual([0, 0, 3000]);
        expect(tr.sources.map((s) => s.source)).toEqual(['Website', NO_SOURCE]);
    });
});

describe('tableDay and fetchRange', () => {
    const now = new Date('2026-10-30T13:00:00Z'); // 6:30 PM IST
    it('defaults to India\'s today and pulls a future day back to it', () => {
        expect(tableDay(null, now)).toBe('2026-10-30');
        expect(tableDay('2026-11-02', now)).toBe('2026-10-30');
        expect(tableDay('2026-10-21', now)).toBe('2026-10-21');
    });
    it('takes India\'s today just after midnight IST, not UTC\'s yesterday', () => {
        expect(tableDay(null, new Date('2026-10-30T19:00:00Z'))).toBe('2026-10-31');
    });
    it('fetches the 14-day chart range, reaching back further for an older table day', () => {
        expect(fetchRange('2026-10-30', now)).toEqual({ from: D30 - 13 * 86400, to: D30, trendFrom: D30 - 13 * 86400 });
        expect(fetchRange('2026-10-01', now).from).toBe(1790812800);
    });
});
