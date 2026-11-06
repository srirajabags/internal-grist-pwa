import { describe, it, expect } from 'vitest';
import { parseRackCodes, rackCode, KIND } from './rackCodes';

const codes = (name) => parseRackCodes(name).map((c) => c.code);

// Every name here is a real shop name from Customers (Nov 2026).
describe('parseRackCodes — the rack codes at the end of a shop name', () => {
    it('reads the code the plate sheet shows', () => {
        expect(parseRackCodes('BHAVANI MENS WEAR TYPE-3 AFT K-1290'))
            .toEqual([{ rack: 'K', kind: KIND.PLATE, slot: 1290, code: 'K-1290' }]);
    });

    it('reads every spacing the office uses', () => {
        expect(codes('Sri Sai Kalyan Jewellers Minchin Bazar (AFT) K 660')).toEqual(['K-660']);
        expect(codes('Bhavani Garments TYPE-3 (Aft) T51')).toEqual(['T-51']);
        expect(codes('BHAVANI MENS WEAR (P45). K91')).toEqual(['K-91']);
        expect(codes('Pooja Collection C Camp TYPE-1  (AFT). K51')).toEqual(['K-51']);
    });

    it('reads stereo and digital codes, in the order written', () => {
        expect(codes('Om Pavan Shopping Mall TYPE-1 AFT DS - 128')).toEqual(['DS-128']);
        expect(codes('Addanki Fashions/ Ranjith Textiles Main Bazar - Type -2 (AFT).  K173 Ks 43 KD 160'))
            .toEqual(['K-173', 'KS-43', 'KD-160']);
        expect(codes('Jai Bhavani Mens Wear - Type -3 Aft PS69 PD 145')).toEqual(['PS-69', 'PD-145']);
        expect(codes('BASAVA SILK HOUSE - TYPE-3 AFT    GD-335   G-828')).toEqual(['GD-335', 'G-828']);
    });

    it('splits codes written run together', () => {
        expect(codes('New Sri Sai Cloth Stores & Garments  - Type -2 (PW7). K223KD59')).toEqual(['K-223', 'KD-59']);
        expect(codes('Bhuvana Textiles - Type -1 (PW7) DS32DD 1')).toEqual(['DS-32', 'DD-1']);
        expect(codes('Sohail Textiles - Type -3 P30C147')).toEqual(['C-147']);
    });

    it('reads codes separated by commas', () => {
        expect(codes('Balaji Electronics - Type -3 (Aft)  T11 , Ts 56 TS72')).toEqual(['T-11', 'TS-56', 'TS-72']);
    });

    it('stops at the design markers before the codes', () => {
        expect(codes('Heeras Textiles Show Room  TYPE-3 P30  B-432')).toEqual(['B-432']);
        expect(codes('NEW Mobile Plaza TYPE-3 PW7   K-1179')).toEqual(['K-1179']);
        expect(codes('Sri Venkateswara Textiles TYPE-2 (PW7) KD 219   K-1161')).toEqual(['KD-219', 'K-1161']);
    });

    it('takes a design marker spelled like a code for a marker', () => {
        // 84 names end in P30: a rack-P slot 30 would be a guess.
        expect(codes('Chandu Sri Garments TYPE-3 P30')).toEqual([]);
        expect(codes('Mahashakti Garments Old Bustand TYPE-1 PW7')).toEqual([]);
    });

    it('finds nothing in a name with no code', () => {
        expect(codes('Gentleman Kids & Mens Wear  TYPE-3 AFT')).toEqual([]);
        expect(codes('Moghal Show Room  TYPE-3 (AFT)')).toEqual([]);
        expect(codes('Bhavani Mens Wear')).toEqual([]);
    });

    it('never reads a number inside the shop\'s own name', () => {
        // Stops at "Mega" -- the 1 + 1 is part of the name.
        expect(codes('New 1 + 1 Mega Jeans Corner Park Road')).toEqual([]);
        expect(codes('Vimala Textiles - Type -3  AFT')).toEqual([]);
    });
});

describe('rackCode — the label written back', () => {
    it('writes kind letters only for stereo and digital', () => {
        expect(rackCode({ rack: 'K', kind: KIND.PLATE, slot: 5 })).toBe('K-5');
        expect(rackCode({ rack: 'K', kind: KIND.STEREO, slot: 5 })).toBe('KS-5');
        expect(rackCode({ rack: 'K', kind: KIND.DIGITAL, slot: 5 })).toBe('KD-5');
    });

    it('is blank until the plate has a slot', () => {
        expect(rackCode({ rack: 'K', kind: KIND.PLATE, slot: null })).toBe('');
    });
});
