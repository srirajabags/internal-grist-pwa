import React from 'react';
import { Share2, Settings, Trash2 } from 'lucide-react';
import SqlVisualization from './SqlVisualization';
import { useSqlExecution } from '../hooks/useSqlExecution';

// This component only renders the widget content, not the wrapper div
// The wrapper div is in DashboardView to work with react-grid-layout
const WidgetContent = ({
    widget,
    isEditing,
    editingWidgetId,
    onRemove,
    onEditConfig,
    onSetEditing,
    onShare,
    getHeaders,
    getUrl,
    refreshTrigger
}) => {
    const {
        data,
        loading,
        error,
        variables,
        parsedVars,
        setVariable
    } = useSqlExecution(widget.query, widget.docId, getHeaders, getUrl, refreshTrigger);

    return (
        <>
            {/* Widget Header */}
            <div className="flex justify-between items-center border-b border-slate-100 shrink-0">
                <div className={`flex-1 px-3 py-2 min-w-0 ${isEditing ? 'cursor-move drag-handle bg-slate-50' : ''}`}>
                    <h3 className="font-semibold text-slate-700 text-sm truncate select-none">{widget.name}</h3>
                </div>
                <div className={`flex items-center gap-1 px-2 py-1 ${isEditing ? 'bg-slate-50' : ''}`}>
                    {/* Share Button */}
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onShare(`widget-${widget.i}`, widget.name);
                        }}
                        className="p-1.5 rounded hover:bg-slate-200 text-slate-400"
                        title="Share Widget"
                    >
                        <Share2 size={16} />
                    </button>

                    {/* Settings Button */}
                    <button
                        onMouseDown={(e) => e.stopPropagation()}
                        onTouchStart={(e) => e.stopPropagation()}
                        onClick={(e) => {
                            e.stopPropagation();
                            onSetEditing(editingWidgetId === widget.i ? null : widget.i);
                        }}
                        className={`p-1.5 rounded hover:bg-slate-200 ${editingWidgetId === widget.i ? 'text-indigo-600 bg-indigo-100' : 'text-slate-400'}`}
                        title="Configure Chart"
                    >
                        <Settings size={16} />
                    </button>

                    {isEditing && (
                        <button
                            onMouseDown={(e) => e.stopPropagation()}
                            onTouchStart={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); onRemove(widget.i); }}
                            className="text-slate-400 hover:text-red-500 hover:bg-red-50 p-1.5 rounded transition-colors"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
            </div>

            {/* Variable Inputs */}
            {parsedVars.length > 0 && (
                <div className="p-2 bg-slate-50 border-b border-slate-100 flex flex-wrap gap-2 shrink-0">
                    {parsedVars.filter((v, i, self) => i === self.findIndex(t => t.name === v.name)).map((variable) => (
                        <div key={variable.name} className="min-w-[120px] flex-1 max-w-[200px]">
                            <label className="block text-[10px] font-medium text-slate-500 mb-0.5 truncate" title={`${variable.name} (${variable.type})`}>
                                {variable.name} <span className="text-slate-400 opacity-75">({variable.type})</span>
                            </label>

                            {variable.type === 'dropdown' ? (
                                <select
                                    value={variables[variable.name] || ''}
                                    onChange={(e) => setVariable(variable.name, e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    {variable.options.map(opt => (
                                        <option key={opt} value={opt}>{opt}</option>
                                    ))}
                                </select>
                            ) : variable.type === 'boolean' ? (
                                <div className="flex items-center h-[26px]">
                                    <label className="flex items-center gap-1.5 cursor-pointer text-xs text-slate-700 select-none">
                                        <input
                                            type="checkbox"
                                            checked={!!variables[variable.name]}
                                            onChange={(e) => setVariable(variable.name, e.target.checked)}
                                            className="w-3.5 h-3.5 text-indigo-600 rounded border-slate-300 focus:ring-indigo-500"
                                        />
                                        {variables[variable.name] ? 'True' : 'False'}
                                    </label>
                                </div>
                            ) : variable.type === 'date' ? (
                                <input
                                    type="date"
                                    value={variables[variable.name] || ''}
                                    onChange={(e) => setVariable(variable.name, e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                />
                            ) : variable.type === 'timestamp' ? (
                                <input
                                    type="datetime-local"
                                    value={variables[variable.name] || ''}
                                    onChange={(e) => setVariable(variable.name, e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                />
                            ) : (
                                <input
                                    type="text"
                                    value={variables[variable.name] || ''}
                                    onChange={(e) => setVariable(variable.name, e.target.value)}
                                    className="w-full px-2 py-1 border border-slate-300 rounded text-xs focus:ring-1 focus:ring-indigo-500 outline-none bg-white"
                                />
                            )}
                        </div>
                    ))}
                </div>
            )}

            {/* Widget Content */}
            <div className="flex-1 overflow-hidden p-2 relative min-h-0">
                {loading ? (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                        Loading...
                    </div>
                ) : error ? (
                    <div className="absolute inset-0 flex items-center justify-center text-red-400 text-sm p-4 text-center">
                        {error}
                    </div>
                ) : data ? (
                    Object.keys(widget.vizConfig || {}).length > 0 ? (
                        <div className="h-full w-full">
                            <SqlVisualization
                                data={data}
                                config={widget.vizConfig}
                                onConfigChange={(newConfig) => onEditConfig(widget.i, newConfig)}
                                showControls={editingWidgetId === widget.i}
                            />
                        </div>
                    ) : (
                        <div className="overflow-auto h-full text-xs">
                            <table className="min-w-full">
                                <thead>
                                    <tr className="bg-slate-50 sticky top-0">
                                        {Object.keys(data[0]?.fields || {}).map(k => (
                                            <th key={k} className="px-2 py-1 text-left font-medium text-slate-500 bg-slate-50">{k}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.slice(0, 50).map((row, idx) => (
                                        <tr key={idx} className="border-b border-slate-50 hover:bg-slate-50">
                                            {Object.values(row.fields || {}).map((v, i) => (
                                                <td key={i} className="px-2 py-1 truncate max-w-[100px]">{String(v)}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )
                ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-slate-400 text-sm">
                        No Data
                    </div>
                )}
                {/* Overlay to prevent interaction during edit drag */}
                {isEditing && editingWidgetId !== widget.i && <div className="absolute inset-0 z-10" />}
            </div>
        </>
    );
};

export default WidgetContent;
