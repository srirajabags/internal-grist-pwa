// Which printing machine a sub-order runs on, and how the queue falls into
// batches.
//
// A printing batch is one machine type dressed with one set of inks: the
// operator loads the colours once and runs every order in the batch. So the
// batch key is the machine and the colour set together -- two RED orders on the
// single-colour machine share a batch, a RED one on the stereo machine does not.
//
// The machines on the floor (Nov 2026):
//
//   2 single colour, 1 single colour lamination, 1 two colour, 1 three colour,
//   1 multi colour, 1 "pls" single colour, 1 stereo
//
// Two-colour work runs in one pass on the two-colour machine, so a RED + BLUE
// order is one job in one batch, never a RED pass and a BLUE pass.
//
// The machine is a suggestion: it is worked out from the order here, shown when
// the batch is made, and stored on the batch, so the person making it can
// override a guess and a later change to these rules cannot move work already
// planned.

import { parseChoiceList } from '../../grist/gristValues.js';

export const MACHINES = {
    SINGLE: 'SINGLE COLOUR',
    LAMINATION: 'SINGLE COLOUR LAMINATION',
    TWO: 'TWO COLOUR',
    THREE: 'THREE COLOUR',
    MULTI: 'MULTI COLOUR',
    PLS: 'PLS SINGLE COLOUR',
    STEREO: 'STEREO'
};

export const MACHINE_LIST = Object.values(MACHINES);

// The Team role that runs each machine. Spaces, not underscores, like every
// other role on the Team table.
export const operatorRoleFor = (machine) => `${machine} PRINTING OPERATOR`;
export const OPERATOR_ROLES = MACHINE_LIST.map(operatorRoleFor);

export const MULTI_COLOUR = 'MULTI COLOUR';

const norm = (v) => String(v ?? '').trim().toUpperCase();

// The inks an order prints in, cleaned and in a fixed order, so RED + BLUE and
// BLUE + RED are the same set.
export const printingColours = (so) => [...new Set(parseChoiceList(so?.printingColour).map(norm))]
    .filter(Boolean)
    .sort();

// Whether an order gets a printing job at all.
//
// The printing colour is the authority: an order with no colour is a plain bag
// and goes straight to the packing area. Print says the same thing in other
// words, and where the two disagree -- a colour on a NO PRINT order -- the order
// is held back rather than guessed at, because printing a plain bag cannot be
// undone.
export const printingState = (so) => {
    const colours = printingColours(so);
    const noPrint = norm(so?.print) === 'NO PRINT';
    if (colours.length === 0) return 'PLAIN';
    if (noPrint) return 'CONFLICT';
    return 'PRINT';
};

// The colour set as a batch reads it. Anything naming MULTI COLOUR is the multi
// colour machine's work whatever else is listed, and those orders share one
// batch: the machine prints a full design, not a chosen ink.
export const colourKey = (so) => {
    const colours = printingColours(so);
    if (colours.includes(MULTI_COLOUR) || norm(so?.print) === MULTI_COLOUR) return MULTI_COLOUR;
    return colours.join(' + ');
};

// The machine an order runs on.
//
// A stereo plate only fits the stereo machine, so that comes first. A full
// design goes to the multi colour machine. Otherwise the number of inks decides,
// with two material exceptions to single colour: laminated (BOPP) fabric on the
// lamination machine and plastic covers on the "pls" machine.
export const suggestedMachine = (so) => {
    if (norm(so?.plate) === 'STEREO') return MACHINES.STEREO;
    if (colourKey(so) === MULTI_COLOUR) return MACHINES.MULTI;
    const n = printingColours(so).length;
    if (n >= 4) return MACHINES.MULTI;
    if (n === 3) return MACHINES.THREE;
    if (n === 2) return MACHINES.TWO;
    const material = norm(so?.material);
    if (material === 'BOPP LAMINATED') return MACHINES.LAMINATION;
    if (material === 'PLASTIC') return MACHINES.PLS;
    return MACHINES.SINGLE;
};

// The queue as batches-to-be, in the three levels a batch is made of: machine,
// then ink set (a job), then shop (an output within the job). The busiest
// machine comes first, its ink sets and shops in name order. Orders that are
// plain or contradict themselves are returned apart, never grouped.
export const groupQueue = (subOrders) => {
    const machines = new Map();
    const held = [];
    for (const so of subOrders || []) {
        const state = printingState(so);
        if (state !== 'PRINT') {
            held.push({ so, state });
            continue;
        }
        const machine = suggestedMachine(so);
        const colours = colourKey(so);
        if (!machines.has(machine)) machines.set(machine, { machine, subOrders: [], jobs: new Map() });
        const m = machines.get(machine);
        m.subOrders.push(so);
        if (!m.jobs.has(colours)) m.jobs.set(colours, { colours, subOrders: [], outputs: new Map() });
        const job = m.jobs.get(colours);
        job.subOrders.push(so);
        const shopKey = so.customer || `so-${so.id}`;
        if (!job.outputs.has(shopKey)) job.outputs.set(shopKey, { customer: so.customer || null, shop: so.shop || '', city: so.city || '', subOrders: [] });
        job.outputs.get(shopKey).subOrders.push(so);
    }
    const byName = (key) => (a, b) => String(a[key]).localeCompare(String(b[key]));
    const list = [...machines.values()]
        .map((m) => ({
            ...m,
            jobs: [...m.jobs.values()].sort(byName('colours'))
                .map((j) => ({ ...j, outputs: [...j.outputs.values()].sort(byName('shop')) }))
        }))
        .sort((a, b) => b.subOrders.length - a.subOrders.length || a.machine.localeCompare(b.machine));
    return { machines: list, held };
};

// Which batches an operator sees: the ones for the machines their roles name.
// Supervisors (FACTORY PRINTING, OWNER) see every machine.
export const SUPERVISOR_ROLES = ['OWNER', 'FACTORY PRINTING'];

export const machinesFor = (roles = []) => {
    if (roles.some((r) => SUPERVISOR_ROLES.includes(r))) return MACHINE_LIST;
    return MACHINE_LIST.filter((m) => roles.includes(operatorRoleFor(m)));
};
