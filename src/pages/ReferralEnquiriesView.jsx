import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, Loader2, AlertCircle, Phone, MessageCircle, Link2, StickyNote, Handshake } from 'lucide-react';
import Button from '../components/Button';
import {
    FILTERS, SORTS, queueOf, nextStatuses, statusOf, ageLabel, contactLinks, appendNote,
} from '../domain/referrals/enquiryQueue';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
// A phone screen's worth at a time; "Show more" for the rest.
const PAGE = 20;

// Everything the queue needs in one read. Priority and lead quality are Grist
// formulas (see railway-functions/referral-portal-proxy/setup-grist-tables.mjs).
const QUERY = `
SELECT e.id, e.Enquiry_Ref, e.Business_Name, e.Contact_Name, e.Phone, e.City, e.Requirement,
       e.Status, e.Submitted_At, e.Notes, e.Priority, e.Priority_Rank, e.Source,
       e.Customer, e.Matched_Customer, e.Existing_Customer,
       a.Referral_Code, a.Lead_Score, a.Lead_Quality, a.Status AS Affiliate_Status,
       mc.Shop_Name AS Matched_Shop, cc.Shop_Name AS Customer_Shop
FROM Referral_Enquiries e
LEFT JOIN Referral_Affiliates a ON a.id = e.Affiliate
LEFT JOIN Customers mc ON mc.id = e.Matched_Customer
LEFT JOIN Customers cc ON cc.id = e.Customer`;

const PRIORITY_TONES = {
    High: 'bg-green-100 text-green-800',
    Normal: 'bg-slate-100 text-slate-700',
    Low: 'bg-amber-100 text-amber-800',
};
const STATUS_TONES = {
    'Order confirmed': 'bg-green-100 text-green-800',
    'Not a fit': 'bg-slate-100 text-slate-500',
    Duplicate: 'bg-slate-100 text-slate-500',
};

// Enquiries from the referral portal, as a mobile-first work queue: the next one
// to call is at the top. Status changes, customer links and notes are written
// straight to Referral_Enquiries.
const ReferralEnquiriesView = ({ onBack, user, getHeaders, getUrl }) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [filter, setFilter] = useState('open');
    const [sort, setSort] = useState('priority');
    const [shown, setShown] = useState(PAGE);
    const [busyId, setBusyId] = useState(null);
    const [rowError, setRowError] = useState({});

    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: QUERY, args: [] }),
            });
            if (!res.ok) throw new Error(`Could not load enquiries (${res.status})`);
            setRows(((await res.json()).records || []).map((r) => r.fields));
        } catch (e) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    }, [getHeaders, getUrl]);
    useEffect(() => { load(); }, [load]);

    const counts = useMemo(
        () => Object.fromEntries(Object.entries(FILTERS).map(([k, f]) => [k, rows.filter(f.test).length])),
        [rows],
    );
    const queue = useMemo(() => queueOf(rows, { filter, sort }), [rows, filter, sort]);

    // One write, applied locally on success so the list does not reload.
    const save = async (row, fields) => {
        setBusyId(row.id);
        setRowError((m) => ({ ...m, [row.id]: null }));
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/Referral_Enquiries/records`), {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ id: row.id, fields }] }),
            });
            if (!res.ok) throw new Error(`Save failed (${res.status})`);
            setRows((all) => all.map((r) => (r.id === row.id ? { ...r, ...fields } : r)));
            // Linking a customer changes formulas Grist works out (Existing_Customer);
            // read them back rather than guess.
            if ('Customer' in fields) load();
        } catch (e) {
            setRowError((m) => ({ ...m, [row.id]: e.message }));
        } finally {
            setBusyId(null);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-3xl mx-auto flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" onClick={onBack} className="!px-2"><ArrowLeft size={20} /></Button>
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-emerald-600 rounded-lg flex items-center justify-center text-white">
                                    <Handshake size={18} />
                                </div>
                                <h1 className="font-bold text-slate-800">Referral enquiries</h1>
                            </div>
                        </div>
                        <Button variant="secondary" onClick={load} disabled={loading} className="!px-3">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </Button>
                    </div>
                    <div className="flex items-center gap-2 overflow-x-auto pb-0.5">
                        {Object.entries(FILTERS).map(([key, f]) => (
                            <button key={key} onClick={() => { setFilter(key); setShown(PAGE); }}
                                className={`shrink-0 rounded-full px-3 py-1.5 text-sm font-medium ${filter === key ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600'}`}>
                                {f.label} <span className="opacity-70">{counts[key] ?? 0}</span>
                            </button>
                        ))}
                    </div>
                    {/* Its own line, so a phone never pushes it off the side. */}
                    <label className="flex items-center justify-end gap-2 text-sm text-slate-500">
                        Sort by
                        <select value={sort} onChange={(e) => setSort(e.target.value)}
                            className="rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-700">
                            {Object.entries(SORTS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
                        </select>
                    </label>
                </div>
            </header>

            <main className="flex-1 w-full max-w-3xl mx-auto px-3 py-3 space-y-3">
                {error && (
                    <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                        <AlertCircle size={18} className="shrink-0" /> {error}
                    </div>
                )}
                {loading && rows.length === 0 ? (
                    <div className="flex justify-center py-16"><Loader2 size={32} className="animate-spin text-emerald-600" /></div>
                ) : queue.length === 0 ? (
                    <p className="py-16 text-center text-slate-500">Nothing here. {filter === 'open' ? 'All caught up.' : ''}</p>
                ) : (
                    <>
                        {queue.slice(0, shown).map((row) => (
                            <EnquiryCard key={row.id} row={row} busy={busyId === row.id} error={rowError[row.id]}
                                who={user?.name || user?.email || ''} onSave={(fields) => save(row, fields)} />
                        ))}
                        {queue.length > shown && (
                            <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
                                Show more ({queue.length - shown} left)
                            </Button>
                        )}
                    </>
                )}
            </main>
        </div>
    );
};

const EnquiryCard = ({ row, busy, error, who, onSave }) => {
    const [noteOpen, setNoteOpen] = useState(false);
    const [note, setNote] = useState('');
    const status = statusOf(row);
    const links = contactLinks(row.Phone);
    const moves = nextStatuses(row);

    return (
        <article className={`rounded-xl border border-slate-200 bg-white p-3 shadow-sm space-y-2.5 ${busy ? 'opacity-60' : ''}`}>
            <div className="flex items-center gap-2 text-xs">
                <span className={`rounded-full px-2 py-0.5 font-semibold ${PRIORITY_TONES[row.Priority] ?? PRIORITY_TONES.Normal}`}>{row.Priority || 'Normal'}</span>
                <span className="font-mono text-slate-500">{row.Enquiry_Ref}</span>
                <span className="text-slate-400">· {ageLabel(row.Submitted_At)}</span>
                <span className={`ml-auto rounded-full px-2 py-0.5 font-medium ${STATUS_TONES[status] ?? 'bg-blue-50 text-blue-700'}`}>{status}</span>
            </div>

            <div>
                <p className="font-semibold text-slate-800 break-words">{row.Business_Name}</p>
                {(row.Contact_Name || row.City) && (
                    <p className="text-sm text-slate-500">{[row.Contact_Name, row.City].filter(Boolean).join(' · ')}</p>
                )}
                {row.Requirement && <p className="mt-1 text-sm text-slate-700 whitespace-pre-wrap line-clamp-3">{row.Requirement}</p>}
            </div>

            {/* Added by the affiliate: the buyer did not fill a form, so open the call by
                saying who passed their number on. */}
            <p className="text-xs text-slate-500">
                {row.Source === 'Added by affiliate'
                    ? <><span className="mr-1 rounded bg-violet-50 px-1.5 py-0.5 font-medium text-violet-700">added by affiliate</span>for</>
                    : 'Via link'}{' '}
                <span className="font-mono font-medium text-slate-700">{row.Referral_Code}</span>
                {' · '}lead quality <span className="font-medium text-slate-700">{row.Lead_Quality || 'Not rated yet'}</span>
                {row.Affiliate_Status === 'Blocked' && <span className="ml-1 rounded bg-red-50 px-1.5 py-0.5 font-medium text-red-700">affiliate on hold</span>}
            </p>

            {/* The customer this became: commission is worked out from their orders. */}
            {row.Customer ? (
                <p className="text-sm text-slate-700">
                    Customer: <span className="font-medium">{row.Customer_Shop || `#${row.Customer}`}</span>
                    {row.Existing_Customer ? (
                        <span className="block text-xs text-amber-700">Already a customer before this enquiry: usually Duplicate.</span>
                    ) : null}
                </p>
            ) : row.Matched_Customer ? (
                <button disabled={busy} onClick={() => onSave({ Customer: row.Matched_Customer })}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-emerald-300 bg-emerald-50 px-3 py-2 text-left text-sm text-emerald-800">
                    <Link2 size={16} className="shrink-0" /> Link to {row.Matched_Shop || `customer #${row.Matched_Customer}`} (same mobile)
                </button>
            ) : null}

            {row.Notes && <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 whitespace-pre-wrap">{row.Notes}</p>}

            <div className="flex flex-wrap items-center gap-2">
                {links && (
                    <>
                        <a href={links.tel} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-800 px-3 text-sm font-medium text-white"><Phone size={16} /> Call</a>
                        <a href={links.whatsapp} target="_blank" rel="noopener" className="flex min-h-10 items-center gap-1.5 rounded-lg bg-green-600 px-3 text-sm font-medium text-white"><MessageCircle size={16} /> WhatsApp</a>
                    </>
                )}
                <button onClick={() => setNoteOpen((o) => !o)} className="flex min-h-10 items-center gap-1.5 rounded-lg bg-slate-100 px-3 text-sm font-medium text-slate-700">
                    <StickyNote size={16} /> Note
                </button>
            </div>

            {noteOpen && (
                <div className="flex gap-2">
                    <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened on the call?"
                        className="min-h-10 flex-1 rounded-lg border border-slate-200 px-3 text-base" />
                    <Button disabled={busy || !note.trim()} onClick={async () => {
                        await onSave({ Notes: appendNote(row.Notes, note, who) });
                        setNote(''); setNoteOpen(false);
                    }}>Save</Button>
                </div>
            )}

            {moves.length > 0 && (
                <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-2.5">
                    {moves.map((next) => (
                        <button key={next} disabled={busy} onClick={() => onSave({ Status: next })}
                            className={`min-h-10 rounded-lg px-3 text-sm font-medium ${['Not a fit', 'Duplicate'].includes(next) ? 'border border-slate-200 text-slate-500' : 'bg-emerald-600 text-white'}`}>
                            {['Not a fit', 'Duplicate'].includes(next) ? next : `Mark ${next}`}
                        </button>
                    ))}
                </div>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
        </article>
    );
};

export default ReferralEnquiriesView;
