// What a job actually moved, and what it turned that into.
//
// Read entirely from the transactions the job left behind, never from figures
// mirrored onto the job row -- a mirror can disagree with the ledger, and when it
// does there is no way to tell which is lying. The same three numbers appear on
// the job page and in the batch summary because both call this.

import { countToKg, countUnitFor } from './txnDisplay';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const round = (v) => Math.round(num(v) * 100) / 100;

// What one produced line weighs.
//
// Sheets and patty are booked by COUNT, with the weight column left at zero --
// that is how the godown keeps them. Summing the weight column alone therefore
// reports a sheet job as having produced nothing, and hands its entire roll to
// wastage. Where there is no booked weight, it is derived from the article's own
// geometry, the same conversion the stock views use.
export const lineKg = (line) => {
    const booked = num(line?.kg);
    if (booked > 0) return booked;
    return countToKg({
        w: line?.w, h: line?.h, gsm: line?.gsm,
        type: line?.type, name: line?.code, count: num(line?.cnt)
    });
};

// Roll taken out, less what came back, less what was made from it. Whatever is
// unaccounted for was consumed by the run.
//
// `collected` counts raw roll only: ready-made stock a job pulled off the shelf
// was never cut from, so charging it to wastage would invent a loss.
export const jobLedger = (job) => {
    const collected = round(num(job?.collectedKg) - num(job?.finishedTakenKg));
    // From the lines, so counted output is weighed rather than read as zero. The
    // column total is the fallback for a job whose lines did not come through.
    const lines = job?.outputLines || [];
    const produced = round(lines.length > 0
        ? lines.reduce((t, l) => t + lineKg(l), 0)
        : num(job?.producedKg));
    const returned = round(job?.returnedKg);
    return {
        collected,
        produced,
        returned,
        wastage: round(collected - produced - returned),
        // Nothing has been booked yet, so the row has nothing to say rather than
        // three zeroes that look like a finished job which produced nothing.
        empty: collected === 0 && produced === 0 && returned === 0
    };
};

// The size a produced line is stocked at. Finished goods carry it on the item
// code -- a 16x20 bag and a 14x18 bag are different codes -- so this is the code's
// own dimensions, not anything inferred from the order.
export const lineSize = (line) => {
    const w = String(line?.w ?? '').trim();
    const h = String(line?.h ?? '').trim();
    if (w && h) return `${w}″ × ${h}″`;
    return w ? `${w}″` : '';
};

// Match a produced line to the line of the plan it answers. Both carry the
// article's own dimensions -- the plan from the order, the transaction from the
// item code it was booked against -- so the size is the join.
const sizeKey = (w, h) => {
    const a = String(w ?? '').trim();
    const b = String(h ?? '').trim();
    return a && b ? `${Number(a)}X${Number(b)}` : a ? `${Number(a)}` : '';
};

// One row per article produced, whatever the job type's breakdown happens to be:
// sheet sizes for a sheet job, model and bag size for DCUT, the strip for patty.
// It needs no per-type rule because the item each line was booked against already
// carries that distinction -- which is exactly why output is booked per size.
//
// Several transactions land on one article (the printing-area share and the
// surplus to the bags godown are two rows), so they are summed back together and
// the split kept alongside.
// `plan` is jobWorkPlan(job); pass it to have each row carry what was asked for
// beside what was made. That comparison is the reason to look at a finished job at
// all -- a run can hit its total and still miss a size, because the sizes are cut
// in sequence from one roll and the last one cut absorbs whatever the earlier ones
// and the cutting waste left over.
export const outputBreakdown = (job, plan = null) => {
    const byItem = new Map();
    for (const line of job?.outputLines || []) {
        const key = String(line.item ?? line.code ?? '');
        if (!key) continue;
        if (!byItem.has(key)) {
            byItem.set(key, {
                key,
                item: line.item,
                code: line.code,
                type: line.type,
                w: line.w,
                h: line.h,
                gsm: line.gsm,
                size: lineSize(line),
                kg: 0,
                count: 0,
                byLocation: {}
            });
        }
        const row = byItem.get(key);
        row.kg += lineKg(line);
        row.count += num(line.cnt);
        const loc = line.loc || 'UNKNOWN';
        row.byLocation[loc] = round((row.byLocation[loc] || 0) + lineKg(line));
    }
    // What the plan asked of each size, keyed the same way.
    const wanted = new Map();
    for (const g of plan?.sizeGroups || []) {
        const key = g.sizeTag || sizeKey(g.dims?.w, g.dims?.h);
        if (!key) continue;
        const prev = wanted.get(key) || { count: 0, kg: 0 };
        wanted.set(key, {
            count: prev.count + Math.ceil(num(g.made) - 1e-9),
            kg: prev.kg + num(g.qty)
        });
    }

    return [...byItem.values()]
        .map((r) => {
            const want = wanted.get(sizeKey(r.w, r.h)) || null;
            // Compare in whatever unit the article is actually counted in: a sheet
            // job is short by sheets, a bag job by kilos.
            const byCount = r.count > 0 && num(want?.count) > 0;
            const made = byCount ? r.count : round(r.kg);
            const asked = want ? (byCount ? want.count : round(want.kg)) : null;
            return {
                ...r,
                kg: round(r.kg),
                count: round(r.count),
                // Named outright: "800 / 1100" says nothing on its own, and
                // sheets, bundles and kilos all appear in the same list.
                unit: byCount ? countUnitFor(r.type, r.code) : 'kg',
                made,
                asked,
                // Only a genuine shortfall, not rounding noise on a kilo figure.
                short: asked != null && asked - made > (byCount ? 0 : 0.005)
                    ? round(asked - made) : 0
            };
        })
        .sort((a, b) => b.short - a.short || b.kg - a.kg || String(a.size).localeCompare(String(b.size)));
};

// The batch's own totals: the jobs' figures added up, so the summary and the rows
// beneath it can never disagree.
export const batchLedger = (jobs = []) => (jobs || []).reduce((t, job) => {
    const l = jobLedger(job);
    return {
        collected: round(t.collected + l.collected),
        produced: round(t.produced + l.produced),
        returned: round(t.returned + l.returned),
        wastage: round(t.wastage + l.wastage)
    };
}, { collected: 0, produced: 0, returned: 0, wastage: 0 });
