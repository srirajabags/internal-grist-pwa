// The register as a table: the plate sheet the office kept by hand, with its
// columns -- shop and rack code, city, size, plates (single / two / four),
// stereo -- and the filters that narrow 5,000 rows to one rack or one shop.

import { KIND } from './rackCodes.js';
import { COMPANY_PLATE, isReusable, kindOfOrder } from './printingPlates.js';
import { REACHED_FACTORY } from './plateRegister.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

const COUNT_WORDS = { 1: 'SINGLE', 2: 'TWO', 3: 'THREE', 4: 'FOUR' };

// The PLATE column of the sheet. A stereo's row leaves it empty -- the stereo
// has its own column.
export const plateCountText = (plate) => {
    if (norm(plate?.plateType) === KIND.STEREO) return '';
    const n = num(plate?.plateCount) || 1;
    return COUNT_WORDS[n] || String(n);
};

// The STEREO column: how many in the set when more than one (a two-colour
// design has a stereo per colour), and its measured size or that nobody has
// measured it yet.
export const stereoText = (plate) => {
    if (norm(plate?.plateType) !== KIND.STEREO) return '';
    const n = num(plate?.plateCount);
    const size = String(plate?.stereoSize ?? '').trim() || 'size not taken';
    return n > 1 ? `${COUNT_WORDS[n] || n} · ${size}` : size;
};

// What a design is, in a few words: "Plate · 1 plate", "Digital · 2 plates",
// "Stereo · 2 stereos". The count is how many the design was made with. A
// stereo machine prints both sides of the bag at once, so a two-sided design
// needs a stereo per side; a plate prints one side and then the other, so a
// second plate means a second artwork (user, 5 Nov 2026).
export const designText = (plate) => {
    const n = num(plate?.plateCount);
    const many = (word) => (n ? ` · ${n} ${word}${n > 1 ? 's' : ''}` : '');
    if (norm(plate?.plateType) === COMPANY_PLATE) return `Model ${String(plate?.modelDesign || '').trim() || '?'} plate`;
    if (norm(plate?.plateType) === KIND.STEREO) return `Stereo${many('stereo')}`;
    return `${norm(plate?.plateType) === KIND.DIGITAL ? 'Digital' : 'Plate'}${many('plate')}`;
};

// Everything known about a design beyond what it is, in one line, leaving out
// what is not known -- a slot the office numbered but no order explains has
// none of it, and a plate is never measured for a stereo size.
export const plateDetails = (plate) => {
    const w = num(plate?.bagW);
    const h = num(plate?.bagH);
    const stereoSize = norm(plate?.plateType) === KIND.STEREO ? String(plate?.stereoSize ?? '').trim() : '';
    return [
        w && h ? `${w}x${h} bag` : '',
        stereoSize ? `stereo ${stereoSize}` : '',
        String(plate?.colours ?? '').trim(),
        String(plate?.bagModel ?? '').trim()
    ].filter(Boolean);
};

// Rack codes written on more than one customer's name: two shops cannot share a
// slot, so one of them is a slip to correct (45 of these in Nov 2026).
export const sharedCodes = (plates) => {
    const owners = new Map();
    for (const p of plates || []) {
        if (!p.rackCode) continue;
        if (!owners.has(p.rackCode)) owners.set(p.rackCode, new Set());
        owners.get(p.rackCode).add(num(p.customer));
    }
    return new Set([...owners].filter(([, set]) => set.size > 1).map(([code]) => code));
};

// The table's filters. Text matches the shop, city, rack code, plate number or
// the customer ID the office uses, ignoring case and the dash in a code, so
// "k1290" finds K-1290.
export const filterPlates = (plates, { text = '', status = '', kind = '', rack = '' } = {}) => {
    const squash = (v) => norm(v).replace(/[\s-]+/g, '');
    const q = squash(text);
    // A design (plateSets.js) matches a status when any of its plates is in it.
    const hasStatus = (p) => (p.plates ? p.plates.some((x) => norm(x.status) === status) : norm(p.status) === status);
    return (plates || []).filter((p) => (!status || hasStatus(p))
        && (!kind || norm(p.plateType) === kind)
        && (!rack || norm(p.rack) === rack)
        && (!q || [p.shop, p.city, p.rackCode, p.plateNo, p.customerNo, ...(p.plates || []).map((x) => x.plateNo)]
            .some((v) => squash(v).includes(q))));
};

// Sheet order: rack, then slot, unnumbered plates last on their rack, then shop.
export const sortForSheet = (plates) => [...(plates || [])].sort((a, b) => norm(a.rack).localeCompare(norm(b.rack))
    || (num(a.slot) || Infinity) - (num(b.slot) || Infinity)
    || String(a.shop ?? '').localeCompare(String(b.shop ?? ''))
    || num(a.id) - num(b.id));

// The godown's three sections, each with racks A to Z (user, 5 Nov 2026): the
// letter after the rack names the section -- K-12 plates, KS-12 stereos, KD-12
// digital.
export const SECTIONS = [
    { kind: KIND.PLATE, label: 'Plates', suffix: '' },
    { kind: KIND.DIGITAL, label: 'Digital Plates', suffix: 'D' },
    { kind: KIND.STEREO, label: 'Stereos', suffix: 'S' }
];

export const rackLabel = (rack, kind) => `${rack}${SECTIONS.find((s) => s.kind === kind)?.suffix ?? ''}`;

// One rack's plates as the checker meets them: slot by slot, each shop's slot
// holding all its designs. Plates with no slot number come last, by shop. The
// rack and section are part of a slot, so a shop search across racks (user,
// 23 Nov 2026) keeps its A-86 and K-86 apart.
export const slotsOfRack = (plates) => {
    const groups = new Map();
    for (const p of sortForSheet(plates)) {
        const place = `${norm(p.rack)}-${norm(p.plateType)}`;
        const key = num(p.slot) ? `${place}-slot-${num(p.slot)}-${num(p.customer)}` : `${place}-none-${num(p.customer)}`;
        if (!groups.has(key)) groups.set(key, { key, slot: num(p.slot) || null, rackCode: p.rackCode, shop: p.shop, customer: num(p.customer), plates: [] });
        groups.get(key).plates.push(p);
    }
    return [...groups.values()];
};

// A slot the office numbered on a shop's name that no order explains: when the
// customer's orders were plastic or BOPP plates, that is why -- those are always
// discarded after the run, never stored (user, 23 Nov 2026), so the register
// leaves them out and the slot holds an older plate (PL-06086, JK Fashions
// A-86, 23 Nov 2026: its one order was a PL HM plate). These are the customer's orders it left out for that reason,
// latest first -- what the card can say about the slot. `subOrders` are the
// customer's: { id, orderDate, material, plate, print, status, cancelled }.
export const leftOutOrders = (design, subOrders) => {
    if (num(design?.sourceSubOrder) || (design?.orders || []).length) return [];
    if (norm(design?.plateType) === KIND.STEREO) return [];
    return (subOrders || [])
        .filter((o) => norm(o.status) === REACHED_FACTORY && !o.cancelled)
        .filter((o) => {
            const kind = kindOfOrder(o);
            return kind && !isReusable({ material: o.material, plateType: kind });
        })
        .sort((a, b) => num(b.orderDate) - num(a.orderDate) || num(b.id) - num(a.id));
};

const MATERIAL_TEXT = { PLASTIC: 'Plastic', 'BOPP LAMINATED': 'BOPP laminated', 'NON-WOVEN': 'Non-woven' };

// A left-out order's material and plate type, as the card shows them.
export const leftOutText = (o) => [
    MATERIAL_TEXT[norm(o?.material)] || String(o?.material ?? '').trim(),
    kindOfOrder(o) === KIND.DIGITAL ? 'Digital plate' : 'Plate'
].filter(Boolean);

// The other bag sizes a design's plate printed, smallest first: one plate, made
// for the smallest bag, prints any bag at least its size, so a 12x14 plate also
// prints the order's 14x18 bags (PL-00114, 23 Nov 2026). `orders` are its
// sub-orders as the card reads them ({ bag_w, bag_h }). Sizes smaller x bigger.
export const otherBagSizes = (design, orders) => {
    const key = (w, h) => {
        const [a, b] = [num(w), num(h)].sort((x, y) => x - y);
        return a && b ? `${a}x${b}` : '';
    };
    const own = key(design?.bagW, design?.bagH);
    const sizes = new Map();
    for (const o of orders || []) {
        const k = key(o.bag_w, o.bag_h);
        if (k && k !== own) sizes.set(k, num(o.bag_w) * num(o.bag_h));
    }
    return [...sizes].sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0])).map(([k]) => k);
};
