// A batch with no roll in it.
//
// When every job in a batch is answered from ready-made stock, there is nothing
// to cut: no roll leaves the rolls godown and none comes back. The batch card used
// to show the two roll steps anyway, and the batch could never close, because a
// batch is closed only by Remaining_Inventory_Returned -- and both checklists
// refuse to confirm an empty sheet. 2026-10-09 - ROLLS TO HANDLES - 65 sat like
// that: production complete, finished stock collected, still listed as open.
//
// So such a batch gets one step in place of the two: close it once production is
// complete (which the finished-stock collection brings about, by completing the
// stock-only jobs).
import { splitJobs } from '../inventory/godown';

// Judged by splitJobs, so a job whose stock cannot be read still counts as one
// that may cut a roll -- hiding a roll step that is owed is the worse mistake.
export const isStockOnlyBatch = (batch) => {
    const jobs = batch?.jobs || [];
    return jobs.length > 0 && splitJobs(jobs).real.length === 0;
};

export const canCloseStockOnlyBatch = (batch) =>
    isStockOnlyBatch(batch) && Boolean(batch.completedAt) && !batch.invReturned;

// Both flags in one write. Grist's rules let a batch type's operator set
// Remaining_Inventory_Returned only once Required_Inventory_Collected is set, or
// in the same write as it (rules 326-338); a FINISHED STOCK COLLECTOR may set
// neither. With no roll, "collected" books nothing and only satisfies that rule.
// The *_At columns are trigger formulas Grist stamps itself.
export const closeStockOnlyBatchFields = () => ({
    Required_Inventory_Collected: true,
    Remaining_Inventory_Returned: true
});
