import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, Printer, AlertTriangle, ChevronDown, Check } from 'lucide-react';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
    BATCH_LIST_SQL, BATCH_TXN_SQL, ROLL_BALANCE_SQL, ROLL_CHANGE_SQL,
    groupFigures, balanceMoments, rollBalances, unackedCount, changeBreakdown,
    batchStatus, batchNumber, isBatchClosed, wastagePct,
    parseBatchIds, batchIdsArg, batchesByDay
} from '../../domain/production/batchReport';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const kgText = (v) => num(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const signedKg = (v) => `${num(v) > 0 ? '+' : num(v) < 0 ? '−' : ''}${kgText(Math.abs(num(v)))}`;
const dayText = (ts) => (num(ts) > 0
    ? new Date(num(ts) * 1000).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—');
const momentText = (ts) => new Date(num(ts) * 1000).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit'
});
// "ROLLS TO SIDEPATTY" says "SIDEPATTY" where space is short; every batch is rolls to something.
const shortType = (type) => String(type || 'Batch').replace(/^ROLLS TO /i, '');
const numbersText = (batches) => batches.map(batchNumber).join(', ');

// ---- Picker ---------------------------------------------------------------

// Tick any set of batches; a day's worth goes in one tap, since the batches run
// around one date are what the paper form called one batch. Changes are held
// until the list is closed, so ticking five boxes runs the report once, not five
// times.
const BatchPicker = ({ batches, selected, onApply }) => {
    const [open, setOpen] = useState(false);
    const [draft, setDraft] = useState(selected);
    const days = useMemo(() => batchesByDay(batches), [batches]);
    const chosen = useMemo(() => batches.filter((b) => selected.includes(num(b.id))), [batches, selected]);

    const openList = () => { setDraft(selected); setOpen(true); };
    const close = () => {
        setOpen(false);
        if (draft.join(',') !== selected.join(',')) onApply(draft);
    };
    const toggle = (id) => setDraft((d) => (d.includes(id) ? d.filter((x) => x !== id) : [...d, id].sort((a, b) => a - b)));
    const toggleDay = (day) => {
        const ids = day.batches.map((b) => num(b.id));
        const all = ids.every((id) => draft.includes(id));
        setDraft((d) => (all
            ? d.filter((x) => !ids.includes(x))
            : [...new Set([...d, ...ids])].sort((a, b) => a - b)));
    };

    return (
        <div className="relative flex-1 min-w-0">
            <button
                type="button"
                onClick={() => (open ? close() : openList())}
                className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-300 bg-white text-left text-sm focus:outline-none focus:ring-2 focus:ring-amber-500"
            >
                <span className="flex-1 min-w-0 truncate text-slate-800">
                    {chosen.length === 0
                        ? <span className="text-slate-400">Pick batches…</span>
                        : chosen.map((b) => `#${batchNumber(b)} ${shortType(b.type)}`).join(' · ')}
                </span>
                {chosen.length > 1 && (
                    <span className="shrink-0 text-[11px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800">{chosen.length} batches</span>
                )}
                <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <>
                    <div className="fixed inset-0 z-20" onClick={close} />
                    <div className="absolute left-0 right-0 top-full mt-1 z-30 bg-white rounded-xl border border-slate-200 shadow-xl max-h-[65vh] flex flex-col">
                        <div className="overflow-y-auto">
                            {days.map((day) => {
                                const ids = day.batches.map((b) => num(b.id));
                                const all = ids.every((id) => draft.includes(id));
                                return (
                                    <div key={day.date}>
                                        <div className="sticky top-0 z-10 flex items-center justify-between px-3 py-1.5 bg-slate-50 border-b border-slate-200">
                                            <span className="text-xs font-semibold text-slate-600">{dayText(day.date)}</span>
                                            <button type="button" onClick={() => toggleDay(day)} className="text-xs font-semibold text-amber-700 hover:text-amber-800">
                                                {all ? 'Clear day' : 'Select day'}
                                            </button>
                                        </div>
                                        {day.batches.map((b) => {
                                            const on = draft.includes(num(b.id));
                                            return (
                                                <label key={b.id} className="flex items-center gap-3 px-3 py-2 border-b border-slate-100 cursor-pointer hover:bg-slate-50">
                                                    <input type="checkbox" checked={on} onChange={() => toggle(num(b.id))} className="w-4 h-4 accent-amber-600" />
                                                    <span className="flex-1 min-w-0">
                                                        <span className="block text-sm text-slate-800 truncate">#{batchNumber(b)} · {b.type}</span>
                                                        <span className="block text-[11px] text-slate-400">{batchStatus(b)}</span>
                                                    </span>
                                                </label>
                                            );
                                        })}
                                    </div>
                                );
                            })}
                        </div>
                        <div className="flex items-center gap-2 px-3 py-2 border-t border-slate-200 bg-white rounded-b-xl">
                            <span className="flex-1 text-xs text-slate-500">{draft.length} selected</span>
                            <Button variant="ghost" onClick={() => setDraft([])} className="!px-2.5 !py-1.5 text-sm">Clear</Button>
                            <Button variant="primary" onClick={close} icon={Check} className="!px-3 !py-1.5 text-sm bg-amber-600 hover:bg-amber-700">Done</Button>
                        </div>
                    </div>
                </>
            )}
        </div>
    );
};

// ---- The form -------------------------------------------------------------

// One grid for the whole form, as on paper: a label and four figure columns, so
// a figure sits under the same heading position in every section. Fixed widths
// from tablet up; on a phone the columns size to their figures instead.
const TH = 'font-semibold py-1.5 px-2 sm:px-3 first:pl-4 last:pr-4';
const TD = 'py-2 px-2 sm:px-3 first:pl-4 last:pr-4';
const NUM = `${TD} text-right`;

const SectionHead = ({ title, caption }) => (
    <div className="px-4 py-2.5 bg-slate-50 border-y border-slate-200">
        <h3 className="font-bold text-slate-800 uppercase text-sm tracking-wide">{title}</h3>
        {caption && <p className="text-xs text-slate-500">{caption}</p>}
    </div>
);

const Grid = ({ head, children }) => (
    <div className="overflow-x-auto">
        <table className="w-full text-xs sm:text-sm tabular-nums sm:table-fixed">
            <colgroup>
                <col />
                {[0, 1, 2, 3].map((i) => <col key={i} className="sm:w-[17%]" />)}
            </colgroup>
            <thead>
                <tr className="text-[11px] uppercase text-slate-500">
                    {head.map((h, i) => <th key={i} className={`${TH} ${i === 0 ? 'text-left' : 'text-right'}`}>{h}</th>)}
                </tr>
            </thead>
            <tbody>{children}</tbody>
        </table>
    </div>
);

const MaterialLabel = ({ m }) => (
    <td className={TD}>
        {m.label}
        {m.hint && <span className="block sm:inline text-slate-400 text-[11px]"><span className="hidden sm:inline"> · </span>{m.hint}</span>}
    </td>
);

// One balance block: the rolls godown total, then each material on the form.
const BalanceTable = ({ title, caption, balance }) => (
    <section className="break-inside-avoid">
        <SectionHead title={title} caption={caption} />
        <Grid head={['Rolls godown', 'Kg', 'Rolls', '', '']}>
            <tr className="border-t border-slate-200 font-bold text-slate-800">
                <td className={TD}>Rolls godown total</td>
                <td className={NUM}>{kgText(balance.total.kg)}</td>
                <td className={NUM}>{balance.total.rolls}</td>
                <td className={TD} /><td className={TD} />
            </tr>
            {balance.rows.map((m) => (
                <tr key={m.key} className="border-t border-slate-100 text-slate-700">
                    <MaterialLabel m={m} />
                    <td className={NUM}>{kgText(m.kg)}</td>
                    <td className={NUM}>{m.rolls}</td>
                    <td className={TD} /><td className={TD} />
                </tr>
            ))}
        </Grid>
    </section>
);

const FigureCells = ({ row, muted }) => {
    const pct = wastagePct(row);
    return (
        <>
            <td className={NUM}>{kgText(row.collected)}</td>
            <td className={NUM}>{kgText(row.produced)}</td>
            <td className={NUM}>{kgText(row.returned)}</td>
            <td className={NUM}>
                {kgText(row.wastage)}
                {pct != null && <div className={`text-[11px] font-normal ${muted ? 'text-slate-400' : 'text-slate-500'}`}>{pct}%</div>}
            </td>
        </>
    );
};

// The batch section: a row per batch type with its own figures and the batches
// and dates behind it, the roll materials it cut beneath, and the group total --
// the paper form's middle block.
const BatchTable = ({ batches, group }) => (
    <section className="break-inside-avoid">
        <SectionHead
            title={`Batch No: ${numbersText(batches)}`}
            caption={batches.length === 1 ? batches[0].name : `${batches.length} batches viewed as one group`}
        />
        <Grid head={['', 'Roll kg', 'Made kg', 'Return', 'Waste']}>
            {group.blocks.map((block) => (
                <React.Fragment key={block.type}>
                    <tr className="border-t border-slate-300 font-semibold text-slate-800 align-top">
                        <td className={TD}>
                            <div>{block.type}</div>
                            {block.batches.map((b) => (
                                <div key={b.id} className="text-[11px] font-normal text-slate-500">
                                    #{batchNumber(b)} · Date: {dayText(b.date)}
                                    {num(b.completedAt) > 0 && <span className="hidden sm:inline"> · Completed {dayText(b.completedAt)}</span>}
                                    {!isBatchClosed(b) && <span className="text-amber-700"> · {batchStatus(b)}</span>}
                                </div>
                            ))}
                            {block.rows.length === 0 && <div className="text-[11px] font-normal italic text-slate-400">Nothing booked yet</div>}
                        </td>
                        <FigureCells row={block.total} />
                    </tr>
                    {block.rows.map((r) => (
                        <tr key={r.key ?? 'none'} className="text-slate-500 text-xs">
                            <td className={`${TD} !py-1 !pl-7`}>
                                {r.label}
                                <span className="text-slate-400"> · {r.jobs} job{r.jobs === 1 ? '' : 's'}</span>
                            </td>
                            <td className={`${NUM} !py-1`}>{kgText(r.collected)}</td>
                            <td className={`${NUM} !py-1`}>{kgText(r.produced)}</td>
                            <td className={`${NUM} !py-1`}>{kgText(r.returned)}</td>
                            <td className={`${NUM} !py-1`}>{kgText(r.wastage)}</td>
                        </tr>
                    ))}
                </React.Fragment>
            ))}
            <tr className="border-t-2 border-slate-400 font-bold text-slate-900">
                <td className={TD}>Total</td>
                <FigureCells row={group.total} />
            </tr>
        </Grid>
    </section>
);

// Why the godown moved between before and after. A delivery mid-batch can dwarf
// what the batches themselves drew, and a bare change figure reads as their doing.
const ChangeTable = ({ change, many }) => {
    const cells = (m) => (
        <>
            <td className={NUM}>{signedKg(m.batch)}</td>
            <td className={NUM}>{signedKg(m.other)}</td>
            <td className={NUM}>{signedKg(m.stock)}</td>
            <td className={`${NUM} font-semibold text-slate-800`}>{signedKg(m.net)}</td>
        </>
    );
    return (
        <section className="break-inside-avoid">
            <SectionHead title="Change, before to after" caption="Kg in or out of the rolls godown, by who moved it" />
            <Grid head={['Rolls godown', many ? 'These batches' : 'This batch', 'Other batches', 'New stock & adj.', 'Net change']}>
                <tr className="border-t border-slate-200 font-bold text-slate-800">
                    <td className={TD}>Rolls godown total</td>
                    {cells(change.total)}
                </tr>
                {change.rows.map((m) => (
                    <tr key={m.key} className="border-t border-slate-100 text-slate-600">
                        <MaterialLabel m={m} />
                        {cells(m)}
                    </tr>
                ))}
            </Grid>
        </section>
    );
};

// ---- The report -----------------------------------------------------------

// The paper "BATCH WISE REPORT" for a group of production batches. The group
// lives in the URL (?batches=56,57) so a report can be shared or reopened.
const ProductionBatchReport = ({ getHeaders, getUrl }) => {
    const [params, setParams] = useSearchParams();
    const [batches, setBatches] = useState(null);
    const [listError, setListError] = useState(null);
    const [report, setReport] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

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

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const rows = await runSql(BATCH_LIST_SQL);
                if (live) { setBatches(rows); setListError(null); }
            } catch (err) {
                if (live) setListError(err.message || String(err));
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [reloadKey]);

    // Until something is picked, the newest day's batches: the group most likely
    // wanted, and the one the paper form would have been filled in for.
    // An empty list in the URL is a deliberate clear, not "nothing picked yet".
    const fromUrl = params.has('batches') ? parseBatchIds(params.get('batches')) : null;
    const selectedKey = (fromUrl
        ? fromUrl
        : (batchesByDay(batches || [])[0]?.batches || []).map((b) => num(b.id)).sort((a, b) => a - b)
    ).join(',');
    const selectedIds = useMemo(() => parseBatchIds(selectedKey), [selectedKey]);
    const group = useMemo(
        () => (batches || []).filter((b) => selectedIds.includes(num(b.id))),
        [batches, selectedIds]
    );

    useEffect(() => {
        if (group.length === 0) return undefined;
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const ids = batchIdsArg(group.map((b) => b.id));
                const txns = await runSql(BATCH_TXN_SQL, [ids]);
                const moments = balanceMoments(group, txns);
                const now = Date.now() / 1000;
                const from = moments.before ?? now;
                const to = moments.after ?? now;
                const [balances, changes] = await Promise.all([
                    runSql(ROLL_BALANCE_SQL, [from, to]),
                    runSql(ROLL_CHANGE_SQL, [ids, from, to])
                ]);
                if (!live) return;
                setReport({
                    key: selectedKey,
                    moments,
                    figures: groupFigures(group, txns),
                    before: rollBalances(balances, 'beforeKg'),
                    after: rollBalances(balances, 'afterKg'),
                    change: changeBreakdown(changes),
                    unacked: unackedCount(txns),
                    at: now
                });
            } catch (err) {
                if (live) { setError(err.message || String(err)); setReport(null); }
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [group, reloadKey]);

    if (listError) {
        return (
            <Card className="p-4 flex items-start gap-2 text-red-700 bg-red-50 border-red-200">
                <AlertCircle size={18} className="shrink-0 mt-0.5" />
                <span className="text-sm">Could not load the batches. {listError}</span>
            </Card>
        );
    }
    if (!batches) {
        return <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-amber-600" /></div>;
    }
    if (batches.length === 0) {
        return <Card className="p-6 text-center text-slate-500">No production batches yet.</Card>;
    }

    const shown = report && report.key === selectedKey && group.length > 0 ? report : null;
    const open = group.filter((b) => !isBatchClosed(b));

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 print:hidden">
                <BatchPicker
                    batches={batches}
                    selected={selectedIds}
                    onApply={(ids) => setParams({ batches: ids.join(',') }, { replace: true })}
                />
                <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} icon={RefreshCw} disabled={loading} className="flex-1 sm:flex-none">
                        Refresh
                    </Button>
                    <Button variant="outline" onClick={() => window.print()} icon={Printer} disabled={!shown} className="flex-1 sm:flex-none">
                        Print
                    </Button>
                </div>
            </div>

            {group.length === 0 && (
                <Card className="p-6 text-center text-slate-500 text-sm">Pick one or more batches to see the report.</Card>
            )}

            {error && (
                <Card className="p-4 flex items-start gap-2 text-red-700 bg-red-50 border-red-200">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span className="text-sm">Could not build the report. {error}</span>
                </Card>
            )}

            {loading && !shown && group.length > 0 && (
                <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-amber-600" /></div>
            )}

            {shown && (
                <Card className={`print:shadow-none print:border-slate-400 ${loading ? 'opacity-60' : ''}`}>
                    <div className="px-4 py-3 text-center border-b border-slate-200">
                        <h2 className="text-lg font-extrabold tracking-wide text-slate-900">BATCH WISE REPORT</h2>
                        <p className="text-xs text-slate-500">
                            {group.length === 1
                                ? `${group[0].name} · ${batchStatus(group[0])}`
                                : `Batches ${numbersText(group)} · ${group.map((b) => shortType(b.type)).join(', ')}`}
                        </p>
                    </div>

                    {(shown.unacked > 0 || open.length > 0) && (
                        <div className="px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-amber-800 text-xs space-y-1">
                            {open.length > 0 && (
                                <p className="flex gap-1.5">
                                    <AlertTriangle size={14} className="shrink-0" />
                                    {group.length === 1
                                        ? 'The leftover rolls are not back yet'
                                        : `${open.length === 1 ? 'Batch' : 'Batches'} ${numbersText(open)} ${open.length === 1 ? 'is' : 'are'} not closed yet`}
                                    , so the after balance is the godown as it stands now.
                                </p>
                            )}
                            {shown.unacked > 0 && (
                                <p className="flex gap-1.5">
                                    <AlertTriangle size={14} className="shrink-0" />
                                    {shown.unacked} movement{shown.unacked === 1 ? ' is' : 's are'} not yet acknowledged by the godown. They are in the batch figures but not in the balances.
                                </p>
                            )}
                        </div>
                    )}

                    <BalanceTable
                        title="Before balance"
                        caption={shown.moments.before != null
                            ? `Rolls godown just before the first roll was drawn · ${momentText(shown.moments.before)}`
                            : `Nothing drawn yet — rolls godown as of now · ${momentText(shown.at)}`}
                        balance={shown.before}
                    />

                    <BatchTable batches={group} group={shown.figures} />

                    <BalanceTable
                        title="After balance"
                        caption={shown.moments.after != null
                            ? `Rolls godown after the last roll movement · ${momentText(shown.moments.after)}`
                            : `Rolls godown as of now · ${momentText(shown.at)}`}
                        balance={shown.after}
                    />

                    <ChangeTable change={shown.change} many={group.length > 1} />

                    <p className="px-4 py-3 border-t border-slate-200 text-[11px] text-slate-500">
                        Balances and the change count acknowledged movements only. &ldquo;{group.length > 1 ? 'These batches' : 'This batch'}&rdquo;
                        is rolls drawn less rolls returned; &ldquo;New stock &amp; adj.&rdquo; is anything booked against no job. Waste is
                        roll kg less made kg less return; its percentage is of roll kg.
                    </p>
                </Card>
            )}
        </div>
    );
};

export default ProductionBatchReport;
