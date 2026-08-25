import React, { useState } from 'react';
import { X, AlertOctagon, Check, XCircle, MinusCircle, Copy, ShieldAlert } from 'lucide-react';
import Button from './Button';
import { isPermissionFailure, journalToText } from '../utils/writeJournal';

const STATUS = {
    done: { icon: Check, cls: 'text-emerald-600', label: 'Saved' },
    failed: { icon: XCircle, cls: 'text-rose-600', label: 'Failed' },
    skipped: { icon: MinusCircle, cls: 'text-slate-400', label: 'Not needed' }
};

// Shown whenever a multi-step write stops part way. The point is not the error
// text — it is the list underneath it: what is already in Grist and therefore has
// to be undone by someone with the rights to undo it.
const WriteFailureModal = ({ title, error, steps = [], onClose, onRetry }) => {
    const [copied, setCopied] = useState(false);
    const done = steps.filter((s) => s.status === 'done');
    const failed = steps.find((s) => s.status === 'failed');
    const permission = isPermissionFailure(error) || isPermissionFailure(failed?.detail);

    const copy = async () => {
        try {
            await navigator.clipboard.writeText(journalToText({ title, error, steps }));
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch {
            setCopied(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-[60] sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                            <AlertOctagon size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">{title || 'Some changes did not save'}</h2>
                            <p className="text-xs text-slate-500">
                                {done.length} saved · {failed ? '1 failed' : 'none failed'}
                            </p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {permission && (
                        <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 mb-1">
                                <ShieldAlert size={15} /> Your account was not allowed to make this change
                            </p>
                            <p className="text-xs text-amber-800">
                                This is a Grist access rule, not a mistake on your part. Send the details below to
                                whoever manages permissions.
                            </p>
                        </div>
                    )}

                    <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1">What Grist said</p>
                        <p className="text-xs text-slate-700 font-mono break-words whitespace-pre-wrap">{error || 'Unknown error'}</p>
                    </div>

                    <div>
                        <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">What went through</p>
                        <ul className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                            {steps.map((s, i) => {
                                const st = STATUS[s.status] || STATUS.skipped;
                                const Icon = st.icon;
                                return (
                                    <li key={`${s.label}-${i}`} className="flex items-start gap-2 px-3 py-2">
                                        <Icon size={15} className={`shrink-0 mt-0.5 ${st.cls}`} />
                                        <span className="min-w-0 flex-1">
                                            <span className="block text-xs text-slate-700 break-words">{s.label}</span>
                                            {s.detail && (
                                                <span className="block text-[11px] text-slate-400 break-words mt-0.5">{s.detail}</span>
                                            )}
                                        </span>
                                        <span className={`text-[10px] font-semibold shrink-0 ${st.cls}`}>{st.label}</span>
                                    </li>
                                );
                            })}
                            {failed && (
                                <li className="flex items-start gap-2 px-3 py-2">
                                    <MinusCircle size={15} className="shrink-0 mt-0.5 text-slate-300" />
                                    <span className="text-xs text-slate-400 flex-1">Everything after this point was not attempted</span>
                                </li>
                            )}
                            {steps.length === 0 && (
                                <li className="px-3 py-2 text-xs text-slate-400">Nothing was written.</li>
                            )}
                        </ul>
                    </div>

                    {done.length > 0 && (
                        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
                            <p className="text-sm font-semibold text-rose-800 mb-1">
                                {done.length} change{done.length === 1 ? '' : 's'} already saved and need{done.length === 1 ? 's' : ''} reversing
                            </p>
                            <p className="text-xs text-rose-700">
                                They are in Grist now, and this app cannot take them back. Copy the details and ask
                                your manager to undo them before anyone tries this again — repeating it will double
                                up whatever went through.
                            </p>
                        </div>
                    )}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 flex items-center gap-2">
                    <Button variant="secondary" className="flex-1" icon={Copy} onClick={copy}>
                        {copied ? 'Copied' : 'Copy details'}
                    </Button>
                    {onRetry && done.length === 0 && (
                        <Button variant="primary" className="flex-1" onClick={onRetry}>Try again</Button>
                    )}
                    <Button variant="ghost" className="flex-1" onClick={onClose}>Close</Button>
                </div>
            </div>
        </div>
    );
};

export default WriteFailureModal;
