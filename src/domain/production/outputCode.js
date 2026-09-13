// The item code a completed job books its output under, and what is still missing
// before it can.
//
// Job 2026-09-12 - ROLLS TO SIDEPATTY - 28 - 255: the output had no item code, and
// the operator only found out after counting the run and pressing Complete. So
// the completion form asks these questions when it opens, tells the operator in
// words they can pass to the office, and will not complete the job until the
// code and its stock item both exist.
import { codeLabel } from './productionBatch';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};
const fieldsOf = (r) => r?.fields ?? r;

// A GSM is text in the catalogue ('80') and sometimes a number elsewhere.
const sameGsm = (a, b) => (num(a) > 0 && num(a) === num(b)) || norm(a) === norm(b);
const sameInches = (a, b) => num(a) > 0 && num(b) > 0 && Math.abs(num(a) - num(b)) < 1e-6;

// What the output of one line is, as the catalogue would describe it: the job's
// roll for material and colour, the line's own size, and the line's weight where
// it carries one (a patty) or the roll's where it does not. Null when the line
// has no size -- there is nothing to name it by, and guessing is how output ends
// up under a neighbouring code.
export const outputCodeSpecForJob = (job, output) => {
    const d = output?.dims;
    if (!d || !(num(d.w) > 0) || !(num(d.h) > 0)) return null;
    return {
        type: output.outputType,
        material: job?.material ?? null,
        colour: job?.colour ?? null,
        gsm: d.gsm ?? job?.gsm ?? null,
        w: num(d.w),
        h: num(d.h)
    };
};

// The catalogue row for a spec, exactly: an 80 GSM strip is not a 110 GSM one, and
// a 12x50 is not a 12x54.
export const findOutputCode = (codes, spec) => {
    if (!spec) return null;
    const hit = (codes || []).map(fieldsOf).find((c) => norm(c.Type) === norm(spec.type)
        && norm(c.Material) === norm(spec.material)
        && norm(c.Colour) === norm(spec.colour)
        && sameGsm(c.GSM, spec.gsm)
        && sameInches(c.Width_Inches_, spec.w)
        && sameInches(c.Height_Inches_, spec.h));
    return hit ? (num(hit.id) || null) : null;
};

// Everything that has to be added before these outputs can be booked, one entry per
// thing to add. `missing` is 'size' (the line cannot be named), 'code' (no
// Inventory_Item_Codes row) or 'item' (the code exists but has no Inventory_Items
// row to book stock against). Empty when the job can be completed.
export const outputBookingGaps = ({ job, outputs, codes, items }) => {
    const stocked = new Set((items || []).map(fieldsOf).map((i) => num(i.Item_Code)).filter((id) => id > 0));
    const gaps = [];
    const seen = new Set();
    const add = (gap) => {
        const k = `${gap.missing}|${gap.label}`;
        if (seen.has(k)) return;
        seen.add(k);
        gaps.push(gap);
    };
    for (const o of outputs || []) {
        const key = o.key ?? o.sizeLabel ?? o.label;
        const spec = outputCodeSpecForJob(job, o);
        if (!spec) {
            add({ key, missing: 'size', label: o.label ?? o.sizeLabel ?? o.outputType, spec: null, codeId: null });
            continue;
        }
        const codeId = findOutputCode(codes, spec);
        if (!codeId) add({ key, missing: 'code', label: codeLabel(spec), spec, codeId: null });
        else if (!stocked.has(codeId)) add({ key, missing: 'item', label: codeLabel(spec), spec, codeId });
    }
    return gaps;
};

// The same answer as a message: the operator sends this to whoever keeps the
// catalogue, so it names the job and says exactly what to add.
export const bookingGapMessage = (job, gaps) => {
    if (!gaps || gaps.length === 0) return '';
    const lines = gaps.map((g) => {
        if (g.missing === 'code') return `• Add item code "${g.label}" to Inventory_Item_Codes, and a stock item for it in Inventory_Items`;
        if (g.missing === 'item') return `• Add a stock item in Inventory_Items for item code "${g.label}" (code #${g.codeId})`;
        return `• The size of "${g.label}" cannot be worked out — check the sub-order`;
    });
    return [`Job ${job?.name ?? ''} cannot be completed yet:`, ...lines].join('\n');
};

// The same question for every job in a batch, asked on the batch page, so a missing
// code reaches the office while the job is still being cut rather than when an
// operator is standing at the completion form. `jobs` is [{ job, outputs }], the
// outputs being the lines the completion form will ask about. Completed jobs have
// booked already and jobs with nothing to cut book nothing, so neither is listed.
export const batchBookingGaps = ({ jobs, codes, items }) => (jobs || [])
    .filter(({ job, outputs }) => !job?.completed && (outputs || []).length > 0)
    .map(({ job, outputs }) => ({ job, gaps: outputBookingGaps({ job, outputs, codes, items }) }))
    .filter((e) => e.gaps.length > 0);

// One message for the office covering the whole batch. A code two jobs are both
// waiting on is asked for once, with the jobs it holds up named beside it.
export const batchGapMessage = (batchName, entries) => {
    if (!entries || entries.length === 0) return '';
    const byThing = new Map();
    for (const { job, gaps } of entries) {
        for (const g of gaps) {
            const k = `${g.missing}|${g.label}`;
            if (!byThing.has(k)) byThing.set(k, { gap: g, jobs: [] });
            byThing.get(k).jobs.push(job?.name ?? '');
        }
    }
    const lines = [...byThing.values()].map(({ gap, jobs }) => {
        const [first] = bookingGapMessage({}, [gap]).split('\n').slice(1);
        return `${first}\n   holding up: ${jobs.join(', ')}`;
    });
    const count = entries.length;
    return [
        `Batch ${batchName}: ${count} job${count === 1 ? '' : 's'} cannot be completed until these are added:`,
        ...lines
    ].join('\n');
};

// The Item_ID a finished stock item goes by, in the form the godown already uses:
// SIDEPATTY_NW_REGULAR_RED_90_6X54, BOTTOMPATTY_NW_REGULAR_PINK_90_4_5X14.
export const stockItemName = (spec) => [spec.type, spec.material, spec.colour, spec.gsm, `${num(spec.w)}X${num(spec.h)}`]
    .map((part) => norm(part).replace(/\./g, '_').replace(/\s+/g, '_'))
    .join('_');

// Two CSVs the office imports into Grist to add what a batch is missing: codes
// first, then the stock items that reference them. Inventory_Item_Codes.Item_Code
// is a formula over the other columns, so the codes file carries only those; the
// items file names each code by that formula's text, which is what Grist matches a
// reference on when importing. Each code and item appears once, however many jobs
// wait on it, and a line whose size cannot be worked out has nothing to add.
export const bookingImportFiles = (entries) => {
    const codes = new Map();
    const items = new Map();
    for (const { gaps } of entries || []) {
        for (const g of gaps || []) {
            if (!g.spec || (g.missing !== 'code' && g.missing !== 'item')) continue;
            const s = g.spec;
            if (g.missing === 'code' && !codes.has(g.label)) {
                codes.set(g.label, [s.type, s.material, s.colour, String(s.gsm), String(num(s.w)), String(num(s.h))]);
            }
            if (!items.has(g.label)) items.set(g.label, [stockItemName(s), g.label]);
        }
    }
    return {
        codes: { headers: ['Type', 'Material', 'Colour', 'GSM', 'Width_Inches_', 'Height_Inches_'], rows: [...codes.values()] },
        items: { headers: ['Item_ID', 'Item_Code'], rows: [...items.values()] }
    };
};
