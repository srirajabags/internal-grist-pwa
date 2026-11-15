// Where a completed production job's output goes: the printing area or the
// bags-godown shelf, and in which unit each half is booked.
//
// Moved out of ProductionJobsView so the rule can be tested. The completion form
// and the writer both call outputSplit, so what the operator is shown is exactly
// what is booked.

import { itemForm } from '../inventory/itemForms.js';
import { PIECES_PER_BUNDLE, primaryUnitFor, SHEET_FORMS } from '../inventory/txnDisplay.js';
import { PRINTING_AREA, BAGS_GODOWN } from '../inventory/godown.js';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const roundWeight = (v) => Math.round(num(v) * 1000) / 1000;

// What of one cut line goes to the printing area, in kg and in items.
//
// The orders' share of the cutting goes, and so does the whole of a model-number
// plate run. The run is set up for the plate's minimum (1,000 sheets, 1,100 with
// the overage) and all of it goes through the multi-colour machine to take the
// model design. Only then does it split: the orders' sheets go on to the customer's
// print, and the rest come back to the godown already printed (user, 12 Nov 2026).
//
// Job 945 (16x19, one F12 order of 440 sheets) booked the 660 extra sheets as
// plain white stock in the bags godown, because this used to be the orders' share
// alone. The F12 design was then printed on all 1,100 off the books.
//
// cutQty is cutOrderQty plus the plate run's extra and nothing else, so it is the
// right figure on every line: on a line with no model number the two are equal.
export const printingPlan = (g) => ({
    planned: roundWeight(num(g?.cutQty)),
    plannedCount: Math.ceil(num(g?.cutMade) - 1e-9)
});

// Book a movement in the unit the godown actually handles that form: sheets and
// patty are counted, rolls and finished bags are weighed. Writing both moves two
// balances for one movement, and writing the wrong one moves neither -- which is
// why bags-godown sheets read 0 kg against a real count.
export const quantityFields = ({ type, name, kg, count }) => {
    // A counted form is booked by count even when the count is zero: falling back
    // to a weight there would move a balance the godown does not keep for it.
    if (primaryUnitFor(type, name) === 'count') {
        return count == null ? { Weight_Kg_: roundWeight(kg) } : { Count_Bundles_: num(count) };
    }
    return { Weight_Kg_: roundWeight(kg) };
};

// Sheets are counted one at a time, so their count has to be a whole number. A
// bundle can be a fraction -- a pressing handle is never physically bundled, and
// 8,065 pieces really is 80.65 bundles -- so those keep two decimals.
export const roundCount = (type, v) =>
    (SHEET_FORMS.has(itemForm(type)) ? Math.round(num(v)) : Math.round(num(v) * 100) / 100);

// Count_Bundles_ stores the godown's own unit. A count the app planned in pieces
// has to be divided down to that unit before it is stored; a count already in
// sheets or bundles goes in as it is.
export const countDivisor = (outputType, unit) => {
    if (String(unit || '').trim().toLowerCase() !== 'pieces') return 1;
    return PIECES_PER_BUNDLE[itemForm(outputType)] || 1;
};

// How one produced output divides between the printing area and the shelf, in
// both units. Anything above `planned` is over-cutting and goes to the shelf.
export const outputSplit = (o) => {
    const output = num(o.weight);
    const planned = num(o.planned);
    const surplus = o.allToPrinting ? 0 : Math.max(0, output - planned);
    const printingQty = output - surplus;
    const count = num(o.count) / countDivisor(o.outputType, o.unit);
    const share = output > 0 ? printingQty / output : 1;
    // Split the count the way the weight split, then take the remainder as the
    // surplus so the two halves add back to exactly what was produced.
    const printingCount = roundCount(o.outputType, count * share);
    const halves = [
        { location: PRINTING_AREA, kg: printingQty, count: printingCount },
        ...(surplus > 0
            ? [{ location: BAGS_GODOWN, kg: surplus, count: roundCount(o.outputType, count - printingCount) }]
            : [])
    ];
    return halves
        .map((h) => ({ ...h, fields: quantityFields({ type: o.outputType, kg: h.kg, count: h.count }) }))
        // A half that rounds to nothing is not booked at all.
        .filter((h) => num(h.fields.Count_Bundles_) !== 0 || num(h.fields.Weight_Kg_) !== 0);
};
