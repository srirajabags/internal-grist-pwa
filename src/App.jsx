import React, { useState, useEffect } from 'react';
import { Settings, LogOut, Database, Loader2, AlertCircle, RefreshCw, Search, X, User } from 'lucide-react';
import { useAuth0 } from '@auth0/auth0-react';

// Get server URL from environment
const GRIST_SERVER_URL = import.meta.env.VITE_GRIST_SERVER_URL;

// Simple UI Components
const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Select = ({ label, value, onChange, options, placeholder, disabled = false, loading = false, className = "" }) => (
  <div className={className}>
    {label && <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>}
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled || loading}
        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none disabled:bg-slate-100 disabled:text-slate-500 appearance-none bg-white"
      >
        <option value="">{loading ? "Loading..." : placeholder}</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      <div className="absolute inset-y-0 right-0 flex items-center px-2 pointer-events-none text-slate-500">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" /></svg>}
      </div>
    </div>
  </div>
);

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

// Settings Modal Component
const SettingsModal = ({ onClose, user, onLogout }) => (
  <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={onClose}>
    <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-xl font-bold text-slate-800">Settings</h2>
        <button onClick={onClose} className="text-slate-400 hover:text-slate-700">
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

      {/* Server Info */}
      <div className="mb-4 p-3 bg-slate-50 rounded-lg">
        <p className="text-xs font-medium text-slate-600 mb-1">Grist Server</p>
        <p className="text-sm text-slate-800 font-mono break-all">{GRIST_SERVER_URL}</p>
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
);

// Main App Component
export default function App() {
  const { loginWithRedirect, logout, user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();

  // State for Document/Table Selection
  const [docId, setDocId] = useState('');
  const [tableId, setTableId] = useState('');

  // Discovery State
  const [availableDocs, setAvailableDocs] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);

  // State for Application Logic
  const [records, setRecords] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  const handleLogout = () => {
    logout({ logoutParams: { returnTo: window.location.origin } });
  };

  // Helper to construct URL
  const getUrl = (path) => {
    let base = GRIST_SERVER_URL.trim();
    // Remove trailing slash
    if (base.endsWith('/')) base = base.slice(0, -1);
    return `${base}${path}`;
  };

  const getHeaders = async () => {
    try {
      const token = await getAccessTokenSilently();
      return {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };
    } catch (e) {
      console.error("Failed to get access token", e);
      throw new Error("Failed to authenticate with Auth0");
    }
  };

  // --- Discovery Functions ---

  const discoverDocs = async () => {
    setLoadingDocs(true);
    setError(null);

    try {
      const headers = await getHeaders();
      const orgCandidates = new Set();

      // 1. Explicitly add 'docs' (common self-hosted default)
      orgCandidates.add('docs');

      // 2. Try to fetch other organizations (Best effort)
      try {
        const orgsRes = await fetch(getUrl('/api/orgs'), { headers });
        if (orgsRes.ok) {
          const orgs = await orgsRes.json();
          orgs.forEach(o => orgCandidates.add(o.id || o.subdomain));
        }
      } catch (e) {
        console.warn("Could not list orgs, relying on defaults", e);
      }

      let allDocs = [];
      let successCount = 0;

      // 3. Fetch Workspaces for ALL candidates
      for (const orgId of orgCandidates) {
        try {
          const wsRes = await fetch(getUrl(`/api/orgs/${orgId}/workspaces`), { headers });

          if (wsRes.ok) {
            const workspaces = await wsRes.json();
            successCount++;
            workspaces.forEach(ws => {
              if (ws.docs && Array.isArray(ws.docs)) {
                ws.docs.forEach(doc => {
                  allDocs.push({
                    value: doc.id,
                    label: `${doc.name} (${orgId})`
                  });
                });
              }
            });
          }
        } catch (err) {
          console.log(`Skipping org '${orgId}':`, err);
        }
      }

      if (allDocs.length === 0) {
        if (successCount === 0) {
          throw new Error("Could not connect to any organization. Check server URL and CORS configuration.");
        } else {
          setError("Connected, but no documents found.");
        }
      }

      setAvailableDocs(allDocs);

      // Auto-select first doc if none selected
      if (allDocs.length > 0 && !docId) {
        setDocId(allDocs[0].value);
      }
    } catch (err) {
      console.error("Discovery Error:", err);
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        setError("Network blocked (CORS). Please configure GRIST_CORS_ALLOW_ORIGIN on your Grist server.");
      } else {
        setError(`Discovery failed: ${err.message}`);
      }
    } finally {
      setLoadingDocs(false);
    }
  };

  const discoverTables = async (selectedDocId) => {
    if (!selectedDocId) return;
    setLoadingTables(true);

    try {
      const headers = await getHeaders();
      const res = await fetch(getUrl(`/api/docs/${selectedDocId}/tables`), { headers });
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();

      if (data.tables) {
        const tableOptions = data.tables.map(t => ({
          value: t.id,
          label: t.id
        }));
        setAvailableTables(tableOptions);

        // Auto-select first table if none selected or current is invalid
        if (tableOptions.length > 0 && !tableOptions.find(t => t.value === tableId)) {
          setTableId(tableOptions[0].value);
        }
      }
    } catch (err) {
      console.error("Table Discovery Error:", err);
      setError(`Failed to load tables: ${err.message}`);
    } finally {
      setLoadingTables(false);
    }
  };

  // Auto-discover docs when authenticated
  useEffect(() => {
    if (isAuthenticated && availableDocs.length === 0) {
      discoverDocs();
    }
  }, [isAuthenticated]);

  // Auto-discover tables when docId changes
  useEffect(() => {
    if (docId && isAuthenticated) {
      discoverTables(docId);
    } else {
      setAvailableTables([]);
      setTableId('');
    }
  }, [docId, isAuthenticated]);

  // --- Data Fetching ---

  const fetchData = async () => {
    if (!docId || !tableId) {
      setError("Please select a document and table.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers = await getHeaders();
      const endpoint = getUrl(`/api/docs/${docId}/tables/${tableId}/records`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 401) throw new Error("Unauthorized (401). Check your Auth0 login.");
        if (response.status === 404) throw new Error("Not Found (404). Check Document/Table ID.");
        throw new Error(`Server Error (${response.status}): ${errText.slice(0, 100) || response.statusText}`);
      }

      const data = await response.json();

      if (data.records && data.records.length > 0) {
        const firstRecordFields = data.records[0].fields;
        const cols = Object.keys(firstRecordFields);
        setColumns(cols);
        setRecords(data.records);
      } else {
        setRecords([]);
        setColumns([]);
      }

    } catch (err) {
      console.error(err);
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        setError("Network Error: The server blocked the request (CORS). Please configure GRIST_CORS_ALLOW_ORIGIN on your Grist server.");
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Auto-fetch data when table selection changes
  useEffect(() => {
    if (tableId && docId && isAuthenticated) {
      fetchData();
    }
  }, [tableId, docId, isAuthenticated]);

  // --- VIEWS ---

  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-green-600" />
      </div>
    );
  }

  // Authentication View
  if (!isAuthenticated) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="max-w-md w-full">
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-green-600 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg text-white">
              <Database size={32} />
            </div>
            <h1 className="text-2xl font-bold text-slate-800">Grist Connector</h1>
            <p className="text-slate-500">Connect to your data securely</p>
          </div>

          <Card className="p-6 text-center">
            <p className="mb-6 text-slate-600">Please log in to access your Grist data.</p>
            <Button
              className="w-full"
              onClick={() => loginWithRedirect()}
            >
              Log In
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // Main Data View
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white">
              <Database size={18} />
            </div>
            <h1 className="font-bold text-slate-800">Grist Connector</h1>
          </div>

          {/* Document and Table Selectors */}
          <div className="flex gap-2 flex-1 max-w-2xl">
            <Select
              value={docId}
              onChange={setDocId}
              options={availableDocs}
              placeholder="Select Document"
              disabled={availableDocs.length === 0}
              loading={loadingDocs}
              className="flex-1"
            />
            <Select
              value={tableId}
              onChange={setTableId}
              options={availableTables}
              placeholder="Select Table"
              disabled={!docId || availableTables.length === 0}
              loading={loadingTables}
              className="flex-1"
            />
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={fetchData}
              disabled={loading || !docId || !tableId}
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

      {/* Content */}
      <main className="flex-1 p-4 overflow-auto">
        <div className="max-w-7xl mx-auto">

          {error && (
            <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {loading && records.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Loader2 size={40} className="animate-spin mb-4 text-green-600" />
              <p>Loading data from Grist...</p>
            </div>
          ) : (
            <>
              {records.length === 0 ? (
                <div className="text-center py-20 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                  <Database size={48} className="mx-auto mb-4 text-slate-300" />
                  <p className="text-lg font-medium mb-2">No Data</p>
                  <p className="text-sm">
                    {!docId || !tableId
                      ? "Select a document and table to view data"
                      : "No records found in this table"}
                  </p>
                </div>
              ) : (
                <Card className="overflow-x-auto">
                  <table className="w-full text-left text-sm">
                    <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 font-medium uppercase tracking-wider">
                      <tr>
                        {columns.map((col) => (
                          <th key={col} className="px-4 py-3 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {records.map((record) => (
                        <tr key={record.id} className="hover:bg-slate-50 transition-colors">
                          {columns.map((col) => (
                            <td key={`${record.id}-${col}`} className="px-4 py-3 text-slate-700 whitespace-nowrap">
                              {String(record.fields[col] ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
              )}
            </>
          )}
        </div>
      </main>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          user={user}
          onLogout={handleLogout}
        />
      )}
    </div>
  );
}
