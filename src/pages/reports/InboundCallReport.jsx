import React, { useState, useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, Printer, ChevronsLeftRight, ChevronsRightLeft } from 'lucide-react';
import Card from '../../components/Card';
import Button from '../../components/Button';
import {
    INBOUND_PIVOT_SQL, pivot, orderPct, notOrderPct, notOrderCount, dateToGrist, reportRange, ORDER_STATUS, NOT_ORDER
} from '../../domain/telecalling/inboundCallReport';
import InboundCallsModal from './InboundCallsModal';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const dayText = (ts) => new Date(num(ts) * 1000).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const pctText = (pct) => (pct == null ? '—' : `${pct.toFixed(1)}%`);

// A share with the count it is taken from, the count kept quiet beside it.
const Share = ({ pct, count }) => (
    <>
        {pctText(pct)}
        {pct != null && <span className="ml-1 font-normal opacity-60">({count})</span>}
    </>
);

// The two shares drawn as bars growing out from the line between their cells:
// GIVEN fills green leftwards from its right edge, the rest fills red rightwards
// from its left edge, so a row's ratio reads at a glance. Kept on paper too
// (print-color-adjust).
const FILL = {
    given: { base: '#ecfdf5', bar: '#6ee7b7', side: 'to left' },     // emerald-50 / emerald-300
    notGiven: { base: '#fff1f2', bar: '#fda4af', side: 'to right' }  // rose-50 / rose-300
};
const barStyle = (pct, { base, bar, side }) => (pct == null
    ? { background: base }
    : { background: `linear-gradient(${side}, ${bar} ${pct}%, ${base} ${pct}%)` });

// On a phone the status columns wait behind "Show all statuses", so Total and
// the two shares fit on screen; from tablet up, and on paper, they always show.
const statusCellClass = (expanded) => (expanded ? '' : 'hidden sm:table-cell print:table-cell');

// A figure that opens the calls behind it. Zero has no calls to show, so it
// stays plain text.
const Pick = ({ count, onClick, children }) => (count > 0
    ? <button type="button" onClick={onClick} className="tabular-nums underline decoration-dotted decoration-slate-300 underline-offset-2 hover:text-teal-700 hover:decoration-teal-500 print:no-underline">{children}</button>
    : children);

// One line of figures: the total and the two shares first, then a count under
// each status (blank for none, so the numbers that matter stand out). `scope`
// is the line's day and person, and `onPick` opens the calls behind a figure;
// a share opens the calls it is counted from.
const Figures = ({ line, columns, strong, scope, onPick, expanded }) => {
    const pick = (status, count) => () => onPick({ ...scope, status, count });
    const orders = line.counts[ORDER_STATUS] || 0;
    const notOrders = notOrderCount(line);
    return (
        <>
            <td className="px-2 py-1.5 text-right tabular-nums font-semibold text-slate-900 bg-slate-50">
                <Pick count={line.total} onClick={pick(null, line.total)}>{line.total}</Pick>
            </td>
            <td className="px-2 py-1.5 text-right tabular-nums whitespace-nowrap font-semibold text-emerald-900 [print-color-adjust:exact]" style={barStyle(orderPct(line), FILL.given)}>
                <Pick count={orders} onClick={pick(ORDER_STATUS, orders)}><Share pct={orderPct(line)} count={orders} /></Pick>
            </td>
            <td className="px-2 py-1.5 text-left tabular-nums whitespace-nowrap font-semibold text-rose-900 [print-color-adjust:exact]" style={barStyle(notOrderPct(line), FILL.notGiven)}>
                <Pick count={notOrders} onClick={pick(NOT_ORDER, notOrders)}><Share pct={notOrderPct(line)} count={notOrders} /></Pick>
            </td>
            {columns.map((c) => (
                <td key={c} className={`px-2 py-1.5 text-right tabular-nums ${statusCellClass(expanded)} ${strong ? 'font-semibold text-slate-800' : 'text-slate-700'}`}>
                    <Pick count={line.counts[c] || 0} onClick={pick(c, line.counts[c])}>{line.counts[c] || ''}</Pick>
                </td>
            ))}
        </>
    );
};

// Inbound_Calls_Registry pivoted: day by day, who dealt with the calls,
// against what each call came to. The range lives in the URL (?from=&to=) so
// the report can be shared or reopened.
const InboundCallReport = ({ getHeaders, getUrl }) => {
    const [params, setParams] = useSearchParams();
    const { from, to } = reportRange(params.get('from'), params.get('to'));
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);
    const [picked, setPicked] = useState(null);
    const [expanded, setExpanded] = useState(false);

    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const headers = await getHeaders();
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql: INBOUND_PIVOT_SQL, args: [dateToGrist(from), dateToGrist(to)] })
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`Query failed (${res.status})${text ? ` — ${text}` : ''}`);
                }
                const data = ((await res.json()).records || []).map((r) => r.fields);
                if (live) setRows({ key: `${from}|${to}`, data });
            } catch (err) {
                if (live) setError(err.message || String(err));
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [from, to, reloadKey]);

    const report = useMemo(() => (rows ? pivot(rows.data) : null), [rows]);
    const setRange = (next) => setParams({ from, to, ...next }, { replace: true });
    const rangeText = `${dayText(dateToGrist(from))} – ${dayText(dateToGrist(to))}`;

    return (
        <div className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 print:hidden">
                <div className="flex gap-2 flex-1">
                    <label className="flex-1 min-w-0">
                        <span className="block text-xs text-slate-500 mb-0.5">From</span>
                        <input
                            type="date" value={from} max={to}
                            onChange={(e) => e.target.value && setRange({ from: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                    <label className="flex-1 min-w-0">
                        <span className="block text-xs text-slate-500 mb-0.5">To</span>
                        <input
                            type="date" value={to} min={from}
                            onChange={(e) => e.target.value && setRange({ to: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                        />
                    </label>
                </div>
                <div className="flex gap-2 sm:self-end">
                    <Button variant="outline" onClick={() => setReloadKey((k) => k + 1)} icon={RefreshCw} disabled={loading} className="flex-1 sm:flex-none">
                        Refresh
                    </Button>
                    <Button variant="outline" onClick={() => window.print()} icon={Printer} disabled={!report} className="flex-1 sm:flex-none">
                        Print
                    </Button>
                </div>
            </div>

            {error && (
                <Card className="p-4 flex items-start gap-2 text-red-700 bg-red-50 border-red-200">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span className="text-sm">Could not load the calls. {error}</span>
                </Card>
            )}

            {loading && !report && (
                <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-teal-600" /></div>
            )}

            {report && report.days.length === 0 && (
                <Card className="p-6 text-center text-slate-500 text-sm">No inbound calls between {dayText(dateToGrist(from))} and {dayText(dateToGrist(to))}.</Card>
            )}

            {report && report.days.length > 0 && (
                <Card className={`overflow-hidden print:shadow-none print:border-slate-400 ${loading ? 'opacity-60' : ''}`}>
                    <div className="px-4 py-3 text-center border-b border-slate-200">
                        <h2 className="text-lg font-extrabold tracking-wide text-slate-900">INBOUND CALL REGISTRY</h2>
                        <p className="text-xs text-slate-500">
                            {dayText(dateToGrist(from))} – {dayText(dateToGrist(to))} · {report.grand.total} calls · {pctText(orderPct(report.grand))} given order
                        </p>
                    </div>
                    <div className="px-3 py-2 border-b border-slate-200 flex justify-end sm:hidden print:hidden">
                        <button
                            type="button"
                            onClick={() => setExpanded((x) => !x)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 text-xs font-semibold text-teal-700 hover:bg-teal-50"
                        >
                            {expanded
                                ? <><ChevronsRightLeft size={14} />Summary only</>
                                : <><ChevronsLeftRight size={14} />Show all {report.columns.length} statuses</>}
                        </button>
                    </div>
                    <div className="overflow-x-auto">
                        <table className="min-w-full text-xs border-collapse">
                            <thead>
                                <tr className="border-b border-slate-200 bg-slate-50 text-slate-600 align-bottom">
                                    <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold">Date / Dealt by</th>
                                    <th className="px-2 py-2 text-right font-bold text-slate-800 bg-slate-100">Total</th>
                                    <th className="px-2 py-2 text-right font-bold text-emerald-800 bg-emerald-100 leading-tight min-w-[4.5rem]">% Given order</th>
                                    <th className="px-2 py-2 text-left font-bold text-rose-800 bg-rose-100 leading-tight min-w-[4.5rem]">% Not given</th>
                                    {report.columns.map((c) => (
                                        <th key={c} className={`px-2 py-2 text-right font-semibold min-w-[4.5rem] max-w-[6.5rem] leading-tight ${statusCellClass(expanded)}`}>{c}</th>
                                    ))}
                                </tr>
                            </thead>
                            {report.days.map((d) => (
                                <tbody key={d.day} className="border-b border-slate-300">
                                    <tr className="bg-teal-50/60">
                                        <th className="sticky left-0 z-10 bg-teal-50 px-3 py-1.5 text-left font-bold text-slate-900 whitespace-nowrap">{dayText(d.day)}</th>
                                        <Figures line={d} columns={report.columns} strong scope={{ day: d.day, label: dayText(d.day) }} onPick={setPicked} expanded={expanded} />
                                    </tr>
                                    {d.people.map((p) => (
                                        <tr key={p.id} className="border-t border-slate-100">
                                            <td className="sticky left-0 z-10 bg-white pl-6 pr-3 py-1.5 text-slate-600 whitespace-nowrap">{p.name}</td>
                                            <Figures line={p} columns={report.columns} scope={{ day: d.day, dealtBy: p.id, label: `${dayText(d.day)} · ${p.name}` }} onPick={setPicked} expanded={expanded} />
                                        </tr>
                                    ))}
                                </tbody>
                            ))}
                            <tfoot>
                                <tr className="border-t-2 border-slate-400 bg-slate-100">
                                    <th className="sticky left-0 z-10 bg-slate-100 px-3 py-2 text-left font-extrabold text-slate-900">Grand total</th>
                                    <Figures line={report.grand} columns={report.columns} strong scope={{ label: rangeText }} onPick={setPicked} expanded={expanded} />
                                </tr>
                            </tfoot>
                        </table>
                    </div>
                    <p className="px-4 py-3 border-t border-slate-200 text-[11px] text-slate-500">
                        Tap a figure to see the calls behind it. Calls are dated by the day they came in (Created_Date). % Given order is GIVEN ORDER out of every call in
                        the row, including calls with no status yet; % Not given is the rest of the row. The green and red fills
                        are those two shares: the more green across a row, the more of its calls gave an order. &ldquo;Not dealt yet&rdquo; is calls no one has updated.
                    </p>
                </Card>
            )}

            {picked && (
                <InboundCallsModal
                    range={{ from, to }}
                    cell={{ day: picked.day ?? null, dealtBy: picked.dealtBy ?? null, status: picked.status }}
                    title={[picked.label, picked.status || 'All statuses'].join(' · ')}
                    expected={picked.count}
                    onClose={() => setPicked(null)}
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                />
            )}
        </div>
    );
};

export default InboundCallReport;
