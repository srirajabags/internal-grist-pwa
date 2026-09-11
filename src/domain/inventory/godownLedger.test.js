import { describe, it, expect } from 'vitest';
import { withBalances } from './godownLedger';

const row = (id, cbund, ack = 1) => ({ id, ts: id, itemRef: 691, loc: 'BAGS GODOWN', ack, wkg: 0, cbund, itype: 'SIDEPATTY', code: 'SIDEPATTY - NW REGULAR - RED - 75GSM (6x46)' });

describe('withBalances — a running balance the floor can read', () => {
    it('does not leak floating point into a bundle count', () => {
        // The real ledger for SIDEPATTY_NW_REGULAR_RED_75_6X46. The godown books
        // partial bundles when it recounts (16.4, 24.4), and summing those without
        // rounding printed "2.6000000000000014 bundles" on the history screen.
        const rows = [53, -34, -16.4, 3, -5, 5, 24.4, -5, -25].map((c, i) => row(i + 1, c));
        const out = withBalances(rows);
        expect(out.map((r) => r.balanceCount)).toEqual([53, 19, 2.6, 5.6, 0.6, 5.6, 30, 25, 0]);
    });

    it('leaves the balance where it was for a movement nobody has signed for', () => {
        const out = withBalances([row(1, 10), row(2, 5, 0), row(3, 2)]);
        expect(out.map((r) => r.balanceCount)).toEqual([10, 10, 12]);
        expect(out.map((r) => r.acked)).toEqual([true, false, true]);
    });

    it('starts from the opening balance it is given', () => {
        const out = withBalances([row(1, 5)], [{ itemRef: 691, loc: 'BAGS GODOWN', kg: 0, cnt: 100 }]);
        expect(out[0].balanceCount).toBe(105);
    });

    it('keeps each item and godown on its own balance', () => {
        const other = { ...row(2, 7), itemRef: 999 };
        const out = withBalances([row(1, 5), other, row(3, 5)]);
        expect(out.map((r) => r.balanceCount)).toEqual([5, 7, 10]);
    });
});
