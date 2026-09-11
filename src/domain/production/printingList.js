// The printing list for a batch that prints.
//
// One row per sub-order, in the terms the printing floor works in: whose order it
// is, where it goes, what is being made, and how many to print. Deliberately not
// the production plan -- that is the job sheet, and it is grouped by size and
// roll. This is the customer-facing list, and its unit is the bag rather than the
// kilo.
//
// Two batch types print, and each gets its own columns:
//
//   ROLLS TO SHEETS  prints sheets, which are stitched into bags elsewhere. The
//                    bag it will become and the side patty that goes with it are
//                    on the same order, so they travel with the row.
//   ROLLS TO DCUT    prints the bag blank itself -- there is no sheet, and the
//                    batch mixes d-cut bags with handle-model ones, so the model
//                    is what tells the two apart.
//
// Nothing else prints, so nothing else gets a list.

import { choiceText } from '../../grist/gristValues';
import { withOverage, outputCount, planShape } from './productionBatch';

// The city the shop is in, as a name. The order carries a City too, but it is a
// reference to the Areas table -- a row id over the API, not something a printer
// can read -- so the name comes off the customer, where it is text.
const cityOf = (so) => so?.city ?? '';

// The date the office released it to the factory, as a plain date.
const dateOf = (v) => {
    if (v === null || v === undefined || v === '' || typeof v === 'object') return '';
    const d = new Date(Number(v) * 1000);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA');
};

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();

export const SHEETS_TYPE = 'ROLLS TO SHEETS';
export const DCUT_TYPE = 'ROLLS TO DCUT';

// Two sheets to a bag: a front and a back.
export const SHEETS_PER_BAG = 2;

// The overage the job was actually planned with, falling back to the configured
// rate for the type. Same rule the job page uses: a job stores its rate at
// creation so a later change to the config cannot re-price work already run, and a
// job created before that column existed reads as 0, which is not a rate anyone
// chose.
export const jobRate = (job) => (num(job?.overage) > 0 ? num(job.overage) : null);

// How many bags a SHEETS order makes -- the order, lifted by the overage.
//
// A sheets order is quoted in pieces, and a piece is a bag. The printer works to
// the number that will be cut, not the number the customer asked for, so the
// allowance belongs in this column rather than being left for someone to add in
// their head. Rounded up: a fraction of a bag cannot be printed, and rounding down
// would quietly under-serve the order.
//
// An order quoted by weight names no number of bags, and inventing one from
// geometry would put a derived figure in a column the printer reads as fact, so it
// is left blank. That costs nothing here -- every sheet order on the books is
// piece-quoted -- but see the d-cut count below, where the same rule would empty
// the column on every row.
export const bagCount = (so, rate) => {
    if (norm(so?.qtyType) !== 'PIECES') return null;
    const lifted = withOverage(SHEETS_TYPE, num(so.qty), rate);
    // The epsilon keeps floating-point noise from turning 550 into 551.
    return Math.ceil(lifted - 1e-9);
};

export const sheetCount = (so, rate) => {
    const bags = bagCount(so, rate);
    return bags == null ? null : bags * SHEETS_PER_BAG;
};

// How many blanks a DCUT order makes.
//
// A d-cut order is quoted by weight, so there is no bag count to read off it: it
// is backed out of the bag's flat cloth -- width x (both faces + the cutting
// allowance) x gsm -- and then lifted by the overage. That is `outputCount`, the
// very figure the job page puts under "to produce", so the list and the tick sheet
// cannot disagree.
//
// Deriving it is a departure from the sheets rule above, and a deliberate one:
// every d-cut order on the books is weight-quoted, so refusing would leave the
// column blank on every row, and a printing list with no quantity is not a list.
// The heading says approximate instead, so nobody counts finished stock against it
// to the piece. Blank when the geometry to derive it is missing.
export const dcutBagCount = (so, rate) => {
    const out = outputCount(DCUT_TYPE, planShape(so), rate);
    return out ? Math.ceil(out.count - 1e-9) : null;
};

// What the customer actually asked for, in their own unit -- the one figure on a
// d-cut row that is read rather than derived.
const orderedText = (so) => {
    if (so?.qty === null || so?.qty === undefined || so.qty === '') return '';
    return `${so.qty} ${norm(so.qtyType) === 'PIECES' ? 'pcs' : 'kg'}`;
};

const sizeText = (w, h) => {
    const a = String(w ?? '').trim();
    const b = String(h ?? '').trim();
    return a && b ? `${a} x ${b}` : a || b || '';
};

// The columns, in the order the printing floor reads them. Each is a pair of a
// heading and how to read it off a sub-order, so the two can never fall out of
// step the way parallel arrays do.
// Each reader takes the sub-order and the overage rate of the job that will cut
// it -- two jobs in one batch can carry different rates, so the rate travels with
// the row rather than being applied once to the whole sheet.
//
// Both lists open on the same five: whose order this is and where it goes.
const IDENTITY_COLUMNS = [
    ['Order ID', (so) => so.orderId ?? ''],
    ['Sub-order ID', (so) => so.id],
    ['Factory Date', (so) => dateOf(so.factoryUpdatedDate)],
    ['Shop Name', (so) => so.shop ?? ''],
    ['City', cityOf]
];

const SHEETS_COLUMNS = [
    ...IDENTITY_COLUMNS,
    ['Bag Size', (so) => sizeText(so.bagW, so.bagH)],
    ['Bag GSM', (so) => so.bagGsm ?? ''],
    ['Bag Colour', (so) => choiceText(so.bagColour)],
    ['Sidepatty Width', (so) => so.sidepattyWidth ?? ''],
    ['Sidepatty Colour', (so) => choiceText(so.sidepattyColour)],
    ['Sidepatty GSM', (so) => so.sidepattyGsm ?? ''],
    ['Bag Count (incl. overage)', (so, rate) => bagCount(so, rate) ?? ''],
    ['Sheet Size', (so) => so.sheetSize ?? ''],
    ['No of Sheets (incl. overage)', (so, rate) => sheetCount(so, rate) ?? '']
];

// No side patty here: a d-cut order leaves those cells empty, because the patty is
// ordered and cut as its own job. What a d-cut row needs instead is the model --
// one batch prints both plain d-cut bags and handle-model ones -- and the print
// setup, which is what the machine is dressed for.
//
// The setup takes three columns because no one of them implies the others: a
// double-colour order can still be a single plate, and neither the print nor the
// plate count names the ink. A plate count of zero is a real answer -- an
// unprinted bag needs no plate -- so it is written as 0, and only an order that
// never had the column filled in comes out blank.
const DCUT_COLUMNS = [
    ...IDENTITY_COLUMNS,
    ['Model', (so) => so.model ?? ''],
    ['Bag Size', (so) => sizeText(so.bagW, so.bagH)],
    ['Bag GSM', (so) => so.bagGsm ?? ''],
    ['Bag Colour', (so) => choiceText(so.bagColour)],
    ['Handle Colour', (so) => choiceText(so.handleColour)],
    ['Print', (so) => so.print ?? ''],
    ['Printing Colour', (so) => choiceText(so.printingColour)],
    ['Plate Count', (so) => so.plateCount ?? ''],
    ['Ordered', orderedText],
    ['Bag Count (approx., incl. overage)', (so, rate) => dcutBagCount(so, rate) ?? '']
];

const COLUMNS_BY_TYPE = {
    [SHEETS_TYPE]: SHEETS_COLUMNS,
    [DCUT_TYPE]: DCUT_COLUMNS
};

// After the customer, the rows sit in the order of the thing being made, so one
// setup covers adjacent rows: sheets by the sheet they are cut to, d-cut bags by
// model and then bag size -- and by size as a number, since 9 x 14 belongs after
// 12 x 14 on the floor even though it sorts before it as text.
const SECONDARY_SORT = {
    [SHEETS_TYPE]: (a, b) => String(a.sheetSize ?? '').localeCompare(String(b.sheetSize ?? '')),
    [DCUT_TYPE]: (a, b) => String(a.model ?? '').localeCompare(String(b.model ?? ''))
        || num(a.bagW) - num(b.bagW)
        || num(a.bagH) - num(b.bagH)
};

export const isPrintingListType = (type) => COLUMNS_BY_TYPE[norm(type)] != null;

const columnsFor = (batch) => COLUMNS_BY_TYPE[norm(batch?.type)] || [];

export const printingListHeaders = (batch) => columnsFor(batch).map(([head]) => head);

// Every sub-order in the batch, once. A batch splits its orders across jobs by
// roll and size, so the same sub-order can be reached by more than one path;
// listing it twice would have the floor print it twice.
export const printingListRows = (batch) => {
    const columns = columnsFor(batch);
    if (!columns.length) return [];
    const bySize = SECONDARY_SORT[norm(batch?.type)] || (() => 0);
    const seen = new Map();
    for (const job of batch?.jobs || []) {
        const rate = jobRate(job);
        for (const so of job.subOrders || []) {
            // Keyed by sub-order, carrying the rate of the job that will cut it.
            if (!seen.has(so.id)) seen.set(so.id, { so, rate });
        }
    }
    return [...seen.values()]
        .map(({ so, rate }) => ({ ...so, _rate: rate }))
        // The order the floor works in: by customer, then by what is being made,
        // so one shop's work sits together.
        .sort((a, b) => String(a.shop ?? '').localeCompare(String(b.shop ?? ''))
            || bySize(a, b)
            || num(a.id) - num(b.id))
        .map((so) => columns.map(([, read]) => read(so, so._rate)));
};

export const printingListName = (batch) => {
    const label = String(batch?.name || 'batch').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return `printing-list_${label || 'batch'}.csv`;
};
