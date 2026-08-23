import React from 'react';
import { X, Download, QrCode } from 'lucide-react';
import Button from './Button';

// The label for one stock item, on screen so it can be checked before printing --
// the image itself has already been handed to the browser as a download.
const ItemLabelModal = ({ label, onClose }) => (
    <div className="fixed inset-0 bg-black/60 flex items-end sm:items-center justify-center z-50 sm:p-4" onClick={onClose}>
        <div className="bg-white w-full sm:max-w-xs sm:rounded-2xl shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-slate-200 px-4 py-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                    <span className="w-8 h-8 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
                        <QrCode size={18} />
                    </span>
                    <div className="min-w-0">
                        <h2 className="font-bold text-slate-800 leading-tight">Item label</h2>
                        <p className="text-[11px] text-slate-500 font-mono truncate">{label.iid}</p>
                    </div>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-slate-700 p-1 shrink-0"><X size={20} /></button>
            </div>

            <div className="p-4 flex flex-col items-center gap-3">
                <img
                    src={label.url}
                    alt={`Label for ${label.iid}`}
                    className="w-56 h-auto border border-slate-200 rounded-lg"
                />
                <a
                    href={label.url}
                    download={label.filename}
                    className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 text-white text-sm font-semibold hover:bg-slate-900"
                >
                    <Download size={16} /> Download again
                </a>
                <p className="text-[11px] text-slate-400 text-center">
                    Already downloaded. Print and stick it on the item — the scanner reads this code.
                </p>
            </div>

            <div className="border-t border-slate-200 px-4 py-3 flex justify-end">
                <Button variant="ghost" onClick={onClose}>Close</Button>
            </div>
        </div>
    </div>
);

export default ItemLabelModal;
