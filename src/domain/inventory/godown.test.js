import { describe, it, expect } from 'vitest';
import {
    ROLLS_GODOWN, BAGS_GODOWN, godownOf, isRawStock, splitStock,
    godownForJob, isLatentJob, splitJobs
} from './godown';

const roll = (over = {}) => ({ id: 1, type: 'ROLL', ...over });
const patty = (over = {}) => ({ id: 2, type: 'SIDEPATTY', ...over });

describe('godownOf — which shelf to walk to', () => {
    it('believes the item\'s own booked location over its type', () => {
        // A roll booked into the bags godown really is in the bags godown; the
        // books say where a thing is, the type only says where it usually lives.
        expect(godownOf(roll({ location: 'BAGS GODOWN' }))).toBe(BAGS_GODOWN);
        expect(godownOf(patty({ location: 'ROLLS GODOWN' }))).toBe(ROLLS_GODOWN);
    });

    it('falls back to the type when nothing is booked', () => {
        expect(godownOf(roll())).toBe(ROLLS_GODOWN);
        expect(godownOf(patty())).toBe(BAGS_GODOWN);
    });

    it('ignores a location that is neither godown', () => {
        // PRINTING AREA is where stock is taken TO, never a shelf to fetch from.
        expect(godownOf(roll({ location: 'PRINTING AREA' }))).toBe(ROLLS_GODOWN);
        expect(godownOf(patty({ location: 'PRINTING AREA' }))).toBe(BAGS_GODOWN);
    });

    it('reads a location however it was typed', () => {
        expect(godownOf(patty({ location: '  rolls godown ' }))).toBe(ROLLS_GODOWN);
    });

    it('sends an unknown article to the bags godown', () => {
        expect(godownOf({})).toBe(BAGS_GODOWN);
        expect(godownOf(null)).toBe(BAGS_GODOWN);
    });
});

describe('splitStock — the roll trip and the shelf trip are different errands', () => {
    it('puts the roll on one side and everything else on the other', () => {
        const { raw, finished } = splitStock([roll(), patty(), { id: 3, type: 'SHEET' }]);
        expect(raw.map((i) => i.id)).toEqual([1]);
        expect(finished.map((i) => i.id)).toEqual([2, 3]);
    });

    it('follows the booked location, not the type', () => {
        const { raw, finished } = splitStock([roll({ location: 'BAGS GODOWN' })]);
        expect(raw).toEqual([]);
        expect(finished).toHaveLength(1);
    });

    it('copes with nothing at all', () => {
        expect(splitStock()).toEqual({ raw: [], finished: [] });
        expect(isRawStock(roll())).toBe(true);
        expect(isRawStock(patty())).toBe(false);
    });
});

describe('godownForJob — where to go when the job has no items recorded', () => {
    it('uses the job\'s own item type when it has one', () => {
        expect(godownForJob({ itemType: 'ROLL', type: 'ROLLS TO SHEETS' })).toBe(ROLLS_GODOWN);
        expect(godownForJob({ itemType: 'SIDEPATTY', type: 'ROLLS TO SIDEPATTY' })).toBe(BAGS_GODOWN);
    });

    it('otherwise reads the batch type — a ROLLS TO … job cuts a roll', () => {
        expect(godownForJob({ type: 'ROLLS TO SHEETS' })).toBe(ROLLS_GODOWN);
        expect(godownForJob({ type: 'STITCHING' })).toBe(BAGS_GODOWN);
        expect(godownForJob({})).toBe(BAGS_GODOWN);
    });
});

describe('isLatentJob — a trip from a shelf is not work at a machine', () => {
    it('is latent when every item is already the finished article', () => {
        expect(isLatentJob({ invItemOptions: [patty(), { id: 3, type: 'SHEET' }] })).toBe(true);
    });

    it('is real work the moment there is a roll to cut', () => {
        expect(isLatentJob({ invItemOptions: [roll(), patty()] })).toBe(false);
    });

    it('judges the stock assigned, not the job type', () => {
        // A ROLLS TO DCUT job met entirely from ready DCUT bags cuts nothing: the
        // type says what it would have cut, not what it is going to.
        expect(isLatentJob({ type: 'ROLLS TO DCUT', invItemOptions: [{ id: 4, type: 'DCUT BAG' }] })).toBe(true);
    });

    it('treats a job it cannot read as real work', () => {
        // Hiding work is the worse failure: an operator never sees the job at all.
        expect(isLatentJob({ invItemOptions: [] })).toBe(false);
        expect(isLatentJob({ invItemOptions: [{ id: 5 }] })).toBe(false);
        expect(isLatentJob({ invItemOptions: [patty(), { id: 5 }] })).toBe(false);
        expect(isLatentJob({})).toBe(false);
    });

    it('reads an item known only by its location', () => {
        expect(isLatentJob({ invItemOptions: [{ id: 6, location: 'BAGS GODOWN' }] })).toBe(true);
        expect(isLatentJob({ invItemOptions: [{ id: 6, location: 'ROLLS GODOWN' }] })).toBe(false);
    });
});

describe('splitJobs', () => {
    it('divides the work from the paperwork, losing neither', () => {
        const real = { id: 1, invItemOptions: [roll()] };
        const latent = { id: 2, invItemOptions: [patty()] };
        const unknown = { id: 3, invItemOptions: [] };
        const out = splitJobs([real, latent, unknown]);
        expect(out.real.map((j) => j.id)).toEqual([1, 3]);
        expect(out.latent.map((j) => j.id)).toEqual([2]);
        expect(splitJobs()).toEqual({ real: [], latent: [] });
    });
});
