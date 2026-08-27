// The printing list for a ROLLS TO SHEETS batch.
//
// One row per sub-order, in the terms the printing floor works in: whose order it
// is, where it goes, what the bag and its side patty are, and how many sheets to
// print. Deliberately not the production plan -- that is the job sheet, and it is
// grouped by size and roll. This is the customer-facing list, and its unit is the
// bag rather than the kilo.
//
// Sheets only. A DCUT run turns out finished bags and has no sheet to print, so
// exporting one for it would be an empty promise.

import { choiceText } from './gristValues';

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

export const PRINTING_LIST_TYPE = 'ROLLS TO SHEETS';
export const isPrintingListType = (type) => norm(type) === PRINTING_LIST_TYPE;

// Two sheets to a bag: a front and a back.
export const SHEETS_PER_BAG = 2;

// How many bags the order is for.
//
// A sheets order is quoted in pieces, and a piece is a bag -- so the quantity IS
// the bag count. An order quoted by weight names no number of bags, and inventing
// one from geometry would put a derived figure in a column the printer reads as
// fact, so it is left blank.
export const bagCount = (so) => (norm(so?.qtyType) === 'PIECES' ? num(so.qty) : null);

export const sheetCount = (so) => {
    const bags = bagCount(so);
    return bags == null ? null : bags * SHEETS_PER_BAG;
};

const sizeText = (w, h) => {
    const a = String(w ?? '').trim();
    const b = String(h ?? '').trim();
    return a && b ? `${a} x ${b}` : a || b || '';
};

// The columns, in the order the printing floor reads them. Each is a pair of a
// heading and how to read it off a sub-order, so the two can never fall out of
// step the way parallel arrays do.
export const PRINTING_LIST_COLUMNS = [
    ['Order ID', (so) => so.orderId ?? ''],
    ['Sub-order ID', (so) => so.id],
    ['Factory Date', (so) => dateOf(so.factoryUpdatedDate)],
    ['Shop Name', (so) => so.shop ?? ''],
    ['City', cityOf],
    ['Bag Size', (so) => sizeText(so.bagW, so.bagH)],
    ['Bag GSM', (so) => so.bagGsm ?? ''],
    ['Bag Colour', (so) => choiceText(so.bagColour)],
    ['Sidepatty Width', (so) => so.sidepattyWidth ?? ''],
    ['Sidepatty Colour', (so) => choiceText(so.sidepattyColour)],
    ['Sidepatty GSM', (so) => so.sidepattyGsm ?? ''],
    ['Bag Count', (so) => bagCount(so) ?? ''],
    ['Sheet Size', (so) => so.sheetSize ?? ''],
    ['No of Sheets', (so) => sheetCount(so) ?? '']
];

export const PRINTING_LIST_HEADERS = PRINTING_LIST_COLUMNS.map(([head]) => head);

// Every sub-order in the batch, once. A batch splits its orders across jobs by
// roll and size, so the same sub-order can be reached by more than one path;
// listing it twice would have the floor print it twice.
export const printingListRows = (batch) => {
    const seen = new Map();
    for (const job of batch?.jobs || []) {
        for (const so of job.subOrders || []) {
            if (!seen.has(so.id)) seen.set(so.id, so);
        }
    }
    return [...seen.values()]
        // The order the floor works in: by customer, then by the bag being made,
        // so one shop's work sits together and one setup covers adjacent rows.
        .sort((a, b) => String(a.shop ?? '').localeCompare(String(b.shop ?? ''))
            || String(a.sheetSize ?? '').localeCompare(String(b.sheetSize ?? ''))
            || num(a.id) - num(b.id))
        .map((so) => PRINTING_LIST_COLUMNS.map(([, read]) => read(so)));
};

export const printingListName = (batch) => {
    const label = String(batch?.name || 'batch').trim().replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '');
    return `printing-list_${label || 'batch'}.csv`;
};
