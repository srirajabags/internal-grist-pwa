import { describe, it, expect } from 'vitest';
import { rupees, compactRupees } from './money';

describe('rupees', () => {
    it('groups in lakhs and crores', () => {
        expect(rupees(17641738)).toBe('₹1,76,41,738');
        expect(rupees('6450')).toBe('₹6,450');
    });
});

describe('compactRupees — fits a phone column (Sales report, Nov 2026)', () => {
    it('writes crores, lakhs and thousands', () => {
        expect(compactRupees(17641738)).toBe('₹1.76Cr');
        expect(compactRupees(356275)).toBe('₹3.56L');
        expect(compactRupees(10600)).toBe('₹10.6k');
        expect(compactRupees(950)).toBe('₹950');
    });
    it('drops trailing zeros', () => {
        expect(compactRupees(200000)).toBe('₹2L');
        expect(compactRupees(5000)).toBe('₹5k');
    });
    it('switches unit at exactly one thousand, one lakh and one crore', () => {
        expect(compactRupees(999)).toBe('₹999');
        expect(compactRupees(1000)).toBe('₹1k');
        expect(compactRupees(99999)).toBe('₹100k');
        expect(compactRupees(100000)).toBe('₹1L');
        expect(compactRupees(10000000)).toBe('₹1Cr');
    });
    it('keeps the sign and treats blank as nothing', () => {
        expect(compactRupees(-25000)).toBe('-₹25k');
        expect(compactRupees(null)).toBe('₹0');
    });
});
