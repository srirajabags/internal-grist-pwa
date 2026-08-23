// Roll labels carry the item id, but a scanner may hand back a URL that contains
// it, or the id with the # the UI shows in front of it. Pull the id out of
// whatever arrives so the lookup always sees a bare id.
const ROLL_ID = /ROLL[_-]\d{2}-\d{2}-\d{4}[_-]\d+/i;

export const readRollCode = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return '';
    const hit = text.match(ROLL_ID);
    if (hit) return hit[0].toUpperCase();
    // Not a roll-shaped id: hand back the bare token so an unknown label still
    // reaches the lookup and gets a proper "not found" rather than silence.
    return text.replace(/^#/, '').split(/[\s/?#]+/).pop().trim().toUpperCase();
};
