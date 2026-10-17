import { num } from './txnDisplay';

// Who may sign off an Inventory_Transactions row. Mirrors the Grist access rules
// on Incharge_Ack: nobody acknowledges an entry they booked themselves, so stock
// always passes a second pair of hands -- except doc owners, who are exempt.
// Grist enforces this regardless; the app only keeps people from pressing a
// button that is bound to fail.

// Booked by this Team member. A blank creator (old rows) is nobody's own entry.
export const isOwnEntry = (creatorId, teamId) => {
    const creator = num(creatorId);
    return creator > 0 && creator === num(teamId);
};

export const canAcknowledge = (creatorId, teamId, ownerExempt) =>
    Boolean(ownerExempt) || !isOwnEntry(creatorId, teamId);
