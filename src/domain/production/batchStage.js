// How far along a batch is, in the four states the floor actually distinguishes.
//
// The batch card used to ask only whether a batch had ever started -- Grist stamps
// Production_Started_At when the first job starts -- and so every batch the factory
// had ever run wore "In Progress" for good. Batch 2026-09-04 - ROLLS TO SIDEPATTY -
// 19 finished on 5 Sep and handed its leftover roll back on 8 Sep, and still read as
// running a fortnight later.
//
// Finishing the jobs is not the end: the rolls are on the floor until somebody walks
// them back, which is the same line the open/closed batch lists are drawn on. So
// "every job done" and "roll returned" are separate states, not one.

import { splitStock } from '../inventory/godown';

// In the order a batch passes through them.
export const BATCH_STAGES = [
    { key: 'planned', label: 'Not started' },
    { key: 'running', label: 'In progress' },
    { key: 'made', label: 'Roll not returned' },
    { key: 'closed', label: 'Closed' }
];

const stage = (key) => BATCH_STAGES.find((s) => s.key === key);

// `batch` carries the times Grist stamps (startedAt, completedAt) and whether the
// remaining stock has been returned (invReturned). A batch with no times at all has
// not started; anything else is read from the finish backwards, so a completed batch
// is never reported as unstarted on the strength of a missing start time.
export const batchStage = (batch) => {
    if (!batch) return stage('planned');
    if (batch.completedAt) return stage(batch.invReturned ? 'closed' : 'made');
    return stage(batch.startedAt ? 'running' : 'planned');
};

// What a batch card says about itself: the cutting, the ready-made stock it was
// given, and the leftover roll, each only where it applies.
//
// `tone` is what the pill means, not what it looks like: 'action' is something
// somebody still owes, 'done' is settled, 'live' is happening now.
//
// Only what applies. Batch 19 drew no ready-made stock at all, so a finished-stock
// pill on it would invent work nobody owes; and a roll is not "to be returned"
// while the job is still cutting it.
const pill = (key, label, tone) => ({ key, label, tone });

export const batchPills = (batch) => {
    if (!batch) return [];
    const jobs = batch.jobs || [];
    const hasFinished = jobs.some((j) => splitStock(j.invItemOptions).finished.length > 0);
    const hasRolls = jobs.some((j) => splitStock(j.invItemOptions).raw.length > 0);
    const finishedPending = hasFinished && !batch.finCollected;
    const { key } = batchStage(batch);
    const off = key === 'made' || key === 'closed';

    // Everything settled: one pill, rather than a row of ticks saying the same.
    if (key === 'closed' && !finishedPending) return [pill('closed', 'Closed', 'done')];

    const pills = [];
    // A batch with nothing to cut -- every line answered from ready-made stock --
    // is not waiting to start production; it is waiting for somebody to fetch the
    // stock, which the next pill says.
    if (key === 'planned' && hasRolls) pills.push(pill('productionPending', 'Production not yet started', 'action'));
    if (key === 'running') pills.push(pill('running', 'In production', 'live'));
    if (off) pills.push(pill('productionDone', 'Production complete', 'done'));
    if (hasFinished) {
        pills.push(finishedPending
            ? pill('finishedPending', 'Finished stock to be collected', 'action')
            : pill('finishedDone', 'Finished stock collected', 'done'));
    }
    if (hasRolls) {
        if (batch.invReturned) pills.push(pill('rollsDone', 'Rolls returned', 'done'));
        // The roll is only owed back once the machine has finished with it.
        else if (off) pills.push(pill('rollsPending', 'Rolls to be returned', 'action'));
    }
    return pills;
};

// The order the filter lists them: the same order they appear on a card.
const PILL_ORDER = [
    'productionPending', 'running', 'productionDone',
    'finishedPending', 'finishedDone', 'rollsPending', 'rollsDone', 'closed'
];

// Does a batch answer the filter? Nothing ticked means everything shows; several
// ticks mean any of them, so "rolls to be returned" and "finished stock to be
// collected" together lists the batches owing either.
export const batchMatchesPills = (batch, selected) => {
    const want = selected || [];
    if (want.length === 0) return true;
    const keys = new Set(batchPills(batch).map((p) => p.key));
    return want.some((k) => keys.has(k));
};

// What the filter offers: only the pills the batches on screen actually carry, each
// with how many carry it. A tick that would empty the list is not worth offering.
export const pillFilterOptions = (batches) => {
    const seen = new Map();
    for (const b of batches || []) {
        for (const p of batchPills(b)) {
            const at = seen.get(p.key);
            if (at) at.count += 1;
            else seen.set(p.key, { key: p.key, label: p.label, tone: p.tone, count: 1 });
        }
    }
    return [...seen.values()].sort((a, b) => PILL_ORDER.indexOf(a.key) - PILL_ORDER.indexOf(b.key));
};
