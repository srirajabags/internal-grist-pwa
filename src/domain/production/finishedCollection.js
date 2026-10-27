// What collecting a batch's finished stock closes.
//
// A job answered entirely from ready stock has no machine work: the trip from the
// bags godown to the printing area is the job. So the collection that makes that
// trip also starts and completes the job -- and it has to, because the batch's
// Production_Completed_At only fills once every job is completed, and the printing
// queue only picks up sub-orders whose production job is.
//
// Both flags go in one update. Grist lets a job be completed only once it is
// started, or started in the same write, and batch 2026-09-10 - ROLLS TO SIDEPATTY -
// 25 showed what happens otherwise: the app sent Production_Completed alone, the
// rule refused it, and jobs 232 and 233 -- sixteen jobs over six batches in all --
// stayed open behind a batch that said its stock was collected.
import { isLatentJob, splitStock } from '../inventory/godown';
import { writableFields } from '../../grist/gristWrites';

// The job updates a finished-stock collection makes: every job met entirely from
// ready stock that is not already completed. A job that cuts a roll is real work
// and is left to its operator, and so is a job whose stock cannot be read.
export const jobsClosedByFinishedCollection = (jobs) => (jobs || [])
    .filter((job) => job && !job.completed && isLatentJob(job))
    .map((job) => ({ id: job.id, fields: { Production_Started: true, Production_Completed: true } }));

// Who may set Finished_Stock_Collected. This mirrors Grist access rule 332 (and
// 331, for doc owners), so the app can say so before anyone walks to the shelf
// rather than after the stock has been booked. Doc owner means owner of the Grist
// doc, not the OWNER role in Team -- the rule tests user.Access.
export const FINISHED_STOCK_COLLECTOR = 'FINISHED STOCK COLLECTOR';

export const canMarkFinishedCollected = (roles, isDocOwner) =>
    Boolean(isDocOwner) || (roles || []).includes(FINISHED_STOCK_COLLECTOR);

// Every ready item on the batch has been moved for its job, yet the batch is not
// marked collected. The sheet then has nothing to tick, but the flag and the job
// closures are still owed -- batch 2026-10-24 - ROLLS TO HANDLES - 86 sat like
// this with its button disabled for everyone. Only a fully moved batch qualifies:
// an item still on the shelf means the trip is not done, and a batch with no
// ready stock never had one to make.
export const finishedStockAlreadyMoved = (batch) => {
    if (!batch || batch.finCollected) return false;
    const items = (batch.jobs || []).flatMap((job) => splitStock(job?.invItemOptions).finished);
    return items.length > 0 && items.every((item) => item.collectedKg != null);
};

// The whole collection as one Grist bundle: the moves, the batch flag and the job
// closures. Grist applies a bundle whole or not at all, so a refusal on any part --
// batch 86's operator could write the moves but not the flag -- leaves nothing
// half-booked. Sent as separate writes, the moves landed and the rest did not.
export const finishedCollectionActions = ({ batchId, moves = [], closing = [] }) => [
    ...moves.map((r) => ['AddRecord', 'Inventory_Transactions', null, r.fields]),
    ['UpdateRecord', 'Factory_Production_Job_Batches', batchId,
        writableFields('Factory_Production_Job_Batches', { Finished_Stock_Collected: true })],
    ...closing.map((c) => ['UpdateRecord', 'Factory_Production_Jobs', c.id,
        writableFields('Factory_Production_Jobs', c.fields)])
];
