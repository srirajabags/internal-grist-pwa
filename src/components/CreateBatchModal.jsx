import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
    X, Loader2, AlertCircle, CheckCircle2, ChevronRight, ChevronLeft, ChevronDown,
    Search, Layers, Package, CalendarDays, ClipboardCheck, Maximize2, Download
} from 'lucide-react';
import Button from './Button';
import { countToKg } from '../utils/txnDisplay';
import {
    BATCH_TYPES, HARD_START_DATE, OUTPUT_TYPE, PRIORITY_LABEL, buildPlan,
    effectiveQty, needsPieceConversion, cannotConvertQty, cannotSizePieces, cannotSizePatty, BUNDLE_SIZE,
    typeNeedsSubOrder, missingInfoFields, outputCount, overageRate, bottomSheetDims
} from '../utils/productionBatch';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BATCHES_TABLE = 'Factory_Production_Job_Batches';
const JOBS_TABLE = 'Factory_Production_Jobs';
const SUB_ORDERS_TABLE = 'Sub_Orders';
const ACKED_GODOWN_FILTER = `
                    s.Location IN ('ROLLS GODOWN', 'BAGS GODOWN')
                    AND s.Incharge_Ack = 1
`;
const SUMMARY_BY_ID_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';
const SUMMARY_BY_CODE_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Location';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const truthy = (v) => v === true || v === 1 || v === '1' || v === 'true';
// Compact quantity: whole numbers as-is, fractional kg to 1 dp (avoids long floats
// like 28.954838709677418 crowding the mobile layout).
// kg values are always shown with 2 decimals; piece counts stay integer.
const fmtKg = (v) => num(v).toFixed(2);
const fmtQty = (v, isPieces) => isPieces ? String(num(v)) : fmtKg(v);
// A group's output requirement in whole items — "2,640 sheets", "≈ 132 bags",
// "14 bundles". Always rounded up: half a sheet or a part bundle still has to be
// produced. "≈" marks a count backed out of a weight-quoted order, and any
// sub-order whose count can't be derived at all is called out separately.
const countText = (rc) => {
    if (!rc || (rc.count <= 0 && !rc.unknown)) return null;
    const n = Math.ceil(rc.count - 1e-9).toLocaleString('en-IN');
    const unknown = rc.unknown ? ` + ${rc.unknown} unsized` : '';
    return `${rc.exact ? '' : '≈ '}${n} ${rc.unit}${unknown}`;
};

// 'YYYY-MM-DD' -> epoch seconds (UTC midnight), matching how Grist stores DATE
// columns elsewhere in the app (see FactoryView).
const dateToEpoch = (d) => new Date(d).getTime() / 1000;
const todayStr = () => new Date().toLocaleDateString('en-CA');
const epochToDate = (v) => {
    if (!v || typeof v === 'object') return null;
    const d = new Date(num(v) * 1000);
    return isNaN(d.getTime()) ? null : d.toLocaleDateString('en-CA');
};

// Parse a Grist reference-list ("[\"L\",1,2]" / [ 'L', 1, 2 ]) into integer ids.
const parseRefList = (v) => {
    if (!v) return [];
    let a = v;
    if (typeof v === 'string') { try { a = JSON.parse(v); } catch { return []; } }
    if (!Array.isArray(a)) return [];
    return a.filter((x) => x !== 'L').map(Number).filter(Number.isInteger);
};

const toRefList = (ids) => ['L', ...ids];

// Grist attachment fields come through as a stringified array (e.g. "[24526]").
// Return the first attachment id, or null.
const parseAttachmentId = (val) => {
    if (!val) return null;
    if (typeof val === 'number') return val;
    if (Array.isArray(val)) return val[0] ?? null;
    try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed[0] ?? null;
        if (typeof parsed === 'number') return parsed;
    } catch { /* not parseable */ }
    return null;
};

const attrText = (a) => [a.material, a.colour, a.gsm && `${a.gsm} GSM`, a.width && `${a.width}"`]
    .filter(Boolean).join(' · ') || '—';

const dateText = (v) => epochToDate(v) || '—';

const sizeText = (batchType, so) => {
    const type = String(batchType || '').trim().toUpperCase();
    if (type === 'ROLLS TO SHEETS' || type === 'ROLLS TO MODEL SHEETS') {
        return { label: 'Sheet', value: so.Sheet_Size || '—' };
    }
    if (type === 'ROLLS TO BOTTOMPATTY SHEETS') {
        const d = bottomSheetDims(so);
        return {
            label: 'Bottom sheet',
            value: d ? `${d.sheetW}″ × ${d.sheetH}″ · ${d.piecesPerSheet}/sheet` : '—'
        };
    }
    if (type === 'ROLLS TO SIDEPATTY') {
        const width = so.Sidepatty_Width;
        return { label: 'Side patty', value: width ? width + '" wide' : '—' };
    }
    const w = so.Bag_Width;
    const h = so.Bag_Height;
    const value = w && h ? w + '" × ' + h + '"' : w ? w + '" wide' : h ? h + '" high' : '—';
    return { label: 'Bag', value };
};

const PriorityBadge = ({ priority }) => {
    const tone = priority <= 2 ? 'green' : priority === 3 ? 'blue' : priority === 4 ? 'amber' : 'slate';
    const cls = {
        green: 'text-green-700 bg-green-50 ring-green-200',
        blue: 'text-blue-700 bg-blue-50 ring-blue-200',
        amber: 'text-amber-800 bg-amber-50 ring-amber-200',
        slate: 'text-slate-600 bg-slate-100 ring-slate-200'
    }[tone];
    return (
        <span className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ring-1 ${cls}`}>
            P{priority} · {PRIORITY_LABEL[priority]}
        </span>
    );
};

const Step = ({ n, label, active, done }) => (
    <div className={`flex items-center gap-1.5 text-xs font-medium ${active ? 'text-amber-700' : done ? 'text-green-600' : 'text-slate-400'}`}>
        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] ${active ? 'bg-amber-600 text-white' : done ? 'bg-green-100 text-green-700' : 'bg-slate-100'}`}>
            {done ? <CheckCircle2 size={12} /> : n}
        </span>
        <span className="hidden sm:inline">{label}</span>
    </div>
);

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];

// Dates are handled as plain 'YYYY-MM-DD' strings on a UTC clock so the grid
// never drifts by a day in the local timezone.
const ymd = (dt) => dt.toISOString().slice(0, 10);
const monthOf = (d) => d.slice(0, 7);
const shiftMonth = (cursor, delta) => {
    const [y, m] = cursor.split('-').map(Number);
    return monthOf(ymd(new Date(Date.UTC(y, m - 1 + delta, 1))));
};

// Month grid for picking the from/to range. Each day carries the number of
// sub-orders still available on that date — i.e. with no production job yet for
// the batch types chosen above — so the operator can see which dates are worth
// including before running the search.
const AvailabilityCalendar = ({ counts, from, to, minDate, maxDate, onPick, loading, hint }) => {
    const [cursor, setCursor] = useState(() => monthOf(from || maxDate));

    // Follow the inputs when a date is typed in directly.
    useEffect(() => { if (from) setCursor(monthOf(from)); }, [from]);

    const [y, m] = cursor.split('-').map(Number);
    const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const cells = [
        ...Array(lead).fill(null),
        ...Array.from({ length: daysInMonth }, (_, i) => ymd(new Date(Date.UTC(y, m - 1, i + 1))))
    ];

    const canPrev = shiftMonth(cursor, -1) >= monthOf(minDate);
    const canNext = shiftMonth(cursor, 1) <= monthOf(maxDate);
    const navCls = (on) => `p-1.5 rounded-lg ${on ? 'text-slate-500 hover:bg-slate-100' : 'text-slate-200 cursor-default'}`;

    return (
        <div className="mt-2 bg-white border border-slate-200 rounded-xl p-2.5">
            <div className="flex items-center justify-between mb-1.5">
                <button type="button" disabled={!canPrev} className={navCls(canPrev)}
                    onClick={() => setCursor(shiftMonth(cursor, -1))}>
                    <ChevronLeft size={16} />
                </button>
                <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">
                    {MONTH_NAMES[m - 1]} {y}
                    {loading && <Loader2 size={13} className="animate-spin text-slate-400" />}
                </span>
                <button type="button" disabled={!canNext} className={navCls(canNext)}
                    onClick={() => setCursor(shiftMonth(cursor, 1))}>
                    <ChevronRight size={16} />
                </button>
            </div>
            <div className="grid grid-cols-7 gap-1 text-center text-[10px] text-slate-400 mb-1">
                {WEEKDAYS.map((d, i) => <span key={i}>{d}</span>)}
            </div>
            <div className="grid grid-cols-7 gap-1">
                {cells.map((d, i) => {
                    if (!d) return <span key={`p${i}`} />;
                    const out = d < minDate || d > maxDate;
                    const count = counts.get(d) || 0;
                    const isStart = d === from;
                    const isEnd = d === (to || from);
                    const inRange = from && d >= from && (to ? d <= to : d <= maxDate);
                    const cls = out
                        ? 'text-slate-300 cursor-default'
                        : isStart || isEnd
                            ? 'bg-amber-600 text-white border-amber-600'
                            : inRange
                                ? 'bg-amber-50 text-amber-900 border-amber-200'
                                : count > 0
                                    ? 'bg-white text-slate-700 border-slate-200 hover:border-amber-400'
                                    : 'bg-white text-slate-400 border-slate-100 hover:border-amber-300';
                    return (
                        <button
                            key={d}
                            type="button"
                            disabled={out}
                            onClick={() => onPick(d)}
                            className={`h-11 rounded-lg border flex flex-col items-center justify-center leading-none ${cls}`}
                        >
                            <span className="text-xs font-medium">{Number(d.slice(8))}</span>
                            {!out && (
                                <span className={`text-[10px] mt-0.5 font-semibold ${isStart || isEnd ? 'text-amber-50'
                                    : count > 0 ? 'text-amber-700' : 'text-slate-300'}`}>
                                    {count > 0 ? count : '·'}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
            <p className="text-[11px] text-slate-400 mt-2">{hint}</p>
        </div>
    );
};

const CreateBatchModal = ({ onClose, onCreated, getHeaders, getUrl }) => {
    const [step, setStep] = useState('setup'); // setup | review | writing | done
    // Default to building every type — the from-date is the only real input; the
    // type picker stays as an optional override to narrow the run.
    const [batchTypes, setBatchTypes] = useState([...BATCH_TYPES]);
    // Both ends default to today — the usual run is "what came in today".
    const [startDate, setStartDate] = useState(todayStr);
    // Empty = open-ended (everything from the start date onwards).
    const [endDate, setEndDate] = useState(todayStr);
    // First tap on the calendar sets a single day; the next one extends the range.
    const [rangeAnchor, setRangeAnchor] = useState(null);
    // One row per candidate sub-order: its factory date + the batch types it
    // already has a job for. Fetched once; counts are derived per chosen type.
    const [dateRows, setDateRows] = useState([]);
    const [datesLoading, setDatesLoading] = useState(true);

    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [plans, setPlans] = useState([]); // [{ batchType, plan }] — one per chosen type
    const [codeNames, setCodeNames] = useState(new Map()); // item-code id -> readable code
    const [createdCount, setCreatedCount] = useState(0);
    // Last guard before anything is written to Grist.
    const [confirmOpen, setConfirmOpen] = useState(false);
    // Rows this attempt has written, kept outside state so the catch can see them.
    const createdBatchIds = useRef([]).current;
    const createdJobIds = useRef([]).current;
    // Set when a failed attempt could not be rolled back: creating again would
    // duplicate what is already in Grist, so the button stays disabled.
    const [stranded, setStranded] = useState(false);

    const toggleType = (t) =>
        setBatchTypes((prev) => prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]);
    const allTypesOn = batchTypes.length === BATCH_TYPES.length;

    const runSql = async (sql, args = []) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw new Error(`Query failed: ${res.statusText}${t ? ` - ${t}` : ''}`);
        }
        const data = await res.json();
        return (data.records || []).map((r) => r.fields);
    };

    // Grist answers an access-rule refusal with a 403 and a terse body, which on its
    // own reads like a bug in the app. Name the table and say what it means.
    const writeError = (verb, table, res, body) => {
        const detail = String(body || '').slice(0, 300);
        const denied = res.status === 403;
        return new Error(
            `${verb} in ${table} failed (${res.status}${res.statusText ? ` ${res.statusText}` : ''})`
            + (denied ? ` — your Grist access rules do not allow writing to ${table}.` : '')
            + (detail ? ` ${detail}` : '')
        );
    };

    // Delete rows the failed attempt had already created, jobs before the batches
    // they belong to. Returns what could not be removed.
    const rollBackWrites = async (jobIds, batchIds) => {
        const leftover = { jobs: [], batches: [] };
        const drop = async (table, ids) => {
            if (ids.length === 0) return [];
            try {
                const headers = await getHeaders();
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/data/delete`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify(ids)
                });
                return res.ok ? [] : ids;
            } catch {
                return ids;
            }
        };
        leftover.jobs = await drop(JOBS_TABLE, jobIds);
        // A batch whose jobs could not be deleted is left alone: removing it would
        // orphan them.
        leftover.batches = leftover.jobs.length > 0 ? batchIds : await drop(BATCHES_TABLE, batchIds);
        return leftover;
    };

    const postRecords = async (table, records) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw writeError('Create', table, res, t);
        }
        return (await res.json()).records || [];
    };

    const patchRecords = async (table, records) => {
        if (records.length === 0) return;
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
            method: 'PATCH',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ records })
        });
        if (!res.ok) {
            const t = await res.text().catch(() => '');
            throw writeError('Update', table, res, t);
        }
    };

    // --- Order-form attachment preview (mirrors FactoryView) ---
    const [previewImage, setPreviewImage] = useState(null);
    const [loadingPreview, setLoadingPreview] = useState(false);

    const viewOrderForm = async (attachmentValue) => {
        const attId = parseAttachmentId(attachmentValue);
        if (!attId) return;
        setLoadingPreview(true);
        setPreviewImage(null);
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`), { headers });
            if (!res.ok) throw new Error(`Failed to download (${res.status})`);
            const ct = res.headers.get('content-type');
            if (ct && ct.includes('application/json')) throw new Error('Server returned JSON, not an image');
            const blob = await res.blob();
            if (blob.size === 0) throw new Error('Empty image');
            setPreviewImage(URL.createObjectURL(blob));
        } catch (err) {
            alert(`Error loading order form: ${err.message}`);
            setPreviewImage(null);
        } finally {
            setLoadingPreview(false);
        }
    };

    const closePreview = () => {
        if (previewImage) URL.revokeObjectURL(previewImage);
        setPreviewImage(null);
        setLoadingPreview(false);
    };

    // Per-date availability for the calendar: every candidate sub-order from the
    // hard floor onwards, tagged with the batch types it already has a job for.
    // Fetched once — the per-type counts are recomputed locally as types change.
    useEffect(() => {
        (async () => {
            try {
                const [rows, jobs] = await Promise.all([
                    runSql(
                        `SELECT so.Factory_Updated_Date AS d,
                                so.Factory_Production_Jobs AS jobs,
                                so.Model AS Model, so.Material AS Material, so.Print AS Print,
                                so.Sidepatty_Width AS Sidepatty_Width,
                                so.Sidepatty_Colour AS Sidepatty_Colour
                         FROM Sub_Orders so
                         WHERE so.Status = 'UPDATED TO FACTORY' AND so.Factory_Updated_Date >= ?
                           AND so.Material IN ('NON-WOVEN', 'BOPP LAMINATED')
                           AND so.Model != 'MISPRINT'`,
                        [dateToEpoch(HARD_START_DATE)]
                    ),
                    runSql(
                        `SELECT j.id AS id, b.Type AS type
                         FROM Factory_Production_Jobs j
                         LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch`
                    )
                ]);
                const jobType = new Map(jobs.map((j) => [num(j.id), j.type]));
                setDateRows(rows
                    .map((r) => ({
                        date: epochToDate(r.d),
                        jobTypes: parseRefList(r.jobs).map((jid) => jobType.get(jid)).filter(Boolean),
                        // Every field typeNeedsSubOrder reads. A type whose
                        // qualifier needs something missing here silently counts
                        // nothing, so this list has to grow with that function.
                        so: {
                            Model: r.Model, Material: r.Material, Print: r.Print,
                            Sidepatty_Width: r.Sidepatty_Width,
                            Sidepatty_Colour: r.Sidepatty_Colour
                        }
                    }))
                    .filter((r) => r.date));
            } catch {
                // The counts are a hint only; the date inputs still work without them.
            } finally {
                setDatesLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // A sub-order counts as available while at least one chosen batch type both
    // applies to it (typeNeedsSubOrder — a DCUT bag is irrelevant to a HANDLES
    // batch) and has no job for it yet, mirroring what findSubOrders would pull.
    const dateCounts = useMemo(() => {
        const counts = new Map();
        if (batchTypes.length === 0) return counts;
        for (const r of dateRows) {
            const wanted = batchTypes.some((t) => typeNeedsSubOrder(t, r.so) && !r.jobTypes.includes(t));
            if (!wanted) continue;
            counts.set(r.date, (counts.get(r.date) || 0) + 1);
        }
        return counts;
    }, [dateRows, batchTypes]);

    // Calendar upper bound: today, unless a sub-order carries a later factory date.
    const lastDate = useMemo(
        () => dateRows.reduce((max, r) => (r.date > max ? r.date : max), todayStr()),
        [dateRows]
    );

    const rangeCount = useMemo(() => {
        let total = 0;
        for (const [d, c] of dateCounts) {
            if (d >= startDate && (!endDate || d <= endDate)) total += c;
        }
        return total;
    }, [dateCounts, startDate, endDate]);

    // Calendar tap: first one collapses the range onto that day, the next one
    // stretches it either way.
    const pickDate = (d) => {
        if (rangeAnchor) {
            setStartDate(d < rangeAnchor ? d : rangeAnchor);
            setEndDate(d < rangeAnchor ? rangeAnchor : d);
            setRangeAnchor(null);
        } else {
            setStartDate(d);
            setEndDate(d);
            setRangeAnchor(d);
        }
    };

    const findSubOrders = async () => {
        if (endDate && endDate < startDate) {
            setError('The "to" date cannot be earlier than the "from" date.');
            return;
        }
        setLoading(true);
        setError(null);
        try {
            // 1. Candidate sub-orders: updated to factory within the chosen date
            //    range (inclusive both ends; no "to" date means open-ended).
            //    Already-postponed (No_Stock_Identified) ones are kept on purpose —
            //    inventory may have changed since they were postponed.
            const subOrders = await runSql(
                `SELECT so.id AS id, so.Model AS Model, so.Material AS Material,
                        so.Print AS Print, so.Roll_Material AS Roll_Material,
                        so.Bag_Colour AS Bag_Colour, so.Bag_GSM AS Bag_GSM,
                        so.Bag_Width AS Bag_Width, so.Bag_Height AS Bag_Height,
                        so.Sidepatty_Colour AS Sidepatty_Colour, so.Sidepatty_GSM AS Sidepatty_GSM,
                        so.Sidepatty_Width AS Sidepatty_Width, so.Handle_Colour AS Handle_Colour,
                        so.Sheet_Size AS Sheet_Size,
                        so.Quantity AS Quantity, so.Quantity_Type AS Quantity_Type,
                        so.Order_Form_Date AS Order_Form_Date,
                        so.Factory_Updated_Date AS Factory_Updated_Date,
                        so.No_Stock_Identified AS No_Stock_Identified,
                        so.Factory_Production_Jobs AS Factory_Production_Jobs,
                        o.Order_ID AS Order_ID, o.Order_Form AS Order_Form,
                        c.Shop_Name AS Shop
                 FROM Sub_Orders so
                 LEFT JOIN Customers c ON c.id = so.Customer
                 LEFT JOIN Orders o ON o.id = so."Order"
                 WHERE so.Status = 'UPDATED TO FACTORY' AND so.Factory_Updated_Date >= ?
                   ${endDate ? 'AND so.Factory_Updated_Date <= ?' : ''}
                   -- Only non-woven / BOPP-laminated for now; PLASTIC and
                   -- BIO-DEGRADABLE aren't handled yet. MISPRINT models are skipped.
                   AND so.Material IN ('NON-WOVEN', 'BOPP LAMINATED')
                   AND so.Model != 'MISPRINT'`,
                endDate
                    ? [dateToEpoch(startDate), dateToEpoch(endDate)]
                    : [dateToEpoch(startDate)]
            );

            // 2. Map every existing job -> its batch type so we can drop sub-orders
            //    that already have a job of a given type (checked per type below).
            const jobs = await runSql(
                `SELECT j.id AS id, b.Type AS type
                 FROM Factory_Production_Jobs j
                 LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch`
            );
            const jobType = new Map(jobs.map((j) => [num(j.id), j.type]));
            const eligibleFor = (bt) => subOrders.filter((so) => {
                const myJobs = parseRefList(so.Factory_Production_Jobs);
                return !myJobs.some((jid) => jobType.get(jid) === bt);
            });

            // 3. Inventory item codes + available stock per physical item.
            const itemCodes = await runSql(
                `SELECT id, Item_Code, Type, Material, Colour, GSM, Width_Inches_, Height_Inches_
                 FROM Inventory_Item_Codes`
            );
            // Readable code per item-code id — the job name shown in ProductionJobsView.
            setCodeNames(new Map(itemCodes.map((ic) => [num(ic.id), ic.Item_Code])));
            // Godown stock is often booked only as a count -- every sheet in BAGS
            // GODOWN carries 0 kg and a sheet count -- so the count comes along and
            // the weight is derived from it where there is none. Filtering on
            // Available_Weight_Kg_ here made all of that stock invisible, and every
            // order fell through to cutting a fresh roll.
            const invRows = await runSql(
                `SELECT s.Item_ID AS itemId, s.Item_Code AS codeId,
                        ic.Type AS type, ic.Material AS material, ic.Colour AS colour,
                        ic.GSM AS gsm, ic.Width_Inches_ AS width,
                        ic.Height_Inches_ AS height,
                        ic.Item_Code AS name,
                        s.Available_Weight_Kg_ AS availWeight,
                        -- Only the by-code summary carries counts; each non-roll code
                        -- has exactly one physical item, so this maps one to one.
                        COALESCE((
                            SELECT c.Available_Count_Bundles_
                            FROM ${SUMMARY_BY_CODE_TABLE} c
                            WHERE c.Item_Code = s.Item_Code AND c.Location = s.Location
                              AND c.Incharge_Ack = 1
                            LIMIT 1
                        ), 0) AS availCount
                 FROM ${SUMMARY_BY_ID_TABLE} s
                 LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
                 WHERE s.Item_Code != 0
                    AND ${ACKED_GODOWN_FILTER}`
            );
            const inventory = invRows.map((r) => {
                const count = num(r.availCount);
                const booked = num(r.availWeight);
                return {
                    itemId: num(r.itemId),
                    codeId: num(r.codeId),
                    type: r.type, material: r.material, colour: r.colour, gsm: r.gsm,
                    width: r.width, height: r.height,
                    // Booked weight leads; a count-only line converts from geometry.
                    availWeight: booked > 0
                        ? booked
                        : countToKg({ w: r.width, h: r.height, gsm: r.gsm, type: r.type, name: r.name, count }),
                    // Bundle counts are per item code, which for the piece types is
                    // per physical item too -- so handle allocation no longer has to
                    // assume nothing is in stock.
                    availBundles: count
                };
            }).filter((r) => r.availWeight > 0 || r.availBundles > 0);

            // 4. Build a plan per chosen type, sharing one working inventory so a
            //    physical roll/sheet consumed by an earlier type isn't offered again
            //    to a later one. (A sub-order can still feed several types — e.g. a
            //    STITCHING bag needs both a sheet and a side patty — that's intended.)
            const working = inventory.map((r) => ({ ...r }));
            const workingById = new Map(working.map((r) => [r.itemId, r]));
            const builtPlans = [];
            for (const bt of batchTypes) {
                const built = buildPlan({ batchType: bt, subOrders: eligibleFor(bt), itemCodes, inventory: working });
                for (const g of built.groups) {
                    for (const p of g.picks) {
                        const row = workingById.get(p.itemId);
                        if (!row) continue;
                        if (built.isPieces) row.availBundles = num(row.availBundles) - p.take;
                        else row.availWeight = num(row.availWeight) - p.take;
                    }
                }
                builtPlans.push({ batchType: bt, plan: built });
            }
            setPlans(builtPlans);
            setStep('review');
        } catch (err) {
            setError(err.message || String(err));
        } finally {
            setLoading(false);
        }
    };

    const confirmCreate = async () => {
        setConfirmOpen(false);
        setStep('writing');
        setError(null);
        try {
            const today = todayStr();

            let created = 0;
            // Everything written so far, so a failure part-way can be undone rather
            // than leaving half a batch behind for the next attempt to duplicate.
            createdBatchIds.length = 0;
            createdJobIds.length = 0;
            // Aggregate the No_Stock_Identified decision across all plans: a sub-order
            // is "no stock" only if it's postponed everywhere it appears and fulfilled
            // nowhere. Track fulfilled/postponed/was-flagged per sub-order id.
            const soState = new Map(); // id -> { fulfilled, postponed, wasFlagged }
            const mark = (so, key) => {
                const s = soState.get(so.id) || { fulfilled: false, postponed: false, wasFlagged: truthy(so.No_Stock_Identified) };
                s[key] = true;
                soState.set(so.id, s);
            };

            // 1. One batch per chosen type, each with a job per fulfilled group.
            for (const { batchType, plan } of plans) {
                if (plan.jobCount === 0) continue;
                const [batch] = await postRecords(BATCHES_TABLE, [{
                    fields: { Type: batchType, Date: dateToEpoch(today) }
                }]);
                createdBatchIds.push(batch.id);
                created += 1;

                // Two-way refs mean setting Factory_Production_Job_Batch + Sub_Orders
                // auto-populates batch.Jobs and each sub-order's Factory_Production_Jobs.
                const jobRecords = plan.groups.filter((g) => g.fulfilled.length > 0).map((g) => {
                    const itemIds = [...new Set(g.picks.map((p) => p.itemId))];
                    const assignedWeight = plan.isPieces ? 0 : g.picks.reduce((s, p) => s + p.take, 0);
                    return {
                        fields: {
                            Factory_Production_Job_Batch: batch.id,
                            Sub_Orders: toRefList(g.fulfilled.map((so) => so.id)),
                            Inventory_Item_Code: g.matchedCodeId || null,
                            Inventory_Items: toRefList(itemIds),
                            Available_Weight_Kg_: assignedWeight,
                            // Kg met from finished godown stock; the rest is the planned
                            // output to actually produce (Planned_Output is a Grist formula
                            // = Required − this). Pieces batches track bundles, not kg.
                            Finished_Stock_Quantity_Kg_: plan.isPieces ? 0 : Math.round((g.finishedQty || 0) * 1000) / 1000
                        }
                    };
                });
                if (jobRecords.length > 0) {
                    const madeJobs = await postRecords(JOBS_TABLE, jobRecords);
                    createdJobIds.push(...madeJobs.map((j) => j.id).filter(Boolean));
                }

                for (const g of plan.groups) {
                    g.fulfilled.forEach((so) => mark(so, 'fulfilled'));
                    g.postponed.forEach((so) => mark(so, 'postponed'));
                }
            }
            setCreatedCount(created);

            // 2. Apply the aggregated No_Stock_Identified flags.
            const patches = [];
            for (const [id, s] of soState) {
                if (s.fulfilled) { if (s.wasFlagged) patches.push({ id, fields: { No_Stock_Identified: false } }); }
                else if (s.postponed) { patches.push({ id, fields: { No_Stock_Identified: true } }); }
            }
            await patchRecords(SUB_ORDERS_TABLE, patches);

            setStep('done');
        } catch (err) {
            // Undo whatever landed. Anything left behind would otherwise be created
            // a second time the moment the operator pressed the button again.
            const leftover = await rollBackWrites(createdJobIds, createdBatchIds);
            const strandedCount = leftover.jobs.length + leftover.batches.length;
            const undone = createdBatchIds.length > 0 || createdJobIds.length > 0;
            setError(
                `${err.message || String(err)}`
                + (strandedCount === 0
                    ? undone ? ' Nothing was created — the partial batch has been removed.' : ' Nothing was created.'
                    : ` WARNING: ${leftover.batches.length} batch(es) and ${leftover.jobs.length} job(s) were created`
                      + ` and could not be removed (ids ${[...leftover.batches, ...leftover.jobs].join(', ')}).`
                      + ' Delete them in Grist before trying again, or you will get duplicates.')
            );
            setStranded(strandedCount > 0);
            createdBatchIds.length = 0;
            createdJobIds.length = 0;
            setStep('review');
        }
    };

    // The whole review as a spreadsheet: one row per sub-order, carrying its group,
    // job and allocation details — including the flagged ones left out of every job.
    const exportCsv = () => {
        const range = endDate ? `${startDate}_to_${endDate}` : `from_${startDate}`;
        downloadCsv(`production-batch-review_${range}.csv`, CSV_HEADERS, buildCsvRows(plans, codeNames));
    };

    // Roll-up across all plans for the header/footer summaries.
    const totalJobs = plans.reduce((s, p) => s + p.plan.jobCount, 0);
    const batchesToCreate = plans.filter((p) => p.plan.jobCount > 0);
    const totalPostponed = plans.reduce((s, p) => s + p.plan.postponedCount, 0);

    return (
        <>
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-3xl sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-center justify-between sm:rounded-t-2xl">
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800">Create Production Job Batch</h2>
                        {batchTypes.length > 0 && <p className="text-xs text-slate-500 truncate">{batchTypes.join(' · ')}</p>}
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                {/* Stepper */}
                <div className="bg-white px-4 py-2 border-b border-slate-100 flex items-center gap-3 justify-between">
                    <Step n={1} label="Setup" active={step === 'setup'} done={['review', 'writing', 'done'].includes(step)} />
                    <ChevronRight size={14} className="text-slate-300" />
                    <Step n={2} label="Review & Confirm" active={step === 'review' || step === 'writing'} done={step === 'done'} />
                </div>

                <div className="flex-1 overflow-auto p-4">
                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div><p className="font-medium">Error</p><p className="text-sm break-words">{error}</p></div>
                        </div>
                    )}

                    {/* STEP 1 — SETUP: batch types first, then the date range */}
                    {step === 'setup' && (
                        <div className="space-y-5">
                            <div>
                                <div className="flex items-center justify-between gap-2 mb-2">
                                    <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
                                        <Layers size={14} /> 1 · Batch Types{batchTypes.length !== BATCH_TYPES.length ? ` · ${batchTypes.length} of ${BATCH_TYPES.length}` : ''}
                                    </p>
                                    <button
                                        onClick={() => setBatchTypes(allTypesOn ? [] : [...BATCH_TYPES])}
                                        className="text-xs font-medium text-amber-700 hover:text-amber-800 hover:underline shrink-0"
                                    >
                                        {allTypesOn ? 'Deselect all' : 'Select all'}
                                    </button>
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                                    {BATCH_TYPES.map((t) => {
                                        const on = batchTypes.includes(t);
                                        return (
                                            <button
                                                key={t}
                                                onClick={() => toggleType(t)}
                                                className={`text-left px-3.5 py-2.5 rounded-xl border text-sm font-medium transition-colors flex items-start gap-2 ${on
                                                    ? 'bg-amber-600 text-white border-amber-600'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:border-amber-300'}`}
                                            >
                                                <span className={`mt-0.5 shrink-0 w-4 h-4 rounded border flex items-center justify-center ${on ? 'bg-white/20 border-white' : 'border-slate-300'}`}>
                                                    {on && <CheckCircle2 size={12} className="text-white" />}
                                                </span>
                                                <span className="min-w-0">
                                                    {t}
                                                    <span className={`block text-[11px] mt-0.5 ${on ? 'text-amber-100' : 'text-slate-400'}`}>
                                                        Output: {OUTPUT_TYPE[t]}
                                                    </span>
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-[11px] text-slate-400 mt-1.5">All types on by default — deselect any you want to skip. A batch is created per type.</p>
                            </div>

                            <div>
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                                    <CalendarDays size={14} /> 2 · Include sub-orders from
                                </p>
                                <div className="grid grid-cols-2 gap-2">
                                    <label className="block">
                                        <span className="block text-[11px] text-slate-500 mb-1">From</span>
                                        <input
                                            type="date"
                                            value={startDate}
                                            min={HARD_START_DATE}
                                            max={endDate || undefined}
                                            onChange={(e) => { setStartDate(e.target.value); setRangeAnchor(null); }}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                                        />
                                    </label>
                                    <div>
                                        <div className="text-[11px] text-slate-500 mb-1 flex items-center gap-1">
                                            <span>To</span>
                                            {endDate
                                                ? <button onClick={() => { setEndDate(''); setRangeAnchor(null); }} className="text-amber-700 hover:underline">· clear</button>
                                                : <span className="text-slate-400">· open-ended</span>}
                                        </div>
                                        <input
                                            type="date"
                                            value={endDate}
                                            min={startDate || HARD_START_DATE}
                                            onChange={(e) => { setEndDate(e.target.value); setRangeAnchor(null); }}
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-amber-500 focus:border-amber-500 outline-none bg-white"
                                        />
                                    </div>
                                </div>
                                {batchTypes.length === 0 ? (
                                    <p className="mt-2 p-3 bg-white border border-slate-200 rounded-xl text-[12px] text-slate-500">
                                        Pick at least one batch type above to see how many sub-orders are still available per date.
                                    </p>
                                ) : (
                                    <AvailabilityCalendar
                                        counts={dateCounts}
                                        from={startDate}
                                        to={endDate}
                                        minDate={HARD_START_DATE}
                                        maxDate={lastDate}
                                        loading={datesLoading}
                                        onPick={pickDate}
                                        hint={rangeAnchor
                                            ? 'Tap another day to stretch the range, or leave it as a single day.'
                                            : 'Each day shows the sub-orders still waiting for a job of the chosen types. Tap a day, then tap a second one for a range.'}
                                    />
                                )}
                                <p className="text-[11px] text-slate-400 mt-1.5">
                                    {batchTypes.length > 0 && (
                                        <span className="text-slate-500 font-medium">
                                            {rangeCount} sub-order{rangeCount !== 1 ? 's' : ''} available in this range.{' '}
                                        </span>
                                    )}
                                    Pulls UPDATED-TO-FACTORY sub-orders {endDate ? `between ${startDate} and ${endDate} (both included)` : 'from this date onwards'} with
                                    no matching job yet (including previously postponed ones).
                                </p>
                            </div>

                            <Button
                                variant="primary"
                                className="w-full bg-amber-600 hover:bg-amber-700"
                                disabled={batchTypes.length === 0 || !startDate || loading}
                                icon={loading ? Loader2 : Search}
                                onClick={findSubOrders}
                            >
                                {loading ? 'Finding sub-orders…' : 'Find sub-orders'}
                            </Button>
                        </div>
                    )}

                    {/* STEP 2 — REVIEW, ALLOCATION & CONFIRM (per chosen type) */}
                    {(step === 'review' || step === 'writing') && (
                        <div className="space-y-4">
                            {plans.map(({ batchType, plan }) => (
                                <PlanSection key={batchType} batchType={batchType} plan={plan} onViewForm={viewOrderForm} />
                            ))}
                        </div>
                    )}

                    {/* DONE */}
                    {step === 'done' && (
                        <div className="text-center py-12">
                            <CheckCircle2 size={56} className="mx-auto mb-4 text-green-600" />
                            <p className="text-lg font-bold text-slate-800">{createdCount} Batch{createdCount !== 1 ? 'es' : ''} Created</p>
                            <p className="text-sm text-slate-500 mt-1">
                                {batchTypes.join(' · ')} · {totalJobs} job(s)
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer actions */}
                <div className="bg-white border-t border-slate-200 px-4 py-3 flex items-center justify-between gap-2 sm:rounded-b-2xl">
                    {step === 'review' && (
                        <>
                            <Button variant="ghost" icon={ChevronLeft} onClick={() => { setStep('setup'); setPlans([]); }}>Back</Button>
                            <Button variant="ghost" icon={Download} disabled={plans.length === 0} onClick={exportCsv}>
                                <span className="hidden sm:inline">Download </span>CSV
                            </Button>
                            <Button
                                variant="primary" className="bg-green-600 hover:bg-green-700 shrink-0 whitespace-nowrap"
                                icon={ClipboardCheck} disabled={totalJobs === 0 || stranded}
                                onClick={() => setConfirmOpen(true)}
                            >
                                <span className="hidden sm:inline">Confirm &amp; </span>Create ({totalJobs} job{totalJobs !== 1 ? 's' : ''})
                            </Button>
                        </>
                    )}
                    {step === 'writing' && (
                        <div className="w-full flex items-center justify-center gap-2 text-slate-500 text-sm py-1">
                            <Loader2 size={18} className="animate-spin" /> Writing batch, jobs and sub-orders…
                        </div>
                    )}
                    {step === 'done' && (
                        <Button variant="primary" className="w-full bg-amber-600 hover:bg-amber-700"
                            onClick={() => onCreated?.()}>
                            Done
                        </Button>
                    )}
                    {step === 'setup' && <div className="text-[11px] text-slate-400">Nothing is written until you confirm.</div>}
                </div>
            </div>
        </div>
        {confirmOpen && (
            <ConfirmCreateDialog
                batches={batchesToCreate}
                totalJobs={totalJobs}
                totalPostponed={totalPostponed}
                onCancel={() => setConfirmOpen(false)}
                onConfirm={confirmCreate}
            />
        )}
        {(loadingPreview || previewImage) && (
            <ImagePreviewModal src={previewImage} loading={loadingPreview && !previewImage} onClose={closePreview} />
        )}
        </>
    );
};

const Stat = ({ label, value, tone = 'slate' }) => {
    const cls = { amber: 'text-amber-700', red: 'text-red-700', green: 'text-emerald-700', sky: 'text-sky-700' }[tone] || 'text-slate-800';
    return (
        <div className="bg-white rounded-lg border border-slate-200 px-3 py-1.5">
            <span className="text-[11px] text-slate-400 mr-2">{label}</span>
            <span className={`font-bold ${cls}`}>{value}</span>
        </div>
    );
};

// Roll width a job will be cut from (roll-width batch types only).
const RollBadge = ({ width }) => width ? (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold text-indigo-700 bg-indigo-50 ring-1 ring-indigo-200">
        Roll {width}″
    </span>
) : null;

// Quantity label for a sub-order, showing the order input and the unit allocation
// actually uses. Piece-type batches (handles / patty) allocate in bundles: HANDLE
// orders are quoted in kg, the rest in pieces, and un-sizable orders show "?".
// STITCHING sheet orders show their piece count and the converted kg.
const qtyLabel = (batchType, so, unit) => {
    const qty = num(so.Quantity);
    if (BUNDLE_SIZE[batchType] != null) {
        const input = String(so.Model || '').trim().toUpperCase() === 'HANDLE' ? `${qty} kg` : `${qty} pcs`;
        if (cannotSizePieces(batchType, so)) return `${input} · ? bundles`;
        return `${input} · ${effectiveQty(batchType, so).toFixed(2)} bundles`;
    }
    if (batchType === 'ROLLS TO SIDEPATTY') {
        if (cannotSizePatty(batchType, so)) return `${qty} pcs · ? kg`;
        return `${qty} pcs · ${effectiveQty(batchType, so).toFixed(2)} kg`;
    }
    if (!needsPieceConversion(batchType, so)) {
        const planned = effectiveQty(batchType, so);
        return Math.abs(planned - qty) < 0.005
            ? `${qty}${unit}`
            : `${qty}${unit} · ${planned.toFixed(2)}${unit}`;
    }
    if (cannotConvertQty(batchType, so)) return `${qty} pcs · ? kg`;
    return `${qty} pcs · ${effectiveQty(batchType, so).toFixed(2)} kg`;
};

// --- CSV export of the review (one row per sub-order, with its group, job and
// allocation details — everything the review/confirm screens show) ---
const CSV_HEADERS = [
    'Batch Type', 'Output Type', 'Job Name', 'Job Item Code ID',
    'Group', 'Group Material', 'Group Colour', 'Group GSM', 'Group Width (in)', 'Roll Width (in)',
    'Unit', 'Group Required', 'Group Fulfilled', 'Group To Produce', 'Group From Stock',
    'Group Required Count', 'Count Unit', 'Production Overage %',
    'Priority', 'Priority Label', 'Stock Items', 'Allocation Detail', 'Group Postponed Count',
    'Sub-Order Status', 'Sub-Order ID', 'Order ID', 'Shop', 'Model', 'Roll Material',
    'Bag Colour', 'Bag GSM', 'Bag Width', 'Bag Height', 'Sheet Size',
    'Sidepatty Colour', 'Sidepatty GSM', 'Sidepatty Width', 'Handle Colour',
    'Size Label', 'Size', 'Quantity', 'Quantity Type', 'Planned Quantity (incl. overage)',
    'Order Form Date', 'Factory Updated Date', 'Previously No-Stock Flagged',
    'Sub-Order Required Count'
];

// The sub-order half of a row — shared by grouped and flagged sub-orders.
const csvSubOrderCells = (so, batchType, unit, status) => {
    const size = sizeText(batchType, so);
    return [
        status, so.id, so.Order_ID ?? '', so.Shop || '', so.Model || '', so.Roll_Material || '',
        so.Bag_Colour || '', so.Bag_GSM || '', so.Bag_Width || '', so.Bag_Height || '', so.Sheet_Size || '',
        so.Sidepatty_Colour || '', so.Sidepatty_GSM || '', so.Sidepatty_Width || '', so.Handle_Colour || '',
        size.label, size.value, so.Quantity ?? '', so.Quantity_Type || '',
        fmtQty(effectiveQty(batchType, so), BUNDLE_SIZE[batchType] != null),
        dateText(so.Order_Form_Date), dateText(so.Factory_Updated_Date),
        truthy(so.No_Stock_Identified) ? 'Yes' : 'No',
        (() => { const c = outputCount(batchType, so); return c ? Math.ceil(c.count - 1e-9) : ''; })()
    ];
};

// Blank group/job/allocation cells (everything after Batch Type + Output Type),
// for sub-orders that never reached a group.
const CSV_EMPTY_GROUP_CELLS = new Array(21).fill('');

const buildCsvRows = (plans, codeNames) => {
    const rows = [];
    for (const { batchType, plan } of plans) {
        const unit = plan.isPieces ? ' bundles' : ' kg';
        const unitLabel = plan.isPieces ? 'bundles' : 'kg';
        for (const g of plan.groups) {
            const fulfilledIds = new Set(g.fulfilled.map((so) => so.id));
            const itemIds = [...new Set(g.picks.map((p) => p.itemId))];
            const allocation = g.picks
                .map((p) => `#${p.itemId} ${p.source} ${fmtQty(p.take, plan.isPieces)}${unitLabel}`)
                .join(' | ');
            const groupCells = [
                batchType, OUTPUT_TYPE[batchType] || '',
                (g.matchedCodeId && codeNames.get(num(g.matchedCodeId))) || '',
                g.matchedCodeId || '',
                attrText(g.attrs), g.attrs.material || '', g.attrs.colour || '', g.attrs.gsm || '',
                g.attrs.width || '', g.rollWidth || '',
                unitLabel, fmtQty(g.requiredQty, plan.isPieces), fmtQty(g.fulfilledQty, plan.isPieces),
                plan.isPieces ? '' : fmtKg(g.outputQty), plan.isPieces ? '' : fmtKg(g.finishedQty),
                Math.ceil(g.requiredCount.count - 1e-9), g.requiredCount.unit,
                Math.round(overageRate(batchType) * 100),
                g.priority, PRIORITY_LABEL[g.priority] || '', itemIds.length, allocation, g.postponed.length
            ];
            for (const so of g.subOrders) {
                rows.push([
                    ...groupCells,
                    ...csvSubOrderCells(so, batchType, unit, fulfilledIds.has(so.id) ? 'Fulfilled' : 'Postponed')
                ]);
            }
        }
        const flagged = [
            ...plan.unmatched.map((so) => [so, 'No matching roll width']),
            ...plan.missingGsm.map((so) => [so, 'Missing info — cannot size'])
        ];
        for (const [so, status] of flagged) {
            rows.push([
                batchType, OUTPUT_TYPE[batchType] || '', ...CSV_EMPTY_GROUP_CELLS,
                ...csvSubOrderCells(so, batchType, unit, status)
            ]);
        }
    }
    return rows;
};

const csvCell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// BOM so Excel opens the UTF-8 content correctly.
const downloadCsv = (filename, headers, rows) => {
    const csv = [headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
};

const SubOrderPill = ({ so, batchType, unit, tone = 'slate', onViewForm, showMissing = false }) => {
    const size = sizeText(batchType, so);
    const orderId = so.Order_ID === null || so.Order_ID === undefined || so.Order_ID === '' ? null : so.Order_ID;
    const hasForm = onViewForm && parseAttachmentId(so.Order_Form) != null;
    const missing = showMissing ? missingInfoFields(batchType, so) : null;
    // Amber matches the "postponed → No_Stock_Identified" note under the group, so
    // the sub-orders it refers to are identifiable at a glance.
    const cls = {
        red: 'bg-white text-red-700 ring-red-200',
        amber: 'bg-amber-50 text-amber-800 ring-amber-300'
    }[tone] || 'bg-slate-100 text-slate-600 ring-slate-200';
    return (
        <span className={'inline-flex flex-col gap-0.5 px-2 py-1 rounded-md text-[11px] ring-1 ' + cls}>
            <span className="inline-flex items-center gap-1 font-medium">
                <Layers size={11} /> {so.Shop || ('#' + so.id)} · {qtyLabel(batchType, so, unit)}
                {hasForm && (
                    <button
                        type="button"
                        onClick={() => onViewForm(so.Order_Form)}
                        title="View order form full screen"
                        className="ml-0.5 inline-flex items-center hover:opacity-60"
                    >
                        <Maximize2 size={11} />
                    </button>
                )}
            </span>
            <span>{size.label}: <span className="font-medium">{size.value}</span></span>
            {missing && missing.length > 0 && (
                <span className="font-semibold">Missing: {missing.join(', ')}</span>
            )}
            <span>{orderId != null ? `Order #${orderId} · ` : ''}Ordered: {dateText(so.Order_Form_Date)} · Factory: {dateText(so.Factory_Updated_Date)}</span>
        </span>
    );
};

// Sub-orders that couldn't be placed in any job, for a stated reason. Rendered
// during review and confirm so the operator can fix the data and re-run.
const FlaggedPanel = ({ subOrders, batchType, unit, title, detail, onViewForm, showMissing = false }) => {
    if (!subOrders || subOrders.length === 0) return null;
    return (
        <div className="bg-red-50 border border-red-200 rounded-xl p-3">
            <p className="text-sm font-semibold text-red-800 flex items-center gap-1.5 mb-1">
                <AlertCircle size={15} /> {subOrders.length} sub-order{subOrders.length !== 1 ? 's' : ''} {title}
            </p>
            <p className="text-[11px] text-red-600 mb-2">{detail}</p>
            <div className="flex flex-wrap gap-1.5">
                {subOrders.map((so) => (
                    <SubOrderPill key={so.id} so={so} batchType={batchType} unit={unit} tone="red"
                        onViewForm={onViewForm} showMissing={showMissing} />
                ))}
            </div>
        </div>
    );
};

// Sub-orders whose required roll width exceeds every available roll.
const UnmatchedPanel = ({ subOrders, batchType, unit, onViewForm }) => (
    <FlaggedPanel
        subOrders={subOrders} batchType={batchType} unit={unit} onViewForm={onViewForm}
        title="with no matching roll width"
        detail="Bag/sheet too large for any available roll — fix the size or add a wider roll. These are left out of every job."
    />
);

// Orders that can't be sized: STITCHING pieces with no Bag_GSM, un-sizable HANDLE
// weight orders, or side/bottom patty missing strip width / bag dims / GSM.
const MissingGsmPanel = ({ subOrders, batchType, unit, onViewForm }) => (
    <FlaggedPanel
        subOrders={subOrders} batchType={batchType} unit={unit} onViewForm={onViewForm} showMissing
        title="missing info — can't size the order"
        detail="Each order below lists the Sub_Orders field it is missing (sheet size, GSM, bag dimensions or patty width). Sheet size is entered per sub-order and is not the bag size. Fill it in and re-run — these are left out of every job."
    />
);

// Last-chance guard before the batch, jobs and sub-order flags are written.
// Nothing is written until this is accepted.
const ConfirmCreateDialog = ({ batches, totalJobs, totalPostponed, onCancel, onConfirm }) => (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4" onClick={onCancel}>
        <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start gap-3">
                <span className="shrink-0 w-9 h-9 rounded-full bg-amber-100 text-amber-700 flex items-center justify-center">
                    <AlertCircle size={20} />
                </span>
                <div className="min-w-0">
                    <h3 className="font-bold text-slate-800">Create these jobs?</h3>
                    <p className="text-sm text-slate-500 mt-0.5">
                        This writes {batches.length} batch{batches.length !== 1 ? 'es' : ''} and {totalJobs} job
                        {totalJobs !== 1 ? 's' : ''} to Grist. It can&apos;t be undone from here.
                    </p>
                </div>
            </div>
            <ul className="mt-3 space-y-1 text-xs text-slate-600 bg-slate-50 rounded-lg p-2.5">
                {batches.map(({ batchType, plan }) => (
                    <li key={batchType} className="flex items-center justify-between gap-2">
                        <span className="truncate">{batchType}</span>
                        <span className="shrink-0 font-semibold">{plan.jobCount} job{plan.jobCount !== 1 ? 's' : ''}</span>
                    </li>
                ))}
            </ul>
            {totalPostponed > 0 && (
                <p className="mt-2 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1.5">
                    {totalPostponed} sub-order(s) will be flagged No_Stock_Identified.
                </p>
            )}
            <div className="mt-4 flex gap-2">
                <Button variant="secondary" className="flex-1" onClick={onCancel}>Cancel</Button>
                <Button
                    variant="primary" className="flex-1 bg-green-600 hover:bg-green-700"
                    icon={ClipboardCheck} onClick={onConfirm}
                >
                    Create
                </Button>
            </div>
        </div>
    </div>
);

// Full-screen order-form image preview (mirrors FactoryView's modal).
const ImagePreviewModal = ({ src, loading, onClose }) => (
    <div className="fixed inset-0 bg-black/90 flex items-center justify-center z-[60] p-4" onClick={onClose}>
        <button onClick={onClose} className="absolute top-4 right-4 text-white hover:text-slate-300 p-2">
            <X size={32} />
        </button>
        <div className="max-w-4xl max-h-[90vh] w-full flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            {loading ? (
                <div className="text-white flex flex-col items-center">
                    <Loader2 size={48} className="animate-spin mb-4" />
                    <p>Loading order form…</p>
                </div>
            ) : src ? (
                <img src={src} alt="Order form" className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl" />
            ) : (
                <div className="text-white text-center">
                    <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
                    <p>Order form not available</p>
                </div>
            )}
        </div>
    </div>
);

const Empty = ({ label }) => (
    <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
        <Search size={40} className="mx-auto mb-3 text-slate-300" />
        <p className="text-sm">{label}</p>
    </div>
);

// Stacked bar splitting a job/batch quantity into production output (to make) vs.
// finished stock pulled from the godown. Hidden for piece-type batches.
const QtyBar = ({ output, finished, unit = ' kg' }) => {
    const o = num(output), f = num(finished), total = o + f;
    if (total <= 0) return null;
    return (
        <div className="mt-1.5">
            <div className="flex h-1.5 rounded-full overflow-hidden bg-slate-100">
                {o > 0 && <div style={{ width: `${(o / total) * 100}%` }} className="bg-emerald-500" />}
                {f > 0 && <div style={{ width: `${(f / total) * 100}%` }} className="bg-sky-400" />}
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[10px]">
                <span className="text-emerald-700">● {fmtKg(o)}{unit} to produce</span>
                {f > 0 && <span className="text-sky-700">● {fmtKg(f)}{unit} from stock</span>}
            </div>
        </div>
    );
};

// Section divider naming a batch type, used when several are built at once.
// Clickable: toggles the collapsed details below it (summary stats stay visible).
const TypeHeader = ({ batchType, open, onToggle }) => (
    <button
        type="button"
        onClick={onToggle}
        className="w-full flex items-center gap-2 border-b border-slate-200 pb-1.5 pt-1 text-left"
    >
        {open
            ? <ChevronDown size={14} className="text-slate-400 shrink-0" />
            : <ChevronRight size={14} className="text-slate-400 shrink-0" />}
        <span className="text-sm font-bold text-slate-800">{batchType}</span>
        <span className="text-[11px] text-slate-400">→ {OUTPUT_TYPE[batchType]}</span>
        {overageRate(batchType) > 0 && (
            <span
                className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md text-orange-700 bg-orange-50 ring-1 ring-orange-200"
                title="Extra production added for misprints and wastage — included in every figure below"
            >
                +{Math.round(overageRate(batchType) * 100)}% wastage
            </span>
        )}
        <span className="ml-auto text-[11px] text-slate-400">{open ? 'Hide' : 'Details'}</span>
    </button>
);

// One chosen type's plan: the groups, what each needs, what stock covers it, and
// the sub-orders behind it — everything the operator checks before creating.
const PlanSection = ({ batchType, plan, onViewForm }) => {
    const [open, setOpen] = useState(false);
    const unit = plan.isPieces ? ' bundles' : ' kg';
    const subOrders = plan.groups.reduce((s, g) => s + g.subOrders.length, 0);
    return (
        <div className="space-y-2">
            <TypeHeader batchType={batchType} open={open} onToggle={() => setOpen((o) => !o)} />
            <div className="flex flex-wrap gap-2 text-sm">
                <Stat label="Groups" value={plan.groups.length} />
                <Stat label="Sub-orders" value={subOrders} />
                <Stat label="Jobs" value={plan.jobCount} />
                {countText(plan.totalRequiredCount) && <Stat label="Output" value={countText(plan.totalRequiredCount)} tone="sky" />}
                <Stat label={`Planned${plan.isPieces ? ' (bundles)' : ' kg'}`} value={fmtQty(plan.totalPlannedQty, plan.isPieces)} />
                {!plan.isPieces && plan.totalFinishedQty > 0 && <Stat label="To produce kg" value={fmtKg(plan.totalOutputQty)} tone="green" />}
                {!plan.isPieces && plan.totalFinishedQty > 0 && <Stat label="From stock kg" value={fmtKg(plan.totalFinishedQty)} tone="sky" />}
                <Stat label="Postponed" value={plan.postponedCount} tone={plan.postponedCount ? 'amber' : 'slate'} />
                {plan.unmatchedCount > 0 && <Stat label="No roll width" value={plan.unmatchedCount} tone="red" />}
                {plan.missingGsmCount > 0 && <Stat label="Missing info" value={plan.missingGsmCount} tone="red" />}
            </div>
            {open && (
                <>
                    {plan.groups.length === 0 ? (
                        <Empty label="No qualifying sub-orders for this type and date." />
                    ) : plan.groups.map((g) => {
                        const postponedIds = new Set(g.postponed.map((so) => so.id));
                        return (
                        <div key={g.key} className="bg-white rounded-xl border border-slate-200 p-3">
                            <div className="flex items-start justify-between gap-2 mb-1.5">
                                <div className="min-w-0">
                                    <p className="font-semibold text-slate-800 text-sm break-words">{attrText(g.attrs)}</p>
                                    {g.rollWidth ? <div className="mt-1"><RollBadge width={g.rollWidth} /></div> : null}
                                    <p className="text-[11px] text-slate-400 mt-1">
                                        {g.matchedCodeId ? `Item code #${g.matchedCodeId}` : 'No matching item code'}
                                    </p>
                                </div>
                                <PriorityBadge priority={g.priority} />
                            </div>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                                <span className="font-semibold text-slate-700">Required {fmtQty(g.requiredQty, plan.isPieces)}{unit}</span>
                                {countText(g.requiredCount) && (
                                    <span className="font-medium text-slate-600">Output {countText(g.requiredCount)}</span>
                                )}
                                <span>Fulfilled {fmtQty(g.fulfilledQty, plan.isPieces)}{unit}</span>
                                {g.picks.length > 0 && (
                                    <span className="flex items-center gap-1">
                                        <Package size={12} /> {[...new Set(g.picks.map((p) => p.itemId))].length} stock item(s)
                                    </span>
                                )}
                            </div>
                            {!plan.isPieces && <QtyBar output={g.outputQty} finished={g.finishedQty} />}
                            <div className="flex flex-wrap gap-1.5 mt-2">
                                {g.subOrders.map((so) => (
                                    <SubOrderPill
                                        key={so.id} so={so} batchType={batchType} unit={unit}
                                        tone={postponedIds.has(so.id) ? 'amber' : 'slate'}
                                        onViewForm={onViewForm}
                                    />
                                ))}
                            </div>
                            {g.postponed.length > 0 && (
                                <p className="mt-1.5 text-[11px] text-amber-700 bg-amber-50 rounded px-2 py-1">
                                    {g.postponed.length} sub-order(s) postponed → No_Stock_Identified (marked amber above)
                                </p>
                            )}
                        </div>
                        );
                    })}
                    <UnmatchedPanel subOrders={plan.unmatched} batchType={batchType} unit={unit} onViewForm={onViewForm} />
                    <MissingGsmPanel subOrders={plan.missingGsm} batchType={batchType} unit={unit} onViewForm={onViewForm} />
                </>
            )}
        </div>
    );
};

export default CreateBatchModal;
