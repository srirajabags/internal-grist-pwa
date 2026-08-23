import React, { useState, useEffect, useRef } from 'react';
import {
    ArrowLeft, Warehouse, AlertCircle, Loader2, RefreshCw, Search, X, Package,
    LayoutGrid, List, ChevronDown, ShieldAlert, Plus, Minus, ScanLine, PackagePlus, QrCode, Download
} from 'lucide-react';
import Card from '../components/Card';
import InventoryTxnModal from '../components/InventoryTxnModal';
import PendingAckModal from '../components/PendingAckModal';
import StockAdjustModal from '../components/StockAdjustModal';
import QrScanModal from '../components/QrScanModal';
import NewRollStockModal from '../components/NewRollStockModal';
import ItemLabelModal from '../components/ItemLabelModal';
import { makeItemLabelPng, itemLabelLines, makeLabelsZip } from '../utils/itemLabel';
import Button from '../components/Button';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { colourToCss, itemForm, typeName, FORM_LABEL } from '../utils/itemForms';
import { SHEET_FORMS } from '../utils/txnDisplay';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

// Grist summary tables that aggregate Inventory_Transactions. Item attributes
// (Type/Material/Colour/GSM/dimensions/readable code) live on Inventory_Item_Codes;
// the physical item id (e.g. "ROLL_26-06-2026_1") lives on Inventory_Items.
const ACKED_GODOWN_FILTER = `
        s.Location IN ('ROLLS GODOWN', 'BAGS GODOWN')
        AND s.Incharge_Ack = 1
`;
const ACKED_ROLLS_GODOWN_FILTER = `
        s.Location = 'ROLLS GODOWN'
        AND s.Incharge_Ack = 1
`;

const SUMMARY_BY_CODE_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Location';
const SUMMARY_BY_ID_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';

const sqlByCode = (summaryTable) => `
    SELECT
        s.Item_Code AS code_ref,
        s.Location AS location,
        s.Available_Weight_Kg_ AS avail,
        s.Weight_Kg_ AS total,
        s.Available_Count_Bundles_ AS bundles,
        s.count AS cnt,
        ic.Item_Code AS name, ic.Type AS itype,
        ic.Material AS mat, ic.Colour AS col, ic.GSM AS gsm,
        ic.Width_Inches_ AS w, ic.Height_Inches_ AS h
    FROM ${summaryTable} s
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
    WHERE s.Item_Code != 0
        AND ${ACKED_GODOWN_FILTER}
    ORDER BY s.Location, ic.Item_Code
`;

const sqlById = (summaryTable) => `
    SELECT
        it.Item_ID AS iid,
        s.Item_ID AS item_ref,
        s.Item_Code AS code_ref,
        s.Location AS location,
        s.Available_Weight_Kg_ AS avail,
        s.Weight_Kg_ AS total,
        s.Initial_Weight_Kg_ AS initial,
        ic.Type AS itype,
        s.count AS cnt,
        ic.Item_Code AS name,
        ic.Material AS mat, ic.Colour AS col, ic.GSM AS gsm,
        ic.Width_Inches_ AS w, ic.Height_Inches_ AS h
    FROM ${summaryTable} s
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
    LEFT JOIN Inventory_Items it ON it.id = s.Item_ID
    WHERE s.Item_Code != 0
        AND ${ACKED_ROLLS_GODOWN_FILTER}
        AND ic.Type LIKE '%ROLL%'
    ORDER BY s.Location, ic.Item_Code, it.Item_ID
`;

const TABS = [
    { key: 'code', label: 'By Item Code', sql: sqlByCode(SUMMARY_BY_CODE_TABLE) },
    { key: 'id', label: 'Rolls Inventory', sql: sqlById(SUMMARY_BY_ID_TABLE) }
];

// The table wants room for ten columns, so desktop opens on it and narrower
// screens open on cards — using the same 1024px desktop breakpoint as
// useDeviceType. This seeds the initial view only; once the user picks one from
// the header toggle, their choice stands for the rest of the session.
const defaultView = () => (window.matchMedia('(min-width: 1024px)').matches ? 'list' : 'grid');

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);
// Size (W×H) shown in the table and used as the size filter's value.
const sizeLabel = (r) => (r.w || r.h) ? `${r.w || '—'}″ × ${r.h || '—'}″` : '—';
// Columns whose filter value is computed rather than read straight off the row —
// keyed so the filter always offers exactly what the cell displays.
const DERIVED_COL = {
    size: sizeLabel,
    item: (r) => typeName(r.mat, r.itype, r.name)
};

// Production always plans in kg, so kg is the lead denomination everywhere. Godown
// stock, though, is booked by hand in either weight or count; a count-only line is
// converted to kg via piece geometry. Sheets are counted as individual sheets;
// patty/handle in bundles of a fixed piece count.
const PIECES_PER_BUNDLE = {
    sidepatty: 50, bottompatty: 50,
    manualhandle: 100, readymadehandle: 100, pressinghandle: 100
};
// Forms booked one sheet at a time need no bundle multiplier (SHEET_FORMS, shared
// with the transaction views): bottom-patty and model-number sheets belong there,
// not with the patties they are cut into — booking them per bundle would
// overstate stock 50-fold.

// One sheet/piece (kg) = W(in) * H(in) * GSM / (1550 * 1000), since 1550 in² = 1 m².
const PIECE_TO_KG_DIVISOR = 1550 * 1000;
const pieceKg = (r) => {
    const w = num(r.w), h = num(r.h), gsm = num(r.gsm);
    return (w && h && gsm) ? w * h * gsm / PIECE_TO_KG_DIVISOR : 0;   // 0 -> geometry missing
};

// kg implied by a count-booked line: sheets store a sheet count, patty/handle a
// bundle count (× pieces-per-bundle). 0 when geometry is missing.
const countToKg = (r, form) => {
    const per = pieceKg(r);
    if (!per) return 0;
    if (SHEET_FORMS.has(form)) return num(r.bundles) * per;
    const ppb = PIECES_PER_BUNDLE[form];
    return ppb ? num(r.bundles) * ppb * per : 0;
};

// Quantity for a row, always led by kg. Booked weight wins; a count-only line is
// converted to kg from geometry (`derived`), so kg stays the lead denomination.
// The native count is kept as a secondary readout.
const rowQty = (r) => {
    const form = itemForm(r.itype, r.name);
    const recorded = num(r.avail);
    const count = num(r.bundles);
    const kg = recorded > 0 ? recorded : countToKg(r, form);
    return {
        kg,
        count,
        countUnit: SHEET_FORMS.has(form) ? 'sheets' : 'bundles',
        derived: recorded <= 0 && kg > 0,
        hasCount: count > 0
    };
};

// Piece readout for the summary totals: sheets are counted individually, patty
// and handle in bundles. A line booked only by weight is converted back to a
// count from piece geometry (`derived`), so the totals cover every row they can.
const COUNT_UNIT = {
    sheet: 'sheets', bottompattysheet: 'sheets', modelsheet: 'sheets',
    sidepatty: 'bundles', bottompatty: 'bundles',
    manualhandle: 'bundles', readymadehandle: 'bundles', pressinghandle: 'bundles'
};
const rowCount = (r) => {
    const form = itemForm(r.itype, r.name);
    const unit = COUNT_UNIT[form];
    if (!unit) return null;
    const q = rowQty(r);
    if (q.hasCount) return { unit, count: q.count, derived: false };
    const perUnit = pieceKg(r) * (SHEET_FORMS.has(form) ? 1 : PIECES_PER_BUNDLE[form]);
    return (perUnit > 0 && q.kg > 0) ? { unit, count: q.kg / perUnit, derived: true } : null;
};
const fmtCount = (v) => Math.round(v).toLocaleString();

const Chip = ({ children }) => (
    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">{children}</span>
);

// Type filter above the list. `form` draws the same illustration the rows use, so
// the chips read as the item they filter to rather than as text alone.
// The transaction count, as the way into an item's history — same affordance as
// the table's TXNS cell.
const TxnLink = ({ count, onClick }) => (
    count > 0 ? (
        <button
            type="button"
            onClick={onClick}
            title="View transaction history"
            className="font-semibold text-teal-700 underline decoration-dotted underline-offset-2 hover:text-teal-900 hover:decoration-solid"
        >
            {count} txn{count !== 1 ? 's' : ''}
        </button>
    ) : <span>{count} txns</span>
);

const FormChip = ({ label, form, active, onClick }) => (
    <button
        onClick={onClick}
        className={`inline-flex items-center gap-1.5 ${form ? 'pl-1.5 pr-3.5' : 'px-3.5'} py-1 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${active
            ? 'bg-teal-600 text-white border-teal-600'
            : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
            }`}
    >
        {form && (
            <span className={`w-7 shrink-0 rounded-full ${active ? 'bg-white/15' : ''}`}>
                <ItemVisual form={form} size="xs" />
            </span>
        )}
        {label}
    </button>
);

// An item is specified by either a colour or a model number, and both live in the
// same `Colour` field — so model-number stock renders as a code badge rather than
// a meaningless colour swatch.
const isModelCode = (r) => itemForm(r.itype, r.name) === 'modelsheet';

// `flex` (not inline-flex) so the cell's width bounds it — an inline box sizes to
// its content and a long colour name then prints straight over the next column.
const ColourCell = ({ col, asModel }) => (asModel ? (
    <span className="flex min-w-0">
        <span className="truncate px-1.5 py-0.5 rounded text-[11px] font-bold tracking-wide bg-slate-100 text-slate-700">
            {col || '—'}
        </span>
    </span>
) : (
    <span className="flex items-center gap-1.5 min-w-0">
        <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ background: colourToCss(col) }} />
        <span className="truncate">{col || '—'}</span>
    </span>
));

// Per-column multi-select filter shown under a table heading. `values` is the list
// of selected options (empty = no filter); the popover toggles each option.
const ColFilter = ({ values, options, onToggle, onClear }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef(null);
    useEffect(() => {
        if (!open) return;
        const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
        document.addEventListener('mousedown', onDown);
        return () => document.removeEventListener('mousedown', onDown);
    }, [open]);
    const count = values.length;
    const label = count === 0 ? 'All' : count === 1 ? values[0] : `${count} selected`;
    return (
        <div ref={ref} className="relative mt-1 font-normal normal-case max-w-[150px]">
            <button
                type="button"
                onClick={() => setOpen((o) => !o)}
                className={`w-full text-[11px] rounded border px-1.5 py-1 flex items-center justify-between gap-1 bg-white cursor-pointer ${count ? 'border-teal-400 text-teal-700' : 'border-slate-200 text-slate-500'}`}
            >
                <span className="truncate">{label}</span>
                <ChevronDown size={12} className="shrink-0" />
            </button>
            {open && (
                <div className="absolute z-20 mt-1 min-w-full w-max max-w-[220px] max-h-64 overflow-auto rounded-lg border border-slate-200 bg-white shadow-lg py-1">
                    {count > 0 && (
                        <button type="button" onClick={onClear} className="w-full text-left px-2.5 py-1 text-[11px] text-slate-500 hover:bg-slate-50">
                            Clear ({count})
                        </button>
                    )}
                    {options.map((o) => (
                        <label key={o} className="flex items-center gap-2 px-2.5 py-1 text-[11px] text-slate-700 hover:bg-slate-50 cursor-pointer">
                            <input type="checkbox" checked={values.includes(o)} onChange={() => onToggle(o)} className="accent-teal-600 shrink-0" />
                            <span className="truncate">{o}</span>
                        </label>
                    ))}
                </div>
            )}
        </div>
    );
};

// Compact tabular view of the same rows shown as cards — handy on desktop for
// scanning many items at once. The layout is fixed and column widths are
// proportional, so the table always fits its container on desktop; below the
// min-width it scrolls horizontally instead of squashing.
// Widths are in table-column order and are only a ratio — the browser scales them
// to the available width.
const COL_WIDTHS = {
    code: ['40px', '15%', '11%', '14%', '6%', '12%', '10%', '13%', '6%', '108px'],
    id: ['210px', '40px', '8%', '6%', '8%', '5%', '8%', '6%', '10%', '7%', '5%', '108px']
};
// Below these the columns start wrapping, so the table scrolls instead. Desktop
// containers are wider than both, so the fixed layout just fits.
const MIN_TABLE_W = { code: 'min-w-[960px]', id: 'min-w-[1240px]' };

const InventoryTable = ({ rows, tab, colFilters, options, onColToggle, onColClear, onOpenTxns, onAdjust, onLabel, labelFor }) => {
    const isRolls = tab === 'id';
    // Text columns wrap so they can give width back; only figures stay on one line.
    const th = 'py-2 px-2.5 font-semibold align-top';
    const td = 'py-1.5 px-2.5';
    const tdNum = `${td} whitespace-nowrap tabular-nums`;
    const filter = (key) => (
        <ColFilter
            values={colFilters[key] || []}
            options={options[key] || []}
            onToggle={(v) => onColToggle(key, v)}
            onClear={() => onColClear(key)}
        />
    );
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className={`w-full table-fixed text-sm ${MIN_TABLE_W[tab] || MIN_TABLE_W.code}`}>
                <colgroup>
                    {(isRolls ? COL_WIDTHS.id : COL_WIDTHS.code).map((w, i) => <col key={i} style={{ width: w }} />)}
                </colgroup>
                <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                        {isRolls && <th className={th}>Roll #</th>}
                        <th className={th}></th>
                        <th className={th}>Item{filter('item')}</th>
                        <th className={th}>Material{filter('mat')}</th>
                        <th className={th}>Colour / Model{filter('col')}</th>
                        <th className={`${th} text-right whitespace-nowrap`}>GSM{filter('gsm')}</th>
                        <th className={th}>Location{filter('location')}</th>
                        <th className={`${th} text-right`}>Size&nbsp;(W×H){filter('size')}</th>
                        <th className={`${th} text-right`}>Available</th>
                        {isRolls && <th className={`${th} text-right`}>Initial</th>}
                        <th className={`${th} text-right`}>Txns</th>
                        <th className={`${th} text-center`}>Stock</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r, idx) => {
                        const q = rowQty(r);
                        return (
                            <tr key={`${r.code_ref}-${r.iid ?? idx}`} className="hover:bg-slate-50">
                                {isRolls && (
                                    <td className={`${tdNum} font-bold text-teal-800`}>#{r.iid || '—'}</td>
                                )}
                                <td className="py-1 px-1.5">
                                    <div className="w-9"><ItemVisual colour={r.col} type={r.itype} name={r.name} size="sm" /></div>
                                </td>
                                <td className={`${td} font-medium text-slate-800`}>{typeName(r.mat, r.itype, r.name)}</td>
                                <td className={`${td} text-slate-600`}>{r.mat || '—'}</td>
                                <td className={`${td} text-slate-600`}><ColourCell col={r.col} asModel={isModelCode(r)} /></td>
                                <td className={`${tdNum} text-right text-slate-600`}>{r.gsm || '—'}</td>
                                <td className={`${td} text-slate-600`}>{r.location || '—'}</td>
                                <td className={`${tdNum} text-right text-slate-600`}>
                                    {sizeLabel(r)}
                                </td>
                                <td className={`${tdNum} text-right`}>
                                    <span className="font-bold text-teal-700 tabular-nums" title={q.derived ? 'Converted from count' : undefined}>
                                        {q.derived && <span className="font-normal text-slate-400">≈ </span>}
                                        {fmtKg(q.kg)}<span className="text-xs font-normal text-slate-400"> kg</span>
                                    </span>
                                    {!isRolls && q.hasCount && (
                                        <div className="text-[11px] text-slate-400 tabular-nums">{q.count} {q.countUnit}</div>
                                    )}
                                </td>
                                {isRolls && <td className={`${tdNum} text-right text-slate-500`}>{fmtKg(r.initial)} kg</td>}
                                <td className={`${tdNum} text-right`}>
                                    {num(r.cnt) > 0 ? (
                                        <button
                                            type="button"
                                            onClick={() => onOpenTxns(r)}
                                            title="View transaction history"
                                            className="font-semibold text-teal-700 underline decoration-dotted underline-offset-2 hover:text-teal-900 hover:decoration-solid"
                                        >
                                            {num(r.cnt)}
                                        </button>
                                    ) : <span className="text-slate-400">0</span>}
                                </td>
                                <td className="py-1.5 px-1.5">
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => onAdjust(r, 'ADD')}
                                            title="Add stock"
                                            className="w-7 h-7 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 flex items-center justify-center"
                                        >
                                            <Plus size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onAdjust(r, 'LESS')}
                                            title="Reduce stock"
                                            className="w-7 h-7 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 flex items-center justify-center"
                                        >
                                            <Minus size={14} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => onLabel(r)}
                                            title="Download this item's QR label"
                                            className="w-7 h-7 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 flex items-center justify-center"
                                        >
                                            {labelFor === (r.code_ref ?? r.item_ref)
                                                ? <Loader2 size={13} className="animate-spin" />
                                                : <QrCode size={14} />}
                                        </button>
                                    </div>
                                </td>
                            </tr>
                        );
                    })}
                </tbody>
            </table>
        </div>
    );
};

const InventoryView = ({ onBack, getHeaders, getUrl }) => {
    const [tab, setTab] = useState('code');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [selectedForm, setSelectedForm] = useState('');
    const [view, setView] = useState(defaultView); // 'grid' (cards) | 'list' (table)
    // Per-column dropdown filters for the table view: { mat, col, gsm, location }.
    const [colFilters, setColFilters] = useState({});
    // Row whose Inventory_Transactions history is open, or null.
    const [txnRow, setTxnRow] = useState(null);
    // Transactions the incharge has not signed off yet — they do not count towards
    // stock, so the queue is surfaced as an action button while any are waiting.
    const [pendingAck, setPendingAck] = useState(0);
    const [ackOpen, setAckOpen] = useState(false);
    // Roll being booked in or out, with the direction: { row, mode }.
    const [adjusting, setAdjusting] = useState(null);
    const [scanning, setScanning] = useState(false);
    const [newStock, setNewStock] = useState(false);
    const [labelFor, setLabelFor] = useState(null);
    const [label, setLabel] = useState(null);   // { iid, url, filename }
    const [bulk, setBulk] = useState(null);     // { done, total }
    const [scanError, setScanError] = useState(null);

    const fetchData = async (activeTab) => {
        setLoading(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);
            const sql = TABS.find((t) => t.key === activeTab).sql;
            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql, args: [] })
            });
            if (!response.ok) {
                const text = await response.text().catch(() => '');
                throw new Error(`Query failed: ${response.statusText}${text ? ` - ${text}` : ''}`);
            }
            const data = await response.json();
            setRows((data.records || []).map((r) => r.fields));
        } catch (err) {
            const message = err.message || String(err) || 'Unknown error occurred';
            console.error('Inventory Error:', message);
            setError(message);
            setRows([]);
        } finally {
            setLoading(false);
        }
    };

    // How many transactions are still waiting on the incharge. Cheap enough to
    // re-run whenever the list is refreshed or something is signed off.
    const fetchPendingAck = async () => {
        try {
            const headers = await getHeaders();
            const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: `SELECT count(*) AS n FROM Inventory_Transactions
                          WHERE Incharge_Ack IS NULL OR Incharge_Ack = 0`,
                    args: []
                })
            });
            if (!res.ok) return;
            const data = await res.json();
            setPendingAck(num((data.records || [])[0]?.fields?.n));
        } catch {
            // The queue button is an extra; the inventory list stands on its own.
        }
    };

    const refresh = (activeTab) => { fetchData(activeTab); fetchPendingAck(); };

    // A scanned label names a roll. Prefer the row already on screen -- it carries
    // the live available figure -- and fall back to Grist, so a roll that is out
    // of stock (and so absent from the list) can still be booked back in.
    // Every stock item, roll or not, is one row in Inventory_Items, so a scanned
    // label resolves the same way regardless of type. The rows already on screen
    // are preferred because they carry the live figures.
    const openScannedItem = async ({ raw, id }) => {
        setScanning(false);
        setScanError(null);
        const scanned = String(raw || '').trim();
        if (!scanned) {
            setScanError('Nothing was read from that code.');
            return;
        }
        const onScreen = rows.find((r) => {
            const iid = String(r.iid || '').toUpperCase();
            return iid && (iid === id || scanned.toUpperCase().includes(iid));
        });
        if (onScreen) { setAdjusting({ row: onScreen, mode: 'ADD', fromScan: true }); return; }
        try {
            const row = await lookupItem({ id, scanned });
            if (!row) {
                setScanError(`Scanned "${scanned}" — no stock item matches that.`);
                return;
            }
            setAdjusting({ row, mode: 'ADD', fromScan: true });
        } catch (err) {
            setScanError(`Scanned "${scanned}" — lookup failed: ${err.message || String(err)}`);
        }
    };

    // Find a physical item by its label, or by the item code behind a by-code row.
    // Location comes from wherever the item actually holds stock, falling back to
    // the godown its type belongs in.
    const lookupItem = async ({ id, scanned, codeRef, location }) => {
        const headers = await getHeaders();
        const byCode = codeRef != null;
        const numeric = !byCode && /^\d+$/.test(String(scanned || '')) ? Number(scanned) : 0;
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({
                sql: `SELECT it.id AS item_ref, it.Item_ID AS iid,
                             ic.id AS code_ref, ic.Item_Code AS name, ic.Type AS itype,
                             ic.Material AS mat, ic.Colour AS col, ic.GSM AS gsm,
                             ic.Width_Inches_ AS w, ic.Height_Inches_ AS h,
                             s.Location AS location,
                             COALESCE(s.Available_Weight_Kg_, 0) AS avail,
                             -- Only the by-code summary carries a bundle count, so
                             -- the count comes from there for the same location.
                             COALESCE((
                                 SELECT c2.Available_Count_Bundles_
                                 FROM ${SUMMARY_BY_CODE_TABLE} c2
                                 WHERE c2.Item_Code = it.Item_Code
                                   AND c2.Location = s.Location
                                   AND c2.Incharge_Ack = 1
                                 LIMIT 1
                             ), 0) AS bundles
                      FROM Inventory_Items it
                      LEFT JOIN Inventory_Item_Codes ic ON ic.id = it.Item_Code
                      LEFT JOIN ${SUMMARY_BY_ID_TABLE} s
                             ON s.Item_ID = it.id AND s.Incharge_Ack = 1
                            ${byCode ? "AND s.Location = ?" : ''}
                      WHERE ${byCode
                          ? 'it.Item_Code = ?'
                          : `upper(it.Item_ID) = ?
                             OR instr(upper(?), upper(it.Item_ID)) > 0
                             OR (? > 0 AND it.id = ?)`}
                      ORDER BY COALESCE(s.Available_Weight_Kg_, 0) DESC
                      LIMIT 1`,
                args: byCode
                    ? [location, num(codeRef)]
                    : [id, String(scanned || '').toUpperCase(), numeric, numeric]
            })
        });
        if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
        const [row] = ((await res.json()).records || []).map((r) => r.fields);
        if (!row) return null;
        return {
            ...row,
            location: row.location || location
                || (/ROLL/i.test(String(row.itype || '')) ? 'ROLLS GODOWN' : 'BAGS GODOWN')
        };
    };

    // A by-code row has no physical item on it, so resolve one before booking.
    const adjustRow = async (row, mode) => {
        setScanError(null);
        if (row.item_ref != null) { setAdjusting({ row, mode }); return; }
        try {
            const resolved = await lookupItem({ codeRef: row.code_ref, location: row.location });
            if (!resolved) {
                setScanError(`No physical item exists for ${row.name || 'this item code'} yet.`);
                return;
            }
            setAdjusting({ row: { ...resolved, avail: row.avail, bundles: row.bundles }, mode });
        } catch (err) {
            setScanError(err.message || String(err));
        }
    };

    // Labels for everything currently listed, as one zip. Rows are resolved to
    // physical items in a single query rather than one per row.
    const downloadAllLabels = async (listed) => {
        setScanError(null);
        if (listed.length === 0) return;
        setBulk({ done: 0, total: listed.length });
        try {
            const needCodes = [...new Set(listed.filter((r) => !r.iid).map((r) => num(r.code_ref)))].filter(Boolean);
            const resolved = new Map();
            if (needCodes.length > 0) {
                const headers = await getHeaders();
                const holes = needCodes.map(() => '?').join(',');
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sql: `SELECT it.Item_Code AS code_ref, it.Item_ID AS iid, ic.Type AS itype,
                                     ic.Colour AS col, ic.GSM AS gsm,
                                     ic.Width_Inches_ AS w, ic.Height_Inches_ AS h
                              FROM Inventory_Items it
                              LEFT JOIN Inventory_Item_Codes ic ON ic.id = it.Item_Code
                              WHERE it.Item_Code IN (${holes})`,
                        args: needCodes
                    })
                });
                if (!res.ok) throw new Error(`Lookup failed (${res.status})`);
                for (const row of ((await res.json()).records || []).map((r) => r.fields)) {
                    resolved.set(num(row.code_ref), row);
                }
            }

            const items = listed.map((r) => {
                // Rows on the rolls tab already carry everything; by-code rows take
                // the item id from the resolved row and the rest from the row itself.
                const item = r.iid ? r : { ...r, ...(resolved.get(num(r.code_ref)) || {}) };
                if (!item?.iid) return null;
                return { iid: item.iid, lines: itemLabelLines(item) };
            }).filter(Boolean);

            if (items.length === 0) {
                setScanError('None of these items has a physical item id to label yet.');
                return;
            }

            const zip = await makeLabelsZip(items, (done, total) => setBulk({ done, total }));
            const url = URL.createObjectURL(zip.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = zip.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            if (items.length < listed.length) {
                setScanError(`${listed.length - items.length} of ${listed.length} items had no physical item id and were skipped.`);
            }
        } catch (err) {
            setScanError(`Could not build the labels: ${err.message || String(err)}`);
        } finally {
            setBulk(null);
        }
    };

    const closeLabel = () => {
        setLabel((prev) => {
            if (prev?.url) URL.revokeObjectURL(prev.url);
            return null;
        });
    };

    // The item's printable label, on demand rather than only at intake.
    const downloadLabel = async (row) => {
        setScanError(null);
        setLabelFor(row.code_ref ?? row.item_ref ?? null);
        try {
            let item = row;
            if (!item.iid) {
                item = (await lookupItem({ codeRef: row.code_ref, location: row.location })) || row;
            }
            if (!item.iid) {
                setScanError('That item has no physical item id to put on a label yet.');
                return;
            }
            const iid = item.iid;
            const built = await makeItemLabelPng(iid, itemLabelLines(item));
            // Hand it to the browser and put it on screen: the download is what the
            // operator asked for, the preview is how they check it before printing.
            const a = document.createElement('a');
            a.href = built.url;
            a.download = built.filename;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setLabel({ iid, ...built });
        } catch (err) {
            setScanError(`Could not build the label: ${err.message || String(err)}`);
        } finally {
            setLabelFor(null);
        }
    };

    useEffect(() => {
        refresh(tab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const term = search.trim().toLowerCase();
    // Rank every row by its lead denomination, kg (derived from count where the line
    // was booked only as a count).
    const sortVal = (r) => rowQty(r).kg;
    // Column filters apply in the table view only (that's where the controls live).
    // Each column holds a list of selected values (OR within a column, AND across).
    const activeColFilters = view === 'list'
        ? Object.entries(colFilters).filter(([, v]) => Array.isArray(v) && v.length)
        : [];
    const colValue = (r, k) => (DERIVED_COL[k] ? DERIVED_COL[k](r) : String(r[k] ?? ''));
    const matchForm = (r) => !selectedForm || itemForm(r.itype, r.name) === selectedForm;
    const matchTerm = (r) => !term
        || (r.name || '').toLowerCase().includes(term)
        || (r.iid || '').toLowerCase().includes(term)
        || (r.location || '').toLowerCase().includes(term)
        || (r.mat || '').toLowerCase().includes(term)
        || (r.col || '').toLowerCase().includes(term);
    // A row passes the current search/form and every active column filter — except,
    // optionally, one column (so that column's own dropdown can still offer all of
    // its values consistent with the *other* filters).
    const passes = (r, exceptKey) => matchForm(r) && matchTerm(r)
        && activeColFilters.every(([k, vals]) => k === exceptKey || vals.includes(colValue(r, k)));

    const filtered = rows
        .filter((r) => passes(r, null))
        // Primary: weight (or bundles for piece items), descending. When weight
        // ties — notably at 0 — fall back to bundle count, descending.
        .sort((a, b) => (sortVal(b) - sortVal(a)) || (num(b.bundles) - num(a.bundles)));

    // Distinct forms present in the current dataset (for the type filter chips).
    const FORM_ORDER = ['roll', 'sheet', 'modelsheet', 'bottompattysheet', 'dcut', 'ucut', 'wcut',
        'handlebag', 'sidepatty', 'bottompatty', 'manualhandle', 'readymadehandle',
        'pressinghandle', 'box'];
    const presentForms = FORM_ORDER.filter((f) => rows.some((r) => itemForm(r.itype, r.name) === f));

    // Each column's options are the values present in rows passing the OTHER active
    // filters — so dropdowns only ever offer selections that yield results.
    const distinctVals = (key) => [...new Set(
        rows.filter((r) => passes(r, key)).map((r) => colValue(r, key)).filter((v) => v !== '' && v !== '—')
    )].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const colOptions = {
        item: distinctVals('item'), mat: distinctVals('mat'), col: distinctVals('col'),
        gsm: distinctVals('gsm'), location: distinctVals('location'), size: distinctVals('size')
    };
    // Toggle a value in a column's selection; clear empties the whole column.
    const toggleColFilter = (key, val) => setColFilters((f) => {
        const cur = f[key] || [];
        return { ...f, [key]: cur.includes(val) ? cur.filter((x) => x !== val) : [...cur, val] };
    });
    const clearColFilter = (key) => setColFilters((f) => ({ ...f, [key]: [] }));

    const totalAvailable = filtered.reduce((sum, r) => sum + rowQty(r).kg, 0);
    // Piece totals shown next to the kg total, one per unit (sheets, bundles).
    // A unit is marked derived when any contributing line's count came from kg.
    const countTotals = filtered.reduce((acc, r) => {
        const c = rowCount(r);
        if (!c) return acc;
        const t = acc[c.unit] || (acc[c.unit] = { count: 0, derived: false });
        t.count += c.count;
        if (c.derived) t.derived = true;
        return acc;
    }, {});

    // List/table view benefits from extra width on desktop.
    const wrap = view === 'list' ? 'max-w-6xl' : 'max-w-3xl';

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className={`${wrap} mx-auto flex flex-col gap-2.5`}>
                    <div className="flex items-center gap-2">
                        <Button variant="ghost" onClick={onBack} className="!px-2 shrink-0">
                            <ArrowLeft size={20} />
                        </Button>
                        <div className="w-8 h-8 bg-teal-600 rounded-lg flex items-center justify-center text-white shrink-0">
                            <Warehouse size={18} />
                        </div>
                        <div className="min-w-0 flex-1">
                            <h1 className="font-bold text-slate-800 leading-tight truncate">Inventory</h1>
                            <p className="text-xs text-slate-500 truncate">Current stock from transactions</p>
                        </div>
                        {/* Card / table view toggle */}
                        <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
                            <button
                                onClick={() => setView('grid')}
                                title="Card view"
                                className={`px-2.5 py-1.5 transition-colors ${view === 'grid' ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                <LayoutGrid size={18} />
                            </button>
                            <button
                                onClick={() => setView('list')}
                                title="Table view"
                                className={`px-2.5 py-1.5 border-l border-slate-200 transition-colors ${view === 'list' ? 'bg-teal-50 text-teal-700' : 'text-slate-500 hover:bg-slate-50'}`}
                            >
                                <List size={18} />
                            </button>
                        </div>
                        <Button variant="secondary" onClick={() => setShowSearch((s) => !s)} className="!px-2.5 shrink-0">
                            <Search size={18} />
                        </Button>
                        {tab === 'id' && (
                            <Button
                                variant="primary"
                                onClick={() => setNewStock(true)}
                                className="!px-2.5 shrink-0 bg-sky-600 hover:bg-sky-700"
                                title="Book a new roll into the godown"
                            >
                                <PackagePlus size={18} />
                            </Button>
                        )}
                        {(
                            <Button
                                variant="primary"
                                onClick={() => { setScanError(null); setScanning(true); }}
                                className="!px-2.5 shrink-0 bg-teal-600 hover:bg-teal-700"
                                title="Scan a roll label"
                            >
                                <ScanLine size={18} />
                            </Button>
                        )}
                        <Button variant="secondary" onClick={() => refresh(tab)} disabled={loading} className="!px-2.5 shrink-0">
                            <RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
                        </Button>
                    </div>

                    {showSearch && (
                        <div className="relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search item, material, colour..."
                                value={search}
                                onChange={(e) => setSearch(e.target.value)}
                                className="w-full pl-9 pr-9 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 outline-none text-sm"
                                autoFocus
                            />
                            {search && (
                                <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                                    <X size={16} />
                                </button>
                            )}
                        </div>
                    )}

                    {/* Tabs */}
                    <div className="flex gap-2">
                        {TABS.map((t) => (
                            <button
                                key={t.key}
                                onClick={() => { setTab(t.key); setSelectedForm(''); setColFilters({}); }}
                                className={`flex-1 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${tab === t.key
                                    ? 'bg-teal-50 text-teal-700 ring-1 ring-teal-200'
                                    : 'text-slate-600 hover:bg-slate-50'
                                    }`}
                            >
                                {t.label}
                            </button>
                        ))}
                    </div>
                </div>
            </header>

            <main className="flex-1 p-3 overflow-auto">
                <div className={`${wrap} mx-auto`}>
                    {scanError && (
                        <div className="mb-3 p-3 bg-amber-50 text-amber-800 rounded-lg border border-amber-200 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div className="flex-1 min-w-0">
                                <p className="text-sm break-words">{scanError}</p>
                            </div>
                            <button onClick={() => setScanError(null)} className="text-amber-500 hover:text-amber-800 shrink-0">
                                <X size={16} />
                            </button>
                        </div>
                    )}

                    {error && (
                        <div className="mb-3 p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Error</p>
                                <p className="text-sm break-words">{error}</p>
                            </div>
                        </div>
                    )}

                    {!loading && rows.length > 0 && presentForms.length > 1 && (
                        <div className="-mx-3 px-3 mb-3 overflow-x-auto no-scrollbar">
                            <div className="flex gap-2 w-max">
                                <FormChip label="All Types" active={selectedForm === ''} onClick={() => setSelectedForm('')} />
                                {presentForms.map((f) => (
                                    <FormChip key={f} label={FORM_LABEL[f]} form={f} active={selectedForm === f} onClick={() => setSelectedForm(f)} />
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Active column-filter chips — always visible in table view so a
                        zero-result filter combo can still be cleared. */}
                    {!loading && activeColFilters.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1.5 mb-3">
                            {activeColFilters.flatMap(([k, vals]) => vals.map((v) => (
                                <button
                                    key={`${k}:${v}`}
                                    onClick={() => toggleColFilter(k, v)}
                                    className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-medium bg-teal-50 text-teal-700 border border-teal-200 hover:bg-teal-100"
                                >
                                    {v} <X size={11} />
                                </button>
                            )))}
                            <button onClick={() => setColFilters({})} className="text-[11px] text-slate-500 hover:text-slate-700 underline px-1">
                                Clear all
                            </button>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex flex-col items-center justify-center h-64 text-slate-400">
                            <Loader2 size={36} className="animate-spin mb-3 text-teal-600" />
                            <p>Loading inventory...</p>
                        </div>
                    ) : filtered.length === 0 ? (
                        <div className="text-center py-16 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                            <Package size={44} className="mx-auto mb-3 text-slate-300" />
                            <p className="text-base font-medium mb-1">No inventory</p>
                            <p className="text-sm">{(term || selectedForm) ? 'No items match your filters.' : 'No stock recorded yet.'}</p>
                        </div>
                    ) : (
                        <>
                            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 mb-2 px-1">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {filtered.length} item{filtered.length !== 1 ? 's' : ''}
                                    <button
                                        type="button"
                                        onClick={() => downloadAllLabels(filtered)}
                                        disabled={Boolean(bulk)}
                                        title="Download a zip of QR labels for every item listed"
                                        className="ml-2 inline-flex items-center gap-1 normal-case tracking-normal font-medium text-teal-700 hover:text-teal-900 disabled:opacity-50"
                                    >
                                        {bulk
                                            ? <><Loader2 size={12} className="animate-spin" /> {bulk.done}/{bulk.total} labels…</>
                                            : <><Download size={12} /> QR labels (zip)</>}
                                    </button>
                                </p>
                                <p className="text-xs text-slate-500">
                                    Total available: <span className="font-semibold text-slate-700">{fmtKg(totalAvailable)} kg</span>
                                    {['sheets', 'bundles'].map((u) => countTotals[u] && (
                                        <span key={u}>
                                            {' · '}
                                            <span
                                                className="font-semibold text-slate-700"
                                                title={countTotals[u].derived ? 'Includes counts converted from weight' : undefined}
                                            >
                                                {countTotals[u].derived && <span className="font-normal text-slate-400">≈ </span>}
                                                {fmtCount(countTotals[u].count)} {u}
                                            </span>
                                        </span>
                                    ))}
                                </p>
                            </div>

                            {view === 'list' ? (
                                <InventoryTable
                                    rows={filtered} tab={tab}
                                    colFilters={colFilters} options={colOptions}
                                    onColToggle={toggleColFilter} onColClear={clearColFilter}
                                    onOpenTxns={setTxnRow}
                                    onAdjust={adjustRow}
                                    onLabel={downloadLabel}
                                    labelFor={labelFor}
                                />
                            ) : tab === 'code' ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {filtered.map((r, idx) => {
                                        const q = rowQty(r);
                                        return (
                                            <Card key={`${r.code_ref}-${idx}`} className="p-3 flex flex-col">
                                                <ItemVisual colour={r.col} type={r.itype} name={r.name} />

                                                <p className="text-center text-sm font-semibold text-slate-800 mt-1 leading-tight">
                                                    {typeName(r.mat, r.itype, r.name)}
                                                </p>

                                                <div className="flex items-center justify-center gap-1.5 mt-1 text-[11px] text-slate-500">
                                                    <ColourCell col={r.col} asModel={isModelCode(r)} />
                                                </div>

                                                <div className="flex flex-wrap justify-center gap-1 mt-1.5">
                                                    {r.mat && <Chip>{r.mat}</Chip>}
                                                    {r.gsm && <Chip>{r.gsm} GSM</Chip>}
                                                </div>

                                                <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                                                    {r.location && <Dim>{r.location}</Dim>}
                                                    {r.w && <Dim>W {r.w}″</Dim>}
                                                    {r.h && <Dim>H {r.h}″</Dim>}
                                                </div>

                                                <div className="mt-3 pt-2 border-t border-slate-100 text-center">
                                                    <span className="text-xl font-bold text-teal-700" title={q.derived ? 'Converted from count' : undefined}>
                                                        {q.derived && <span className="text-base font-normal text-slate-400">≈ </span>}
                                                        {fmtKg(q.kg)}
                                                    </span>
                                                    <span className="text-xs text-slate-400"> kg available</span>
                                                    <p className="text-[11px] text-slate-400 mt-0.5">
                                                        {q.hasCount ? `${q.count} ${q.countUnit} · ` : ''}
                                                        <TxnLink count={num(r.cnt)} onClick={() => setTxnRow(r)} />
                                                    </p>
                                                </div>

                                                <div className="mt-2 grid grid-cols-3 gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => adjustRow(r, 'ADD')}
                                                        className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold"
                                                    >
                                                        <Plus size={14} /> Add
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => adjustRow(r, 'LESS')}
                                                        className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-semibold"
                                                    >
                                                        <Minus size={14} /> Less
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => downloadLabel(r)}
                                                        title="Download this item's QR label"
                                                        className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 text-xs font-semibold"
                                                    >
                                                        {labelFor === (r.code_ref ?? r.item_ref)
                                                            ? <Loader2 size={14} className="animate-spin" />
                                                            : <><QrCode size={14} /> QR</>}
                                                    </button>
                                                </div>
                                            </Card>
                                        );
                                    })}
                                </div>
                            ) : (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {filtered.map((r, idx) => (
                                        <Card key={`${r.code_ref}-${r.iid ?? idx}`} className="p-3 flex flex-col">
                                            {/* Roll Item ID highlighted */}
                                            <div className="flex justify-center mb-1.5">
                                                <span className="inline-flex items-center gap-1 px-3 py-1 rounded-lg text-sm font-extrabold text-teal-800 bg-teal-100 ring-1 ring-teal-300">
                                                    Roll #{r.iid || '—'}
                                                </span>
                                            </div>

                                            <ItemVisual colour={r.col} type={r.itype} name={r.name} />

                                            <p className="text-center text-sm font-semibold text-slate-800 mt-1 leading-tight">
                                                {typeName(r.mat, r.itype, r.name)}
                                            </p>

                                            <div className="flex items-center justify-center gap-1.5 mt-1 text-[11px] text-slate-500">
                                                <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ background: colourToCss(r.col) }} />
                                                <span className="truncate">{r.col || '—'}</span>
                                            </div>

                                            <div className="flex flex-wrap justify-center gap-1 mt-1.5">
                                                {r.gsm && <Chip>{r.gsm} GSM</Chip>}
                                            </div>

                                            <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                                                {r.location && <Dim>{r.location}</Dim>}
                                                {r.w && <Dim>W {r.w}″</Dim>}
                                                {r.h && <Dim>H {r.h}″</Dim>}
                                            </div>

                                            <div className="mt-3 pt-2 border-t border-slate-100 text-center">
                                                <span className="text-xl font-bold text-teal-700">{fmtKg(r.avail)}</span>
                                                <span className="text-xs text-slate-400"> kg available</span>
                                                <p className="text-[11px] text-slate-400 mt-0.5">
                                                    Initial {fmtKg(r.initial)} kg · <TxnLink count={num(r.cnt)} onClick={() => setTxnRow(r)} />
                                                </p>
                                            </div>

                                            {/* Same booking actions as the table's Stock column. */}
                                            <div className="mt-2 grid grid-cols-3 gap-2">
                                                <button
                                                    type="button"
                                                    onClick={() => adjustRow(r, 'ADD')}
                                                    className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-emerald-200 text-emerald-700 bg-emerald-50 hover:bg-emerald-100 text-xs font-semibold"
                                                >
                                                    <Plus size={14} /> Add
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => adjustRow(r, 'LESS')}
                                                    className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 text-xs font-semibold"
                                                >
                                                    <Minus size={14} /> Less
                                                </button>
                                                <button
                                                    type="button"
                                                    onClick={() => downloadLabel(r)}
                                                    title="Download this item's QR label"
                                                    className="inline-flex items-center justify-center gap-1 py-1.5 rounded-lg border border-slate-200 text-slate-600 bg-white hover:bg-slate-50 text-xs font-semibold"
                                                >
                                                    {labelFor === (r.code_ref ?? r.item_ref)
                                                        ? <Loader2 size={14} className="animate-spin" />
                                                        : <><QrCode size={14} /> QR</>}
                                                </button>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>

            {/* Urgent action: stock booked but not yet counted. Hidden entirely when
                the queue is empty — there is nothing to open. */}
            {pendingAck > 0 && !ackOpen && (
                <button
                    onClick={() => setAckOpen(true)}
                    title={`${pendingAck} transaction(s) awaiting acknowledgement`}
                    className="fixed bottom-5 right-5 z-40 inline-flex items-center gap-2 pl-3 pr-4 py-3 rounded-full bg-amber-500 text-white font-semibold shadow-lg shadow-amber-500/30 hover:bg-amber-600 active:scale-95 transition"
                >
                    <span className="relative flex items-center justify-center">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-white/40 animate-ping" />
                        <ShieldAlert size={20} className="relative" />
                    </span>
                    <span className="text-sm">{pendingAck} to acknowledge</span>
                </button>
            )}

            {ackOpen && (
                <PendingAckModal
                    onClose={() => setAckOpen(false)}
                    onAcknowledged={() => refresh(tab)}
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                />
            )}

            {label && <ItemLabelModal label={label} onClose={closeLabel} />}

            {scanning && (
                <QrScanModal onClose={() => setScanning(false)} onScan={openScannedItem} />
            )}

            {newStock && (
                <NewRollStockModal
                    onClose={() => setNewStock(false)}
                    onSaved={() => refresh(tab)}
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                />
            )}

            {adjusting && (
                <StockAdjustModal
                    row={adjusting.row}
                    mode={adjusting.mode}
                    allowModeSwitch={Boolean(adjusting.fromScan)}
                    fromScan={Boolean(adjusting.fromScan)}
                    available={rowQty(adjusting.row).kg}
                    availableCount={rowQty(adjusting.row).count}
                    availableDerived={rowQty(adjusting.row).derived}
                    onClose={() => setAdjusting(null)}
                    onSaved={() => { setAdjusting(null); refresh(tab); }}
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                />
            )}

            {txnRow && (
                <InventoryTxnModal
                    row={txnRow}
                    qty={rowQty(txnRow)}
                    onClose={() => setTxnRow(null)}
                    getHeaders={getHeaders}
                    getUrl={getUrl}
                />
            )}
        </div>
    );
};

export default InventoryView;
