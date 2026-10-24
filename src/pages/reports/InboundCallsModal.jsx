import React, { useState, useEffect } from 'react';
import { X, Loader2, AlertCircle, PhoneIncoming, Phone, MessageCircle, MapPin, User } from 'lucide-react';
import { detailQuery, statusOf, shopOf, placeOf, contactOf, NO_STATUS, ORDER_STATUS } from '../../domain/telecalling/inboundCallReport';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const momentText = (ts) => (num(ts) > 0
    ? new Date(num(ts) * 1000).toLocaleString('en-IN', {
        day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata'
    })
    : '');
const digitsOf = (phone) => String(phone || '').replace(/\D/g, '');
const waLink = (phone) => {
    const d = digitsOf(phone);
    return d.length === 10 ? `https://wa.me/91${d}` : d.length > 10 ? `https://wa.me/${d}` : null;
};

const statusStyle = (status) => (status === ORDER_STATUS
    ? 'bg-emerald-100 text-emerald-800'
    : status === NO_STATUS ? 'bg-slate-100 text-slate-500' : 'bg-sky-100 text-sky-800');

const CallCard = ({ call }) => {
    const status = statusOf(call.status);
    const shop = shopOf(call);
    const contact = contactOf(call);
    const place = [placeOf(call), call.areaGroup].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(' · ');
    const wa = waLink(call.phone);
    const notes = [call.comments, call.telecallerComments, call.verifierComments].map((s) => String(s || '').trim()).filter(Boolean);
    return (
        <li className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="font-semibold text-slate-800 text-sm leading-snug break-words">{shop || <span className="text-slate-400 font-normal">No shop name</span>}</div>
                    {(contact || place) && (
                        <div className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-slate-500">
                            {contact && <span className="inline-flex items-center gap-1"><User size={12} />{contact}</span>}
                            {place && <span className="inline-flex items-center gap-1"><MapPin size={12} />{place}</span>}
                        </div>
                    )}
                </div>
                <span className={`shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded ${statusStyle(status)}`}>{status}</span>
            </div>

            <div className="mt-2 flex items-center gap-2 flex-wrap">
                <a href={`tel:${digitsOf(call.phone)}`} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-200 text-sm font-medium text-slate-800 tabular-nums hover:bg-slate-50">
                    <Phone size={14} className="text-teal-600" />{call.phone || '—'}
                </a>
                {wa && (
                    <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 px-2 py-1 rounded-lg border border-slate-200 text-xs text-emerald-700 hover:bg-emerald-50">
                        <MessageCircle size={14} />WhatsApp
                    </a>
                )}
                {call.category && <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-800">{call.category}</span>}
            </div>

            {notes.length > 0 && (
                <ul className="mt-2 space-y-0.5 text-xs text-slate-600">
                    {notes.map((n, i) => <li key={i} className="break-words">“{n}”</li>)}
                </ul>
            )}

            <div className="mt-1.5 text-[11px] text-slate-400">
                Called {momentText(call.createdAt)}
                {call.dealtByName ? ` · ${call.dealtByName}${call.dealtAt ? ` at ${momentText(call.dealtAt)}` : ''}` : ' · not dealt yet'}
            </div>
        </li>
    );
};

// The calls behind one figure of the inbound call report. `cell` is the
// figure's filters (day, dealtBy, status) and `title` says what was tapped.
const InboundCallsModal = ({ range, cell, title, expected, onClose, getHeaders, getUrl }) => {
    const [calls, setCalls] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
        let live = true;
        (async () => {
            try {
                const { sql, args } = detailQuery(range, cell);
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
                const rows = ((await res.json()).records || []).map((r) => r.fields);
                if (live) setCalls(rows);
            } catch (err) {
                if (live) setError(err.message || String(err));
            }
        })();
        return () => { live = false; };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [onClose]);

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4 print:hidden" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-2xl rounded-t-2xl sm:rounded-2xl shadow-xl flex flex-col max-h-[94vh]" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-start justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2.5 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-teal-600 text-white flex items-center justify-center shrink-0">
                            <PhoneIncoming size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">{expected} call{expected === 1 ? '' : 's'}</h2>
                            <p className="text-[11px] text-slate-500 break-words">{title}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="overflow-y-auto">
                    {error && (
                        <div className="m-4 p-3 rounded-lg flex items-start gap-2 text-red-700 bg-red-50 text-sm">
                            <AlertCircle size={18} className="shrink-0 mt-0.5" />Could not load the calls. {error}
                        </div>
                    )}
                    {!calls && !error && (
                        <div className="flex justify-center py-12"><Loader2 size={28} className="animate-spin text-teal-600" /></div>
                    )}
                    {calls && calls.length !== expected && (
                        <p className="mx-4 mt-3 text-[11px] text-amber-800 bg-amber-50 rounded-lg px-2.5 py-1.5">
                            {calls.length} calls now, against {expected} in the table — the registry changed since it loaded. Refresh the report to bring them in line.
                        </p>
                    )}
                    {calls && (
                        <ul className="divide-y divide-slate-100">
                            {calls.map((c) => <CallCard key={c.id} call={c} />)}
                        </ul>
                    )}
                </div>
            </div>
        </div>
    );
};

export default InboundCallsModal;
