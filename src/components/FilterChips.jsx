import React from 'react';

// A row of filter chips: tap to include, tap again to drop.
//
// An empty selection means everything, which is what an untouched filter should
// do -- not nothing, which would open a list on a blank screen. Values come from
// the rows on hand rather than a fixed list, so a chip can never return nothing.
//
// The row scrolls sideways instead of wrapping: on a phone a dozen job names would
// otherwise push the list itself off the bottom of the screen.
const ChipRow = ({ label, values, chosen, onToggle, onClear, format }) => {
    if (!values || values.length === 0) return null;
    return (
        <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[10px] uppercase tracking-wider text-slate-400">{label}</span>
                {chosen.length > 0 && (
                    <button onClick={onClear} className="text-[10px] font-semibold text-teal-700 hover:text-teal-800">
                        clear
                    </button>
                )}
            </div>
            <div className="-mx-1 px-1 overflow-x-auto no-scrollbar">
                <div className="flex gap-1.5 w-max">
                    {values.map((v) => {
                        const on = chosen.includes(v);
                        return (
                            <button
                                key={String(v)}
                                type="button"
                                onClick={() => onToggle(v)}
                                aria-pressed={on}
                                className={`shrink-0 px-2 py-1 rounded-lg text-[11px] font-medium transition-colors ${on
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                            >
                                {format ? format(v) : String(v)}
                            </button>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ChipRow;
