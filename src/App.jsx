import React, { useState, useEffect } from 'react';
import { Settings, LogOut, Database, Server, Key, Loader2, AlertCircle, Save, RefreshCw, Globe, Search, Table, FileText, HelpCircle, X } from 'lucide-react';

// Simple UI Components
const Card = ({ children, className = "" }) => (
  <div className={`bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden ${className}`}>
    {children}
  </div>
);

const Input = ({ label, value, onChange, type = "text", placeholder, helpText, disabled = false, onBlur }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
      placeholder={placeholder}
      disabled={disabled}
      className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none disabled:bg-slate-100 disabled:text-slate-500"
    />
    {helpText && <p className="text-xs text-slate-500 mt-1">{helpText}</p>}
  </div>
);

const Select = ({ label, value, onChange, options, placeholder, disabled = false, loading = false }) => (
  <div className="mb-4">
    <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
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

const Toggle = ({ label, checked, onChange, helpText }) => (
  <div className="mb-4 flex items-start gap-3">
    <div className="relative inline-block w-12 mr-2 align-middle select-none transition duration-200 ease-in mt-1">
      <input
        type="checkbox"
        name="toggle"
        id="toggle"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="toggle-checkbox absolute block w-6 h-6 rounded-full bg-white border-4 appearance-none cursor-pointer transition-all duration-300"
        style={{
          right: checked ? '0' : 'auto',
          left: checked ? 'auto' : '0',
          borderColor: checked ? '#16a34a' : '#cbd5e1'
        }}
      />
      <label
        htmlFor="toggle"
        className={`toggle-label block overflow-hidden h-6 rounded-full cursor-pointer transition-colors duration-300 ${checked ? 'bg-green-600' : 'bg-slate-300'}`}
      ></label>
    </div>
    <div className="flex-1">
      <label className="block text-sm font-medium text-slate-700">{label}</label>
      {helpText && <p className="text-xs text-slate-500 mt-0.5">{helpText}</p>}
    </div>
  </div>
);

const HelpSection = ({ onClose }) => (
  <div className="mb-6 bg-blue-50 border border-blue-100 rounded-xl p-4 text-sm text-blue-900 relative">
    <button onClick={onClose} className="absolute top-2 right-2 text-blue-400 hover:text-blue-700">
      <X size={16} />
    </button>
    <h3 className="font-bold flex items-center gap-2 mb-2">
      <HelpCircle size={16} />
      Fixing Connection Issues
    </h3>
    <div className="space-y-3">
      <div>
        <p className="font-semibold">Option 1: Use Your Proxy</p>
        <p className="opacity-80">Enable the <span className="font-bold">"Use CORS Proxy"</span> toggle below. This routes traffic through your custom proxy at <span className="font-mono text-xs">cors-anywhere-production-2644.up.railway.app</span>.</p>
      </div>
      <div>
        <p className="font-semibold">Option 2: Configure Server (Recommended)</p>
        <p className="opacity-80">Add this environment variable to your self-hosted Grist server:</p>
        <code className="block mt-1 bg-blue-100 px-2 py-1 rounded text-xs font-mono">GRIST_CORS_ALLOW_ORIGIN=*</code>
      </div>
    </div>
  </div>
);

// Main App Component
export default function App() {
  // State for Configuration
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('grist_api_key') || '');
  const [serverUrl, setServerUrl] = useState(() => localStorage.getItem('grist_server_url') || 'https://docs.getgrist.com');
  const [docId, setDocId] = useState(() => localStorage.getItem('grist_doc_id') || '');
  const [tableId, setTableId] = useState(() => localStorage.getItem('grist_table_id') || 'Customers');
  const [useProxy, setUseProxy] = useState(() => localStorage.getItem('grist_use_proxy') === 'true');
  const [manualMode, setManualMode] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  // Discovery State
  const [availableDocs, setAvailableDocs] = useState([]);
  const [availableTables, setAvailableTables] = useState([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingTables, setLoadingTables] = useState(false);
  const [discoveryError, setDiscoveryError] = useState(null);

  // State for Application Logic
  const [view, setView] = useState(() => apiKey ? 'data' : 'auth'); // 'auth', 'config', 'data'
  const [records, setRecords] = useState([]);
  const [columns, setColumns] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Save config to local storage when changed
  const saveConfig = () => {
    localStorage.setItem('grist_api_key', apiKey);
    localStorage.setItem('grist_server_url', serverUrl);
    localStorage.setItem('grist_doc_id', docId);
    localStorage.setItem('grist_table_id', tableId);
    localStorage.setItem('grist_use_proxy', useProxy);
  };

  const handleLogout = () => {
    localStorage.removeItem('grist_api_key');
    setApiKey('');
    setRecords([]);
    setView('auth');
  };

  // Helper to construct URL with Proxy if needed
  const getUrl = (path) => {
    let base = serverUrl.trim();
    // Remove trailing slash
    if (base.endsWith('/')) base = base.slice(0, -1);

    // AUTO-CLEAN: If user pasted a full Grist URL (e.g. .../o/docs/...), extract origin.
    try {
      if (base.includes('/o/') || base.includes('/doc/')) {
        const urlObj = new URL(base);
        base = urlObj.origin;
      }
    } catch (e) { }

    let targetUrl = `${base}${path}`;

    // MANDATORY: Always append key=demo to the query parameters
    const separator = targetUrl.includes('?') ? '&' : '?';
    targetUrl = `${targetUrl}${separator}key=demo`;

    if (useProxy) {
      // Using your self-hosted cors-anywhere proxy
      return `https://cors-anywhere-production-2644.up.railway.app/${targetUrl}`;
    }
    return targetUrl;
  };

  const getHeaders = () => {
    const headers = {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    };

    // Cors-anywhere often requires this header to prevent abuse/misuse
    if (useProxy) {
      headers['X-Requested-With'] = 'XMLHttpRequest';
    }

    return headers;
  };

  // --- Discovery Functions ---

  const discoverDocs = async () => {
    if (!apiKey || !serverUrl) return;
    setLoadingDocs(true);
    setDiscoveryError(null);

    try {
      const orgCandidates = new Set();

      // 1. Explicitly add 'docs' (common self-hosted default) and 'current'
      orgCandidates.add('docs');

      // 2. Try to fetch other organizations (Best effort)
      try {
        const orgsRes = await fetch(getUrl('/api/orgs'), { headers: getHeaders() });
        if (orgsRes.ok) {
          const orgs = await orgsRes.json();
          orgs.forEach(o => orgCandidates.add(o.id || o.subdomain));
        }
      } catch (e) {
        console.warn("Could not list orgs, relying on defaults", e);
      }

      let allDocs = [];
      let successCount = 0;

      // 3. Fetch Workspaces for ALL candidates (docs, current, and discovered)
      for (const orgId of orgCandidates) {
        try {
          const wsRes = await fetch(getUrl(`/api/orgs/${orgId}/workspaces`), { headers: getHeaders() });

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
          // It's expected that some candidates might fail
          console.log(`Skipping org '${orgId}':`, err);
        }
      }

      if (allDocs.length === 0) {
        if (successCount === 0) {
          throw new Error("Could not connect to any organization (including 'docs'). Check URL/Proxy.");
        } else {
          setDiscoveryError("Connected, but no documents found.");
        }
      }

      setAvailableDocs(allDocs);
    } catch (err) {
      console.error("Discovery Error:", err);
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        setDiscoveryError("Network blocked (CORS). Enable 'Use CORS Proxy' below or check Help.");
        setShowHelp(true);
      } else {
        setDiscoveryError(`Discovery failed: ${err.message}. Try Manual Mode.`);
      }
    } finally {
      setLoadingDocs(false);
    }
  };

  const discoverTables = async (selectedDocId) => {
    if (!selectedDocId) return;
    setLoadingTables(true);

    try {
      const res = await fetch(getUrl(`/api/docs/${selectedDocId}/tables`), { headers: getHeaders() });
      if (!res.ok) throw new Error("Failed to fetch tables");
      const data = await res.json();

      if (data.tables) {
        const tableOptions = data.tables.map(t => ({
          value: t.id,
          label: t.id // Tables mostly just have IDs in the metadata listing usually
        }));
        setAvailableTables(tableOptions);

        // Auto-select first table if current selection is invalid
        if (tableOptions.length > 0 && !tableOptions.find(t => t.value === tableId)) {
          setTableId(tableOptions[0].value);
        }
      }
    } catch (err) {
      console.error("Table Discovery Error:", err);
    } finally {
      setLoadingTables(false);
    }
  };

  // Effect to trigger table discovery when docId changes (if in auto mode)
  useEffect(() => {
    if (view === 'config' && !manualMode && docId && apiKey) {
      discoverTables(docId);
    }
  }, [docId, manualMode, view]);


  // --- Data Fetching ---

  const fetchData = async () => {
    if (!apiKey || !docId || !tableId) {
      setError("Missing configuration details.");
      setView('config');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const endpoint = getUrl(`/api/docs/${docId}/tables/${tableId}/records`);

      const response = await fetch(endpoint, {
        method: 'GET',
        headers: getHeaders()
      });

      if (!response.ok) {
        const errText = await response.text().catch(() => '');
        if (response.status === 401) throw new Error("Unauthorized (401). Check your API Key.");
        if (response.status === 404) throw new Error("Not Found (404). Check Document/Table ID.");
        if (response.status === 0) throw new Error("CORS Error: Server blocked the request.");
        throw new Error(`Server Error (${response.status}): ${errText.slice(0, 100) || response.statusText}`);
      }

      const data = await response.json();

      if (data.records && data.records.length > 0) {
        const firstRecordFields = data.records[0].fields;
        const cols = Object.keys(firstRecordFields);
        setColumns(cols);
        setRecords(data.records);
        setView('data');
      } else {
        setRecords([]);
        setView('data');
      }

    } catch (err) {
      console.error(err);
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        setError("Network Error: The server blocked the request (CORS). Try enabling 'Use CORS Proxy'.");
        setShowHelp(true);
      } else {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  };

  // Initial load 
  useEffect(() => {
    if (view === 'data' && apiKey && docId) {
      fetchData();
    }
  }, [view]);

  // --- VIEWS ---

  // 1. Authentication View
  if (view === 'auth') {
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

          <Card className="p-6">
            <Input
              label="API Key"
              value={apiKey}
              onChange={setApiKey}
              type="password"
              placeholder="Enter your Grist API Key"
              helpText="Found in Profile Settings > API Key"
            />
            <Button
              className="w-full mt-2"
              onClick={() => {
                if (apiKey) {
                  saveConfig();
                  setView('config');
                }
              }}
              disabled={!apiKey}
            >
              Continue
            </Button>
          </Card>
        </div>
      </div>
    );
  }

  // 2. Configuration View
  if (view === 'config') {
    return (
      <div className="min-h-screen bg-slate-50 p-4">
        <div className="max-w-md mx-auto pt-10">
          <div className="flex items-center justify-between gap-2 mb-6">
            <div className="flex items-center gap-2">
              <Button variant="secondary" onClick={() => setView(records.length > 0 ? 'data' : 'auth')} className="!px-3">
                ←
              </Button>
              <h1 className="text-xl font-bold text-slate-800">Configuration</h1>
            </div>
            <Button variant="ghost" className="!px-3 text-blue-600" onClick={() => setShowHelp(!showHelp)}>
              <HelpCircle size={20} />
            </Button>
          </div>

          {showHelp && <HelpSection onClose={() => setShowHelp(false)} />}

          <Card className="p-6 space-y-4">
            {/* Server Config Section */}
            <div className="pb-4 border-b border-slate-100">
              <Input
                label="Server URL"
                value={serverUrl}
                onChange={setServerUrl}
                placeholder="https://docs.getgrist.com"
                helpText="The base URL of your Grist instance"
                onBlur={() => {
                  // Auto-fix common paste errors
                  try {
                    if (serverUrl.includes('/o/') || serverUrl.includes('/doc/')) {
                      const u = new URL(serverUrl);
                      setServerUrl(u.origin);
                    }
                  } catch (e) { }
                }}
              />

              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-slate-700">Connection Mode</label>
                <button
                  onClick={() => setManualMode(!manualMode)}
                  className="text-xs text-green-600 font-medium hover:underline"
                >
                  {manualMode ? "Switch to Auto-Discovery" : "Switch to Manual Entry"}
                </button>
              </div>

              {!manualMode && (
                <Button
                  variant="outline"
                  className="w-full mb-2"
                  onClick={discoverDocs}
                  disabled={loadingDocs}
                  icon={Search}
                >
                  {loadingDocs ? "Scanning for Documents..." : "Find My Documents"}
                </Button>
              )}

              {discoveryError && !manualMode && (
                <div className="text-xs text-red-600 bg-red-50 p-2 rounded border border-red-100 mb-4 font-medium break-words">
                  {discoveryError}
                </div>
              )}
            </div>

            {/* Doc & Table Selection */}
            <div className="grid grid-cols-1 gap-4">
              {manualMode ? (
                <>
                  <Input
                    label="Document ID"
                    value={docId}
                    onChange={setDocId}
                    placeholder="e.g., s5577s9d0s..."
                  />
                  <Input
                    label="Table ID"
                    value={tableId}
                    onChange={setTableId}
                    placeholder="Customers"
                  />
                </>
              ) : (
                <>
                  <Select
                    label="Document"
                    value={docId}
                    onChange={setDocId}
                    options={availableDocs}
                    placeholder={availableDocs.length ? "Select a Document" : "No documents loaded"}
                    disabled={availableDocs.length === 0}
                  />
                  <Select
                    label="Table"
                    value={tableId}
                    onChange={setTableId}
                    options={availableTables}
                    placeholder={docId ? "Select a Table" : "Select Document First"}
                    disabled={!docId}
                    loading={loadingTables}
                  />
                </>
              )}
            </div>

            <div className="pt-2 border-t border-slate-100">
              <Toggle
                label="Use CORS Proxy"
                checked={useProxy}
                onChange={setUseProxy}
                helpText="Enable if you see 'Failed to fetch' or Network errors."
              />
            </div>

            <div className="pt-2 flex gap-3">
              <Button
                variant="secondary"
                className="flex-1"
                onClick={handleLogout}
                icon={LogOut}
              >
                Logout
              </Button>
              <Button
                className="flex-1"
                onClick={() => {
                  saveConfig();
                  fetchData();
                }}
                icon={Save}
              >
                Save & Fetch
              </Button>
            </div>
          </Card>

          {error && (
            <div className="mt-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 text-sm flex gap-2 items-start">
              <AlertCircle size={16} className="mt-0.5 shrink-0" />
              <div className="break-words">
                <p className="font-medium">Connection Error</p>
                <p>{error}</p>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // 3. Data View (Main)
  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-5xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white">
              <Database size={18} />
            </div>
            <h1 className="font-bold text-slate-800 hidden sm:block">{tableId}</h1>
          </div>

          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={fetchData}
              disabled={loading}
              className="!px-3"
            >
              <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
            </Button>
            <Button
              variant="secondary"
              onClick={() => setView('config')}
              className="!px-3"
            >
              <Settings size={18} />
            </Button>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 p-4 overflow-auto">
        <div className="max-w-5xl mx-auto">

          {error && (
            <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-center">
              <AlertCircle size={18} />
              <span>{error}</span>
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
                  <p>No records found in this table.</p>
                  <Button variant="outline" className="mt-4 mx-auto" onClick={() => setView('config')}>
                    Check Configuration
                  </Button>
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
    </div>
  );
}
