import React from 'react';
import { X, Trash2, AlertTriangle, Loader2, Lock, Layers } from 'lucide-react';
import Button from './Button';
import HoldToAct, { DESTRUCTIVE_HOLD_MS } from './HoldToAct';
import { deleteBlockers } from '../utils/batchDelete';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

// Undo a batch creation. Creation wrote a batch record and one job per group; the
// two-way references mean deleting the jobs also detaches them from their
// sub-orders, which go back to unplanned and are picked up by the next run.
const DeleteBatchModal = ({ batch, checking, txnCount, checkFailed, busy, error, onClose, onDelete }) => {
    const jobs = batch?.jobs || [];
    const subOrderCount = new Set(jobs.flatMap((j) => (j.subOrders || []).map((so) => so.id))).size;
    const blockers = checking ? [] : deleteBlockers({ batch, txnCount, checkFailed });
    const blocked = blockers.length > 0;

    return (
        <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
            <div
                className="bg-white w-full sm:max-w-md sm:rounded-2xl shadow-xl flex flex-col max-h-[92vh]"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        <span className="w-9 h-9 rounded-lg bg-rose-100 text-rose-700 flex items-center justify-center shrink-0">
                            <Trash2 size={18} />
                        </span>
                        <div className="min-w-0">
                            <h2 className="font-bold text-slate-800 leading-tight">Delete this batch</h2>
                            <p className="text-xs text-slate-500 truncate">{batch?.name || batch?.type || 'Batch'} · {jobs.length} job{jobs.length === 1 ? '' : 's'}</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
                </div>

                <div className="flex-1 overflow-y-auto p-4 space-y-3">
                    {checking && (
                        <p className="flex items-center gap-2 text-sm text-slate-500 py-4">
                            <Loader2 size={16} className="animate-spin" /> Checking whether anything has moved…
                        </p>
                    )}

                    {!checking && blocked && (
                        <div className="rounded-lg bg-rose-50 border border-rose-200 p-3">
                            <p className="flex items-center gap-1.5 text-sm font-semibold text-rose-800 mb-1.5">
                                <Lock size={15} /> This batch can no longer be deleted
                            </p>
                            <ul className="text-xs text-rose-700 space-y-1 list-disc pl-4">
                                {blockers.map((b) => <li key={b}>{b}</li>)}
                            </ul>
                            <p className="text-[11px] text-rose-600 mt-2">
                                Work has already been done against it. Unwind that in Grist first, or leave the
                                batch in place and correct the jobs individually.
                            </p>
                        </div>
                    )}

                    {!checking && !blocked && (
                        <>
                            <div className="rounded-lg bg-amber-50 border border-amber-200 p-3">
                                <p className="flex items-center gap-1.5 text-sm font-semibold text-amber-900 mb-1">
                                    <AlertTriangle size={15} /> This cannot be undone
                                </p>
                                <p className="text-xs text-amber-800">
                                    Nothing has moved in the godown for this batch, so deleting it puts everything
                                    back the way it was before the batch was created.
                                </p>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Will be deleted</p>
                                <div className="rounded-lg border border-slate-200 divide-y divide-slate-100">
                                    {jobs.map((job) => (
                                        <div key={job.id} className="flex items-center justify-between gap-3 px-3 py-2">
                                            <span className="inline-flex px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-white break-all min-w-0">
                                                {job.name || `Job #${job.id}`}
                                            </span>
                                            <span className="text-[11px] text-slate-500 text-right min-w-0 break-words">
                                                {(job.subOrders || []).length} sub-order{(job.subOrders || []).length === 1 ? '' : 's'}
                                                {num(job.plannedKg) > 0 ? ` · ${num(job.plannedKg).toFixed(2)} kg` : ''}
                                            </span>
                                        </div>
                                    ))}
                                    {jobs.length === 0 && (
                                        <p className="px-3 py-2 text-[11px] text-slate-400">No jobs — only the batch record.</p>
                                    )}
                                    <div className="px-3 py-2 text-[11px] text-slate-500">The batch record itself</div>
                                </div>
                            </div>

                            <div>
                                <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1.5">What happens next</p>
                                <ul className="text-xs text-slate-600 space-y-1.5">
                                    <li className="flex gap-2">
                                        <Layers size={14} className="shrink-0 mt-0.5 text-slate-400" />
                                        <span>
                                            <strong>{subOrderCount}</strong> sub-order{subOrderCount === 1 ? '' : 's'} go back to
                                            unplanned and will be offered again the next time you create a batch of this type.
                                        </span>
                                    </li>
                                    <li className="flex gap-2">
                                        <Layers size={14} className="shrink-0 mt-0.5 text-slate-400" />
                                        <span>Stock assigned to these jobs is freed — it was only reserved on paper, never booked out.</span>
                                    </li>
                                    <li className="flex gap-2">
                                        <Layers size={14} className="shrink-0 mt-0.5 text-slate-400" />
                                        <span>
                                            No-stock flags are left as they are: they say what the last planning run found,
                                            and the next run recomputes them.
                                        </span>
                                    </li>
                                </ul>
                            </div>
                        </>
                    )}

                    {error && (
                        <div className="rounded-lg bg-red-50 border border-red-200 p-3 text-xs text-red-700 break-words">
                            {error}
                        </div>
                    )}
                </div>

                <div className="border-t border-slate-200 p-3 shrink-0 flex items-center gap-2">
                    <Button variant="ghost" className="flex-1" onClick={onClose} disabled={busy}>
                        {blocked ? 'Close' : 'Cancel'}
                    </Button>
                    {!blocked && !checking && (
                        <span className="flex-1">
                            <HoldToAct
                                tone="rose"
                                size="lg"
                                icon={Trash2}
                                holdMs={DESTRUCTIVE_HOLD_MS}
                                busy={busy}
                                label="Hold to delete batch"
                                holdingLabel="Keep holding to delete…"
                                onConfirm={onDelete}
                            />
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default DeleteBatchModal;
