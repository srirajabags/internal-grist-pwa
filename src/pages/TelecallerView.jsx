import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, Phone, Loader2, AlertCircle, RefreshCw, IndianRupee, X, User, LogOut } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import TelecallerCustomerView from './TelecallerCustomerView';
import CustomerCard from '../components/CustomerCard';

const SalaryDetailsModal = ({ data, areaGroupNames = {}, month, onClose }) => {
    console.log("SalaryDetailsModal rendered with data:", data);

    if (!data) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
                <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center" onClick={e => e.stopPropagation()}>
                    <AlertCircle size={48} className="mx-auto mb-4 text-slate-300" />
                    <h2 className="text-xl font-bold text-slate-800 mb-2">No Salary Data</h2>
                    <p className="text-slate-500 mb-6">There is no salary record available for {month || 'this month'}.</p>
                    <Button onClick={onClose} className="w-full">Close</Button>
                </div>
            </div>
        );
    }

    // Helper to safely parse JSON or return default
    const safeParse = (val, defaultVal = []) => {
        try {
            return typeof val === 'string' ? JSON.parse(val) : (val || defaultVal);
        } catch (e) {
            console.error("Parse error:", e);
            return defaultVal;
        }
    };

    const areaGroups = safeParse(data.Area_Groups);
    const repeatTargets = safeParse(data.Repeat_Orders_Targets);
    const repeatAchieved = safeParse(data.Repeat_Orders);
    const repeatEarnings = safeParse(data.Repeat_Order_Earning);

    const newOrderEarnings = safeParse(data.New_Order_Earning);
    const newOrdersAbove40k = data.New_Orders_above_40k || 0;
    const newOrders20kTo40k = data.New_Orders_between_20_40k || 0;
    const newOrdersBelow20k = data.New_Orders_below_20k || 0;

    // Calculate rewards per bucket (Earning / Count) - avoid division by zero
    const getReward = (earning, count) => count > 0 ? earning / count : 0;

    const rewardAbove40k = getReward(newOrderEarnings[0] || 0, newOrdersAbove40k);
    const reward20kTo40k = getReward(newOrderEarnings[1] || 0, newOrders20kTo40k);
    const rewardBelow20k = getReward(newOrderEarnings[2] || 0, newOrdersBelow20k);

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-200">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Salary Details</h2>
                        <p className="text-sm text-slate-500">For {month}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
                        <X size={20} />
                    </button>
                </div>

                <div className="flex-1 overflow-auto p-6 space-y-8">
                    {/* Repeat Order Earnings */}
                    <section>
                        <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
                            <RefreshCw size={16} className="text-blue-600" />
                            Repeat Order Earnings
                        </h3>
                        <div className="bg-slate-50 rounded-lg border border-slate-200 overflow-hidden">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left whitespace-nowrap">
                                    <thead className="bg-slate-100 text-slate-600 font-medium border-b border-slate-200">
                                        <tr>
                                            <th className="px-2 py-2">Group</th>
                                            <th className="px-2 py-2 text-right">Progress</th>
                                            <th className="px-2 py-2 text-right">Calculation</th>
                                            <th className="px-2 py-2 text-right">Earning</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-200">
                                        {areaGroups.map((group, idx) => {
                                            const target = repeatTargets[idx] || 0;
                                            const achieved = repeatAchieved[idx] || 0;
                                            const earning = repeatEarnings[idx] || 0;
                                            const groupName = areaGroupNames[group] || `Group ${group} `;

                                            return (
                                                <tr key={idx}>
                                                    <td className="px-2 py-2 font-medium text-slate-700">{groupName}</td>
                                                    <td className="px-2 py-2 text-right">
                                                        <span className="font-semibold">{achieved}</span>
                                                        <span className="text-slate-400">/</span>
                                                        <span>{target}</span>
                                                    </td>
                                                    <td className="px-2 py-2 text-right text-slate-500 font-mono text-[10px]">
                                                        ({achieved}/{target}) * 6000
                                                    </td>
                                                    <td className="px-2 py-2 text-right font-bold text-green-600">
                                                        ₹{earning.toLocaleString('en-IN')}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="bg-slate-50 font-bold border-t border-slate-300">
                                            <td className="px-2 py-2" colSpan={2}>Total</td>
                                            <td className="px-2 py-2"></td>
                                            <td className="px-2 py-2 text-right text-green-700">
                                                ₹{repeatEarnings.reduce((a, b) => a + b, 0).toLocaleString('en-IN')}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    </section>

                    {/* New Order Earnings */}
                    <section>
                        <h3 className="text-sm font-semibold text-slate-800 mb-2 flex items-center gap-2">
                            <Phone size={16} className="text-green-600" />
                            New Order Earnings
                        </h3>
                        <div className="grid grid-cols-3 gap-2">
                            {/* Above 40k */}
                            <div className="bg-green-50 rounded-lg p-2 border border-green-100">
                                <p className="text-[10px] font-bold text-green-800 uppercase mb-1 truncate">Above 40k</p>
                                <div className="flex flex-col mb-1">
                                    <span className="text-lg font-bold text-green-700 leading-none">{newOrdersAbove40k}</span>
                                    <span className="text-[10px] text-green-600">orders</span>
                                </div>
                                <div className="text-[10px] text-green-800 border-t border-green-200 pt-1">
                                    <div className="flex justify-between">
                                        <span>₹{rewardAbove40k}</span>
                                        <span className="font-bold">₹{(newOrderEarnings[0] || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* 20k - 40k */}
                            <div className="bg-blue-50 rounded-lg p-2 border border-blue-100">
                                <p className="text-[10px] font-bold text-blue-800 uppercase mb-1 truncate">20k - 40k</p>
                                <div className="flex flex-col mb-1">
                                    <span className="text-lg font-bold text-blue-700 leading-none">{newOrders20kTo40k}</span>
                                    <span className="text-[10px] text-blue-600">orders</span>
                                </div>
                                <div className="text-[10px] text-blue-800 border-t border-blue-200 pt-1">
                                    <div className="flex justify-between">
                                        <span>₹{reward20kTo40k}</span>
                                        <span className="font-bold">₹{(newOrderEarnings[1] || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Below 20k */}
                            <div className="bg-orange-50 rounded-lg p-2 border border-orange-100">
                                <p className="text-[10px] font-bold text-orange-800 uppercase mb-1 truncate">Below 20k</p>
                                <div className="flex flex-col mb-1">
                                    <span className="text-lg font-bold text-orange-700 leading-none">{newOrdersBelow20k}</span>
                                    <span className="text-[10px] text-orange-600">orders</span>
                                </div>
                                <div className="text-[10px] text-orange-800 border-t border-orange-200 pt-1">
                                    <div className="flex justify-between">
                                        <span>₹{rewardBelow20k}</span>
                                        <span className="font-bold">₹{(newOrderEarnings[2] || 0).toLocaleString('en-IN')}</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                        <div className="mt-2 text-right font-bold text-slate-700 text-xs">
                            Total New: <span className="text-green-600">₹{newOrderEarnings.reduce((a, b) => a + b, 0).toLocaleString('en-IN')}</span>
                        </div>
                    </section>

                    {/* Grand Total */}
                    <div className="flex justify-between items-center bg-slate-800 text-white p-4 rounded-lg shadow-md">
                        <span className="text-lg font-medium">Total Monthly Earnings</span>
                        <span className="text-2xl font-bold">₹{data.Total_Earnings?.toLocaleString('en-IN')}</span>
                    </div>

                </div>
            </div>
        </div>
    );
};

const viewCache = {
    salaryData: null,
    areaGroupNames: {},
    todoList: [],
    availableAreaGroups: [],
    availableSalesStatuses: [],
    userEmail: null,
    timestamp: 0
};



const TelecallerView = ({ onBack, user, teamId, onLogout, getHeaders, getUrl }) => {
    // Initialize state from cache
    const [salaryData, setSalaryData] = useState(viewCache.salaryData);
    const [areaGroupNames, setAreaGroupNames] = useState(viewCache.areaGroupNames);
    const [availableSalesStatuses, setAvailableSalesStatuses] = useState(viewCache.availableSalesStatuses);
    const [availableAreaGroups, setAvailableAreaGroups] = useState(viewCache.availableAreaGroups);
    const [todoList, setTodoList] = useState(viewCache.todoList);

    // UI State
    const [loadingSalary, setLoadingSalary] = useState(!viewCache.salaryData);
    const [loadingTodos, setLoadingTodos] = useState(viewCache.todoList.length === 0);
    const [selectedAreaGroup, setSelectedAreaGroup] = useState('');
    const [selectedSalesStatus, setSelectedSalesStatus] = useState('');
    const [showSalaryModal, setShowSalaryModal] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [error, setError] = useState(null);

    const navigate = useNavigate();


    // Hardcoded for now, same as FactoryView
    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

    const fetchSalary = async () => {
        if (!user?.email) {
            setError("User email not found");
            return;
        }

        setLoadingSalary(true);
        setError(null);
        try {
            const headers = await getHeaders();

            // Calculate start of current month in seconds
            const now = new Date();
            const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
            const startOfMonthTimestamp = startOfMonth.getTime() / 1000;

            const sqlQuery = `
SELECT *
    FROM Telecaller_Salaries ts
        JOIN Team t ON t.id = ts.Telecaller
        WHERE Month = ?
    AND t.Email = ?
        `;

            const url = getUrl(`/api/docs/${DOC_ID}/sql`);
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    ...headers,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    sql: sqlQuery,
                    args: [
                        startOfMonthTimestamp,
                        "eswarmedhari2662@gmail.com"
                        // user.email
                    ]
                })
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch salary: ${response.statusText}`);
            }

            const data = await response.json();
            console.log("Salary Fetch Response:", data);

            if (data.records && data.records.length > 0) {
                const salaryRecord = data.records[0].fields;
                setSalaryData(salaryRecord);
                viewCache.salaryData = salaryRecord;

                // Fetch Area Group Names
                try {
                    const areaGroupIds = typeof salaryRecord.Area_Groups === 'string'
                        ? JSON.parse(salaryRecord.Area_Groups)
                        : (salaryRecord.Area_Groups || []);

                    if (areaGroupIds.length > 0) {
                        const placeholders = areaGroupIds.map(() => '?').join(',');
                        const groupsQuery = `SELECT id, Area_Group FROM Area_Groups WHERE id IN (${placeholders})`;

                        const groupsResponse = await fetch(url, {
                            method: 'POST',
                            headers: {
                                ...headers,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify({
                                sql: groupsQuery,
                                args: areaGroupIds
                            })
                        });

                        if (groupsResponse.ok) {
                            const groupsData = await groupsResponse.json();
                            const namesMap = {};
                            groupsData.records.forEach(record => {
                                namesMap[record.fields.id] = record.fields.Area_Group;
                            });

                            setAreaGroupNames(prev => {
                                const newMap = { ...prev, ...namesMap };
                                viewCache.areaGroupNames = newMap;
                                return newMap;
                            });
                        }
                    }
                } catch (e) {
                    console.error("Error fetching area groups:", e);
                }

            } else {
                console.warn("No records found for salary");
                setSalaryData(null);
                viewCache.salaryData = null;
                // Don't clear area group names here as they might be used by todos
            }

        } catch (err) {
            console.error("Salary Fetch Error:", err);
            setError(err.message);
        } finally {
            setLoadingSalary(false);
        }
    };

    const fetchTodos = async () => {
        console.log('fetchTodos called, teamId:', teamId);
        if (!teamId) {
            console.warn('Cannot fetch todos: teamId is required');
            setLoadingTodos(false);
            return;
        }

        setLoadingTodos(true);
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);

            // Fetch Todo List
            const todoQuery = `
                SELECT c.id, Shop_Name, Sales_Status, Days_Since_Last_Order, c.Area_Group, c.Customer_ID, Mobile_Number
                FROM Customers c 
                JOIN Area_Groups ag ON ag.id = c.Area_Group 
                WHERE Responsible_Sales_Team = 'TELECALLER' 
                AND (ag.Telecaller LIKE '%[${teamId}]%' OR ag.Telecaller LIKE '%[${teamId},%' OR ag.Telecaller LIKE '%,${teamId}]%' OR ag.Telecaller LIKE '%,${teamId},%')
                LIMIT 50
            `;

            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: todoQuery, args: [] })
            });

            if (response.ok) {
                const data = await response.json();
                console.log('Todos fetch response:', data);
                const records = data.records.map(r => r.fields);
                setTodoList(records);
                viewCache.todoList = records;

                // Extract unique filters
                const groups = new Set();
                const statuses = new Set();
                const groupIds = new Set();

                records.forEach(r => {
                    if (r.Sales_Status) statuses.add(r.Sales_Status);
                    if (r.Area_Group) groupIds.add(r.Area_Group);
                });

                const sortedStatuses = Array.from(statuses).sort();
                setAvailableSalesStatuses(sortedStatuses);
                viewCache.availableSalesStatuses = sortedStatuses;

                // Fetch Area Group Names for Todos if not already fetched
                if (groupIds.size > 0) {
                    const idsToFetch = Array.from(groupIds).filter(id => !areaGroupNames[id]);
                    if (idsToFetch.length > 0) {
                        const placeholders = idsToFetch.map(() => '?').join(',');
                        const groupsQuery = `SELECT id, Area_Group FROM Area_Groups WHERE id IN (${placeholders})`;
                        const groupsResponse = await fetch(url, {
                            method: 'POST',
                            headers: { ...headers, 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sql: groupsQuery, args: idsToFetch })
                        });

                        if (groupsResponse.ok) {
                            const groupsData = await groupsResponse.json();
                            setAreaGroupNames(prev => {
                                const newMap = { ...prev };
                                groupsData.records.forEach(record => {
                                    newMap[record.fields.id] = record.fields.Area_Group;
                                });
                                viewCache.areaGroupNames = newMap;
                                return newMap;
                            });
                        }
                    }
                }

                // Update available area groups for filter based on fetched names
                const groupIdsArray = Array.from(groupIds);
                setAvailableAreaGroups(groupIdsArray);
                viewCache.availableAreaGroups = groupIdsArray;
            } else {
                const errorText = await response.text();
                console.error('Todos fetch failed:', response.status, errorText);
            }

        } catch (e) {
            console.error("Error fetching todos:", e);
        } finally {
            setLoadingTodos(false);
        }
    };

    useEffect(() => {
        console.log('TelecallerView useEffect triggered, user:', user?.email, 'teamId:', teamId);

        if (user?.email && user.email !== viewCache.userEmail) {
            // User changed, clear cache and fetch fresh
            viewCache.salaryData = null;
            viewCache.todoList = [];
            viewCache.areaGroupNames = {};
            viewCache.availableAreaGroups = [];
            viewCache.availableSalesStatuses = [];
            viewCache.userEmail = user.email;

            fetchSalary();
        } else if (user?.email) {
            // User same, check if we need to fetch salary
            if (!viewCache.salaryData) fetchSalary();
        }

        // Always try to fetch todos when teamId is available and we don't have cached data
        console.log('Checking if should fetch todos - teamId:', teamId, 'cache length:', viewCache.todoList.length);
        if (teamId && viewCache.todoList.length === 0) {
            fetchTodos();
        }
    }, [user, teamId]);

    // Format current month for display
    const currentMonth = new Date().toLocaleString('default', { month: 'short', year: '2-digit' });

    // Filtered Todos
    const filteredTodos = todoList.filter(todo => {
        const groupMatch = !selectedAreaGroup || String(todo.Area_Group) === selectedAreaGroup;
        const statusMatch = !selectedSalesStatus || todo.Sales_Status === selectedSalesStatus;
        return groupMatch && statusMatch;
    });

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-7xl mx-auto flex flex-col gap-3">
                    <div className="flex justify-between items-center">
                        <div className="flex items-center gap-3">
                            <Button variant="ghost" onClick={onBack} className="!px-2">
                                <ArrowLeft size={20} />
                            </Button>
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center text-white">
                                    <Phone size={18} />
                                </div>
                                <h1 className="font-bold text-slate-800">Telecaller View</h1>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => { fetchSalary(); fetchTodos(); }}
                                disabled={loadingSalary || loadingTodos}
                                className="!px-3"
                            >
                                <RefreshCw size={18} className={(loadingSalary || loadingTodos) ? "animate-spin" : ""} />
                            </Button>
                            <Button
                                variant="secondary"
                                onClick={() => setShowSettings(true)}
                                className="!px-3"
                            >
                                <Settings size={18} />
                            </Button>
                        </div>
                    </div>

                    {/* Salary Section (Moved here) */}
                    <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white border-none cursor-pointer hover:shadow-lg transition-shadow"
                        onClick={() => {
                            console.log("Salary Card Clicked. Data:", salaryData);
                            setShowSalaryModal(true);
                        }}
                    >
                        <div className="p-3 flex flex-wrap items-center gap-2">
                            {/* Main Salary - Full width on very small, auto on larger */}
                            <div className="flex items-center gap-2 mr-auto">
                                <div className="bg-white/20 p-1.5 rounded-lg">
                                    <IndianRupee size={18} className="text-white" />
                                </div>
                                <div>
                                    <p className="text-[10px] text-blue-100 leading-none mb-0.5 flex items-center gap-1">
                                        Salary <span className="bg-white/20 px-1 rounded text-[8px]">{currentMonth}</span>
                                    </p>
                                    <p className="font-bold text-lg leading-none">
                                        {loadingSalary ? (
                                            <span className="animate-pulse">...</span>
                                        ) : salaryData ? (
                                            salaryData.Total_Earnings?.toLocaleString('en-IN') || 0
                                        ) : (
                                            "0"
                                        )}
                                    </p>
                                </div>
                            </div>

                            {/* Stats Chips */}
                            <div className="flex flex-wrap gap-2">
                                {/* New Orders Chip */}
                                <div className="bg-white/10 px-2 py-1 rounded border border-white/10 flex items-center gap-1.5">
                                    <span className="text-[10px] text-blue-100 uppercase tracking-wider">New</span>
                                    <span className="font-bold text-sm">
                                        {salaryData ? (JSON.parse(salaryData.New_Orders || '[]').length) : 0}
                                    </span>
                                </div>

                                {/* Area Groups Chips */}
                                {salaryData && (() => {
                                    try {
                                        const groups = typeof salaryData.Area_Groups === 'string' ? JSON.parse(salaryData.Area_Groups) : (salaryData.Area_Groups || []);
                                        const targets = typeof salaryData.Repeat_Orders_Targets === 'string' ? JSON.parse(salaryData.Repeat_Orders_Targets) : (salaryData.Repeat_Orders_Targets || []);
                                        const achieved = typeof salaryData.Repeat_Orders === 'string' ? JSON.parse(salaryData.Repeat_Orders) : (salaryData.Repeat_Orders || []);

                                        return groups.map((group, idx) => {
                                            const name = areaGroupNames[group] || `G${group}`;
                                            // Truncate name to first word or 3 chars if it's long, to keep it compact
                                            const shortName = name.split(' ')[0].substring(0, 4);

                                            return (
                                                <div key={idx} className="bg-white/10 px-2 py-1 rounded border border-white/10 flex items-center gap-1.5">
                                                    <span className="text-[10px] text-blue-100 uppercase tracking-wider" title={name}>{shortName}</span>
                                                    <span className="font-bold text-sm">
                                                        {achieved[idx] || 0}<span className="text-xs opacity-60 font-normal">/{targets[idx] || 0}</span>
                                                    </span>
                                                </div>
                                            );
                                        });
                                    } catch (e) {
                                        return null;
                                    }
                                })()}
                            </div>
                        </div>
                    </Card>

                    {/* Filters */}
                    <div className="flex gap-3">
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Area Group</label>
                            <select
                                value={selectedAreaGroup}
                                onChange={(e) => setSelectedAreaGroup(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none bg-white text-sm"
                            >
                                <option value="">All Areas</option>
                                {availableAreaGroups.map(id => (
                                    <option key={id} value={id}>
                                        {areaGroupNames[id] || `Group ${id}`}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div className="flex-1">
                            <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Status</label>
                            <select
                                value={selectedSalesStatus}
                                onChange={(e) => setSelectedSalesStatus(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none bg-white text-sm"
                            >
                                <option value="">All Statuses</option>
                                {availableSalesStatuses.map(status => (
                                    <option key={status} value={status}>{status}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 p-4 overflow-auto">
                <div className="max-w-7xl mx-auto space-y-4">
                    {error && (
                        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Error loading salary</p>
                                <p className="text-sm">{error}</p>
                            </div>
                        </div>
                    )}

                    {/* Todo List */}
                    {loadingTodos ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                            <Loader2 size={32} className="animate-spin mb-2 text-blue-600" />
                            <p>Loading todo list...</p>
                        </div>
                    ) : filteredTodos.length === 0 ? (
                        <div className="text-center py-10 text-slate-500">
                            <p>No customers found matching filters.</p>
                        </div>
                    ) : (
                        <div className="grid gap-3">
                            {filteredTodos.map((todo, idx) => (
                                <CustomerCard
                                    key={idx}
                                    shopName={todo.Shop_Name}
                                    salesStatus={todo.Sales_Status}
                                    customerId={todo.Customer_ID} // Telecaller view uses "Customer ID" label as per previous code
                                    mobileNumber={todo.Mobile_Number}
                                    daysSinceLastOrder={todo.Days_Since_Last_Order}
                                    primaryInfo={areaGroupNames[todo.Area_Group] || `Group ${todo.Area_Group}`} // Telecaller uses Area Group
                                    onClick={() => setSelectedCustomerId(todo.Customer_ID)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Customer View Modal */}
            {selectedCustomerId && (
                <div className="fixed inset-0 z-50 bg-white overflow-auto animate-in slide-in-from-right duration-300">
                    <TelecallerCustomerView
                        customerId={selectedCustomerId}
                        customerRowId={todoList.find(t => t.Customer_ID === selectedCustomerId)?.id}
                        shopName={todoList.find(t => t.Customer_ID === selectedCustomerId)?.Shop_Name}
                        onBack={() => setSelectedCustomerId(null)}
                        user={user}
                        getHeaders={getHeaders}
                        getUrl={getUrl}
                    />
                </div>
            )}

            {showSalaryModal && (
                <SalaryDetailsModal
                    data={salaryData}
                    areaGroupNames={areaGroupNames}
                    month={currentMonth}
                    onClose={() => setShowSalaryModal(false)}
                />
            )}

            {showSettings && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowSettings(false)}>
                    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-xl font-bold text-slate-800">Settings</h2>
                            <button onClick={() => setShowSettings(false)} className="text-slate-400 hover:text-slate-700">
                                <X size={20} />
                            </button>
                        </div>

                        {/* User Info */}
                        <div className="flex items-center gap-3 pb-4 border-b border-slate-100 mb-4">
                            {user?.picture ? (
                                <img src={user.picture} alt={user.name} className="w-12 h-12 rounded-full" />
                            ) : (
                                <div className="w-12 h-12 bg-slate-200 rounded-full flex items-center justify-center text-slate-500">
                                    <User size={24} />
                                </div>
                            )}
                            <div className="overflow-hidden flex-1">
                                <p className="font-medium text-slate-900 truncate">{user?.name}</p>
                                <p className="text-sm text-slate-500 truncate">{user?.email}</p>
                            </div>
                        </div>

                        <Button
                            variant="secondary"
                            className="w-full"
                            onClick={onLogout}
                            icon={LogOut}
                        >
                            Logout
                        </Button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default TelecallerView;
