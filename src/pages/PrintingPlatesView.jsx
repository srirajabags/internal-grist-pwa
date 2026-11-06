import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    ArrowLeft, AlertCircle, Loader2, RefreshCw, Tag, Search, CheckCircle2, XCircle, Repeat, Grid3x3,
    AlertTriangle, X, MoreHorizontal, Image as ImageIcon, ChevronLeft, ChevronRight
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import WriteFailureModal from '../components/WriteFailureModal';
import { newJournal } from '../grist/writeJournal';
import {
    STATUS, STATUS_LIST, RACKS, PLATES_INCHARGE, canDo, actionProblem, plateActionBundle,
    repeatShortlist, isExpired, kindOfOrder
} from '../domain/printing/printingPlates';
import { plateFromRow, subOrderFromRow } from '../domain/printing/printingJobs';
import { KIND } from '../domain/printing/rackCodes';
import { proofQuery, proofShots, isShowableProof, shotIndexFor } from '../domain/printing/finalisationProof';
import ImagePreviewModal from '../components/ImagePreviewModal';
import { confirmPlateAction, confirmRepeatAnswer } from '../domain/printing/plateConfirm';
import {
    sharedCodes, filterPlates, sortForSheet, SECTIONS, rackLabel, slotsOfRack, designText, plateDetails
} from '../domain/printing/plateTable';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

// Who confirms a repeat order's old plate. Grist lets FACTORY set
// Old_Plate_Available (access rule 106), so the same people answer it here.
const REPEAT_CONFIRMERS = ['OWNER', 'FACTORY', PLATES_INCHARGE];

const PLATE_COLUMNS = `id, Plate_No AS plate_no, Customer AS customer, Source_Sub_Order AS source_sub_order,
    Plate_Type AS plate_type, Material AS material, Rack AS rack, Slot AS slot, Rack_Code AS rack_code,
    Plate_Count AS plate_count, Stereo_Size AS stereo_size, Status AS status,
    Issued_To_Job AS issued_to_job, Bag_Width AS bag_w, Bag_Height AS bag_h,
    Bag_Model AS bag_model, Orders AS orders, Made_On AS made_on, Last_Used_On AS last_used_on,
    Expires_On AS expires_on,
    Shop AS shop, City AS city, Printing_Colours AS colours,
    (SELECT c.Customer_ID FROM Customers c WHERE c.id = Printing_Plates.Customer) AS customer_no`;

// Notes are left out of the bulk read -- a sentence on every one of 5,000 rows
// -- and fetched for the one plate whose dialog is open.
const withDisplay = (r) => ({
    ...plateFromRow(r), shop: r.shop, city: r.city, colours: r.colours, bagModel: r.bag_model,
    // The customer ID the office quotes -- Customers.Customer_ID, not the row id.
    customerNo: r.customer_no ? String(r.customer_no) : ''
});

// Today as a Grist Date (UTC midnight of the local day), for expiry.
const todayEpoch = () => Date.parse(`${new Date().toLocaleDateString('en-CA')}T00:00:00Z`) / 1000;

const STATUS_STYLE = {
    [STATUS.UNVERIFIED]: 'text-amber-700 bg-amber-50 ring-amber-200',
    [STATUS.IN_RACK]: 'text-emerald-700 bg-emerald-50 ring-emerald-200',
    [STATUS.ISSUED]: 'text-fuchsia-700 bg-fuchsia-50 ring-fuchsia-200',
    [STATUS.NOT_FOUND]: 'text-rose-700 bg-rose-50 ring-rose-200',
    [STATUS.DAMAGED]: 'text-slate-600 bg-slate-100 ring-slate-200',
    [STATUS.DISCARDED]: 'text-slate-600 bg-slate-100 ring-slate-200'
};

const Pill = ({ children, className }) => (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 whitespace-nowrap ${className}`}>{children}</span>
);

// Sizes the way the sheet writes them: 12x18.
const sizeText = (w, h) => (w && h ? `${w}x${h}` : '');
const dateText = (v) => {
    if (!v || typeof v === 'object') return '';
    const d = new Date(Number(v) * 1000);
    return isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
};

// The plate register: the plate sheet as a table, the rack-by-rack check, and
// old plates for repeat orders. Every change writes the plate and a movement
// together.
const PrintingPlatesView = ({ onBack, getHeaders, getUrl, userRoles = [] }) => {
    const [tab, setTab] = useState('register');
    const [writeFailure, setWriteFailure] = useState(null);
    const canConfirmRepeat = userRoles.some((r) => REPEAT_CONFIRMERS.includes(r));

    const runSql = async (sql, args = []) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Query failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
        }
        return ((await res.json()).records || []).map((r) => r.fields);
    };

    const apply = async (actions) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/apply`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify(actions)
        });
        if (!res.ok) {
            const text = await res.text().catch(() => '');
            throw new Error(`Saving failed: ${res.statusText}${text ? ` - ${text}` : ''}`);
        }
        return (await res.json())?.retValues || [];
    };

    // An attachment's name and size, then -- if it is worth it -- the picture
    // itself as a local URL. Asking first keeps a 100 MB design TIFF filed as a
    // "screenshot" off the phone.
    const attachments = {
        meta: async (id) => {
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${id}`), { headers: await getHeaders() });
            if (!res.ok) throw new Error(`Attachment ${id}: ${res.status}`);
            return res.json();
        },
        url: async (id) => {
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${id}/download`), { headers: await getHeaders() });
            if (!res.ok) throw new Error(`Attachment ${id}: ${res.status}`);
            return URL.createObjectURL(await res.blob());
        }
    };

    // The second confirmation every write on this page asks for (user, 6 Nov
    // 2026): `save` waits here until the person says yes or backs out.
    const [asking, setAsking] = useState(null);
    const ask = (confirm) => new Promise((resolve) => setAsking({ ...confirm, resolve }));
    const answerAsk = (yes) => {
        asking?.resolve(yes);
        setAsking(null);
    };

    // One write, confirmed first, then journalled so a refusal is shown the
    // same way as on every other floor page. No write goes without a
    // confirmation: a call that brings none is refused outright.
    const save = async (title, label, actions, confirm) => {
        if (!confirm) throw new Error(`No confirmation for "${label}".`);
        if (!(await ask(confirm))) return false;
        const journal = newJournal();
        try {
            await journal.run(label, () => apply(actions));
            return true;
        } catch (err) {
            setWriteFailure({ title, error: err.message, steps: journal.steps });
            return false;
        }
    };

    // The whole register, read once and filtered on the phone: 5,000 rows is a
    // small read, and every filter then answers at once.
    const register = useLoader(async () => (await runSql(`SELECT ${PLATE_COLUMNS} FROM Printing_Plates`)).map(withDisplay), []);

    const tabs = [
        ['register', 'Register', <Tag key="i" size={14} />],
        ['rack', 'Rack check', <Grid3x3 key="i" size={14} />],
        ...(canConfirmRepeat ? [['repeat', 'Repeat orders', <Repeat key="i" size={14} />]] : [])
    ];

    return (
        <div className="min-h-screen bg-slate-50">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className="max-w-6xl mx-auto flex items-center gap-2">
                    <Button variant="ghost" onClick={onBack} className="!px-2 shrink-0">
                        <ArrowLeft size={20} />
                    </Button>
                    <div className="w-8 h-8 bg-rose-700 rounded-lg flex items-center justify-center text-white shrink-0">
                        <Tag size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h1 className="font-bold text-slate-800 leading-tight truncate">Printing Plates</h1>
                        <p className="text-xs text-slate-500 truncate">Find, check and put back plates</p>
                    </div>
                    <Button variant="secondary" onClick={register.reload} disabled={register.loading} className="!px-2.5 shrink-0">
                        <RefreshCw size={18} className={register.loading ? 'animate-spin' : ''} />
                    </Button>
                </div>
            </header>
            <main className="max-w-6xl mx-auto p-3 sm:p-4 space-y-3">
                <div className="flex gap-2 max-w-xl">
                    {tabs.map(([key, label, icon]) => (
                        <button key={key} onClick={() => setTab(key)}
                            className={`flex-1 py-2 rounded-lg text-sm font-semibold flex items-center justify-center gap-1 ${tab === key ? 'bg-rose-700 text-white' : 'bg-white text-slate-600 border border-slate-200'}`}>
                            {icon} {label}
                        </button>
                    ))}
                </div>
                {tab === 'register' && <RegisterPanel register={register} save={save} runSql={runSql} attachments={attachments} />}
                {tab === 'rack' && <RackPanel register={register} save={save} runSql={runSql} attachments={attachments} />}
                {tab === 'repeat' && <RepeatPanel runSql={runSql} save={save} attachments={attachments} />}
            </main>
            {asking && <ConfirmModal confirm={asking} onAnswer={answerAsk} />}
            {writeFailure && (
                <WriteFailureModal title={writeFailure.title} error={writeFailure.error} steps={writeFailure.steps} onClose={() => setWriteFailure(null)} />
            )}
        </div>
    );
};

// Above the plate sheet, which may still be open beneath it.
const ConfirmModal = ({ confirm, onAnswer }) => (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] sm:p-4" onClick={() => onAnswer(false)}>
        <div role="alertdialog" aria-modal="true" aria-labelledby="plate-confirm-heading"
            className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-2xl shadow-xl p-4 space-y-3"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
                <div className={`w-9 h-9 rounded-full flex items-center justify-center shrink-0 ${confirm.danger ? 'bg-rose-100 text-rose-700' : 'bg-slate-100 text-slate-600'}`}>
                    {confirm.danger ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
                </div>
                <div className="min-w-0">
                    <h2 id="plate-confirm-heading" className="font-bold text-slate-800 leading-snug">{confirm.heading}</h2>
                    {confirm.subject && <p className="text-xs text-slate-500 mt-0.5">{confirm.subject}</p>}
                </div>
            </div>
            <ul className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 space-y-1 text-sm text-slate-700">
                {confirm.lines.map((l) => <li key={l}>{l}</li>)}
            </ul>
            <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => onAnswer(false)}>Cancel</Button>
                <Button className={`flex-1 ${confirm.danger ? '!bg-rose-700 hover:!bg-rose-800' : ''}`} onClick={() => onAnswer(true)}>
                    {confirm.confirmLabel}
                </Button>
            </div>
        </div>
    </div>
);

const useLoader = (load, deps) => {
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const reload = async () => {
        setLoading(true);
        setError(null);
        try { setRows(await load()); } catch (err) { setError(err.message); } finally { setLoading(false); }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { reload(); }, deps);
    return { rows, loading, error, reload };
};

const Problem = ({ text }) => (text ? (
    <div className="flex items-start gap-2 p-3 rounded-lg bg-rose-50 text-rose-700 text-sm"><AlertCircle size={16} className="mt-0.5 shrink-0" />{text}</div>
) : null);

const Select = ({ value, onChange, children }) => (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="border border-slate-200 rounded-lg px-2 py-2 text-sm bg-white text-slate-700">
        {children}
    </select>
);

// ---- pieces shared by the table, the phone cards and the plate sheet -----------

const RackCode = ({ p, shared }) => (
    <>
        <span className={`font-bold tabular-nums whitespace-nowrap ${p.rackCode ? 'text-rose-700' : 'text-slate-400'}`}>
            {p.rackCode || `${rackLabel(p.rack || '?', p.plateType)}, no no.`}
        </span>
        {/* The register's own number: several designs share a rack code, the plate number tells them apart. */}
        {p.plateNo && <span className="ml-1.5 text-[11px] font-normal text-slate-400 tabular-nums whitespace-nowrap">{p.plateNo}</span>}
        {shared?.has(p.rackCode) && (
            <div title="This rack code is written on another shop too" className="flex items-center gap-0.5 text-[11px] text-amber-700 whitespace-nowrap">
                <AlertTriangle size={12} /> another shop too
            </div>
        )}
    </>
);

const ShopName = ({ p }) => (
    <>
        <div className="font-medium text-slate-800">{p.shop || 'Unknown shop'}</div>
        {p.customerNo && <div className="text-[11px] text-slate-400 tabular-nums">Customer ID {p.customerNo}</div>}
    </>
);

const Details = ({ p }) => (
    <>
        <div className="font-medium text-slate-700 whitespace-nowrap">{designText(p)}</div>
        {plateDetails(p).length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-1">
                {plateDetails(p).map((d) => (
                    <span key={d} className="px-1.5 py-0.5 rounded bg-slate-100 text-[11px] text-slate-600 whitespace-nowrap">{d}</span>
                ))}
            </div>
        ) : (
            <div className="text-[11px] text-slate-400 mt-0.5">nothing on record</div>
        )}
    </>
);

const Made = ({ p }) => dateText(p.madeOn) || <span className="text-slate-400">{p.orders.length ? 'before Oct 25' : '—'}</span>;

const LastUsed = ({ p }) => (
    <>
        {dateText(p.lastUsedOn) || '—'}
        {p.orders.length > 0 && <div className="text-[11px] text-slate-400">{p.orders.length} order{p.orders.length > 1 ? 's' : ''}</div>}
    </>
);

const Expires = ({ p, today }) => (
    <span className={isExpired(p, today) ? 'text-rose-700 font-semibold' : ''}>
        {p.plateType === KIND.STEREO ? <span className="text-slate-400">never</span> : (dateText(p.expiresOn) || '—')}
        {isExpired(p, today) && <div className="text-[11px] font-normal">expired</div>}
    </span>
);

const Status = ({ p }) => (
    <>
        <Pill className={STATUS_STYLE[p.status] || ''}>{p.status}</Pill>
        {p.status === STATUS.ISSUED && p.issuedToJob ? <div className="text-[11px] text-fuchsia-700 mt-0.5">job {p.issuedToJob}</div> : null}
    </>
);

// Made, last used, expires and status as four labelled figures -- the second
// row of a phone card, and the top of the plate sheet.
const Dates = ({ p, today }) => (
    <div className="grid grid-cols-[1fr_1fr_1fr_auto] gap-2 text-xs text-slate-600 tabular-nums">
        {[['Made', <Made key="m" p={p} />], ['Last used', <LastUsed key="l" p={p} />], ['Expires', <Expires key="e" p={p} today={today} />]].map(([label, value]) => (
            <div key={label} className="min-w-0">
                <div className="text-[10px] uppercase tracking-wider text-slate-400">{label}</div>
                {value}
            </div>
        ))}
        <div className="text-right"><Status p={p} /></div>
    </div>
);

// A design on a phone. What the plate is and where it lives on the first line,
// whose it is under that, and its dates as one quiet line at the foot -- the
// rest is a tap away in the sheet.
const PlateCard = ({ p, shared, today, onOpen }) => {
    const expired = isExpired(p, today);
    const made = dateText(p.madeOn) || (p.orders.length ? 'before Oct 25' : '—');
    const used = dateText(p.lastUsedOn);
    const expires = p.plateType === KIND.STEREO ? 'never' : (dateText(p.expiresOn) || '—');
    const fact = (label, value, cls = 'text-slate-700') => (
        <span className="whitespace-nowrap">{label} <span className={`font-medium ${cls}`}>{value}</span></span>
    );
    return (
        <button type="button" onClick={onOpen}
            className="w-full text-left bg-white rounded-xl border border-slate-200 px-3.5 py-3 active:bg-slate-50">
            <div className="flex items-start justify-between gap-3">
                <div className="text-base leading-tight"><RackCode p={p} shared={shared} /></div>
                <Pill className={STATUS_STYLE[p.status] || ''}>{p.status}</Pill>
            </div>
            <div className="mt-1.5 font-medium text-slate-800 leading-snug line-clamp-2">{p.shop || 'Unknown shop'}</div>
            <div className="mt-0.5 text-xs text-slate-500 truncate">
                {[p.city, p.customerNo && `Customer ID ${p.customerNo}`].filter(Boolean).join(' · ')}
            </div>
            <div className="mt-2.5 pt-2 border-t border-slate-100 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500 tabular-nums">
                {fact('Made', made, p.madeOn ? 'text-slate-700' : 'text-slate-400')}
                {used ? fact('Used', `${used}${p.orders.length > 1 ? ` · ${p.orders.length} orders` : ''}`) : fact('Used', '—', 'text-slate-400')}
                {fact('Expires', expired ? `${expires} · expired` : expires, expired ? 'text-rose-700' : p.plateType === KIND.STEREO ? 'text-slate-400' : 'text-slate-700')}
            </div>
        </button>
    );
};

// ---- register ------------------------------------------------------------------

const PAGE = 100;

const RegisterPanel = ({ register, save, runSql, attachments }) => {
    const [text, setTextRaw] = useState('');
    const [status, setStatusRaw] = useState('');
    const [kind, setKindRaw] = useState('');
    const [rack, setRackRaw] = useState('');
    const [shown, setShown] = useState(PAGE);
    // A new filter starts the list from the top again.
    const refilter = (set) => (value) => { set(value); setShown(PAGE); };
    const [setText, setStatus, setKind, setRack] = [setTextRaw, setStatusRaw, setKindRaw, setRackRaw].map(refilter);
    const [editing, setEditing] = useState(null);

    const shared = useMemo(() => sharedCodes(register.rows), [register.rows]);
    const rows = useMemo(
        () => sortForSheet(filterPlates(register.rows, { text, status, kind, rack })),
        [register.rows, text, status, kind, rack]
    );

    const th = 'py-2 px-2.5 font-semibold align-top';
    const td = 'py-1.5 px-2.5 align-top';
    const today = todayEpoch();

    return (
        <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
                <div className="relative flex-1 min-w-[200px]">
                    <Search size={16} className="absolute left-2.5 top-2.5 text-slate-400" />
                    <input value={text} onChange={(e) => setText(e.target.value)} placeholder="Shop, city, rack code (K-1290) or customer ID"
                        className="w-full border border-slate-200 rounded-lg pl-8 pr-3 py-2 text-sm" />
                </div>
                <Select value={rack} onChange={setRack}>
                    <option value="">All racks</option>
                    {RACKS.map((r) => <option key={r} value={r}>Rack {r}</option>)}
                </Select>
                <Select value={kind} onChange={setKind}>
                    <option value="">All sections</option>
                    {SECTIONS.map((sec) => <option key={sec.kind} value={sec.kind}>{sec.label} (A{sec.suffix}–Z{sec.suffix})</option>)}
                </Select>
                <Select value={status} onChange={setStatus}>
                    <option value="">Any status</option>
                    {STATUS_LIST.map((s) => <option key={s} value={s}>{s}</option>)}
                </Select>
            </div>
            <Problem text={register.error} />
            <div className="text-xs text-slate-500">
                {register.loading && !register.rows.length ? 'Loading the register…' : `${rows.length} of ${register.rows.length} plates`}
            </div>
            {/* Phones: one card per design, no sideways scroll; tap for the sheet. */}
            <div className="md:hidden space-y-2">
                {rows.slice(0, shown).map((p) => (
                    <PlateCard key={p.id} p={p} shared={shared} today={today} onOpen={() => setEditing(p)} />
                ))}
            </div>
            <div className="hidden md:block overflow-x-auto rounded-xl border border-slate-200 bg-white">
                <table className="w-full text-sm min-w-[1080px]">
                    <thead>
                        <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                            <th className={`${th} w-12 text-right`}>Sl.No</th>
                            <th className={th}>Rack no.</th>
                            <th className={th}>Shop name</th>
                            <th className={th}>City</th>
                            <th className={th}>Plate details</th>
                            <th className={`${th} text-right`}>Made</th>
                            <th className={`${th} text-right`}>Last used</th>
                            <th className={`${th} text-right`}>Expires</th>
                            <th className={th}>Status</th>
                            <th className={`${th} w-10`} />
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                        {rows.slice(0, shown).map((p, i) => (
                            <tr key={p.id} className="hover:bg-slate-50">
                                <td className={`${td} text-right tabular-nums text-slate-400`}>{i + 1}</td>
                                <td className={td}><RackCode p={p} shared={shared} /></td>
                                <td className={td}><ShopName p={p} /></td>
                                <td className={`${td} text-slate-600`}>{p.city || '—'}</td>
                                <td className={td}><Details p={p} /></td>
                                <td className={`${td} text-right tabular-nums text-slate-600 whitespace-nowrap`}><Made p={p} /></td>
                                <td className={`${td} text-right tabular-nums text-slate-600 whitespace-nowrap`}><LastUsed p={p} /></td>
                                <td className={`${td} text-right tabular-nums text-slate-600 whitespace-nowrap`}><Expires p={p} today={today} /></td>
                                <td className={td}><Status p={p} /></td>
                                <td className="py-1 px-1.5">
                                    <button type="button" onClick={() => setEditing(p)} title="Check, move or retire this plate"
                                        className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 flex items-center justify-center">
                                        <MoreHorizontal size={14} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
            {rows.length > shown && (
                <Button variant="outline" className="w-full" onClick={() => setShown((n) => n + PAGE)}>
                    Show {Math.min(PAGE, rows.length - shown)} more
                </Button>
            )}
            {editing && (
                <PlateModal plate={editing} save={save} runSql={runSql} attachments={attachments} onClose={() => setEditing(null)}
                    onChanged={() => { setEditing(null); register.reload(); }} />
            )}
        </div>
    );
};

// The things a person can do to a plate from the register. Issuing and
// returning belong to a printing batch and happen on /printing.
const MANUAL_ACTIONS = [
    ['VERIFIED', 'Found it'],
    ['MOVED', 'Moved'],
    ['NOT_FOUND', 'Not found'],
    ['DAMAGED', 'Damaged'],
    ['DISCARDED', 'Discard']
];

// The orders behind a plate, so whoever checks it can see where every figure
// on its row came from.
const ordersSql = (ids) => `
    SELECT so.id, o.Order_ID AS order_id, so.Order_Form_Date AS order_date, so.Bag_Width AS bag_w,
           so.Bag_Height AS bag_h, so.Design_Version AS dv, so.Old_Plate_Available AS opa,
           so.Printing_Colour AS colours, so.Model AS model
    FROM Sub_Orders so LEFT JOIN Orders o ON o.id = so."Order"
    WHERE so.id IN (${ids.map(() => '?').join(',')}) ORDER BY so.Order_Form_Date, so.id`;

const DV_TEXT = { NEW: 'new design', CHANGE: 'changed design', OLD: 'repeat' };

// The customer's approved design, from the finalisation screenshots of the
// plate's orders -- the last order's first -- swiped sideways, tapped for full
// screen. Pictures load one after another so the first shows quickly.
//
// `focus` ({ subOrderId, at }) slides to that order's screenshot -- the order list
// below asks for it -- and `onShots` / `onCurrent` tell the list which orders
// have a picture and which one is showing.
const ProofCarousel = ({ orderIds, runSql, attachments, focus, onShots, onCurrent }) => {
    const [shots, setShots] = useState(null);
    const [index, setIndex] = useState(0);
    const [full, setFull] = useState(null);
    const wrapRef = useRef(null);
    const scrollRef = useRef(null);

    useEffect(() => {
        if (!focus || !shots) return;
        const i = shotIndexFor(shots, focus.subOrderId);
        const el = scrollRef.current;
        if (i < 0 || !el) return;
        el.scrollTo({ left: i * el.clientWidth, behavior: 'smooth' });
        wrapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        // Only a new tap moves it; `shots` filling in as pictures load must not.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focus]);

    useEffect(() => { onShots?.(shots || []); }, [shots?.length]); // eslint-disable-line react-hooks/exhaustive-deps
    const currentSo = shots?.[Math.min(index, (shots?.length || 1) - 1)]?.subOrderId;
    useEffect(() => { onCurrent?.(currentSo ?? null); }, [currentSo]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        let cancelled = false;
        const made = [];
        (async () => {
            const q = proofQuery(orderIds);
            if (!q) { setShots([]); return; }
            let list;
            try {
                list = proofShots(await runSql(q.sql, q.args));
            } catch {
                list = [];
            }
            if (cancelled) return;
            setShots(list.map((s) => ({ ...s, state: 'loading' })));
            for (const shot of list) {
                let next;
                try {
                    const meta = await attachments.meta(shot.attId);
                    if (!isShowableProof(meta)) next = { state: 'skipped', fileName: meta.fileName };
                    else {
                        const url = await attachments.url(shot.attId);
                        made.push(url);
                        next = { state: 'ready', url };
                    }
                } catch {
                    next = { state: 'failed' };
                }
                if (cancelled) return;
                setShots((prev) => prev.map((s) => (s.attId === shot.attId ? { ...s, ...next } : s)));
            }
        })();
        return () => { cancelled = true; made.forEach((u) => URL.revokeObjectURL(u)); };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [orderIds.join(',')]);

    if (shots === null) {
        return <div className="h-48 rounded-lg bg-slate-100 flex items-center justify-center text-slate-400"><Loader2 className="animate-spin" /></div>;
    }
    if (!shots.length) return null;

    const onScroll = (e) => {
        const el = e.currentTarget;
        setIndex(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
    };
    const current = shots[Math.min(index, shots.length - 1)];
    // The arrows do what a swipe does, for anyone who would rather tap.
    const go = (step) => {
        const el = scrollRef.current;
        if (!el) return;
        const to = Math.max(0, Math.min(shots.length - 1, index + step));
        el.scrollTo({ left: to * el.clientWidth, behavior: 'smooth' });
    };
    const arrow = 'absolute top-1/2 -translate-y-1/2 w-8 h-8 rounded-full bg-white/90 shadow ring-1 ring-slate-200 text-slate-700 flex items-center justify-center disabled:opacity-0';

    return (
        <div ref={wrapRef} className="space-y-1 scroll-mt-4">
            <div className="relative">
                <div ref={scrollRef} className="flex overflow-x-auto snap-x snap-mandatory rounded-lg bg-slate-100 [scrollbar-width:none]" onScroll={onScroll}>
                    {shots.map((s) => (
                        <div key={s.attId} className="snap-center shrink-0 w-full h-56 flex items-center justify-center">
                            {s.state === 'ready' ? (
                                <button type="button" onClick={() => setFull(s.url)} className="w-full h-full">
                                    <img src={s.url} alt={`Finalised design, order ${s.orderId}`} className="w-full h-full object-contain" />
                                </button>
                            ) : s.state === 'loading' ? (
                                <Loader2 className="animate-spin text-slate-400" />
                            ) : (
                                <span className="text-xs text-slate-400 px-4 text-center">
                                    {s.state === 'skipped' ? `${s.fileName || 'This file'} is too big to show here — open it in Grist` : 'Could not load this screenshot'}
                                </span>
                            )}
                        </div>
                    ))}
                </div>
                {shots.length > 1 && (
                    <>
                        <button type="button" onClick={() => go(-1)} disabled={index <= 0} aria-label="Previous screenshot" className={`${arrow} left-2`}>
                            <ChevronLeft size={18} />
                        </button>
                        <button type="button" onClick={() => go(1)} disabled={index >= shots.length - 1} aria-label="Next screenshot" className={`${arrow} right-2`}>
                            <ChevronRight size={18} />
                        </button>
                    </>
                )}
            </div>
            <div className="flex items-center justify-between text-[11px] text-slate-500 tabular-nums">
                <span>Finalised design{current.orderId ? ` · order ${current.orderId}` : ''}{current.at ? ` · ${dateText(current.at)}` : ''}</span>
                {shots.length > 1 && (
                    <span className="flex items-center gap-1">
                        {shots.map((s, i) => <span key={s.attId} className={`w-1.5 h-1.5 rounded-full ${i === index ? 'bg-slate-600' : 'bg-slate-300'}`} />)}
                    </span>
                )}
            </div>
            {full && <ImagePreviewModal src={full} title="Finalised design" onClose={() => setFull(null)} />}
        </div>
    );
};

const PlateModal = ({ plate, save, runSql, attachments, onClose, onChanged }) => {
    // Which orders have a screenshot in the carousel, which one it is showing,
    // and the last order row tapped.
    const [shotOrders, setShotOrders] = useState(() => new Set());
    const [showing, setShowing] = useState(null);
    const [focus, setFocus] = useState(null);
    const [plateNote, setPlateNote] = useState('');
    const [orders, setOrders] = useState([]);
    useEffect(() => {
        runSql('SELECT Notes AS notes FROM Printing_Plates WHERE id = ?', [plate.id])
            .then((r) => setPlateNote(r[0]?.notes || ''))
            .catch(() => setPlateNote(''));
        if (plate.orders.length) {
            runSql(ordersSql(plate.orders), plate.orders).then(setOrders).catch(() => setOrders([]));
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [plate.id]);
    const [action, setAction] = useState(null);
    const [rack, setRack] = useState(plate.rack);
    const [slot, setSlot] = useState(plate.slot ? String(plate.slot) : '');
    const [stereoSize, setStereoSize] = useState(plate.stereoSize || '');
    const [notes, setNotes] = useState('');
    const [busy, setBusy] = useState(false);
    const problem = action ? actionProblem(plate, action, { rack, slot }) : null;
    const isStereo = plate.plateType === KIND.STEREO;

    const submit = async () => {
        setBusy(true);
        const ok = await save(`${plate.rackCode || plate.plateNo}: ${action}`, `Record ${action.toLowerCase()} for ${plate.plateNo}`,
            plateActionBundle(plate, action, { rack, slot, notes, stereoSize: isStereo ? stereoSize : '' }),
            confirmPlateAction(plate, action, { rack, slot, stereoSize: isStereo ? stereoSize : '' }));
        setBusy(false);
        if (ok) onChanged();
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-white w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl shadow-xl p-4 pt-2 sm:pt-4 space-y-3 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}>
                <div className="sm:hidden mx-auto w-10 h-1 rounded-full bg-slate-300" />
                <ProofCarousel orderIds={plate.orders} runSql={runSql} attachments={attachments} focus={focus}
                    onShots={(list) => setShotOrders(new Set(list.map((x) => x.subOrderId)))} onCurrent={setShowing} />
                <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2"><RackCode p={plate} /></div>
                        <ShopName p={plate} />
                        <div className="text-xs text-slate-500">{plate.city}</div>
                    </div>
                    <button onClick={onClose} className="p-1 rounded hover:bg-slate-100"><X size={18} /></button>
                </div>
                <div className="rounded-lg border border-slate-200 p-2.5 space-y-2.5">
                    <div className="text-sm"><Details p={plate} /></div>
                    <Dates p={plate} today={todayEpoch()} />
                    {plateNote && <div className="text-[11px] text-slate-400">{plateNote}</div>}
                </div>
                {orders.length > 0 && (
                    <div className="rounded-lg border border-slate-200 overflow-hidden">
                        <div className="px-2.5 py-1.5 bg-slate-50 text-[11px] font-semibold uppercase tracking-wider text-slate-500">Orders printed with it</div>
                        <div className="max-h-48 overflow-y-auto divide-y divide-slate-100">
                            {orders.map((o) => {
                                const hasShot = shotOrders.has(o.id);
                                return (
                                    <button key={o.id} type="button" disabled={!hasShot}
                                        onClick={() => setFocus({ subOrderId: o.id, at: Date.now() })}
                                        title={hasShot ? 'Show its finalised design' : 'No finalisation screenshot for this order'}
                                        className={`w-full px-2.5 py-1.5 text-xs flex items-center gap-2 text-left ${showing === o.id ? 'bg-rose-50' : ''} ${hasShot ? 'active:bg-slate-100' : ''}`}>
                                        <span className="tabular-nums text-slate-500 w-20 shrink-0">{dateText(o.order_date)}</span>
                                        <span className="text-slate-700 flex-1 min-w-0 truncate">
                                            {[o.order_id, `${o.bag_w}x${o.bag_h}`, o.model, DV_TEXT[o.dv] || o.dv, o.dv === 'OLD' && o.opa === 'NO' ? 'plate made again' : null].filter(Boolean).join(' · ')}
                                        </span>
                                        {hasShot && <ImageIcon size={13} className={showing === o.id ? 'text-rose-700' : 'text-slate-400'} />}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                )}
                <div className="flex flex-wrap gap-1">
                    {MANUAL_ACTIONS.filter(([a]) => canDo(plate, a)).map(([a, label]) => (
                        <button key={a} onClick={() => setAction(action === a ? null : a)}
                            className={`px-2.5 py-1 rounded-full text-xs font-semibold border ${action === a ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
                            {label}
                        </button>
                    ))}
                </div>
                {action && (
                    <div className="space-y-2">
                        {action === 'MOVED' && (
                            <div className="flex gap-2">
                                <select value={rack} onChange={(e) => setRack(e.target.value)} className="w-24 border border-slate-200 rounded-lg px-2 py-2 text-sm">
                                    <option value="">Rack</option>
                                    {RACKS.map((r) => <option key={r} value={r}>{r}</option>)}
                                </select>
                                <input value={slot} onChange={(e) => setSlot(e.target.value)} inputMode="numeric" placeholder="Slot no."
                                    className="w-28 border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                            </div>
                        )}
                        {isStereo && action === 'VERIFIED' && (
                            <input value={stereoSize} onChange={(e) => setStereoSize(e.target.value)} placeholder="Stereo size (optional)"
                                className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                        )}
                        <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note (optional)" className="w-full border border-slate-200 rounded-lg px-2 py-2 text-sm" />
                        {problem && <p className="text-xs text-rose-600">{problem}</p>}
                        <Button className="w-full !bg-rose-700 hover:!bg-rose-800" disabled={busy || Boolean(problem)} onClick={submit} icon={busy ? Loader2 : CheckCircle2}>
                            Save
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
};

// ---- rack check ----------------------------------------------------------------

// The one on-ground check. The godown has three sections -- plates, stereos,
// digital -- each with racks A to Z, so the checker picks a section and a rack
// and walks it slot by slot. A shop's slot holds every design it has of that
// kind; each design is ticked found or not here. The checker only verifies:
// the slot is the register's, never typed (user, 5 Nov 2026). A stereo's size
// can be noted while it is in hand.
const RackPanel = ({ register, save, runSql, attachments }) => {
    const [open, setOpen] = useState(null);
    const [kind, setKind] = useState(KIND.PLATE);
    const [rack, setRack] = useState('');
    const [sizes, setSizes] = useState({});
    const [busyId, setBusyId] = useState(null);

    const onRack = useMemo(() => register.rows.filter((p) => p.rack === rack && p.plateType === kind
        && [STATUS.UNVERIFIED, STATUS.NOT_FOUND, STATUS.IN_RACK].includes(p.status)), [register.rows, rack, kind]);
    const groups = useMemo(() => slotsOfRack(onRack), [onRack]);
    const label = rack ? rackLabel(rack, kind) : '';

    const counts = {
        left: onRack.filter((p) => p.status === STATUS.UNVERIFIED).length,
        found: onRack.filter((p) => p.status === STATUS.IN_RACK).length,
        missing: onRack.filter((p) => p.status === STATUS.NOT_FOUND).length
    };

    const mark = async (plate, action) => {
        setBusyId(plate.id);
        const stereoSize = plate.plateType === KIND.STEREO ? sizes[plate.id] : '';
        const ok = await save(`${plate.rackCode || plate.plateNo}: ${action}`, `Rack check ${plate.plateNo}`,
            plateActionBundle(plate, action, { notes: 'Rack check', stereoSize }),
            confirmPlateAction(plate, action, { stereoSize }));
        setBusyId(null);
        if (ok) register.reload();
    };

    return (
        <div className="space-y-3">
            <div className="flex gap-2 max-w-xl">
                {SECTIONS.map((sec) => (
                    <button key={sec.kind} onClick={() => setKind(sec.kind)}
                        className={`flex-1 py-2 px-1 rounded-lg border flex flex-col items-center justify-center leading-tight ${kind === sec.kind ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-600 border-slate-200'}`}>
                        {/* Name over range on every button, so they line up whether or not the name would wrap. */}
                        <span className="text-sm font-semibold whitespace-nowrap">{sec.label}</span>
                        <span className="text-xs opacity-70">A{sec.suffix}–Z{sec.suffix}</span>
                    </button>
                ))}
            </div>
            <div className="grid grid-cols-7 sm:grid-cols-[repeat(13,minmax(0,1fr))] gap-1 max-w-xl">
                {RACKS.map((r) => (
                    <button key={r} onClick={() => setRack(r)}
                        className={`py-2 rounded-lg text-sm font-bold border ${rack === r ? 'bg-rose-700 text-white border-rose-700' : 'bg-white text-slate-700 border-slate-200'}`}>
                        {rackLabel(r, kind)}
                    </button>
                ))}
            </div>
            <Problem text={register.error} />
            {rack && (
                <Card className="p-3 text-sm text-slate-600 flex justify-between max-w-3xl">
                    <span className="font-semibold">Rack {label} · {groups.length} slot(s)</span>
                    <span>{counts.left} to check · {counts.found} found · {counts.missing} not found</span>
                </Card>
            )}
            <div className="space-y-2 max-w-3xl">
                {groups.map((g) => (
                    <Card key={g.key} className="p-3 space-y-2">
                        <div className="text-sm font-semibold text-slate-800">
                            <span className="text-rose-700 tabular-nums">{g.rackCode || 'no slot number'}</span> · {g.shop}
                        </div>
                        <div className="divide-y divide-slate-100">
                            {g.plates.map((p) => {
                                return (
                                    <div key={p.id} className="py-1.5 flex items-center gap-2">
                                        <button type="button" onClick={() => setOpen(p)} className="min-w-0 flex-1 text-left active:bg-slate-50 rounded">
                                            <div className="text-xs text-slate-700">
                                                {[designText(p), ...plateDetails(p)].join(' · ')}
                                                {p.plateNo && <span className="ml-1.5 text-[11px] text-slate-400 tabular-nums">{p.plateNo}</span>}
                                            </div>
                                            <div className="text-[11px] text-slate-400">
                                                {p.lastUsedOn ? `last used ${dateText(p.lastUsedOn)}` : 'no order on record'}
                                                {p.status !== STATUS.UNVERIFIED && <> · <span className="font-semibold">{p.status}</span></>}
                                            </div>
                                        </button>
                                        {p.plateType === KIND.STEREO && (
                                            <input value={sizes[p.id] ?? p.stereoSize} onChange={(e) => setSizes((s) => ({ ...s, [p.id]: e.target.value }))}
                                                placeholder="Size" className="w-20 border border-slate-200 rounded px-2 py-1.5 text-sm text-center" />
                                        )}
                                        <button disabled={busyId === p.id || !canDo(p, 'VERIFIED')} onClick={() => mark(p, 'VERIFIED')} title="Found"
                                            className="p-2 rounded-lg text-emerald-700 bg-emerald-50 disabled:opacity-40"><CheckCircle2 size={18} /></button>
                                        {canDo(p, 'NOT_FOUND') && (
                                            <button disabled={busyId === p.id} onClick={() => mark(p, 'NOT_FOUND')} title="Not here"
                                                className="p-2 rounded-lg text-rose-700 bg-rose-50 disabled:opacity-40"><XCircle size={18} /></button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </Card>
                ))}
            </div>
            {open && (
                <PlateModal plate={open} save={save} runSql={runSql} attachments={attachments} onClose={() => setOpen(null)}
                    onChanged={() => { setOpen(null); register.reload(); }} />
            )}
        </div>
    );
};

// ---- repeat orders ---------------------------------------------------------------

// Orders for an old design, waiting for someone to say whether the old plate is
// there. The register offers the customer's plates; a person looks and decides
// (user, 1 Nov 2026). Answering moves the order on, exactly as setting
// Old_Plate_Available in Grist does.
const RepeatPanel = ({ runSql, save, attachments }) => {
    const { rows, loading, error, reload } = useLoader(async () => {
        const orders = (await runSql(`
            SELECT so.id AS so_id, so.Model AS model, so.Print AS print, so.Plate AS plate,
                   so.Material AS material, so.Printing_Colour AS printing_colour,
                   so.Bag_Width AS bag_w, so.Bag_Height AS bag_h, so.Quantity AS qty, so.Quantity_Type AS qty_type,
                   so.Reused_Plates AS reused_plates, so.Customer AS customer,
                   c.Shop_Name AS shop, c.City AS city, o.Order_ID AS order_id
            FROM Sub_Orders so
            LEFT JOIN Customers c ON c.id = so.Customer
            LEFT JOIN Orders o ON o.id = so."Order"
            WHERE so.Status = 'CHECKING FOR OLD PLATE'
            ORDER BY so.id`)).map(subOrderFromRow);
        const customers = [...new Set(orders.map((o) => o.customer).filter(Boolean))];
        const plates = customers.length ? (await runSql(
            `SELECT ${PLATE_COLUMNS} FROM Printing_Plates WHERE Customer IN (${customers.map(() => '?').join(',')})`,
            customers
        )).map(withDisplay) : [];
        return orders.map((so) => ({ so, plates: plates.filter((pl) => pl.customer === so.customer) }));
    }, []);

    return (
        <div className="space-y-3 max-w-3xl">
            <div className="flex justify-between items-center">
                <p className="text-sm text-slate-600">{rows.length} order(s) waiting for an old-plate check</p>
                <button onClick={reload} className="p-1.5 rounded hover:bg-slate-200"><RefreshCw size={16} className={loading ? 'animate-spin' : ''} /></button>
            </div>
            <Problem text={error} />
            {rows.map(({ so, plates }) => (
                <RepeatCard key={so.id} so={so} plates={plates} save={save} onDone={reload} runSql={runSql} attachments={attachments} />
            ))}
        </div>
    );
};

// One repeat order and the one old plate it should reuse. The plates made for
// its bag size come first with the likeliest already chosen; the customer's
// other plates of its kind wait behind "show others".
const RepeatCard = ({ so, plates, save, onDone, runSql, attachments }) => {
    const today = todayEpoch();
    const { shortlist, others, pick } = useMemo(() => repeatShortlist(so, plates, today), [so, plates, today]);
    const [picked, setPicked] = useState(pick);
    const [showOthers, setShowOthers] = useState(false);
    const [open, setOpen] = useState(null);
    const [busy, setBusy] = useState(false);
    const chosen = [...shortlist, ...others].find((c) => c.plate.id === picked);

    const answer = async (yes) => {
        setBusy(true);
        const fields = yes
            ? { Reused_Plates: ['L', picked], Old_Plate_Available: 'YES' }
            : { Old_Plate_Available: 'NO' };
        const ok = await save(`Old plate for ${so.shop}`,
            yes ? `Reuse ${chosen?.plate.rackCode || chosen?.plate.plateNo || 'the old plate'}` : 'No old plate',
            [['UpdateRecord', 'Sub_Orders', so.id, fields]],
            confirmRepeatAnswer(so, yes ? chosen : null));
        setBusy(false);
        if (ok) onDone();
    };

    const kindWord = ({ STEREO: 'stereo', DIGITAL: 'digital plate' })[kindOfOrder(so)] || 'plate';
    const row = ({ plate, fits }) => (
        <div key={plate.id} className="flex items-center gap-2 py-1">
            {/* The circle chooses; the plate itself opens its sheet. */}
            <label className="p-2 -ml-2 shrink-0 cursor-pointer">
                <input type="radio" name={`reuse-${so.id}`} checked={picked === plate.id} onChange={() => setPicked(plate.id)} className="w-4 h-4 block" />
            </label>
            <button type="button" onClick={() => setOpen(plate)} className="min-w-0 flex-1 text-left py-1 active:bg-slate-50 rounded">
                <div className="text-sm font-semibold text-slate-800">
                    <span className="text-rose-700">{plate.rackCode || `rack ${rackLabel(plate.rack || '?', plate.plateType)}, no number`}</span> · {designText(plate)}
                    {plate.plateNo && <span className="ml-1.5 text-[11px] font-normal text-slate-400 tabular-nums">{plate.plateNo}</span>}
                </div>
                <div className="text-xs text-slate-500">
                    made for {sizeText(plate.bagW, plate.bagH) || 'unknown size'}
                    {plate.lastUsedOn ? ` · last used ${dateText(plate.lastUsedOn)}` : ''} · {plate.status}
                </div>
            </button>
            {isExpired(plate, today) && <Pill className="text-slate-600 bg-slate-100 ring-slate-200">expired</Pill>}
            {fits === false && <Pill className="text-rose-700 bg-rose-50 ring-rose-200">too big</Pill>}
        </div>
    );

    return (
        <Card className="p-3 space-y-2">
            <div>
                <div className="font-semibold text-slate-800">{so.shop}</div>
                <div className="text-xs text-slate-500">
                    {[so.orderId, so.city, so.material, so.plate, `bag ${sizeText(so.bagW, so.bagH)}`].filter(Boolean).join(' · ')}
                </div>
            </div>
            {!shortlist.length && !others.length ? (
                <p className="text-xs text-amber-700">No {kindWord} of this customer's in the register.</p>
            ) : (
                <>
                    {shortlist.length > 0 ? (
                        <div className="divide-y divide-slate-100">{shortlist.map(row)}</div>
                    ) : (
                        <p className="text-xs text-amber-700">No {kindWord} of this customer's fits a {sizeText(so.bagW, so.bagH)} bag.</p>
                    )}
                    {others.length > 0 && (
                        <>
                            <button type="button" onClick={() => setShowOthers((v) => !v)} className="text-xs font-semibold text-slate-500 hover:text-slate-700">
                                {showOthers ? 'Hide' : 'Show'} {others.length} other {kindWord}{others.length > 1 ? 's' : ''} of this customer's
                            </button>
                            {showOthers && <div className="divide-y divide-slate-100 border-t border-slate-100">{others.map(row)}</div>}
                        </>
                    )}
                </>
            )}
            {chosen?.fits === false && (
                <p className="text-xs text-rose-600">The chosen plate was made for a bigger bag than this order.</p>
            )}
            <div className="flex gap-2">
                <Button className="flex-1" disabled={busy || !chosen} onClick={() => answer(true)} icon={busy ? Loader2 : CheckCircle2}>
                    {chosen ? `Reuse ${chosen.plate.rackCode || 'this plate'}` : `Choose a ${kindWord}`}
                </Button>
                <Button variant="outline" className="flex-1" disabled={busy} onClick={() => answer(false)} icon={XCircle}>
                    No old plate
                </Button>
            </div>
            {open && (
                <PlateModal plate={open} save={save} runSql={runSql} attachments={attachments} onClose={() => setOpen(null)}
                    onChanged={() => { setOpen(null); onDone(); }} />
            )}
        </Card>
    );
};

export default PrintingPlatesView;
