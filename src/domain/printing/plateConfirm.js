// The second "are you sure" before anything on the Printing Plates page is
// written (user, 6 Nov 2026). A tap on the floor is easy to make on the wrong
// row, and a plate marked discarded stops being offered for repeat orders, so
// each write first says, in words, which plate and what changes.
//
// Returns { heading, subject, lines, confirmLabel, danger }: the question, the
// plate or order it is about, what will change, the button that writes, and
// whether the change takes a plate out of use.

import { ACTIONS, STATUS, isRetired, isPlateLevel } from './printingPlates.js';
import { rackCode } from './rackCodes.js';
import { designText } from './plateTable.js';
import { plateLabel, positionText } from './plateSets.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const size = (w, h) => (w && h ? `${w}x${h}` : '');

// Which plate of a set it is goes in the name: A-284 holds both plates of a
// two-plate design, and a tap on the wrong one is exactly what this guards.
const nameOf = (plate) => (plate ? plateLabel(plate) : 'this plate');
const subjectOf = (plate) => [designText(plate), plate?.shop].filter(Boolean).join(' · ');

const WORDING = {
    VERIFIED: (n) => [`Mark ${n} as found?`, 'Yes, found it'],
    MOVED: (n, to) => [`Move ${n} to ${to}?`, 'Yes, move it'],
    NOT_FOUND: (n) => [`Mark ${n} as not found?`, 'Yes, not found'],
    DAMAGED: (n) => [`Mark ${n} as damaged?`, 'Yes, damaged'],
    DISCARDED: (n) => [`Discard ${n}?`, 'Yes, discard it']
};

export const confirmPlateAction = (plate, action, { rack, slot, stereoSize } = {}) => {
    const rule = ACTIONS[action];
    const words = WORDING[action];
    if (!rule || !words) throw new Error(`No confirmation for ${action}.`);
    // A move is the whole plate's, so it is named by its slot alone.
    const name = isPlateLevel(action) ? (plate?.rackCode || plate?.plateNo || 'this plate') : nameOf(plate);
    const to = rule.needsPlace
        ? rackCode({ rack: norm(rack), kind: plate?.plateType, slot: String(slot ?? '').trim() })
        : '';
    const [heading, confirmLabel] = words(name, to);
    const from = norm(plate?.status) || 'unknown';
    const lines = [from === rule.to ? `Stays ${rule.to}` : `${from} → ${rule.to}`];
    if (rule.needsPlace) lines.push(`Place: ${plate?.rackCode || 'none'} → ${to}`);
    if (String(stereoSize ?? '').trim()) lines.push(`Stereo size: ${String(stereoSize).trim()}`);
    const danger = isRetired({ status: rule.to });
    if (danger) lines.push('It will no longer be offered for printing jobs or repeat orders.');
    if (rule.to === STATUS.NOT_FOUND) lines.push('It stays listed as missing until someone finds it.');
    return { heading, subject: subjectOf(plate), lines, confirmLabel, danger };
};

// A repeat order's answer: reuse this plate, or there is no old plate.
// `chosen` is { plate, fits } from the shortlist, or null for "no old plate".
export const confirmRepeatAnswer = (so, chosen) => {
    const order = [so?.orderId, so?.shop, size(so?.bagW, so?.bagH) && `bag ${size(so.bagW, so.bagH)}`]
        .filter(Boolean).join(' · ');
    if (!chosen) {
        return {
            heading: `No old plate for ${so?.shop || 'this order'}?`,
            subject: order,
            lines: ['Old plate available: NO', 'A new plate will be made for this order.'],
            confirmLabel: 'Yes, no old plate',
            danger: false
        };
    }
    const { plate, gaps = [] } = chosen;
    const code = plate?.rackCode || plate?.plateNo || 'this plate';
    const lines = [
        'Old plate available: YES',
        `Reuse ${code} · ${designText(plate)}${size(plate.bagW, plate.bagH) ? ` · made for ${size(plate.bagW, plate.bagH)}` : ''}`
    ];
    // Each bag size has its own plate (user, 23 Nov 2026): warn about any other size.
    const sizeKey = (w, h) => [Number(w) || 0, Number(h) || 0].sort((a, b) => a - b).join('x');
    if (size(plate.bagW, plate.bagH) && size(so?.bagW, so?.bagH) && sizeKey(plate.bagW, plate.bagH) !== sizeKey(so.bagW, so.bagH)) {
        lines.push(`This plate was made for a ${size(plate.bagW, plate.bagH)} bag, not this order's ${size(so.bagW, so.bagH)} — each size has its own plate.`);
    }
    // A design short of a plate runs short until its new plate is recorded.
    for (const g of gaps) lines.push(`${plateLabel(g.plate)} is ${norm(g.plate.status).toLowerCase()} — a new one is needed.`);
    return {
        heading: `Reuse ${code} for ${so?.shop || 'this order'}?`,
        subject: order,
        lines,
        confirmLabel: 'Yes, reuse it',
        danger: false
    };
};

// A new plate made for a damaged or discarded one of a set (plateSets.js).
export const confirmReplacement = (old) => ({
    heading: `Record a new plate for ${nameOf(old)}?`,
    subject: subjectOf(old),
    lines: [
        `A new plate goes in ${old?.rackCode || 'its slot'} as ${positionText(old) || 'the design\'s plate'}, made today, IN RACK.`,
        `${old?.plateNo || 'The old plate'} stays ${norm(old?.status) || 'retired'}.`
    ],
    confirmLabel: 'Yes, the new plate is here',
    danger: false
});

// A photo of a plate kept as its picture. Which plate of the set it shows is
// said in words, so a photo of plate 1 is not filed as plate 2.
export const confirmPhoto = (plate) => {
    return {
        heading: `Save this photo as the picture of ${nameOf(plate)}?`,
        subject: subjectOf(plate),
        lines: ['Everyone checking this plate will match it to this photo.'],
        confirmLabel: 'Save photo'
    };
};
