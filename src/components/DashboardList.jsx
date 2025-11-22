import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Plus, Trash2, ArrowRight, ArrowLeft, Code } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const DashboardList = ({ onNavigate, onBack }) => {
    const [dashboards, setDashboards] = useState([]);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [newDashboardName, setNewDashboardName] = useState('');
    const navigate = useNavigate();

    useEffect(() => {
        const stored = localStorage.getItem('data_dashboards');
        if (stored) {
            setDashboards(JSON.parse(stored));
        }
    }, []);

    const saveDashboards = (updated) => {
        setDashboards(updated);
        localStorage.setItem('data_dashboards', JSON.stringify(updated));
    };

    const handleCreate = () => {
        if (!newDashboardName.trim()) return;
        const newDash = {
            id: Date.now().toString(),
            name: newDashboardName,
            widgets: [],
            createdAt: new Date().toISOString()
        };
        saveDashboards([...dashboards, newDash]);
        setNewDashboardName('');
        setShowCreateModal(false);
    };

    const handleDelete = (id, e) => {
        e.stopPropagation();
        if (confirm('Are you sure you want to delete this dashboard?')) {
            saveDashboards(dashboards.filter(d => d.id !== id));
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 px-4 py-3 sticky top-0 z-20">
                <div className="max-w-7xl mx-auto flex items-center justify-between">
                    <div className="flex items-center gap-3">
                        <button onClick={onBack} className="p-2 hover:bg-slate-100 rounded-lg text-slate-600">
                            <ArrowLeft size={20} />
                        </button>
                        <div className="flex items-center gap-2">
                            <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                                <LayoutDashboard size={18} />
                            </div>
                            <h1 className="font-bold text-slate-800">Data Dashboards</h1>
                        </div>
                    </div>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 flex items-center gap-2"
                    >
                        <Plus size={18} />
                        New Dashboard
                    </button>
                </div>
            </header>

            <main className="flex-1 p-4 overflow-auto">
                <div className="max-w-7xl mx-auto">
                    {/* Sticky SQL Analysis Card */}
                    <div className="sticky top-0 z-10 mb-6 -mt-2 pt-2 bg-slate-50 pb-2">
                        <div
                            onClick={() => navigate('/sql')}
                            className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group flex items-center justify-between"
                        >
                            <div className="flex items-center gap-4">
                                <div className="w-10 h-10 bg-cyan-600 rounded-lg flex items-center justify-center text-white group-hover:scale-110 transition-transform">
                                    <Code size={20} />
                                </div>
                                <div>
                                    <h3 className="font-bold text-slate-800">Analyse with SQL</h3>
                                    <p className="text-sm text-slate-500">Execute custom SQL queries and create widgets</p>
                                </div>
                            </div>
                            <div className="flex items-center text-cyan-600 text-sm font-medium">
                                Open SQL Editor <ArrowRight size={16} className="ml-1" />
                            </div>
                        </div>
                    </div>

                    {dashboards.length === 0 ? (
                        <div className="text-center py-20 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                            <LayoutDashboard size={48} className="mx-auto mb-4 text-slate-300" />
                            <p className="text-lg font-medium mb-2">No Dashboards Yet</p>
                            <p className="text-sm mb-4">Create your first dashboard to organize your data views.</p>
                            <button
                                onClick={() => setShowCreateModal(true)}
                                className="text-indigo-600 font-medium hover:underline"
                            >
                                Create Dashboard
                            </button>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                            {dashboards.map(dash => (
                                <div
                                    key={dash.id}
                                    onClick={() => onNavigate(dash.id)}
                                    className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm hover:shadow-md transition-all cursor-pointer group relative"
                                >
                                    <div className="flex justify-between items-start mb-4">
                                        <div className="w-12 h-12 bg-indigo-50 text-indigo-600 rounded-xl flex items-center justify-center">
                                            <LayoutDashboard size={24} />
                                        </div>
                                        <button
                                            onClick={(e) => handleDelete(dash.id, e)}
                                            className="text-slate-400 hover:text-red-500 p-2 opacity-0 group-hover:opacity-100 transition-opacity"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    </div>
                                    <h3 className="text-lg font-bold text-slate-800 mb-1">{dash.name}</h3>
                                    <p className="text-sm text-slate-500 mb-4">
                                        {dash.widgets.length} widget{dash.widgets.length !== 1 ? 's' : ''}
                                    </p>
                                    <div className="flex items-center text-indigo-600 text-sm font-medium">
                                        Open Dashboard <ArrowRight size={16} className="ml-1" />
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Create Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowCreateModal(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={e => e.stopPropagation()}>
                        <h2 className="text-xl font-bold text-slate-800 mb-4">Create New Dashboard</h2>
                        <input
                            type="text"
                            value={newDashboardName}
                            onChange={e => setNewDashboardName(e.target.value)}
                            placeholder="Dashboard Name"
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg mb-4 focus:ring-2 focus:ring-indigo-500 outline-none"
                            autoFocus
                        />
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setShowCreateModal(false)}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreate}
                                disabled={!newDashboardName.trim()}
                                className="px-4 py-2 bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                            >
                                Create
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DashboardList;
