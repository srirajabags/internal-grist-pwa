import { describe, it, expect } from 'vitest';
import { CODE_COLUMNS, codesQuery, itemsQuery } from './outputCatalogue';
import { findOutputCode } from '../domain/production/outputCode';

// Job 2026-09-12 - ROLLS TO SIDEPATTY - 28 - 255 could not be completed. The
// completion form's own code lookup selected id, GSM and the two sizes, then
// matched on type, material and colour as well -- columns it never asked for --
// so every row read them as blank, nothing matched, and every job with output was
// told its item code was missing. The checks beside it selected everything and
// found nothing wrong. The columns now live in one place, beside the matcher.
const row = {
    id: 1237, Type: 'SIDEPATTY', Material: 'NW REGULAR', Colour: 'RED', GSM: '80',
    Width_Inches_: '12', Height_Inches_: '54', Duplicates_Count: 0
};
const spec = { type: 'SIDEPATTY', material: 'NW REGULAR', colour: 'RED', gsm: '80', w: 12, h: 54 };
const only = (r, cols) => Object.fromEntries(cols.map((c) => [c, r[c]]));

describe('the item-code lookup reads every column the matcher needs', () => {
    it('matches a row carrying only the columns the query selects', () => {
        expect(findOutputCode([only(row, CODE_COLUMNS)], spec)).toBe(1237);
    });

    it('would not have matched on the columns the completion form used to select', () => {
        expect(findOutputCode([only(row, ['id', 'GSM', 'Width_Inches_', 'Height_Inches_'])], spec)).toBeNull();
    });

    it('selects exactly those columns, for the output types asked about', () => {
        const q = codesQuery(['SIDEPATTY', 'BOTTOMPATTY']);
        for (const c of CODE_COLUMNS) expect(q.sql).toContain(c);
        expect(q.args).toEqual(['SIDEPATTY', 'BOTTOMPATTY']);
        expect(q.sql.match(/\?/g)).toHaveLength(2);
    });

    it('asks for the stock items of the codes found, and nothing when none were', () => {
        expect(itemsQuery([1237, 1238])).toEqual({
            sql: expect.stringContaining('Inventory_Items'), args: [1237, 1238]
        });
        expect(itemsQuery([])).toBeNull();
        expect(codesQuery([])).toBeNull();
    });
});
