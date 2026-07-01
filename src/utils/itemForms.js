// Pure helpers for classifying factory item forms and colours.
// (Kept separate from itemVisuals.jsx so that file only exports components.)

export const COLOUR_MAP = {
    IVORY: '#FFFFF0', WHITE: '#FFFFFF', OFFWHITE: '#FAF9F6', 'OFF WHITE': '#FAF9F6',
    CREAM: '#FFFDD0', BEIGE: '#F5F5DC', BLACK: '#2b2f36', GREY: '#9ca3af', GRAY: '#9ca3af',
    SILVER: '#C0C0C0', RED: '#ef4444', MAROON: '#7f1d1d', PINK: '#ec4899',
    ORANGE: '#f97316', YELLOW: '#facc15', GOLD: '#D4AF37', GREEN: '#22c55e',
    'DARK GREEN': '#15803d', BLUE: '#3b82f6', 'SKY BLUE': '#7dd3fc', NAVY: '#1e3a8a',
    'NAVY BLUE': '#1e3a8a', PURPLE: '#a855f7', VIOLET: '#8b5cf6', BROWN: '#92400e',
    TAN: '#d2b48c', RANI: '#d6336c', FIRROZI: '#06b6d4', FIROZI: '#06b6d4',
    // Non-woven fabric shades added with the Inventory_Item_Codes expansion.
    'BISCUIT IVORY': '#E8D7AE', 'LEMON IVORY': '#F6F2C5', 'LEMON YELLOW': '#EDE03A',
    'GOLDEN YELLOW': '#F2B100', BREEZE: '#AEDDEC', 'DARK BREEZE': '#4F9DBC',
    'MAROON RED': '#7B1E22', 'PARROT GREEN': '#5DB82B', 'RELIANCE GREEN': '#2F9E44',
    'ROYAL BLUE': '#2C4FC4'
};

// Single-word colour names, used to fuzzy-match multi-word colour strings.
const COLOUR_WORDS = Object.keys(COLOUR_MAP).filter((k) => !k.includes(' '));

// Deterministic pleasant hex from an arbitrary string — gives each unrecognised
// colour a stable, distinct tint instead of a generic grey.
const hashColour = (name) => {
    let h = 0;
    for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
    const hue = h % 360;
    const sat = 58 + (h >> 9) % 22;   // 58–80%
    const lig = 60 + (h >> 17) % 14;  // 60–74%
    const s = sat / 100, l = lig / 100;
    const a = s * Math.min(l, 1 - l);
    const f = (n) => {
        const k = (n + hue / 30) % 12;
        const v = l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
        return Math.round(255 * v).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
};

// Resolve a colour name to a hex string. Falls back to a fuzzy word match
// (e.g. "ROYAL BLUE" → BLUE) and finally a stable hashed tint, never grey —
// except for empty/missing colours.
export const colourToCss = (name) => {
    const key = (name || '').toUpperCase().trim();
    if (!key) return '#cbd5e1';
    if (COLOUR_MAP[key]) return COLOUR_MAP[key];
    const word = COLOUR_WORDS.find((w) => new RegExp(`\\b${w}\\b`).test(key));
    if (word) {
        let base = COLOUR_MAP[word];
        if (/\bDARK\b/.test(key)) base = shade(base, -0.28);
        else if (/\bLIGHT\b/.test(key)) base = shade(base, 0.32);
        return base;
    }
    return hashColour(key);
};

// Lighten (amt > 0) or darken (amt < 0) a hex colour. Returns a hex string so
// the result can be re-shaded (used for stroke/accent tints of an item colour).
export const shade = (hex, amt) => {
    let c = String(hex).replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    if (isNaN(n)) return hex;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const adj = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    const toHex = (v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0');
    return `#${toHex(adj(r))}${toHex(adj(g))}${toHex(adj(b))}`;
};

export const materialLabel = (mat) => {
    const m = (mat || '').toUpperCase();
    if (m.includes('NON-WOVEN') || m.includes('NONWOVEN') || /\bNW\b/.test(m)) return 'Non-Woven';
    if (m.includes('PLASTIC') || m.includes('LDPE') || m.includes('BOPP') || m.includes('PP')) return 'Plastic';
    return mat || '';
};

// Identify the physical form from a Type / readable name string.
export const itemForm = (type, name) => {
    const s = `${type || ''} ${name || ''}`.toUpperCase();
    if (/HANDLE.*BAG|BAG.*HANDLE/.test(s)) return 'handlebag';
    if (/PRESSING.*HANDLE|HANDLE.*PRESSING/.test(s)) return 'pressinghandle';
    if (/HANDLE/.test(s)) return 'handle';
    if (/W.?CUT|VEST/.test(s)) return 'wcut';
    if (/D.?CUT/.test(s)) return 'dcut';
    if (/SIDE.?(PATTY|GUSSET)|SIDEPATTY/.test(s)) return 'sidepatty';
    if (/BOTTOM.?(PATTY|GUSSET)/.test(s)) return 'bottompatty';
    if (/SHEET/.test(s)) return 'sheet';
    if (/ROLL/.test(s)) return 'roll';
    if (/BAG/.test(s)) return 'dcut';
    return 'box';
};

export const FORM_LABEL = {
    roll: 'Roll', sheet: 'Sheet', dcut: 'D-Cut Bag', wcut: 'W-Cut Bag',
    sidepatty: 'Side Patty', bottompatty: 'Bottom Patty', handle: 'Handle',
    pressinghandle: 'Pressing Handle', handlebag: 'Handle Bag', box: 'Item'
};

export const typeName = (mat, type, name) =>
    [materialLabel(mat), FORM_LABEL[itemForm(type, name)]].filter(Boolean).join(' ') || 'Item';

// Split a job type like "ROLLS TO SHEETS" into raw-material and output parts.
export const splitJobType = (type) => {
    const s = (type || '').toUpperCase().trim();
    if (s.includes(' TO ')) {
        const [a, b] = s.split(' TO ');
        return { inRaw: a.trim(), outRaw: b.trim() };
    }
    return { inRaw: s, outRaw: '' };
};
