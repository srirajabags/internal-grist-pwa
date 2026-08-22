import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, ArrowDownLeft, ArrowUpRight, Sparkles, Clock, Factory } from 'lucide-react';
import { ItemVisual } from './itemVisuals';
import { typeName } from '../utils/itemForms';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';

// Transaction_Time is a DateTime (epoch seconds).
const dayKey = (ts) => {
    const d = new Date(num(ts) * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};

// A transaction moves weight, a count, or both — show whichever it recorded.
const changeText = (t, countUnit) => {
    const parts = [];
    if (num(t.wkg)) parts.push(`${t.wkg > 0 ? '+' : '−'}${fmtKg(Math.abs(t.wkg))} kg`);
    if (num(t.cbund)) parts.push(`${t.cbund > 0 ? '+' : '−'}${Math.abs(num(t.cbund))} ${countUnit}`);
    return parts.join(' · ') || '—';
};

const TYPE_STYLE = {
    'ADD': { dot: 'bg-emerald-500', text: 'text-emerald-700', ring: 'ring-emerald-200 bg-emerald-50', Icon: ArrowDownLeft },
    'NEW STOCK': { dot: 'bg-sky-500', text: 'text-sky-700', ring: 'ring-sky-200 bg-sky-50', Icon: Sparkles },
    'LESS': { dot: 'bg-rose-500', text: 'text-rose-700', ring: 'ring-rose-200 bg-rose-50', Icon: ArrowUpRight }
};
const styleFor = (type) => TYPE_STYLE[String(type || '').toUpperCase()] || TYPE_STYLE.ADD;

const Total = ({ label, value, tone }) => (
    <div className="bg-white rounded-lg border border-slate-200 px-3 py-1.5">
        <span className="text-[11px] text-slate-400 mr-2">{label}</span>
        <span className={`font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
);

// The full transaction history behind one inventory row: every ADD / LESS / NEW
// STOCK against that item code (and physical item, on the rolls tab) in that
// godown, oldest first for the running balance, newest first on screen.
const InventoryTxnModal = ({ row, qty, onClose, getHeaders, getUrl }) => {
    const countUnit = qty?.countUnit || 'bundles';
    const [txns, setTxns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const headers = await getHeaders();
                // The rolls tab is per physical item; the item-code tab rolls every
                // physical item of that code together.
                const byItem = row.item_ref != null;
                const sql = `
                    SELECT t.id AS id, t.Transaction_Time AS ts, t.Transaction_Type AS type,
                           t.Weight_Change_Kg_ AS wkg, t.Count_Change_Bundle_ AS cbund,
                           t.Incharge_Ack AS ack, it.Item_ID AS iid,
                           t.Production_Job AS jobId, b.Type AS batchType, tm.Name AS who
                    FROM Inventory_Transactions t
                    LEFT JOIN Inventory_Items it ON it.id = t.Item_ID
                    LEFT JOIN Factory_Production_Jobs j ON j.id = t.Production_Job
                    LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
                    LEFT JOIN Team tm ON tm.id = t.Created_by
                    WHERE t.Item_Code = ? AND t.Location = ?
                      ${byItem ? 'AND t.Item_ID = ?' : ''}
                    ORDER BY t.Transaction_Time ASC, t.id ASC`;
                const args = byItem
                    ? [num(row.code_ref), row.location, num(row.item_ref)]
                    : [num(row.code_ref), row.location];
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql, args })
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`Query failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
                }
                const data = await res.json();
                // Running balance in the order the godown actually moved, counting
                // only acknowledged rows — the same ones the stock figure is built
                // from, so the last balance matches the row's Available.
                let kg = 0, count = 0;
                const rows = (data.records || []).map((r) => r.fields).map((t) => {
                    if (truthy(t.ack)) { kg += num(t.wkg); count += num(t.cbund); }
                    return { ...t, balanceKg: kg, balanceCount: count };
                });
                if (!cancelled) setTxns(rows.reverse());
            } catch (err) {
                if (!cancelled) setError(err.message || String(err));
            } finally {
                if (!cancelled) setLoading(false);
            }
        })();
        return () => { cancelled = true; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const acked = txns.filter((t) => truthy(t.ack));
    const pending = txns.length - acked.length;
    const sum = (pick) => acked.reduce((s, t) => s + pick(t), 0);
    const inKg = sum((t) => Math.max(num(t.wkg), 0));
    const outKg = sum((t) => Math.min(num(t.wkg), 0));
    const inCount = sum((t) => Math.max(num(t.cbund), 0));
    const outCount = sum((t) => Math.min(num(t.cbund), 0));
    // Stock booked by count only (sheets, bundles) has no weight to total up.
    const byWeight = inKg !== 0 || outKg !== 0;
    const byCount = inCount !== 0 || outCount !== 0;
    const attrs = [row.mat, row.col, row.gsm && `${row.gsm} GSM`, row.w && `${row.w}"`].filter(Boolean).join(' · ');

    // A code row spans many physical items, so each entry names the one it moved.
    const showItemId = row.item_ref == null;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Item being traced */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-start gap-3 sm:rounded-t-2xl">
                    <div className="w-11 shrink-0"><ItemVisual colour={row.col} type={row.itype} name={row.name} size="sm" /></div>
                    <div className="min-w-0 flex-1">
                        <h2 className="font-bold text-slate-800 leading-tight truncate">{typeName(row.mat, row.itype, row.name)}</h2>
                        <p className="text-xs text-slate-500 truncate">{attrs || '—'}</p>
                        <p className="text-[11px] text-slate-400 truncate">
                            {row.location}{row.iid ? ` · ${row.iid}` : ''}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                {/* Where the current stock came from */}
                <div className="bg-white border-b border-slate-100 px-4 py-2 flex flex-wrap gap-2 text-sm">
                    {(byWeight || !byCount) && <>
                        <Total label="In" value={`+${fmtKg(inKg)} kg`} tone="text-emerald-700" />
                        <Total label="Out" value={`−${fmtKg(Math.abs(outKg))} kg`} tone="text-rose-700" />
                    </>}
                    {byCount && <>
                        <Total label="In" value={`+${inCount} ${countUnit}`} tone="text-emerald-700" />
                        <Total label="Out" value={`−${Math.abs(outCount)} ${countUnit}`} tone="text-rose-700" />
                    </>}
                    <Total
                        label="Available"
                        value={`${qty?.derived ? '≈ ' : ''}${fmtKg(qty ? qty.kg : row.avail)} kg`}
                        tone="text-teal-700"
                    />
                    <Total label="Txns" value={acked.length} tone="text-slate-700" />
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div><p className="font-medium">Error</p><p className="text-sm break-words">{error}</p></div>
                        </div>
                    )}
                    {pending > 0 && (
                        <p className="mb-3 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5 flex items-center gap-1.5">
                            <Clock size={12} /> {pending} transaction(s) still awaiting the incharge&apos;s acknowledgement — shown below, but not counted in the stock.
                        </p>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                            <Loader2 size={32} className="animate-spin mb-3 text-teal-600" />
                            <p className="text-sm">Loading transactions…</p>
                        </div>
                    ) : txns.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <p className="text-sm">No transactions recorded for this item here.</p>
                        </div>
                    ) : (
                        <ol className="relative">
                            {/* The thread the entries hang off */}
                            <span className="absolute left-[7px] top-2 bottom-2 w-px bg-slate-200" aria-hidden="true" />
                            {txns.map((t, i) => {
                                const st = styleFor(t.type);
                                const isPending = !truthy(t.ack);
                                const newDay = i === 0 || dayKey(t.ts) !== dayKey(txns[i - 1].ts);
                                return (
                                    <li key={t.id} className="relative pl-6 pb-2.5">
                                        <span className={`absolute left-0 top-2.5 w-[15px] h-[15px] rounded-full border-2 border-slate-50 ${isPending ? 'bg-amber-400' : st.dot}`} />
                                        {newDay && (
                                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1 pb-1">{dayKey(t.ts)}</p>
                                        )}
                                        <div className={`bg-white rounded-xl border p-2.5 ${isPending ? 'border-amber-200' : 'border-slate-200'}`}>
                                            <div className="flex items-center justify-between gap-2">
                                                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${st.ring} ${st.text}`}>
                                                    <st.Icon size={11} /> {t.type || '—'}
                                                </span>
                                                <span className={`font-bold text-sm tabular-nums ${num(t.wkg) < 0 || num(t.cbund) < 0 ? 'text-rose-700' : 'text-emerald-700'}`}>
                                                    {changeText(t, countUnit)}
                                                </span>
                                            </div>
                                            <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                                                {isPending
                                                    ? <span className="inline-flex items-center gap-1 text-amber-700 font-medium"><Clock size={11} /> Pending ack</span>
                                                    : <span className="tabular-nums">Balance{' '}
                                                        <span className="font-semibold text-slate-700">
                                                            {num(t.balanceKg) !== 0 || num(t.balanceCount) === 0
                                                                ? `${fmtKg(t.balanceKg)} kg`
                                                                : `${num(t.balanceCount)} ${countUnit}`}
                                                        </span>
                                                        {num(t.balanceKg) !== 0 && num(t.balanceCount) !== 0 && (
                                                            <span className="text-slate-400"> · {num(t.balanceCount)} {countUnit}</span>
                                                        )}
                                                    </span>}
                                                {showItemId && t.iid && <span className="font-medium text-slate-600">{t.iid}</span>}
                                                {num(t.jobId) > 0 && (
                                                    <span className="inline-flex items-center gap-1 text-indigo-700">
                                                        <Factory size={11} /> {t.batchType || 'Production job'} #{num(t.jobId)}
                                                    </span>
                                                )}
                                                {t.who && <span>{t.who}</span>}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InventoryTxnModal;
