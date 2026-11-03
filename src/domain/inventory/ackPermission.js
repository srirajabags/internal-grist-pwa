import { num } from './txnDisplay';

// Who may sign off an Inventory_Transactions row. Mirrors the Grist access rules
// on Incharge_Ack: nobody acknowledges an ADD or LESS they booked themselves, so
// stock always passes a second pair of hands -- except doc owners, who are exempt.
// NEW STOCK is a new roll's opening entry and the person who weighed it in may
// sign it off; Grist stops anyone turning an ADD into one to get round that.
// An entry booked against a production job may be signed off by its own
// booker too (owner's call, 3 Nov 2026): the job ledger already accounts for
// that stock. Only the booker can attach a job, and only before the entry is
// acknowledged, so the job stays on the record once it is signed off.
// Grist enforces this regardless; the app only keeps people from pressing a
// button that is bound to fail.

// Booked by this Team member. A blank creator (old rows) is nobody's own entry.
export const isOwnEntry = (creatorId, teamId) => {
    const creator = num(creatorId);
    return creator > 0 && creator === num(teamId);
};

export const needsSecondPerson = (type) =>
    String(type || '').trim().toUpperCase() !== 'NEW STOCK';

export const canAcknowledge = (creatorId, teamId, ownerExempt, type, jobId) =>
    Boolean(ownerExempt) || !needsSecondPerson(type) || num(jobId) > 0 || !isOwnEntry(creatorId, teamId);
