// Where a stock item physically lives.
//
// Inventory_Transactions.Location is a Choice of exactly these three, and it is
// not optional: a movement with no location tells the godown nothing about which
// shelf changed, and the by-location stock summaries the allocator reads simply
// do not see it.
export const ROLLS_GODOWN = 'ROLLS GODOWN';
export const BAGS_GODOWN = 'BAGS GODOWN';
export const PRINTING_AREA = 'PRINTING AREA';

const norm = (v) => String(v ?? '').trim().toUpperCase();

// The godown an item is in. Its own booked location leads; failing that, a roll
// lives with the rolls and everything else with the bags.
export const godownOf = (item) => {
    const loc = norm(item?.location);
    if (loc === ROLLS_GODOWN || loc === BAGS_GODOWN) return loc;
    return norm(item?.type) === 'ROLL' ? ROLLS_GODOWN : BAGS_GODOWN;
};

// Raw stock is cut on the machine; finished stock is already the article and only
// moves shelf-to-floor. They are collected differently, so everything that has to
// tell them apart uses this one test.
export const isRawStock = (item) => godownOf(item) === ROLLS_GODOWN;
export const splitStock = (items = []) => ({
    raw: items.filter(isRawStock),
    finished: items.filter((it) => !isRawStock(it))
});

// The godown a job draws from when its stock items are not recorded. The job's
// own item code decides if it has one; failing that the batch type does, since a
// ROLLS TO … job cuts a roll.
export const godownForJob = (job) => {
    if (job?.itemType) return godownOf({ type: job.itemType });
    return /^ROLLS TO /.test(norm(job?.type)) ? ROLLS_GODOWN : BAGS_GODOWN;
};

// A job with no roll to cut.
//
// Some sub-orders are answered entirely out of stock that already exists: the
// bags are on the shelf, and the whole "job" is a trip from the bags godown to
// the printing area. A record of it is still worth keeping -- the sub-orders have
// to be answered by something, and that trip is what answered them -- but there
// is no production in it. Nothing to start, nothing to complete, nothing for an
// operator to do at a machine.
//
// So it is latent: real enough to exist, not real enough to be counted as work.
// The stock it draws is still collected with the rest of the batch's finished
// stock, and that collection is what closes it out.
//
// Judged from the stock actually assigned rather than the job type, because a
// ROLLS TO DCUT job can be met entirely from ready-made DCUT bags -- the type
// says what it would have cut, not what it is going to. A job whose items cannot
// be read is treated as real: the failure mode of hiding work is worse than the
// failure mode of showing a job with nothing in it.
const knownKind = (item) => Boolean(item?.type || item?.location);

export const isLatentJob = (job) => {
    const items = job?.invItemOptions || [];
    if (items.length === 0 || !items.every(knownKind)) return false;
    return !items.some(isRawStock);
};

// A batch's jobs divided into the work and the paperwork.
export const splitJobs = (jobs = []) => ({
    real: (jobs || []).filter((j) => !isLatentJob(j)),
    latent: (jobs || []).filter(isLatentJob)
});
