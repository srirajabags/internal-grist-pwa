import { describe, it, expect } from 'vitest';
import { STAGES, FINISHED_LOCATION, needsStitching, needsPrinting, treeSql, queueSql } from './stageJobs';

describe('needsStitching — only a stitching bag goes to the stitching floor', () => {
    it('reads the model however it was typed', () => {
        expect(needsStitching('STITCHING')).toBe(true);
        expect(needsStitching(' stitching ')).toBe(true);
        expect(needsStitching('DCUT')).toBe(false);
        expect(needsStitching('HANDLE')).toBe(false);
        expect(needsStitching(null)).toBe(false);
    });
});

describe('needsPrinting — anything but an explicit no', () => {
    it('prints unless the order says not to', () => {
        expect(needsPrinting('MULTI COLOUR')).toBe(true);
        expect(needsPrinting('SINGLE COLOUR')).toBe(true);
        expect(needsPrinting('MODEL NUMBER')).toBe(true);
        expect(needsPrinting('NO PRINT')).toBe(false);
        expect(needsPrinting(' no print ')).toBe(false);
    });

    it('treats an unanswered column as nothing to print', () => {
        // A blank is not an instruction, and sending unprinted work to a press
        // that has no plate for it wastes a setup.
        expect(needsPrinting('')).toBe(false);
        expect(needsPrinting(null)).toBe(false);
        expect(needsPrinting(undefined)).toBe(false);
    });
});

describe('STAGES — the two floors are the same shape', () => {
    it('describes each stage with the same keys, so one page can drive both', () => {
        const keys = Object.keys(STAGES.printing).sort();
        expect(Object.keys(STAGES.stitching).sort()).toEqual(keys);
        expect(STAGES.printing.key).toBe('printing');
        expect(STAGES.stitching.key).toBe('stitching');
    });

    it('draws printing down from the printing area and stitching from nothing', () => {
        // Printing consumes what production parked in the printing area. Stitching
        // consumes printed work in progress, which is not godown stock at all --
        // 'STITCHING AREA' is not a Location the transactions column allows.
        expect(STAGES.printing.inputLocation).toBe('PRINTING AREA');
        expect(STAGES.stitching.inputLocation).toBeNull();
        expect(STAGES.printing.wipLocation).toBeNull();
        expect(STAGES.stitching.wipLocation).toBeNull();
    });

    it('sends finished work to the bags godown', () => {
        expect(FINISHED_LOCATION).toBe('BAGS GODOWN');
    });

    it('names each stage\'s own columns rather than sharing one set', () => {
        expect(STAGES.printing.startedCol).not.toBe(STAGES.stitching.startedCol);
        expect(STAGES.printing.jobTable).not.toBe(STAGES.stitching.jobTable);
        expect(STAGES.printing.batchTable).not.toBe(STAGES.stitching.batchTable);
    });
});

describe('the SQL each stage reads its tree with', () => {
    for (const stage of ['printing', 'stitching']) {
        it(`names ${stage}'s own tables and columns`, () => {
            const cfg = STAGES[stage];
            const sql = treeSql(cfg);
            expect(sql).toContain(cfg.batchTable);
            expect(sql).toContain(cfg.jobTable);
            expect(sql).toContain(cfg.startedCol);
            expect(sql).toContain(cfg.completedCol);
            expect(sql).toContain(cfg.batchRef);
            // and not the other stage's, which is what a shared template gets wrong
            const other = STAGES[stage === 'printing' ? 'stitching' : 'printing'];
            expect(sql).not.toContain(other.jobTable);
        });
    }

    it('builds a queue query per stage too', () => {
        for (const stage of ['printing', 'stitching']) {
            expect(typeof queueSql(STAGES[stage])).toBe('string');
            expect(queueSql(STAGES[stage]).length).toBeGreaterThan(0);
        }
    });
});
