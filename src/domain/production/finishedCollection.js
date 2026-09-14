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
import { isLatentJob } from '../inventory/godown';

// The job updates a finished-stock collection makes: every job met entirely from
// ready stock that is not already completed. A job that cuts a roll is real work
// and is left to its operator, and so is a job whose stock cannot be read.
export const jobsClosedByFinishedCollection = (jobs) => (jobs || [])
    .filter((job) => job && !job.completed && isLatentJob(job))
    .map((job) => ({ id: job.id, fields: { Production_Started: true, Production_Completed: true } }));
