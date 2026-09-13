import { describe, it, expect } from 'vitest';
import {
    outputCodeSpecForJob, findOutputCode, outputBookingGaps, bookingGapMessage,
    batchBookingGaps, batchGapMessage, bookingImportFiles, stockItemName
} from './outputCode';

// Job 2026-09-12 - ROLLS TO SIDEPATTY - 28 - 255. Its output had no item code, and
// the operator only found out after counting the run and pressing Complete. The
// form now says so on opening, in words the operator can pass on, and does not
// let the job be completed until the office has added what is missing.
const job = {
    name: '2026-09-12 - ROLLS TO SIDEPATTY - 28 - 255',
    material: 'NW REGULAR', colour: 'RED', gsm: '80'
};
const output = { key: '12x54', label: '12″ × 54″', outputType: 'SIDEPATTY', dims: { w: 12, h: 54, gsm: '80' } };
const code = (id, gsm, w, h, over = {}) => ({
    id, Type: 'SIDEPATTY', Material: 'NW REGULAR', Colour: 'RED', GSM: gsm,
    Width_Inches_: w, Height_Inches_: h, ...over
});

describe('the item code an output is booked under', () => {
    it('is the job roll, at the size the line makes', () => {
        expect(outputCodeSpecForJob(job, output)).toEqual({
            type: 'SIDEPATTY', material: 'NW REGULAR', colour: 'RED', gsm: '80', w: 12, h: 54
        });
    });

    it('takes the weight from the line where the line carries one', () => {
        // A bottom patty is 90 GSM whatever roll it came off.
        const bottom = { ...output, outputType: 'BOTTOMPATTY', dims: { w: 4.5, h: 14, gsm: '90' } };
        expect(outputCodeSpecForJob(job, bottom).gsm).toBe('90');
    });

    it('cannot be named without a size', () => {
        expect(outputCodeSpecForJob(job, { ...output, dims: null })).toBeNull();
    });

    it('matches the catalogue however it is spelled, and never a neighbouring weight or size', () => {
        const spec = outputCodeSpecForJob(job, output);
        expect(findOutputCode([code(1235, '110', '12', '54'), code(7, '80', '12', '54', { Colour: 'red ' })], spec)).toBe(7);
        expect(findOutputCode([code(1235, '110', '12', '54'), code(8, '80', '12', '50')], spec)).toBeNull();
    });
});

describe('what has to be added before a job can be completed', () => {
    it('names the missing code exactly as the catalogue would write it', () => {
        const gaps = outputBookingGaps({ job, outputs: [output], codes: [code(1235, '110', '12', '54')], items: [] });
        expect(gaps).toEqual([expect.objectContaining({
            key: '12x54', missing: 'code', label: 'SIDEPATTY - NW REGULAR - RED - 80GSM (12x54)'
        })]);
    });

    it('asks for the stock item when only the code exists', () => {
        const gaps = outputBookingGaps({ job, outputs: [output], codes: [code(2000, '80', '12', '54')], items: [] });
        expect(gaps).toEqual([expect.objectContaining({ missing: 'item', codeId: 2000 })]);
    });

    it('lets the job complete once both are there', () => {
        const gaps = outputBookingGaps({
            job, outputs: [output], codes: [code(2000, '80', '12', '54')], items: [{ id: 3000, Item_Code: 2000 }]
        });
        expect(gaps).toEqual([]);
    });

    it('stops a line whose size cannot be worked out', () => {
        const gaps = outputBookingGaps({ job, outputs: [{ ...output, dims: null }], codes: [], items: [] });
        expect(gaps).toEqual([expect.objectContaining({ missing: 'size' })]);
    });

    it('reads as a message the operator can send on', () => {
        const gaps = outputBookingGaps({ job, outputs: [output], codes: [], items: [] });
        const text = bookingGapMessage(job, gaps);
        expect(text).toContain(job.name);
        expect(text).toContain('SIDEPATTY - NW REGULAR - RED - 80GSM (12x54)');
        expect(text).toMatch(/item code/i);
    });
});

// The same question asked of a whole batch, on the batch page, so the office hears
// about a missing code while the job is still being cut -- not from an operator
// standing at the completion form with the count in hand.
describe('what a batch still needs added before its jobs can be completed', () => {
    const other = { ...job, name: '2026-09-12 - ROLLS TO SIDEPATTY - 28 - 262', gsm: '90' };
    const line90 = { ...output, dims: { w: 6, h: 54, gsm: '90' } };
    const codes = [code(702, '90', '6', '54')];
    const items = [{ id: 706, Item_Code: 702 }];

    it('lists only the jobs that are missing something', () => {
        const entries = batchBookingGaps({
            jobs: [{ job, outputs: [output] }, { job: other, outputs: [line90] }], codes, items
        });
        expect(entries.map((e) => e.job.name)).toEqual([job.name]);
        expect(entries[0].gaps).toEqual([expect.objectContaining({ missing: 'code' })]);
    });

    it('leaves out jobs already completed, and jobs with nothing to book', () => {
        expect(batchBookingGaps({
            jobs: [{ job: { ...job, completed: true }, outputs: [output] }, { job, outputs: [] }], codes, items
        })).toEqual([]);
    });

    it('asks the office once for a code two jobs are both waiting on', () => {
        const twin = { ...job, name: '2026-09-12 - ROLLS TO SIDEPATTY - 28 - 999' };
        const entries = batchBookingGaps({ jobs: [{ job, outputs: [output] }, { job: twin, outputs: [output] }], codes, items });
        const text = batchGapMessage('2026-09-12 - ROLLS TO SIDEPATTY - 28', entries);
        expect(text.match(/SIDEPATTY - NW REGULAR - RED - 80GSM \(12x54\)/g)).toHaveLength(1);
        expect(text).toContain(job.name);
        expect(text).toContain(twin.name);
        expect(text).toContain('2026-09-12 - ROLLS TO SIDEPATTY - 28');
    });

    it('says nothing when nothing is missing', () => {
        expect(batchGapMessage('B', [])).toBe('');
    });
});

// The office adds what a batch is missing by importing two CSVs into Grist, codes
// first and then the items that reference them. Item_Code on the codes table is a
// formula, so the file carries only the columns it is built from; the items file
// names its code by that formula's text, which is how Grist resolves a reference.
describe('the files to import what a batch is missing', () => {
    const codeGap = { missing: 'code', label: 'SIDEPATTY - NW REGULAR - RED - 80GSM (12x54)', codeId: null,
        spec: { type: 'SIDEPATTY', material: 'NW REGULAR', colour: 'RED', gsm: '80', w: 12, h: 54 } };
    const itemGap = { missing: 'item', label: 'BOTTOMPATTY - NW REGULAR - PINK - 90GSM (4.5x14)', codeId: 1234,
        spec: { type: 'BOTTOMPATTY', material: 'NW REGULAR', colour: 'PINK', gsm: '90', w: 4.5, h: 14 } };
    const sizeGap = { missing: 'size', label: '—', codeId: null, spec: null };

    it('names a stock item the way the godown already does', () => {
        expect(stockItemName(itemGap.spec)).toBe('BOTTOMPATTY_NW_REGULAR_PINK_90_4_5X14');
        expect(stockItemName(codeGap.spec)).toBe('SIDEPATTY_NW_REGULAR_RED_80_12X54');
    });

    it('adds a code and its item for a missing code, only the item for a missing item', () => {
        const { codes, items } = bookingImportFiles([{ job, gaps: [codeGap, itemGap, sizeGap] }]);
        expect(codes.headers).toEqual(['Type', 'Material', 'Colour', 'GSM', 'Width_Inches_', 'Height_Inches_']);
        expect(codes.rows).toEqual([['SIDEPATTY', 'NW REGULAR', 'RED', '80', '12', '54']]);
        expect(items.headers).toEqual(['Item_ID', 'Item_Code']);
        expect(items.rows).toEqual([
            ['SIDEPATTY_NW_REGULAR_RED_80_12X54', 'SIDEPATTY - NW REGULAR - RED - 80GSM (12x54)'],
            ['BOTTOMPATTY_NW_REGULAR_PINK_90_4_5X14', 'BOTTOMPATTY - NW REGULAR - PINK - 90GSM (4.5x14)']
        ]);
    });

    it('writes each code once, however many jobs are waiting on it', () => {
        const { codes, items } = bookingImportFiles([{ job, gaps: [codeGap] }, { job: other(), gaps: [codeGap] }]);
        expect(codes.rows).toHaveLength(1);
        expect(items.rows).toHaveLength(1);
    });

    it('has nothing to import when nothing can be named', () => {
        const { codes, items } = bookingImportFiles([{ job, gaps: [sizeGap] }]);
        expect(codes.rows).toEqual([]);
        expect(items.rows).toEqual([]);
    });
});

function other() { return { ...job, name: '2026-09-12 - ROLLS TO SIDEPATTY - 28 - 999' }; }
