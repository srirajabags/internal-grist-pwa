import { describe, it, expect } from 'vitest';
import {
    jobsClosedByFinishedCollection, canMarkFinishedCollected, finishedStockAlreadyMoved, finishedCollectionActions
} from './finishedCollection';

// Batch 2026-09-10 - ROLLS TO SIDEPATTY - 25. Its finished stock was collected and
// jobs 232 and 233 -- answered entirely from that stock -- were meant to close with
// it. The app sent Production_Completed alone. Grist's rules let a job be completed
// only once it is started, or started in the same update, so the write was refused
// and both jobs, and the batch they hold open, stayed open. Sixteen jobs across six
// batches were stuck the same way.
const finished = (id) => ({ id, type: 'SIDEPATTY', location: 'BAGS GODOWN' });
const roll = (id) => ({ id, type: 'ROLL', location: 'ROLLS GODOWN' });
const job = (id, items, over = {}) => ({ id, invItemOptions: items, started: false, completed: false, ...over });

describe('the jobs a finished-stock collection closes', () => {
    it('starts and completes a job answered entirely from stock, in one update', () => {
        expect(jobsClosedByFinishedCollection([job(232, [finished(150)])])).toEqual([
            { id: 232, fields: { Production_Started: true, Production_Completed: true } }
        ]);
    });

    it('leaves alone a job that cuts a roll, even one that also draws ready stock', () => {
        expect(jobsClosedByFinishedCollection([
            job(216, [roll(2136), finished(146)]),
            job(215, [roll(1890)])
        ])).toEqual([]);
    });

    it('does not touch a job already completed', () => {
        expect(jobsClosedByFinishedCollection([job(232, [finished(150)], { started: true, completed: true })])).toEqual([]);
    });

    it('completes a job someone already started, and still sends both flags', () => {
        expect(jobsClosedByFinishedCollection([job(233, [finished(188)], { started: true })])).toEqual([
            { id: 233, fields: { Production_Started: true, Production_Completed: true } }
        ]);
    });

    it('treats a job whose stock cannot be read as real work, not paperwork', () => {
        expect(jobsClosedByFinishedCollection([job(1, [{ id: 9 }]), job(2, [])])).toEqual([]);
    });
});

// Batch 2026-10-24 - ROLLS TO HANDLES - 86. Bashira, a handles operator, collected
// its ready-made handles on 26 Oct. The app wrote the stock moves, then asked to
// set Finished_Stock_Collected -- which only a FINISHED STOCK COLLECTOR or a doc
// owner may -- and Grist refused. The moves stayed, the flag did not, and jobs 787
// and 788 were never closed. With every item already moved the sheet had nothing
// to tick, so its button stayed disabled for everyone and the batch could not be
// closed from the app at all.
const handles = (id, collectedKg = null) => ({ id, type: 'HANDLE', location: 'BAGS GODOWN', collectedKg });
const handleBatch = (over = {}) => ({
    id: 86,
    finCollected: false,
    jobs: [
        job(784, [roll(3444)], { started: true, completed: true }),
        job(787, [handles(885, 0)]),
        job(788, [handles(903, 0)])
    ],
    ...over
});

describe('who may mark finished stock collected', () => {
    it('is a finished stock collector, as access rule 332 says', () => {
        expect(canMarkFinishedCollected(['L', 'FINISHED STOCK COLLECTOR'], false)).toBe(true);
    });

    it('is not a cutting operator, whatever the batch type', () => {
        expect(canMarkFinishedCollected(['L', 'ROLLS TO HANDLES OPERATOR'], false)).toBe(false);
        expect(canMarkFinishedCollected(undefined, false)).toBe(false);
    });

    it('is any owner of the Grist doc', () => {
        expect(canMarkFinishedCollected([], true)).toBe(true);
    });
});

describe('a finished-stock trip that only has its paperwork left', () => {
    it('is batch 86: every ready item moved, the flag never set', () => {
        expect(finishedStockAlreadyMoved(handleBatch())).toBe(true);
    });

    it('is not a batch with an item still on the shelf', () => {
        expect(finishedStockAlreadyMoved(handleBatch({
            jobs: [job(787, [handles(885, 0)]), job(788, [handles(903)])]
        }))).toBe(false);
    });

    it('is not a batch already marked collected', () => {
        expect(finishedStockAlreadyMoved(handleBatch({ finCollected: true }))).toBe(false);
    });

    it('is not a batch with no ready stock at all', () => {
        expect(finishedStockAlreadyMoved(handleBatch({ jobs: [job(784, [roll(3444)])] }))).toBe(false);
    });
});

describe('the finished-stock collection as one write', () => {
    const move = (type, location) => ({ fields: { Item_ID: 885, Production_Job: 787, Transaction_Type: type, Location: location } });
    const closing = [{ id: 787, fields: { Production_Started: true, Production_Completed: true } }];

    it('carries the moves, the batch flag and the job closures in one bundle, so a refusal leaves none of them', () => {
        expect(finishedCollectionActions({
            batchId: 86,
            moves: [move('LESS', 'BAGS GODOWN'), move('ADD', 'PRINTING AREA')],
            closing
        })).toEqual([
            ['AddRecord', 'Inventory_Transactions', null, { Item_ID: 885, Production_Job: 787, Transaction_Type: 'LESS', Location: 'BAGS GODOWN' }],
            ['AddRecord', 'Inventory_Transactions', null, { Item_ID: 885, Production_Job: 787, Transaction_Type: 'ADD', Location: 'PRINTING AREA' }],
            ['UpdateRecord', 'Factory_Production_Job_Batches', 86, { Finished_Stock_Collected: true }],
            ['UpdateRecord', 'Factory_Production_Jobs', 787, { Production_Started: true, Production_Completed: true }]
        ]);
    });

    it('still sets the flag and closes the jobs when the stock was already moved', () => {
        expect(finishedCollectionActions({ batchId: 86, moves: [], closing })).toEqual([
            ['UpdateRecord', 'Factory_Production_Job_Batches', 86, { Finished_Stock_Collected: true }],
            ['UpdateRecord', 'Factory_Production_Jobs', 787, { Production_Started: true, Production_Completed: true }]
        ]);
    });

    it('never sends a column Grist stamps for itself', () => {
        const [action] = finishedCollectionActions({
            batchId: 86, moves: [],
            closing: []
        });
        expect(action[3]).not.toHaveProperty('Finished_Stock_Collected_At');
        expect(finishedCollectionActions({
            batchId: 86, moves: [],
            closing: [{ id: 787, fields: { Production_Started: true, Production_Completed_At: 1 } }]
        })[1]).toEqual(['UpdateRecord', 'Factory_Production_Jobs', 787, { Production_Started: true }]);
    });
});
