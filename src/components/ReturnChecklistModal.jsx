import React, { useMemo, useState } from 'react';
import { X, Warehouse, CheckCircle2, Circle, Loader2, AlertTriangle, Boxes } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { attrText } from '../utils/txnDisplay';
import { ROLLS_GODOWN, BAGS_GODOWN, godownOf, godownForJob, splitStock } from '../utils/godown';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);

const GODOWN_STYLE = {
    [ROLLS_GODOWN]: { icon: Warehouse, chip: 'bg-amber-100 text-amber-800', ring: 'ring-amber-200' },
    [BAGS_GODOWN]: { icon: Boxes, chip: 'bg-sky-100 text-sky-800', ring: 'ring-sky-200' }
};

// Every item the batch took out, ready to be walked back. A job with no recorded
// stock still gets a line so nothing goes missing silently.
const buildLines = (batch) => (batch?.jobs || []).flatMap((job) =>
    // Raw stock only: ready-made items never came to the floor, so there is
    // nothing of theirs to carry back.
    splitStock(job.invItemOptions).raw.map((item) => ({
        key: `${job.id}:${item.id}`,
        job, item,
        godown: godownOf(item),
        took: item.collectedKg != null ? num(item.collectedKg) : null,
        back: item.returnedKg != null ? num(item.returnedKg) : null,
        pending: !!item.returnPending
    }))
).concat(
    (batch?.jobs || [])
        .filter((job) => (job.invItemOptions || []).length === 0)
        .map((job) => ({ key: `${job.id}:none`, job, item: null, godown: godownForJob(job), took: null, back: null, pending: false }))
);

// The counterpart of the collection checklist, and the last step of a batch.
//
// The leftover roll was already booked back when each job finished — the roll was
// free from that moment, and the stock figure should say so. What has not
// happened yet is the handover: the incharge only acknowledges those transactions
// once the roll is physically in front of them. This is the floor team confirming
// they have carried it over, which closes the batch.
const ReturnChecklistModal = ({ batch, updating, onClose, onConfirm }) => {
    const lines = useMemo(() => buildLines(batch), [batch]);
    const [ticked, setTicked] = useState(() => new Set());

    const sections = useMemo(() => [ROLLS_GODOWN, BAGS_GODOWN]
        .map((godown) => ({ godown, lines: lines.filter((l) => l.godown === godown) }))
        .filter((s) => s.lines.length > 0), [lines]);

    const toggle = (key) => setTicked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const allTicked = lines.length > 0 && lines.every((l) => ticked.has(l.key));
    const tickAll = () => setTicked(allTicked ? new Set() : new Set(lines.map((l) => l.key)));

    const totalBack = lines.reduce((t, l) => t + num(l.back), 0);
    const anyUnrecorded = lines.some((l) => !l.item);
    const awaitingAck = lines.filter((l) => l.pending).length;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-teal-100 text-teal-700 flex items-center justify-center shrink-0">
                            <Warehouse size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">Hand over to the godown</h2>
                            <p className="text-xs text-slate-500">
                                {lines.length} item{lines.length === 1 ? '' : 's'}
                                {totalBack > 0 ? ` · ${fmtKg(totalBack)} kg booked back` : ''}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
                    <p className="text-xs font-semibold text-slate-600">{ticked.size} of {lines.length} handed over</p>
                    <button
                        onClick={tickAll}
                        disabled={lines.length === 0}
                        className="text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:text-slate-300"
                    >
                        {allTicked ? 'Clear all' : 'Tick all'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {lines.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-8">This batch has no stock to return.</p>
                    )}
                    {sections.map(({ godown, lines: sectionLines }) => {
                        const style = GODOWN_STYLE[godown];
                        const GodownIcon = style.icon;
                        const doneHere = sectionLines.filter((l) => ticked.has(l.key)).length;
                        return (
                            <section key={godown}>
                                <header className="flex items-center justify-between gap-2 mb-2 px-0.5">
                                    <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-lg text-[11px] font-bold tracking-wide ${style.chip}`}>
                                        <GodownIcon size={13} /> {godown}
                                    </span>
                                    <span className="text-[11px] font-semibold text-slate-500">{doneHere} / {sectionLines.length}</span>
                                </header>
                                <div className="space-y-2">
                                    {sectionLines.map((line) => {
                                        const on = ticked.has(line.key);
                                        return (
                                            <div
                                                key={line.key}
                                                className={`rounded-xl border p-3 ${on ? 'border-green-300 bg-green-50/60' : `border-slate-200 bg-white ring-1 ring-inset ${style.ring}`}`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <button
                                                        type="button"
                                                        onClick={() => toggle(line.key)}
                                                        className={`mt-0.5 shrink-0 ${on ? 'text-green-600' : 'text-slate-300'}`}
                                                        aria-label={on ? 'Mark not handed over' : 'Mark handed over'}
                                                    >
                                                        {on ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                                                    </button>
                                                    <span className="shrink-0 mt-0.5">
                                                        <ItemVisual
                                                            colour={line.item?.colour ?? line.job.colour}
                                                            type={line.item?.type ?? line.job.itemType}
                                                            name={line.item?.code ?? line.job.itemName}
                                                        />
                                                    </span>
                                                    <span className="min-w-0 flex-1">
                                                        {line.item ? (
                                                            <span className="block font-mono text-sm font-semibold text-slate-800 break-all">{line.item.itemId}</span>
                                                        ) : (
                                                            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                                                                <AlertTriangle size={14} className="shrink-0" /> No stock item recorded
                                                            </span>
                                                        )}
                                                        <span className="block text-[11px] text-slate-500 mt-0.5 break-words">
                                                            {line.item
                                                                ? attrText({ mat: line.item.material, col: line.item.colour, gsm: line.item.gsm, w: line.item.w, h: line.item.h })
                                                                : attrText({ mat: line.job.material, col: line.job.colour, gsm: line.job.gsm, w: line.job.width, h: line.job.height })}
                                                        </span>
                                                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-white mt-1.5 break-all">
                                                            {line.job.name || `Job #${line.job.id}`}
                                                        </span>
                                                    </span>
                                                </div>

                                                {line.item && (
                                                    <div className="flex items-center justify-between gap-2 mt-2.5 pt-2.5 border-t border-slate-100">
                                                        <span className="text-[11px] text-slate-500 min-w-0">
                                                            {line.took != null && <>{fmtKg(line.took)} kg taken out</>}
                                                            {line.took != null && line.back != null && ' · '}
                                                            {line.back != null && (
                                                                <span className="text-slate-700 font-semibold">{fmtKg(line.back)} kg going back</span>
                                                            )}
                                                            {line.back == null && line.took != null && <span className="text-slate-400"> · nothing left over</span>}
                                                        </span>
                                                        {line.pending && (
                                                            <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 whitespace-nowrap">
                                                                awaiting incharge
                                                            </span>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 space-y-2">
                    {anyUnrecorded && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                            Some jobs have no stock item recorded, so nothing can be credited back for them.
                        </p>
                    )}
                    {awaitingAck > 0 && (
                        <p className="text-[11px] text-slate-500 text-center">
                            These weights are already booked back. The incharge acknowledges them once the
                            stock is in front of them.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button variant="ghost" className="flex-1" onClick={onClose} disabled={updating}>Cancel</Button>
                        <Button
                            variant="primary"
                            className="flex-1"
                            disabled={!allTicked || updating}
                            icon={updating ? Loader2 : CheckCircle2}
                            onClick={() => onConfirm()}
                        >
                            {updating ? 'Closing…' : 'Mark Returned'}
                        </Button>
                    </div>
                    {!allTicked && lines.length > 0 && (
                        <p className="text-[11px] text-slate-400 text-center">Tick every item you have handed to the godown.</p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default ReturnChecklistModal;
