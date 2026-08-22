import React, { useState } from 'react';
import { X, AlertTriangle, Copy, Check, ArrowRight } from 'lucide-react';
import { OVERAGE_TABLE, OVERAGE_COLUMN, gristOverageSnippet } from '../utils/overageDrift';

const pct = (v) => `${Math.round(Number(v || 0) * 1000) / 10}%`;

// What the app plans with vs. what the Grist formula reports, side by side, with
// the dict to paste back. Only reachable while the two actually disagree.
const OverageDriftModal = ({ drift, onClose, onRecheck }) => {
    const [copied, setCopied] = useState(false);
    const snippet = gristOverageSnippet();

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(snippet);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            // Clipboard is blocked in some contexts; the snippet is on screen to copy by hand.
        }
    };

    const inert = drift.found && !drift.applied;

    return (
        <div className="fixed inset-0 bg-black/50 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div className="bg-slate-50 w-full sm:max-w-lg sm:rounded-2xl shadow-xl max-h-[92vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
                <div className="bg-white border-b border-slate-200 px-4 py-3 flex items-start gap-3 sm:rounded-t-2xl">
                    <span className="w-9 h-9 rounded-lg bg-orange-100 text-orange-700 flex items-center justify-center shrink-0">
                        <AlertTriangle size={20} />
                    </span>
                    <div className="min-w-0 flex-1">
                        <h2 className="font-bold text-slate-800 leading-tight">Production overage out of step</h2>
                        <p className="text-xs text-slate-500">
                            The app and the Grist formula are planning different quantities.
                        </p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-3">
                    <p className="text-[13px] text-slate-600">
                        The app adds the overage when it reserves rolls and counts output.
                        <code className="mx-1 px-1 py-0.5 rounded bg-slate-200 text-[11px]">{OVERAGE_TABLE}.{OVERAGE_COLUMN}</code>
                        recomputes it in Grist. While these disagree, a job reserves stock for
                        one figure and reports another.
                    </p>

                    {inert && (
                        <p className="text-[12px] text-orange-800 bg-orange-50 border border-orange-200 rounded-lg px-2.5 py-2">
                            The formula declares an <code className="text-[11px]">OVERAGE</code> dict but never multiplies by
                            it — the allowance is being ignored on the Grist side.
                        </p>
                    )}

                    {drift.diffs.length > 0 && (
                        <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                            <table className="w-full text-sm">
                                <thead>
                                    <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500 bg-slate-50 border-b border-slate-200">
                                        <th className="py-2 px-3 font-semibold">Batch type</th>
                                        <th className="py-2 px-3 font-semibold text-right">App</th>
                                        <th className="py-2 px-3 font-semibold text-right">Grist</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {drift.diffs.map((d) => (
                                        <tr key={d.batchType}>
                                            <td className="py-2 px-3 text-slate-700">{d.batchType}</td>
                                            <td className="py-2 px-3 text-right font-semibold tabular-nums text-teal-700">{pct(d.app)}</td>
                                            <td className="py-2 px-3 text-right font-semibold tabular-nums text-orange-700">{pct(d.grist)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}

                    <div>
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">
                                Paste over the dict in the formula
                            </p>
                            <button
                                onClick={copy}
                                className="inline-flex items-center gap-1 text-xs font-medium text-teal-700 hover:text-teal-900"
                            >
                                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Copied' : 'Copy'}
                            </button>
                        </div>
                        <pre className="bg-slate-900 text-slate-100 rounded-xl p-3 text-[12px] overflow-x-auto">{snippet}</pre>
                        <p className="text-[11px] text-slate-400 mt-1.5">
                            Grist → {OVERAGE_TABLE} → {OVERAGE_COLUMN} → edit the formula. Keep the
                            <code className="mx-1 text-[10px]">* (1 + OVERAGE.get(...))</code> line that applies it.
                        </p>
                    </div>
                </div>

                <div className="bg-white border-t border-slate-200 px-4 py-2.5 flex items-center justify-between gap-2 sm:rounded-b-2xl">
                    <p className="text-[11px] text-slate-400">Nothing here changes Grist — paste it yourself.</p>
                    <button
                        onClick={onRecheck}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-teal-700 hover:text-teal-900"
                    >
                        Re-check <ArrowRight size={13} />
                    </button>
                </div>
            </div>
        </div>
    );
};

export default OverageDriftModal;
