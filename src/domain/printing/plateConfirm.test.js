import { describe, it, expect } from 'vitest';
import { confirmPlateAction, confirmRepeatAnswer } from './plateConfirm';
import { STATUS } from './printingPlates';

// Every write on /plates is confirmed a second time (user, 6 Nov 2026).
const plate = (fields) => ({
    id: 1, plateNo: 'PL-0042', rackCode: 'K-79', rack: 'K', slot: 79, plateType: 'PLATE',
    plateCount: 1, status: STATUS.UNVERIFIED, shop: 'Yuvaraj Mens Wear', bagW: 12, bagH: 18, ...fields
});

describe('confirmPlateAction — says which plate and what changes', () => {
    it('names the plate by its rack code and shows the status change', () => {
        const c = confirmPlateAction(plate(), 'VERIFIED');
        expect(c.heading).toBe('Mark K-79 as found?');
        expect(c.subject).toBe('Plate · 1 plate · Yuvaraj Mens Wear');
        expect(c.lines[0]).toBe(`${STATUS.UNVERIFIED} → ${STATUS.IN_RACK}`);
        expect(c.danger).toBe(false);
    });

    it('falls back to the plate number when there is no rack code', () => {
        expect(confirmPlateAction(plate({ rackCode: '' }), 'NOT_FOUND').heading).toBe('Mark PL-0042 as not found?');
    });

    it('shows the old and new place of a moved plate, in the plate\'s own section', () => {
        const c = confirmPlateAction(plate({ status: STATUS.IN_RACK, plateType: 'STEREO', rackCode: 'KS-79' }), 'MOVED', { rack: 'm', slot: ' 12 ' });
        expect(c.heading).toBe('Move KS-79 to MS-12?');
        expect(c.lines).toContain('Place: KS-79 → MS-12');
        expect(c.lines[0]).toBe(`Stays ${STATUS.IN_RACK}`);
    });

    it('repeats a stereo size typed in, so a slip is seen before it is written', () => {
        expect(confirmPlateAction(plate({ plateType: 'STEREO' }), 'VERIFIED', { stereoSize: '14x20' }).lines)
            .toContain('Stereo size: 14x20');
        expect(confirmPlateAction(plate(), 'VERIFIED', { stereoSize: '  ' }).lines.join()).not.toContain('Stereo size');
    });

    it('warns, in red, that a damaged or discarded plate leaves use', () => {
        for (const a of ['DAMAGED', 'DISCARDED']) {
            const c = confirmPlateAction(plate({ status: STATUS.IN_RACK }), a);
            expect(c.danger).toBe(true);
            expect(c.lines.join(' ')).toContain('no longer be offered');
        }
        expect(confirmPlateAction(plate(), 'DISCARDED').confirmLabel).toBe('Yes, discard it');
    });

    it('says a not-found plate stays listed as missing', () => {
        const c = confirmPlateAction(plate(), 'NOT_FOUND');
        expect(c.danger).toBe(false);
        expect(c.lines.join(' ')).toContain('missing');
    });

    it('refuses to describe an action it has no words for', () => {
        expect(() => confirmPlateAction(plate(), 'ISSUED')).toThrow();
    });
});

describe('confirmRepeatAnswer — the old-plate answer for a repeat order', () => {
    const so = { id: 9, orderId: 115001, shop: 'Yuvaraj Mens Wear', bagW: 12, bagH: 18 };

    it('names the plate to be reused and the order it is for', () => {
        const c = confirmRepeatAnswer(so, { plate: plate(), fits: true });
        expect(c.heading).toBe('Reuse K-79 for Yuvaraj Mens Wear?');
        expect(c.subject).toBe('115001 · Yuvaraj Mens Wear · bag 12x18');
        expect(c.lines).toEqual(['Old plate available: YES', 'Reuse K-79 · Plate · 1 plate · made for 12x18']);
    });

    it('repeats the too-big warning on the confirmation', () => {
        expect(confirmRepeatAnswer(so, { plate: plate({ bagW: 14, bagH: 20 }), fits: false }).lines)
            .toContain('This plate was made for a bigger bag than this order.');
    });

    it('says a new plate will be made when there is no old one', () => {
        const c = confirmRepeatAnswer(so, null);
        expect(c.heading).toBe('No old plate for Yuvaraj Mens Wear?');
        expect(c.lines).toContain('Old plate available: NO');
    });
});
