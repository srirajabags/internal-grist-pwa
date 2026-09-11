// How much of a job's orders the bags godown answers, and how much of each item
// is taken off the shelf to do it.
//
// Pulled out of the job page so it can be tested on its own. It is the piece that
// decides what an operator is sent to fetch and, by subtraction, what they are
// then asked to cut -- and it got that wrong for a month without anything failing
// loudly enough to notice. See readyStock.test.js.
import { readyDemand, readyKeyForStock, planShape } from './productionBatch';
import { splitStock } from '../inventory/godown';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const roundWeight = (v) => Math.round(num(v) * 1000) / 1000;

// How much of `available` to take when `want` is wanted. Rounded for the books,
// but never rounded UP past what is actually there: rounding to the gram lifted a
// 250-sheet holding of 5.393548 kg to 5.394, and dividing that back by the weight
// of one sheet asked the floor to fetch 251 of the 250 sheets on the shelf.
export const takeUpTo = (available, want) =>
    Math.min(roundWeight(Math.min(num(available), Math.max(num(want), 0))), num(available));

// The article a physical item belongs to, named the way the planner names it.
export const itemArticleKey = (item) =>
    readyKeyForStock({ width: item?.w, height: item?.h, colour: item?.colour, type: item?.type });

// What ready stock will answer this job's orders, article by article, whether it
// has been carried over yet or not. Two readers need the same answer and must not
// each work it out: the collection sheet, which says what to fetch, and the tick
// list, which says what is left to cut. A bundle counted in one and not the other
// is a bundle cut twice or not at all.
//
// Each article draws against its OWN line. A job's requirement is not fungible:
// 25 bundles of 6x54 side patty and 7 of 6x46 are different articles answering
// different orders, and a strip cut for one bag is eight inches short for another.
// Pooling them into one figure for the job let the first item the job happened to
// list soak up the whole requirement and empty its shelf.
//
// Stock already collected counts first, because it is a fact rather than a plan,
// and it comes off the requirement before anything still on the shelf is reckoned
// against what remains. Returns the draw per item (what to fetch) and per article
// (what not to cut), or null when the plan cannot name the articles -- which the
// callers read as "cannot say", never as "nothing".
export const readyDraw = (job) => {
    const items = splitStock(job?.invItemOptions).finished;
    if (items.length === 0) return { byItem: new Map(), byArticle: new Map() };
    const jobType = (job?.type || '').trim().toUpperCase();
    const rate = num(job?.overage) > 0 ? num(job.overage) : null;
    const left = readyDemand(jobType, (job?.subOrders || []).map(planShape), 'finished', rate);
    if (!left) return null;
    if (!items.every((it) => left.has(itemArticleKey(it)))) return null;
    const byItem = new Map();
    const byArticle = new Map();
    const draw = (item, kg) => {
        const k = itemArticleKey(item);
        left.set(k, num(left.get(k)) - kg);
        byItem.set(item.id, kg);
        byArticle.set(k, num(byArticle.get(k)) + kg);
    };
    for (const it of items) if (it.collectedKg != null) draw(it, num(it.collectedKg));
    for (const it of items) {
        if (it.collectedKg != null) continue;
        draw(it, takeUpTo(it.kg, left.get(itemArticleKey(it))));
    }
    return { byItem, byArticle };
};
