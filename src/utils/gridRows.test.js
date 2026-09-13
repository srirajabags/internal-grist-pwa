import { describe, it, expect } from 'vitest';
import { wrapRows, wrapOverflows } from './gridRows';

// The batch page's "On the floor" list was fixed at five rows on desktop, so eleven
// rolls stood in a tall block three wide beside a card with room for all of them in
// two. Five is a ceiling, not a target: use as few rows as the width allows.
describe('wrapRows — as few rows as fit, never more than the cap', () => {
    const tile = { itemWidth: 68, gap: 8 };

    it('uses two rows for eleven rolls when ten fit across', () => {
        expect(wrapRows({ count: 11, width: 760, maxRows: 5, ...tile })).toBe(2);
    });

    it('uses one row when everything fits across', () => {
        expect(wrapRows({ count: 3, width: 760, maxRows: 5, ...tile })).toBe(1);
    });

    it('grows toward the cap as the space narrows', () => {
        // 300px holds four tiles across (4 × 68 + 3 × 8 = 296), so eleven need three rows.
        expect(wrapRows({ count: 11, width: 300, maxRows: 5, ...tile })).toBe(3);
    });

    it('stops at the cap and leaves the rest to scroll', () => {
        expect(wrapRows({ count: 30, width: 300, maxRows: 5, ...tile })).toBe(5);
        expect(wrapRows({ count: 11, width: 300, maxRows: 2, ...tile })).toBe(2);
    });

    it('holds at the cap until the width is known, and gives one row for nothing at all', () => {
        expect(wrapRows({ count: 11, width: 0, maxRows: 5, ...tile })).toBe(5);
        expect(wrapRows({ count: 0, width: 760, maxRows: 5, ...tile })).toBe(1);
    });
});

// "Swipe to see them all" was shown past four rolls whatever the width, so a list
// sitting whole in two rows still told the crew to swipe for more.
describe('wrapOverflows — whether anything is left off to the side', () => {
    const tile = { itemWidth: 68, gap: 8 };

    it('is false when the rows the cap allows hold every roll', () => {
        expect(wrapOverflows({ count: 11, width: 760, maxRows: 5, ...tile })).toBe(false);
        expect(wrapOverflows({ count: 30, width: 760, maxRows: 5, ...tile })).toBe(false);
    });

    it('is true once the capped rows run out of width', () => {
        expect(wrapOverflows({ count: 30, width: 300, maxRows: 5, ...tile })).toBe(true);
        expect(wrapOverflows({ count: 11, width: 300, maxRows: 2, ...tile })).toBe(true);
    });

    it('says nothing until the width is known', () => {
        expect(wrapOverflows({ count: 11, width: 0, maxRows: 5, ...tile })).toBe(false);
    });
});
