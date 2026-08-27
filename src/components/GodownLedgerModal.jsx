import React, { useState, useEffect, useMemo } from 'react';
import {
    X, Loader2, AlertCircle, Search, ScrollText, Download, Check,
    ArrowDownLeft, ArrowUpRight, Sparkles, Clock, Factory, ChevronDown
} from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { attrText } from '../utils/txnDisplay';
import { downloadCsv } from '../utils/csvFile';
import {
    LEDGER_SQL, OPENING_SQL, withBalances, optionsFrom, applyFilters, ledgerTotals,
    defaultWindow, dayStart, dayAfter, csvName, LEDGER_CSV_HEADERS, ledgerCsvRows
} from '../utils/godownLedger';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);

const TYPE_STYLE = {
    'ADD': { text: 'text-emerald-700', ring: 'ring-emerald-200 bg-emerald-50', Icon: ArrowDownLeft },
    'NEW STOCK': { text: 'text-sky-700', ring: 'ring-sky-200 bg-sky-50', Icon: Sparkles },
    'LESS': { text: 'text-rose-700', ring: 'ring-rose-200 bg-rose-50', Icon: ArrowUpRight }
};
const styleFor = (t) => TYPE_STYLE[String(t || '').toUpperCase()] || TYPE_STYLE.ADD;

const dayLabel = (ts) => new Date(num(ts) * 1000)
    .toLocaleDateString('en-GB', { weekday: 'short', day: '2-digit', month: 'short', year: 'numeric' });
const timeLabel = (ts) => new Date(num(ts) * 1000)
    .toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });

// A filter that is a row of chips: tap to include, tap again to drop. Nothing
// selected means everything, which is what an untouched filter should do.
const ChipRow = ({ values, chosen, onToggle, onClear, label }) => (
    <div className="min-w-0">
        <div className="flex items-baseline justify-between gap-2 mb-1">
            <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
            {chosen.length > 0 && (
                <button onClick={onClear} className="text-[10px] font-semibold text-teal-700 hover:text-teal-800">
                    clear
                </button>
            )}
        </div>
        <div className="-mx-1 px-1 overflow-x-auto no-scrollbar">
            <div className="flex gap-1.5 w-max">
                {values.map((v) => {
                    const on = chosen.includes(v);
                    return (
                        <button
                            key={v}
                            onClick={() => onToggle(v)}
                            className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${on
                                ? 'bg-teal-600 text-white'
                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                        >
                            {v}
                        </button>
                    );
                })}
            </div>
        </div>
    </div>
);

// Individual items, several at a time. Collapsed by default: on the bags godown
// the list runs to hundreds, and it is the type chips people reach for first.
const ItemPicker = ({ items, chosen, onToggle, onClear }) => {
    const [open, setOpen] = useState(false);
    const [q, setQ] = useState('');
    const shown = useMemo(() => {
        const needle = q.trim().toUpperCase();
        return needle ? items.filter((i) => `${i.name} ${i.code}`.toUpperCase().includes(needle)) : items;
    }, [items, q]);
    return (
        <div className="min-w-0">
            <button
                onClick={() => setOpen((o) => !o)}
                className="w-full flex items-center justify-between gap-2 text-[10px] uppercase tracking-wider text-slate-400"
            >
                <span>Items {chosen.length > 0 ? `· ${chosen.length} selected` : `· all ${items.length}`}</span>
                <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="mt-1.5 rounded-lg border border-slate-200">
                    <label className="relative block border-b border-slate-100">
                        <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Find an item"
                            className="w-full pl-7 pr-2 py-1.5 text-[12px] rounded-t-lg outline-none"
                        />
                    </label>
                    <div className="max-h-40 overflow-y-auto divide-y divide-slate-50">
                        {shown.length === 0 && <p className="text-[11px] text-slate-400 text-center py-3">No item matches that.</p>}
                        {shown.map((i) => {
                            const on = chosen.includes(i.ref);
                            return (
                                <button
                                    key={i.ref}
                                    onClick={() => onToggle(i.ref)}
                                    className={`w-full flex items-center gap-2 px-2 py-1.5 text-left ${on ? 'bg-teal-50' : 'hover:bg-slate-50'}`}
                                >
                                    <span className={`w-3.5 h-3.5 rounded border shrink-0 flex items-center justify-center ${on ? 'bg-teal-600 border-teal-600 text-white' : 'border-slate-300'}`}>
                                        {on && <Check size={9} strokeWidth={3} />}
                                    </span>
                                    <span className="font-mono text-[11px] text-slate-700 truncate">{i.name}</span>
                                </button>
                            );
                        })}
                    </div>
                    {chosen.length > 0 && (
                        <button onClick={onClear} className="w-full py-1.5 text-[11px] font-semibold text-teal-700 border-t border-slate-100 hover:bg-slate-50">
                            Clear {chosen.length} selected
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

const Figure = ({ label, value, unit, tone = 'text-slate-800' }) => (
    <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 truncate">{label}</p>
        <p className={`text-sm font-bold tabular-nums ${tone}`}>
            {value}{unit ? <span className="text-[10px] font-medium text-slate-400 ml-0.5">{unit}</span> : null}
        </p>
    </div>
);

// One movement: what it was, what it did, and where it left the item.
const Row = ({ r }) => {
    const st = styleFor(r.type);
    const kg = num(r.wkg);
    const cnt = num(r.cbund);
    return (
        <div className={`flex items-start gap-2.5 px-3 py-2 ${r.acked ? '' : 'bg-amber-50/50'}`}>
            <span className="w-8 shrink-0 pt-0.5">
                <ItemVisual colour={r.colour} type={r.itype} name={r.code} size="sm" />
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                    <span className="font-mono text-[11px] font-semibold text-slate-800 truncate">{r.item || r.code}</span>
                    <span className="shrink-0 text-[11px] tabular-nums font-semibold">
                        {kg ? <span className={st.text}>{kg > 0 ? '+' : '−'}{fmtKg(Math.abs(kg))} kg</span> : null}
                        {kg && cnt ? <span className="text-slate-300"> · </span> : null}
                        {cnt ? <span className={st.text}>{cnt > 0 ? '+' : '−'}{Math.abs(cnt).toLocaleString('en-IN')} {r.countUnit}</span> : null}
                        {!kg && !cnt ? <span className="text-slate-400">no change</span> : null}
                    </span>
                </div>
                <p className="text-[10px] text-slate-500 truncate">{attrText({ mat: r.material, col: r.colour, gsm: r.gsm, w: r.w, h: r.h })}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 mt-1 text-[10px] text-slate-500">
                    <span className={`inline-flex items-center gap-1 px-1.5 py-px rounded ring-1 ${st.ring} ${st.text} font-semibold`}>
                        <st.Icon size={9} /> {r.type}
                    </span>
                    <span className="text-slate-400">{r.loc}</span>
                    <span className="text-slate-300">·</span>
                    <span className="inline-flex items-center gap-1"><Clock size={9} />{timeLabel(r.ts)}</span>
                    {r.who && <><span className="text-slate-300">·</span><span className="truncate max-w-[9rem]">{r.who}</span></>}
                    {r.job && <><span className="text-slate-300">·</span><span className="inline-flex items-center gap-1 font-mono"><Factory size={9} />{r.job}</span></>}
                </div>
                <p className="text-[10px] mt-0.5">
                    <span className="text-slate-400">balance </span>
                    <span className="font-semibold text-slate-700 tabular-nums">
                        {num(r.balanceCount) !== 0
                            ? `${num(r.balanceCount).toLocaleString('en-IN')} ${r.countUnit}`
                            : `${fmtKg(r.balanceKg)} kg`}
                    </span>
                    {!r.acked && (
                        <span className="ml-1.5 text-amber-800 font-medium">
                            not signed off — this movement has not moved the balance
                        </span>
                    )}
                </p>
            </div>
        </div>
    );
};

// Every movement in a window, in the order it happened, with the balance it left.
const GodownLedgerModal = ({ onClose, getHeaders, getUrl }) => {
    const [{ from, to }, setWindow] = useState(defaultWindow);
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [types, setTypes] = useState([]);
    const [locations, setLocations] = useState([]);
    const [items, setItems] = useState([]);
    const [search, setSearch] = useState('');

    const start = dayStart(from);
    const end = dayAfter(to);
    const badRange = start != null && end != null && start >= end;

    const runSql = async (sql, args) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Query failed (${res.status})${text ? ` — ${text}` : ''}`);
        }
        return ((await res.json()).records || []).map((r) => r.fields);
    };

    useEffect(() => {
        if (start == null || end == null || badRange) { setLoading(false); return; }
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const [moves, openings] = await Promise.all([
                    runSql(LEDGER_SQL, [start, end]),
                    runSql(OPENING_SQL, [start])
                ]);
                if (!live) return;
                setRows(withBalances(moves, openings));
            } catch (err) {
                if (!live) return;
                setError(err.message || String(err));
                setRows([]);
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to]);

    const options = useMemo(() => optionsFrom(rows), [rows]);
    const listed = useMemo(
        () => applyFilters(rows, { types, locations, items, search }),
        [rows, types, locations, items, search]
    );
    const totals = useMemo(() => ledgerTotals(listed), [listed]);
    // Newest first on screen; the balances were worked out oldest first.
    const shown = useMemo(() => [...listed].reverse(), [listed]);

    const toggle = (setter) => (v) => setter((prev) => (prev.includes(v) ? prev.filter((x) => x !== v) : [...prev, v]));

    const dateField = (label, value, onChange) => (
        <label className="flex-1 min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</span>
            <input
                type="date" value={value} onChange={(e) => onChange(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
            />
        </label>
    );

    let lastDay = null;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[94vh]" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-slate-800 text-white flex items-center justify-center shrink-0">
                            <ScrollText size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">Godown ledger</h2>
                            <p className="text-[11px] text-slate-500">Every movement, in the order it happened</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="px-4 py-3 border-b border-slate-100 shrink-0 space-y-2.5">
                    <div className="flex items-end gap-2">
                        {dateField('From', from, (v) => setWindow((w) => ({ ...w, from: v })))}
                        <span className="pb-2 text-slate-400 text-sm">to</span>
                        {dateField('To', to, (v) => setWindow((w) => ({ ...w, to: v })))}
                    </div>
                    {badRange && (
                        <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg px-2.5 py-1.5">
                            The From date is after the To date — nothing can fall in that window.
                        </p>
                    )}
                    {options.locations.length > 1 && (
                        <ChipRow label="Godown" values={options.locations} chosen={locations}
                            onToggle={toggle(setLocations)} onClear={() => setLocations([])} />
                    )}
                    {options.types.length > 0 && (
                        <ChipRow label="Item type" values={options.types} chosen={types}
                            onToggle={toggle(setTypes)} onClear={() => setTypes([])} />
                    )}
                    {options.items.length > 0 && (
                        <ItemPicker items={options.items} chosen={items}
                            onToggle={toggle(setItems)} onClear={() => setItems([])} />
                    )}
                    <label className="relative block">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={search} onChange={(e) => setSearch(e.target.value)}
                            placeholder="Filter by item, person, job…"
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                </div>

                {!loading && !badRange && listed.length > 0 && (
                    <div className="px-4 py-2.5 border-b border-slate-100 shrink-0 grid grid-cols-4 gap-2">
                        <Figure label="Movements" value={totals.moves} />
                        <Figure label="In" value={totals.inKg > 0 ? fmtKg(totals.inKg) : totals.inCount.toLocaleString('en-IN')}
                            unit={totals.inKg > 0 ? 'kg' : ''} tone="text-emerald-700" />
                        <Figure label="Out" value={totals.outKg > 0 ? fmtKg(totals.outKg) : totals.outCount.toLocaleString('en-IN')}
                            unit={totals.outKg > 0 ? 'kg' : ''} tone="text-rose-700" />
                        <Figure label="Unsigned" value={totals.unacked} tone={totals.unacked ? 'text-amber-700' : 'text-slate-400'} />
                    </div>
                )}

                {error && (
                    <div className="mx-4 mt-2.5 shrink-0 flex items-start gap-2 text-[11px] text-red-700 bg-red-50 rounded-lg px-2.5 py-2">
                        <AlertCircle size={14} className="shrink-0 mt-px" />
                        <span className="break-words">{error}</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto">
                    {loading && (
                        <p className="flex items-center justify-center gap-2 text-sm text-slate-500 py-10">
                            <Loader2 size={16} className="animate-spin" /> Reading the ledger…
                        </p>
                    )}
                    {!loading && !badRange && shown.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-10 px-6">
                            {rows.length === 0 ? 'Nothing moved in this window.' : 'Nothing matches those filters.'}
                        </p>
                    )}
                    {!loading && shown.map((r) => {
                        const day = dayLabel(r.ts);
                        const newDay = day !== lastDay;
                        lastDay = day;
                        return (
                            <div key={r.id}>
                                {newDay && (
                                    <p className="sticky top-0 z-10 bg-slate-50 px-3 py-1 text-[10px] font-semibold uppercase tracking-wider text-slate-400 border-y border-slate-100">
                                        {day}
                                    </p>
                                )}
                                <Row r={r} />
                            </div>
                        );
                    })}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 flex-1 min-w-0 truncate">
                        {listed.length > 0 ? `${listed.length} movement${listed.length === 1 ? '' : 's'}` : ''}
                    </span>
                    <Button variant="ghost" onClick={onClose}>Close</Button>
                    <Button
                        variant="secondary"
                        disabled={listed.length === 0}
                        onClick={() => downloadCsv(csvName(from, to), LEDGER_CSV_HEADERS, ledgerCsvRows(listed))}
                        className="!px-3"
                    >
                        <Download size={15} /> CSV
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default GodownLedgerModal;
