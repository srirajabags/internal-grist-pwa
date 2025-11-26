import React, { useState, useEffect } from 'react';
import { ArrowLeft, Phone, MessageCircle, Clock, Save, AlertCircle, Loader2, CheckCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';

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

const Card = ({ children, className = "" }) => (
    <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
        {children}
    </div>
);

const TelecallerCustomerView = ({ onBack, user, getHeaders, getUrl, customerId: propCustomerId, customerRowId: propCustomerRowId, shopName }) => {
    const { customerId: paramCustomerId } = useParams();
    const customerId = propCustomerId || paramCustomerId;

    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [customerName, setCustomerName] = useState(shopName || "");
    const [customerRowId, setCustomerRowId] = useState(propCustomerRowId || null);
    const [error, setError] = useState(null);

    // Form State
    const [medium, setMedium] = useState('CALL');
    const [mediumChoices, setMediumChoices] = useState(['CALL']);
    const [outcome, setOutcome] = useState('NOT RESPONDING');
    const [outcomeChoices, setOutcomeChoices] = useState(['NOT RESPONDING']);
    const [outcomeBriefs, setOutcomeBriefs] = useState('');
    const [outcomeBriefsChoices, setOutcomeBriefsChoices] = useState([]);
    const [notes, setNotes] = useState('');
    const [nextFollowUp, setNextFollowUp] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

    const fetchOutcomeChoices = async () => {
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/tables/Customer_Conversations/columns`);

            const response = await fetch(url, {
                method: 'GET',
                headers: headers
            });

            if (response.ok) {
                const data = await response.json();

                // Fetch Medium choices
                const mediumColumn = data.columns.find(col => col.id === 'Medium');
                if (mediumColumn && mediumColumn.fields.widgetOptions) {
                    try {
                        const widgetOptions = JSON.parse(mediumColumn.fields.widgetOptions);
                        if (widgetOptions.choices && Array.isArray(widgetOptions.choices)) {
                            setMediumChoices(widgetOptions.choices);
                            // Set CALL as default if it exists in choices
                            if (widgetOptions.choices.includes('CALL')) {
                                setMedium('CALL');
                            } else if (widgetOptions.choices.length > 0) {
                                setMedium(widgetOptions.choices[0]);
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing Medium widget options:', e);
                    }
                }

                // Fetch Outcomes choices
                const outcomesColumn = data.columns.find(col => col.id === 'Outcomes');
                if (outcomesColumn && outcomesColumn.fields.widgetOptions) {
                    try {
                        const widgetOptions = JSON.parse(outcomesColumn.fields.widgetOptions);
                        if (widgetOptions.choices && Array.isArray(widgetOptions.choices)) {
                            setOutcomeChoices(widgetOptions.choices);
                            // Set NOT RESPONDING as default if it exists in choices
                            if (widgetOptions.choices.includes('NOT RESPONDING')) {
                                setOutcome('NOT RESPONDING');
                            } else if (widgetOptions.choices.length > 0) {
                                setOutcome(widgetOptions.choices[0]);
                            }
                        }
                    } catch (e) {
                        console.error('Error parsing Outcomes widget options:', e);
                    }
                }

                // Fetch Outcome_Briefs choices
                const outcomeBriefsColumn = data.columns.find(col => col.id === 'Outcome_Briefs');
                if (outcomeBriefsColumn && outcomeBriefsColumn.fields.widgetOptions) {
                    try {
                        const widgetOptions = JSON.parse(outcomeBriefsColumn.fields.widgetOptions);
                        if (widgetOptions.choices && Array.isArray(widgetOptions.choices)) {
                            setOutcomeBriefsChoices(widgetOptions.choices);
                            // Don't set a default value, leave it empty
                        }
                    } catch (e) {
                        console.error('Error parsing Outcome_Briefs widget options:', e);
                    }
                }
            }
        } catch (e) {
            console.error('Error fetching outcome choices:', e);
        }
    };

    const fetchHistory = async () => {
        setLoadingHistory(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);

            const sqlQuery = `
                SELECT cc.Medium,
                cc.Created_At,
                cc.Created_By,
                t.Name as Created_By_Name,
                cc.Outcomes,
                cc.Outcome_Briefs,
                cc.Outcome_Date 
                FROM Customer_Conversations cc 
                JOIN Customers c ON c.id = cc.Customer 
                LEFT JOIN Team t ON t.id = cc.Created_By OR t.Email = cc.Created_By
                WHERE c.Customer_ID = ?
                ORDER BY cc.Created_At ASC
                    `;

            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: sqlQuery, args: [parseInt(customerId)] })
            });

            if (!response.ok) throw new Error("Failed to fetch history");

            const data = await response.json();
            const records = data.records.map(r => r.fields);
            setHistory(records);

        } catch (e) {
            console.error("Error fetching history:", e);
            setError(e.message);
        } finally {
            setLoadingHistory(false);
        }
    };

    useEffect(() => {
        fetchOutcomeChoices();
        if (customerId) {
            fetchHistory();
        }
    }, [customerId]);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setError(null);
        setSubmitSuccess(false);

        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);

            let rowId = customerRowId;
            let shopNameValue = customerName;

            // Only fetch customer details if we don't have the row ID
            if (!rowId) {
                const idQuery = `SELECT id, Shop_Name FROM Customers WHERE Customer_ID = ?`;
                const idRes = await fetch(url, {
                    method: 'POST',
                    headers: { ...headers, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sql: idQuery, args: [parseInt(customerId)] })
                });

                if (!idRes.ok) throw new Error("Failed to find customer record");
                const idData = await idRes.json();
                if (!idData.records.length) throw new Error("Customer not found");

                rowId = idData.records[0].fields.id;
                shopNameValue = idData.records[0].fields.Shop_Name;
                setCustomerRowId(rowId);
                setCustomerName(shopNameValue);
            }

            // Now add record to Customer_Conversations
            const addUrl = getUrl(`/api/docs/${DOC_ID}/tables/Customer_Conversations/records`);
            const now = new Date();

            const recordData = {
                Customer: rowId,
                Medium: medium,
                Outcomes: JSON.stringify([outcome]),
                Notes: notes,
                Outcome_Date: nextFollowUp ? (new Date(nextFollowUp).getTime() / 1000) : null
            };

            // Only include Outcome_Briefs if it has a value
            if (outcomeBriefs) {
                recordData.Outcome_Briefs = outcomeBriefs;
            }

            // We might need to fetch Team ID for the current user to save correctly if it's a Ref.
            // Let's do a quick fetch for Team ID if we don't have it?
            // Or just try saving. If it fails, we'll know.
            // But the user only asked to fix the display.

            const addRes = await fetch(addUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: recordData }] })
            });

            if (!addRes.ok) throw new Error("Failed to save conversation");

            setSubmitSuccess(true);
            setMedium(mediumChoices.includes('CALL') ? 'CALL' : (mediumChoices.length > 0 ? mediumChoices[0] : 'CALL'));
            setOutcome(outcomeChoices.includes('NOT RESPONDING') ? 'NOT RESPONDING' : (outcomeChoices.length > 0 ? outcomeChoices[0] : 'NOT RESPONDING'));
            setOutcomeBriefs('');
            setNotes('');
            setNextFollowUp('');
            fetchHistory(); // Refresh history

            setTimeout(() => setSubmitSuccess(false), 3000);

        } catch (e) {
            console.error("Error submitting conversation:", e);
            setError(e.message);
        } finally {
            setSubmitting(false);
        }
    };

    const formatDate = (ts) => {
        if (!ts) return '';
        return new Date(ts * 1000).toLocaleString('en-IN', {
            day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
        });
    };

    const parseOutcomes = (outcomesStr) => {
        if (!outcomesStr) return [];
        try {
            const parsed = JSON.parse(outcomesStr);
            return Array.isArray(parsed) ? parsed : [outcomesStr];
        } catch (e) {
            return [outcomesStr];
        }
    };

    return (
        <div className="min-h-screen bg-slate-50 flex flex-col">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-20 px-4 py-3">
                <div className="max-w-7xl mx-auto flex items-center gap-3">
                    <Button variant="ghost" onClick={onBack} className="!px-2">
                        <ArrowLeft size={20} />
                    </Button>
                    <div>
                        <h1 className="font-bold text-slate-800">{customerName || `Customer #${customerId}`}</h1>
                        <p className="text-xs text-slate-500">Conversation History</p>
                    </div>
                </div>
            </header>

            <main className="flex-1 flex flex-col overflow-hidden">
                {/* History Section - Scrollable */}
                <div className="flex-1 overflow-auto p-4">
                    <div className="max-w-md mx-auto">
                        <h3 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <Clock size={16} className="text-slate-400" />
                            History
                        </h3>

                        {loadingHistory ? (
                            <div className="flex justify-center py-8">
                                <Loader2 size={24} className="animate-spin text-slate-400" />
                            </div>
                        ) : history.length === 0 ? (
                            <div className="text-center py-8 text-slate-400 bg-white rounded-xl border border-dashed border-slate-300">
                                <p>No history found</p>
                            </div>
                        ) : (
                            <div className="space-y-3 pb-4">
                                {history.map((item, idx) => (
                                    <Card key={idx} className="p-3">
                                        <div className="flex justify-between items-start mb-1">
                                            <div className="flex flex-wrap gap-1">
                                                {parseOutcomes(item.Outcomes).map((out, i) => (
                                                    <span key={i} className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide bg-blue-50 text-blue-700 border border-blue-100">
                                                        {out}
                                                    </span>
                                                ))}
                                                {(!item.Outcomes || parseOutcomes(item.Outcomes).length === 0) && (
                                                    <span className="text-sm font-bold text-slate-800">No Outcome</span>
                                                )}
                                            </div>
                                            <span className="text-[10px] text-slate-500 whitespace-nowrap ml-2">{formatDate(item.Created_At)}</span>
                                        </div>
                                        <p className="text-sm text-slate-600 mb-2 mt-2">{item.Outcome_Briefs}</p>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-400">
                                            <span className="bg-slate-100 px-1.5 py-0.5 rounded">{item.Medium}</span>
                                            <span>by {item.Created_By_Name || 'Unknown'} ({item.Created_By})</span>
                                        </div>
                                    </Card>
                                ))}
                            </div>
                        )}
                    </div>
                </div>

                {/* New Conversation Form - Sticky at Bottom */}
                <div className="border-t border-slate-200 bg-white p-4 shadow-lg">
                    <div className="max-w-md mx-auto">
                        <h2 className="font-bold text-slate-800 mb-3 flex items-center gap-2">
                            <MessageCircle size={18} className="text-green-600" />
                            New Conversation
                        </h2>

                        {submitSuccess && (
                            <div className="mb-3 p-2 bg-green-50 text-green-700 rounded-lg flex items-center gap-2 text-sm">
                                <CheckCircle size={16} />
                                Saved successfully!
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className="space-y-3">
                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Medium</label>
                                <select
                                    value={medium}
                                    onChange={e => setMedium(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                >
                                    {mediumChoices.map(choice => (
                                        <option key={choice} value={choice}>{choice}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Outcome</label>
                                <select
                                    value={outcome}
                                    onChange={e => setOutcome(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                >
                                    {outcomeChoices.map(choice => (
                                        <option key={choice} value={choice}>{choice}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Outcome Briefs <span className="text-slate-400 text-[10px]">(Optional)</span></label>
                                <select
                                    value={outcomeBriefs}
                                    onChange={e => setOutcomeBriefs(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                >
                                    <option value="">-- Select --</option>
                                    {outcomeBriefsChoices.map(choice => (
                                        <option key={choice} value={choice}>{choice}</option>
                                    ))}
                                </select>
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                                <textarea
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder="Enter conversation details..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none min-h-[60px] text-sm"
                                />
                            </div>

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Outcome Date</label>
                                <input
                                    type="date"
                                    value={nextFollowUp}
                                    onChange={e => setNextFollowUp(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                />
                            </div>

                            <Button
                                type="submit"
                                className="w-full"
                                disabled={submitting}
                                icon={submitting ? Loader2 : Save}
                            >
                                {submitting ? "Saving..." : "Submit"}
                            </Button>
                        </form>
                    </div>
                </div>
            </main>
        </div>
    );
};

export default TelecallerCustomerView;
