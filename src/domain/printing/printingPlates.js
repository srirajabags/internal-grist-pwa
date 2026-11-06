// The printing plate register: what a plate is good for, where it lives, and
// what may happen to it next.
//
// A plate is made for one customer's design and kept for their repeat orders.
// It lives on a rack lettered by the customer's city (a Kurnool shop's plates
// on rack K), in a numbered slot -- K-1290 -- and the office writes that code at
// the end of the shop's name (rackCodes.js). A printing batch takes its plates
// off the racks, and each comes back after the job -- or is retired, when it is
// worn out or was never meant to be kept.
//
// Every change to a plate is written twice in one bundle: the plate row says
// where it is now, the movement row says what happened and who did it. The
// register is what the rack checker trusts; the log is how a missing plate is
// traced.

import { KIND } from './rackCodes.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

export const PLATES_TABLE = 'Printing_Plates';
export const MOVEMENTS_TABLE = 'Printing_Plate_Movements';
export const PLATES_INCHARGE = 'PRINTING PLATES INCHARGE';

export const STATUS = {
    UNVERIFIED: 'TO BE VERIFIED',
    IN_RACK: 'IN RACK',
    ISSUED: 'ISSUED',
    NOT_FOUND: 'NOT FOUND',
    DAMAGED: 'DAMAGED',
    DISCARDED: 'DISCARDED'
};
export const STATUS_LIST = Object.values(STATUS);

// A plate that has left the register for good. Nothing is offered for these:
// not a pick, not a repeat order.
export const isRetired = (plate) => [STATUS.DAMAGED, STATUS.DISCARDED].includes(norm(plate?.status));

// Plastic-cover and BOPP plates are thrown away after the run, digital plates
// included; stereos of any material, and non-woven plates, are kept (user,
// 1 Nov 2026).
export const isReusable = ({ material, plateType } = {}) => {
    if (norm(plateType) === KIND.STEREO) return true;
    return !['PLASTIC', 'BOPP LAMINATED'].includes(norm(material));
};

// Which kind of plate an order prints with: a stereo, a digital plate for a
// full-colour design, or an ordinary plate. Null for an order that uses none.
export const kindOfOrder = (so) => {
    const plate = norm(so?.plate);
    if (plate === 'STEREO') return KIND.STEREO;
    if (plate !== 'PLATE') return null;
    return norm(so?.print) === 'MULTI COLOUR' ? KIND.DIGITAL : KIND.PLATE;
};

// How long a plate lasts from the day it was made (user, 5 Nov 2026): plates
// six months, digital plates a year, stereos for good. The same rule is the
// Expires_On formula in Grist (create-printing-tables.mjs) -- change both.
export const EXPIRY_MONTHS = { [KIND.PLATE]: 6, [KIND.DIGITAL]: 12, [KIND.STEREO]: null };

// The records start in October 2025. A plate used since then with no making
// order on record was made before it, so this is the latest it can have been
// made -- and its expiry is "by" that date plus its months.
export const RECORDS_START = Date.UTC(2025, 9, 1) / 1000;

// The day a plate expires, as epoch seconds at UTC midnight like a Grist Date,
// or null when it never does or nothing is known of it. `bound` says the date
// is the latest it can be, for a plate made before the records.
export const expiry = (plate) => {
    const months = EXPIRY_MONTHS[norm(plate?.plateType)];
    if (!months) return null;
    const made = num(plate?.madeOn);
    const madeBefore = !made && num(plate?.lastUsedOn) > 0;
    if (!made && !madeBefore) return null;
    const d = new Date((made || RECORDS_START) * 1000);
    d.setUTCMonth(d.getUTCMonth() + months);
    return { on: d.getTime() / 1000, bound: madeBefore };
};

export const expiresOn = (plate) => expiry(plate)?.on ?? null;

// Whether a plate is past its expiry on `today` (epoch seconds).
export const isExpired = (plate, today) => {
    const until = expiresOn(plate);
    return until != null && num(today) >= until;
};

// The rack a plate belongs on: the first letter of the shop's city. Blank when
// the city does not start with a letter, so nobody is sent to a rack that does
// not exist.
export const rackFor = (city) => {
    const first = norm(city).charAt(0);
    return /^[A-Z]$/.test(first) ? first : '';
};

export const RACKS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

// Sizes as smaller x bigger, the way the factory writes them.
const dims = (w, h) => [num(w), num(h)].sort((a, b) => a - b);

// Whether a plate made for one bag will print on another. A plate fits any bag
// as big or bigger in both directions; it hangs off the edge of a smaller one.
// Unknown when either size is missing -- the person confirming looks at it.
export const plateFits = (plate, bag) => {
    const [pa, pb] = dims(plate?.bagW, plate?.bagH);
    const [ba, bb] = dims(bag?.bagW, bag?.bagH);
    if (!pa || !pb || !ba || !bb) return null;
    return pa <= ba && pb <= bb;
};

// What may happen to a plate in each state, and the state it leaves it in.
//
// VERIFIED is the rack check: a person found it where the register says, and
// nothing about its place changes -- the checker only confirms, never types a
// slot (user, 5 Nov 2026). A plate somewhere else is MOVED. A plate can be
// picked for a job before anyone has checked its rack -- finding it in its slot
// is the check -- so ISSUED also takes an unverified plate.
export const ACTIONS = {
    VERIFIED: { from: [STATUS.UNVERIFIED, STATUS.IN_RACK, STATUS.NOT_FOUND], to: STATUS.IN_RACK },
    MOVED: { from: [STATUS.IN_RACK], to: STATUS.IN_RACK, needsPlace: true },
    NOT_FOUND: { from: [STATUS.UNVERIFIED, STATUS.IN_RACK], to: STATUS.NOT_FOUND },
    ISSUED: { from: [STATUS.IN_RACK, STATUS.UNVERIFIED, STATUS.NOT_FOUND], to: STATUS.ISSUED },
    // Back to the slot the register has for it; nobody types a number.
    RETURNED: { from: [STATUS.ISSUED], to: STATUS.IN_RACK },
    DAMAGED: { from: [STATUS.IN_RACK, STATUS.ISSUED, STATUS.UNVERIFIED], to: STATUS.DAMAGED },
    DISCARDED: { from: [STATUS.IN_RACK, STATUS.ISSUED, STATUS.UNVERIFIED, STATUS.NOT_FOUND, STATUS.DAMAGED], to: STATUS.DISCARDED }
};
export const ACTION_LIST = ['ADDED', ...Object.keys(ACTIONS)];

export const canDo = (plate, action) => Boolean(ACTIONS[action]?.from.includes(norm(plate?.status)));

// Why an action cannot be done, or null when it can.
// A slot is a whole number, written after the rack letter (K-1290).
const slotNumber = (slot) => {
    const n = Number(String(slot ?? '').trim());
    return Number.isInteger(n) && n > 0 ? n : null;
};

export const actionProblem = (plate, action, { rack, slot } = {}) => {
    const rule = ACTIONS[action];
    if (!rule) return `Unknown action ${action}.`;
    if (!canDo(plate, action)) return `A plate that is ${norm(plate?.status) || 'unknown'} cannot be ${action.toLowerCase().replace('_', ' ')}.`;
    if (rule.needsPlace && (!/^[A-Z]$/.test(norm(rack)) || !slotNumber(slot))) return 'Say which rack and slot number it is in.';
    return null;
};

// The Grist bundle for one action on one plate: the plate's new state and the
// movement that explains it, applied whole or not at all.
// `stereoSize` is what the person measured while they had a stereo in hand,
// written only when given.
export const plateActionBundle = (plate, action, { rack, slot, jobId, notes, stereoSize } = {}) => {
    const problem = actionProblem(plate, action, { rack, slot });
    if (problem) throw new Error(problem);
    const rule = ACTIONS[action];
    const fields = { Status: rule.to };
    if (rule.needsPlace) {
        fields.Rack = norm(rack);
        fields.Slot = slotNumber(slot);
    }
    if (String(stereoSize ?? '').trim()) fields.Stereo_Size = String(stereoSize).trim();
    // An issued plate names the job holding it, so a missing one can be chased;
    // once it is back, or gone, it names nothing.
    fields.Issued_To_Job = action === 'ISSUED' ? num(jobId) || null : null;
    // Taking a plate out of its slot proves it was there, the same as the check.
    if (action === 'VERIFIED' || (action === 'ISSUED' && norm(plate.status) !== STATUS.IN_RACK)) fields.Verified = true;
    const movement = {
        Plate: plate.id,
        Action: action,
        Status_After: rule.to,
        Rack: fields.Rack ?? norm(plate.rack),
        Slot: fields.Slot ?? (slotNumber(plate.slot) || null),
        Printing_Job: num(jobId) || null,
        Notes: notes || ''
    };
    return [
        ['UpdateRecord', PLATES_TABLE, plate.id, fields],
        ['AddRecord', MOVEMENTS_TABLE, null, movement]
    ];
};

// What happens to a plate when its job is done: back on the rack, or retired.
// A plate the material says is single-use is discarded whatever condition it is
// in; a kept plate the operator marked worn out is retired as damaged.
export const PLATE_CONDITION = { REUSABLE: 'REUSABLE', DAMAGED: 'DAMAGED' };

export const afterJobAction = (plate, condition) => {
    if (!isReusable(plate)) return 'DISCARDED';
    return norm(condition) === PLATE_CONDITION.DAMAGED ? 'DAMAGED' : 'RETURNED';
};

// The plate a sub-order prints with: the one made for it (a new design's
// plate, registered when first picked), or the old plate the office confirmed
// it reuses.
//
// Failing both, the customer's likeliest plate for it -- the size shortlist's
// first, as on the repeat-orders screen. A repeat order confirmed in Grist
// before the register existed names no plate, and registering a "new" one for
// it would put a second row on a plate already in the rack. The incharge sees
// which plate is offered before taking it.
//
// Retired plates are never offered, and an order left with none is reported --
// it cannot run.
export const platesForSubOrder = (so, plates) => {
    const soId = num(so?.id);
    const reused = new Set((so?.reusedPlates || []).map(num));
    const live = (plates || []).filter((p) => !isRetired(p));
    const own = live.filter((p) => (soId && num(p.sourceSubOrder) === soId) || reused.has(num(p.id)));
    if (own.length || !so?.customer) return own;
    const { shortlist } = repeatShortlist(so, live, 0);
    return shortlist.length ? [shortlist[0].plate] : [];
};

// The pick list for a batch, in walking order: rack, then slot, then plate.
// A job is one shop's orders in one colour, so its plates are those of each of
// its orders, each taken once. Every order with no plate to pick is flagged
// rather than left off, so the gap shows before the machine is dressed.
export const pickList = (jobs, plates) => {
    const lines = [];
    const missing = [];
    for (const job of jobs || []) {
        const taken = new Set();
        for (const so of job.subOrders || []) {
            const own = platesForSubOrder(so, plates);
            if (own.length === 0) missing.push({ job, so });
            for (const plate of own) {
                if (taken.has(plate.id)) continue;
                taken.add(plate.id);
                lines.push({ job, so, plate });
            }
        }
    }
    // A plate with no slot yet sorts after the numbered ones on its rack.
    const slotOrder = (s) => slotNumber(s) ?? Infinity;
    lines.sort((a, b) => norm(a.plate.rack).localeCompare(norm(b.plate.rack))
        || slotOrder(a.plate.slot) - slotOrder(b.plate.slot)
        || num(a.plate.id) - num(b.plate.id));
    return { lines, missing };
};

// Which of a job's orders a plate printed, for the plate's order history.
export const ordersServedBy = (job, plate) => (job?.subOrders || [])
    .filter((so) => platesForSubOrder(so, [plate]).length)
    .map((so) => so.id);

// Plates a repeat order might reuse: the customer's own, still kept, and of the
// kind the order prints with -- a stereo order cannot run on a plate, nor a
// full-colour order on a single-colour plate (user, 5 Nov 2026). Plates that fit
// the new bag come first, then the newest. The app only offers these -- a
// person looks and confirms (user, 1 Nov 2026).
export const repeatCandidates = (subOrder, plates) => (plates || [])
    .filter((p) => num(p.customer) === num(subOrder?.customer) && !isRetired(p)
        && norm(p.plateType) === kindOfOrder(subOrder))
    .map((p) => ({ plate: p, fits: plateFits(p, subOrder) }))
    .sort((a, b) => Number(b.fits === true) - Number(a.fits === true)
        || num(b.plate.id) - num(a.plate.id));

// The plate a repeat order should most likely reuse -- one, since an order runs
// on a single plate (user, 5 Nov 2026).
//
//   shortlist  plates made for exactly the order's bag; failing that, the
//              closest fit -- the biggest plate that still fits -- as a smaller
//              plate on a bigger bag leaves more of the bag unprinted
//   others     the rest: smaller plates that also fit, and too-big ones, kept
//              for the person who knows better
//   pick       the newest plate on the shortlist that has not expired, or none
export const repeatShortlist = (subOrder, plates, today) => {
    const all = repeatCandidates(subOrder, plates);
    const [ba, bb] = dims(subOrder?.bagW, subOrder?.bagH);
    const exact = all.filter(({ plate }) => {
        const [pa, pb] = dims(plate.bagW, plate.bagH);
        return pa && pa === ba && pb === bb;
    });
    let shortlist = exact;
    if (!shortlist.length) {
        const fitting = all.filter((c) => c.fits === true);
        const area = ({ plate }) => num(plate.bagW) * num(plate.bagH);
        const best = Math.max(0, ...fitting.map(area));
        shortlist = best ? fitting.filter((c) => area(c) === best) : [];
    }
    const chosen = new Set(shortlist.map((c) => c.plate.id));
    const newestFirst = (a, b) => num(b.plate.madeOn) - num(a.plate.madeOn) || num(b.plate.id) - num(a.plate.id);
    shortlist = [...shortlist].sort(newestFirst);
    const pick = shortlist.find((c) => !isExpired(c.plate, today))?.plate.id ?? null;
    return { shortlist, others: all.filter((c) => !chosen.has(c.plate.id)), pick };
};
