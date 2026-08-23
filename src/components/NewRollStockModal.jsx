import React, { useState, useEffect, useMemo } from 'react';
import { X, Loader2, AlertCircle, Sparkles, Check, Download, Plus } from 'lucide-react';
import Button from './Button';
import { ItemVisual } from './itemVisuals';
import { typeName } from '../utils/itemForms';
import { makeItemLabelPng, itemLabelLines } from '../utils/itemLabel';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const ITEMS_TABLE = 'Inventory_Items';
const TXN_TABLE = 'Inventory_Transactions';
const ROLLS_GODOWN = 'ROLLS GODOWN';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const norm = (v) => String(v ?? '').trim();

// Roll ids run ROLL_DD-MM-YYYY_NNNN with the sequence restarting each date, so a
// suggestion only has to look at today's rolls.
const todayStamp = () => {
    const d = new Date();
    const p = (n) => String(n).padStart(2, '0');
    return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
};
const rollId = (stamp, seq) => `ROLL_${stamp}_${String(seq).padStart(4, '0')}`;

const Select = ({ label, value, onChange, options, disabled }) => (
    <label className="block">
        <span className="block text-[11px] text-slate-500 mb-1">{label}</span>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            disabled={disabled || options.length === 0}
            className="w-full px-2.5 py-2 border border-slate-300 rounded-lg bg-white text-sm outline-none focus:ring-2 focus:ring-teal-500 disabled:bg-slate-50 disabled:text-slate-400"
        >
            <option value="">{options.length === 1 ? options[0] : 'Select…'}</option>
            {options.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
    </label>
);

// A roll arriving in the godown: pick what it is from the catalogue, name it, and
// weigh it. That writes the physical item and its opening NEW STOCK transaction.
const NewRollStockModal = ({ onClose, onSaved, getHeaders, getUrl }) => {
    const [codes, setCodes] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    const [material, setMaterial] = useState('');
    const [colour, setColour] = useState('');
    const [gsm, setGsm] = useState('');
    const [width, setWidth] = useState('');
    const [itemId, setItemId] = useState('');
    const [weight, setWeight] = useState('');
    // After saving, the roll's label is offered for printing.
    const [saved, setSaved] = useState(null);      // { id, url, filename }
    const [labelBusy, setLabelBusy] = useState(false);

    const runSql = async (sql, args = []) => {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${DOC_ID}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql, args })
        });
        if (!res.ok) throw new Error(`Query failed (${res.status})`);
        return ((await res.json()).records || []).map((r) => r.fields);
    };

    useEffect(() => {
        (async () => {
            try {
                const rows = await runSql(
                    `SELECT id, Item_Code AS name, Type AS itype, Material AS mat,
                            Colour AS col, GSM AS gsm, Width_Inches_ AS w
                     FROM Inventory_Item_Codes
                     WHERE Type LIKE '%ROLL%'
                     ORDER BY Material, Colour, GSM, CAST(Width_Inches_ AS INTEGER)`
                );
                setCodes(rows);
                // Suggest the next id for today; the operator can overwrite it.
                const stamp = todayStamp();
                const [seq] = await runSql(
                    `SELECT max(CAST(substr(Item_ID, 17) AS INTEGER)) AS mx
                     FROM ${ITEMS_TABLE} WHERE Item_ID LIKE 'ROLL_' || ? || '_%'`,
                    [stamp]
                );
                setItemId(rollId(stamp, num(seq?.mx) + 1));
            } catch (err) {
                setError(err.message || String(err));
            } finally {
                setLoading(false);
            }
        })();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Each dropdown offers only what the choices above it leave possible.
    const uniq = (rows, key) => [...new Set(rows.map((r) => norm(r[key])).filter(Boolean))];
    const byMaterial = useMemo(() => codes.filter((c) => !material || norm(c.mat) === material), [codes, material]);
    const byColour = useMemo(() => byMaterial.filter((c) => !colour || norm(c.col) === colour), [byMaterial, colour]);
    const byGsm = useMemo(() => byColour.filter((c) => !gsm || norm(c.gsm) === gsm), [byColour, gsm]);
    const matched = useMemo(
        () => byGsm.filter((c) => !width || norm(c.w) === width),
        [byGsm, width]
    );
    const code = matched.length === 1 ? matched[0] : null;

    // Clear anything downstream that the new choice has made impossible.
    const pick = (setter, value, resets) => {
        setter(value);
        resets.forEach((r) => r(''));
    };

    const valid = code && norm(itemId) && num(weight) > 0 && !saving;

    const submit = async () => {
        setSaving(true);
        setError(null);
        try {
            const id = norm(itemId).toUpperCase();
            const clash = await runSql(`SELECT id FROM ${ITEMS_TABLE} WHERE upper(Item_ID) = ? LIMIT 1`, [id]);
            if (clash.length > 0) {
                throw new Error(`${id} already exists. Use its Add button to book more weight onto it.`);
            }

            const headers = await getHeaders();
            const post = async (table, records) => {
                const res = await fetch(getUrl(`/api/docs/${DOC_ID}/tables/${table}/records`), {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ records })
                });
                if (!res.ok) {
                    const text = await res.text().catch(() => '');
                    throw new Error(`Could not save to ${table}: ${res.statusText}${text ? ` - ${text}` : ''}`);
                }
                return (await res.json()).records || [];
            };

            // The physical roll first: the transaction references it, and
            // Item_Code is a formula off it.
            const [item] = await post(ITEMS_TABLE, [{ fields: { Item_ID: id, Item_Code: num(code.id) } }]);
            await post(TXN_TABLE, [{
                fields: {
                    Item_ID: item.id,
                    Transaction_Type: 'NEW STOCK',
                    Weight_Kg_: num(weight),
                    Location: ROLLS_GODOWN,
                    Transaction_Time: Date.now() / 1000
                }
            }]);
            // Stay open on the label step: a roll that has just been booked in
            // needs its sticker before it goes on the rack.
            setSaving(false);
            setLabelBusy(true);
            setSaved({ id });
            onSaved?.(id);
            try {
                const label = await makeItemLabelPng(id, itemLabelLines({ ...code, iid: id }));
                setSaved({ id, ...label });
                // The label is wanted every time, so it downloads itself rather
                // than waiting for a click; the button below is for a second copy.
                const a = document.createElement('a');
                a.href = label.url;
                a.download = label.filename;
                document.body.appendChild(a);
                a.click();
                a.remove();
            } catch {
                // The stock is safely booked; only the label failed.
                setError('The roll was saved, but its label image could not be generated.');
            } finally {
                setLabelBusy(false);
            }
        } catch (err) {
            setError(err.message || String(err));
            setSaving(false);
        }
    };

    // Clear the object url before starting over or closing.
    const releaseLabel = () => {
        if (saved?.url) URL.revokeObjectURL(saved.url);
    };

    const closeAll = () => { releaseLabel(); onClose(); };

    const addAnother = () => {
        releaseLabel();
        setSaved(null);
        setError(null);
        setWeight('');
        // Keep the item code selected -- a delivery is usually the same roll type
        // several times over -- and step the suggested id on by one.
        const match = String(itemId).match(/^(ROLL_\d{2}-\d{2}-\d{4}_)(\d+)$/i);
        if (match) setItemId(`${match[1]}${String(Number(match[2]) + 1).padStart(4, '0')}`);
    };

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={closeAll}>
            <div className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="w-8 h-8 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center">
                            <Sparkles size={18} />
                        </span>
                        <div>
                            <h2 className="font-bold text-slate-800 leading-tight">New roll stock</h2>
                            <p className="text-xs text-slate-500">Book a roll into {ROLLS_GODOWN}</p>
                        </div>
                    </div>
                    <button onClick={closeAll} className="text-slate-400 hover:text-slate-700 p-1"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3">
                    {saved ? (
                        <div className="text-center space-y-3">
                            <p className="inline-flex items-center gap-1.5 text-sm font-semibold text-emerald-700 bg-emerald-50 ring-1 ring-emerald-200 rounded-full px-3 py-1">
                                <Check size={15} /> {saved.id} booked in
                            </p>
                            {error && (
                                <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 text-sm text-left">{error}</div>
                            )}
                            <div className="flex flex-col items-center gap-2">
                                {labelBusy ? (
                                    <div className="h-56 flex items-center justify-center text-slate-400">
                                        <Loader2 size={28} className="animate-spin" />
                                    </div>
                                ) : saved.url ? (
                                    <>
                                        <img
                                            src={saved.url}
                                            alt={`Label for ${saved.id}`}
                                            className="w-56 h-auto border border-slate-200 rounded-lg"
                                        />
                                        <a
                                            href={saved.url}
                                            download={saved.filename}
                                            className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
                                        >
                                            <Download size={16} /> Download label
                                        </a>
                                        <p className="text-[11px] text-slate-400">
                                            Downloaded automatically. Print and stick it on the roll —
                                            the scanner reads this code.
                                        </p>
                                        <p className="text-[11px] text-slate-500">
                                            More rolls of the same item code? <span className="font-semibold">Another roll</span> keeps
                                            your selection and moves to the next id.
                                        </p>
                                    </>
                                ) : null}
                            </div>
                        </div>
                    ) : (
                    <>
                    {error && (
                        <div className="p-3 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <p className="text-sm break-words">{error}</p>
                        </div>
                    )}

                    {loading ? (
                        <div className="flex items-center justify-center h-32 text-slate-400">
                            <Loader2 size={28} className="animate-spin" />
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-2">
                                <Select
                                    label="Material" value={material} options={uniq(codes, 'mat')}
                                    onChange={(v) => pick(setMaterial, v, [setColour, setGsm, setWidth])}
                                />
                                <Select
                                    label="Colour" value={colour} options={uniq(byMaterial, 'col')}
                                    onChange={(v) => pick(setColour, v, [setGsm, setWidth])}
                                    disabled={!material}
                                />
                                <Select
                                    label="GSM" value={gsm} options={uniq(byColour, 'gsm')}
                                    onChange={(v) => pick(setGsm, v, [setWidth])}
                                    disabled={!colour}
                                />
                                <Select
                                    label="Width (inches)" value={width} options={uniq(byGsm, 'w')}
                                    onChange={(v) => pick(setWidth, v, [])}
                                    disabled={!gsm}
                                />
                            </div>

                            {code ? (
                                <div className="flex items-center gap-3 bg-slate-50 rounded-xl p-2.5">
                                    <div className="w-11 shrink-0">
                                        <ItemVisual colour={code.col} type={code.itype} name={code.name} size="sm" />
                                    </div>
                                    <div className="min-w-0">
                                        <p className="text-sm font-semibold text-slate-800 truncate">
                                            {typeName(code.mat, code.itype, code.name)}
                                        </p>
                                        <p className="text-[11px] text-slate-500 truncate">{code.name}</p>
                                    </div>
                                    <Check size={18} className="ml-auto text-emerald-600 shrink-0" />
                                </div>
                            ) : (
                                <p className="text-[11px] text-slate-400">
                                    {matched.length > 1
                                        ? `${matched.length} item codes still match — narrow it down.`
                                        : 'Pick the roll from the catalogue above.'}
                                </p>
                            )}

                            <label className="block">
                                <span className="block text-[11px] text-slate-500 mb-1">Roll item id</span>
                                <input
                                    value={itemId}
                                    onChange={(e) => setItemId(e.target.value)}
                                    placeholder="ROLL_23-08-2026_0001"
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg font-mono text-sm outline-none focus:ring-2 focus:ring-teal-500"
                                />
                                <span className="block text-[11px] text-slate-400 mt-1">
                                    Suggested from today&apos;s rolls — change it if the label says otherwise.
                                </span>
                            </label>

                            <label className="block">
                                <span className="block text-[11px] text-slate-500 mb-1">Weight (kg)</span>
                                <input
                                    type="number" inputMode="decimal" step="0.01" min="0"
                                    value={weight}
                                    onChange={(e) => setWeight(e.target.value)}
                                    onKeyDown={(e) => { if (e.key === 'Enter' && valid) submit(); }}
                                    className="w-full px-3 py-2.5 text-lg font-semibold border border-slate-300 rounded-lg outline-none focus:ring-2 focus:ring-sky-500"
                                />
                            </label>

                            <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                                Waits for the incharge to acknowledge it before it counts towards stock.
                            </p>
                        </>
                    )}
                    </>
                    )}
                </div>

                <div className="border-t border-slate-200 px-4 py-3 flex gap-2 justify-end">
                    {saved ? (
                        <>
                            <Button variant="ghost" icon={Plus} onClick={addAnother} title="Same item code, next roll id">
                                Another roll
                            </Button>
                            <Button variant="primary" className="bg-sky-600 hover:bg-sky-700" onClick={closeAll}>Done</Button>
                        </>
                    ) : (
                        <>
                            <Button variant="ghost" onClick={closeAll} disabled={saving}>Cancel</Button>
                            <Button
                                variant="primary"
                                className="bg-sky-600 hover:bg-sky-700"
                                onClick={submit}
                                disabled={!valid}
                                icon={saving ? Loader2 : Sparkles}
                            >
                                {saving ? 'Saving…' : 'Add new stock'}
                            </Button>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};

export default NewRollStockModal;
