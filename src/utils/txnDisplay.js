// Shared formatting for Inventory_Transactions rows, used by the history modal
// and the acknowledgement queue. Pure helpers only — no components — so both can
// import without upsetting fast refresh.
import { itemForm } from './itemForms';

export const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
export const fmtKg = (v) => num(v).toFixed(2);
export const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// Sheets are booked one at a time; patty and handles in bundles.
export const SHEET_FORMS = new Set(['sheet', 'bottompattysheet', 'modelsheet']);
export const countUnitFor = (type, name) => (SHEET_FORMS.has(itemForm(type, name)) ? 'sheets' : 'bundles');

export const PIECES_PER_BUNDLE = {
    sidepatty: 50, bottompatty: 50,
    manualhandle: 100, readymadehandle: 100, pressinghandle: 100
};

// One sheet/piece (kg) = W(in) * H(in) * GSM / (1550 * 1000), since 1550 in² = 1 m².
const PIECE_TO_KG_DIVISOR = 1550 * 1000;
export const pieceKg = ({ w, h, gsm }) => {
    const W = num(w), H = num(h), G = num(gsm);
    return (W && H && G) ? (W * H * G) / PIECE_TO_KG_DIVISOR : 0;   // 0 -> geometry missing
};

// kg implied by a counted quantity: sheets are a sheet count, patty and handles a
// bundle count. 0 when the geometry to convert is missing. Godown stock is often
// booked only as a count, so anything reasoning in kg has to come through here or
// it will read that stock as nothing at all.
export const countToKg = ({ w, h, gsm, type, name, count }) => {
    const per = pieceKg({ w, h, gsm });
    if (!per) return 0;
    const form = itemForm(type, name);
    if (SHEET_FORMS.has(form)) return num(count) * per;
    const ppb = PIECES_PER_BUNDLE[form];
    return ppb ? num(count) * ppb * per : 0;
};

// Transaction_Time is a DateTime stored as epoch seconds.
export const dayKey = (ts) => {
    const d = new Date(num(ts) * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// A transaction moves weight, a count, or both — show whichever it recorded.
export const changeText = (t, countUnit) => {
    const parts = [];
    if (num(t.wkg)) parts.push(`${num(t.wkg) > 0 ? '+' : '−'}${fmtKg(Math.abs(num(t.wkg)))} kg`);
    if (num(t.cbund)) parts.push(`${num(t.cbund) > 0 ? '+' : '−'}${Math.abs(num(t.cbund))} ${countUnit}`);
    return parts.join(' · ') || '—';
};

export const isOutward = (t) => num(t.wkg) < 0 || num(t.cbund) < 0;

// Colour per transaction type: stock arriving, stock leaving, stock first booked.
export const TYPE_TONE = {
    'ADD': { dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200 bg-emerald-50' },
    'NEW STOCK': { dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-200 bg-sky-50' },
    'LESS': { dot: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-200 bg-rose-50' }
};
export const toneFor = (type) => TYPE_TONE[String(type || '').toUpperCase()] || TYPE_TONE.ADD;

// Size as the item actually is: sheets and bags have a width and a height, rolls
// only a width. Showing the width alone turned a 12x17 sheet into `12"`.
export const sizeText = (r) => {
    const w = String(r?.w ?? '').trim();
    const h = String(r?.h ?? '').trim();
    if (w && h) return `${w}" × ${h}"`;
    return w ? `${w}"` : h ? `${h}"` : '';
};

export const attrText = (r) =>
    [r?.mat, r?.col, r?.gsm && `${r.gsm} GSM`, sizeText(r)].filter(Boolean).join(' · ') || '—';
