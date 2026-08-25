import React, { useMemo, useState } from 'react';
import { X, Search, Plus, Minus } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { num, fmtKg, attrText } from '../utils/txnDisplay';

// One item code covers many physical rolls, so booking stock against a code is
// not a question the system can answer -- only the person holding the roll knows
// which one it is. Picking from the by-code list asks them.
const RollPickerModal = ({ code, mode, options, onClose, onPick }) => {
    const [q, setQ] = useState('');
    const isAdd = mode !== 'LESS';

    const rolls = useMemo(() => {
        const needle = q.trim().toUpperCase();
        return options
            .filter((r) => !needle || String(r.iid || '').toUpperCase().includes(needle))
            // Something on the shelf first, then by id so the list reads in order.
            .sort((a, b) => (num(b.avail) > 0) - (num(a.avail) > 0)
                || String(a.iid || '').localeCompare(String(b.iid || '')));
    }, [options, q]);

    const withStock = options.filter((r) => num(r.avail) > 0).length;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-10 shrink-0">
                            <ItemVisual colour={code.col} type={code.itype} name={code.name} size="sm" />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight text-sm">
                                Which roll are you {isAdd ? 'adding to' : 'reducing'}?
                            </h2>
                            <p className="text-[11px] text-slate-500 break-words">
                                {attrText({ mat: code.mat, col: code.col, gsm: code.gsm, w: code.w, h: code.h })}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="px-4 py-2.5 border-b border-slate-100 shrink-0">
                    <label className="relative block">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Type part of the roll id"
                            className="w-full pl-8 pr-3 py-2 border border-slate-300 rounded-lg font-mono text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                    <p className="text-[11px] text-slate-400 mt-1.5">
                        {options.length} roll{options.length === 1 ? '' : 's'} under this code
                        {withStock < options.length ? ` · ${withStock} with stock on the shelf` : ''}
                    </p>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {rolls.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-8">No roll id matches that.</p>
                    )}
                    {rolls.map((roll) => {
                        const empty = num(roll.avail) <= 0;
                        return (
                            <button
                                key={roll.item_ref}
                                type="button"
                                onClick={() => onPick(roll)}
                                className="w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left hover:bg-slate-50"
                            >
                                <span className="font-mono text-[12px] font-semibold text-slate-800 break-all min-w-0">
                                    {roll.iid}
                                </span>
                                <span className="shrink-0 text-right">
                                    <span className={`block text-[12px] font-semibold tabular-nums ${empty ? 'text-slate-400' : 'text-slate-700'}`}>
                                        {fmtKg(roll.avail)} kg
                                    </span>
                                    {empty && <span className="block text-[10px] text-slate-400">nothing left</span>}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 flex items-center gap-2">
                    <span className="flex items-center gap-1.5 text-[11px] text-slate-400 flex-1 min-w-0">
                        {isAdd ? <Plus size={13} /> : <Minus size={13} />}
                        {isAdd ? 'Weight goes onto the roll you pick.' : 'Weight comes off the roll you pick.'}
                    </span>
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                </div>
            </div>
        </div>
    );
};

export default RollPickerModal;
