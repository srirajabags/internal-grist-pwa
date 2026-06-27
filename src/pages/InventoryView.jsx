import React, { useState, useEffect } from 'react';
import {
    ArrowLeft, Warehouse, AlertCircle, Loader2, RefreshCw, Search, X, Package
} from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import { ItemVisual, Dim } from '../components/itemVisuals';
import { colourToCss, itemForm, typeName, FORM_LABEL } from '../utils/itemForms';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';

// Grist summary tables that aggregate Inventory_Transactions.
const SQL_BY_CODE = `
    SELECT
        s.Item_Code AS code_ref,
        s.Available_Weight_Kg_ AS avail,
        s.Weight_Kg_ AS total,
        s.Available_Count_Bundles_ AS bundles,
        s.count AS cnt,
        ii.Item_Code AS name, ii.Type AS itype,
        ii.Material AS mat, ii.Colour AS col, ii.GSM AS gsm,
        ii.Width_Inches_ AS w, ii.Height_Inches_ AS h
    FROM Inventory_Transactions_summary_Item_Code s
    LEFT JOIN Inventory_Items ii ON ii.id = s.Item_Code
    WHERE s.Item_Code != 0
    ORDER BY ii.Item_Code
`;

const SQL_BY_ID = `
    SELECT
        s.Item_ID AS iid,
        s.Item_Code AS code_ref,
        s.Available_Weight_Kg_ AS avail,
        s.Weight_Kg_ AS total,
        s.Initial_Weight_Kg_ AS initial,
        s.Item_Type AS itype,
        s.count AS cnt,
        ii.Item_Code AS name,
        ii.Material AS mat, ii.Colour AS col, ii.GSM AS gsm,
        ii.Width_Inches_ AS w, ii.Height_Inches_ AS h
    FROM Inventory_Transactions_summary_Item_Code_Item_ID s
    LEFT JOIN Inventory_Items ii ON ii.id = s.Item_Code
    WHERE s.Item_Code != 0 AND ii.Type LIKE '%ROLL%'
    ORDER BY ii.Item_Code, s.Item_ID
`;

const TABS = [
    { key: 'code', label: 'By Item Code', sql: SQL_BY_CODE },
    { key: 'id', label: 'Rolls Inventory', sql: SQL_BY_ID }
];

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

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

const InventoryView = ({ onBack, getHeaders, getUrl }) => {
    const [tab, setTab] = useState('code');
    const [rows, setRows] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [showSearch, setShowSearch] = useState(false);
    const [selectedForm, setSelectedForm] = useState('');

    const fetchData = async (activeTab) => {
        setLoading(true);
        setError(null);
        try {
            const sql = TABS.find((t) => t.key === activeTab).sql;
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);
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
    const filtered = rows.filter((r) => {
        const matchForm = !selectedForm || itemForm(r.itype, r.name) === selectedForm;
        const matchTerm = !term
            || (r.name || '').toLowerCase().includes(term)
            || (r.iid || '').toLowerCase().includes(term)
            || (r.mat || '').toLowerCase().includes(term)
            || (r.col || '').toLowerCase().includes(term);
        return matchForm && matchTerm;
    });

    // Distinct forms present in the current dataset (for the type filter chips).
    const FORM_ORDER = ['roll', 'sheet', 'dcut', 'wcut', 'sidepatty', 'bottompatty', 'handle', 'box'];
    const presentForms = FORM_ORDER.filter((f) => rows.some((r) => itemForm(r.itype, r.name) === f));

    const totalAvailable = filtered.reduce((sum, r) => sum + num(r.avail), 0);

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-3 py-2.5">
                <div className="max-w-3xl mx-auto flex flex-col gap-2.5">
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
                <div className="max-w-3xl mx-auto">
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
                                    Total available: <span className="font-semibold text-slate-700">{totalAvailable} kg</span>
                                </p>
                            </div>

                            {tab === 'code' ? (
                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                                    {filtered.map((r, idx) => {
                                        // Pieces (patty / handle) are counted primarily in bundles, weight secondary.
                                        const bundlesPrimary = ['sidepatty', 'bottompatty', 'handle'].includes(itemForm(r.itype, r.name));
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
                                                    {r.gsm && <Chip>{r.gsm} GSM</Chip>}
                                                </div>

                                                <div className="flex flex-wrap justify-center gap-1.5 mt-2">
                                                    {r.w && <Dim>W {r.w}″</Dim>}
                                                    {r.h && <Dim>H {r.h}″</Dim>}
                                                </div>

                                                <div className="mt-3 pt-2 border-t border-slate-100 text-center">
                                                    {bundlesPrimary ? (
                                                        <>
                                                            <span className="text-xl font-bold text-teal-700">{num(r.bundles)}</span>
                                                            <span className="text-xs text-slate-400"> bundles</span>
                                                            <p className="text-[11px] text-slate-400 mt-0.5">{num(r.avail)} kg · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <span className="text-xl font-bold text-teal-700">{num(r.avail)}</span>
                                                            <span className="text-xs text-slate-400"> kg available</span>
                                                            <p className="text-[11px] text-slate-400 mt-0.5">{num(r.bundles)} bundles · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
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
                                                {r.w && <Dim>W {r.w}″</Dim>}
                                                {r.h && <Dim>H {r.h}″</Dim>}
                                            </div>

                                            <div className="mt-3 pt-2 border-t border-slate-100 text-center">
                                                <span className="text-xl font-bold text-teal-700">{num(r.avail)}</span>
                                                <span className="text-xs text-slate-400"> kg available</span>
                                                <p className="text-[11px] text-slate-400 mt-0.5">Initial {num(r.initial)} kg · {num(r.cnt)} txn{num(r.cnt) !== 1 ? 's' : ''}</p>
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
