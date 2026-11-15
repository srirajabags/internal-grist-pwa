import { describe, it, expect } from 'vitest';
import { printingPlan, outputSplit } from './outputSplit.js';

// A 16x19 line like job 945's, cut down to one F12 order: 440 sheets for the
// order, and a plate run of 1,100. 110 GSM, 16x19 in: 0.0218 kg a sheet.
const KG = 0.0218;
const f12Line = {
    cutOrderQty: 440 * KG, cutOrderMade: 440,
    cutQty: 1100 * KG, cutMade: 1100
};

const book = (line, made) => {
    const { planned, plannedCount } = printingPlan(line);
    return outputSplit({
        outputType: 'SHEET', unit: 'sheets', planned,
        count: made, weight: made * (planned / plannedCount)
    }).map((h) => [h.location, h.fields.Count_Bundles_]);
};

describe('printingPlan: job 945, the F12 plate run', () => {
    it('sends all 1,100 sheets of the plate run to the printing area', () => {
        expect(book(f12Line, 1100)).toEqual([['PRINTING AREA', 1100]]);
    });

    it('still sends real over-cutting beyond the run to the godown', () => {
        expect(book(f12Line, 1150)).toEqual([['PRINTING AREA', 1100], ['BAGS GODOWN', 50]]);
    });

    it('leaves a line with no model number as it was: the orders to printing, over-cutting to stock', () => {
        const plain = { cutOrderQty: 9241 * KG, cutOrderMade: 9241, cutQty: 9241 * KG, cutMade: 9241 };
        expect(book(plain, 9300)).toEqual([['PRINTING AREA', 9241], ['BAGS GODOWN', 59]]);
    });
});
