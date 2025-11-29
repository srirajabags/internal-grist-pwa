import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Phone, Search, Filter, AlertCircle, Loader2, LogOut, User, X, RefreshCw, Settings } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import CustomerCard from '../components/CustomerCard';
import SalesmanCustomerView from './SalesmanCustomerView';

const viewCache = {
    todoList: [],
    availableAreaGroups: [],
    availableSalesStatuses: [],
    availableCities: [],
    areaGroupNames: {},
    userEmail: null,
    timestamp: 0
};

const SalesmanView = ({ onBack, user, teamId, onLogout, getHeaders, getUrl }) => {
    // Initialize state from cache
    const [todoList, setTodoList] = useState(viewCache.todoList);
    const [areaGroupNames, setAreaGroupNames] = useState(viewCache.areaGroupNames);
    const [availableSalesStatuses, setAvailableSalesStatuses] = useState(viewCache.availableSalesStatuses);
    const [availableAreaGroups, setAvailableAreaGroups] = useState(viewCache.availableAreaGroups);
    const [availableCities, setAvailableCities] = useState(viewCache.availableCities);

    // UI State
    const [loadingTodos, setLoadingTodos] = useState(viewCache.todoList.length === 0);
    const [selectedAreaGroup, setSelectedAreaGroup] = useState('');
    const [selectedSalesStatus, setSelectedSalesStatus] = useState('');
    const [selectedCity, setSelectedCity] = useState('');
    const [showSettings, setShowSettings] = useState(false);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [error, setError] = useState(null);

    const navigate = useNavigate();

    // Hardcoded for now
    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

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
                SELECT c.id, Shop_Name, Sales_Status, Days_Since_Last_Order, c.Area_Group, c.Customer_ID, Mobile_Number, c.City, c.Latitude, c.Longitude
                FROM Customers c 
                JOIN Area_Groups ag ON ag.id = c.Area_Group 
                WHERE Responsible_Sales_Team = 'SALESMAN' 
                AND (ag.Salesman LIKE '%[${teamId}]%' OR ag.Salesman LIKE '%[${teamId},%' OR ag.Salesman LIKE '%,${teamId}]%' OR ag.Salesman LIKE '%,${teamId},%')
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
                const cities = new Set();
                const groupIds = new Set();

                records.forEach(r => {
                    if (r.Sales_Status) statuses.add(r.Sales_Status);
                    if (r.Area_Group) groupIds.add(r.Area_Group);
                    if (r.City) cities.add(r.City);
                });

                const sortedStatuses = Array.from(statuses).sort();
                setAvailableSalesStatuses(sortedStatuses);
                viewCache.availableSalesStatuses = sortedStatuses;

                const sortedCities = Array.from(cities).sort();
                setAvailableCities(sortedCities);
                viewCache.availableCities = sortedCities;

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
        if (user?.email && user.email !== viewCache.userEmail) {
            // User changed, clear cache
            viewCache.todoList = [];
            viewCache.areaGroupNames = {};
            viewCache.availableAreaGroups = [];
            viewCache.availableSalesStatuses = [];
            viewCache.availableCities = [];
            viewCache.userEmail = user.email;
        }

        // Always try to fetch todos when teamId is available and we don't have cached data
        if (teamId && viewCache.todoList.length === 0) {
            fetchTodos();
        }
    }, [user, teamId]);

    // Filtered Todos
    const filteredTodos = todoList.filter(todo => {
        const groupMatch = !selectedAreaGroup || String(todo.Area_Group) === selectedAreaGroup;
        const statusMatch = !selectedSalesStatus || todo.Sales_Status === selectedSalesStatus;
        const cityMatch = !selectedCity || todo.City === selectedCity;
        return groupMatch && statusMatch && cityMatch;
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
                                <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                                    <User size={18} />
                                </div>
                                <h1 className="font-bold text-slate-800">Salesman View</h1>
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button
                                variant="secondary"
                                onClick={() => fetchTodos()}
                                disabled={loadingTodos}
                                className="!px-3"
                            >
                                <RefreshCw size={18} className={loadingTodos ? "animate-spin" : ""} />
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

                    {/* Filters */}
                    <div className="flex gap-3 overflow-x-auto pb-1">
                        <div className="min-w-[120px]">
                            <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">City</label>
                            <select
                                value={selectedCity}
                                onChange={(e) => setSelectedCity(e.target.value)}
                                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none bg-white text-sm"
                            >
                                <option value="">All Cities</option>
                                {availableCities.map(city => (
                                    <option key={city} value={city}>{city}</option>
                                ))}
                            </select>
                        </div>
                        <div className="min-w-[120px]">
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
                    {/* Todo List */}
                    {loadingTodos ? (
                        <div className="flex flex-col items-center justify-center py-10 text-slate-400">
                            <Loader2 size={32} className="animate-spin mb-2 text-indigo-600" />
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
                                    customerId={todo.Customer_ID}
                                    mobileNumber={todo.Mobile_Number}
                                    daysSinceLastOrder={todo.Days_Since_Last_Order}
                                    primaryInfo={todo.City}
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
                    <SalesmanCustomerView
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

export default SalesmanView;
