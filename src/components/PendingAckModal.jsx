import React, { useState, useEffect, useRef } from 'react';
import { X, Loader2, AlertCircle, ArrowDownLeft, ArrowUpRight, Sparkles, Check, ShieldCheck, Factory } from 'lucide-react';
import { ItemVisual } from './itemVisuals';
import { typeName } from '../utils/itemForms';
import { num, dayKey, changeText, isOutward, toneFor, attrText, countUnitFor } from '../utils/txnDisplay';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const TXN_TABLE = 'Inventory_Transactions';

// Long enough that a stray tap cannot get through, short enough not to be a chore.
const HOLD_MS = 650;

const TYPE_ICON = { 'ADD': ArrowDownLeft, 'NEW STOCK': Sparkles, 'LESS': ArrowUpRight };
const iconFor = (type) => TYPE_ICON[String(type || '').toUpperCase()] || ArrowDownLeft;

// Press-and-hold confirm. The fill is a CSS transition over exactly HOLD_MS, so
// what the operator sees filling up IS the timer — release early and it drains
// back with nothing committed.
const HoldToAck = ({ onConfirm, busy, done }) => {
    const [holding, setHolding] = useState(false);
    const timer = useRef(null);

    useEffect(() => () => clearTimeout(timer.current), []);

    const start = () => {
        if (busy || done || holding) return;
        setHolding(true);
        timer.current = setTimeout(() => { setHolding(false); onConfirm(); }, HOLD_MS);
    };
    const cancel = () => {
        clearTimeout(timer.current);
        setHolding(false);
    };

    if (done) {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200">
                <Check size={14} /> Acknowledged
            </span>
        );
    }

    return (
        <button
            type="button"
            disabled={busy}
            onPointerDown={start}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onPointerCancel={cancel}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } }}
            onKeyUp={cancel}
            className={`relative overflow-hidden select-none touch-none inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${busy
                ? 'border-slate-200 text-slate-400'
                : 'border-teal-300 text-teal-700 hover:border-teal-500 active:border-teal-600'}`}
            title="Press and hold to acknowledge"
        >
            <span
                className="absolute inset-y-0 left-0 bg-teal-500/20"
                style={{ width: holding ? '100%' : '0%', transition: `width ${holding ? HOLD_MS : 160}ms linear` }}
                aria-hidden="true"
            />
            <span className="relative inline-flex items-center gap-1.5">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <ShieldCheck size={14} />}
                {busy ? 'Saving…' : holding ? 'Keep holding…' : 'Hold to acknowledge'}
            </span>
        </button>
    );
};

// Everything booked into the godown that the incharge has not signed off yet.
// Until a transaction is acknowledged it does not count towards stock, so this is
// the queue that keeps the inventory figures honest.
const PendingAckModal = ({ onClose, onAcknowledged, getHeaders, getUrl }) => {
    const [txns, setTxns] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [savingId, setSavingId] = useState(null);
    const [doneIds, setDoneIds] = useState([]);

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
                       ic.Colour AS col, ic.GSM AS gsm, ic.Width_Inches_ AS w,
                       t.Production_Job AS jobId, b.Type AS batchType, tm.Name AS who
                FROM ${TXN_TABLE} t
                LEFT JOIN Inventory_Items it ON it.id = t.Item_ID
                LEFT JOIN Inventory_Item_Codes ic ON ic.id = t.Item_Code
                LEFT JOIN Factory_Production_Jobs j ON j.id = t.Production_Job
                LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
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

    const remaining = txns.filter((t) => !doneIds.includes(t.id)).length;

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
                                const newDay = i === 0 || dayKey(t.ts) !== dayKey(txns[i - 1].ts);
                                return (
                                    <li key={t.id}>
                                        {newDay && (
                                            <p className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider pt-1.5 pb-1">{dayKey(t.ts)}</p>
                                        )}
                                        <div className={`bg-white rounded-xl border p-3 transition-colors ${done ? 'border-emerald-200 bg-emerald-50/40' : 'border-amber-200'}`}>
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
                                                            <span className="inline-flex items-center gap-1 text-indigo-700">
                                                                <Factory size={11} /> {t.batchType || 'Production job'} #{num(t.jobId)}
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
                                            <div className="flex justify-end mt-2">
                                                <HoldToAck
                                                    done={done}
                                                    busy={savingId === t.id}
                                                    onConfirm={() => acknowledge(t.id)}
                                                />
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
                        Hold the button until it fills to sign off — a stray tap does nothing. Acknowledged stock counts immediately.
                    </p>
                </div>
            </div>
        </div>
    );
};

export default PendingAckModal;
