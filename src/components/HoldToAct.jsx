import React, { useState, useEffect, useRef } from 'react';
import { Loader2, ShieldCheck } from 'lucide-react';

// Long enough that a stray tap cannot get through, short enough not to be a chore.
export const HOLD_MS = 650;
// Destroying a record rather than just parking it asks for a noticeably longer,
// more deliberate press.
export const DESTRUCTIVE_HOLD_MS = 1600;

const TONES = {
    teal: { idle: 'border-teal-300 text-teal-700 hover:border-teal-500 active:border-teal-600', fill: 'bg-teal-500/20' },
    rose: { idle: 'border-rose-300 text-rose-700 hover:border-rose-500 active:border-rose-600', fill: 'bg-rose-500/25' }
};

const SIZES = {
    sm: 'px-3 py-1.5 rounded-full text-xs',
    lg: 'w-full justify-center px-4 py-2.5 rounded-lg text-sm'
};

// Press-and-hold confirm. The fill is a CSS transition over exactly holdMs, so
// what the operator sees filling up IS the timer — release early and it drains
// back with nothing committed.
const HoldToAct = ({
    onConfirm, busy, done, holdMs = HOLD_MS,
    label = 'Hold to acknowledge', holdingLabel = 'Keep holding…',
    icon, tone = 'teal', size = 'sm'
}) => {
    const Icon = icon || ShieldCheck;
    const [holding, setHolding] = useState(false);
    const timer = useRef(null);

    useEffect(() => () => clearTimeout(timer.current), []);

    const start = () => {
        if (busy || done || holding) return;
        setHolding(true);
        timer.current = setTimeout(() => { setHolding(false); onConfirm(); }, holdMs);
    };
    const cancel = () => {
        clearTimeout(timer.current);
        setHolding(false);
    };

    if (done) return null;

    const tones = TONES[tone];

    return (
        <button
            type="button"
            disabled={busy}
            onPointerDown={start}
            onPointerUp={cancel}
            onPointerLeave={cancel}
            onPointerCancel={cancel}
            onContextMenu={(e) => e.preventDefault()}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); start(); } }}
            onKeyUp={cancel}
            className={`relative overflow-hidden select-none touch-none inline-flex items-center gap-1.5 font-semibold border transition-colors ${SIZES[size]} ${busy ? 'border-slate-200 text-slate-400' : tones.idle}`}
            title={`Press and hold to ${label.replace(/^Hold to /, '')}`}
        >
            <span
                className={`absolute inset-y-0 left-0 ${tones.fill}`}
                style={{ width: holding ? '100%' : '0%', transition: `width ${holding ? holdMs : 160}ms linear` }}
                aria-hidden="true"
            />
            <span className="relative inline-flex items-center gap-1.5">
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                {busy ? 'Working…' : holding ? holdingLabel : label}
            </span>
        </button>
    );
};

export default HoldToAct;
