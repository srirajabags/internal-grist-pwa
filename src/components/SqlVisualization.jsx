import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { BarChart, LineChart, PieChart, ScatterChart, Settings, Layers, Split, Table2 } from 'lucide-react';

const SqlVisualization = ({ data, config, onConfigChange, showControls = true }) => {
    // Extract columns from the first record
    const columns = useMemo(() => {
        if (!data || data.length === 0) return [];
        return Object.keys(data[0].fields || {});
    }, [data]);

    // Default config if not provided
    const currentConfig = {
        type: 'bar',
        xAxis: columns[0] || '',
        yAxis: columns[1] || '', // Default to second column if available
        splitSeries: '', // Column to split series by
        stack: false, // Whether to stack series
        // Pivot table config - support multiple levels
        rowFields: [columns[0] || ''], // Array of row fields for hierarchical grouping
        columnFields: [columns[1] || ''], // Array of column fields for hierarchical grouping
        valueField: columns[2] || columns[1] || '',
        aggregation: 'sum', // sum, count, avg, min, max
        ...config
    };

    const handleTypeChange = (type) => {
        onConfigChange({ ...currentConfig, type });
    };

    const handleAxisChange = (axis, value) => {
        onConfigChange({ ...currentConfig, [axis]: value });
    };

    const handleConfigChange = (key, value) => {
        onConfigChange({ ...currentConfig, [key]: value });
    };

    // Prepare data for ECharts
    const chartOption = useMemo(() => {
        if (!data || data.length === 0 || !currentConfig.xAxis) return {};

        const baseOption = {
            tooltip: {
                trigger: currentConfig.type === 'pie' ? 'item' : 'axis',
                axisPointer: {
                    type: 'shadow'
                }
            },
            legend: {
                bottom: 0,
                type: 'scroll'
            },
            grid: {
                left: '3%',
                right: '4%',
                bottom: '15%', // Increased for legend
                containLabel: true,
                top: '10%'
            },
            maintainAspectRatio: false,
        };

        // Handle Split Series Logic
        if (currentConfig.splitSeries && currentConfig.type !== 'pie') {
            // 1. Get unique X-axis values (Categories)
            const xAxisValues = Array.from(new Set(data.map(item => item.fields[currentConfig.xAxis])));

            // 2. Get unique Split Series values (Series Names)
            const seriesNames = Array.from(new Set(data.map(item => item.fields[currentConfig.splitSeries])));

            // 3. Build Series Data
            const series = seriesNames.map(seriesName => {
                const seriesData = xAxisValues.map(xVal => {
                    // Find record matching both X-axis value and Series name
                    const record = data.find(item =>
                        item.fields[currentConfig.xAxis] === xVal &&
                        item.fields[currentConfig.splitSeries] === seriesName
                    );
                    return record ? record.fields[currentConfig.yAxis] : 0; // Default to 0 if missing
                });

                return {
                    name: seriesName,
                    type: currentConfig.type,
                    stack: currentConfig.stack ? 'total' : undefined,
                    data: seriesData,
                    smooth: currentConfig.type === 'line',
                    symbolSize: currentConfig.type === 'scatter' ? 10 : undefined,
                    emphasis: {
                        focus: 'series'
                    }
                };
            });

            return {
                ...baseOption,
                xAxis: {
                    type: 'category',
                    data: xAxisValues
                },
                yAxis: {
                    type: 'value'
                },
                series: series
            };
        }

        // Standard (Single Series) Logic
        const xAxisData = data.map(item => item.fields[currentConfig.xAxis]);
        const yAxisData = currentConfig.yAxis ? data.map(item => item.fields[currentConfig.yAxis]) : [];

        switch (currentConfig.type) {
            case 'pie':
                return {
                    ...baseOption,
                    series: [
                        {
                            type: 'pie',
                            radius: '50%',
                            data: data.map(item => ({
                                name: item.fields[currentConfig.xAxis],
                                value: item.fields[currentConfig.yAxis]
                            })),
                            emphasis: {
                                itemStyle: {
                                    shadowBlur: 10,
                                    shadowOffsetX: 0,
                                    shadowColor: 'rgba(0, 0, 0, 0.5)'
                                }
                            }
                        }
                    ]
                };
            case 'scatter':
                return {
                    ...baseOption,
                    xAxis: { type: 'category', data: xAxisData },
                    yAxis: { type: 'value' },
                    series: [
                        {
                            type: 'scatter',
                            data: yAxisData,
                            symbolSize: 10,
                        }
                    ]
                };
            case 'line':
                return {
                    ...baseOption,
                    xAxis: {
                        type: 'category',
                        data: xAxisData
                    },
                    yAxis: {
                        type: 'value'
                    },
                    series: [
                        {
                            data: yAxisData,
                            type: 'line',
                            smooth: true
                        }
                    ]
                };
            case 'bar':
            default:
                return {
                    ...baseOption,
                    xAxis: {
                        type: 'category',
                        data: xAxisData
                    },
                    yAxis: {
                        type: 'value'
                    },
                    series: [
                        {
                            data: yAxisData,
                            type: 'bar'
                        }
                    ]
                };
        }
    }, [data, currentConfig]);

    // Prepare pivot table data with multi-level support
    const pivotData = useMemo(() => {
        if (!data || data.length === 0 || currentConfig.type !== 'pivot') return null;

        const { rowFields, columnFields, valueField, aggregation } = currentConfig;

        // Helper function to create composite key from multiple fields
        const createKey = (item, fields) => {
            return fields.map(field => {
                const val = item.fields[field];
                return val === null || val === undefined ? 'null' : String(val);
            }).join('|||');
        };

        // Helper function to parse composite key back to values
        const parseKey = (key) => {
            return key.split('|||');
        };

        // Get unique combinations for rows and columns
        const rowKeysSet = new Set();
        const columnKeysSet = new Set();

        data.forEach(item => {
            rowKeysSet.add(createKey(item, rowFields));
            columnKeysSet.add(createKey(item, columnFields));
        });

        const rowKeys = Array.from(rowKeysSet).sort();
        const columnKeys = Array.from(columnKeysSet).sort();

        // Create pivot data structure
        const pivotMatrix = {};

        rowKeys.forEach(rowKey => {
            pivotMatrix[rowKey] = {};
            columnKeys.forEach(colKey => {
                // Find all matching records
                const matchingRecords = data.filter(item =>
                    createKey(item, rowFields) === rowKey &&
                    createKey(item, columnFields) === colKey
                );

                if (matchingRecords.length === 0) {
                    pivotMatrix[rowKey][colKey] = null;
                } else {
                    const values = matchingRecords.map(r => {
                        const val = r.fields[valueField];
                        return typeof val === 'number' ? val : 0;
                    });

                    // Apply aggregation
                    switch (aggregation) {
                        case 'sum':
                            pivotMatrix[rowKey][colKey] = values.reduce((a, b) => a + b, 0);
                            break;
                        case 'count':
                            pivotMatrix[rowKey][colKey] = values.length;
                            break;
                        case 'avg':
                            pivotMatrix[rowKey][colKey] = values.reduce((a, b) => a + b, 0) / values.length;
                            break;
                        case 'min':
                            pivotMatrix[rowKey][colKey] = Math.min(...values);
                            break;
                        case 'max':
                            pivotMatrix[rowKey][colKey] = Math.max(...values);
                            break;
                        default:
                            pivotMatrix[rowKey][colKey] = values.reduce((a, b) => a + b, 0);
                    }
                }
            });
        });

        return {
            rowKeys,
            columnKeys,
            rowFields,
            columnFields,
            data: pivotMatrix
        };
    }, [data, currentConfig]);

    if (!data || data.length === 0) {
        return (
            <div className="flex items-center justify-center h-full text-slate-400 border border-dashed border-slate-300 rounded-xl">
                No data available for visualization
            </div>
        );
    }

    return (
        <div className="flex flex-col h-full space-y-2">
            {/* Configuration Panel */}
            {showControls && (
                <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 shrink-0">
                    <div className="flex flex-wrap gap-4 items-end">
                        {/* Chart Type Selector */}
                        <div className="flex-1 min-w-[200px]">
                            <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Chart Type</label>
                            <div className="flex bg-white rounded-lg border border-slate-200 p-1">
                                {[
                                    { id: 'bar', icon: BarChart, label: 'Bar' },
                                    { id: 'line', icon: LineChart, label: 'Line' },
                                    { id: 'pie', icon: PieChart, label: 'Pie' },
                                    { id: 'scatter', icon: ScatterChart, label: 'Scatter' },
                                    { id: 'pivot', icon: Table2, label: 'Pivot' },
                                ].map((type) => {
                                    const Icon = type.icon;
                                    const isActive = currentConfig.type === type.id;
                                    return (
                                        <button
                                            key={type.id}
                                            onClick={() => handleTypeChange(type.id)}
                                            className={`flex-1 flex items-center justify-center gap-2 py-1.5 rounded-md text-sm font-medium transition-all ${isActive
                                                ? 'bg-white text-cyan-600 shadow-sm ring-1 ring-slate-200'
                                                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
                                                }`}
                                            title={type.label}
                                        >
                                            <Icon size={16} />
                                            <span className="hidden sm:inline">{type.label}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>

                        {/* Axis Selectors - Only for non-pivot charts */}
                        {currentConfig.type !== 'pivot' && (
                            <>
                                <div className="flex-1 min-w-[150px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        {currentConfig.type === 'pie' ? 'Label Column' : 'X Axis (Category)'}
                                    </label>
                                    <select
                                        value={currentConfig.xAxis}
                                        onChange={(e) => handleAxisChange('xAxis', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        {columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex-1 min-w-[150px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        {currentConfig.type === 'pie' ? 'Value Column' : 'Y Axis (Value)'}
                                    </label>
                                    <select
                                        value={currentConfig.yAxis}
                                        onChange={(e) => handleAxisChange('yAxis', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        {columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>
                            </>
                        )}

                        {/* Pivot Table Configuration */}
                        {currentConfig.type === 'pivot' && (
                            <>
                                {/* Row Fields - Compact Multi-select */}
                                <div className="flex-1 min-w-[200px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        Row Fields
                                    </label>
                                    <select
                                        onChange={(e) => {
                                            const col = e.target.value;
                                            if (col && !currentConfig.rowFields.includes(col)) {
                                                handleConfigChange('rowFields', [...currentConfig.rowFields, col]);
                                            }
                                            e.target.value = '';
                                        }}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        <option value="">+ Add field...</option>
                                        {columns.filter(col => !currentConfig.rowFields.includes(col)).map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                    {currentConfig.rowFields.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {currentConfig.rowFields.map((field, idx) => (
                                                <span key={field} className="inline-flex items-center gap-1 px-2 py-1 bg-cyan-100 text-cyan-700 rounded text-xs font-medium">
                                                    <span className="text-[10px] text-cyan-600">{idx + 1}</span>
                                                    {field}
                                                    <button
                                                        onClick={() => {
                                                            const newFields = currentConfig.rowFields.filter(f => f !== field);
                                                            handleConfigChange('rowFields', newFields.length > 0 ? newFields : [columns[0]]);
                                                        }}
                                                        className="hover:text-cyan-900"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Column Fields - Compact Multi-select */}
                                <div className="flex-1 min-w-[200px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        Column Fields
                                    </label>
                                    <select
                                        onChange={(e) => {
                                            const col = e.target.value;
                                            if (col && !currentConfig.columnFields.includes(col)) {
                                                handleConfigChange('columnFields', [...currentConfig.columnFields, col]);
                                            }
                                            e.target.value = '';
                                        }}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        <option value="">+ Add field...</option>
                                        {columns.filter(col => !currentConfig.columnFields.includes(col)).map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                    {currentConfig.columnFields.length > 0 && (
                                        <div className="flex flex-wrap gap-1 mt-2">
                                            {currentConfig.columnFields.map((field, idx) => (
                                                <span key={field} className="inline-flex items-center gap-1 px-2 py-1 bg-purple-100 text-purple-700 rounded text-xs font-medium">
                                                    <span className="text-[10px] text-purple-600">{idx + 1}</span>
                                                    {field}
                                                    <button
                                                        onClick={() => {
                                                            const newFields = currentConfig.columnFields.filter(f => f !== field);
                                                            handleConfigChange('columnFields', newFields.length > 0 ? newFields : [columns[0]]);
                                                        }}
                                                        className="hover:text-purple-900"
                                                    >
                                                        ×
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                <div className="flex-1 min-w-[150px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        Value Field
                                    </label>
                                    <select
                                        value={currentConfig.valueField}
                                        onChange={(e) => handleConfigChange('valueField', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        {columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>

                                <div className="flex-1 min-w-[150px]">
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        Aggregation
                                    </label>
                                    <select
                                        value={currentConfig.aggregation}
                                        onChange={(e) => handleConfigChange('aggregation', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        <option value="sum">Sum</option>
                                        <option value="count">Count</option>
                                        <option value="avg">Average</option>
                                        <option value="min">Minimum</option>
                                        <option value="max">Maximum</option>
                                    </select>
                                </div>
                            </>
                        )}

                        {/* Split Series & Stack (Only for non-Pie charts) */}
                        {currentConfig.type !== 'pie' && currentConfig.type !== 'pivot' && (
                            <div className="flex-1 min-w-[150px] flex flex-col gap-2">
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                                        Split Series By (Optional)
                                    </label>
                                    <select
                                        value={currentConfig.splitSeries}
                                        onChange={(e) => handleConfigChange('splitSeries', e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                                    >
                                        <option value="">None</option>
                                        {columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>
                        )}

                        {/* Stack Checkbox */}
                        {currentConfig.type !== 'pie' && currentConfig.splitSeries && (
                            <div className="flex items-center pb-2">
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 font-medium select-none">
                                    <input
                                        type="checkbox"
                                        checked={currentConfig.stack}
                                        onChange={(e) => handleConfigChange('stack', e.target.checked)}
                                        className="w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500"
                                    />
                                    Stack Series
                                </label>
                            </div>
                        )}

                    </div>
                </div>
            )}

            {/* Chart Area */}
            <div className={`bg-white rounded-xl border border-slate-200 shadow-sm flex flex-col ${showControls ? 'min-h-[400px]' : 'h-full'}`}>
                {currentConfig.type === 'pivot' && pivotData ? (
                    <div className="overflow-auto flex-1">
                        <table className="w-full border-collapse">
                            <thead>
                                {/* Column field headers - one row per level */}
                                {pivotData.columnFields.map((fieldName, fieldIdx) => (
                                    <tr key={`col-header-${fieldIdx}`} className="bg-slate-100 sticky top-0" style={{ top: `${fieldIdx * 40}px`, zIndex: 10 - fieldIdx }}>
                                        {/* Row field header cells - one per row field */}
                                        {fieldIdx === 0 && pivotData.rowFields.map((rowFieldName, rowFieldIdx) => (
                                            <th
                                                key={`row-header-${rowFieldIdx}`}
                                                rowSpan={pivotData.columnFields.length}
                                                className="px-3 py-2 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider border border-slate-300 bg-slate-100"
                                            >
                                                {rowFieldName}
                                            </th>
                                        ))}
                                        {/* Column headers for this level */}
                                        {pivotData.columnKeys.map((colKey, colIdx) => {
                                            const colValues = colKey.split('|||');
                                            const displayValue = colValues[fieldIdx];

                                            // Check if we should merge cells (same value as previous)
                                            let colSpan = 1;
                                            if (fieldIdx < pivotData.columnFields.length - 1) {
                                                // Count how many subsequent columns have the same prefix
                                                for (let i = colIdx + 1; i < pivotData.columnKeys.length; i++) {
                                                    const nextValues = pivotData.columnKeys[i].split('|||');
                                                    let matches = true;
                                                    for (let j = 0; j <= fieldIdx; j++) {
                                                        if (nextValues[j] !== colValues[j]) {
                                                            matches = false;
                                                            break;
                                                        }
                                                    }
                                                    if (matches) colSpan++;
                                                    else break;
                                                }
                                            }

                                            // Skip if this cell should be merged with previous
                                            if (colIdx > 0) {
                                                const prevValues = pivotData.columnKeys[colIdx - 1].split('|||');
                                                let shouldSkip = true;
                                                for (let j = 0; j <= fieldIdx; j++) {
                                                    if (prevValues[j] !== colValues[j]) {
                                                        shouldSkip = false;
                                                        break;
                                                    }
                                                }
                                                if (shouldSkip && fieldIdx < pivotData.columnFields.length - 1) return null;
                                            }

                                            return (
                                                <th
                                                    key={colIdx}
                                                    colSpan={fieldIdx < pivotData.columnFields.length - 1 ? colSpan : 1}
                                                    className="px-4 py-2 text-center text-xs font-semibold text-slate-700 uppercase tracking-wider border border-slate-300 bg-slate-100 min-w-[100px]"
                                                >
                                                    <div className="text-[10px] text-slate-500 mb-0.5">{fieldName}</div>
                                                    {displayValue === 'null' ? <span className="text-slate-400 italic">null</span> : displayValue}
                                                </th>
                                            );
                                        })}
                                    </tr>
                                ))}
                            </thead>
                            <tbody>
                                {pivotData.rowKeys.map((rowKey, rowIdx) => {
                                    const rowValues = rowKey.split('|||');
                                    return (
                                        <tr
                                            key={rowIdx}
                                            className={`${rowIdx % 2 === 0 ? 'bg-white' : 'bg-slate-50'} hover:bg-cyan-50 transition-colors`}
                                        >
                                            {/* Row header cells - one per field level */}
                                            {pivotData.rowFields.map((fieldName, fieldIdx) => {
                                                const displayValue = rowValues[fieldIdx];

                                                // Check if we should merge cells (same value as previous row)
                                                let rowSpan = 1;
                                                if (fieldIdx < pivotData.rowFields.length - 1) {
                                                    // Count how many subsequent rows have the same prefix
                                                    for (let i = rowIdx + 1; i < pivotData.rowKeys.length; i++) {
                                                        const nextValues = pivotData.rowKeys[i].split('|||');
                                                        let matches = true;
                                                        for (let j = 0; j <= fieldIdx; j++) {
                                                            if (nextValues[j] !== rowValues[j]) {
                                                                matches = false;
                                                                break;
                                                            }
                                                        }
                                                        if (matches) rowSpan++;
                                                        else break;
                                                    }
                                                }

                                                // Skip if this cell should be merged with previous row
                                                if (rowIdx > 0) {
                                                    const prevValues = pivotData.rowKeys[rowIdx - 1].split('|||');
                                                    let shouldSkip = true;
                                                    for (let j = 0; j <= fieldIdx; j++) {
                                                        if (prevValues[j] !== rowValues[j]) {
                                                            shouldSkip = false;
                                                            break;
                                                        }
                                                    }
                                                    if (shouldSkip && fieldIdx < pivotData.rowFields.length - 1) return null;
                                                }

                                                return (
                                                    <td
                                                        key={fieldIdx}
                                                        rowSpan={fieldIdx < pivotData.rowFields.length - 1 ? rowSpan : 1}
                                                        className="px-3 py-2 text-sm font-medium text-slate-800 border border-slate-300 bg-slate-50"
                                                    >
                                                        <div className="text-[10px] text-slate-500 mb-0.5 uppercase">{fieldName}</div>
                                                        <div className="font-semibold">
                                                            {displayValue === 'null' ? <span className="text-slate-400 italic">null</span> : displayValue}
                                                        </div>
                                                    </td>
                                                );
                                            })}
                                            {/* Data cells */}
                                            {pivotData.columnKeys.map((colKey, colIdx) => {
                                                const value = pivotData.data[rowKey][colKey];
                                                return (
                                                    <td
                                                        key={colIdx}
                                                        className="px-4 py-3 text-sm text-slate-700 text-right border border-slate-300"
                                                    >
                                                        {value === null || value === undefined ? (
                                                            <span className="text-slate-400 italic">-</span>
                                                        ) : (
                                                            typeof value === 'number' ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : String(value)
                                                        )}
                                                    </td>
                                                );
                                            })}
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <ReactECharts option={chartOption} style={{ height: '100%', width: '100%', minHeight: showControls ? '400px' : '0' }} />
                )}
            </div>
        </div>
    );
};

export default SqlVisualization;
