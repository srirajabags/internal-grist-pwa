import React, { useState } from 'react';
import { X, Loader2, AlertCircle, Plus, Minus, Clock } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { typeName } from '../utils/itemForms';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const TXN_TABLE = 'Inventory_Transactions';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);

// Book stock in or out against one physical item. Everything but the weight comes
// from the row, so there is nothing to mistype: the item, its godown and the
// direction are fixed by where the operator clicked.
//
// Incharge_Ack is deliberately left unset, so the transaction does not count
// towards stock until the incharge signs it off in the acknowledgement queue --
// the same path every other movement the app books goes through.
const StockAdjustModal = ({ row, mode: initialMode, available, onClose, onSaved, getHeaders, getUrl, allowModeSwitch = false }) => {
    // Opened from a row's + / - the direction is already decided; opened from a
    // scan there is nothing to decide it, so the operator picks here.
    const [mode, setMode] = useState(initialMode || 'ADD');
    const [qty, setQty] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const isAdd = mode === 'ADD';
    const weight = num(qty);
    const after = isAdd ? num(available) + weight : num(available) - weight;
    const valid = weight > 0 && !saving;

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${TXN_TABLE}/records`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    records: [{
                        fields: {
                            // Item_Code is a formula off Item_ID, so only the
                            // physical item is set here.
                            Item_ID: num(row.item_ref),
                            Transaction_Type: mode,
                            Weight_Kg_: weight,
                            Location: row.location,
                            Transaction_Time: Date.now() / 1000
                        }
                    }]
                })
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Could not save: ${res.statusText}${text ? ` - ${text}` : ''}`);
            }
            onSaved?.();
        } catch (err) {
            setError(err.message || String(err));
            setSaving(false);
        }
    };

    const attrs = [row.mat, row.col, row.gsm && `${row.gsm} GSM`, row.w && `${row.w}"`].filter(Boolean).join(' · ');

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-sm sm:rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${isAdd ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                            {isAdd ? <Plus size={18} /> : <Minus size={18} />}
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">
                                {isAdd ? 'Add stock' : 'Reduce stock'}
                            </h2>
                            <p className="text-xs text-slate-500 truncate">{row.iid || `Item #${row.item_ref}`}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="p-4 space-y-3">
                    {allowModeSwitch && (
                        <div className="grid grid-cols-2 gap-2">
                            {['ADD', 'LESS'].map((m) => {
                                const on = mode === m;
                                const adding = m === 'ADD';
                                return (
                                    <button
                                        key={m}
                                        type="button"
                                        onClick={() => setMode(m)}
                                        className={`inline-flex items-center justify-center gap-1.5 py-2 rounded-xl border text-sm font-semibold transition-colors ${on
                                            ? adding
                                                ? 'bg-emerald-600 text-white border-emerald-600'
                                                : 'bg-rose-600 text-white border-rose-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'}`}
                                    >
                                        {adding ? <Plus size={15} /> : <Minus size={15} />}
                                        {adding ? 'Add stock' : 'Reduce stock'}
                                    </button>
                                );
                            })}
                        </div>
                    )}

                    <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5">
                        <div className="w-11 shrink-0">
                            <ItemVisual colour={row.col} type={row.itype} name={row.name} size="sm" />
                        </div>
                        <div className="min-w-0">
                            <p className="text-sm font-semibold text-slate-800 truncate">{typeName(row.mat, row.itype, row.name)}</p>
                            <p className="text-[11px] text-slate-500 truncate">{attrs || '—'}</p>
                            <p className="text-[11px] text-slate-400">{row.location} · {fmtKg(available)} kg available</p>
                        </div>
                    </div>

                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="text-sm break-words">{error}</p>
                        </div>
                    )}

                    <label className="block">
                        <span className="block text-[11px] text-slate-500 mb-1">
                            Weight to {isAdd ? 'add' : 'remove'} (kg)
                        </span>
                        <input
                            type="number" inputMode="decimal" step="0.01" min="0"
                            value={qty} onChange={(e) => setQty(e.target.value)} autoFocus
                            onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }}
                            className={`w-full px-3 py-2.5 text-lg font-semibold border rounded-lg outline-none focus:ring-2 ${isAdd
                                ? 'border-emerald-300 focus:ring-emerald-500'
                                : 'border-rose-300 focus:ring-rose-500'}`}
                        />
                    </label>

                    {weight > 0 && (
                        <p className="text-xs text-slate-500">
                            Stock after this: <span className={`font-semibold ${after < 0 ? 'text-red-600' : 'text-slate-800'}`}>{fmtKg(after)} kg</span>
                            {after < 0 && <span className="text-red-600"> — more than is on hand</span>}
                        </p>
                    )}

                    <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-start gap-1.5">
                        <Clock size={12} className="mt-0.5 shrink-0" />
                        Waits for the incharge to acknowledge it before it counts towards stock.
                    </p>
                </div>

                <div className="border-t border-slate-200 px-4 py-3 flex gap-2 justify-end">
                    <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
                    <Button
                        variant="primary"
                        className={isAdd ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}
                        onClick={submit}
                        disabled={!valid}
                        icon={saving ? Loader2 : isAdd ? Plus : Minus}
                    >
                        {saving ? 'Saving…' : isAdd ? 'Add' : 'Reduce'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default StockAdjustModal;
