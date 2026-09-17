import { describe, it, expect } from 'vitest';
import { batchStage, batchPills, batchMatchesPills, pillFilterOptions, BATCH_STAGES } from './batchStage';

// Batch 2026-09-04 - ROLLS TO SIDEPATTY - 19 finished on 5 Sep and its leftover roll
// went back on 8 Sep, yet the batch card still read "In Progress" — it showed that
// the moment a batch had a start time and never took it off again, so every batch
// the factory has ever run wore it for good.
const batch = (over) => ({ startedAt: null, completedAt: null, invReturned: false, invCollected: false, finCollected: false, jobs: [], ...over });
const rollJob = (over) => ({ id: 1, invItemOptions: [{ id: 11, type: 'ROLL', location: 'ROLLS GODOWN' }], ...over });
const stockJob = (over) => ({ id: 2, invItemOptions: [{ id: 22, type: 'SIDEPATTY', location: 'BAGS GODOWN' }], ...over });
const keys = (b) => batchPills(b).map((p) => p.key);
const labels = (b) => batchPills(b).map((p) => p.label);

describe('what stage a batch is at', () => {
    it('has not started until its first job does', () => {
        expect(batchStage(batch()).key).toBe('planned');
        expect(batchStage(batch()).label).toBe('Not started');
    });

    it('is running between the first job starting and the last one finishing', () => {
        expect(batchStage(batch({ startedAt: 1788590391 })).key).toBe('running');
    });

    it('is off the machine but still holding roll once every job is done', () => {
        expect(batchStage(batch({ startedAt: 1788590391, completedAt: 1788678097 })).key).toBe('made');
    });

    it('is closed once the leftover roll is back — batch 19', () => {
        expect(batchStage(batch({ startedAt: 1788590391, completedAt: 1788678097, invReturned: true })).key).toBe('closed');
    });

    it('trusts the finish over a missing start, rather than reading as unstarted', () => {
        // Grist stamps both times itself; a completed batch with no start time is
        // odd data, but "not started" is the one answer it certainly is not.
        expect(batchStage(batch({ completedAt: 1788678097 })).key).toBe('made');
    });

    it('offers every stage, in the order a batch passes through them', () => {
        expect(BATCH_STAGES.map((s) => s.key)).toEqual(['planned', 'running', 'made', 'closed']);
    });

    it('says nothing sensible is knowable without a batch', () => {
        expect(batchStage(null).key).toBe('planned');
    });
});

// A batch tracks three things at once — the cutting, the leftover roll, and any
// ready-made stock it was given — and the card has room to say where each stands.
// Only what applies: batch 19 drew no finished stock at all, so a finished-stock
// pill on it would be inventing work nobody owes.
describe('the pills a batch card shows', () => {
    it('says the cutting has not started yet', () => {
        expect(labels(batch({ jobs: [rollJob()] }))).toEqual(['Production not yet started']);
    });

    it('does not ask a stock-only batch to start cutting — it has nothing to cut', () => {
        expect(keys(batch({ jobs: [stockJob()] }))).not.toContain('productionPending');
    });

    it('counts not-yet-started production as outstanding work', () => {
        const byKey = Object.fromEntries(batchPills(batch({ jobs: [rollJob()] })).map((p) => [p.key, p.tone]));
        expect(byKey.productionPending).toBe('action');
    });

    it('says it is running while jobs are still on the machine', () => {
        expect(labels(batch({ startedAt: 1788590391, invCollected: true, jobs: [rollJob()] })))
            .toEqual(['In production']);
    });

    it('asks for the roll back once the cutting is done', () => {
        expect(labels(batch({ startedAt: 1, completedAt: 2, invCollected: true, jobs: [rollJob()] })))
            .toEqual(['Production complete', 'Rolls to be returned']);
    });

    it('does not nag about the roll while the job is still running', () => {
        expect(keys(batch({ startedAt: 1, invCollected: true, jobs: [rollJob()] })))
            .not.toContain('rollsPending');
    });

    it('asks for ready stock to be collected, whatever the machine is doing', () => {
        expect(labels(batch({ jobs: [stockJob()] }))).toEqual(['Finished stock to be collected']);
    });

    it('marks ready stock collected while the roll is still out', () => {
        expect(labels(batch({
            startedAt: 1, completedAt: 2, invCollected: true, finCollected: true, jobs: [rollJob(), stockJob()]
        }))).toEqual(['Production complete', 'Finished stock collected', 'Rolls to be returned']);
    });

    it('closes to a single pill once everything is done — batch 19', () => {
        const b = batch({ startedAt: 1, completedAt: 2, invCollected: true, invReturned: true, jobs: [rollJob()] });
        expect(labels(b)).toEqual(['Closed']);
        expect(keys(b)).not.toContain('finishedPending');
    });

    it('never asks about finished stock a batch never had — batch 19', () => {
        const b = batch({ startedAt: 1, completedAt: 2, invCollected: true, jobs: [rollJob()] });
        expect(keys(b)).not.toContain('finishedPending');
        expect(keys(b)).not.toContain('finishedDone');
    });

    it('marks what is outstanding for the operator, and what is merely done', () => {
        const b = batch({ startedAt: 1, completedAt: 2, invCollected: true, jobs: [rollJob(), stockJob()] });
        const byKey = Object.fromEntries(batchPills(b).map((p) => [p.key, p.tone]));
        expect(byKey.rollsPending).toBe('action');
        expect(byKey.finishedPending).toBe('action');
        expect(byKey.productionDone).toBe('done');
    });
});

// The batch list gets a filter built from the same pills: tick what you are looking
// for — "rolls to be returned", say — and the list narrows to the batches that owe
// it. Batch 19, which owes nothing, answers only to the "closed" tick.
describe('filtering the batch list by what a batch owes', () => {
    const notStarted = batch({ jobs: [rollJob()] });
    const running = batch({ startedAt: 1, invCollected: true, jobs: [rollJob()] });
    const rollsOut = batch({ startedAt: 1, completedAt: 2, invCollected: true, jobs: [rollJob()] });
    const stockWaiting = batch({ jobs: [stockJob()] });
    const closed = batch({ startedAt: 1, completedAt: 2, invCollected: true, invReturned: true, jobs: [rollJob()] });
    const all = [notStarted, running, rollsOut, stockWaiting, closed];

    it('shows every batch when nothing is ticked', () => {
        expect(all.filter((b) => batchMatchesPills(b, []))).toHaveLength(5);
        expect(batchMatchesPills(notStarted, null)).toBe(true);
    });

    it('narrows to the batches owing the ticked thing', () => {
        expect(all.filter((b) => batchMatchesPills(b, ['rollsPending']))).toEqual([rollsOut]);
        expect(all.filter((b) => batchMatchesPills(b, ['finishedPending']))).toEqual([stockWaiting]);
        expect(all.filter((b) => batchMatchesPills(b, ['closed']))).toEqual([closed]);
    });

    it('treats several ticks as "any of these"', () => {
        expect(all.filter((b) => batchMatchesPills(b, ['running', 'productionPending'])))
            .toEqual([notStarted, running]);
    });

    it('offers only the pills the batches on screen actually carry, with counts', () => {
        const options = pillFilterOptions(all);
        expect(options.map((o) => o.key))
            .toEqual(['productionPending', 'running', 'productionDone', 'finishedPending', 'rollsPending', 'closed']);
        expect(options.find((o) => o.key === 'rollsPending')).toMatchObject({ label: 'Rolls to be returned', count: 1 });
        expect(options.find((o) => o.key === 'productionDone').count).toBe(1);
    });

    it('offers nothing when there are no batches', () => {
        expect(pillFilterOptions([])).toEqual([]);
    });
});
