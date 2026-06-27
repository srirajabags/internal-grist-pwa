// Pure helpers for classifying factory item forms and colours.
// (Kept separate from itemVisuals.jsx so that file only exports components.)

export const COLOUR_MAP = {
    IVORY: '#FFFFF0', WHITE: '#FFFFFF', OFFWHITE: '#FAF9F6', 'OFF WHITE': '#FAF9F6',
    CREAM: '#FFFDD0', BEIGE: '#F5F5DC', BLACK: '#2b2f36', GREY: '#9ca3af', GRAY: '#9ca3af',
    SILVER: '#C0C0C0', RED: '#ef4444', MAROON: '#7f1d1d', PINK: '#ec4899',
    ORANGE: '#f97316', YELLOW: '#facc15', GOLD: '#D4AF37', GREEN: '#22c55e',
    'DARK GREEN': '#15803d', BLUE: '#3b82f6', 'SKY BLUE': '#7dd3fc', NAVY: '#1e3a8a',
    'NAVY BLUE': '#1e3a8a', PURPLE: '#a855f7', VIOLET: '#8b5cf6', BROWN: '#92400e',
    TAN: '#d2b48c', RANI: '#d6336c', FIRROZI: '#06b6d4', FIROZI: '#06b6d4'
};

export const colourToCss = (name) => COLOUR_MAP[(name || '').toUpperCase().trim()] || '#cbd5e1';

// Lighten (amt > 0) or darken (amt < 0) a hex colour. Returns an rgb() string.
export const shade = (hex, amt) => {
    let c = String(hex).replace('#', '');
    if (c.length === 3) c = c.split('').map((x) => x + x).join('');
    const n = parseInt(c, 16);
    if (isNaN(n)) return hex;
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    const adj = (v) => Math.round(amt >= 0 ? v + (255 - v) * amt : v * (1 + amt));
    return `rgb(${adj(r)}, ${adj(g)}, ${adj(b)})`;
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
    sidepatty: 'Side Patty', bottompatty: 'Bottom Patty', handle: 'Handle', box: 'Item'
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
