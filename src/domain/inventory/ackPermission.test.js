import { describe, it, expect } from 'vitest';
import { isOwnEntry, canAcknowledge, needsSecondPerson } from './ackPermission';

// 2026-10-17: Sudhakar acknowledged 653 of his own rolls-godown entries in a
// month. Grist now refuses a self-acknowledgement; these keep the app from
// offering one. 2026-10-18: NEW STOCK, a new roll's opening entry, is exempt.

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

describe('needsSecondPerson', () => {
    it('holds ADD and LESS to a second person', () => {
        expect(needsSecondPerson('ADD')).toBe(true);
        expect(needsSecondPerson('LESS')).toBe(true);
        expect(needsSecondPerson(null)).toBe(true);
    });

    it('lets a new roll’s opening entry through, however it is spelt', () => {
        expect(needsSecondPerson('NEW STOCK')).toBe(false);
        expect(needsSecondPerson(' new stock ')).toBe(false);
    });
});

describe('canAcknowledge', () => {
    it('lets someone else sign off an entry', () => {
        expect(canAcknowledge(36, 43, false, 'ADD')).toBe(true);
    });

    it('stops the person who booked an ADD or LESS', () => {
        expect(canAcknowledge(36, 36, false, 'ADD')).toBe(false);
        expect(canAcknowledge(36, 36, false, 'LESS')).toBe(false);
    });

    it('lets the person who booked NEW STOCK sign it off', () => {
        expect(canAcknowledge(36, 36, false, 'NEW STOCK')).toBe(true);
    });

    it('exempts doc owners', () => {
        expect(canAcknowledge(2, 2, true, 'ADD')).toBe(true);
    });
});
