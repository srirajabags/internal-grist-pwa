import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import ReactECharts from 'echarts-for-react';
import { Loader2, AlertCircle, RefreshCw } from 'lucide-react';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { dateToGrist, istDay } from '../../domain/telecalling/inboundCallReport';
import {
    ENQUIRIES_SQL, ORDERS_SQL, creditOrders, dayTable, trend, tableDay, fetchRange, TREND_DAYS, NO_SOURCE
} from '../../domain/telecalling/sourceReport';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const dayText = (ts) => new Date(num(ts) * 1000).toLocaleDateString('en-IN', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC'
});
const shortDay = (ts) => new Date(num(ts) * 1000).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const rupees = (v) => `₹${Math.round(num(v)).toLocaleString('en-IN')}`;
const shortRupees = (v) => (v >= 100000 ? `₹${+(v / 100000).toFixed(1)}L` : v >= 1000 ? `₹${+(v / 1000).toFixed(1)}k` : `₹${v}`);
const toText = (ts) => new Date(num(ts) * 1000).toISOString().slice(0, 10);

// Each source keeps its colour whatever else is on screen (a source missing
// from the fortnight does not shift the others). Validated categorical order;
// "No source" is the neutral grey, as it is an absence, not a channel.
const COLOR = {
    Website: '#2a78d6',
    'Google Ads': '#eb6834',
    'WhatsApp API': '#1baf7a',
    'AI Calls': '#eda100',
    'Team WhatsApp': '#e87ba4',
    'Team call': '#008300',
    Other: '#6250d6',
    [NO_SOURCE]: '#a3a3a3'
};

const sql = async (getHeaders, getUrl, query, args) => {
    const headers = await getHeaders();
    const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: query, args })
    });
    if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`Query failed (${res.status})${text ? ` — ${text}` : ''}`);
    }
    return ((await res.json()).records || []).map((r) => r.fields);
};

// Before a source's first enquiry it did not exist yet (Source was only filled
// from 29 Oct 2026), so those days are left blank rather than drawn as zeros.
const fromFirst = (values, first) => values.map((v, i) => (i < first ? null : v));

// One panel, two plots on a shared day axis: order value as stacked bars on
// top, and below it orders (solid) and enquiries (dotted) as counts. Rupees
// and counts never share a scale, and the three series of a source share its
// name, so one legend chip shows or hides all three.
const chartOption = ({ days, sources }, selected) => {
    const labels = days.map(shortDay);
    const axisLabel = { fontSize: 10, color: '#64748b' };
    const split = { lineStyle: { color: '#f1f5f9' } };
    const series = sources.flatMap((s) => {
        const first = s.source === NO_SOURCE ? 0 : Math.max(0, s.enquiries.findIndex((n, i) => n || s.orders[i]));
        return [
            {
                name: s.source, type: 'bar', stack: 'value', xAxisIndex: 0, yAxisIndex: 0,
                data: fromFirst(s.value, first), itemStyle: { color: COLOR[s.source], borderColor: '#fff', borderWidth: 1 },
                barMaxWidth: 18
            },
            {
                name: s.source, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: fromFirst(s.orders, first),
                lineStyle: { width: 2, color: COLOR[s.source] }, itemStyle: { color: COLOR[s.source] },
                symbol: 'circle', symbolSize: 6, showSymbol: true
            },
            {
                name: s.source, type: 'line', xAxisIndex: 1, yAxisIndex: 1, data: fromFirst(s.enquiries, first),
                lineStyle: { width: 2, type: 'dotted', color: COLOR[s.source] }, itemStyle: { color: COLOR[s.source] },
                // A marker on every point: a source's first day is a single
                // point, which a markerless line would not draw at all.
                symbol: 'emptyCircle', symbolSize: 6, showSymbol: true
            }
        ];
    });
    return {
        animation: false,
        // Drawn as chips above the chart, which are easier to tap on a phone;
        // the hidden legend still carries which sources are switched on.
        legend: { show: false, data: sources.map((s) => s.source), selected },
        tooltip: {
            trigger: 'axis', confine: true, axisPointer: { type: 'line', link: [{ xAxisIndex: 'all' }] },
            textStyle: { fontSize: 11 },
            formatter: (items) => {
                const i = items[0]?.dataIndex;
                if (i == null) return '';
                const shown = new Set(items.map((it) => it.seriesName));
                const lines = sources
                    .filter((s) => shown.has(s.source) && (s.enquiries[i] || s.orders[i]))
                    .map((s) => `<span style="display:inline-block;width:8px;height:8px;border-radius:2px;background:${COLOR[s.source]};margin-right:4px"></span>`
                        + `${s.source}: ${s.enquiries[i]} enq · ${s.orders[i]} order${s.orders[i] === 1 ? '' : 's'}${s.value[i] ? ` · ${rupees(s.value[i])}` : ''}`);
                return `<b>${dayText(days[i])}</b><br/>${lines.join('<br/>') || 'Nothing logged'}`;
            }
        },
        axisPointer: { link: [{ xAxisIndex: 'all' }] },
        grid: [
            { left: 44, right: 10, top: 12, height: '40%' },
            { left: 44, right: 10, top: '58%', bottom: 28 }
        ],
        xAxis: [
            { type: 'category', gridIndex: 0, data: labels, axisLabel: { show: false }, axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } } },
            { type: 'category', gridIndex: 1, data: labels, axisLabel, axisTick: { show: false }, axisLine: { lineStyle: { color: '#cbd5e1' } } }
        ],
        yAxis: [
            { type: 'value', gridIndex: 0, axisLabel: { ...axisLabel, formatter: shortRupees }, splitLine: split, splitNumber: 3 },
            { type: 'value', gridIndex: 1, minInterval: 1, axisLabel, splitLine: split, splitNumber: 3 }
        ],
        series
    };
};

// A small sample of each mark, so the key reads like the chart.
const Key = () => (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-slate-600">
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-2.5 h-3 rounded-sm bg-slate-500" />Order value</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-slate-500" />Orders</span>
        <span className="inline-flex items-center gap-1.5"><span className="inline-block w-5 border-t-2 border-dotted border-slate-500" />Enquiries</span>
    </div>
);

// The registry's enquiries by Source, and what they turned into: the table is
// one day (?day=, today by default); the chart is the last fortnight.
const EnquirySourceReport = ({ getHeaders, getUrl }) => {
    const [params, setParams] = useSearchParams();
    const day = tableDay(params.get('day'));
    const today = istDay();
    const range = fetchRange(day);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const [enquiries, orders] = await Promise.all([
                    sql(getHeaders, getUrl, ENQUIRIES_SQL, [range.from, range.to]),
                    sql(getHeaders, getUrl, ORDERS_SQL, [range.from, range.to, range.from, range.to])
                ]);
                if (live) setData({ enquiries, credited: creditOrders(enquiries, orders), trendFrom: range.trendFrom, to: range.to });
            } catch (err) {
                if (live) setError(err.message || String(err));
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to, reloadKey]);

    const table = useMemo(() => (data ? dayTable(data.enquiries, data.credited, dateToGrist(day)) : null), [data, day]);
    const fortnight = useMemo(() => (data ? trend(data.enquiries, data.credited, data.trendFrom, data.to) : null), [data]);
    // No source starts switched off: it is every row before 29 Oct 2026 and
    // would dwarf the sources the report is about. One tap brings it back.
    const [hidden, setHidden] = useState(() => new Set([NO_SOURCE]));
    const toggle = (source) => setHidden((h) => {
        const next = new Set(h);
        if (next.has(source)) next.delete(source); else next.add(source);
        return next;
    });
    const option = useMemo(() => (fortnight
        ? chartOption(fortnight, Object.fromEntries(fortnight.sources.map((s) => [s.source, !hidden.has(s.source)])))
        : null), [fortnight, hidden]);
    const setDay = (next) => setParams(next === today ? {} : { day: next }, { replace: true });

    // Tapping a day on the chart opens that day's table above it. The chart is
    // set up once, so it reads the days through a ref, not the first render's.
    const daysRef = useRef([]);
    daysRef.current = fortnight?.days || [];
    const setDayRef = useRef(setDay);
    setDayRef.current = setDay;
    const onChartReady = (chart) => {
        chart.getZr().on('click', (e) => {
            const [i] = chart.convertFromPixel({ xAxisIndex: 1 }, [e.offsetX, e.offsetY]) || [];
            const t = daysRef.current[Math.round(i)];
            if (t != null) setDayRef.current(toText(t));
        });
    };

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-2">
                <label className="flex-1 min-w-0">
                    <span className="block text-xs text-slate-500 mb-0.5">Day</span>
                    <input
                        type="date" value={day} max={today}
                        onChange={(e) => e.target.value && setDay(e.target.value)}
                        className="w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                </label>
                {day !== today && (
                    <Button variant="outline" onClick={() => setDay(today)} className="shrink-0">Today</Button>
                )}
                <button
                    type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} aria-label="Refresh" title="Refresh"
                    className="shrink-0 p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            {error && (
                <Card className="p-4 flex items-start gap-2 text-red-700 bg-red-50 border-red-200">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span className="text-sm">Could not load the enquiries. {error}</span>
                </Card>
            )}

            {loading && !data && (
                <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-teal-600" /></div>
            )}

            {table && (
                <Card className={loading ? 'opacity-60' : ''}>
                    <div className="px-4 py-3 border-b border-slate-200">
                        <h2 className="text-base font-extrabold text-slate-900">{dayText(dateToGrist(day))}</h2>
                        <p className="text-xs text-slate-500">
                            {table.total.enquiries} enquiries · {table.total.orders} order{table.total.orders === 1 ? '' : 's'} · {rupees(table.total.value)}
                        </p>
                    </div>
                    {table.rows.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">No enquiries logged on this day.</p>
                    ) : (
                        <table className="w-full text-xs border-collapse">
                            <thead>
                                <tr className="bg-slate-50 text-slate-600 border-b border-slate-200">
                                    <th className="px-3 py-2 text-left font-semibold">Source</th>
                                    <th className="px-1.5 py-2 text-right font-semibold">Enq.</th>
                                    <th className="px-1.5 py-2 text-right font-semibold">Matched</th>
                                    <th className="px-1.5 py-2 text-right font-semibold">Orders</th>
                                    <th className="pl-1.5 pr-3 py-2 text-right font-semibold">Value</th>
                                </tr>
                            </thead>
                            <tbody>
                                {table.rows.map((r) => (
                                    <tr key={r.source} className="border-t border-slate-100">
                                        <td className="px-3 py-2 text-slate-800">
                                            <span className="inline-block w-2 h-2 rounded-sm mr-1.5 align-middle" style={{ background: COLOR[r.source] }} />
                                            {r.source}
                                        </td>
                                        <td className="px-1.5 py-2 text-right tabular-nums">{r.enquiries}</td>
                                        <td className="px-1.5 py-2 text-right tabular-nums text-slate-600">{r.matched}</td>
                                        <td className="px-1.5 py-2 text-right tabular-nums">{r.orders || ''}</td>
                                        <td className="pl-1.5 pr-3 py-2 text-right tabular-nums font-semibold text-slate-900">{r.value ? rupees(r.value) : ''}</td>
                                    </tr>
                                ))}
                            </tbody>
                            <tfoot>
                                <tr className="border-t-2 border-slate-300 bg-slate-50 font-bold text-slate-900">
                                    <td className="px-3 py-2">Total</td>
                                    <td className="px-1.5 py-2 text-right tabular-nums">{table.total.enquiries}</td>
                                    <td className="px-1.5 py-2 text-right tabular-nums">{table.total.matched}</td>
                                    <td className="px-1.5 py-2 text-right tabular-nums">{table.total.orders}</td>
                                    <td className="pl-1.5 pr-3 py-2 text-right tabular-nums">{rupees(table.total.value)}</td>
                                </tr>
                            </tfoot>
                        </table>
                    )}
                </Card>
            )}

            {option && (
                <Card className={`p-3 space-y-2 ${loading ? 'opacity-60' : ''}`}>
                    <h2 className="text-sm font-bold text-slate-900">Last {TREND_DAYS} days</h2>
                    <Key />
                    <div className="flex flex-wrap gap-1.5 pt-1">
                        {fortnight.sources.map(({ source }) => {
                            const on = !hidden.has(source);
                            return (
                                <button
                                    key={source} type="button" onClick={() => toggle(source)} aria-pressed={on}
                                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-xs ${on ? 'border-slate-300 bg-white text-slate-800' : 'border-dashed border-slate-300 bg-slate-50 text-slate-400'}`}
                                >
                                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: on ? COLOR[source] : '#e2e8f0' }} />
                                    {source}
                                </button>
                            );
                        })}
                    </div>
                    <ReactECharts option={option} notMerge onChartReady={onChartReady} style={{ height: 380, width: '100%' }} />
                </Card>
            )}

            {data && (
                <p className="px-1 text-[11px] leading-relaxed text-slate-500">
                    Enquiries are the Inbound Call Registry by Source; the team numbers are folded into Team WhatsApp (&ldquo;- W&rdquo;) and Team call (&ldquo;- P&rdquo;).
                    Matched is an enquiry whose phone number is a customer&rsquo;s. An order counts for the customer&rsquo;s latest enquiry on or before the order&rsquo;s
                    date, once, so the table shows what a day&rsquo;s enquiries have led to so far, and the chart dates orders by Order Form Date. Source was first filled
                    on 29 Oct 2026; earlier rows are No source, which the chart leaves off until you tap it. Tap a day on the chart to see its table; tap a source above the
                    chart to show or hide it.
                </p>
            )}
        </div>
    );
};

export default EnquirySourceReport;
