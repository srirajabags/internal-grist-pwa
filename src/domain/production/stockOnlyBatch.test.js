import { describe, it, expect } from 'vitest';
import { isStockOnlyBatch, canCloseStockOnlyBatch, closeStockOnlyBatchFields } from './stockOnlyBatch';

// Batch 2026-10-09 - ROLLS TO HANDLES - 65. All four jobs (611-614) were answered
// from READYMADE HANDLE stock on the bags-godown shelf. The finished stock was
// collected on 9 Oct, which completed the jobs and the batch's production -- and
// the batch still sat in the open list, because closing needs
// Remaining_Inventory_Returned and the card offered only the two roll steps, whose
// checklists are empty and cannot be confirmed.
const handle = (id) => ({ id, type: 'READYMADE HANDLE', location: 'BAGS GODOWN' });
const roll = (id) => ({ id, type: 'ROLL', location: 'ROLLS GODOWN' });
const job = (id, items) => ({ id, invItemOptions: items, started: true, completed: true });
const batch65 = (over = {}) => ({
    id: 65,
    completedAt: 1791538567.879291,
    finCollected: true,
    invCollected: false,
    invReturned: false,
    jobs: [job(611, [handle(1)]), job(612, [handle(2)]), job(613, [handle(3)]), job(614, [handle(4)])],
    ...over
});

describe('a batch with no roll in it', () => {
    it('is recognised when every job draws only ready-made stock', () => {
        expect(isStockOnlyBatch(batch65())).toBe(true);
    });

    it('is not one when any job cuts a roll, even alongside ready stock', () => {
        expect(isStockOnlyBatch(batch65({ jobs: [job(611, [handle(1)]), job(612, [roll(9), handle(2)])] }))).toBe(false);
    });

    it('is not one when a job\'s stock cannot be read -- a roll step may still be owed', () => {
        expect(isStockOnlyBatch(batch65({ jobs: [job(611, [handle(1)]), job(612, [{ id: 7 }])] }))).toBe(false);
        expect(isStockOnlyBatch(batch65({ jobs: [job(611, [])] }))).toBe(false);
    });

    it('is not one when the batch has no jobs at all', () => {
        expect(isStockOnlyBatch(batch65({ jobs: [] }))).toBe(false);
        expect(isStockOnlyBatch(null)).toBe(false);
    });
});

describe('closing a batch with no roll', () => {
    it('is offered once production is complete and the batch is not yet closed (batch 65)', () => {
        expect(canCloseStockOnlyBatch(batch65())).toBe(true);
    });

    it('waits for production to complete -- the finished-stock collection is what completes it', () => {
        expect(canCloseStockOnlyBatch(batch65({ completedAt: null, finCollected: false }))).toBe(false);
    });

    it('is not offered again once closed', () => {
        expect(canCloseStockOnlyBatch(batch65({ invReturned: true }))).toBe(false);
    });

    it('is never offered on a batch that cuts a roll -- that one closes by returning it', () => {
        expect(canCloseStockOnlyBatch(batch65({ jobs: [job(611, [roll(9)])] }))).toBe(false);
    });

    it('sets collected in the same write as returned, the only way an operator\'s rule allows it', () => {
        expect(closeStockOnlyBatchFields()).toEqual({
            Required_Inventory_Collected: true,
            Remaining_Inventory_Returned: true
        });
    });
});
