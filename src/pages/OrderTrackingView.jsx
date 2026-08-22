import React, { useState, useEffect, useCallback } from 'react';
import {
    Search, Loader2, AlertCircle, CheckCircle2, Circle, Clock, Package,
    Copy, Check, ChevronDown, ChevronRight, ChevronLeft, ShieldCheck, FileText, X,
    Image as ImageIcon
} from 'lucide-react';
import { buildTimeline, summarise } from '../utils/orderStages';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const PROXY_URL = import.meta.env.VITE_GRIST_SERVER_URL;

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtDate = (v) => {
    if (!v) return '—';
    const d = new Date(num(v) * 1000);
    return isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
};
// Grist attachment fields arrive stringified, e.g. "[24526]" -- and a Screenshots
// field can hold several, so keep them all.
const parseAttachmentIds = (val) => {
    if (!val) return [];
    if (typeof val === 'number') return [val];
    try {
        const parsed = typeof val === 'string' ? JSON.parse(val) : val;
        if (Array.isArray(parsed)) return parsed.map(Number).filter((n) => Number.isInteger(n) && n > 0);
        if (typeof parsed === 'number') return [parsed];
    } catch { /* not parseable */ }
    return [];
};

const sizeText = (so) => {
    const w = so.bagWidth, h = so.bagHeight;
    return w && h ? `${w}" × ${h}"` : w ? `${w}" wide` : '';
};

// One step of the journey. Done steps carry the date they happened; the rest
// carry the date we expect them, so the whole path is visible from day one.
const Step = ({ step, last }) => {
    const tone = step.state === 'done'
        ? { dot: 'bg-emerald-500', text: 'text-emerald-700', Icon: CheckCircle2 }
        : step.state === 'active'
            ? { dot: 'bg-sky-500 ring-4 ring-sky-100', text: 'text-sky-700', Icon: Clock }
            : { dot: 'bg-slate-300', text: 'text-slate-400', Icon: Circle };
    return (
        <li className="relative pl-7 pb-4 last:pb-0">
            {!last && <span className="absolute left-[7px] top-4 bottom-0 w-px bg-slate-200" aria-hidden="true" />}
            <span className={`absolute left-0 top-1 w-[15px] h-[15px] rounded-full ${tone.dot}`} />
            <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <p className={`text-sm font-semibold ${step.state === 'pending' ? 'text-slate-500' : 'text-slate-800'}`}>
                    {step.label}
                </p>
                <p className={`text-xs font-medium ${tone.text}`}>
                    {step.state === 'done'
                        ? fmtDate(step.at)
                        : step.state === 'active'
                            ? `In progress · due ${fmtDate(step.expectedAt)}`
                            : `Expected ${fmtDate(step.expectedAt)}`}
                </p>
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">{step.blurb}</p>
        </li>
    );
};

const SubOrderCard = ({ so, progress, internal, jobs, designIds = [], onViewDesign, previewLoading }) => {
    const [open, setOpen] = useState(false);
    const timeline = buildTimeline(so, progress || {});
    const summary = summarise(timeline);
    const detail = internal ? (jobs || []).filter((j) => num(j.subOrderId) === num(so.id)) : [];

    return (
        <div className="bg-white rounded-2xl border border-slate-200 p-4">
            <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
                <div className="min-w-0">
                    <p className="font-bold text-slate-800">
                        {[so.model, so.print].filter(Boolean).join(' · ') || 'Item'}
                    </p>
                    <p className="text-xs text-slate-500">
                        {[sizeText(so), so.bagColour, so.quantity && `${num(so.quantity)} ${String(so.quantityType || '').toUpperCase() === 'PIECES' ? 'pcs' : 'kg'}`]
                            .filter(Boolean).join(' · ')}
                    </p>
                    {internal && <p className="text-[11px] text-slate-400 mt-0.5">Sub-order #{so.id} · {so.status}</p>}
                    {internal && designIds.length > 0 && (
                        <button
                            onClick={() => onViewDesign(designIds)}
                            disabled={previewLoading}
                            className="mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg border border-slate-300 text-[11px] font-semibold text-slate-700 hover:border-green-500 hover:text-green-700 disabled:opacity-50"
                        >
                            <ImageIcon size={13} />
                            Design finalisation{designIds.length > 1 ? ` (${designIds.length})` : ''}
                        </button>
                    )}
                </div>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${summary.complete
                    ? 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200'
                    : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'}`}>
                    {summary.complete ? 'Ready' : summary.current?.label}
                </span>
            </div>

            {!summary.complete && (
                <p className="text-xs text-slate-600 mb-3">
                    Expected ready by <span className="font-semibold text-slate-800">{fmtDate(summary.expectedReady)}</span>
                </p>
            )}

            <ol className="relative">
                {timeline.map((s, i) => <Step key={s.key} step={s} last={i === timeline.length - 1} />)}
            </ol>

            {internal && detail.length > 0 && (
                <div className="mt-3 pt-3 border-t border-slate-100">
                    <button
                        onClick={() => setOpen((o) => !o)}
                        className="flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-700"
                    >
                        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        Internal: {detail.length} job{detail.length !== 1 ? 's' : ''} across stages
                    </button>
                    {open && (
                        <div className="mt-2 space-y-1">
                            {detail.map((j, i) => (
                                <div key={`${j.stage}-${j.jobId}-${i}`} className="flex flex-wrap items-center justify-between gap-2 text-[11px] bg-slate-50 rounded-lg px-2.5 py-1.5">
                                    <span className="font-medium text-slate-700">{j.jobType || j.stage}</span>
                                    <span className="text-slate-500">
                                        {j.completedAt ? `done ${fmtDate(j.completedAt)}` : j.startedAt ? `started ${fmtDate(j.startedAt)}` : 'not started'}
                                        {j.jobId ? ` · job #${j.jobId}` : ''}
                                    </span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Public order tracking. Runs without a login so it can be embedded on the
// website, and takes only the opaque code -- order ids are sequential, so asking
// for one would invite guessing at the next customer's. Signed-in staff get an
// extra panel that turns an id into that code and shows the floor detail.
const OrderTrackingView = ({ embedded = false, getHeaders, getUrl, isStaff = false }) => {
    const [code, setCode] = useState('');
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    // Detail only a signed-in user may see: the order form attachment and the
    // individual jobs behind each stage. Read straight from Grist rather than
    // through the public route, which deliberately withholds both.
    const [staffDetail, setStaffDetail] = useState(null);
    // One viewer for both the order form and the design screenshots: a label, the
    // attachment ids to page through, and the blob currently on screen.
    const [preview, setPreview] = useState(null);   // { label, ids, index, url }
    const [previewLoading, setPreviewLoading] = useState(false);

    const loadStaffDetail = useCallback(async (subOrderIds) => {
        if (!isStaff || subOrderIds.length === 0) return;
        try {
            const headers = await getHeaders();
            const ask = async (sql) => {
                try {
                    const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sql, args: subOrderIds })
                    });
                    if (!res.ok) return [];
                    return ((await res.json()).records || []).map((r) => r.fields);
                } catch {
                    // Printing and stitching live in tables that may not exist yet;
                    // a missing one should cost its own rows, not the whole panel.
                    return [];
                }
            };
            const holes = subOrderIds.map(() => '?').join(',');
            const forms = await ask(
                `SELECT so.id AS subOrderId, o.Order_Form AS orderForm
                 FROM Sub_Orders so LEFT JOIN Orders o ON o.id = so."Order"
                 WHERE so.id IN (${holes})`
            );
            const production = await ask(
                `SELECT so.value AS subOrderId, j.id AS jobId, b.Type AS jobType,
                        j.Production_Started_At AS startedAt, j.Production_Completed_At AS completedAt
                 FROM Factory_Production_Jobs j
                 JOIN json_each(CASE WHEN json_valid(j.Sub_Orders) THEN j.Sub_Orders ELSE '[]' END) so
                   ON so.value != 'L'
                 LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
                 WHERE so.value IN (${holes})`
            );
            const printing = await ask(
                `SELECT p.Sub_Order AS subOrderId, p.id AS jobId, 'Printing' AS jobType,
                        p.Printing_Started_At AS startedAt, p.Printing_Completed_At AS completedAt
                 FROM Printing_Jobs p WHERE p.Sub_Order IN (${holes})`
            );
            const stitching = await ask(
                `SELECT s.Sub_Order AS subOrderId, s.id AS jobId, 'Stitching' AS jobType,
                        s.Stitching_Started_At AS startedAt, s.Stitching_Completed_At AS completedAt
                 FROM Stitching_Jobs s WHERE s.Sub_Order IN (${holes})`
            );
            // The finalised-design screenshots, joined the way /factory does it.
            const shots = await ask(
                `SELECT cc.Sub_Order_in_Context AS subOrderId, cc.Screenshots AS screenshots
                 FROM Customer_Conversations cc
                 WHERE cc.Outcomes LIKE '%FINALISED DESIGN%'
                   AND cc.Sub_Order_in_Context IN (${holes})`
            );
            const designs = {};
            for (const row of shots) {
                const key = String(num(row.subOrderId));
                designs[key] = [...(designs[key] || []), ...parseAttachmentIds(row.screenshots)];
            }
            setStaffDetail({
                orderFormIds: forms.flatMap((f) => parseAttachmentIds(f.orderForm)).slice(0, 1),
                designs,
                jobs: [...production, ...printing, ...stitching]
            });
        } catch {
            setStaffDetail(null);
        }
    }, [isStaff, getHeaders, getUrl]);

    const fetchAttachment = useCallback(async (attId) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`), { headers });
        if (!res.ok) throw new Error(`Could not load the image (${res.status})`);
        const type = res.headers.get('content-type');
        if (type && type.includes('application/json')) throw new Error('That attachment is not an image.');
        const blob = await res.blob();
        if (blob.size === 0) throw new Error('That attachment is empty.');
        return URL.createObjectURL(blob);
    }, [getHeaders, getUrl]);

    const openPreview = async (label, ids, index = 0) => {
        if (!ids || ids.length === 0) return;
        setPreviewLoading(true);
        try {
            const url = await fetchAttachment(ids[index]);
            setPreview((prev) => {
                if (prev?.url) URL.revokeObjectURL(prev.url);
                return { label, ids, index, url };
            });
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setPreviewLoading(false);
        }
    };

    const stepPreview = (delta) => {
        if (!preview) return;
        const next = (preview.index + delta + preview.ids.length) % preview.ids.length;
        openPreview(preview.label, preview.ids, next);
    };

    const closePreview = () => {
        setPreview((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return null;
        });
    };

    const lookup = useCallback(async (raw) => {
        const clean = String(raw || '').trim();
        if (!clean) return;
        setLoading(true);
        setError(null);
        setData(null);
        try {
            const res = await fetch(`${PROXY_URL}/public/track/${encodeURIComponent(clean)}`);
            const body = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(body.error || 'We could not find an order for that code.');
            setData(body);
            setStaffDetail(null);
            loadStaffDetail((body.subOrders || []).map((so) => num(so.id)));
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    }, [loadStaffDetail]);

    // Embeds can deep-link straight to an order: /track?code=XXXX-XXX
    useEffect(() => {
        const fromUrl = new URLSearchParams(window.location.search).get('code');
        if (fromUrl) {
            setCode(fromUrl);
            lookup(fromUrl);
        }
    }, [lookup]);

    return (
        <div className={embedded ? 'p-3' : 'min-h-screen bg-slate-50 p-4'}>
            <div className="max-w-2xl mx-auto">
                {!embedded && (
                    <div className="text-center mb-5">
                        <div className="w-12 h-12 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-3 text-white">
                            <Package size={24} />
                        </div>
                        <h1 className="text-xl font-bold text-slate-800">Track your order</h1>
                        <p className="text-sm text-slate-500">Enter the tracking code from your order confirmation.</p>
                    </div>
                )}

                <form
                    onSubmit={(e) => { e.preventDefault(); lookup(code); }}
                    className="flex gap-2 mb-4"
                >
                    <input
                        value={code}
                        onChange={(e) => setCode(e.target.value)}
                        placeholder="e.g. 3XA4-YGV"
                        aria-label="Tracking code"
                        className="flex-1 px-3 py-2.5 border border-slate-300 rounded-xl outline-none focus:ring-2 focus:ring-green-500 focus:border-green-500 tracking-widest uppercase font-mono"
                    />
                    <button
                        type="submit"
                        disabled={loading || !code.trim()}
                        className="px-4 py-2.5 rounded-xl bg-green-600 text-white font-semibold hover:bg-green-700 disabled:opacity-50 inline-flex items-center gap-2"
                    >
                        {loading ? <Loader2 size={18} className="animate-spin" /> : <Search size={18} />}
                        <span className="hidden sm:inline">Track</span>
                    </button>
                </form>

                {isStaff && <StaffCodeLookup getHeaders={getHeaders} getUrl={getUrl} onUseCode={(c) => { setCode(c); lookup(c); }} />}

                {error && (
                    <div className="p-3 bg-red-50 text-red-700 rounded-xl border border-red-100 flex gap-2 items-start">
                        <AlertCircle size={18} className="mt-0.5 shrink-0" />
                        <p className="text-sm">{error}</p>
                    </div>
                )}

                {data && (
                    <div className="space-y-3">
                        <div className="bg-white rounded-2xl border border-slate-200 px-4 py-3">
                            <p className="text-xs text-slate-500">
                                {data.kind === 'order' ? 'Order' : 'Item'}
                                {data.subOrders?.[0]?.orderNo != null ? ` #${data.subOrders[0].orderNo}` : ''}
                            </p>
                            <p className="font-bold text-slate-800">{data.subOrders?.[0]?.shop || 'Your order'}</p>
                            <p className="text-[11px] text-slate-400">
                                Placed {fmtDate(data.subOrders?.[0]?.orderPlacedAt || data.subOrders?.[0]?.orderedAt)}
                                {data.subOrders?.length > 1 ? ` · ${data.subOrders.length} items` : ''}
                            </p>
                            {isStaff && staffDetail?.orderFormIds?.length > 0 && (
                                <button
                                    onClick={() => openPreview('Order form', staffDetail.orderFormIds)}
                                    disabled={previewLoading}
                                    className="mt-2 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-300 text-xs font-semibold text-slate-700 hover:border-green-500 hover:text-green-700 disabled:opacity-50"
                                >
                                    {previewLoading ? <Loader2 size={14} className="animate-spin" /> : <FileText size={14} />}
                                    View order form
                                </button>
                            )}
                        </div>
                        {(data.subOrders || []).map((so) => (
                            <SubOrderCard
                                key={so.id}
                                so={so}
                                progress={(data.progress || {})[String(so.id)]}
                                internal={isStaff}
                                jobs={staffDetail?.jobs}
                                designIds={(staffDetail?.designs || {})[String(so.id)] || []}
                                onViewDesign={(ids) => openPreview('Design finalisation', ids)}
                                previewLoading={previewLoading}
                            />
                        ))}
                    </div>
                )}
            </div>

            {preview && (
                <div className="fixed inset-0 bg-black/80 flex flex-col items-center justify-center z-50 p-4" onClick={closePreview}>
                    <div className="absolute top-4 left-4 text-white/80 text-sm font-medium">
                        {preview.label}
                        {preview.ids.length > 1 ? ` · ${preview.index + 1} of ${preview.ids.length}` : ''}
                    </div>
                    <button onClick={closePreview} className="absolute top-4 right-4 text-white/80 hover:text-white p-2" aria-label="Close">
                        <X size={24} />
                    </button>
                    <img
                        src={preview.url}
                        alt={preview.label}
                        className="max-w-full max-h-[85vh] rounded-lg object-contain"
                        onClick={(e) => e.stopPropagation()}
                    />
                    {preview.ids.length > 1 && (
                        <div className="mt-3 flex items-center gap-4" onClick={(e) => e.stopPropagation()}>
                            <button onClick={() => stepPreview(-1)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20">
                                <ChevronLeft size={18} />
                            </button>
                            <button onClick={() => stepPreview(1)} className="px-3 py-1.5 rounded-lg bg-white/10 text-white hover:bg-white/20">
                                <ChevronRight size={18} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

// Staff-only: turn an order or sub-order id into the code to hand a customer.
// The mapping lives on the server, so this asks for it rather than computing it.
const StaffCodeLookup = ({ getHeaders, getUrl, onUseCode }) => {
    const [kind, setKind] = useState('phone');
    const [id, setId] = useState('');
    const [result, setResult] = useState(null);
    const [matches, setMatches] = useState(null);   // orders found by phone
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState(null);
    const [copied, setCopied] = useState(false);

    const runSql = async (sql, args) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        return ((await res.json()).records || []).map((r) => r.fields);
    };

    // Phone_Numbers_List is a marshalled list, so the column comes back as a blob
    // with NUL bytes in it -- CAST(... AS TEXT) stops at the first one, but hex()
    // does not, so the digits are matched against the hex of the blob.
    const searchByPhone = async () => {
        const digits = String(id).replace(/\D/g, '');
        // Indian mobiles are 10 digits; a pasted +91/0 prefix should still match.
        const needle = digits.length > 10 ? digits.slice(-10) : digits;
        if (needle.length < 6) throw new Error('Enter at least the last 6 digits of the number');
        const rows = await runSql(
            `SELECT o.id AS orderRowId, o.Order_ID AS orderNo,
                    o.Order_Form_Date AS placedAt, c.Shop_Name AS shop,
                    count(so.id) AS items
             FROM Customers c
             JOIN Orders o ON o.Customer = c.id
             LEFT JOIN Sub_Orders so ON so."Order" = o.id
             WHERE hex(c.Phone_Numbers_List) LIKE '%'||hex(?)||'%'
                OR replace(replace(coalesce(c.Phone_Number,''),' ',''),'-','') LIKE '%'||?||'%'
             GROUP BY o.id
             ORDER BY o.Order_Form_Date DESC
             LIMIT 25`,
            [needle, needle]
        );
        if (rows.length === 0) throw new Error(`No orders found for ${needle}`);
        setMatches(rows);
    };

    // Staff pick one of the phone matches; that order then gets its code.
    const codeForOrderRow = async (rowId) => {
        setBusy(true);
        setErr(null);
        try {
            const res = await fetch(getUrl(`/internal/track-code?kind=order&id=${rowId}`), { headers: await getHeaders() });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Could not generate a code');
            setResult(body);
            onUseCode(body.code);
        } catch (e) {
            setErr(e.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    const fetchCode = async () => {
        setBusy(true);
        setErr(null);
        setResult(null);
        setMatches(null);
        try {
            if (kind === 'phone') { await searchByPhone(); return; }
            const headers = await getHeaders();
            // Orders are looked up by their human Order_ID, not the row id.
            let rowId = Number(id);
            if (kind === 'order') {
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql: 'SELECT id FROM Orders WHERE Order_ID = ? OR id = ? LIMIT 1', args: [Number(id), Number(id)] })
                });
                const rows = ((await res.json()).records || []).map((r) => r.fields);
                if (rows.length === 0) throw new Error(`No order found for ${id}`);
                rowId = num(rows[0].id);
            }
            const res = await fetch(getUrl(`/internal/track-code?kind=${kind}&id=${rowId}`), { headers });
            const body = await res.json();
            if (!res.ok) throw new Error(body.error || 'Could not generate a code');
            setResult(body);
        } catch (e) {
            setErr(e.message || String(e));
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="bg-slate-100 rounded-2xl border border-slate-200 p-3 mb-4">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                <ShieldCheck size={14} /> Staff · find an order
            </p>
            <div className="flex flex-wrap gap-2">
                <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value)}
                    className="px-2.5 py-2 border border-slate-300 rounded-lg bg-white text-sm"
                >
                    <option value="phone">Phone number</option>
                    <option value="order">Order ID</option>
                    <option value="suborder">Sub-order row id</option>
                </select>
                <input
                    value={id}
                    onChange={(e) => setId(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') fetchCode(); }}
                    placeholder={kind === 'phone' ? 'e.g. 7815887039' : 'e.g. 114306'}
                    className="flex-1 min-w-[120px] px-3 py-2 border border-slate-300 rounded-lg bg-white text-sm"
                />
                <button
                    onClick={fetchCode}
                    disabled={busy || !id.trim()}
                    className="px-3 py-2 rounded-lg bg-slate-700 text-white text-sm font-semibold hover:bg-slate-800 disabled:opacity-50"
                >
                    {busy ? 'Working…' : kind === 'phone' ? 'Find orders' : 'Get code'}
                </button>
            </div>
            {err && <p className="text-xs text-red-600 mt-2">{err}</p>}
            {matches && (
                <div className="mt-2 space-y-1 max-h-64 overflow-auto">
                    <p className="text-[11px] text-slate-500">
                        {matches.length} order{matches.length !== 1 ? 's' : ''} for this number — pick one to track
                    </p>
                    {matches.map((m) => (
                        <button
                            key={m.orderRowId}
                            onClick={() => codeForOrderRow(num(m.orderRowId))}
                            disabled={busy}
                            className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 hover:border-green-400 disabled:opacity-50"
                        >
                            <span className="flex flex-wrap items-baseline justify-between gap-x-2">
                                <span className="text-sm font-semibold text-slate-800">Order #{m.orderNo}</span>
                                <span className="text-[11px] text-slate-500">{fmtDate(m.placedAt)}</span>
                            </span>
                            <span className="block text-[11px] text-slate-500 truncate">
                                {m.shop} · {num(m.items)} item{num(m.items) !== 1 ? 's' : ''}
                            </span>
                        </button>
                    ))}
                </div>
            )}
            {result && (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <code className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-300 font-mono font-bold tracking-widest">
                        {result.code}
                    </code>
                    <button
                        onClick={async () => {
                            try {
                                await navigator.clipboard.writeText(result.code);
                                setCopied(true);
                                setTimeout(() => setCopied(false), 2000);
                            } catch { /* clipboard blocked; the code is on screen */ }
                        }}
                        className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 hover:text-slate-900"
                    >
                        {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                    </button>
                    <button onClick={() => onUseCode(result.code)} className="text-xs font-medium text-green-700 hover:text-green-900">
                        Track it
                    </button>
                </div>
            )}
        </div>
    );
};

export default OrderTrackingView;
