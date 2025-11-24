import React, { useState, useEffect } from 'react';
import { ArrowLeft, Settings, Phone, Loader2, AlertCircle, RefreshCw, IndianRupee, X, User, LogOut } from 'lucide-react';

const Button = ({ onClick, children, variant = "primary", disabled = false, className = "", icon: Icon }) => {
    const baseStyle = "flex items-center justify-center gap-2 px-4 py-2 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed";
    const variants = {
        primary: "bg-green-600 text-white hover:bg-green-700",
        secondary: "bg-slate-100 text-slate-700 hover:bg-slate-200",
        outline: "border border-slate-200 text-slate-600 hover:bg-slate-50",
        ghost: "text-slate-600 hover:bg-slate-100"
    };

    return (
        <button
            onClick={onClick}
            disabled={disabled}
            className={`${baseStyle} ${variants[variant]} ${className}`}
        >
            {Icon && <Icon size={18} />}
            {children}
        </button>
    );
};

const Card = ({ children, className = "", ...props }) => (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`} {...props}>
        {children}
    </div>
);

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
                                            const groupName = areaGroupNames[group] || `Group ${group}`;

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

const TelecallerView = ({ onBack, user, onLogout, getHeaders, getUrl }) => {
    const [salaryData, setSalaryData] = useState(null);
    const [areaGroupNames, setAreaGroupNames] = useState({});
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [showSalaryModal, setShowSalaryModal] = useState(false);

    // Hardcoded for now, same as FactoryView
    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

    const fetchSalary = async () => {
        if (!user?.email) {
            setError("User email not found");
            return;
        }

        setLoading(true);
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
                            setAreaGroupNames(namesMap);
                        }
                    }
                } catch (e) {
                    console.error("Error fetching area groups:", e);
                }

            } else {
                console.warn("No records found for salary");
                setSalaryData(null);
                setAreaGroupNames({});
            }

        } catch (err) {
            console.error("Salary Fetch Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchSalary();
    }, [user]);

    // Format current month for display
    const currentMonth = new Date().toLocaleString('default', { month: 'short', year: '2-digit' });

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-7xl mx-auto flex justify-between items-center">
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
                            onClick={fetchSalary}
                            disabled={loading}
                            className="!px-3"
                        >
                            <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
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
            </header>

            {/* Sticky Salary Section */}
            <div className="sticky top-[65px] z-10 bg-slate-50 pt-4 px-4 pb-2 shadow-sm border-b border-slate-200/50 backdrop-blur-sm bg-opacity-90">
                <div className="max-w-7xl mx-auto">
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
                                        {loading ? (
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
                </div>
            </div>

            <main className="flex-1 p-4 overflow-auto">
                <div className="max-w-7xl mx-auto">
                    {error && (
                        <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
                            <AlertCircle size={18} className="mt-0.5 shrink-0" />
                            <div>
                                <p className="font-medium">Error loading salary</p>
                                <p className="text-sm">{error}</p>
                            </div>
                        </div>
                    )}

                    <div className="text-center py-10 text-slate-500">
                        <p>More telecaller features coming soon...</p>
                    </div>
                </div>
            </main>

            {showSalaryModal && (
                <SalaryDetailsModal
                    data={salaryData}
                    areaGroupNames={areaGroupNames}
                    month={currentMonth}
                    onClose={() => setShowSalaryModal(false)}
                />
            )}

            {/* We need to pass the SettingsModal from App.jsx or duplicate it here. 
          Since it's not exported, I'll assume for now we might need to export it or just omit it if not strictly required by the task.
          However, the user passed `onLogout` and `user`, so it's likely expected.
          For this task, I will focus on the Salary part. I'll add a placeholder for Settings if needed, 
          but ideally App.jsx handles the modal if I lift state, or I import it.
          
          Wait, I can't easily import SettingsModal if it's defined inside App.jsx and not exported.
          I'll leave the settings button working but maybe just log for now, OR I can copy the SettingsModal code since it's small.
          I'll copy it to be safe and self-contained.
      */}
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
