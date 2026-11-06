import { describe, it, expect } from 'vitest';
import {
    MACHINES, printingColours, printingState, colourKey, suggestedMachine,
    groupQueue, machinesFor, operatorRoleFor
} from './printingMachines';

const so = (fields) => ({ material: 'NON-WOVEN', plate: 'PLATE', print: 'SINGLE COLOUR', ...fields });

describe('printingColours — the ink set, however Grist sent it', () => {
    it('reads SQL JSON and API lists alike, in one fixed order', () => {
        expect(printingColours(so({ printingColour: '["RED","BLUE"]' }))).toEqual(['BLUE', 'RED']);
        expect(printingColours(so({ printingColour: ['L', 'BLUE', 'RED'] }))).toEqual(['BLUE', 'RED']);
    });

    it('does not count an ink twice', () => {
        expect(printingColours(so({ printingColour: '["RED"," red "]' }))).toEqual(['RED']);
    });
});

describe('printingState — no colour is a plain bag (user, 1 Nov 2026)', () => {
    it('sends an order with no colour straight past printing', () => {
        // Print still says SINGLE COLOUR on orders from before colours were
        // recorded; the colour is what decides.
        expect(printingState(so({ printingColour: null }))).toBe('PLAIN');
        expect(printingState(so({ printingColour: '[]' }))).toBe('PLAIN');
    });

    it('holds back an order that names a colour but says NO PRINT', () => {
        // Five such orders since Sep 2026. Printing a plain bag cannot be undone.
        expect(printingState(so({ print: 'NO PRINT', printingColour: '["BLACK"]' }))).toBe('CONFLICT');
    });

    it('prints an order with a colour', () => {
        expect(printingState(so({ printingColour: '["BLACK"]' }))).toBe('PRINT');
    });
});

describe('colourKey — what the machine is dressed with', () => {
    it('treats RED + BLUE and BLUE + RED as one setup', () => {
        expect(colourKey(so({ printingColour: '["RED","BLUE"]' })))
            .toBe(colourKey(so({ printingColour: '["BLUE","RED"]' })));
    });

    it('pools every full-design order into MULTI COLOUR', () => {
        expect(colourKey(so({ printingColour: '["MULTI COLOUR","RED"]' }))).toBe('MULTI COLOUR');
        expect(colourKey(so({ print: 'MULTI COLOUR', printingColour: '["RED"]' }))).toBe('MULTI COLOUR');
    });
});

describe('suggestedMachine — which press an order runs on', () => {
    it('puts a stereo plate on the stereo machine whatever its colours', () => {
        // 181 plastic two-colour stereo orders since Sep 2026: the plate decides.
        expect(suggestedMachine(so({ plate: 'STEREO', material: 'PLASTIC', printingColour: '["RED","BLUE"]' })))
            .toBe(MACHINES.STEREO);
    });

    it('runs two-colour work in one pass on the two-colour machine', () => {
        expect(suggestedMachine(so({ printingColour: '["RED","BLUE"]' }))).toBe(MACHINES.TWO);
    });

    it('counts inks for three and more', () => {
        expect(suggestedMachine(so({ printingColour: '["RED","BLUE","BLACK"]' }))).toBe(MACHINES.THREE);
        expect(suggestedMachine(so({ printingColour: '["RED","BLUE","BLACK","GOLD"]' }))).toBe(MACHINES.MULTI);
    });

    it('sends a full design to the multi colour machine, BOPP included', () => {
        expect(suggestedMachine(so({ material: 'BOPP LAMINATED', print: 'MULTI COLOUR', printingColour: '["MULTI COLOUR"]' })))
            .toBe(MACHINES.MULTI);
    });

    it('splits single colour by material', () => {
        expect(suggestedMachine(so({ printingColour: '["RED"]' }))).toBe(MACHINES.SINGLE);
        expect(suggestedMachine(so({ material: 'PLASTIC', printingColour: '["RED"]' }))).toBe(MACHINES.PLS);
        expect(suggestedMachine(so({ material: 'BOPP LAMINATED', printingColour: '["RED"]' }))).toBe(MACHINES.LAMINATION);
    });
});

describe('groupQueue — batch per machine, job per ink set, output per shop (user, 5 Nov 2026)', () => {
    const queue = [
        so({ id: 1, printingColour: '["RED"]', customer: 7, shop: 'Zara Textiles' }),
        so({ id: 2, printingColour: '["RED"]', customer: 8, shop: 'Anand Mens Wear' }),
        so({ id: 9, printingColour: '["RED"]', customer: 7, shop: 'Zara Textiles' }),
        so({ id: 3, printingColour: '["RED"]', plate: 'STEREO', customer: 7, shop: 'Zara Textiles' }),
        so({ id: 4, printingColour: '["BLACK"]', customer: 8, shop: 'Anand Mens Wear' }),
        so({ id: 5, printingColour: null }),
        so({ id: 6, print: 'NO PRINT', printingColour: '["RED"]' })
    ];
    const { machines, held } = groupQueue(queue);
    const single = machines.find((m) => m.machine === MACHINES.SINGLE);

    it('puts the busiest machine first, and the same ink on another machine apart', () => {
        expect(machines.map((m) => m.machine)).toEqual([MACHINES.SINGLE, MACHINES.STEREO]);
    });

    it('makes one job per ink set on a machine', () => {
        expect(single.jobs.map((j) => j.colours)).toEqual(['BLACK', 'RED']);
    });

    it('gathers each shop\'s orders into one output, shops by name', () => {
        const red = single.jobs.find((j) => j.colours === 'RED');
        expect(red.outputs.map((o) => [o.shop, o.subOrders.map((x) => x.id)]))
            .toEqual([['Anand Mens Wear', [2]], ['Zara Textiles', [1, 9]]]);
    });

    it('never batches a plain or contradictory order', () => {
        expect(held.map((h) => [h.so.id, h.state])).toEqual([[5, 'PLAIN'], [6, 'CONFLICT']]);
        expect(machines.flatMap((m) => m.subOrders).map((x) => x.id)).not.toContain(5);
    });
});

describe('machinesFor — an operator sees their own machine', () => {
    it('gives an operator only the machines their roles name', () => {
        expect(machinesFor([operatorRoleFor(MACHINES.TWO)])).toEqual([MACHINES.TWO]);
        expect(machinesFor(['ROLLS TO DCUT OPERATOR'])).toEqual([]);
    });

    it('gives a supervisor every machine', () => {
        expect(machinesFor(['FACTORY PRINTING'])).toHaveLength(7);
        expect(machinesFor(['OWNER'])).toHaveLength(7);
    });
});
