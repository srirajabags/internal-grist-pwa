import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, ArrowDownLeft, ArrowUpRight, Sparkles, Check, ShieldCheck, Factory, Trash2 } from 'lucide-react';
import { ItemVisual } from './itemVisuals';
import HoldToAct, { DESTRUCTIVE_HOLD_MS } from './HoldToAct';
import { typeName } from '../utils/itemForms';
import { num, dayKey, changeText, isOutward, toneFor, attrText, countUnitFor } from '../utils/txnDisplay';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const TXN_TABLE = 'Inventory_Transactions';

const TYPE_ICON = { 'ADD': ArrowDownLeft, 'NEW STOCK': Sparkles, 'LESS': ArrowUpRight };
const iconFor = (type) => TYPE_ICON[String(type || '').toUpperCase()] || ArrowDownLeft;

// Everything booked into the godown that the incharge has not signed off yet.
// Until a transaction is acknowledged it does not count towards stock, so this is
// the queue that keeps the inventory figures honest.
const PendingAckModal = ({ onClose, onAcknowledged, getHeaders, getUrl }) => {
    const [txns, setTxns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [doneIds, setDoneIds] = useState([]);
    const [rejectedIds, setRejectedIds] = useState([]);

    const load = async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const sql = `
                SELECT t.id AS id, t.Transaction_Time AS ts, t.Transaction_Type AS type,
                       t.Weight_Change_Kg_ AS wkg, t.Count_Change_Bundle_ AS cbund,
                       t.Location AS location, it.Item_ID AS iid,
                       ic.Item_Code AS name, ic.Type AS itype, ic.Material AS mat,
                       ic.Colour AS col, ic.GSM AS gsm,
                       ic.Width_Inches_ AS w, ic.Height_Inches_ AS h,
                       t.Production_Job AS jobId, j.Job_ID AS jobName, tm.Name AS who
                FROM ${TXN_TABLE} t
                LEFT JOIN Inventory_Items it ON it.id = t.Item_ID
                LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
                LEFT JOIN Factory_Production_Jobs j ON j.id = t.Production_Job
                LEFT JOIN Team tm ON tm.id = t.Created_by
                WHERE t.Incharge_Ack IS NULL OR t.Incharge_Ack = 0
                ORDER BY t.Transaction_Time DESC, t.id DESC`;
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, args: [] })
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Query failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
            }
            const data = await res.json();
            setTxns((data.records || []).map((r) => r.fields));
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { load(); }, []);

    const acknowledge = async (id) => {
        setSavingId(id);
        setError(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${TXN_TABLE}/records`), {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id, fields: { Incharge_Ack: true } }] })
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Acknowledge failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
            }
            // Keep the row on screen, ticked, so the operator can see what they just
            // signed off; the list itself is refetched by the page behind us.
            setDoneIds((prev) => [...prev, id]);
            onAcknowledged?.();
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setSavingId(null);
        }
    };

    // Rejecting removes the transaction entirely: an entry that should not have
    // been booked leaves no trace to puzzle over later, and nothing about it ever
    // counted towards stock.
    const reject = async (id) => {
        setSavingId(id);
        setError(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${TXN_TABLE}/data/delete`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify([id])
            });
            if (!res.ok) {
                const text = await res.text().catch(() => '');
                throw new Error(`Reject failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
            }
            setRejectedIds((prev) => [...prev, id]);
            onAcknowledged?.();
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setSavingId(null);
        }
    };

    const remaining = txns.filter((t) => !doneIds.includes(t.id) && !rejectedIds.includes(t.id)).length;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-2xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-start gap-3 sm:rounded-t-2xl">
                    <span className="w-9 h-9 rounded-lg bg-amber-100 text-amber-700 flex items-center justify-center shrink-0">
                        <ShieldCheck size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="font-bold text-slate-800 leading-tight">Awaiting acknowledgement</h2>
                        <p className="text-xs text-slate-500">
                            {loading ? 'Loading…' : `${remaining} transaction${remaining !== 1 ? 's' : ''} not counted in stock yet`}
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div><p className="font-medium">Error</p><p className="text-sm break-words">{error}</p></div>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-48 text-slate-400">
                            <Loader2 size={32} className="animate-spin mb-3 text-teal-600" />
                            <p className="text-sm">Loading transactions…</p>
                        </div>
                    ) : txns.length === 0 ? (
                        <div className="text-center py-12 text-slate-500">
                            <ShieldCheck size={44} className="mx-auto mb-3 text-emerald-300" />
                            <p className="text-base font-medium mb-1">Nothing to acknowledge</p>
                            <p className="text-sm">Every transaction has been signed off.</p>
                        </div>
                    ) : (
                        <ol className="space-y-2">
                            {txns.map((t, i) => {
                                const tone = toneFor(t.type);
                                const Icon = iconFor(t.type);
                                const unit = countUnitFor(t.itype, t.name);
                                const done = doneIds.includes(t.id);
                                const rejected = rejectedIds.includes(t.id);
                                const newDay = i === 0 || dayKey(t.ts) !== dayKey(txns[i - 1].ts);
                                return (
                                    <li key={t.id}>
                                        {newDay && (
                                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1.5 pb-1">{dayKey(t.ts)}</p>
                                        )}
                                        <div className={`bg-white rounded-xl border p-3 transition-colors ${done
                                            ? 'border-emerald-200 bg-emerald-50/40'
                                            : rejected
                                                ? 'border-slate-200 bg-slate-50 opacity-60'
                                                : 'border-amber-200'}`}>
                                            <div className="flex items-start gap-3">
                                                <div className="w-10 shrink-0"><ItemVisual colour={t.col} type={t.itype} name={t.name} size="sm" /></div>
                                                <div className="min-w-0 flex-1">
                                                    <p className="font-semibold text-slate-800 text-sm leading-tight truncate">
                                                        {typeName(t.mat, t.itype, t.name)}
                                                    </p>
                                                    <p className="text-[11px] text-slate-500 truncate">{attrText(t)}</p>
                                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mt-1 text-[11px] text-slate-500">
                                                        <span>{t.location || '—'}</span>
                                                        {t.iid && <span className="font-medium text-slate-600">{t.iid}</span>}
                                                        {num(t.jobId) > 0 && (
                                                            <span className="inline-flex items-center gap-1 text-indigo-700 min-w-0 break-all">
                                                                <Factory size={11} className="shrink-0" /> {t.jobName || `Production job #${num(t.jobId)}`}
                                                            </span>
                                                        )}
                                                        {t.who && <span>{t.who}</span>}
                                                    </div>
                                                </div>
                                                <div className="text-right shrink-0">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${tone.ring} ${tone.text}`}>
                                                        <Icon size={11} /> {t.type || '—'}
                                                    </span>
                                                    <p className={`font-bold text-sm tabular-nums mt-1 ${isOutward(t) ? 'text-rose-700' : 'text-emerald-700'}`}>
                                                        {changeText(t, unit)}
                                                    </p>
                                                </div>
                                            </div>
                                            <div className="flex flex-wrap justify-end items-center gap-2 mt-2">
                                                {done && (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200">
                                                        <Check size={14} /> Acknowledged
                                                    </span>
                                                )}
                                                {rejected && (
                                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-slate-500 bg-slate-100 ring-1 ring-slate-200">
                                                        <Trash2 size={14} /> Rejected and deleted
                                                    </span>
                                                )}
                                                {!done && !rejected && (
                                                    <>
                                                        <HoldToAct
                                                            busy={savingId === t.id}
                                                            onConfirm={() => reject(t.id)}
                                                            holdMs={DESTRUCTIVE_HOLD_MS}
                                                            label="Hold to reject"
                                                            holdingLabel="Keep holding to delete…"
                                                            icon={Trash2}
                                                            tone="rose"
                                                        />
                                                        <HoldToAct
                                                            busy={savingId === t.id}
                                                            onConfirm={() => acknowledge(t.id)}
                                                        />
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </li>
                                );
                            })}
                        </ol>
                    )}
                </div>

                <div className="bg-white border-t border-slate-200 px-4 py-2.5 sm:rounded-b-2xl">
                    <p className="text-[11px] text-slate-400">
                        Hold a button until it fills — a stray tap does nothing. Acknowledged stock counts
                        immediately; rejecting deletes the entry, and takes a longer hold.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PendingAckModal;
