// How many rows a column-flowing grid of equal tiles should use: as few as the
// width allows, and never more than `maxRows` -- past that the grid scrolls
// sideways. Before the width is known every tile is assumed to need its own
// column, which lands on the cap; the first measurement corrects it.
const tilesAcross = (width, itemWidth, gap) =>
    Math.max(1, Math.floor((Number(width) + gap) / (itemWidth + gap)) || 1);

export const wrapRows = ({ count, width, itemWidth, gap = 0, maxRows }) => {
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const cap = Math.max(1, Math.floor(Number(maxRows) || 1));
    if (n === 0) return 1;
    return Math.min(cap, Math.ceil(n / tilesAcross(width, itemWidth, gap)));
};

// Whether the tiles run past the width even at the row cap -- the only time a
// "swipe for more" hint is telling the truth. False until the width is measured,
// so the hint never flashes up and vanishes.
export const wrapOverflows = ({ count, width, itemWidth, gap = 0, maxRows }) => {
    if (!(Number(width) > 0)) return false;
    const n = Math.max(0, Math.floor(Number(count) || 0));
    const cap = Math.max(1, Math.floor(Number(maxRows) || 1));
    return n > cap * tilesAcross(width, itemWidth, gap);
};
