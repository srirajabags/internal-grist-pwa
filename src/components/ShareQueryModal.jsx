import React, { useState, useEffect } from 'react';
import { X, Users, Save, Loader2, Check } from 'lucide-react';

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

const ShareQueryModal = ({ isOpen, onClose, queryName, currentSharedWith, onSave, getHeaders, getUrl, docId }) => {
    const [teams, setTeams] = useState([]);
    const [loadingTeams, setLoadingTeams] = useState(false);
    const [selectedTeams, setSelectedTeams] = useState([]);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);

    // Parse initial sharedWith
    useEffect(() => {
        if (isOpen) {
            let initial = [];
            try {
                if (currentSharedWith) {
                    if (Array.isArray(currentSharedWith)) {
                        initial = currentSharedWith;
                    } else if (typeof currentSharedWith === 'string') {
                        // Handle stringified array or comma-separated
                        if (currentSharedWith.startsWith('[')) {
                            initial = JSON.parse(currentSharedWith);
                        } else {
                            initial = currentSharedWith.split(',').map(s => s.trim());
                        }
                    }
                }
            } catch (e) {
                console.warn("Failed to parse sharedWith:", e);
            }
            // Ensure all are numbers (IDs)
            setSelectedTeams(initial.map(id => Number(id)).filter(n => !isNaN(n)));
            fetchTeams();
        }
    }, [isOpen, currentSharedWith]);

    const fetchTeams = async () => {
        setLoadingTeams(true);
        setError(null);
        try {
            const headers = await getHeaders();
            const url = getUrl(`/api/docs/${docId}/sql`);

            const response = await fetch(url, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sql: 'SELECT id, Name FROM Team ORDER BY Name',
                    args: []
                })
            });

            if (response.ok) {
                const data = await response.json();
                if (data.records) {
                    setTeams(data.records.map(r => r.fields));
                }
            } else {
                throw new Error("Failed to fetch teams");
            }
        } catch (err) {
            console.error("Error fetching teams:", err);
            setError("Could not load team list.");
        } finally {
            setLoadingTeams(false);
        }
    };

    const toggleTeam = (teamId) => {
        setSelectedTeams(prev => {
            if (prev.includes(teamId)) {
                return prev.filter(id => id !== teamId);
            } else {
                return [...prev, teamId];
            }
        });
    };

    const handleSave = async () => {
        setSaving(true);
        try {
            // Format as stringified array of IDs, e.g., "[1, 2]"
            // Or Grist might expect a specific format for Reference List columns.
            // Usually for Reference List, we send [id1, id2] array.
            // But the user mentioned `Shared_With like '%,2,%'` which implies it might be stored as a string or Grist's string representation of a list.
            // If the column type is Reference List, we should send an array.
            // If it's Text, we should send a string.
            // Given the SQL query uses LIKE, it's likely Text or Grist's internal string representation of list.
            // I will save it as a JSON stringified array to match the `%[2]%` pattern, 
            // OR if it's a Reference List column, Grist handles the array.
            // Let's assume it's a Reference List column and send an array. Grist API handles array for RefList.
            // BUT, if I send an array via API, Grist stores it.
            // The SQL `LIKE` query suggests we are querying the underlying string representation.

            await onSave(selectedTeams);
            onClose();
        } catch (err) {
            setError("Failed to save sharing settings.");
        } finally {
            setSaving(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
            <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6 flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                    <div>
                        <h2 className="text-xl font-bold text-slate-800">Share Query</h2>
                        <p className="text-sm text-slate-500 truncate max-w-[250px]">{queryName}</p>
                    </div>
                    <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
                        <X size={20} />
                    </button>
                </div>

                {error && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
                        {error}
                    </div>
                )}

                <div className="flex-1 overflow-y-auto mb-4 border border-slate-100 rounded-lg">
                    {loadingTeams ? (
                        <div className="flex justify-center p-8">
                            <Loader2 size={24} className="animate-spin text-slate-400" />
                        </div>
                    ) : (
                        <div className="divide-y divide-slate-100">
                            {teams.map(team => {
                                const isSelected = selectedTeams.includes(team.id);
                                return (
                                    <div
                                        key={team.id}
                                        onClick={() => toggleTeam(team.id)}
                                        className={`p-3 flex items-center justify-between cursor-pointer hover:bg-slate-50 transition-colors ${isSelected ? 'bg-green-50 hover:bg-green-100' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${isSelected ? 'bg-green-200 text-green-800' : 'bg-slate-200 text-slate-600'}`}>
                                                {team.Name.charAt(0).toUpperCase()}
                                            </div>
                                            <span className={`font-medium ${isSelected ? 'text-green-900' : 'text-slate-700'}`}>
                                                {team.Name}
                                            </span>
                                        </div>
                                        {isSelected && <Check size={18} className="text-green-600" />}
                                    </div>
                                );
                            })}
                            {teams.length === 0 && (
                                <div className="p-4 text-center text-slate-500 text-sm">
                                    No teams found.
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 pt-2 border-t border-slate-100">
                    <Button variant="ghost" onClick={onClose}>Cancel</Button>
                    <Button onClick={handleSave} disabled={saving || loadingTeams} icon={saving ? Loader2 : Save}>
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                </div>
            </div>
        </div>
    );
};

export default ShareQueryModal;
