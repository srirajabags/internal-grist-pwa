import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, RefreshCw, Share2, Copy, MapPin, ChevronDown, X } from 'lucide-react';
import Card from '../../components/Card';
import {
    ORDER_MIX_SQL, buildOrderMix, monthRange, monthBounds, monthLabel, istMonth, KINDS, KIND_LABEL,
    parseAreas, areasParam, areasLabel
} from '../../domain/orders/orderMix';
import { rupees, compactRupees } from '../../utils/money';
import { shareElementImage, copyElementImage } from '../../services/shareImage';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const ALL = 'all';

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

// A phone is too narrow for five columns of full rupees, so below the sm
// breakpoint figures are short (₹3.56L) and the count is a bare number; the
// card header says what the two lines are.
const Money = ({ value }) => (
    <>
        <span className="sm:hidden">{compactRupees(value)}</span>
        <span className="hidden sm:inline">{rupees(value)}</span>
    </>
);

// One figure: the value, with the order count under it. Blank when nothing.
// A rule on its left keeps the columns apart.
const Cell = ({ figure, strong }) => (
    <td className={`pl-1 sm:pl-2 ${strong ? 'pr-3 sm:pr-3' : 'pr-1 sm:pr-2'} py-2 text-right tabular-nums align-top whitespace-nowrap border-l border-emerald-300`}>
        {figure.orders ? (
            <>
                <div className={strong ? 'font-bold text-slate-900' : 'text-slate-800'}><Money value={figure.value} /></div>
                <div className="text-[10px] text-slate-500">
                    {figure.orders}<span className="hidden sm:inline"> order{figure.orders === 1 ? '' : 's'}</span>
                </div>
            </>
        ) : <span className="text-slate-300">–</span>}
    </td>
);

// Fixed widths, so the table fits the card instead of growing past it: the
// name column takes 30% ("Mahabubnagar" whole on a 360px phone); the four figures share the rest.
const Cols = () => (
    <colgroup>
        <col className="w-[30%]" />
        {[...KINDS, 'total'].map((k) => <col key={k} />)}
    </colgroup>
);

const Head = ({ first }) => (
    <thead>
        <tr className="bg-emerald-700 text-white">
            <th className="pl-2.5 sm:pl-3 pr-1 py-2 text-left font-semibold">{first}</th>
            {KINDS.map((k) => <th key={k} className="px-1 sm:px-2 py-2 text-right font-semibold border-l border-emerald-600">{KIND_LABEL[k]}</th>)}
            <th className="pl-1 sm:pl-2 pr-2.5 sm:pr-3 py-2 text-right font-semibold border-l border-emerald-600">Total</th>
        </tr>
    </thead>
);

// Rows alternate white and green (`striped`) so a long table keeps its lines;
// the month picked for the area table is amber, so it never reads as a stripe.
const rowBg = ({ foot, active, striped }) => {
    if (foot) return 'bg-emerald-200';
    if (active) return 'bg-amber-100';
    return striped ? 'bg-emerald-100/70' : 'bg-white';
};

const Line = ({ label, line, onClick, active, foot, striped }) => (
    <tr
        onClick={onClick}
        className={`${foot ? 'border-t-2 border-emerald-400' : 'border-t border-emerald-100'} ${rowBg({ foot, active, striped })} ${onClick ? 'cursor-pointer hover:bg-amber-50' : ''}`}
    >
        <td className={`pl-2.5 sm:pl-3 pr-1 py-2 align-top break-words ${foot || active ? 'font-bold text-slate-900' : 'text-slate-800'}`}>{label}</td>
        {KINDS.map((k) => <Cell key={k} figure={line[k]} />)}
        <Cell figure={line.total} strong />
    </tr>
);

// Under the card title on a phone: how to read a cell.
const PhoneKey = () => (
    <p className="sm:hidden text-[10px] text-slate-500">Each cell: value (L = lakh, Cr = crore), order count below.</p>
);

// Top right of a card: the card as a picture, copied (for WhatsApp Web or
// desktop) or sent through the share sheet (WhatsApp on a phone). Hidden
// while the picture is drawn, so they are not in it.
const PictureButtons = ({ onCopy, onShare, busy }) => (
    <div className="shrink-0 flex gap-1.5">
        <button
            type="button" onClick={onCopy} disabled={busy} title="Copy image"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-emerald-600 text-emerald-700 bg-white text-xs font-semibold hover:bg-emerald-50 disabled:opacity-60"
        >
            <Copy size={14} />Copy
        </button>
        <button
            type="button" onClick={onShare} disabled={busy} title="Share image"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-700 disabled:opacity-60"
        >
            <Share2 size={14} />Share
        </button>
    </div>
);

// A card is drawn at least this wide for its picture: text comes out a little
// wider in the picture than on screen, and a 360px phone's columns have no
// room to spare. Also gives WhatsApp a sharper image.
const CAPTURE_STYLE = { minWidth: 420 };

// Only in the shared picture: what it is, as the page header is not in it.
const Caption = ({ show, areas }) => (show ? (
    <p className="text-[11px] font-semibold text-emerald-700">
        Sri Raja Bags · Regular, Other &amp; New Orders · {areasLabel(areas)}
    </p>
) : null);

// Orders by month and area group, split into Regular customers' repeat orders,
// other customers' repeat orders, and new orders.
const OrderMixReport = ({ getHeaders, getUrl }) => {
    const [params, setParams] = useSearchParams();
    const range = monthRange(params.get('from'), params.get('to'));
    const current = istMonth();
    const [rows, setRows] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [reloadKey, setReloadKey] = useState(0);

    useEffect(() => {
        let live = true;
        (async () => {
            setLoading(true);
            setError(null);
            try {
                const b = monthBounds(range);
                const result = await sql(getHeaders, getUrl, ORDER_MIX_SQL, [b.from, b.to]);
                if (live) setRows(result);
            } catch (err) {
                if (live) setError(err.message || String(err));
            } finally {
                if (live) setLoading(false);
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [range.from, range.to, reloadKey]);

    // Area groups chosen in the filter (?areas=Adoni|Guntur); none means all.
    const areasText = params.get('areas') || '';
    const areas = useMemo(() => parseAreas(areasText), [areasText]);
    const mix = useMemo(() => (rows ? buildOrderMix(rows, areas) : null), [rows, areas]);
    // The filter offers every area group with orders in the months shown, and
    // keeps a chosen one listed even if it has none, so it can be unticked.
    const areaOptions = useMemo(() => {
        const names = rows ? buildOrderMix(rows).areas.map((a) => a.area) : [];
        return [...names, ...areas.filter((a) => !names.includes(a))];
    }, [rows, areas]);
    const [filterOpen, setFilterOpen] = useState(false);

    const setParam = (changes) => {
        const next = new URLSearchParams(params);
        Object.entries(changes).forEach(([k, v]) => (v ? next.set(k, v) : next.delete(k)));
        setParams(next, { replace: true });
    };
    // The area table shows one month, or the whole range ("all", the default).
    const picked = params.get('month');
    const month = mix?.months.find((m) => m.month === picked) || null;
    const areaRows = month ? month.areas : mix?.areas || [];
    const areaTotal = month || mix?.total;
    const pick = (m) => setParam({ month: m === ALL ? null : m });
    const setAreas = (next) => setParam({ areas: areasParam(next), month: null });
    const toggleArea = (a) => setAreas(areas.includes(a) ? areas.filter((x) => x !== a) : [...areas, a]);

    // Sharing: which card is being drawn (it shows its caption meanwhile), and
    // a line saying what happened when the picture was saved, not shared.
    const monthCard = useRef(null);
    const areaCard = useRef(null);
    const [sharing, setSharing] = useState(null);
    const [shareNote, setShareNote] = useState(null);
    const rangeText = `${monthLabel(range.from)}${range.from !== range.to ? ` – ${monthLabel(range.to)}` : ''}`;
    // Shows the card's caption (and hides its buttons) for the picture, then
    // shares or copies it. Copy starts the clipboard write inside the tap, as
    // Safari requires, and lets it wait for the caption itself.
    const run = (which, mode) => {
        const el = (which === 'month' ? monthCard : areaCard).current;
        if (!el) return;
        const title = which === 'month'
            ? `Month wise · ${rangeText}`
            : `Area group wise · ${month ? monthLabel(month.month) : rangeText}`;
        setSharing(which);
        setShareNote(null);
        // Two frames, so the caption is on screen before it is drawn.
        const ready = new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const job = mode === 'copy'
            ? copyElementImage(el, { before: ready })
            : ready.then(() => shareElementImage(el, { title }));
        job.then((how) => {
            if (how === 'copied') setShareNote('Image copied. Paste it in WhatsApp.');
            else if (how === 'unsupported') setShareNote('This browser cannot copy images. Use Share instead.');
            else if (how === 'downloaded') setShareNote('Image saved. Attach it in WhatsApp from your downloads.');
        }).catch((err) => {
            setShareNote(`Could not make the image. ${err?.message || err}`);
        }).finally(() => setSharing(null));
    };

    const inputClass = 'w-full px-3 py-2 rounded-lg border border-slate-300 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500';

    return (
        <div className="space-y-4">
            <div className="flex items-end gap-2">
                <label className="flex-1 min-w-0">
                    <span className="block text-xs text-slate-500 mb-0.5">From</span>
                    <input type="month" value={range.from} max={current} className={inputClass}
                        onChange={(e) => e.target.value && setParam({ from: e.target.value, month: null })} />
                </label>
                <label className="flex-1 min-w-0">
                    <span className="block text-xs text-slate-500 mb-0.5">To</span>
                    <input type="month" value={range.to} max={current} className={inputClass}
                        onChange={(e) => e.target.value && setParam({ to: e.target.value, month: null })} />
                </label>
                <button
                    type="button" onClick={() => setReloadKey((k) => k + 1)} disabled={loading} aria-label="Refresh" title="Refresh"
                    className="shrink-0 p-2.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                    <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                </button>
            </div>

            <div className="bg-white rounded-xl border border-slate-200">
                <button
                    type="button" onClick={() => setFilterOpen((o) => !o)} aria-expanded={filterOpen}
                    className="w-full flex items-center gap-2 px-3 py-2.5 text-left"
                >
                    <MapPin size={16} className="text-emerald-600 shrink-0" />
                    <span className="text-xs text-slate-500 shrink-0">Area groups</span>
                    <span className={`flex-1 min-w-0 truncate text-sm ${areas.length ? 'font-semibold text-emerald-700' : 'text-slate-800'}`}>
                        {areasLabel(areas)}
                    </span>
                    <ChevronDown size={16} className={`text-slate-400 shrink-0 transition-transform ${filterOpen ? 'rotate-180' : ''}`} />
                </button>
                {areas.length > 0 && !filterOpen && (
                    <div className="flex flex-wrap gap-1.5 px-3 pb-2.5">
                        {areas.map((a) => (
                            <button key={a} type="button" onClick={() => toggleArea(a)}
                                className="inline-flex items-center gap-1 pl-2.5 pr-1.5 py-1 rounded-full bg-emerald-600 text-white text-xs">
                                {a}<X size={12} />
                            </button>
                        ))}
                        <button type="button" onClick={() => setAreas([])} className="px-2 py-1 text-xs text-slate-500 underline">Clear</button>
                    </div>
                )}
                {filterOpen && (
                    <div className="border-t border-slate-100 px-3 py-2.5 space-y-2">
                        <div className="flex flex-wrap gap-1.5">
                            <button
                                type="button" onClick={() => setAreas([])} aria-pressed={!areas.length}
                                className={`px-2.5 py-1 rounded-full border text-xs ${!areas.length ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                            >
                                All
                            </button>
                            {areaOptions.map((a) => {
                                const on = areas.includes(a);
                                return (
                                    <button
                                        key={a} type="button" onClick={() => toggleArea(a)} aria-pressed={on}
                                        className={`px-2.5 py-1 rounded-full border text-xs ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                                    >
                                        {a}
                                    </button>
                                );
                            })}
                        </div>
                        <div className="flex justify-end">
                            <button type="button" onClick={() => setFilterOpen(false)}
                                className="px-3 py-1.5 rounded-lg bg-slate-800 text-white text-xs font-semibold">Done</button>
                        </div>
                    </div>
                )}
            </div>

            {sharing && <p className="px-1 text-xs text-slate-500 inline-flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" />Making the image…</p>}
            {shareNote && (
                <p className="px-1 text-xs text-emerald-800">{shareNote}</p>
            )}

            {error && (
                <Card className="p-4 flex items-start gap-2 text-red-700 bg-red-50 border-red-200">
                    <AlertCircle size={18} className="shrink-0 mt-0.5" />
                    <span className="text-sm">Could not load the orders. {error}</span>
                </Card>
            )}

            {loading && !mix && (
                <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-sky-600" /></div>
            )}

            {mix && (
                <Card ref={monthCard} className={loading ? 'opacity-60' : ''} style={sharing === 'month' ? CAPTURE_STYLE : undefined}>
                    <div className="px-4 py-3 border-b border-slate-200">
                        <Caption show={sharing === 'month'} areas={areas} />
                        <div className="flex items-start gap-2">
                            <h2 className="flex-1 min-w-0 text-base font-extrabold text-slate-900">Month wise</h2>
                            {mix.months.length > 0 && sharing !== 'month' && (
                                <PictureButtons onCopy={() => run('month', 'copy')} onShare={() => run('month', 'share')} busy={!!sharing} />
                            )}
                        </div>
                        <p className="text-xs text-slate-500">
                            {rangeText} · {mix.total.total.orders} orders · {rupees(mix.total.total.value)}
                        </p>
                        {areas.length > 0 && sharing !== 'month' && <p className="text-xs font-semibold text-emerald-700">{areasLabel(areas)}</p>}
                        <PhoneKey />
                    </div>
                    {mix.months.length === 0 ? (
                        <p className="px-4 py-6 text-center text-sm text-slate-500">
                            No orders in these months{areas.length ? ' for these area groups' : ''}.
                        </p>
                    ) : (
                        <table className="w-full table-fixed text-[11px] sm:text-xs border-collapse">
                            <Cols />
                            <Head first="Month" />
                            <tbody>
                                {mix.months.map((m, i) => (
                                    <Line key={m.month} striped={i % 2 === 1} label={monthLabel(m.month)} line={m} active={month?.month === m.month}
                                        onClick={() => pick(month?.month === m.month ? ALL : m.month)} />
                                ))}
                            </tbody>
                            {mix.months.length > 1 && (
                                <tfoot><Line label="Total" line={mix.total} foot /></tfoot>
                            )}
                        </table>
                    )}
                </Card>
            )}

            {mix && mix.months.length > 0 && (
                <Card ref={areaCard} className={loading ? 'opacity-60' : ''} style={sharing === 'area' ? CAPTURE_STYLE : undefined}>
                    <div className="px-4 py-3 border-b border-slate-200 space-y-2">
                        <Caption show={sharing === 'area'} areas={areas} />
                        <div className="flex items-start gap-2">
                            <h2 className="flex-1 min-w-0 text-base font-extrabold text-slate-900">
                                Area group wise · {month ? monthLabel(month.month) : rangeText}
                            </h2>
                            {sharing !== 'area' && (
                                <PictureButtons onCopy={() => run('area', 'copy')} onShare={() => run('area', 'share')} busy={!!sharing} />
                            )}
                        </div>
                        <PhoneKey />
                        {mix.months.length > 1 && sharing !== 'area' && (
                            <div className="flex flex-wrap gap-1.5">
                                {[ALL, ...mix.months.map((m) => m.month)].map((m) => {
                                    const on = m === ALL ? !month : month?.month === m;
                                    return (
                                        <button
                                            key={m} type="button" onClick={() => pick(m)} aria-pressed={on}
                                            className={`px-2.5 py-1 rounded-full border text-xs ${on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 bg-white text-slate-700'}`}
                                        >
                                            {m === ALL ? 'All months' : monthLabel(m)}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <table className="w-full table-fixed text-[11px] sm:text-xs border-collapse">
                        <Cols />
                        <Head first="Area group" />
                        <tbody>
                            {areaRows.map((a, i) => <Line key={a.area} striped={i % 2 === 1} label={a.area} line={a} />)}
                        </tbody>
                        <tfoot><Line label="Total" line={areaTotal} foot /></tfoot>
                    </table>
                </Card>
            )}

            {mix && (
                <p className="px-1 text-[11px] leading-relaxed text-slate-500">
                    New is an order with Is Repeat Order unticked: the customer&rsquo;s first order. Every other order is Regular when the customer&rsquo;s
                    Temp Fallback Sales Category is REGULAR, and Other when it is anything else or blank. A first order counts as New even if that customer is
                    Regular now. The category is read as it stands today, so a customer tagged Regular this week shows as Regular in earlier months too.
                    Orders are dated by Order Form Date and placed by the order&rsquo;s Area Group. Tap a month to see its area groups; Area groups narrows both
                    tables. Copy puts a table on the clipboard as one picture, to paste in WhatsApp; Share sends it through the phone&rsquo;s share sheet (on a computer
                    without one, the picture is saved instead).
                </p>
            )}
        </div>
    );
};

export default OrderMixReport;
