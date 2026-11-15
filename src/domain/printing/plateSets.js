// A design and its physical plates (user, 12 and 15 Nov 2026).
//
// A two-plate design is two physical plates, and each one is checked, damaged
// and replaced on its own: one can crack while the other is fine. The register
// keeps one Printing_Plates row per design -- the office's plate sheet: rack
// code, shop, size, orders -- and one Plate_Sides row per physical plate or
// stereo, "with just the image as the identifier and the actions the godown
// team takes for each individual side" (user, 15 Nov 2026).
//
// In this code a "plate" is one side: its own id, status, picture and place
// (Side_No), carrying its design's facts (designId, rack, slot, customer, size,
// orders) so a plate in hand can be named and found. Sides of one design make
// a set; its key is the design's id. A damaged side stays, retired; the new
// one made for it takes the same place and names the one it replaces.

import { STATUS, isRetired, SIDES_TABLE, MOVEMENTS_TABLE } from './printingPlates.js';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim().toUpperCase();

export const setKey = (plate) => num(plate?.designId) || num(plate?.id);
export const positionOf = (plate) => num(plate?.plateInSet) || 1;
export const expectedCount = (plate) => Math.max(1, num(plate?.plateCount));

// "plate 2 of 2" -- blank for a design of one plate, where it says nothing.
export const positionText = (plate) => {
    const n = expectedCount(plate);
    if (n < 2) return '';
    const word = norm(plate?.plateType) === 'STEREO' ? 'stereo' : 'plate';
    return `${word} ${positionOf(plate)} of ${n}`;
};

// The design's number, PL-06124, as Printing_Plates.Plate_No writes it.
export const designNo = (designId) => `PL-${String(num(designId)).padStart(5, '0')}`;

// One side's number: the design's, then which side of several -- PL-06124-2 --
// and an R on a side made to replace one. Same rule as Plate_Sides.Plate_No in
// Grist (scripts/create-printing-tables.mjs) -- change both.
export const sideNo = (plate) => `${designNo(setKey(plate))}${expectedCount(plate) > 1 ? `-${positionOf(plate)}` : ''}${num(plate?.replaces) ? 'R' : ''}`;

// How a person names one plate out loud: its rack code and which of the set it
// is -- "A-284 · plate 2 of 2" -- so it is never mistaken for its partner.
export const plateLabel = (plate) => [
    plate?.rackCode || plate?.plateNo || `Plate ${num(plate?.id)}`,
    positionText(plate)
].filter(Boolean).join(' · ');

// Sides in set order: by place, and at each place the newest first, so a
// replacement sits above the side it replaced.
const bySetOrder = (a, b) => positionOf(a) - positionOf(b) || num(b.id) - num(a.id);

// The register's sides gathered into designs.
//
//   key        the design's id
//   plates     every side, retired ones included, in set order
//   live       the ones still kept
//   lead       the side that speaks for the design: its first live side, or its
//              first side at all when none is left
//   expected   how many plates the design needs
//   gaps       places with no live side -- one damaged or discarded and not yet
//              replaced -- each with the retired side last seen there
export const plateSets = (plates) => {
    const byKey = new Map();
    for (const p of plates || []) {
        const k = setKey(p);
        if (!byKey.has(k)) byKey.set(k, []);
        byKey.get(k).push(p);
    }
    return [...byKey].map(([key, rows]) => describeSet(key, rows));
};

export const describeSet = (key, rows) => {
    const plates = [...rows].sort(bySetOrder);
    const live = plates.filter((p) => !isRetired(p));
    const lead = live[0] || plates[0];
    const expected = Math.max(expectedCount(lead), ...plates.map(positionOf));
    const gaps = [];
    for (let at = 1; at <= expected; at++) {
        if (live.some((p) => positionOf(p) === at)) continue;
        // Only a place someone retired is a gap: a side never registered is
        // not invented.
        const gone = plates.find((p) => positionOf(p) === at);
        if (gone) gaps.push({ at, plate: gone });
    }
    return { key, plates, live, lead, expected, gaps };
};

// Every set a list of sides touches, from the whole register: given a batch's
// sides, the rest of each one's design.
export const setsOf = (some, all) => {
    const keys = new Set((some || []).map(setKey));
    return plateSets((all || []).filter((p) => keys.has(setKey(p))));
};

// The live sides of the design a side belongs to.
export const livePartners = (plate, all) => setsOf([plate], all)[0]?.live || [plate];

// One status for a design when its sides agree, or a count of each when they
// do not: [{ status, plates: [..] }], live sides only unless none is.
export const statusGroups = (set) => {
    const shown = set.live.length ? set.live : set.plates;
    const groups = new Map();
    for (const p of shown) {
        const s = norm(p.status);
        if (!groups.has(s)) groups.set(s, []);
        groups.get(s).push(p);
    }
    return [...groups].map(([status, list]) => ({ status, plates: list }));
};

// The design's status as one word, from its sides: what Printing_Plates.Status
// becomes once the sides carry the checks (user, 15 Nov 2026). Same rule as its
// Grist formula (scripts/create-printing-tables.mjs) -- change both.
//
// All retired: DISCARDED if every side was discarded, else DAMAGED. A place
// left empty (a side retired, none made for it): DAMAGED -- the design cannot
// print whole. Otherwise the least ready of the live sides.
// (Inside the function: printingPlates.js and this file import each other, so
// STATUS is not there yet while this module loads.)
export const designStatus = (set) => {
    const READINESS = [STATUS.NOT_FOUND, STATUS.UNVERIFIED, STATUS.ISSUED, STATUS.IN_RACK];
    if (!set?.plates?.length) return null;
    if (!set.live.length) return set.plates.every((p) => norm(p.status) === STATUS.DISCARDED) ? STATUS.DISCARDED : STATUS.DAMAGED;
    if (set.gaps.length) return STATUS.DAMAGED;
    const kept = new Set(set.live.map((p) => norm(p.status)));
    return READINESS.find((s) => kept.has(s)) || STATUS.IN_RACK;
};

// The day a design is next due to be remade: its first live side to expire.
// A replacement made later expires later, so the design's date is the earliest.
export const setExpiresOn = (set) => {
    const dates = set.live.map((p) => num(p.expiresOn)).filter(Boolean);
    return dates.length ? Math.min(...dates) : (num(set.lead?.expiresOn) || null);
};

// ---- a design's sides, as rows ----------------------------------------------------

// The Plate_Sides rows of a design: one per plate it was made with, in place
// order, each starting in the same state. `fields` are what they start with --
// Status, Made_On, Issued_To_Job, Verified.
export const sideRecords = (designId, count, fields = {}) => Array.from({ length: Math.max(1, num(count)) },
    (_, i) => ({ Design: num(designId), Side_No: i + 1, ...fields }));

// ---- a picture of each plate ------------------------------------------------------
//
// A picture of what is printed on the plate, made from its design file
// (scripts/plate-previews.mjs) or a photo the godown took. The person holding
// a plate matches it to a picture: nothing on a plate says "1" or "2", so its
// picture is what makes it side 1.
export const picturesOf = (plate) => (plate?.preview || []).map(num).filter(Boolean)
    .map((id) => ({ at: positionOf(plate), id }));

export const hasPicture = (plate) => picturesOf(plate).length > 0;

// Whether a design's sides can be told apart at all: one picture each, none
// shared.
export const platesTold = (set) => {
    const live = set?.live || [];
    if (live.length < 2) return true;
    const pics = live.map((p) => picturesOf(p));
    return pics.every((x) => x.length === 1) && new Set(pics.map((x) => x[0].id)).size === live.length;
};

// ---- a photo when there is no picture ---------------------------------------------
//
// "If there are no image available, give the godown team an option to take an
// image of the plate or stereo and upload it" (user, 15 Nov 2026). The photo is
// the side's picture.

// Which place the next photo shows, or 0 when the side has its picture.
export const photoPlace = (plate) => (hasPicture(plate) ? 0 : positionOf(plate));

// Offered for a side still kept, with nothing to show.
export const canTakePhoto = (plate) => Boolean(plate && !isRetired(plate) && photoPlace(plate));

// The side's picture once the photo is uploaded as attachment `attId`.
export const photoActions = (plate, attId) => [['UpdateRecord', SIDES_TABLE, num(plate.id), { Picture: ['L', num(attId)] }]];

// How a photo is named in Grist: the side it shows.
export const photoName = (plate) => `${sideNo(plate)} photo.jpg`;

// ---- a new plate for a damaged one -------------------------------------------------

const ownPicture = (plate) => picturesOf(plate)[0]?.id || null;

export const canReplace = (plate, set) => Boolean(isRetired(plate)
    && set?.gaps.some((g) => g.plate.id === plate.id));

// The new side's row: the damaged side's place in its design, made `today` (a
// Grist Date), and in the rack -- whoever records it has it in hand. Made from
// the same artwork, so it shows the same picture.
export const replacementRecord = (damaged, today) => ({
    Design: setKey(damaged),
    Side_No: positionOf(damaged),
    Replaces: num(damaged.id),
    ...(ownPicture(damaged) ? { Picture: ['L', ownPicture(damaged)] } : {}),
    Made_On: today,
    Status: STATUS.IN_RACK,
    Verified: true,
    Notes: `New plate for ${damaged.plateNo || sideNo(damaged)}`
});

// Two writes, since the movement must name the side's new row id: first the
// side, then (given its id) the movement that explains it.
export const replacementActions = (damaged, today) => [['AddRecord', SIDES_TABLE, null, replacementRecord(damaged, today)]];

export const replacementMovement = (newId, damaged, notes = '') => [
    ['AddRecord', MOVEMENTS_TABLE, null, {
        Plate: setKey(damaged),
        Side: num(newId),
        Action: 'ADDED',
        Status_After: STATUS.IN_RACK,
        Rack: norm(damaged.rack),
        Slot: num(damaged.slot) || null,
        Notes: [`Replaces ${damaged.plateNo || sideNo(damaged)} (${norm(damaged.status).toLowerCase()})`, notes]
            .filter(Boolean).join(' · ')
    }]
];

// ---- the register row for a design -------------------------------------------------

export const setNoText = (set) => designNo(set?.key);

// What the register table shows for a design: its facts read off its lead side,
// and its sides for what each is doing.
export const designRow = (set) => ({
    ...set.lead,
    id: set.key,
    plateNo: setNoText(set),
    plates: set.plates,
    set
});
