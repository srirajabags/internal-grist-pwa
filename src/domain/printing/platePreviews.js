// Pictures of a design's plates, made from its design files (user, 15 Nov 2026).
//
// "For both plates there would be two corresponding TIFF files in the design
// task records. Can we generate a preview image from the corresponding TIFF
// files which can be used to identify plates individually."
//
// A two-plate design's sub-order usually carries one file per plate -- the
// Telugu side and the English side of PL-06124 were 30547 and 30548. These
// rules pick the files, and say which plate each picture belongs to. The work
// of downloading, unpacking and drawing is scripts/plate-previews.mjs.

import { SIDES_TABLE } from './printingPlates.js';
import { positionOf, setNoText } from './plateSets.js';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const ext = (name) => (String(name || '').toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';

// Print files are what the plate was made from. A JPG or PNG beside them is
// usually a mock-up sent to the customer, so it counts only when there is
// nothing better.
const PRINT = ['tif', 'tiff', 'psd', 'psb'];
const PICTURE = ['jpg', 'jpeg', 'png'];
const ARCHIVE = ['rar', 'zip', '7z'];

export const fileKind = (name) => {
    const e = ext(name);
    if (PRINT.includes(e)) return 'print';
    if (PICTURE.includes(e)) return 'picture';
    if (ARCHIVE.includes(e)) return 'archive';
    return null;
};

// The artworks among a list of names: the print files if there are any,
// otherwise the pictures. Packed folders' junk (__MACOSX, ._x) is not artwork.
// Names sort as a person reads them, so "2" comes before "10".
export const artworksIn = (names) => {
    const clean = (names || []).filter((n) => !/(^|\/)(__MACOSX|\._)/.test(n) && !n.endsWith('/'));
    const print = clean.filter((n) => fileKind(n) === 'print');
    const list = print.length ? print : clean.filter((n) => fileKind(n) === 'picture');
    return [...list].sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' }));
};

// Where a sub-order's design files are, best first: the plate order (what the
// plate maker was sent), the designer's TIFF task, then a repeat order's old
// TIFF. Each source is a list of attachment ids in the order they were added.
// The same file attached twice is one artwork, not two (plate order
// [24780, 24780], 15 Nov 2026): each id counts once.
export const fileSources = ({ plateOrder = [], designerTask = [], oldTiff = [] } = {}) =>
    [plateOrder, designerTask, oldTiff].map((ids) => [...new Set((ids || []).map(num).filter(Boolean))]).filter((ids) => ids.length);

// The files of the first source that can give one artwork per plate, judged
// from names alone, before anything is downloaded. An archive holds at least
// one artwork, so a source with archives is a "maybe" the script settles by
// looking inside; it tries the next source if that does not come out right.
//
// `metaById` = { id: { fileName, fileSize } }. Returns the candidates in order,
// each { ids, needsLook }.
export const candidateFiles = (expected, sources, metaById) => {
    const out = [];
    for (const ids of sources || []) {
        const usable = ids.filter((id) => fileKind(metaById?.[id]?.fileName));
        const archives = usable.filter((id) => fileKind(metaById[id].fileName) === 'archive');
        const loose = artworksIn(usable.filter((id) => !archives.includes(id)).map((id) => metaById[id].fileName));
        // The loose files that count (print files over pictures), in the order added.
        const kept = usable.filter((id) => archives.includes(id) || loose.includes(metaById[id].fileName));
        const known = kept.length - archives.length;
        if (archives.length ? known + archives.length <= expected : known === expected) {
            out.push({ ids: kept, needsLook: archives.length > 0 });
        }
    }
    return out;
};

// One design's sides and the pictures made for them, in place order: what to
// write. Each side takes the picture of its place -- a damaged side and the new
// one made for it share it. Nothing is written unless there is one picture per
// place and a side at every place.
export const pictureActions = (set, pictureIds) => {
    const ids = (pictureIds || []).map(num).filter(Boolean);
    if (!set || !ids.length || ids.length !== set.expected) return [];
    const places = new Set(set.plates.map(positionOf));
    if (!ids.every((_, i) => places.has(i + 1))) return [];
    return set.plates.map((p) => ['UpdateRecord', SIDES_TABLE, num(p.id), { Picture: ['L', ids[positionOf(p) - 1]] }]);
};

// A design that no side has a picture or photo for yet. One-plate designs
// count too (user, 23 Nov 2026, PL-03018): the picture is how the godown tells
// a shop's designs apart in one slot, not only the two sides of one design.
export const needsPictures = (set) => (set?.expected || 0) >= 1
    && !(set?.plates || []).some((p) => (p.preview || []).length);

// The picture's file name in Grist: the plate it shows.
export const pictureName = (set, at) => `${setNoText(set)}-${at} picture.jpg`;
