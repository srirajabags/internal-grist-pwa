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
