// Collecting a batch's raw stock: the LESS lines that take each assigned roll off
// its shelf, and which of them the books already hold.
import { splitStock, godownOf, godownForJob } from '../inventory/godown';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const roundWeight = (v) => Math.round(num(v) * 1000) / 1000;

// Collecting takes each assigned item off its own shelf, whole: a roll is never
// split at the godown, and Available_Weight_Kg_ is the sum of exactly these
// figures. One line per item, so every movement names the item it moved and the
// godown it left -- a single job-level line could do neither once a job draws on
// more than one item.
//
// `needKg` is what the job's work plan says it cuts, used only when there is no
// item to weigh.
export const collectionLines = (job, needKg, now) => {
    // Only the raw stock. Finished stock never sits on the production floor as
    // raw material -- it goes shelf-to-printing in one move, handled by its own
    // action, so mixing it in here would book it out twice.
    const assigned = job.invItemOptions || [];
    // A roll the plan names twice is still one roll on one shelf. Jobs 88 and 387
    // listed a roll twice and booked it out twice, leaving it at minus its weight.
    const seen = new Set();
    const items = splitStock(assigned).raw.filter((it) => !seen.has(it.id) && seen.add(it.id));
    // A job whose stock is entirely ready-made has nothing on the roll trip.
    // Falling through to the no-item line below booked a phantom LESS against
    // no item at all, in whichever godown the job type guessed.
    if (items.length === 0 && assigned.length > 0) return [];
    if (items.length === 0) {
        return [{
            fields: {
                Item_ID: null,
                Production_Job: job.id,
                Transaction_Type: 'LESS',
                Weight_Kg_: roundWeight(needKg),
                Location: godownForJob(job),
                Transaction_Time: now
            }
        }];
    }
    return items
        .map((item) => ({
            fields: {
                Item_ID: item.id,
                Production_Job: job.id,
                Transaction_Type: 'LESS',
                Weight_Kg_: item.kg != null ? num(item.kg) : roundWeight(needKg / items.length),
                Location: godownOf(item),
                Transaction_Time: now
            }
        }))
        .filter((r) => num(r.fields.Weight_Kg_) > 0);
};

// Which lines the books do not already hold. `booked` is every LESS already
// written against the batch's jobs, read from Grist just before the write, as
// { job, item, who, at }. A line whose job has already taken that item is not
// booked again; it comes back in `already` so the person can be told who took it.
//
// The button alone cannot decide this. It reflects the batch as this phone last
// loaded it, and on 18 Oct batch 81 was collected from two phones two minutes
// apart -- every roll booked out twice.
const lineKey = (jobId, itemId) => `${num(jobId)}:${num(itemId)}`;

export const uncollectedLines = (lines, booked = []) => {
    const taken = new Map();
    for (const b of booked) {
        const k = lineKey(b.job, b.item);
        if (!taken.has(k)) taken.set(k, b);
    }
    const toWrite = [];
    const already = [];
    for (const line of lines) {
        const hit = taken.get(lineKey(line.fields.Production_Job, line.fields.Item_ID));
        if (hit) already.push(hit);
        else toWrite.push(line);
    }
    return { toWrite, already };
};
