import { describe, it, expect } from 'vitest';
import { jobsClosedByFinishedCollection } from './finishedCollection';

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
