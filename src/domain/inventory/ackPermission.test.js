import { describe, it, expect } from 'vitest';
import { isOwnEntry, canAcknowledge } from './ackPermission';

// 2026-10-17: Sudhakar acknowledged 653 of his own rolls-godown entries in a
// month. Grist now refuses a self-acknowledgement; these keep the app from
// offering one.

describe('isOwnEntry', () => {
    it('matches the creator against the current Team member', () => {
        expect(isOwnEntry(36, 36)).toBe(true);
        expect(isOwnEntry('36', 36)).toBe(true);
        expect(isOwnEntry(36, 43)).toBe(false);
    });

    it('never treats a blank creator as anyone’s own entry', () => {
        expect(isOwnEntry(0, 0)).toBe(false);
        expect(isOwnEntry(null, undefined)).toBe(false);
        expect(isOwnEntry(0, 36)).toBe(false);
    });
});

describe('canAcknowledge', () => {
    it('lets someone else sign off an entry', () => {
        expect(canAcknowledge(36, 43, false)).toBe(true);
    });

    it('stops the person who booked it', () => {
        expect(canAcknowledge(36, 36, false)).toBe(false);
    });

    it('exempts doc owners', () => {
        expect(canAcknowledge(2, 2, true)).toBe(true);
    });
});
