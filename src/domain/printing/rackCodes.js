// Rack codes, as the office writes them at the end of a shop's name.
//
//   BHAVANI MENS WEAR TYPE-3 AFT K-1290        plate in rack K, slot 1290
//   Harsha Mens Wear - Type 3 (AFT) K 761 Kd 228   a plate, and a digital plate
//   Om Pavan Shopping Mall TYPE-1 AFT DS - 128  a stereo in rack D, slot 128
//
// A code is the rack letter, an optional kind letter and the slot number, with
// any spacing or dash between them. The kind letter matches the orders behind
// it (checked against every sub-order, Nov 2026): S on stereo orders, D mostly
// on multi-colour plate orders, none on ordinary plates.
//
// Codes are read from the END of the name and reading stops at the first word
// that is not one, so a number inside the shop's own name is never taken for a
// slot. The design markers that come before the codes -- AFT, TYPE-3, P30, PW7
// -- stop it too; P30 and its kin look like a rack-P code, so they are named.

export const KIND = { PLATE: 'PLATE', DIGITAL: 'DIGITAL', STEREO: 'STEREO' };

const KIND_BY_LETTER = { '': KIND.PLATE, D: KIND.DIGITAL, S: KIND.STEREO };
const LETTER_BY_KIND = { [KIND.PLATE]: '', [KIND.DIGITAL]: 'D', [KIND.STEREO]: 'S' };

// The design markers spelled like a code. Seen in shop names: P7, P10, P15, P20,
// P25, P30, P45 (PW7 cannot be read as a code, W being no kind letter).
const MARKERS = new Set(['P7', 'P10', 'P15', 'P20', 'P25', 'P30', 'P45']);

// One code at the very end of the text: a letter not inside a word, an
// optional S or D, then the number. Trailing dots, commas and brackets are
// tolerated.
// The letter may follow a digit, because codes are often written run together
// -- K223KD59, D64DD18 -- and the digit belongs to the code before it.
const AT_END = /(^|[^A-Za-z])([A-Za-z])\s*([SsDd])?\s*-?\s*(\d{1,5})[\s.,)]*$/;

export const rackCode = ({ rack, kind, slot }) => (rack && slot
    ? `${rack}${LETTER_BY_KIND[kind] ?? ''}-${slot}`
    : '');

export const parseRackCodes = (shopName) => {
    let text = String(shopName ?? '').trim();
    const codes = [];
    for (;;) {
        const m = AT_END.exec(text);
        if (!m) break;
        const rack = m[2].toUpperCase();
        const kindLetter = (m[3] || '').toUpperCase();
        const slot = Number(m[4]);
        if (!kindLetter && MARKERS.has(`${rack}${slot}`)) break;
        const kind = KIND_BY_LETTER[kindLetter];
        codes.unshift({ rack, kind, slot, code: rackCode({ rack, kind, slot }) });
        text = text.slice(0, m.index + m[1].length).trim();
    }
    return codes;
};
