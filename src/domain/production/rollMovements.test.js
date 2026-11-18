import { describe, it, expect } from 'vitest';
import { inView, VIEWS, zipName, csvName, withClosing } from './rollMovements';

// The "New stock" tab in Roll movements (18 Nov 2026): the godown wanted the rolls
// that arrived in a window on their own, to label and shelve them, without every
// roll a job merely drew from. isNew comes back from Grist /sql as 1/0, and as a
// string on some paths, so the filter must not trust truthiness of "0".
const row = (iid, isNew) => withClosing({ iid, isNew, opening: 0, delta: 10, inKg: 10, outKg: 0, moves: 1 });

describe('roll movement views', () => {
    const rows = [row('A', 1), row('B', 0), row('C', '1'), row('D', '0'), row('E', null)];

    it('all movements keeps every roll', () => {
        expect(inView(rows, 'all').map((r) => r.iid)).toEqual(['A', 'B', 'C', 'D', 'E']);
    });

    it('new stock keeps only rolls with a NEW STOCK entry in the window', () => {
        expect(inView(rows, 'new').map((r) => r.iid)).toEqual(['A', 'C']);
    });

    it('an unknown view falls back to all, never to an empty list', () => {
        expect(inView(rows, 'nope')).toHaveLength(5);
    });

    it('offers the two tabs in order', () => {
        expect(VIEWS.map((v) => v.label)).toEqual(['All movements', 'New stock']);
    });
});

describe('download names say which list they hold', () => {
    it('keeps the old names for all movements', () => {
        expect(zipName('2026-11-17', '2026-11-18')).toBe('roll-labels_2026-11-17_to_2026-11-18.zip');
        expect(csvName('2026-11-17', '2026-11-18', 'all')).toBe('roll-movements_2026-11-17_to_2026-11-18.csv');
    });

    it('marks the new-stock downloads', () => {
        expect(zipName('2026-11-17', '2026-11-18', 'new')).toBe('new-stock-labels_2026-11-17_to_2026-11-18.zip');
        expect(csvName('2026-11-17', '2026-11-18', 'new')).toBe('new-stock_2026-11-17_to_2026-11-18.csv');
    });
});
