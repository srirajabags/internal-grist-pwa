import React, { useMemo } from 'react';
import ReactECharts from 'echarts-for-react';
import { BarChart, LineChart, PieChart, ScatterChart, Settings, Layers, Split } from 'lucide-react';

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

                        {/* Axis Selectors */}
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

                        {/* Split Series & Stack (Only for non-Pie charts) */}
                        {currentConfig.type !== 'pie' && (
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
            <div className={`bg-white p-4 rounded-xl border border-slate-200 shadow-sm ${showControls ? 'min-h-[400px]' : 'h-full'}`}>
                <ReactECharts option={chartOption} style={{ height: '100%', width: '100%', minHeight: showControls ? '400px' : '0' }} />
            </div>
        </div>
    );
};

export default SqlVisualization;
