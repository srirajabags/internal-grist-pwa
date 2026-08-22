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

export const attrText = (r) =>
    [r.mat, r.col, r.gsm && `${r.gsm} GSM`, r.w && `${r.w}"`].filter(Boolean).join(' · ') || '—';
