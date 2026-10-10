import { describe, it, expect } from 'vitest';
import { queueOf, nextStatuses, ageLabel, contactLinks, statusOf, isOpen, appendNote } from './enquiryQueue';

const e = (id, over = {}) => ({ id, Status: 'New', Priority_Rank: 2, Submitted_At: 1000 + id, Lead_Score: 0.5, ...over });

describe('queueOf — what a telecaller works next', () => {
  it('works High before Normal before Low', () => {
    const q = queueOf([e(1, { Priority_Rank: 3 }), e(2, { Priority_Rank: 1 }), e(3)]);
    expect(q.map((x) => x.id)).toEqual([2, 3, 1]);
  });
  it('takes the oldest first within one priority, so a stream of new leads cannot bury an old one', () => {
    const q = queueOf([e(3, { Submitted_At: 300 }), e(1, { Submitted_At: 100 }), e(2, { Submitted_At: 200 })]);
    expect(q.map((x) => x.id)).toEqual([1, 2, 3]);
  });
  it('shows open work by default, and done or everything on request', () => {
    const all = [e(1), e(2, { Status: 'Order confirmed' }), e(3, { Status: 'Not a fit' }), e(4, { Status: 'Contacted' })];
    expect(queueOf(all).map((x) => x.id)).toEqual([1, 4]);
    expect(queueOf(all, { filter: 'done' }).map((x) => x.id)).toEqual([2, 3]);
    expect(queueOf(all, { filter: 'new' }).map((x) => x.id)).toEqual([1]);
    expect(queueOf(all, { filter: 'all' })).toHaveLength(4);
  });
  it('can sort by newest, or by the affiliate\'s lead score', () => {
    const all = [e(1, { Submitted_At: 100, Lead_Score: 0.9 }), e(2, { Submitted_At: 300, Lead_Score: 0.2 }), e(3, { Submitted_At: 200, Lead_Score: 0.6 })];
    expect(queueOf(all, { sort: 'newest' }).map((x) => x.id)).toEqual([2, 3, 1]);
    expect(queueOf(all, { sort: 'score' }).map((x) => x.id)).toEqual([1, 3, 2]);
  });
  it('treats a blank status as new and an unknown filter or sort as the default', () => {
    expect(statusOf({ Status: '' })).toBe('New');
    expect(isOpen({ Status: null })).toBe(true);
    expect(queueOf([e(1, { Status: '' })], { filter: 'nonsense', sort: 'nonsense' })).toHaveLength(1);
  });
});

describe('nextStatuses — the moves a telecaller can make', () => {
  it('moves forward one stage at a time, and can always close', () => {
    expect(nextStatuses(e(1))).toEqual(['Contacted', 'Not a fit', 'Duplicate']);
    expect(nextStatuses(e(1, { Status: 'Qualified' }))).toEqual(['Quotation sent', 'Not a fit', 'Duplicate']);
  });
  it('never offers "Order confirmed": that comes from linking the customer', () => {
    for (const s of ['New', 'Contacted', 'Qualified', 'Quotation sent']) {
      expect(nextStatuses(e(1, { Status: s }))).not.toContain('Order confirmed');
    }
  });
  it('reopens a closed enquiry as Contacted, and leaves a confirmed order alone', () => {
    expect(nextStatuses(e(1, { Status: 'Not a fit' }))).toEqual(['Contacted']);
    expect(nextStatuses(e(1, { Status: 'Order confirmed' }))).toEqual([]);
  });
});

describe('ageLabel and contactLinks', () => {
  const now = 10_000_000 * 1000;
  it('says how long an enquiry has waited, in whole units', () => {
    expect(ageLabel(10_000_000 - 30, now)).toBe('just now');
    expect(ageLabel(10_000_000 - 5 * 60, now)).toBe('5 min ago');
    expect(ageLabel(10_000_000 - 3 * 3600, now)).toBe('3 h ago');
    expect(ageLabel(10_000_000 - 86400, now)).toBe('1 day ago');
    expect(ageLabel(10_000_000 - 3 * 86400, now)).toBe('3 days ago');
    expect(ageLabel(null, now)).toBe('');
  });
  it('builds call and WhatsApp links from a stored number', () => {
    expect(contactLinks('+919123456780')).toEqual({ tel: 'tel:+919123456780', whatsapp: 'https://wa.me/919123456780' });
    expect(contactLinks('')).toBe(null);
  });
});

describe('appendNote — a running call log, newest at the bottom', () => {
  // 10 Oct 2026, 00:30 IST: still 9 Oct in UTC, so the IST date must be used.
  const at = Date.UTC(2026, 9, 9, 19, 0);
  it('stamps the IST date and who wrote it', () => {
    expect(appendNote('', 'Called, will send sample', 'Priya', at)).toBe('10 Oct · Priya: Called, will send sample');
  });
  it('keeps what was there and adds below', () => {
    expect(appendNote('9 Oct · Ravi: No answer', 'Spoke to owner', 'Priya', at)).toBe('9 Oct · Ravi: No answer\n10 Oct · Priya: Spoke to owner');
  });
  it('adds nothing for an empty note', () => {
    expect(appendNote('kept', '   ', 'Priya', at)).toBe('kept');
  });
});
