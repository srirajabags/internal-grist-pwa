// The two reads that tell a completion which item code and stock item each line
// books under.
//
// Kept beside the matcher's needs rather than inline in a view: job 2026-09-12 -
// ROLLS TO SIDEPATTY - 28 - 255 was refused because the completion form selected
// id, GSM and the sizes, then matched on type, material and colour too. Every row
// read those as blank, nothing matched, and every job with output was told its
// code was missing while the checks beside it -- selecting everything -- found
// nothing wrong. One column list, used by every lookup, is what stops that.

// Every column findOutputCode reads.
export const CODE_COLUMNS = ['id', 'Type', 'Material', 'Colour', 'GSM', 'Width_Inches_', 'Height_Inches_'];

const norm = (v) => String(v ?? '').trim().toUpperCase();

// The catalogue rows of the output types asked about. Null when there are none to
// ask about. Type is compared trimmed and upper-cased, as the matcher compares it.
export const codesQuery = (types) => {
    const wanted = [...new Set((types || []).map(norm).filter(Boolean))];
    if (wanted.length === 0) return null;
    return {
        sql: `SELECT ${CODE_COLUMNS.join(', ')} FROM Inventory_Item_Codes
              WHERE UPPER(TRIM(Type)) IN (${wanted.map(() => '?').join(',')})`,
        args: wanted
    };
};

// The stock items behind the codes found, oldest first, so a code with more than
// one item books onto the same one every time. Null when no code was found.
export const itemsQuery = (codeIds) => {
    const ids = [...new Set((codeIds || []).map(Number).filter((id) => Number.isInteger(id) && id > 0))];
    if (ids.length === 0) return null;
    return {
        sql: `SELECT id, Item_Code FROM Inventory_Items WHERE Item_Code IN (${ids.map(() => '?').join(',')}) ORDER BY id`,
        args: ids
    };
};
