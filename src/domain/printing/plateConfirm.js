// The second "are you sure" before anything on the Printing Plates page is
// written (user, 6 Nov 2026). A tap on the floor is easy to make on the wrong
// row, and a plate marked discarded stops being offered for repeat orders, so
// each write first says, in words, which plate and what changes.
//
// Returns { heading, subject, lines, confirmLabel, danger }: the question, the
// plate or order it is about, what will change, the button that writes, and
// whether the change takes a plate out of use.

import { ACTIONS, STATUS, isRetired } from './printingPlates.js';
import { rackCode } from './rackCodes.js';
import { designText } from './plateTable.js';

const norm = (v) => String(v ?? '').trim().toUpperCase();
const size = (w, h) => (w && h ? `${w}x${h}` : '');

const nameOf = (plate) => plate?.rackCode || plate?.plateNo || 'this plate';
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
    const name = nameOf(plate);
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
    const { plate, fits } = chosen;
    const lines = [
        'Old plate available: YES',
        `Reuse ${nameOf(plate)} · ${designText(plate)}${size(plate.bagW, plate.bagH) ? ` · made for ${size(plate.bagW, plate.bagH)}` : ''}`
    ];
    if (fits === false) lines.push('This plate was made for a bigger bag than this order.');
    return {
        heading: `Reuse ${nameOf(plate)} for ${so?.shop || 'this order'}?`,
        subject: order,
        lines,
        confirmLabel: 'Yes, reuse it',
        danger: false
    };
};
