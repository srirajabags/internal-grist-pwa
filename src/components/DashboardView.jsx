import React, { useState, useEffect, useMemo } from 'react';
import { Responsive, WidthProvider } from 'react-grid-layout';
import { ArrowLeft, Settings, Plus, Save, X, Trash2, Edit2, Eye, RefreshCw, Share2 } from 'lucide-react';
import WidgetContent from './WidgetContent';
import domtoimage from 'dom-to-image-more';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';

const ResponsiveGridLayout = WidthProvider(Responsive);

const customStyles = `
  .react-grid-item > .react-resizable-handle {
    position: absolute;
    width: 20px;
    height: 20px;
    bottom: 0;
    right: 0;
    cursor: se-resize;
    z-index: 100;
  }
  .react-grid-item > .react-resizable-handle::after {
    content: "";
    position: absolute;
    right: 3px;
    bottom: 3px;
    width: 8px;
    height: 8px;
    border-right: 2px solid rgba(0, 0, 0, 0.4);
    border-bottom: 2px solid rgba(0, 0, 0, 0.4);
  }
  .react-grid-placeholder {
    background: rgba(129, 140, 248, 0.2) !important;
    border-radius: 0.75rem !important;
    opacity: 0.5 !important;
  }
`;

const DashboardView = ({ dashboardId, onBack, getHeaders, getUrl, teamId }) => {
    const [dashboard, setDashboard] = useState(null);
    const [isEditing, setIsEditing] = useState(false);
    const [savedQueries, setSavedQueries] = useState([]);
    const [showAddWidgetModal, setShowAddWidgetModal] = useState(false);
    const [editingWidgetId, setEditingWidgetId] = useState(null);

    // Force refresh trigger
    const [refreshTrigger, setRefreshTrigger] = useState(0);

    useEffect(() => {
        // Load Dashboard from Grist
        const loadDashboard = async () => {
            try {
                const { fetchPwaDataSql } = await import('../utils/gristDataSync');
                const PWA_DATA_DOC_ID = '8vRFY3UUf4spJroktByH4u';
                const gristRecords = await fetchPwaDataSql(PWA_DATA_DOC_ID, 'DASHBOARD', teamId, getHeaders, getUrl);

                const dashboards = gristRecords.map(r => {
                    try {
                        const parsed = JSON.parse(r.fields.Data);
                        return {
                            ...parsed,
                            uuid: r.fields.UUID,
                            sharedWith: r.fields.Shared_With,
                            createdBy: r.fields.Created_By
                        };
                    } catch (e) {
                        console.warn("Failed to parse Grist record", r);
                        return null;
                    }
                }).filter(Boolean);

                const current = dashboards.find(d => d.id === dashboardId);
                if (current) {
                    setDashboard(current);
                }
            } catch (err) {
                console.error("Error loading dashboard:", err);
            }
        };

        if (teamId && dashboardId) {
            loadDashboard();
        }
    }, [dashboardId, teamId]);

    // Fetch saved queries from Grist when modal opens
    useEffect(() => {
        if (showAddWidgetModal && teamId) {
            fetchSavedQueries();
        }
    }, [showAddWidgetModal]);

    const fetchSavedQueries = async () => {
        try {
            const { fetchPwaDataSql } = await import('../utils/gristDataSync');
            const PWA_DATA_DOC_ID = '8vRFY3UUf4spJroktByH4u';
            const gristRecords = await fetchPwaDataSql(PWA_DATA_DOC_ID, 'SQL_QUERY', teamId, getHeaders, getUrl);

            const queries = gristRecords.map(r => {
                try {
                    const parsed = JSON.parse(r.fields.Data);
                    return {
                        ...parsed,
                        uuid: r.fields.UUID,
                        sharedWith: r.fields.Shared_With,
                        createdBy: r.fields.Created_By
                    };
                } catch (e) {
                    console.warn("Failed to parse Grist record", r);
                    return null;
                }
            }).filter(Boolean);

            setSavedQueries(queries);
        } catch (err) {
            console.error("Error fetching saved queries:", err);
        }
    };

    // Fetch data for widgets - REMOVED (Handled by DashboardWidget)
    // useEffect(() => { ... }, [dashboard]);
    // const fetchWidgetData = async (widget) => { ... };

    const refreshDashboard = () => {
        // Trigger re-render of widgets to re-fetch
        setRefreshTrigger(prev => prev + 1);
    };

    const saveDashboard = async (updatedDashboard) => {
        setDashboard(updatedDashboard);

        // Sync to Grist PWA_Data
        try {
            const { savePwaData } = await import('../utils/gristDataSync');
            const PWA_DATA_DOC_ID = '8vRFY3UUf4spJroktByH4u';
            await savePwaData(PWA_DATA_DOC_ID, [updatedDashboard], 'DASHBOARD', getHeaders, getUrl);
        } catch (err) {
            console.error("Failed to sync dashboard to Grist:", err);
        }
    };

    const onLayoutChange = (layout) => {
        if (!dashboard) return;
        // Merge new layout positions into widgets
        const updatedWidgets = dashboard.widgets.map(w => {
            const layoutItem = layout.find(l => l.i === w.i);
            return layoutItem ? { ...w, ...layoutItem } : w;
        });
        saveDashboard({ ...dashboard, widgets: updatedWidgets });
    };

    const addWidget = (queryItem) => {
        const newWidget = {
            i: Date.now().toString(),
            x: 0,
            y: Infinity, // Puts it at the bottom
            w: 6,
            h: 4,
            queryId: queryItem.id,
            name: queryItem.name,
            query: queryItem.query,
            docId: queryItem.docId,
            vizConfig: queryItem.vizConfig || {}
        };

        const updatedDashboard = {
            ...dashboard,
            widgets: [...dashboard.widgets, newWidget]
        };
        saveDashboard(updatedDashboard);
        setShowAddWidgetModal(false);
    };

    const removeWidget = (widgetId) => {
        const updatedDashboard = {
            ...dashboard,
            widgets: dashboard.widgets.filter(w => w.i !== widgetId)
        };
        saveDashboard(updatedDashboard);
    };

    const updateWidgetConfig = (widgetId, newConfig) => {
        const updatedWidgets = dashboard.widgets.map(w =>
            w.i === widgetId ? { ...w, vizConfig: newConfig } : w
        );
        saveDashboard({ ...dashboard, widgets: updatedWidgets });
    };

    const handleShare = async (elementId, fileName) => {
        const element = document.getElementById(elementId);
        if (!element) {
            console.error('Element not found:', elementId);
            alert('Element not found for sharing');
            return;
        }

        console.log('Starting image generation for:', elementId);

        // Create a temporary style element with !important rules
        const styleId = 'temp-capture-styles';
        let styleElement = document.getElementById(styleId);

        if (!styleElement) {
            styleElement = document.createElement('style');
            styleElement.id = styleId;
            document.head.appendChild(styleElement);
        }

        // Store original inline styles
        const elementsWithStyles = [];

        try {
            // Add CSS rules to force all descendants to be visible
            styleElement.textContent = `
                #${elementId},
                #${elementId} * {
                    overflow: visible !important;
                    overflow-x: visible !important;
                    overflow-y: visible !important;
                    max-height: none !important;
                }
                #${elementId} .flex-1,
                #${elementId} .h-full {
                    height: auto !important;
                    flex: none !important;
                }
                #${elementId} .overflow-auto,
                #${elementId} .overflow-hidden,
                #${elementId} .overflow-scroll {
                    overflow: visible !important;
                }
            `;

            // Also force inline styles for maximum override
            const allElements = [element, ...element.querySelectorAll('*')];
            allElements.forEach(el => {
                const originalStyle = el.getAttribute('style') || '';
                elementsWithStyles.push({ el, originalStyle });

                const newStyle = originalStyle +
                    '; overflow: visible !important' +
                    '; overflow-x: visible !important' +
                    '; overflow-y: visible !important' +
                    '; max-height: none !important';

                el.setAttribute('style', newStyle);
            });

            // Force browser reflow
            element.offsetHeight;

            // Wait for styles to apply and layout to settle
            await new Promise(resolve => setTimeout(resolve, 500));

            // Log the element height to verify expansion
            console.log('Element height before capture:', element.scrollHeight, 'px');

            // Use dom-to-image-more (html2canvas doesn't support Tailwind v4's okch colors)
            const blob = await domtoimage.toBlob(element, {
                quality: 0.95,
                bgcolor: '#f8fafc',
                style: {
                    transform: 'scale(1)',
                    transformOrigin: 'top left'
                }
            });

            console.log('Image generated successfully, blob size:', blob.size, 'bytes');

            // Try Web Share API first (for mobile)
            if (navigator.share) {
                try {
                    const file = new File([blob], `${fileName}.png`, { type: 'image/png' });

                    // Check if we can share files
                    if (navigator.canShare && navigator.canShare({ files: [file] })) {
                        await navigator.share({
                            files: [file],
                            title: fileName,
                        });
                        console.log('Shared successfully via Web Share API');
                        return;
                    } else {
                        console.log('Web Share API does not support files, falling back to download');
                    }
                } catch (err) {
                    if (err.name !== 'AbortError') {
                        console.log('Sharing failed, falling back to download:', err);
                    } else {
                        console.log('User cancelled share');
                        return;
                    }
                }
            }

            // Fallback to download
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.download = `${fileName}.png`;
            link.href = url;
            link.click();
            URL.revokeObjectURL(url);
            console.log('Download initiated');
        } catch (err) {
            console.error('Error generating image:', err);
            console.error('Error stack:', err.stack);
            alert(`Failed to generate image: ${err.message}`);
        } finally {
            // Remove the temporary styles
            if (styleElement) {
                styleElement.textContent = '';
            }

            // Restore original inline styles
            elementsWithStyles.forEach(({ el, originalStyle }) => {
                if (originalStyle) {
                    el.setAttribute('style', originalStyle);
                } else {
                    el.removeAttribute('style');
                }
            });
        }
    };

    if (!dashboard) return <div className="p-8 text-center">Loading Dashboard...</div>;

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <style>{customStyles}</style>
            <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-10">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
                            <ArrowLeft size={20} />
                        </button>
                        <h1 className="font-bold text-slate-800 text-lg">{dashboard.name}</h1>
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => handleShare('dashboard-content', dashboard.name)}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                            title="Share Dashboard"
                        >
                            <Share2 size={20} />
                        </button>
                        <button
                            onClick={refreshDashboard}
                            className="p-2 hover:bg-slate-100 rounded-lg text-slate-600 transition-colors"
                            title="Refresh Data"
                        >
                            <RefreshCw size={20} />
                        </button>
                        {isEditing && (
                            <button
                                onClick={() => setShowAddWidgetModal(true)}
                                className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2"
                            >
                                <Plus size={16} /> Add Widget
                            </button>
                        )}
                        <button
                            onClick={() => {
                                setIsEditing(!isEditing);
                                setEditingWidgetId(null); // Clear widget edit state when toggling dashboard edit
                            }}
                            className={`px-3 py-2 rounded-lg text-sm font-medium flex items-center gap-2 transition-colors ${isEditing ? 'bg-green-100 text-green-700 hover:bg-green-200' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                }`}
                        >
                            {isEditing ? <><Save size={16} /> Done Editing</> : <><Edit2 size={16} /> Edit Dashboard</>}
                        </button>
                    </div>
                </div>
            </header>

            <main className="flex-1 p-4 overflow-x-hidden" id="dashboard-content">
                <div className="max-w-7xl mx-auto">
                    <ResponsiveGridLayout
                        className="layout"
                        layouts={{ lg: dashboard.widgets }}
                        breakpoints={{ lg: 1200, md: 996, sm: 768, xs: 480, xxs: 0 }}
                        cols={{ lg: 12, md: 10, sm: 6, xs: 4, xxs: 2 }}
                        rowHeight={60}
                        isDraggable={isEditing}
                        isResizable={isEditing}
                        onLayoutChange={onLayoutChange}
                        draggableHandle=".drag-handle"
                        resizeHandles={['se']}
                    >
                        {dashboard.widgets.map(widget => (
                            <div
                                key={widget.i}
                                id={`widget-${widget.i}`}
                                className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-visible flex flex-col relative group h-full"
                            >
                                <WidgetContent
                                    widget={widget}
                                    isEditing={isEditing}
                                    editingWidgetId={editingWidgetId}
                                    onRemove={removeWidget}
                                    onEditConfig={updateWidgetConfig}
                                    onSetEditing={setEditingWidgetId}
                                    onShare={handleShare}
                                    getHeaders={getHeaders}
                                    getUrl={getUrl}
                                    refreshTrigger={refreshTrigger}
                                />
                            </div>
                        ))}
                    </ResponsiveGridLayout>
                </div>
            </main>

            {/* Add Widget Modal */}
            {showAddWidgetModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowAddWidgetModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] flex flex-col" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-slate-200 flex justify-between items-center">
                            <h2 className="text-lg font-bold text-slate-800">Add Widget from Saved Queries</h2>
                            <button onClick={() => setShowAddWidgetModal(false)}><X size={20} className="text-slate-400" /></button>
                        </div>
                        <div className="flex-1 overflow-auto p-4">
                            {savedQueries.length === 0 ? (
                                <p className="text-center text-slate-500 py-8">No saved queries found. Go to "Analyse with SQL" to save some queries first.</p>
                            ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                    {savedQueries.map(q => (
                                        <div key={q.id} className="border border-slate-200 rounded-lg p-3 hover:border-indigo-300 cursor-pointer transition-all" onClick={() => addWidget(q)}>
                                            <h3 className="font-bold text-slate-800 mb-1">{q.name}</h3>
                                            <p className="text-xs text-slate-500 mb-2">{new Date(q.timestamp).toLocaleDateString()}</p>
                                            <div className="flex gap-2 text-xs text-slate-600">
                                                <span className="bg-slate-100 px-2 py-0.5 rounded">
                                                    {q.vizConfig && Object.keys(q.vizConfig).length > 0 ? 'Chart' : 'Table'}
                                                </span>
                                                <span className="bg-slate-100 px-2 py-0.5 rounded truncate max-w-[150px]">{q.docId}</span>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DashboardView;
