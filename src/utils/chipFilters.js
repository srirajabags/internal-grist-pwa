// Filtering by chips: the rules, kept apart from the component that draws them so
// hot reload still works and so they can be tested without rendering anything.

// Nothing chosen means everything -- what an untouched filter should do, rather
// than showing an empty list.
export const passes = (chosen, value) => chosen.length === 0 || chosen.includes(value);

// Toggle one value in a list-valued filter.
export const toggleIn = (setter) => (v) =>
    setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

// The distinct values a column actually takes across the rows, busiest first --
// the filter most likely to be wanted sits where the thumb already is. Taken from
// the rows on hand, so a chip can never come back empty.
export const optionsOf = (rows, read) => {
    const counts = new Map();
    for (const r of rows || []) {
        const v = read(r);
        if (v === null || v === undefined || v === '') continue;
        counts.set(v, (counts.get(v) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
        .map(([v]) => v);
};
