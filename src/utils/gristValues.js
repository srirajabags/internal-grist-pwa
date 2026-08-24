// Grist encodings that reach the app as text.
//
// A ChoiceList column arrives over SQL as a JSON array -- ["IVORY"] -- and over
// the records API as ["L", "IVORY"], while a plain Choice is a bare string. Every
// reader has to cope with all three, because a column's type can change under it:
// Sub_Orders.Bag_Colour became a ChoiceList so one sub-order can name several
// model numbers, and every place that read it as a string would otherwise print
// or match the raw JSON.
export const parseChoiceList = (value) => {
    if (value == null || value === '') return [];
    const clean = (list) => list
        .filter((x) => x !== 'L')          // the API's list marker, not a value
        .map((x) => String(x ?? '').trim())
        .filter(Boolean);
    if (Array.isArray(value)) return clean(value);
    const text = String(value).trim();
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return clean(parsed);
        } catch { /* not JSON after all; fall through to the bare value */ }
    }
    return text ? [text] : [];
};

// For display: "IVORY", or "M11 + K8" where several are chosen.
export const choiceText = (value, separator = ' + ') => parseChoiceList(value).join(separator);

// For anything that can only take one -- a colour swatch, a single-choice column.
export const firstChoice = (value) => parseChoiceList(value)[0] || '';
