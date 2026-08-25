import React, { useState, useMemo } from 'react';
import { X, Search, AlertTriangle, Check, Wrench } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { num, fmtKg, attrText } from '../utils/txnDisplay';
import { canForceRoll, forcedRollColour } from '../utils/productionBatch';

// How a roll on the shelf differs from what the group asked for. This is the whole
// reason the group had no stock, so it is spelled out rather than implied: the
// operator is overruling the matcher and should see exactly what they are
// overruling it on. Colour is not listed, because a roll of the wrong colour is
// never offered in the first place.
const mismatches = (roll, attrs) => {
    const differs = (a, b) => {
        const x = String(a ?? '').trim().toUpperCase();
        const y = String(b ?? '').trim().toUpperCase();
        return x && y && x !== y;
    };
    const out = [];
    if (differs(roll.material, attrs.rollMaterial ?? attrs.material)) out.push(`${roll.material} not ${attrs.rollMaterial ?? attrs.material}`);
    if (differs(roll.gsm, attrs.rollGsm ?? attrs.gsm)) out.push(`${roll.gsm} GSM not ${attrs.rollGsm ?? attrs.gsm}`);
    const wantWidth = attrs.rollWidth ?? attrs.width;
    if (differs(roll.width, wantWidth)) out.push(`${roll.width}″ not ${wantWidth}″`);
    return out;
};

const Bar = ({ have, need }) => {
    const pct = need > 0 ? Math.min((have / need) * 100, 100) : 0;
    const enough = have >= need - 1e-6;
    return (
        <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
            <div
                className={`h-full rounded-full transition-all ${enough ? 'bg-emerald-500' : 'bg-amber-500'}`}
                style={{ width: `${pct}%` }}
            />
        </div>
    );
};

// Putting rolls on a group the planner could not stock. The decision is the
// operator's; this only makes it an informed one and hands the result back so the
// plan can be rebuilt and reviewed before anything is written.
const AssignRollModal = ({ group, batchType, rolls, assigned, onClose, onSave }) => {
    const [picked, setPicked] = useState(() => new Set((assigned || []).map(num)));
    const [q, setQ] = useState('');

    const toggle = (itemId) => setPicked((prev) => {
        const next = new Set(prev);
        if (next.has(itemId)) next.delete(itemId); else next.add(itemId);
        return next;
    });

    // Only rolls of the group's own colour can be offered: width, GSM and material
    // are all things the floor can work around, colour is not.
    const wantColour = forcedRollColour(group.attrs);
    const usable = useMemo(() => rolls.filter((r) => canForceRoll(r, group.attrs)), [rolls, group.attrs]);
    const hiddenByColour = rolls.length - usable.length;

    const listed = useMemo(() => {
        const needle = q.trim().toUpperCase();
        const scored = usable.map((r) => ({ ...r, gaps: mismatches(r, group.attrs) }));
        return scored
            .filter((r) => !needle || `${r.itemName} ${r.material} ${r.colour} ${r.gsm} ${r.width}`.toUpperCase().includes(needle))
            // Closest to what the group wanted first, then the heaviest -- a job
            // short of stock is usually looking for one roll that covers it.
            .sort((a, b) => a.gaps.length - b.gaps.length || num(b.availWeight) - num(a.availWeight));
    }, [usable, q, group.attrs]);

    const need = Math.max(num(group.requiredQty) - num(group.fulfilledQty), 0);
    const have = usable.filter((r) => picked.has(num(r.itemId))).reduce((s, r) => s + num(r.availWeight), 0);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2 shrink-0">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800 leading-tight text-sm flex items-center gap-1.5">
                            <Wrench size={15} className="text-amber-600 shrink-0" />
                            Assign a roll by hand
                        </h2>
                        <p className="text-[11px] text-slate-500 break-words mt-0.5">{batchType}</p>
                        <p className="text-[11px] text-slate-500 break-words">{attrText(group.attrs)}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="px-4 py-2.5 border-b border-slate-100 shrink-0 space-y-2">
                    <div className="flex items-baseline justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">
                            Still short <b className="text-slate-800 tabular-nums">{fmtKg(need)} kg</b>
                        </span>
                        <span className={`tabular-nums font-semibold ${have >= need - 1e-6 && picked.size > 0 ? 'text-emerald-700' : 'text-amber-700'}`}>
                            {fmtKg(have)} kg assigned
                        </span>
                    </div>
                    <Bar have={have} need={need} />
                    {wantColour ? (
                        <p className="text-[11px] text-slate-500">
                            Showing <b className="text-slate-700">{wantColour}</b> rolls only — width, GSM and material
                            can be worked around on the floor, colour cannot.
                            {hiddenByColour > 0 ? ` ${hiddenByColour} roll${hiddenByColour === 1 ? '' : 's'} of other colours hidden.` : ''}
                        </p>
                    ) : null}
                    <label className="relative block">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Filter by roll id, material, width…"
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                </div>

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100">
                    {listed.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-10 px-6">
                            {rolls.length === 0
                                ? 'Every roll in the godown is already committed to a job in this run.'
                                : usable.length === 0
                                    ? `No uncommitted ${wantColour || ''} roll is left in the godown.`
                                    : 'No roll matches that filter.'}
                        </p>
                    )}
                    {listed.map((roll) => {
                        const on = picked.has(num(roll.itemId));
                        return (
                            <button
                                key={roll.itemId}
                                type="button"
                                onClick={() => toggle(num(roll.itemId))}
                                className={`w-full flex items-start gap-2.5 px-3 py-2.5 text-left transition-colors ${on ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                            >
                                <span className={`mt-0.5 w-4 h-4 rounded border shrink-0 flex items-center justify-center ${on ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300'}`}>
                                    {on && <Check size={12} strokeWidth={3} />}
                                </span>
                                <span className="w-8 shrink-0">
                                    <ItemVisual colour={roll.colour} type={roll.type} name={roll.name} size="sm" />
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="flex items-baseline justify-between gap-2">
                                        <span className="font-mono text-[12px] font-semibold text-slate-800 break-all">
                                            {roll.itemName || `#${roll.itemId}`}
                                        </span>
                                        <span className="text-[12px] font-semibold text-slate-700 tabular-nums shrink-0">
                                            {fmtKg(roll.availWeight)} kg
                                        </span>
                                    </span>
                                    <span className="block text-[11px] text-slate-500 break-words">
                                        {attrText({ mat: roll.material, col: roll.colour, gsm: roll.gsm, w: roll.width, h: roll.height })}
                                    </span>
                                    {roll.gaps.length > 0 && (
                                        <span className="mt-1 inline-flex items-start gap-1 text-[10px] text-amber-800 bg-amber-50 rounded px-1.5 py-0.5">
                                            <AlertTriangle size={10} className="shrink-0 mt-px" />
                                            <span>{roll.gaps.join(' · ')}</span>
                                        </span>
                                    )}
                                </span>
                            </button>
                        );
                    })}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 space-y-2">
                    {picked.size > 0 && have < need - 1e-6 && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5">
                            This still leaves {fmtKg(need - have)} kg uncovered — some sub-orders will stay postponed.
                        </p>
                    )}
                    <p className="text-[11px] text-slate-400">
                        A roll goes on whole. Whatever the job does not use comes back when it is closed.
                    </p>
                    <div className="flex items-center gap-2">
                        <span className="text-[11px] text-slate-500 flex-1 min-w-0">
                            {picked.size} roll{picked.size === 1 ? '' : 's'} selected
                        </span>
                        <Button variant="ghost" onClick={onClose}>Cancel</Button>
                        <Button
                            variant="primary"
                            onClick={() => onSave([...picked])}
                            className="bg-teal-600 hover:bg-teal-700"
                        >
                            Revise plan
                        </Button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default AssignRollModal;
