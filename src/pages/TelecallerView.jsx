import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Settings, Phone, Loader2, AlertCircle, RefreshCw, IndianRupee, X, User, LogOut, ChevronDown, ChevronUp, Calendar } from 'lucide-react';
import Card from '../components/Card';
import Button from '../components/Button';
import TelecallerCustomerView from './TelecallerCustomerView';
import CustomerCard from '../components/CustomerCard';

const SalaryDetailsModal = ({ data, areaGroupNames = {}, month, onClose, onMonthChange, selectedMonthTimestamp }) => {
    console.log("SalaryDetailsModal rendered with data:", data);

    // Generate last 12 months for dropdown
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        months.push({
            label: d.toLocaleString('default', { month: 'short', year: '2-digit' }),
            timestamp: d.getTime() / 1000
        });
    }

    const [showMonthDropdown, setShowMonthDropdown] = useState(false);
    const dropdownRef = useRef(null);

    useEffect(() => {
        const handleClickOutside = (event) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
                setShowMonthDropdown(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    if (!data) {
        return (
            <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
                <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center" onClick={e => e.stopPropagation()}>
                    <AlertCircle size={48} className="mx-auto mb-4 text-slate-300" />
                    <h2 className="text-xl font-bold text-slate-800 mb-2">No Salary Data</h2>
                    <p className="text-slate-500 mb-6">There is no salary record available for {month || 'this month'}.</p>
                    <div className="flex gap-2">
                        <div className="relative flex-1" ref={dropdownRef}>
                            <button
                                onClick={() => setShowMonthDropdown(!showMonthDropdown)}
                                className="w-full flex items-center justify-between px-3 py-2 bg-slate-100 rounded-lg text-sm font-medium text-slate-700 hover:bg-slate-200 transition-colors"
                            >
                                <span className="flex items-center gap-2">
                                    <Calendar size={16} />
                                    {month}
                                </span>
                                <ChevronDown size={16} />
                            </button>

                            {showMonthDropdown && (
                                <div className="absolute bottom-full left-0 right-0 mb-2 bg-white rounded-lg shadow-xl border border-slate-200 max-h-48 overflow-y-auto z-50">
                                    {months.map((m) => (
                                        <button
                                            key={m.timestamp}
                                            onClick={() => {
                                                onMonthChange(m.timestamp);
                                                setShowMonthDropdown(false);
                                            }}
                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${selectedMonthTimestamp === m.timestamp ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'}`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <Button onClick={onClose} className="flex-1">Close</Button>
                    </div>
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

    // Section 1: Regular Repeat
    const repeatTargets = safeParse(data.Regular_Repeat_Orders_Targets); // Updated field name
    const repeatAchieved = safeParse(data.Regular_Repeat_Orders); // Updated field name
    const repeatEarnings = safeParse(data.Regular_Repeat_Orders_Earnings); // Updated field name


    // Section 2: Non-Regular Repeat
    const nonRegEarnings = safeParse(data.Non_Regular_Repeat_Orders_Earnings); // Array of arrays
    const nonRegAbove40k = safeParse(data.Non_Regular_Repeat_Orders_above_40k); // Array of arrays
    const nonReg20kTo40k = safeParse(data.Non_Regular_Repeat_Orders_between_20_40k); // Array of arrays
    const nonReg5kTo20k = safeParse(data.Non_Regular_Repeat_Orders_between_5_20k); // NEW
    const nonRegBelow5k = safeParse(data.Non_Regular_Repeat_Orders_below_5k); // NEW

    // Section 3: New Orders
    const newOrderEarnings = safeParse(data.New_Orders_Earnings); // Array of arrays
    const newOrdersAbove40k = safeParse(data.New_Orders_above_40k); // Array of arrays
    const newOrders20kTo40k = safeParse(data.New_Orders_between_20_40k); // Array of arrays
    const newOrders5kTo20k = safeParse(data.New_Orders_between_5_20k); // NEW
    const newOrdersBelow5k = safeParse(data.New_Orders_below_5k); // NEW

    // Total Orders Values Breakdown
    const newOrdersValues = safeParse(data.New_Orders_Values);
    const regularRepeatValues = safeParse(data.Regular_Repeat_Orders_Values);
    const nonRegularRepeatValues = safeParse(data.Non_Regular_Repeat_Orders_Values);

    // New Fields for Calculation & Penalties
    const potentialEarnings = safeParse(data.Potential_Order_Earnings_Breakup);
    const penaltyRate = data.Penalty_for_Delayed_Regular_Customer || 0;
    const totalPenalties = data.Total_Penalties || 0;
    const delayedRegularCustomersPenalties = safeParse(data.Delayed_Regular_Customers_Penalties); // Array
    const delayedRegularCustomersCount = safeParse(data.Delayed_Regular_Customers); // Array

    // Calculate Gross Earnings (Sum of all earning components)
    const totalRegularEarnings = repeatEarnings.reduce((a, b) => a + (b || 0), 0);
    const totalNonRegularEarnings = nonRegEarnings.flat().reduce((a, b) => a + (b || 0), 0);
    const totalNewEarnings = newOrderEarnings.flat().reduce((a, b) => a + (b || 0), 0);
    const grossEarnings = totalRegularEarnings + totalNonRegularEarnings + totalNewEarnings;

    // Helper: Get Regular Rate (assuming first bucket [0, rate])
    const regularRate = potentialEarnings?.REGULAR?.[0]?.[1] || 0;

    // State for collapsible sections
    const [expandedSections, setExpandedSections] = React.useState({
        regularRepeat: false,
        nonRegularRepeat: false,
        newOrders: false,
        penalties: false
    });

    const toggleSection = (section) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    const toggleAllSections = () => {
        const allExpanded = Object.values(expandedSections).every(v => v);
        const newState = !allExpanded;
        setExpandedSections({
            regularRepeat: newState,
            nonRegularRepeat: newState,
            newOrders: newState,
            penalties: newState
        });
    };




    // Helper Component for Group Earnings Card
    const GroupEarningsCard = ({ groupName, earnings, countsAbove40k, counts20kTo40k, counts5kTo20k, countsBelow5k, totalEarning }) => {
        // Calculate rewards per bucket (Earning / Count) - avoid division by zero
        // Note: earnings is [above40k, 20k-40k, 5k-20k, below5k]
        const getReward = (earning, count) => count > 0 ? earning / count : 0;

        const rewardAbove40k = getReward(earnings[0] || 0, countsAbove40k);
        const reward20kTo40k = getReward(earnings[1] || 0, counts20kTo40k);
        const reward5kTo20k = getReward(earnings[2] || 0, counts5kTo20k);
        const rewardBelow5k = getReward(earnings[3] || 0, countsBelow5k);

        return (
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-3 py-2 border-b border-slate-100 flex justify-between items-center">
                    <span className="font-semibold text-slate-700 text-sm">{groupName}</span>
                    <span className="font-bold text-green-600 text-sm">₹{totalEarning.toLocaleString('en-IN')}</span>
                </div>
                <div className="p-2 grid grid-cols-4 gap-2">
                    {/* Above 40k */}
                    <div className="bg-green-50 rounded p-1.5 border border-green-100 flex flex-col justify-between">
                        <div className="text-[9px] font-bold text-green-800 uppercase leading-tight mb-1">Above 40k</div>
                        <div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-base font-bold text-green-700 leading-none">{countsAbove40k}</span>
                                <span className="text-[9px] text-green-600">orders</span>
                            </div>
                            <div className="flex justify-between items-end mt-1 pt-1 border-t border-green-200/50">
                                <span className="text-[9px] text-green-600">₹{Math.round(rewardAbove40k)}</span>
                                <span className="text-[10px] font-bold text-green-800">₹{(earnings[0] || 0).toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </div>

                    {/* 20k - 40k */}
                    <div className="bg-blue-50 rounded p-1.5 border border-blue-100 flex flex-col justify-between">
                        <div className="text-[9px] font-bold text-blue-800 uppercase leading-tight mb-1">20k - 40k</div>
                        <div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-base font-bold text-blue-700 leading-none">{counts20kTo40k}</span>
                                <span className="text-[9px] text-blue-600">orders</span>
                            </div>
                            <div className="flex justify-between items-end mt-1 pt-1 border-t border-blue-200/50">
                                <span className="text-[9px] text-blue-600">₹{Math.round(reward20kTo40k)}</span>
                                <span className="text-[10px] font-bold text-blue-800">₹{(earnings[1] || 0).toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </div>

                    {/* 5k - 20k */}
                    <div className="bg-orange-50 rounded p-1.5 border border-orange-100 flex flex-col justify-between">
                        <div className="text-[9px] font-bold text-orange-800 uppercase leading-tight mb-1">5k - 20k</div>
                        <div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-base font-bold text-orange-700 leading-none">{counts5kTo20k}</span>
                                <span className="text-[9px] text-orange-600">orders</span>
                            </div>
                            <div className="flex justify-between items-end mt-1 pt-1 border-t border-orange-200/50">
                                <span className="text-[9px] text-orange-600">₹{Math.round(reward5kTo20k)}</span>
                                <span className="text-[10px] font-bold text-orange-800">₹{(earnings[2] || 0).toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </div>

                    {/* Below 5k */}
                    <div className="bg-slate-50 rounded p-1.5 border border-slate-200 flex flex-col justify-between">
                        <div className="text-[9px] font-bold text-slate-800 uppercase leading-tight mb-1">Below 5k</div>
                        <div>
                            <div className="flex items-baseline gap-1">
                                <span className="text-base font-bold text-slate-700 leading-none">{countsBelow5k}</span>
                                <span className="text-[9px] text-slate-600">orders</span>
                            </div>
                            <div className="flex justify-between items-end mt-1 pt-1 border-t border-slate-200/50">
                                <span className="text-[9px] text-slate-600">₹{Math.round(rewardBelow5k)}</span>
                                <span className="text-[10px] font-bold text-slate-800">₹{(earnings[3] || 0).toLocaleString('en-IN')}</span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        );
    };

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-slate-50">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Salary Details</h2>
                        <div className="relative mt-1" ref={dropdownRef}>
                            <button
                                onClick={() => setShowMonthDropdown(!showMonthDropdown)}
                                className="flex items-center gap-1.5 text-sm font-medium text-slate-600 hover:text-slate-900 bg-white px-2 py-1 rounded border border-slate-200 hover:border-slate-300 transition-all"
                            >
                                <Calendar size={14} />
                                {month}
                                <ChevronDown size={14} />
                            </button>

                            {showMonthDropdown && (
                                <div className="absolute top-full left-0 mt-1 w-40 bg-white rounded-lg shadow-xl border border-slate-200 max-h-60 overflow-y-auto z-50">
                                    {months.map((m) => (
                                        <button
                                            key={m.timestamp}
                                            onClick={() => {
                                                onMonthChange(m.timestamp);
                                                setShowMonthDropdown(false);
                                            }}
                                            className={`w-full text-left px-4 py-2 text-sm hover:bg-slate-50 transition-colors ${selectedMonthTimestamp === m.timestamp ? 'bg-blue-50 text-blue-600 font-medium' : 'text-slate-700'}`}
                                        >
                                            {m.label}
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={toggleAllSections}
                            className="flex items-center gap-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white px-2 py-1 rounded border border-slate-200 hover:border-slate-300 transition-all"
                        >
                            {Object.values(expandedSections).every(v => v) ? (
                                <>
                                    <ChevronUp size={14} />
                                    Collapse All
                                </>
                            ) : (
                                <>
                                    <ChevronDown size={14} />
                                    Expand All
                                </>
                            )}
                        </button>
                        <button onClick={onClose} className="text-slate-400 hover:text-slate-700 bg-white rounded-full p-1 hover:bg-slate-100 transition-colors">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto p-4 space-y-6 bg-slate-50/50">
                    {/* 0. Sales Performance Summary */}
                    <section>
                        <h3 className="text-sm font-bold text-slate-700 mb-3 flex items-center gap-2 uppercase tracking-wider">
                            <div className="p-1 bg-indigo-100 rounded text-indigo-600"><IndianRupee size={14} /></div>
                            Sales Performance
                        </h3>
                        <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                            {/* Hero: Total Orders */}
                            <div className="p-4 text-center border-b border-slate-100 bg-gradient-to-b from-white to-slate-50">
                                <span className="text-xs uppercase font-bold text-slate-400 tracking-widest mb-1 block">Orders Value</span>
                                <span className="text-3xl font-black text-slate-800 tracking-tight">
                                    ₹{(data.Total_Orders_Value || 0).toLocaleString('en-IN')}
                                </span>
                            </div>

                            {/* Contributors: Regular, Non-Regular, New */}
                            <div className="grid grid-cols-3 divide-x divide-slate-100">
                                <div className="p-3 text-center">
                                    <span className="text-[10px] uppercase font-bold text-blue-600/70 tracking-wider mb-1 block">Regular</span>
                                    <span className="text-lg font-bold text-blue-600">
                                        ₹{regularRepeatValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                    </span>
                                </div>
                                <div className="p-3 text-center">
                                    <span className="text-[10px] uppercase font-bold text-purple-600/70 tracking-wider mb-1 block">Non-Reg</span>
                                    <span className="text-lg font-bold text-purple-600">
                                        ₹{nonRegularRepeatValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                    </span>
                                </div>
                                <div className="p-3 text-center">
                                    <span className="text-[10px] uppercase font-bold text-green-600/70 tracking-wider mb-1 block">New</span>
                                    <span className="text-lg font-bold text-green-600">
                                        ₹{newOrdersValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Order Values Breakdown Table */}
                        <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm mt-3">
                            <div className="overflow-x-auto">
                                <table className="w-full text-xs text-left whitespace-nowrap">
                                    <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                                        <tr>
                                            <th className="px-3 py-2">Group</th>
                                            <th className="px-3 py-2 text-right">Regular</th>
                                            <th className="px-3 py-2 text-right">Non-Regular</th>
                                            <th className="px-3 py-2 text-right">New</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {areaGroups.map((group, idx) => {
                                            const groupName = areaGroupNames[group] || `Group ${group}`;
                                            const regularVal = regularRepeatValues[idx] || 0;
                                            const nonRegularVal = nonRegularRepeatValues[idx] || 0;
                                            const newVal = newOrdersValues[idx] || 0;

                                            return (
                                                <tr key={idx} className="hover:bg-slate-50/50">
                                                    <td className="px-3 py-2.5 font-medium text-slate-700">{groupName}</td>
                                                    <td className="px-3 py-2.5 text-right text-blue-600">₹{regularVal.toLocaleString('en-IN')}</td>
                                                    <td className="px-3 py-2.5 text-right text-purple-600">₹{nonRegularVal.toLocaleString('en-IN')}</td>
                                                    <td className="px-3 py-2.5 text-right text-green-600">₹{newVal.toLocaleString('en-IN')}</td>
                                                </tr>
                                            );
                                        })}
                                        <tr className="bg-slate-50 font-bold border-t border-slate-200">
                                            <td className="px-3 py-2">Total</td>
                                            <td className="px-3 py-2 text-right text-blue-700">
                                                ₹{regularRepeatValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                            </td>
                                            <td className="px-3 py-2 text-right text-purple-700">
                                                ₹{nonRegularRepeatValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                            </td>
                                            <td className="px-3 py-2 text-right text-green-700">
                                                ₹{newOrdersValues.reduce((acc, val) => acc + (val || 0), 0).toLocaleString('en-IN')}
                                            </td>
                                        </tr>
                                    </tbody>
                                </table>
                            </div>

                        </div>
                    </section>

                    {/* 1. Regular Customer Repeat Order Earnings */}
                    <section>
                        <button
                            onClick={() => toggleSection('regularRepeat')}
                            className="w-full text-sm font-bold text-slate-700 mb-3 flex items-center justify-between uppercase tracking-wider hover:bg-slate-50 p-2 rounded transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1 bg-blue-100 rounded text-blue-600"><RefreshCw size={14} /></div>
                                Regular Orders
                                <span className="text-xs font-normal text-slate-500 normal-case">
                                    ({repeatAchieved.reduce((a, b) => a + (b || 0), 0)}/{repeatTargets.reduce((a, b) => a + (b || 0), 0)})
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-blue-600">
                                    ₹{repeatEarnings.reduce((a, b) => a + (b || 0), 0).toLocaleString('en-IN')}
                                </span>
                                {expandedSections.regularRepeat ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </button>
                        {expandedSections.regularRepeat && (
                            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left whitespace-nowrap">
                                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                                            <tr>
                                                <th className="px-3 py-2">Group</th>
                                                <th className="px-3 py-2 text-right">Progress</th>
                                                <th className="px-3 py-2 text-right">Calculation</th>
                                                <th className="px-3 py-2 text-right">Earning</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {areaGroups.map((group, idx) => {
                                                const target = repeatTargets[idx] || 0;
                                                const achieved = repeatAchieved[idx] || 0;
                                                const earning = repeatEarnings[idx] || 0;
                                                const groupName = areaGroupNames[group] || `Group ${group}`;

                                                return (
                                                    <tr key={idx} className="hover:bg-slate-50/50">
                                                        <td className="px-3 py-2.5 font-medium text-slate-700">{groupName}</td>
                                                        <td className="px-3 py-2.5 text-right">
                                                            <span className="font-bold text-slate-800">{achieved}</span>
                                                            <span className="text-slate-400 mx-1">/</span>
                                                            <span className="text-slate-500">{target}</span>
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right text-slate-400 font-mono text-[10px]">
                                                            {achieved} * ₹{regularRate}
                                                        </td>
                                                        <td className="px-3 py-2.5 text-right font-bold text-green-600">
                                                            ₹{earning.toLocaleString('en-IN')}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            <tr className="bg-slate-50 font-bold border-t border-slate-200">
                                                <td className="px-3 py-2" colSpan={2}>Total</td>
                                                <td className="px-3 py-2"></td>
                                                <td className="px-3 py-2 text-right text-green-700">
                                                    ₹{repeatEarnings.reduce((a, b) => a + b, 0).toLocaleString('en-IN')}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* 2. Non Regular Repeat Order Earnings */}
                    <section>
                        <button
                            onClick={() => toggleSection('nonRegularRepeat')}
                            className="w-full text-sm font-bold text-slate-700 mb-3 flex items-center justify-between uppercase tracking-wider hover:bg-slate-50 p-2 rounded transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1 bg-purple-100 rounded text-purple-600"><RefreshCw size={14} /></div>
                                Non-Regular Orders
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-purple-600">
                                    ₹{nonRegEarnings.flat().reduce((a, b) => a + (b || 0), 0).toLocaleString('en-IN')}
                                </span>
                                {expandedSections.nonRegularRepeat ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </button>
                        {expandedSections.nonRegularRepeat && (
                            <div className="space-y-3">
                                {areaGroups.map((group, idx) => {
                                    const groupName = areaGroupNames[group] || `Group ${group}`;
                                    const earnings = nonRegEarnings[idx] || [0, 0, 0, 0];


                                    return (
                                        <GroupEarningsCard
                                            key={idx}
                                            groupName={groupName}
                                            earnings={earnings}
                                            countsAbove40k={nonRegAbove40k[idx] || 0}
                                            counts20kTo40k={nonReg20kTo40k[idx] || 0}
                                            counts5kTo20k={nonReg5kTo20k[idx] || 0}
                                            countsBelow5k={nonRegBelow5k[idx] || 0}
                                            totalEarning={earnings.reduce((a, b) => a + b, 0)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* 3. New Order Earnings */}
                    <section>
                        <button
                            onClick={() => toggleSection('newOrders')}
                            className="w-full text-sm font-bold text-slate-700 mb-3 flex items-center justify-between uppercase tracking-wider hover:bg-slate-50 p-2 rounded transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1 bg-green-100 rounded text-green-600"><Phone size={14} /></div>
                                New Orders
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-green-600">
                                    ₹{newOrderEarnings.flat().reduce((a, b) => a + (b || 0), 0).toLocaleString('en-IN')}
                                </span>
                                {expandedSections.newOrders ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </button>
                        {expandedSections.newOrders && (
                            <div className="space-y-3">
                                {areaGroups.map((group, idx) => {
                                    const groupName = areaGroupNames[group] || `Group ${group}`;
                                    const earnings = newOrderEarnings[idx] || [0, 0, 0, 0];

                                    return (
                                        <GroupEarningsCard
                                            key={idx}
                                            groupName={groupName}
                                            earnings={earnings}
                                            countsAbove40k={newOrdersAbove40k[idx] || 0}
                                            counts20kTo40k={newOrders20kTo40k[idx] || 0}
                                            counts5kTo20k={newOrders5kTo20k[idx] || 0}
                                            countsBelow5k={newOrdersBelow5k[idx] || 0}
                                            totalEarning={earnings.reduce((a, b) => a + b, 0)}
                                        />
                                    );
                                })}
                            </div>
                        )}
                    </section>

                    {/* 4. Delayed Orders */}
                    <section>
                        <button
                            onClick={() => toggleSection('penalties')}
                            className="w-full text-sm font-bold text-slate-700 mb-3 flex items-center justify-between uppercase tracking-wider hover:bg-slate-50 p-2 rounded transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <div className="p-1 bg-red-100 rounded text-red-600"><AlertCircle size={14} /></div>
                                Delayed Orders
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-sm font-bold text-red-600">
                                    {totalPenalties < 0 ? `-₹${Math.abs(totalPenalties).toLocaleString('en-IN')}` : `₹${totalPenalties.toLocaleString('en-IN')}`}
                                </span>
                                {expandedSections.penalties ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                            </div>
                        </button>
                        {expandedSections.penalties && (
                            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden shadow-sm">
                                <div className="overflow-x-auto">
                                    <table className="w-full text-xs text-left whitespace-nowrap">
                                        <thead className="bg-slate-50 text-slate-500 font-semibold border-b border-slate-100">
                                            <tr>
                                                <th className="px-2 py-2">Group</th>
                                                <th className="px-2 py-2 text-right">
                                                    <div className="text-[10px]">Customers</div>
                                                    <div className="text-[10px]">(&gt;3M)</div>
                                                </th>
                                                <th className="px-2 py-2 text-right text-[10px]">Calculation</th>
                                                <th className="px-2 py-2 text-right text-[10px]">Penalty</th>
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-100">
                                            {areaGroups.map((group, idx) => {
                                                const groupName = areaGroupNames[group] || `Group ${group}`;
                                                const count = delayedRegularCustomersCount[idx] || 0;
                                                const penaltyAmount = delayedRegularCustomersPenalties[idx] || 0; // Negative value

                                                if (count === 0 && penaltyAmount === 0) return null;

                                                return (
                                                    <tr key={idx} className="hover:bg-slate-50/50">
                                                        <td className="px-2 py-2 font-medium text-slate-700">{groupName}</td>
                                                        <td className="px-2 py-2 text-right text-slate-800">{count}</td>
                                                        <td className="px-2 py-2 text-right text-slate-400 font-mono text-[9px]">
                                                            {count} * {penaltyRate < 0 ? `-₹${Math.abs(penaltyRate)}` : `₹${penaltyRate}`}
                                                        </td>
                                                        <td className="px-2 py-2 text-right font-bold text-red-600">
                                                            {/* Amount is already negative */}
                                                            {penaltyAmount < 0 ? `-₹${Math.abs(penaltyAmount).toLocaleString('en-IN')}` : `₹${penaltyAmount.toLocaleString('en-IN')}`}
                                                        </td>
                                                    </tr>
                                                );
                                            })}
                                            <tr className="bg-slate-50 font-bold border-t border-slate-200">
                                                <td className="px-2 py-2" colSpan={2}>Total Penalties</td>
                                                <td className="px-2 py-2"></td>
                                                <td className="px-2 py-2 text-right text-red-700">
                                                    {totalPenalties < 0 ? `-₹${Math.abs(totalPenalties).toLocaleString('en-IN')}` : `₹${totalPenalties.toLocaleString('en-IN')}`}
                                                </td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        )}
                    </section>

                    {/* Grand Total Breakdown */}
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm p-4 space-y-2">
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-slate-600">Gross Earnings</span>
                            <span className="font-bold text-slate-800">₹{grossEarnings.toLocaleString('en-IN')}</span>
                        </div>
                        <div className="flex justify-between items-center text-sm">
                            <span className="text-red-600">Less: Penalties</span>
                            <span className="font-bold text-red-600">
                                {/* totalPenalties is negative, so just display it. Adding 'Less:' label makes it clear it's a deduction, 
                                     but math-wise we want to show the negative number or absolute? 
                                     User screenshot showed "-₹-5,100". 
                                     Standard accounting: "Less: Penalties   (5,100)" or just "- ₹5,100" 
                                     Since totalPenalties is negative, `Total: -5100`. 
                                     Let's just show the value as is, which interprets to negative.
                                 */}
                                {totalPenalties < 0 ? `-₹${Math.abs(totalPenalties).toLocaleString('en-IN')}` : `₹${totalPenalties.toLocaleString('en-IN')}`}
                            </span>
                        </div>
                        <div className="flex justify-between items-center pt-2 border-t border-slate-200 mt-2">
                            <span className="text-base font-bold text-slate-800">Net Payable</span>
                            <span className="text-xl font-bold text-green-600">
                                {/* Gross (positive) + Penalties (negative) = Net */}
                                {(grossEarnings + totalPenalties) < 0 ? `-₹${Math.abs(grossEarnings + totalPenalties).toLocaleString('en-IN')}` : `₹${(grossEarnings + totalPenalties).toLocaleString('en-IN')}`}
                            </span>
                        </div>
                    </div>

                </div>
            </div >
        </div >
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
    const [selectedMonthTimestamp, setSelectedMonthTimestamp] = useState(null);

    // Penalty tooltip state for mobile
    const [showPenaltyTooltip, setShowPenaltyTooltip] = useState(false);
    const longPressTimer = useRef(null);
    const [selectedCustomerId, setSelectedCustomerId] = useState(null);
    const [error, setError] = useState(null);

    // Modal State
    const [modalSalaryData, setModalSalaryData] = useState(null);
    const [modalMonthTimestamp, setModalMonthTimestamp] = useState(() => {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;
    });
    const [loadingModalSalary, setLoadingModalSalary] = useState(false);

    const navigate = useNavigate();


    // Hardcoded for now, same as FactoryView
    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

    const fetchSalaryData = async (monthTimestamp) => {
        if (!user?.email) throw new Error("User email not found");

        const headers = await getHeaders();
        const sqlQuery = `
SELECT 
    *,
    Potential_Order_Earnings_Breakup,
    Penalty_for_Delayed_Regular_Customer,
    Total_Penalties,
    Delayed_Regular_Customers_Penalties,
    Delayed_Regular_Customers
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
                    monthTimestamp,
                    // "manin8763@gmail.com"
                    user.email
                ]
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch salary: ${response.statusText}`);
        }

        const data = await response.json();

        if (data.records && data.records.length > 0) {
            const salaryRecord = data.records[0].fields;

            // Fetch Area Group Names if needed
            try {
                const areaGroupIds = typeof salaryRecord.Area_Groups === 'string'
                    ? JSON.parse(salaryRecord.Area_Groups)
                    : (salaryRecord.Area_Groups || []);

                if (areaGroupIds.length > 0) {
                    const placeholders = areaGroupIds.map(() => '?').join(',');
                    const groupsQuery = `SELECT id, Area_Group FROM Area_Groups WHERE id IN (${placeholders})`;

                    const groupsResponse = await fetch(url, {
                        method: 'POST',
                        headers: { ...headers, 'Content-Type': 'application/json' },
                        body: JSON.stringify({ sql: groupsQuery, args: areaGroupIds })
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

            return salaryRecord;
        }

        return null;
    };

    const fetchSalary = async () => {
        setLoadingSalary(true);
        setError(null);
        try {
            const now = new Date();
            const startOfMonthTimestamp = new Date(now.getFullYear(), now.getMonth(), 1).getTime() / 1000;

            const data = await fetchSalaryData(startOfMonthTimestamp);
            setSalaryData(data);
            viewCache.salaryData = data;

            // Also initialize modal data with current month data
            setModalSalaryData(data);

        } catch (err) {
            console.error("Salary Fetch Error:", err);
            setError(err.message);
        } finally {
            setLoadingSalary(false);
        }
    };

    const handleModalMonthChange = async (timestamp) => {
        setModalMonthTimestamp(timestamp);
        setLoadingModalSalary(true);
        try {
            const data = await fetchSalaryData(timestamp);
            setModalSalaryData(data);
        } catch (err) {
            console.error("Error fetching modal salary:", err);
            setModalSalaryData(null);
        } finally {
            setLoadingModalSalary(false);
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
                SELECT c.id, Shop_Name, Sales_Status, Days_Since_Last_Order, c.Area_Group, c.Customer_ID, Mobile_Number, c.TEMP_FALLBACK_SALES_CATEGORY
                FROM Customers c
                JOIN Area_Groups ag ON ag.id = c.Area_Group
                WHERE Responsible_Sales_Team = 'TELECALLER'
                AND (ag.Telecaller LIKE '%[${teamId}]%' OR ag.Telecaller LIKE '%[${teamId},%' OR ag.Telecaller LIKE '%,${teamId}]%' OR ag.Telecaller LIKE '%,${teamId},%')
                ORDER BY c.TEMP_FALLBACK_SALES_CATEGORY desc
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

    // Penalty tooltip handlers
    const handlePenaltyTouchStart = () => {
        longPressTimer.current = setTimeout(() => {
            setShowPenaltyTooltip(true);
        }, 500); // 500ms long press
    };

    const handlePenaltyTouchEnd = () => {
        if (longPressTimer.current) {
            clearTimeout(longPressTimer.current);
        }
        // Hide tooltip after 2 seconds
        if (showPenaltyTooltip) {
            setTimeout(() => setShowPenaltyTooltip(false), 2000);
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            {/* Header */}
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-7xl mx-auto flex flex-col gap-4">
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
                        </div>
                    </div>

                    {/* Salary Section (Moved here) */}
                    <Card className="bg-gradient-to-r from-blue-600 to-blue-700 text-white border-none cursor-pointer hover:shadow-lg transition-shadow overflow-visible"
                        onClick={() => {
                            console.log("Salary Card Clicked. Data:", salaryData);
                            setShowSalaryModal(true);
                        }}
                    >
                        <div className="p-3 flex flex-wrap items-center gap-2">
                            {/* Main Salary - Full width on very small, auto on larger */}
                            <div className="flex items-center gap-3 mr-auto">
                                {/* Earnings - More Prominent with Green */}
                                <div className="flex items-center gap-2 bg-green-500/20 px-2 py-1.5 rounded-lg border border-green-400/30">
                                    <div className="bg-green-500/30 p-1.5 rounded-lg">
                                        <IndianRupee size={20} className="text-green-100" />
                                    </div>
                                    <div>
                                        <p className="text-[10px] text-green-100 leading-none mb-0.5 flex items-center gap-1">
                                            Earnings <span className="bg-green-500/20 px-1 rounded text-[8px]">{currentMonth}</span>
                                        </p>
                                        <p className="font-bold text-xl leading-none text-green-50">
                                            {loadingSalary ? (
                                                <span className="animate-pulse">...</span>
                                            ) : salaryData ? (
                                                (salaryData.Total_Earnings || 0).toLocaleString('en-IN')
                                            ) : (
                                                "0"
                                            )}
                                        </p>
                                    </div>
                                </div>

                                {/* Penalties - Next to Earnings, Less Prominent */}
                                {salaryData && (salaryData.Total_Penalties !== 0) && (() => {
                                    try {
                                        const delayedCounts = typeof salaryData.Delayed_Regular_Customers === 'string'
                                            ? JSON.parse(salaryData.Delayed_Regular_Customers)
                                            : (salaryData.Delayed_Regular_Customers || []);
                                        const totalDelayed = Array.isArray(delayedCounts)
                                            ? delayedCounts.reduce((a, b) => a + (Number(b) || 0), 0)
                                            : 0;

                                        return (
                                            <>
                                                {/* Desktop: Show full penalties */}
                                                <div className="hidden md:flex items-center gap-1.5">
                                                    <div className="bg-red-500/10 p-1 rounded">
                                                        <AlertCircle size={14} className="text-red-200" />
                                                    </div>
                                                    <div>
                                                        <p className="text-[9px] text-red-100/70 leading-none mb-0.5">Penalties</p>
                                                        <p className="font-bold text-sm leading-none text-red-100">
                                                            {(salaryData.Total_Penalties || 0) < 0 ? `-₹${Math.abs(salaryData.Total_Penalties || 0).toLocaleString('en-IN')}` : `₹${(salaryData.Total_Penalties || 0).toLocaleString('en-IN')}`}
                                                        </p>
                                                    </div>
                                                </div>

                                                {/* Mobile: Show icon with long-press tooltip */}
                                                <div className="md:hidden relative">
                                                    <div
                                                        className="bg-white/90 p-1.5 rounded-full cursor-pointer shadow-sm"
                                                        onTouchStart={handlePenaltyTouchStart}
                                                        onTouchEnd={handlePenaltyTouchEnd}
                                                        onMouseDown={handlePenaltyTouchStart}
                                                        onMouseUp={handlePenaltyTouchEnd}
                                                        onMouseLeave={handlePenaltyTouchEnd}
                                                    >
                                                        <AlertCircle size={16} className="text-red-500" />
                                                    </div>
                                                    {showPenaltyTooltip && (
                                                        <div className="absolute top-full left-1/2 transform -translate-x-1/2 mt-2 bg-white text-slate-800 px-3 py-2 rounded-lg shadow-2xl border border-slate-200 whitespace-nowrap z-[9999]">
                                                            <div className="text-[10px] text-slate-500 mb-1">Penalties</div>
                                                            <div className="font-bold text-base text-red-600">
                                                                {(salaryData.Total_Penalties || 0) < 0 ? `-₹${Math.abs(salaryData.Total_Penalties || 0).toLocaleString('en-IN')}` : `₹${(salaryData.Total_Penalties || 0).toLocaleString('en-IN')}`}
                                                            </div>
                                                            {totalDelayed > 0 && (
                                                                <div className="text-[9px] text-slate-400 mt-1">{totalDelayed} delayed</div>
                                                            )}
                                                            {/* Tooltip arrow pointing up */}
                                                            <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-white"></div>
                                                        </div>
                                                    )}
                                                </div>
                                            </>
                                        );
                                    } catch (e) { return null; }
                                })()}
                            </div>

                            {/* Total Orders Value - Highlighted Top Right */}
                            {salaryData && (
                                <div className="ml-auto bg-white/20 px-2 py-1 rounded border border-white/30 flex flex-col items-end">
                                    <span className="text-[9px] text-blue-100 uppercase font-bold tracking-wider">Orders Value</span>
                                    <span className="text-sm font-bold text-white">₹{(salaryData.Total_Orders_Value || 0).toLocaleString('en-IN')}</span>
                                </div>
                            )}

                            {/* Stats Chips */}
                            <div className="flex flex-wrap items-center w-full mt-2">
                                {/* Regular Customers (Baseline) - Aggregated */}
                                {salaryData && (() => {
                                    try {
                                        const groups = typeof salaryData.Area_Groups === 'string' ? JSON.parse(salaryData.Area_Groups) : (salaryData.Area_Groups || []);
                                        const targets = typeof salaryData.Regular_Repeat_Orders_Targets === 'string' ? JSON.parse(salaryData.Regular_Repeat_Orders_Targets) : (salaryData.Regular_Repeat_Orders_Targets || []);
                                        const achieved = typeof salaryData.Regular_Repeat_Orders === 'string' ? JSON.parse(salaryData.Regular_Repeat_Orders) : (salaryData.Regular_Repeat_Orders || []);

                                        if (groups.length === 0) return null;

                                        const totalAchieved = achieved.reduce((a, b) => a + (Number(b) || 0), 0);
                                        const totalTarget = targets.reduce((a, b) => a + (Number(b) || 0), 0);

                                        return (
                                            <div className="bg-blue-500/20 px-2 py-1 rounded border border-blue-400/20 flex items-center gap-1.5">
                                                <span className="text-[10px] text-blue-100 uppercase tracking-wider font-bold">REG</span>
                                                <span className="font-bold text-sm text-white">
                                                    {totalAchieved}<span className="text-xs opacity-60 font-normal">/{totalTarget}</span>
                                                </span>
                                            </div>
                                        );
                                    } catch (e) { return null; }
                                })()}

                                {/* Delayed Customers - Subtle red chip next to REG */}
                                {salaryData && (() => {
                                    try {
                                        const delayedCounts = typeof salaryData.Delayed_Regular_Customers === 'string'
                                            ? JSON.parse(salaryData.Delayed_Regular_Customers)
                                            : (salaryData.Delayed_Regular_Customers || []);
                                        const totalDelayed = Array.isArray(delayedCounts)
                                            ? delayedCounts.reduce((a, b) => a + (Number(b) || 0), 0)
                                            : 0;

                                        if (totalDelayed === 0) return null;

                                        return (
                                            <div className="bg-red-500/10 px-2 py-1 rounded border border-red-400/10 flex items-center gap-1.5">
                                                <span className="text-[10px] text-red-100/60 uppercase tracking-wider font-bold">!</span>
                                                <span className="font-bold text-sm text-red-100/80">
                                                    {totalDelayed}
                                                </span>
                                            </div>
                                        );
                                    } catch (e) { return null; }
                                })()}


                                <div className="flex items-center gap-2 ml-auto">
                                    {/* Non-Reg Chip */}
                                    {salaryData && (() => {
                                        try {
                                            const above = JSON.parse(salaryData.Non_Regular_Repeat_Orders_above_40k || '[]');
                                            const between = JSON.parse(salaryData.Non_Regular_Repeat_Orders_between_20_40k || '[]');
                                            const between5_20 = JSON.parse(salaryData.Non_Regular_Repeat_Orders_between_5_20k || '[]');
                                            const below5 = JSON.parse(salaryData.Non_Regular_Repeat_Orders_below_5k || '[]');
                                            const totalNonReg = [above, between, between5_20, below5].flat().reduce((a, b) => a + (Number(b) || 0), 0);

                                            return (
                                                <div className="bg-purple-500/20 px-2 py-1 rounded border border-purple-400/30 flex items-center gap-1.5">
                                                    <span className="text-[10px] text-purple-100 uppercase tracking-wider font-bold">Non-Reg</span>
                                                    <span className="font-bold text-sm text-white">{totalNonReg}</span>
                                                </div>
                                            );
                                        } catch (e) { return null; }
                                    })()}

                                    {/* New Orders Chip */}
                                    <div className="bg-green-500/20 px-2 py-1 rounded border border-green-400/30 flex items-center gap-1.5">
                                        <span className="text-[10px] text-green-100 uppercase tracking-wider font-bold">New</span>
                                        <span className="font-bold text-sm text-white">
                                            {salaryData ? (JSON.parse(salaryData.New_Orders || '[]').length) : 0}
                                        </span>
                                    </div>
                                </div>
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
            </header >

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
                                    tempFallbackSalesCategory={todo.TEMP_FALLBACK_SALES_CATEGORY}
                                    onClick={() => setSelectedCustomerId(todo.Customer_ID)}
                                />
                            ))}
                        </div>
                    )}
                </div>
            </main>

            {/* Customer View Modal */}
            {
                selectedCustomerId && (
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
                )
            }

            {
                showSalaryModal && (
                    <SalaryDetailsModal
                        data={modalSalaryData}
                        areaGroupNames={areaGroupNames}
                        month={new Date(modalMonthTimestamp * 1000).toLocaleString('default', { month: 'short', year: '2-digit' })}
                        selectedMonthTimestamp={modalMonthTimestamp}
                        onClose={() => setShowSalaryModal(false)}
                        onMonthChange={handleModalMonthChange}
                    />
                )
            }
        </div >
    );
};

export default TelecallerView;
