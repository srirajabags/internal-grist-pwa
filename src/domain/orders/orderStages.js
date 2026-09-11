// The journey a sub-order takes, as a customer would describe it, plus the dates
// each step is expected on when it has not happened yet.
//
// Every stage is shown, done or not: an order that has only reached cutting still
// lists printing and stitching ahead of it, with projected dates, so the customer
// can see the whole path rather than a stub that stops at today.

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();

// Working days each stage typically takes once the one before it is done. These
// are the promise the tracking page makes, so they should match what the floor
// actually turns around -- adjust here, in one place.
export const STAGE_LEAD_DAYS = {
    factory: 1,      // order accepted -> released to the factory
    production: 2,   // cutting the rolls
    printing: 2,     // printing the cut stock
    stitching: 3,    // stitching into finished bags
    ready: 1         // checked, packed, ready to go
};

const DAY = 24 * 60 * 60;

export const STAGES = [
    { key: 'ordered', label: 'Order received', blurb: 'We have your order and the design details.' },
    { key: 'factory', label: 'Sent to production', blurb: 'The order has been released to the factory floor.' },
    { key: 'production', label: 'Material cutting', blurb: 'Rolls are cut to the size your bags need.' },
    { key: 'printing', label: 'Printing', blurb: 'Your design is printed on the cut material.' },
    { key: 'stitching', label: 'Stitching', blurb: 'Pieces, handles and gussets are stitched into finished bags.' },
    { key: 'ready', label: 'Ready for dispatch', blurb: 'Bags are finished, checked and ready to leave.' }
];

// Stages that do not apply are left out rather than shown as skipped: a bag with
// no print never goes through printing, and only a stitching bag is stitched.
export const stagesFor = (so) => {
    const printed = norm(so.print) !== '' && norm(so.print) !== 'NO PRINT';
    const stitched = norm(so.model) === 'STITCHING';
    return STAGES.filter((s) => {
        if (s.key === 'printing') return printed;
        if (s.key === 'stitching') return stitched;
        return true;
    });
};

// A stage is done when every job for it is done, and running once any has started.
const stageState = (p) => {
    if (!p || !p.total) return { state: 'pending', at: null };
    if (p.done >= p.total && p.completedAt) return { state: 'done', at: p.completedAt };
    if (p.startedAt) return { state: 'active', at: p.startedAt };
    return { state: 'pending', at: null };
};

// Build the full timeline: what has happened, with its date, and what has not,
// with the date it is expected on. Expected dates chain forward from the last
// thing that actually happened, so a delay early on moves everything after it.
export const buildTimeline = (so, progress = {}) => {
    const applicable = stagesFor(so);
    const actual = {
        ordered: num(so.orderedAt) || num(so.orderPlacedAt) || null,
        factory: num(so.factoryAt) || null,
        production: stageState(progress.production).state === 'done' ? stageState(progress.production).at : null,
        printing: stageState(progress.printing).state === 'done' ? stageState(progress.printing).at : null,
        stitching: stageState(progress.stitching).state === 'done' ? stageState(progress.stitching).at : null,
        ready: null
    };
    const running = {
        production: stageState(progress.production).state === 'active' ? stageState(progress.production).at : null,
        printing: stageState(progress.printing).state === 'active' ? stageState(progress.printing).at : null,
        stitching: stageState(progress.stitching).state === 'active' ? stageState(progress.stitching).at : null
    };

    // Everything is finished once the last applicable working stage is done.
    const working = applicable.filter((s) => !['ordered', 'ready'].includes(s.key));
    const lastWorking = working[working.length - 1];
    if (lastWorking && actual[lastWorking.key]) {
        actual.ready = actual[lastWorking.key] + STAGE_LEAD_DAYS.ready * DAY;
    }

    // The clock for projections starts at the most recent real event.
    let cursor = null;
    for (const s of applicable) {
        if (actual[s.key]) cursor = Math.max(cursor || 0, actual[s.key]);
        if (running[s.key]) cursor = Math.max(cursor || 0, running[s.key]);
    }
    if (!cursor) cursor = num(so.orderedAt) || num(so.orderPlacedAt) || Date.now() / 1000;

    let projected = Math.max(cursor, Date.now() / 1000);
    return applicable.map((s) => {
        const at = actual[s.key] || null;
        if (at) return { ...s, state: 'done', at, expectedAt: null };
        const isActive = Boolean(running[s.key]);
        // Each pending stage sits a lead time after the one before it; a stage
        // already running is expected to finish a lead time from its start.
        projected = (isActive ? Math.max(running[s.key], Date.now() / 1000) : projected) + (STAGE_LEAD_DAYS[s.key] || 1) * DAY;
        return {
            ...s,
            state: isActive ? 'active' : 'pending',
            at: isActive ? running[s.key] : null,
            expectedAt: projected
        };
    });
};

// The headline a customer reads first.
export const summarise = (timeline) => {
    const done = timeline.filter((s) => s.state === 'done').length;
    const active = timeline.find((s) => s.state === 'active');
    const next = timeline.find((s) => s.state !== 'done');
    return {
        done,
        total: timeline.length,
        current: active || next || timeline[timeline.length - 1],
        complete: done === timeline.length,
        expectedReady: timeline[timeline.length - 1]?.expectedAt || timeline[timeline.length - 1]?.at || null
    };
};
