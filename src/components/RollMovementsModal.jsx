import React, { useState, useEffect, useMemo } from 'react';
import {
    X, Loader2, AlertCircle, Download, Search, CalendarRange,
    ArrowUp, ArrowDown, Sparkles, QrCode, Minus, FileSpreadsheet
} from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { makeLabelsZip, itemLabelLines, makeItemLabelPng } from '../utils/itemLabel';
import { num, fmtKg, attrText } from '../utils/txnDisplay';
import {
    MOVEMENT_SQL, UNACKED_SQL, movementArgs, dayStart, dayAfter,
    defaultWindow, withClosing, byImpact, totals, zipName,
    movementsCsv, csvName
} from '../utils/rollMovements';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const when = (ts) => (num(ts) > 0
    ? new Date(num(ts) * 1000).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
    : '—');

const Figure = ({ label, value, unit, tone = 'text-slate-800' }) => (
    <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-wider text-slate-400 truncate">{label}</p>
        <p className={`text-sm font-bold tabular-nums ${tone}`}>
            {value}<span className="text-[10px] font-medium text-slate-400 ml-0.5">{unit}</span>
        </p>
    </div>
);

// The delta is the number the view exists for, so it is the one thing that gets
// colour: green for stock arriving, amber for stock leaving, grey for a roll that
// moved both ways and came back to where it started.
const Delta = ({ kg }) => {
    const v = num(kg);
    if (Math.abs(v) < 0.005) {
        return (
            <span className="inline-flex items-center gap-1 text-slate-500 font-semibold tabular-nums text-sm">
                <Minus size={13} /> no net change
            </span>
        );
    }
    const up = v > 0;
    return (
        <span className={`inline-flex items-center gap-1 font-bold tabular-nums text-sm ${up ? 'text-emerald-700' : 'text-amber-700'}`}>
            {up ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            {up ? '+' : '−'}{fmtKg(Math.abs(v))} kg
        </span>
    );
};

const RollRow = ({ row, onLabel, labelling }) => (
    <div className="px-3 py-2.5 flex items-start gap-2.5">
        <span className="w-9 shrink-0 pt-0.5">
            <ItemVisual colour={row.col} type={row.itype} name={row.name} size="sm" />
        </span>
        <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2 flex-wrap">
                <span className="font-mono text-[12px] font-semibold text-slate-800 break-all">{row.iid}</span>
                <Delta kg={row.delta} />
            </div>
            <p className="text-[11px] text-slate-500 break-words">{attrText(row)}</p>
            <div className="flex items-center gap-x-3 gap-y-1 flex-wrap mt-1 text-[11px] text-slate-500 tabular-nums">
                <span>
                    {fmtKg(row.opening)} <span className="text-slate-400">→</span>{' '}
                    <b className="text-slate-700">{fmtKg(row.closing)}</b> kg
                </span>
                <span className="text-slate-300">·</span>
                <span>{row.moves} move{row.moves === 1 ? '' : 's'}</span>
                <span className="text-slate-300">·</span>
                <span>last {when(row.lastAt)}</span>
                {row.isNew ? (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-sky-50 text-sky-700 font-medium">
                        <Sparkles size={10} /> new roll
                    </span>
                ) : null}
                {row.closing <= 0.005 && row.delta < 0 ? (
                    <span className="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-medium">finished</span>
                ) : null}
            </div>
            {row.jobList.length > 0 && (
                <p className="text-[11px] text-slate-400 mt-1 break-words">
                    Job{row.jobList.length === 1 ? '' : 's'}: <span className="font-mono">{row.jobList.join(', ')}</span>
                </p>
            )}
        </div>
        <button
            type="button"
            onClick={() => onLabel(row)}
            disabled={labelling}
            className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-teal-700 hover:bg-teal-50 disabled:opacity-40"
            title="Download this roll's QR label"
        >
            {labelling ? <Loader2 size={15} className="animate-spin" /> : <QrCode size={15} />}
        </button>
    </div>
);

// Which rolls were touched between two dates, by how much, and their labels as one
// archive. Built for reconciling a physical count against the book, and for the
// relabelling that follows it.
const RollMovementsModal = ({ onClose, getHeaders, getUrl }) => {
    const [{ from, to }, setWindow] = useState(defaultWindow);
    const [rows, setRows] = useState([]);
    const [unacked, setUnacked] = useState({ n: 0, rolls: 0 });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [q, setQ] = useState('');
    const [bulk, setBulk] = useState(null);      // { done, total }
    const [oneLabel, setOneLabel] = useState(null);

    const runSql = async (sql, args = []) => {
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

    // A backwards range returns nothing and looks like a data problem, so it is
    // named as the input mistake it is instead.
    const start = dayStart(from);
    const end = dayAfter(to);
    const badRange = start != null && end != null && start >= end;

    useEffect(() => {
        if (start == null || end == null || badRange) { setLoading(false); return; }
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const [moved, pending] = await Promise.all([
                    runSql(MOVEMENT_SQL, movementArgs(start, end)),
                    runSql(UNACKED_SQL, [start, end])
                ]);
                if (!live) return;
                setRows(moved.map(withClosing).sort(byImpact));
                setUnacked({ n: num(pending[0]?.n), rolls: num(pending[0]?.rolls) });
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

    const listed = useMemo(() => {
        const needle = q.trim().toUpperCase();
        if (!needle) return rows;
        return rows.filter((r) => `${r.iid} ${r.mat} ${r.col} ${r.gsm} ${r.w}`.toUpperCase().includes(needle));
    }, [rows, q]);

    const sums = useMemo(() => totals(listed), [listed]);

    const save = (blob, filename) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
    };

    const downloadOne = async (row) => {
        setOneLabel(row.iid);
        setError(null);
        try {
            const built = await makeItemLabelPng(row.iid, itemLabelLines(row));
            save(built.blob, built.filename);
            URL.revokeObjectURL(built.url);
        } catch (err) {
            setError(`Could not build that label: ${err.message || String(err)}`);
        } finally {
            setOneLabel(null);
        }
    };

    const downloadCsv = () => {
        setError(null);
        if (listed.length === 0) {
            setError('There is nothing in this window to export.');
            return;
        }
        // text/csv rather than a download attribute alone: some Android browsers
        // save an unnamed .bin otherwise, and the file has to open in a spreadsheet.
        save(new Blob([movementsCsv(listed)], { type: 'text/csv;charset=utf-8' }), csvName(from, to));
    };

    const downloadZip = async () => {
        setError(null);
        try {
            const items = listed.map((r) => ({ iid: r.iid, lines: itemLabelLines(r) })).filter((i) => i.iid);
            if (items.length === 0) {
                setError('None of these rolls has an item id to put on a label.');
                return;
            }
            const zip = await makeLabelsZip(
                items,
                (done, total) => setBulk({ done, total }),
                { filename: zipName(from, to) }
            );
            save(zip.blob, zip.filename);
            if (items.length < listed.length) {
                setError(`${listed.length - items.length} of ${listed.length} rolls had no item id and were left out of the archive.`);
            }
        } catch (err) {
            setError(`Could not build the labels: ${err.message || String(err)}`);
        } finally {
            setBulk(null);
        }
    };

    const dateField = (label, value, onChange) => (
        <label className="flex-1 min-w-0">
            <span className="block text-[10px] uppercase tracking-wider text-slate-400 mb-1">{label}</span>
            <input
                type="date"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                className="w-full px-2.5 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
            />
        </label>
    );

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[94vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                            <CalendarRange size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">Roll movements</h2>
                            <p className="text-[11px] text-slate-500">
                                Which rolls were touched, and by how much
                            </p>
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
                    <label className="relative block">
                        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                        <input
                            value={q}
                            onChange={(e) => setQ(e.target.value)}
                            placeholder="Filter by roll id, material, colour…"
                            className="w-full pl-8 pr-3 py-1.5 border border-slate-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                </div>

                {!loading && !badRange && rows.length > 0 && (
                    <div className="px-4 py-2.5 border-b border-slate-100 shrink-0 grid grid-cols-4 gap-2">
                        <Figure label="Rolls touched" value={sums.rolls} unit="" />
                        <Figure label="Came in" value={fmtKg(sums.inKg)} unit="kg" tone="text-emerald-700" />
                        <Figure label="Went out" value={fmtKg(sums.outKg)} unit="kg" tone="text-amber-700" />
                        <Figure
                            label="Net"
                            value={`${sums.delta >= 0 ? '+' : '−'}${fmtKg(Math.abs(sums.delta))}`}
                            unit="kg"
                            tone={sums.delta >= 0 ? 'text-emerald-700' : 'text-amber-700'}
                        />
                    </div>
                )}

                {unacked.n > 0 && (
                    <div className="mx-4 mt-2.5 shrink-0 flex items-start gap-2 text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-2">
                        <AlertCircle size={14} className="shrink-0 mt-px" />
                        <span>
                            {unacked.n} movement{unacked.n === 1 ? '' : 's'} on {unacked.rolls} roll
                            {unacked.rolls === 1 ? '' : 's'} in this window {unacked.n === 1 ? 'is' : 'are'} still
                            waiting on the incharge. Stock does not count them, so they are not in these figures either.
                        </span>
                    </div>
                )}

                {error && (
                    <div className="mx-4 mt-2.5 shrink-0 flex items-start gap-2 text-[11px] text-red-700 bg-red-50 rounded-lg px-2.5 py-2">
                        <AlertCircle size={14} className="shrink-0 mt-px" />
                        <span className="break-words">{error}</span>
                    </div>
                )}

                <div className="flex-1 overflow-y-auto divide-y divide-slate-100 mt-1">
                    {loading && (
                        <p className="flex items-center justify-center gap-2 text-sm text-slate-500 py-10">
                            <Loader2 size={16} className="animate-spin" /> Reading the movements…
                        </p>
                    )}
                    {!loading && !badRange && listed.length === 0 && (
                        <p className="text-sm text-slate-500 text-center py-10 px-6">
                            {rows.length === 0
                                ? 'No roll moved in this window.'
                                : 'No roll matches that filter.'}
                        </p>
                    )}
                    {!loading && listed.map((row) => (
                        <RollRow
                            key={row.item_ref}
                            row={row}
                            onLabel={downloadOne}
                            labelling={oneLabel === row.iid}
                        />
                    ))}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 flex items-center gap-2">
                    <span className="text-[11px] text-slate-400 flex-1 min-w-0 truncate hidden sm:block">
                        {listed.length > 0 ? `${listed.length} roll${listed.length === 1 ? '' : 's'} listed` : ''}
                    </span>
                    <Button
                        variant="secondary"
                        onClick={downloadCsv}
                        disabled={listed.length === 0}
                        className="!px-3"
                        title="Download this summary as a spreadsheet"
                    >
                        <FileSpreadsheet size={15} /> CSV
                    </Button>
                    <Button
                        variant="primary"
                        onClick={downloadZip}
                        disabled={Boolean(bulk) || listed.length === 0}
                        className="bg-teal-600 hover:bg-teal-700 !px-3"
                        title="Download a zip of QR labels for every roll listed"
                    >
                        {bulk
                            ? <><Loader2 size={15} className="animate-spin" /> {bulk.done}/{bulk.total}</>
                            : <><Download size={15} /> QR labels ({listed.length})</>}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default RollMovementsModal;
