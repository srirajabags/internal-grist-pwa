import { describe, it, expect } from 'vitest';
import { countToKg, primaryUnitFor, countUnitFor, pieceKg } from './txnDisplay';

// The godown books each form in one unit and only one. Reading stock back in the
// other unit is how a job that had signed out 25 bundles of side patty reported
// "0.00 kg collected" -- true, and no use to anybody.
describe('primaryUnitFor — the unit the godown actually books in', () => {
    it('weighs rolls and finished bags', () => {
        for (const t of ['ROLL', 'DCUT BAG', 'UCUT BAG', 'WCUT BAG', 'HANDLE BAG']) {
            expect(primaryUnitFor(t, `${t} - NW REGULAR - RED - 75GSM (12x16)`)).toBe('kg');
        }
    });

    it('counts patty, sheets and handles', () => {
        for (const t of ['SIDEPATTY', 'BOTTOMPATTY', 'SHEET', 'MODEL NUMBER SHEET',
                         'BOTTOMPATTY SHEET', 'READYMADE HANDLE', 'PRESSING HANDLE']) {
            expect(primaryUnitFor(t, `${t} - NW REGULAR - RED - 75GSM (6x46)`)).toBe('count');
        }
    });

    it('counts sheets one at a time and patty by the bundle', () => {
        expect(countUnitFor('SHEET', 'SHEET - NW VIRGIN - WHITE - 110GSM (16x19)')).toBe('sheets');
        expect(countUnitFor('SIDEPATTY', 'SIDEPATTY - NW REGULAR - RED - 75GSM (6x46)')).toBe('bundles');
    });
});

describe('countToKg — what a counted holding weighs', () => {
    it('converts a bundle of side patty through its 50 strips', () => {
        const per = pieceKg({ w: 6, h: 46, gsm: 75 });
        expect(countToKg({ w: 6, h: 46, gsm: 75, type: 'SIDEPATTY', count: 25 }))
            .toBeCloseTo(25 * 50 * per, 9);
    });

    it('converts a sheet one at a time', () => {
        expect(countToKg({ w: 16, h: 19, gsm: 110, type: 'SHEET', count: 250 }))
            .toBeCloseTo(250 * pieceKg({ w: 16, h: 19, gsm: 110 }), 9);
    });

    it('returns 0 rather than a guess when the geometry is missing', () => {
        expect(countToKg({ w: 6, h: null, gsm: 75, type: 'SIDEPATTY', count: 25 })).toBe(0);
        expect(countToKg({ w: 36, h: null, gsm: 80, type: 'ROLL', count: 10 })).toBe(0);
    });

    it('will not talk a weighed article up out of a stray count', () => {
        // A DCUT bag has no pieces-per-bundle, so a count on one converts to nothing
        // and the booked weight stands.
        expect(countToKg({ w: 12, h: 16, gsm: 75, type: 'DCUT BAG', count: 10 })).toBe(0);
    });
});
