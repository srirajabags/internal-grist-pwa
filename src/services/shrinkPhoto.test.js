// Plate photos from the godown (user, 15 Nov 2026) are shrunk before upload;
// this holds the line on never enlarging a small one or squashing its shape.
import { describe, it, expect } from 'vitest';
import { fitWithin } from './shrinkPhoto';

describe('fitWithin', () => {
    it('shrinks the longest side to the limit, keeping the shape', () => {
        expect(fitWithin(4000, 3000, 1280)).toEqual({ width: 1280, height: 960 });
        expect(fitWithin(3000, 4000, 1280)).toEqual({ width: 960, height: 1280 });
    });

    it('never enlarges a photo already small enough', () => {
        expect(fitWithin(800, 600, 1280)).toEqual({ width: 800, height: 600 });
    });
});
