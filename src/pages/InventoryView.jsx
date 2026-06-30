import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Warehouse, AlertCircle, Loader2, RefreshCw, Search, X, Package,
    LayoutGrid, List
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { colourToCss, itemForm, typeName, FORM_LABEL } from '../utils/itemForms';

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

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const fmtKg = (v) => num(v).toFixed(2);

// Pieces (patty / handle) are counted primarily in bundles, weight secondary.
const BUNDLE_FORMS = ['sidepatty', 'bottompatty', 'handle'];

// Sheets are stored as a sheet COUNT (Available_Count_Bundles_), not kg — their
// recorded weight is 0. Derive kg from geometry the same way create-batch does:
// one sheet (kg) = W(in) * H(in) * GSM / (1550 * 1000), since 1550 in² = 1 m².
const PIECE_TO_KG_DIVISOR = 1550 * 1000;
const sheetKg = (r) => {
    const w = num(r.w), h = num(r.h), gsm = num(r.gsm), n = num(r.bundles);
    if (!w || !h || !gsm) return 0;            // geometry missing -> can't convert
    return n * w * h * gsm / PIECE_TO_KG_DIVISOR;
};

// Primary/secondary quantity for a row, by physical form. Sheets are counted in
// sheets (kg derived), pieces in bundles (kg recorded), everything else in kg.
const rowQty = (r) => {
    const form = itemForm(r.itype, r.name);
    if (form === 'sheet')
        return { countPrimary: true, count: num(r.bundles), countUnit: 'sheets', kg: sheetKg(r) };
    if (BUNDLE_FORMS.includes(form))
        return { countPrimary: true, count: num(r.bundles), countUnit: 'bundles', kg: num(r.avail) };
    return { countPrimary: false, count: num(r.bundles), countUnit: 'bundles', kg: num(r.avail) };
};

const Chip = ({ children }) => (
    <span className="inline-flex px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-600">{children}</span>
);

const FormChip = ({ label, active, onClick }) => (
    <button
        onClick={onClick}
        className={`px-3.5 py-1.5 rounded-full text-sm font-medium whitespace-nowrap border transition-colors ${active
            ? 'bg-teal-600 text-white border-teal-600'
            : 'bg-white text-slate-600 border-slate-200 hover:border-teal-300'
            }`}
    >
        {label}
    </button>
);

const ColourCell = ({ col }) => (
    <span className="inline-flex items-center gap-1.5 min-w-0">
        <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ background: colourToCss(col) }} />
        <span className="truncate">{col || '—'}</span>
    </span>
);

// Compact tabular view of the same rows shown as cards — handy on desktop for
// scanning many items at once. Horizontally scrollable on narrow screens.
const InventoryTable = ({ rows, tab }) => {
    const isRolls = tab === 'id';
    const th = 'py-2 px-3 font-semibold whitespace-nowrap';
    const td = 'py-1.5 px-3 whitespace-nowrap';
    return (
        <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
            <table className="w-full text-sm">
                <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                        {isRolls && <th className={th}>Roll #</th>}
                        <th className={th}></th>
                        <th className={th}>Item</th>
                        <th className={th}>Material</th>
                        <th className={th}>Colour</th>
                        <th className={`${th} text-right`}>GSM</th>
                        <th className={th}>Location</th>
                        <th className={`${th} text-right`}>Size (W×H)</th>
                        <th className={`${th} text-right`}>Available</th>
                        {isRolls && <th className={`${th} text-right`}>Initial</th>}
                        <th className={`${th} text-right`}>Txns</th>
                    </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                    {rows.map((r, idx) => {
                        const q = rowQty(r);
                        return (
                            <tr key={`${r.code_ref}-${r.iid ?? idx}`} className="hover:bg-slate-50">
                                {isRolls && <td className={`${td} font-bold text-teal-800`}>#{r.iid || '—'}</td>}
                                <td className="py-1 px-2">
                                    <div className="w-9"><ItemVisual colour={r.col} type={r.itype} name={r.name} size="sm" /></div>
                                </td>
                                <td className={`${td} font-medium text-slate-800`}>{typeName(r.mat, r.itype, r.name)}</td>
                                <td className={`${td} text-slate-600`}>{r.mat || '—'}</td>
                                <td className="py-1.5 px-3 text-slate-600 max-w-[150px]"><ColourCell col={r.col} /></td>
                                <td className={`${td} text-right text-slate-600 tabular-nums`}>{r.gsm || '—'}</td>
                                <td className={`${td} text-slate-600`}>{r.location || '—'}</td>
                                <td className={`${td} text-right text-slate-600 tabular-nums`}>
                                    {(r.w || r.h) ? `${r.w || '—'}″ × ${r.h || '—'}″` : '—'}
                                </td>
                                <td className={`${td} text-right`}>
                                    <span className="font-bold text-teal-700 tabular-nums">
                                        {q.countPrimary
                                            ? <>{q.count}<span className="text-xs font-normal text-slate-400"> {q.countUnit}</span></>
                                            : <>{fmtKg(q.kg)}<span className="text-xs font-normal text-slate-400"> kg</span></>}
                                    </span>
                                    {!isRolls && (
                                        <div className="text-[11px] text-slate-400 tabular-nums">
                                            {q.countPrimary ? `${fmtKg(q.kg)} kg` : `${q.count} ${q.countUnit}`}
                                        </div>
                                    )}
                                </td>
                                {isRolls && <td className={`${td} text-right text-slate-500 tabular-nums`}>{fmtKg(r.initial)} kg</td>}
                                <td className={`${td} text-right text-slate-500 tabular-nums`}>{num(r.cnt)}</td>
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
    const [view, setView] = useState('grid'); // 'grid' (cards) | 'list' (table)

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

    useEffect(() => {
        fetchData(tab);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tab]);

    const term = search.trim().toLowerCase();
    // Sort key: bundle count for piece items, available weight (computed for
    // sheets) for everything else — each card ranked by its primary quantity.
    const sortVal = (r) =>
        BUNDLE_FORMS.includes(itemForm(r.itype, r.name)) ? num(r.bundles) : rowQty(r).kg;
    const filtered = rows
        .filter((r) => {
            const matchForm = !selectedForm || itemForm(r.itype, r.name) === selectedForm;
            const matchTerm = !term
                || (r.name || '').toLowerCase().includes(term)
                || (r.iid || '').toLowerCase().includes(term)
                || (r.location || '').toLowerCase().includes(term)
                || (r.mat || '').toLowerCase().includes(term)
                || (r.col || '').toLowerCase().includes(term);
            return matchForm && matchTerm;
        })
        // Primary: weight (or bundles for piece items), descending. When weight
        // ties — notably at 0 — fall back to bundle count, descending.
        .sort((a, b) => (sortVal(b) - sortVal(a)) || (num(b.bundles) - num(a.bundles)));

    // Distinct forms present in the current dataset (for the type filter chips).
    const FORM_ORDER = ['roll', 'sheet', 'dcut', 'wcut', 'sidepatty', 'bottompatty', 'handle', 'box'];
    const presentForms = FORM_ORDER.filter((f) => rows.some((r) => itemForm(r.itype, r.name) === f));

    const totalAvailable = filtered.reduce((sum, r) => sum + rowQty(r).kg, 0);

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
                        {/* Card / table view toggle — desktop only */}
                        <div className="hidden md:inline-flex rounded-lg border border-slate-200 overflow-hidden shrink-0">
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
                        <Button variant="secondary" onClick={() => fetchData(tab)} disabled={loading} className="!px-2.5 shrink-0">
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
                                onClick={() => { setTab(t.key); setSelectedForm(''); }}
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
                        <div className="-mx-3 px-3 mb-3 overflow-x-auto">
                            <div className="flex gap-2 w-max">
                                <FormChip label="All Types" active={selectedForm === ''} onClick={() => setSelectedForm('')} />
                                {presentForms.map((f) => (
                                    <FormChip key={f} label={FORM_LABEL[f]} active={selectedForm === f} onClick={() => setSelectedForm(f)} />
                                ))}
                            </div>
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
                            <div className="flex items-center justify-between mb-2 px-1">
                                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                    {filtered.length} item{filtered.length !== 1 ? 's' : ''}
                                </p>
                                <p className="text-xs text-slate-500">
                                    Total available: <span className="font-semibold text-slate-700">{fmtKg(totalAvailable)} kg</span>
                                </p>
                            </div>

                            {view === 'list' ? (
                                <InventoryTable rows={filtered} tab={tab} />
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
                                                    <span className="w-3 h-3 rounded-full border border-slate-300 shrink-0" style={{ background: colourToCss(r.col) }} />
                                                    <span className="truncate">{r.col || '—'}</span>
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
                                                    {q.countPrimary ? (
                                                        <>
                                                            <span className="text-xl font-bold text-teal-700">{q.count}</span>
                                                            <span className="text-xs text-slate-400"> {q.countUnit}</span>
                                                            <p className="text-[11px] text-slate-400 mt-0.5">{fmtKg(q.kg)} kg · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl font-bold text-teal-700">{fmtKg(q.kg)}</span>
                                                            <span className="text-xs text-slate-400"> kg available</span>
                                                            <p className="text-[11px] text-slate-400 mt-0.5">{q.count} {q.countUnit} · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
                                                        </>
                                                    )}
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
                                                <p className="text-[11px] text-slate-400 mt-0.5">Initial {fmtKg(r.initial)} kg · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
                                            </div>
                                        </Card>
                                    ))}
                                </div>
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
};

export default InventoryView;
