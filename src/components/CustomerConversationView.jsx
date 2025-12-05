import React, { useState, useEffect } from 'react';
import { ArrowLeft, Phone, MessageCircle, Clock, Save, AlertCircle, Loader2, CheckCircle, MapPin, XCircle } from 'lucide-react';
import { useParams } from 'react-router-dom';
import salesmanConfig from '../config/salesman-conversation-config.json';
import telecallerConfig from '../config/telecaller-conversation-config.json';

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

const CustomerConversationView = ({
    onBack,
    user,
    getHeaders,
    getUrl,
    customerId: propCustomerId,
    customerRowId: propCustomerRowId,
    shopName,
    defaultMedium = 'CALL',
    defaultOutcome = 'NOT RESPONDING',
    enableLocationUpdate = false,
    title
}) => {
    const { customerId: paramCustomerId } = useParams();
    const customerId = propCustomerId || paramCustomerId;

    const [history, setHistory] = useState([]);
    const [loadingHistory, setLoadingHistory] = useState(false);
    const [customerName, setCustomerName] = useState(shopName || "");
    const [customerRowId, setCustomerRowId] = useState(propCustomerRowId || null);
    const [customerData, setCustomerData] = useState(null);
    const [error, setError] = useState(null);

    // Form State
    const [medium, setMedium] = useState(defaultMedium);
    const [mediumChoices, setMediumChoices] = useState([defaultMedium]);
    const [outcome, setOutcome] = useState(defaultOutcome);
    const [outcomeChoices, setOutcomeChoices] = useState([defaultOutcome]);
    const [filteredOutcomeChoices, setFilteredOutcomeChoices] = useState([defaultOutcome]);
    const [outcomeBriefs, setOutcomeBriefs] = useState('');
    const [outcomeBriefsChoices, setOutcomeBriefsChoices] = useState([]);
    const [filteredOutcomeBriefsChoices, setFilteredOutcomeBriefsChoices] = useState([]);
    const [showOutcomeDate, setShowOutcomeDate] = useState(false);
    const [isOutcomeBriefsRequired, setIsOutcomeBriefsRequired] = useState(false);

    // Check view type
    const isSalesmanView = defaultMedium === 'IN PERSON';
    const isTelecallerView = defaultMedium === 'CALL';
    const currentConfig = isSalesmanView ? salesmanConfig : isTelecallerView ? telecallerConfig : null;
    const [notes, setNotes] = useState('');
    const [nextFollowUp, setNextFollowUp] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [submitSuccess, setSubmitSuccess] = useState(false);

    // Location State
    const [showLocationPrompt, setShowLocationPrompt] = useState(false);
    const [updatingLocation, setUpdatingLocation] = useState(false);
    const [toast, setToast] = useState(null);

    const showToast = (type, message) => {
        setToast({ type, message });
        setTimeout(() => setToast(null), 3000);
    };

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
                            let filteredMediumChoices = widgetOptions.choices;
                            if (currentConfig?.medium?.whitelist) {
                                filteredMediumChoices = widgetOptions.choices.filter(choice =>
                                    currentConfig.medium.whitelist.includes(choice)
                                );
                            }
                            setMediumChoices(filteredMediumChoices);
                            // Set default if it exists in choices
                            if (filteredMediumChoices.includes(defaultMedium)) {
                                setMedium(defaultMedium);
                            } else if (filteredMediumChoices.length > 0) {
                                setMedium(filteredMediumChoices[0]);
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
                            let filteredOutcomeChoices = widgetOptions.choices;
                            if (currentConfig?.outcome?.whitelist) {
                                filteredOutcomeChoices = widgetOptions.choices.filter(choice =>
                                    currentConfig.outcome.whitelist.includes(choice)
                                );
                            }
                            setOutcomeChoices(filteredOutcomeChoices);
                            setFilteredOutcomeChoices(filteredOutcomeChoices);
                            // Set default if it exists in choices
                            if (filteredOutcomeChoices.includes(defaultOutcome)) {
                                setOutcome(defaultOutcome);
                            } else if (filteredOutcomeChoices.length > 0) {
                                setOutcome(filteredOutcomeChoices[0]);
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
                            let filteredOutcomeBriefsChoices = widgetOptions.choices;
                            if (currentConfig?.outcomeBriefs?.whitelist) {
                                filteredOutcomeBriefsChoices = widgetOptions.choices.filter(choice =>
                                    currentConfig.outcomeBriefs.whitelist.includes(choice)
                                );
                            }
                            setOutcomeBriefsChoices(filteredOutcomeBriefsChoices);
                            setFilteredOutcomeBriefsChoices(filteredOutcomeBriefsChoices);
                        }
                    } catch (e) {
                        console.error('Error parsing Outcome_Briefs widget options:', e);
                    }
                }
            }
        } catch (error) {
            console.error('Error fetching outcome choices:', error);
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

    const fetchCustomerDetails = async () => {
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${DOC_ID}/sql`);
            const idQuery = `SELECT id, Shop_Name, Latitude, Longitude FROM Customers WHERE Customer_ID = ?`;
            const idRes = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: idQuery, args: [parseInt(customerId)] })
            });

            if (!idRes.ok) throw new Error("Failed to find customer record");
            const idData = await idRes.json();
            if (!idData.records.length) throw new Error("Customer not found");

            const record = idData.records[0].fields;
            setCustomerRowId(record.id);
            setCustomerName(record.Shop_Name);
            setCustomerData(record);
        } catch (e) {
            console.error("Error fetching customer details:", e);
            setError(e.message);
        }
    };

    useEffect(() => {
        fetchOutcomeChoices();
        if (customerId) {
            fetchHistory();
            if (!customerRowId || enableLocationUpdate) {
                fetchCustomerDetails();
            }
        }
    }, [customerId]);

    // Handle linked dropdowns
    useEffect(() => {
        if (currentConfig?.outcome?.linkedTo === 'medium' && currentConfig.outcome?.mappings) {
            const allowedOutcomes = currentConfig.outcome.mappings[medium] || currentConfig.outcome.whitelist;
            const filtered = outcomeChoices.filter(choice => allowedOutcomes.includes(choice));
            setFilteredOutcomeChoices(filtered);
            // If current outcome is not in filtered list, reset to first available or default
            if (!filtered.includes(outcome)) {
                const defaultOutcomeFromConfig = currentConfig.outcome.default;
                if (filtered.includes(defaultOutcomeFromConfig)) {
                    setOutcome(defaultOutcomeFromConfig);
                } else if (filtered.length > 0) {
                    setOutcome(filtered[0]);
                }
            }
        }
    }, [medium, outcomeChoices, currentConfig]);

    useEffect(() => {
        if (currentConfig?.outcomeBriefs?.linkedTo === 'outcome' && currentConfig.outcomeBriefs?.mappings) {
            const allowedBriefs = currentConfig.outcomeBriefs.mappings[outcome] || currentConfig.outcomeBriefs.whitelist;
            const filtered = outcomeBriefsChoices.filter(choice => allowedBriefs.includes(choice));
            setFilteredOutcomeBriefsChoices(filtered);
            // If current outcomeBriefs is not in filtered list, reset it
            if (outcomeBriefs && !filtered.includes(outcomeBriefs)) {
                setOutcomeBriefs('');
            }
        }
    }, [outcome, outcomeBriefsChoices, currentConfig]);

    // Control conditional fields based on current config
    useEffect(() => {
        const shouldShowOutcomeDate = currentConfig && outcome === 'GIVEN REMINDER DATE';
        const shouldRequireOutcomeBriefs = currentConfig && outcome === 'NOTIFIED PROBLEM';

        setShowOutcomeDate(shouldShowOutcomeDate);
        setIsOutcomeBriefsRequired(shouldRequireOutcomeBriefs);

        // Clear the date if it's no longer required
        if (!shouldShowOutcomeDate) {
            setNextFollowUp('');
        }

        // Clear outcome briefs if it's no longer required
        if (!shouldRequireOutcomeBriefs) {
            setOutcomeBriefs('');
        }
    }, [outcome, currentConfig]);

    const handleFormSubmit = async (e) => {
        e.preventDefault();

        // Validate required Outcome Date when "GIVEN REMINDER DATE" is selected
        if (currentConfig && outcome === 'GIVEN REMINDER DATE' && !nextFollowUp) {
            setError('Outcome Date is required when "GIVEN REMINDER DATE" outcome is selected.');
            return;
        }

        // Validate required Outcome Briefs when "NOTIFIED PROBLEM" is selected
        if (currentConfig && outcome === 'NOTIFIED PROBLEM' && !outcomeBriefs) {
            setError('Outcome Briefs is required when "NOTIFIED PROBLEM" outcome is selected.');
            return;
        }

        // Check if we need to update location
        if (enableLocationUpdate && customerData && (!customerData.Latitude || !customerData.Longitude)) {
            setShowLocationPrompt(true);
        } else {
            submitConversation();
        }
    };

    const updateLocation = async () => {
        setUpdatingLocation(true);
        try {
            if (!navigator.geolocation) {
                throw new Error("Geolocation is not supported by this browser.");
            }

            const position = await new Promise((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject);
            });

            const { latitude, longitude } = position.coords;
            console.log("Got location:", latitude, longitude);

            // Update Customer Record
            const headers = await getHeaders();
            const updateUrl = getUrl(`/api/docs/${DOC_ID}/tables/Customers/records`);

            const updateRes = await fetch(updateUrl, {
                method: 'PATCH',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    records: [{
                        id: customerRowId,
                        fields: {
                            Latitude: latitude,
                            Longitude: longitude
                        }
                    }]
                })
            });

            if (!updateRes.ok) {
                throw new Error("Failed to update location");
            }

            // Update local state
            setCustomerData(prev => ({ ...prev, Latitude: latitude, Longitude: longitude }));
            showToast('success', 'Location updated successfully');

            // Proceed to submit conversation
            setShowLocationPrompt(false);
            submitConversation();

        } catch (e) {
            console.error("Error updating location:", e);
            showToast('error', `Failed to update location: ${e.message}`);
            setShowLocationPrompt(false);
            submitConversation();
        } finally {
            setUpdatingLocation(false);
        }
    };

    const submitConversation = async () => {
        setSubmitting(true);
        setError(null);
        setSubmitSuccess(false);

        try {
            const headers = await getHeaders();

            // Now add record to Customer_Conversations
            const addUrl = getUrl(`/api/docs/${DOC_ID}/tables/Customer_Conversations/records`);

            const recordData = {
                Customer: customerRowId,
                Medium: medium,
                Outcomes: JSON.stringify([outcome]),
                Notes: notes,
                Outcome_Date: nextFollowUp ? (new Date(nextFollowUp).getTime() / 1000) : null
            };

            if (outcomeBriefs) {
                recordData.Outcome_Briefs = outcomeBriefs;
            }

            const addRes = await fetch(addUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: recordData }] })
            });

            if (!addRes.ok) throw new Error("Failed to save conversation");

            setSubmitSuccess(true);
            showToast('success', 'Conversation saved successfully');

            // Reset form to defaults
            if (currentConfig) {
                setMedium(currentConfig.medium?.default || defaultMedium);
                setOutcome(currentConfig.outcome?.default || defaultOutcome);
            } else {
                setMedium(mediumChoices.includes(defaultMedium) ? defaultMedium : (mediumChoices.length > 0 ? mediumChoices[0] : 'CALL'));
                setOutcome(outcomeChoices.includes(defaultOutcome) ? defaultOutcome : (outcomeChoices.length > 0 ? outcomeChoices[0] : 'NOT RESPONDING'));
            }
            // Clear conditional fields
            setOutcomeBriefs('');
            setNextFollowUp('');
            setNotes('');
            fetchHistory(); // Refresh history

            setTimeout(() => setSubmitSuccess(false), 3000);

        } catch (e) {
            console.error("Error submitting conversation:", e);
            setError(e.message);
            showToast('error', `Failed to save conversation: ${e.message}`);
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
                        <p className="text-xs text-slate-500">{title || "Conversation History"}</p>
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

                        <form onSubmit={handleFormSubmit} className="space-y-3">
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
                                    {(currentConfig ? filteredOutcomeChoices : outcomeChoices).map(choice => (
                                        <option key={choice} value={choice}>{choice}</option>
                                    ))}
                                </select>
                            </div>

                            {isOutcomeBriefsRequired && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Outcome Briefs <span className="text-red-500">*</span>
                                    </label>
                                    <select
                                        value={outcomeBriefs}
                                        onChange={e => setOutcomeBriefs(e.target.value)}
                                        required={isOutcomeBriefsRequired}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                    >
                                        <option value="">-- Select --</option>
                                        {(currentConfig ? filteredOutcomeBriefsChoices : outcomeBriefsChoices).map(choice => (
                                            <option key={choice} value={choice}>{choice}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-slate-700 mb-1">Notes</label>
                                <textarea
                                    value={notes}
                                    onChange={e => setNotes(e.target.value)}
                                    placeholder="Enter conversation details..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none min-h-[60px] text-sm"
                                />
                            </div>

                            {showOutcomeDate && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">
                                        Outcome Date <span className="text-red-500">*</span>
                                    </label>
                                    <input
                                        type="date"
                                        value={nextFollowUp}
                                        onChange={e => setNextFollowUp(e.target.value)}
                                        required={showOutcomeDate}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 outline-none bg-white text-sm"
                                    />
                                </div>
                            )}

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

            {/* Toast Notification */}
            {toast && (
                <div className={`fixed bottom-4 left-1/2 transform -translate-x-1/2 px-4 py-2 rounded-lg shadow-lg flex items-center gap-2 text-sm font-medium z-50 animate-in fade-in slide-in-from-bottom-2 ${toast.type === 'success' ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
                    }`}>
                    {toast.type === 'success' ? <CheckCircle size={16} /> : <XCircle size={16} />}
                    {toast.message}
                </div>
            )}

            {/* Location Prompt Modal */}
            {showLocationPrompt && (
                <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
                    <div className="bg-white rounded-xl shadow-xl max-w-sm w-full p-6 text-center">
                        <MapPin size={48} className="mx-auto mb-4 text-blue-600" />
                        <h2 className="text-xl font-bold text-slate-800 mb-2">Location Required</h2>
                        <p className="text-slate-600 mb-6">
                            Are you at the customer's location? We need to update their location coordinates.
                        </p>
                        <div className="flex gap-3">
                            <Button
                                variant="secondary"
                                onClick={() => {
                                    setShowLocationPrompt(false);
                                    submitConversation();
                                }}
                                className="flex-1"
                            >
                                No, Skip
                            </Button>
                            <Button
                                onClick={updateLocation}
                                disabled={updatingLocation}
                                className="flex-1"
                                icon={updatingLocation ? Loader2 : MapPin}
                            >
                                {updatingLocation ? "Updating..." : "Yes, Update"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default CustomerConversationView;
