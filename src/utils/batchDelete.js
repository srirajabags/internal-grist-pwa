const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// Everything that makes a batch unsafe to remove. Creating a batch only writes
// records; once it has moved stock or been started on the floor, deleting it
// would leave those movements pointing at nothing, so it is refused outright
// rather than half-reversed.
export const deleteBlockers = ({ batch, txnCount, checkFailed }) => {
    const blockers = [];
    // An unanswered question is not a clean bill of health.
    if (checkFailed) blockers.push('The check for stock movements could not be run');
    const started = (batch?.jobs || []).filter((j) => j.started);
    const completed = (batch?.jobs || []).filter((j) => j.completed);
    if (completed.length > 0) {
        blockers.push(`${completed.length} job(s) already completed — ${completed.map((j) => `#${j.id}`).join(', ')}`);
    }
    if (started.length > 0) {
        blockers.push(`${started.length} job(s) already started — ${started.map((j) => `#${j.id}`).join(', ')}`);
    }
    if (batch?.invCollected) blockers.push('Inventory has been marked collected for this batch');
    if (batch?.invReturned) blockers.push('Remaining inventory has been marked returned');
    if (num(txnCount) > 0) {
        blockers.push(`${num(txnCount)} inventory transaction(s) already reference this batch's jobs`);
    }
    return blockers;
};

