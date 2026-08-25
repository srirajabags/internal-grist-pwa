import React, { useMemo, useState } from 'react';
import { X, Package, CheckCircle2, Circle, Loader2, AlertTriangle, CheckSquare, Warehouse, Boxes } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { attrText } from '../utils/txnDisplay';
import { ROLLS_GODOWN, BAGS_GODOWN, godownOf, godownForJob, splitStock } from '../utils/godown';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);

const ROLLS = ROLLS_GODOWN;
const BAGS = BAGS_GODOWN;

const GODOWN_STYLE = {
    [ROLLS]: { icon: Warehouse, ring: 'ring-amber-200', chip: 'bg-amber-100 text-amber-800' },
    [BAGS]: { icon: Boxes, ring: 'ring-sky-200', chip: 'bg-sky-100 text-sky-800' }
};

// One tick per physical item the batch draws on. A job with no items recorded
// still gets a line: the stock assignment is written when the batch is created,
// and if that write was refused the crew must not be left with a silently empty
// list -- they collect against the job's spec instead.
const buildLines = (batch) => (batch?.jobs || []).flatMap((job) => {
    // Only the raw stock: ready-made items go shelf-to-printing under their own
    // action and never join the roll trip.
    const raw = splitStock(job.invItemOptions).raw;
    if (raw.length > 0) {
        return raw.map((item) => ({
            key: `${job.id}:${item.id}`,
            job, item, godown: godownOf(item), unrecorded: false
        }));
    }
    // A job with no stock recorded at all still needs a line, so nothing goes
    // missing silently. One that has only ready stock does not — that is not this
    // trip's business.
    if ((job.invItemOptions || []).length > 0) return [];
    return [{ key: `${job.id}:none`, job, item: null, godown: godownForJob(job), unrecorded: true }];
});

// Shown before "Mark Collected": the crew walks the godown ticking off what they
// actually have in hand, so a missing roll is found at the shelf rather than half
// way through a run.
const CollectionChecklistModal = ({
    batch, updating, onClose, onConfirm,
    // The finished-stock trip supplies its own lines, already carrying the amount
    // each item will be drawn down by, so the sheet shows exactly what is written.
    lines: givenLines, title = 'Collect the raw roll', note,
    emptyText = 'This batch has no jobs to collect for.'
}) => {
    const lines = useMemo(() => givenLines ?? buildLines(batch), [givenLines, batch]);
    const [ticked, setTicked] = useState(() => new Set());

    // Grouped by godown, because collecting is one trip per shelf.
    const sections = useMemo(() => [ROLLS, BAGS]
        .map((godown) => ({ godown, lines: lines.filter((l) => l.godown === godown) }))
        .filter((s) => s.lines.length > 0), [lines]);

    const toggle = (key) => setTicked((prev) => {
        const next = new Set(prev);
        if (next.has(key)) next.delete(key); else next.add(key);
        return next;
    });
    const allTicked = lines.length > 0 && lines.every((l) => ticked.has(l.key));
    const tickAll = () => setTicked(allTicked ? new Set() : new Set(lines.map((l) => l.key)));

    const anyUnrecorded = lines.some((l) => l.unrecorded);
    // A roll leaves the shelf whole, so the weight to carry is the roll's, not the
    // share of it this job plans to consume.
    const rollKg = lines
        .filter((l) => l.godown === ROLLS && l.take == null && l.item?.kg != null)
        .reduce((s, l) => s + num(l.item.kg), 0);
    const takeKg = lines.reduce((s, l) => s + num(l.take), 0);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-lg sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh] sm:max-h-[85vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                            <Package size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">{title}</h2>
                            <p className="text-xs text-slate-500">
                                {lines.length} item{lines.length === 1 ? '' : 's'}
                                {sections.length > 1 ? ` · ${sections.length} godowns` : ''}
                                {rollKg > 0 ? ` · ${fmtKg(rollKg)} kg of roll` : ''}
                                {takeKg > 0 ? ` · ${fmtKg(takeKg)} kg to pull` : ''}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="px-4 py-2 border-b border-slate-100 flex items-center justify-between gap-2 shrink-0">
                    <p className="text-xs font-semibold text-slate-600">{ticked.size} of {lines.length} collected</p>
                    <button
                        onClick={tickAll}
                        disabled={lines.length === 0}
                        className="inline-flex items-center gap-1.5 text-xs font-semibold text-teal-700 hover:text-teal-800 disabled:text-slate-300"
                    >
                        <CheckSquare size={14} /> {allTicked ? 'Clear all' : 'Tick all'}
                    </button>
                </div>

                <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {lines.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-8">{emptyText}</p>
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
                                    <span className="text-[11px] font-semibold text-slate-500">
                                        {doneHere} / {sectionLines.length}
                                    </span>
                                </header>

                                <div className="space-y-2">
                                    {sectionLines.map((line) => {
                                        const on = ticked.has(line.key);
                                        const { item, job } = line;
                                        const whole = godown === ROLLS && item?.kg != null;
                                        return (
                                            <label
                                                key={line.key}
                                                className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer select-none transition-colors ${on ? 'border-green-300 bg-green-50/60' : `border-slate-200 bg-white hover:bg-slate-50 ring-1 ring-inset ${style.ring}`
                                                    }`}
                                            >
                                                <input type="checkbox" checked={on} onChange={() => toggle(line.key)} className="sr-only" />
                                                <span className={`mt-0.5 shrink-0 ${on ? 'text-green-600' : 'text-slate-300'}`}>
                                                    {on ? <CheckCircle2 size={22} /> : <Circle size={22} />}
                                                </span>
                                                <span className="shrink-0 mt-0.5">
                                                    <ItemVisual
                                                        colour={item?.colour ?? job.colour}
                                                        type={item?.type ?? job.itemType}
                                                        name={item?.code ?? job.itemName}
                                                    />
                                                </span>
                                                <span className="min-w-0 flex-1">
                                                    {line.unrecorded ? (
                                                        <>
                                                            <span className="flex items-center gap-1.5 text-sm font-semibold text-amber-800">
                                                                <AlertTriangle size={14} className="shrink-0" /> No stock item recorded
                                                            </span>
                                                            <span className="block text-[11px] text-slate-500 mt-0.5">
                                                                Collect against the job&apos;s spec and check the item id by hand.
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <span className="block font-mono text-sm font-semibold text-slate-800 break-all">
                                                            {item.itemId}
                                                        </span>
                                                    )}
                                                    <span className="block text-[11px] text-slate-500 mt-0.5 break-words">
                                                        {item
                                                            ? attrText({ mat: item.material, col: item.colour, gsm: item.gsm, w: item.w, h: item.h })
                                                            : (attrText({ mat: job.material, col: job.colour, gsm: job.gsm, w: job.width, h: job.height }))}
                                                    </span>
                                                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1.5">
                                                        <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-white break-all">
                                                            {job.name || `Job #${job.id}`}
                                                        </span>
                                                        {line.take != null ? (
                                                            <span className="text-[10px] font-semibold text-slate-600">
                                                                Take {line.takeCount != null
                                                                    ? `${line.takeCount.toLocaleString('en-IN')} of ${num(item?.count).toLocaleString('en-IN')}`
                                                                    : `${fmtKg(line.take)} kg`}
                                                                <span className="font-normal text-slate-400"> · {fmtKg(line.take)} kg</span>
                                                            </span>
                                                        ) : whole ? (
                                                            <span className="text-[10px] font-semibold text-slate-600">
                                                                Whole roll · {fmtKg(item.kg)} kg
                                                            </span>
                                                        ) : item?.kg != null ? (
                                                            <span className="text-[10px] text-slate-500">{fmtKg(item.kg)} kg on the shelf</span>
                                                        ) : num(job.availableKg) > 0 ? (
                                                            <span className="text-[10px] text-slate-500">{fmtKg(job.availableKg)} kg assigned</span>
                                                        ) : null}
                                                    </span>
                                                    {whole && line.take == null && (
                                                        <span className="block text-[10px] text-slate-400 mt-1">
                                                            Take the whole roll — what is left goes back when the job is done.
                                                        </span>
                                                    )}
                                                </span>
                                            </label>
                                        );
                                    })}
                                </div>
                            </section>
                        );
                    })}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 space-y-2">
                    {note && (
                        <p className="text-[11px] text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-2.5 py-2">
                            {note}
                        </p>
                    )}
                    {anyUnrecorded && (
                        <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2">
                            Some jobs have no stock item recorded against them, so this list cannot name every roll.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <Button variant="ghost" className="flex-1" onClick={onClose}>Cancel</Button>
                        <Button
                            variant="primary"
                            className="flex-1"
                            disabled={!allTicked || updating}
                            icon={updating ? Loader2 : CheckCircle2}
                            onClick={onConfirm}
                        >
                            {updating ? 'Marking…' : 'Mark Collected'}
                        </Button>
                    </div>
                    {!allTicked && lines.length > 0 && (
                        <p className="text-[11px] text-slate-400 text-center">
                            Tick every item you have in hand to confirm collection.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CollectionChecklistModal;
