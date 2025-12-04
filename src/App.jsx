import React, { useState, useEffect, useMemo } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Settings, LogOut, Database, Loader2, AlertCircle, RefreshCw, Search, X, User, Phone, CheckSquare, Table, Home, ArrowLeft, Factory, Code, History, Save, Pin, Trash2, Clock, BarChart2, LayoutDashboard, Users } from 'lucide-react';
import SqlVisualization from './components/SqlVisualization';
import DashboardList from './components/DashboardList';
import DashboardView from './components/DashboardView';
import Card from './components/Card';
import Button from './components/Button';
import { useAuth0 } from '@auth0/auth0-react';

// Get server URL from environment
const GRIST_SERVER_URL = import.meta.env.VITE_GRIST_SERVER_URL;

// Simple UI Components


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



// Settings Modal Component
const SettingsModal = ({ onClose, user, onLogout, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => (
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
          {user?.originalUser && (
            <p className="text-xs text-slate-400 mt-1">
              Logged in as: {user.originalUser.email}
            </p>
          )}
        </div>
      </div>

      {/* Impersonation Section */}
      <div className="mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
        <label className="block text-sm font-medium text-slate-700 mb-2">
          Impersonate User
        </label>

        {impersonateEmail && (
          <div className="mb-3 p-2 bg-amber-50 border border-amber-200 rounded-lg flex items-center gap-2">
            <AlertCircle size={16} className="text-amber-600 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-amber-800">Currently Impersonating</p>
              <p className="text-xs text-amber-700 truncate">{impersonateEmail}</p>
            </div>
          </div>
        )}

        <select
          value={impersonateEmail}
          onChange={(e) => setImpersonateEmail(e.target.value)}
          disabled={loadingTeamMembers}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 transition-all outline-none disabled:bg-slate-100 disabled:text-slate-500 appearance-none bg-white mb-2"
        >
          <option value="">
            {loadingTeamMembers ? 'Loading members...' : 'Select a team member...'}
          </option>
          {teamMembers.map((member) => (
            <option key={member.Email} value={member.Email}>
              {member.Name} ({member.Email})
            </option>
          ))}
        </select>

        {impersonateEmail && (
          <button
            onClick={() => setImpersonateEmail('')}
            className="w-full px-3 py-2 text-sm bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg transition-colors"
          >
            Clear Impersonation
          </button>
        )}

        <p className="text-xs text-slate-500 mt-2">
          View data as another team member for support or testing purposes.
        </p>
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

// Home Page Component
const HomePage = ({ onNavigate, user, onLogout, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => {
  const [showSettings, setShowSettings] = useState(false);

  const pageOptions = [
    {
      id: 'dashboards',
      title: 'Data Dashboards',
      description: 'View and manage your data dashboards',
      icon: LayoutDashboard,
      color: 'bg-indigo-600',
      hoverColor: 'hover:bg-indigo-700'
    },
    {
      id: 'factory',
      title: 'Factory View',
      description: 'View today\'s factory updates',
      icon: Factory,
      color: 'bg-orange-600',
      hoverColor: 'hover:bg-orange-700'
    },
    {
      id: 'telecaller',
      title: 'Telecaller View',
      description: 'Manage telecaller operations and calls',
      icon: Phone,
      color: 'bg-blue-600',
      hoverColor: 'hover:bg-blue-700'
    },
    {
      id: 'salesman',
      title: 'Salesman View',
      description: 'Manage salesman visits and conversations',
      icon: User,
      color: 'bg-indigo-600',
      hoverColor: 'hover:bg-indigo-700'
    },
    {
      id: 'design',
      title: 'Design Confirmation View',
      description: 'Review and confirm design submissions',
      icon: CheckSquare,
      color: 'bg-purple-600',
      hoverColor: 'hover:bg-purple-700'
    },
    {
      id: 'table',
      title: 'Custom Table Viewer',
      description: 'View and explore Grist data tables',
      icon: Table,
      color: 'bg-green-600',
      hoverColor: 'hover:bg-green-700'
    },
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white">
                <Database size={24} />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-slate-800">SRB Grist PWA</h1>
                <p className="text-sm text-slate-500">Select a view to get started</p>
              </div>
            </div>
            <button
              onClick={() => setShowSettings(true)}
              className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              aria-label="Settings"
            >
              <Settings size={24} className="text-slate-600" />
            </button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {pageOptions.map((option) => {
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  onClick={() => onNavigate(option.id)}
                  className="group bg-white rounded-2xl shadow-sm border border-slate-200 p-6 hover:shadow-lg transition-all duration-200 text-left hover:scale-105"
                >
                  <div className={`w-16 h-16 ${option.color} rounded-xl flex items-center justify-center mb-4 group-hover:scale-110 transition-transform duration-200`}>
                    <Icon size={32} className="text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-800 mb-2">{option.title}</h3>
                  <p className="text-slate-600 text-sm">{option.description}</p>
                </button>
              );
            })}
          </div>
        </div>
      </main>


      {
        showSettings && (
          <SettingsModal
            onClose={() => setShowSettings(false)}
            user={user}
            onLogout={onLogout}
            impersonateEmail={impersonateEmail}
            setImpersonateEmail={setImpersonateEmail}
            teamMembers={teamMembers}
            loadingTeamMembers={loadingTeamMembers}
          />
        )
      }
    </div>
  );
};

// Wrapper to extract params for DashboardView
import { useParams } from 'react-router-dom';
const DashboardWrapper = (props) => {
  const { id } = useParams();
  return <DashboardView {...props} dashboardId={id} />;
};

import TelecallerView from './pages/TelecallerView';
import TelecallerCustomerView from './pages/TelecallerCustomerView';
import SalesmanView from './pages/SalesmanView';
import SalesmanCustomerView from './pages/SalesmanCustomerView';

// Design Confirmation View Component (Placeholder)
const DesignConfirmationView = ({ onBack, user, onLogout, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => {

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onBack} className="!px-2">
              <ArrowLeft size={20} />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-purple-600 rounded-lg flex items-center justify-center text-white">
                <CheckSquare size={18} />
              </div>
              <h1 className="font-bold text-slate-800">Design Confirmation View</h1>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <Card className="p-8 text-center">
            <CheckSquare size={64} className="mx-auto mb-4 text-purple-600" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Design Confirmation View</h2>
            <p className="text-slate-600 mb-4">
              This view is ready to be customized with design confirmation functionality.
            </p>
            <p className="text-sm text-slate-500">
              Connect this view to your Grist data to review and confirm design submissions.
            </p>
          </Card>
        </div>
      </main>
    </div>
  );
};

// Image Preview Modal
const ImagePreviewModal = ({ src, onClose, loading }) => (
  <div className="fixed inset-0 bg-black bg-opacity-90 flex items-center justify-center z-50 p-4" onClick={onClose}>
    <button
      onClick={onClose}
      className="absolute top-4 right-4 text-white hover:text-slate-300 p-2"
    >
      <X size={32} />
    </button>

    <div className="max-w-4xl max-h-[90vh] w-full flex items-center justify-center" onClick={e => e.stopPropagation()}>
      {loading ? (
        <div className="text-white flex flex-col items-center">
          <Loader2 size={48} className="animate-spin mb-4" />
          <p>Loading image...</p>
        </div>
      ) : src ? (
        <img
          src={src}
          alt="Preview"
          className="max-w-full max-h-[90vh] object-contain rounded-lg shadow-2xl"
          onError={(e) => console.error("Image load error in modal:", e)}
        />
      ) : (
        <div className="text-white text-center">
          <AlertCircle size={48} className="mx-auto mb-4 text-red-400" />
          <p>Image not available</p>
        </div>
      )}
    </div>
  </div>
);

// Factory View Component
const FactoryView = ({ onBack, user, onLogout, getHeaders, getUrl, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Preview State
  const [previewImage, setPreviewImage] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Filter State
  const [selectedPlate, setSelectedPlate] = useState('');
  // Default to today's date in YYYY-MM-DD format
  const [selectedDate, setSelectedDate] = useState(new Date().toLocaleDateString('en-CA'));
  const [selectedPrint, setSelectedPrint] = useState('');
  const [availablePlates, setAvailablePlates] = useState([]);
  const [availablePrints, setAvailablePrints] = useState([]);

  const DOC_ID = '8vRFY3UUf4spJroktByH4u';
  const TABLE_ID = 'Sub_Orders';
  const ORDERS_TABLE_ID = 'Orders';

  // Helper to extract ID from Grist fields (handles ['L', id] and ['R', 'Table', id] formats)
  const extractId = (val) => {
    if (!val) return null;

    // Handle single Reference ['R', 'Table', ID]
    if (Array.isArray(val) && val[0] === 'R' && val.length >= 3) {
      return val[2];
    }

    if (Array.isArray(val)) {
      const clean = val.filter(v => v !== 'L');
      const first = clean[0];

      // Handle list of References [['R', 'Table', ID], ...]
      if (Array.isArray(first) && first[0] === 'R' && first.length >= 3) {
        return first[2];
      }

      // Handle list of IDs [ID, ...] or objects [{id: ID}, ...]
      return (first && typeof first === 'object') ? first.id : first;
    }

    return typeof val === 'object' ? val.id : val;
  };

  // Helper to format date for display and comparison
  const formatDate = (dateVal) => {
    if (!dateVal) return null;
    let date;
    if (typeof dateVal === 'number') {
      date = new Date(dateVal * 1000);
    } else {
      date = new Date(dateVal);
    }
    return date.toLocaleDateString('en-CA'); // YYYY-MM-DD
  };

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getHeaders();

      // Construct SQL Query to join tables and fetch all necessary data
      // We select specific columns to match the previous logic and new requirements
      const sqlQuery = `
        SELECT 
          so.id, 
          so.Factory_Updated_Date, 
          so.Material, 
          so.Model, 
          so.Plate, 
          so.Print, 
          so.Customer, 
          so."Order",
          so.Design_Version,
          so.Bag_Width,
          so.Bag_Height,
          c.Shop_Name,
          o.Order_ID,
          o.Order_Form,
          cc.Screenshots
        FROM Sub_Orders so
        LEFT JOIN Customers c ON so.Customer = c.id
        LEFT JOIN Orders o ON so."Order" = o.id
        LEFT JOIN Customer_Conversations cc 
          ON (cc.Outcomes LIKE '%FINALISED DESIGN%') AND so.id = cc.Sub_Order_in_Context
        WHERE so.Factory_Updated_Date = ?
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
          args: [`${(new Date(selectedDate)).getTime() / 1000}`]
        })
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.statusText}`);
      }

      const data = await response.json();
      const allRecords = data.records || [];

      // Extract unique values for filters
      const plates = new Set();
      const prints = new Set();

      allRecords.forEach(r => {
        if (r.fields['Plate']) plates.add(r.fields['Plate']);
        if (r.fields['Print']) prints.add(r.fields['Print']);
      });

      setAvailablePlates(Array.from(plates).sort());
      setAvailablePrints(Array.from(prints).sort());

      setRecords(allRecords);
    } catch (err) {
      console.error("Factory View Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [selectedDate]);

  // Filter records based on selection
  const filteredRecords = records.filter(record => {
    const recordPlate = record.fields['Plate'];
    const recordPrint = record.fields['Print'];

    const plateMatch = !selectedPlate || recordPlate === selectedPlate;
    const printMatch = !selectedPrint || recordPrint === selectedPrint;

    return plateMatch && printMatch;
  });

  // Helper to parse attachment ID from stringified array (e.g. "[2996]")
  const parseAttachmentId = (val) => {
    if (!val) return null;
    try {
      // Handle if it's already an array or number
      if (typeof val === 'number') return val;
      if (Array.isArray(val)) return val[0];

      // Handle stringified array or number
      // If it's a simple number string "123", JSON.parse handles it
      const parsed = JSON.parse(val);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed[0];
      }
      if (typeof parsed === 'number') {
        return parsed;
      }
      return null;
    } catch (e) {
      console.warn("Failed to parse attachment ID", val, e);
      return null;
    }
  };

  const fetchAndDisplayImage = async (attachmentValue, typeLabel) => {
    console.log(`Fetching ${typeLabel} with value:`, attachmentValue);
    const attId = parseAttachmentId(attachmentValue);
    console.log(`Parsed ID for ${typeLabel}:`, attId);

    if (!attId) {
      alert(`No ${typeLabel} attachment found`);
      return;
    }

    setLoadingPreview(true);
    setPreviewImage(null);

    try {
      const headers = await getHeaders();
      const imgUrl = getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`);
      console.log(`Fetching ${typeLabel} from:`, imgUrl);

      const imgRes = await fetch(imgUrl, { headers });
      console.log(`${typeLabel} fetch status:`, imgRes.status);

      const contentType = imgRes.headers.get('content-type');
      console.log(`${typeLabel} Content-Type:`, contentType);

      if (!imgRes.ok) {
        throw new Error(`Failed to download image: ${imgRes.status} ${imgRes.statusText}`);
      }

      // Check if response is JSON (error) despite 200 OK
      if (contentType && contentType.includes('application/json')) {
        const json = await imgRes.json();
        console.error("Received JSON instead of image:", json);
        throw new Error(`Server returned JSON: ${JSON.stringify(json)}`);
      }

      const blob = await imgRes.blob();
      console.log(`${typeLabel} Blob size:`, blob.size, "type:", blob.type);

      if (blob.size === 0) {
        throw new Error("Received empty image");
      }

      const objectUrl = URL.createObjectURL(blob);
      setPreviewImage(objectUrl);

    } catch (err) {
      console.error(`${typeLabel} Preview Error:`, err);
      alert(`Error loading ${typeLabel}: ${err.message}`);
      setPreviewImage(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const openPreview = (attachmentValue) => {
    fetchAndDisplayImage(attachmentValue, "Order Form");
  };

  const openScreenshotPreview = (attachmentValue) => {
    fetchAndDisplayImage(attachmentValue, "Screenshot");
  };

  const closePreview = () => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setLoadingPreview(false);
  };

  const handleOpenLink = (url) => {
    if (url) {
      window.open(url, '_blank');
    } else {
      alert("Link not available");
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col gap-3">
          <div className="flex justify-between items-center">
            <div className="flex items-center gap-3">
              <Button variant="ghost" onClick={onBack} className="!px-2">
                <ArrowLeft size={20} />
              </Button>
              <div className="flex items-center gap-2">
                <div className="w-8 h-8 bg-orange-600 rounded-lg flex items-center justify-center text-white">
                  <Factory size={18} />
                </div>
                <h1 className="font-bold text-slate-800">Factory View</h1>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                onClick={() => fetchData()}
                disabled={loading}
                className="!px-3"
              >
                <RefreshCw size={18} className={loading ? "animate-spin" : ""} />
              </Button>
            </div>
          </div>

          {/* Filters */}
          <div className="flex gap-3">
            <div className="flex-1 relative">
              <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Date</label>
              <input
                type="date"
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500 transition-all outline-none bg-white"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Plate</label>
              <Select
                value={selectedPlate}
                onChange={setSelectedPlate}
                options={availablePlates.map(p => ({ value: p, label: p }))}
                placeholder="All Plates"
                className="w-full"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">Print</label>
              <Select
                value={selectedPrint}
                onChange={setSelectedPrint}
                options={availablePrints.map(p => ({ value: p, label: p }))}
                placeholder="All Prints"
                className="w-full"
              />
            </div>
          </div>
        </div>
      </header>

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

          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-slate-400">
              <Loader2 size={40} className="animate-spin mb-4 text-orange-600" />
              <p>Loading factory updates...</p>
            </div>
          ) : (
            <>
              {filteredRecords.length === 0 ? (
                <div className="text-center py-20 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
                  <Factory size={48} className="mx-auto mb-4 text-slate-300" />
                  <p className="text-lg font-medium mb-2">No Records Found</p>
                  <p className="text-sm">Try adjusting your filters.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {filteredRecords.map((record) => (
                    <Card key={record.id} className="p-4 flex flex-col gap-4 hover:shadow-md transition-shadow">
                      <div>
                        <div className="mb-3 pb-3 border-b border-slate-100 flex justify-between items-start gap-2">
                          <h3 className="font-bold text-xl text-slate-800 leading-tight">
                            {record.fields.Shop_Name || 'Unknown Customer'}
                          </h3>
                          <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
                            #{record.fields.Order_ID || record.fields.Order}
                          </span>
                        </div>

                        <div className="space-y-2 text-sm text-slate-600">
                          <div className="flex justify-between">
                            <span className="text-slate-500">Updated:</span>
                            <span className="font-medium">{formatDate(record.fields['Factory_Updated_Date'])}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Material:</span>
                            <span className="font-medium">{record.fields['Material']}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Model:</span>
                            <span className="font-medium">{record.fields['Model']}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Plate:</span>
                            <span className="font-medium">{record.fields['Plate']}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Print:</span>
                            <span className="font-medium">{record.fields['Print']}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Design Version:</span>
                            <span className="font-medium">{record.fields['Design_Version']}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-slate-500">Size:</span>
                            <span className="font-medium">
                              {record.fields['Bag_Width']} X {record.fields['Bag_Height']}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-auto flex flex-col gap-2 pt-2">
                        <Button
                          variant="outline"
                          className="w-full text-sm"
                          onClick={() => openPreview(record.fields['Order_Form'])}
                        >
                          View Order Form
                        </Button>
                        <Button
                          variant="primary"
                          className="w-full text-sm bg-orange-600 hover:bg-orange-700"
                          onClick={() => openScreenshotPreview(record.fields['Screenshots'])}
                        >
                          View Finalisation Screenshot
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </main>

      {/* Image Preview Modal */}
      {(loadingPreview || previewImage) && (
        <ImagePreviewModal
          src={previewImage}
          loading={loadingPreview && !previewImage}
          onClose={closePreview}
        />
      )}
    </div>
  );
};

// Custom Table Viewer Component (Extracted from main App)
const CustomTableViewer = ({ onBack, user, onLogout, getHeaders, getUrl, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => {
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

  // Auto-discover docs when component mounts
  useEffect(() => {
    if (availableDocs.length === 0) {
      discoverDocs();
    }
  }, []);

  // Auto-discover tables when docId changes
  useEffect(() => {
    if (docId) {
      discoverTables(docId);
    } else {
      setAvailableTables([]);
      setTableId('');
    }
  }, [docId]);

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
    if (tableId && docId) {
      fetchData();
    }
  }, [tableId, docId]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row gap-3 sm:justify-between sm:items-center">
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={onBack} className="!px-2">
              <ArrowLeft size={20} />
            </Button>
            <div className="w-8 h-8 bg-green-600 rounded-lg flex items-center justify-center text-white">
              <Table size={18} />
            </div>
            <h1 className="font-bold text-slate-800">Custom Table Viewer</h1>
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
    </div>
  );
};

// SQL Analysis View Component
import { fetchPwaData, savePwaData, deletePwaData, fetchPwaDataSql } from './utils/gristDataSync';
import ShareQueryModal from './components/ShareQueryModal';

const PWA_DATA_DOC_ID = '8vRFY3UUf4spJroktByH4u';

const SQLAnalysisView = ({ onBack, user, teamId, onLogout, getHeaders, getUrl, impersonateEmail, setImpersonateEmail, teamMembers, loadingTeamMembers }) => {
  const [docs, setDocs] = useState([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [sqlQuery, setSqlQuery] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Visualization State
  const [viewMode, setViewMode] = useState('table'); // 'table' | 'chart'
  const [vizConfig, setVizConfig] = useState({});

  // Query History & Saved Queries
  const [queryHistory, setQueryHistory] = useState([]);
  const [savedQueries, setSavedQueries] = useState([]);
  const [showHistoryPanel, setShowHistoryPanel] = useState(false);
  const [showSaveDialog, setShowSaveDialog] = useState(false);
  const [saveQueryName, setSaveQueryName] = useState('');

  // Sharing State
  const [showShareModal, setShowShareModal] = useState(false);
  const [queryToShare, setQueryToShare] = useState(null);

  // Load history from localStorage on mount
  useEffect(() => {
    try {
      const storedHistory = localStorage.getItem('sql_query_history');
      if (storedHistory) {
        setQueryHistory(JSON.parse(storedHistory));
      }
    } catch (e) {
      console.error('Error loading query history:', e);
    }
  }, []);

  // Fetch saved queries from Grist
  const fetchSavedQueries = async () => {
    try {
      // 1. Fetch from Grist using SQL (filtered by teamId)
      const gristRecords = await fetchPwaDataSql(PWA_DATA_DOC_ID, 'SQL_QUERY', teamId, getHeaders, getUrl);

      // 2. Parse Grist data
      const remoteQueries = gristRecords.map(r => {
        try {
          const parsed = JSON.parse(r.fields.Data);
          return {
            ...parsed,
            uuid: r.fields.UUID, // Ensure UUID from Grist is used
            sharedWith: r.fields.Shared_With, // Store sharedWith info
            createdBy: r.fields.Created_By // Store owner info
          };
        } catch (e) {
          console.warn("Failed to parse Grist record", r);
          return null;
        }
      }).filter(Boolean);

      // 3. Set State (Source of Truth is Grist)
      setSavedQueries(remoteQueries);

    } catch (err) {
      console.error("Fetch Error:", err);
    }
  };

  // Fetch saved queries when history panel opens
  useEffect(() => {
    if (showHistoryPanel) {
      fetchSavedQueries();
    }
  }, [showHistoryPanel]);

  // Save query to history (max 50)
  const addToHistory = (query, docId) => {
    const historyItem = {
      id: Date.now(),
      query,
      docId,
      vizConfig,
      timestamp: new Date().toISOString(),
    };

    setQueryHistory(prev => {
      const newHistory = [historyItem, ...prev.filter(h => h.query !== query || h.docId !== docId)];
      const trimmed = newHistory.slice(0, 50); // Keep only last 50
      localStorage.setItem('sql_query_history', JSON.stringify(trimmed));
      return trimmed;
    });
  };

  // Save query with custom name
  const saveQueryWithName = () => {
    if (!saveQueryName.trim() || !sqlQuery.trim()) return;

    const newUuid = crypto.randomUUID();
    const savedItem = {
      id: Date.now(), // Keep for legacy or sorting
      uuid: newUuid,
      name: saveQueryName.trim(),
      query: sqlQuery,
      docId: selectedDocId,
      vizConfig,
      timestamp: new Date().toISOString(),
      pinned: false,
      createdBy: teamId,
    };

    setSavedQueries(prev => [...prev, savedItem]);

    // Sync to Grist
    savePwaData(PWA_DATA_DOC_ID, [savedItem], 'SQL_QUERY', getHeaders, getUrl);

    setSaveQueryName('');
    setShowSaveDialog(false);
  };

  // Toggle pin status
  const togglePin = (id) => {
    setSavedQueries(prev => {
      const updated = prev.map(q => q.id === id ? { ...q, pinned: !q.pinned } : q);

      // Sync to Grist (Update the specific item)
      const item = updated.find(q => q.id === id);
      if (item) {
        savePwaData(PWA_DATA_DOC_ID, [item], 'SQL_QUERY', getHeaders, getUrl);
      }

      return updated;
    });
  };

  // Share Query Logic
  const handleShare = (query) => {
    setQueryToShare(query);
    setShowShareModal(true);
  };

  const saveSharing = async (sharedWithIds) => {
    if (!queryToShare) return;

    // Update local state
    // Update local state
    setSavedQueries(prev => prev.map(q => {
      if (q.id === queryToShare.id) {
        return { ...q, sharedWith: sharedWithIds };
      }
      return q;
    }));

    // Construct the record to save
    const recordToSave = {
      ...queryToShare,
      sharedWith: sharedWithIds
    };

    try {
      const headers = await getHeaders();
      const url = getUrl(`/api/docs/${PWA_DATA_DOC_ID}/tables/PWA_Data/records`);

      // We need the Row ID to update. Do we have it?
      // We have UUID. We can use 'require' to update based on UUID.
      sharedWithIds.unshift("L")
      const payload = {
        records: [{
          require: {
            UUID: queryToShare.uuid
          },
          fields: {
            Shared_With: sharedWithIds // Use Grist ReferenceList notation
          }
        }]
      };

      await fetch(url, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

    } catch (e) {
      console.error("Failed to save sharing", e);
      setError("Failed to save sharing settings");
    }
  };

  // Delete saved query
  const deleteSavedQuery = (id) => {
    setSavedQueries(prev => {
      const itemToDelete = prev.find(q => q.id === id);
      const updated = prev.filter(q => q.id !== id);

      // Sync Delete to Grist
      if (itemToDelete && itemToDelete.uuid) {
        deletePwaData(PWA_DATA_DOC_ID, [itemToDelete.uuid], getHeaders, getUrl);
      }

      return updated;
    });
  };

  // Load query from history or saved
  const loadQuery = (query, docId, savedVizConfig = {}) => {
    setSqlQuery(query);
    if (docId) setSelectedDocId(docId);
    if (savedVizConfig && Object.keys(savedVizConfig).length > 0) {
      setVizConfig(savedVizConfig);
      setViewMode('chart');
    } else {
      setVizConfig({});
      setViewMode('table');
    }
    setShowHistoryPanel(false);
  };

  // Fetch available documents
  const fetchDocs = async () => {
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
                    id: doc.id,
                    name: `${doc.name} (${orgId})`
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

      setDocs(allDocs);

      // Auto-select first doc if none selected
      if (allDocs.length > 0 && !selectedDocId) {
        setSelectedDocId(allDocs[0].id);
      }
    } catch (err) {
      console.error('Error fetching documents:', err);
      if (err.name === 'TypeError' && err.message.includes('Failed to fetch')) {
        setError("Network blocked (CORS). Please configure GRIST_CORS_ALLOW_ORIGIN on your Grist server.");
      } else {
        setError(`Discovery failed: ${err.message}`);
      }
    } finally {
      setLoadingDocs(false);
    }
  };

  useEffect(() => {
    fetchDocs();
  }, []);

  // Variable Support Logic
  const [variables, setVariables] = useState({});
  const [parsedVars, setParsedVars] = useState([]);

  // Parse variables from SQL query
  // Syntax: {{name:type:default}}
  // Examples: 
  // {{start_date:date:2023-01-01}}
  // {{status:dropdown:Active,Inactive}}
  // {{limit:number:10}}
  // {{is_active:boolean:true}}
  // {{search:text:default text}}
  useEffect(() => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = [...sqlQuery.matchAll(regex)];

    const newVars = [];
    const newVarState = { ...variables };
    let hasNewVars = false;

    matches.forEach(match => {
      const content = match[1];
      const parts = content.split(':');
      const name = parts[0].trim();
      const type = parts.length > 1 ? parts[1].trim().toLowerCase() : 'text';
      const defaultValue = parts.length > 2 ? parts.slice(2).join(':').trim() : '';

      newVars.push({
        raw: match[0],
        name,
        type,
        defaultValue,
        options: type === 'dropdown' ? defaultValue.split(',').map(o => o.trim()) : []
      });

      // Initialize state if not exists
      if (newVarState[name] === undefined) {
        if (type === 'boolean') {
          newVarState[name] = defaultValue === 'true';
        } else if (type === 'dropdown') {
          newVarState[name] = defaultValue.split(',')[0].trim();
        } else {
          newVarState[name] = defaultValue;
        }
        hasNewVars = true;
      }
    });

    setParsedVars(newVars);
    if (hasNewVars) {
      setVariables(newVarState);
    }
  }, [sqlQuery]);

  const handleVariableChange = (name, value) => {
    setVariables(prev => ({
      ...prev,
      [name]: value
    }));
  };

  // Execute SQL query
  const executeQuery = async () => {
    if (!selectedDocId) {
      setError('Please select a document first');
      return;
    }

    if (!sqlQuery.trim()) {
      setError('Please enter a SQL query');
      return;
    }

    setLoading(true);
    setError(null);
    setResults(null);

    try {
      const headers = await getHeaders();

      // Interpolate variables into SQL
      let finalQuery = sqlQuery;
      parsedVars.forEach(v => {
        let value = variables[v.name];

        // Handle different types for SQL injection safety/formatting
        // Note: This is client-side interpolation. Ideally, use parameterized queries if API supports it.
        // For now, we'll do basic string replacement.
        if (v.type === 'boolean') {
          // Map boolean to 1/0 or 'true'/'false' depending on preference. 
          // SQLite often uses 1/0. Let's stick to string representation for now or 1/0 if standard.
          // Grist usually handles standard SQL. Let's use 1 and 0 for safety with SQLite.
          value = value ? 1 : 0;
        }

        // Replace ALL occurrences of this variable
        // We escape special regex chars in the raw string just in case
        const escapedRaw = v.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        finalQuery = finalQuery.replace(new RegExp(escapedRaw, 'g'), value);
      });

      console.log("Executing Query:", finalQuery);

      const url = getUrl(`/api/docs/${selectedDocId}/sql?q=${encodeURIComponent(finalQuery)}`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Query failed: ${response.statusText}${errorText ? ` - ${errorText}` : ''}`);
      }

      const data = await response.json();
      setResults(data);

      // Add to history on successful execution
      addToHistory(sqlQuery, selectedDocId);
    } catch (err) {
      console.error('SQL Query Error:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format SQL query (basic formatting)
  const formatSQL = () => {
    if (!sqlQuery.trim()) return;

    // Basic SQL formatting
    const formatted = sqlQuery
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\b(SELECT|FROM|WHERE|JOIN|LEFT|RIGHT|INNER|OUTER|ON|GROUP BY|ORDER BY|HAVING|LIMIT|OFFSET|AND|OR|NOT|IN|EXISTS|CASE|WHEN|THEN|ELSE|END|AS|DISTINCT|COUNT|SUM|AVG|MAX|MIN)\b/gi, (match) => match.toUpperCase())
      .replace(/,/g, ',\n  ') // Add newlines after commas
      .replace(/\bFROM\b/gi, '\nFROM')
      .replace(/\bWHERE\b/gi, '\nWHERE')
      .replace(/\bJOIN\b/gi, '\nJOIN')
      .replace(/\bGROUP BY\b/gi, '\nGROUP BY')
      .replace(/\bORDER BY\b/gi, '\nORDER BY')
      .replace(/\bLIMIT\b/gi, '\nLIMIT')
      .trim();

    setSqlQuery(formatted);
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
        <div className="max-w-7xl mx-auto flex justify-between items-center">
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={onBack} className="!px-2">
              <ArrowLeft size={20} />
            </Button>
            <div className="flex items-center gap-2">
              <div className="w-8 h-8 bg-cyan-600 rounded-lg flex items-center justify-center text-white">
                <Code size={18} />
              </div>
              <h1 className="font-bold text-slate-800">Analyse with SQL</h1>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              onClick={() => setShowHistoryPanel(!showHistoryPanel)}
              className="!px-3"
              icon={History}
            >
              <span className="hidden sm:inline">History</span>
            </Button>
            <Button
              variant="secondary"
              onClick={() => setShowSaveDialog(true)}
              className="!px-3"
              disabled={!sqlQuery.trim()}
              icon={Save}
            >
              <span className="hidden sm:inline">Save</span>
            </Button>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto">
        <div className="max-w-7xl mx-auto space-y-4">
          {/* Document Selector */}
          <Card className="p-4">
            <Select
              label="Select Document"
              value={selectedDocId}
              onChange={setSelectedDocId}
              options={docs.map(doc => ({ value: doc.id, label: doc.name || doc.id }))}
              placeholder="Choose a document..."
              loading={loadingDocs}
              disabled={loadingDocs}
            />
          </Card>

          {/* SQL Query Input */}
          <Card className="p-4">
            <div className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-slate-700">SQL Query</label>
                <Button
                  variant="ghost"
                  onClick={formatSQL}
                  className="!px-2 !py-1 text-xs"
                  disabled={!sqlQuery.trim()}
                >
                  Format SQL
                </Button>
              </div>
              <textarea
                value={sqlQuery}
                onChange={(e) => setSqlQuery(e.target.value)}
                placeholder="Enter your SQL query here (SQLite3 syntax)&#10;Example: SELECT * FROM Customers WHERE Status = '{{status:dropdown:Active,Inactive}}'"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all outline-none font-mono text-sm resize-y"
                rows={8}
                style={{ minHeight: '120px' }}
              />

              {/* Variables Input Section */}
              {parsedVars.length > 0 && (
                <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {parsedVars.filter((v, i, self) => i === self.findIndex(t => t.name === v.name)).map((variable) => (
                    <div key={variable.name}>
                      <label className="block text-xs font-medium text-slate-500 mb-1 ml-1">
                        {variable.name} <span className="text-slate-400">({variable.type})</span>
                      </label>

                      {variable.type === 'dropdown' ? (
                        <select
                          value={variables[variable.name] || ''}
                          onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                        >
                          {variable.options.map(opt => (
                            <option key={opt} value={opt}>{opt}</option>
                          ))}
                        </select>
                      ) : variable.type === 'boolean' ? (
                        <div className="flex items-center h-[38px]">
                          <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 select-none">
                            <input
                              type="checkbox"
                              checked={!!variables[variable.name]}
                              onChange={(e) => handleVariableChange(variable.name, e.target.checked)}
                              className="w-4 h-4 text-cyan-600 rounded border-slate-300 focus:ring-cyan-500"
                            />
                            {variables[variable.name] ? 'True' : 'False'}
                          </label>
                        </div>
                      ) : variable.type === 'date' ? (
                        <input
                          type="date"
                          value={variables[variable.name] || ''}
                          onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                        />
                      ) : variable.type === 'timestamp' ? (
                        <input
                          type="datetime-local"
                          value={variables[variable.name] || ''}
                          onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                        />
                      ) : variable.type === 'number' ? (
                        <input
                          type="number"
                          value={variables[variable.name] || ''}
                          onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                        />
                      ) : (
                        <input
                          type="text"
                          value={variables[variable.name] || ''}
                          onChange={(e) => handleVariableChange(variable.name, e.target.value)}
                          className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 outline-none bg-white text-sm"
                        />
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  onClick={executeQuery}
                  disabled={loading || !selectedDocId || !sqlQuery.trim()}
                  className="flex-1"
                  icon={loading ? Loader2 : Code}
                >
                  {loading ? 'Executing...' : 'Execute Query'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setSqlQuery('');
                    setResults(null);
                    setError(null);
                  }}
                  disabled={loading}
                >
                  Clear
                </Button>
              </div>
            </div>
          </Card>

          {/* Error Display */}
          {error && (
            <div className="p-4 bg-red-50 text-red-700 rounded-lg border border-red-100 flex gap-2 items-start">
              <AlertCircle size={18} className="mt-0.5 shrink-0" />
              <div>
                <p className="font-medium">Error</p>
                <p className="text-sm">{error}</p>
              </div>
            </div>
          )}

          {/* Results Display */}
          {results && results.records && results.records.length > 0 && (
            <Card className="p-4">
              <div className="mb-3 flex justify-between items-center">
                <h3 className="font-bold text-slate-800">Query Results</h3>
                <span className="text-sm text-slate-500">
                  {results.records.length} row{results.records.length !== 1 ? 's' : ''}
                </span>
              </div>

              {/* View Toggles */}
              <div className="flex gap-2 mb-4 border-b border-slate-100 pb-4">
                <button
                  onClick={() => setViewMode('table')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'table'
                    ? 'bg-cyan-50 text-cyan-700'
                    : 'text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  <Table size={16} />
                  Table View
                </button>
                <button
                  onClick={() => setViewMode('chart')}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${viewMode === 'chart'
                    ? 'bg-cyan-50 text-cyan-700'
                    : 'text-slate-600 hover:bg-slate-50'
                    }`}
                >
                  <BarChart2 size={16} />
                  Chart View
                </button>
              </div>

              {viewMode === 'table' ? (
                <div className="overflow-x-auto">
                  <table className="w-full border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200">
                        {Object.keys(results.records[0].fields || {}).map((key) => (
                          <th
                            key={key}
                            className="px-4 py-2 text-left text-xs font-semibold text-slate-700 uppercase tracking-wider"
                          >
                            {key}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {results.records.map((record, idx) => (
                        <tr
                          key={idx}
                          className="border-b border-slate-100 hover:bg-slate-50 transition-colors"
                        >
                          {Object.values(record.fields || {}).map((value, cellIdx) => (
                            <td
                              key={cellIdx}
                              className="px-4 py-2 text-sm text-slate-700"
                            >
                              {value === null || value === undefined
                                ? <span className="text-slate-400 italic">null</span>
                                : typeof value === 'object'
                                  ? JSON.stringify(value)
                                  : String(value)}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <SqlVisualization
                  data={results.records}
                  config={vizConfig}
                  onConfigChange={setVizConfig}
                />
              )}
            </Card>
          )}

          {/* No Results Message */}
          {results && results.records && results.records.length === 0 && (
            <div className="text-center py-12 text-slate-500 bg-white rounded-xl border border-dashed border-slate-300">
              <Database size={48} className="mx-auto mb-4 text-slate-300" />
              <p className="text-lg font-medium mb-2">No Results</p>
              <p className="text-sm">The query executed successfully but returned no rows.</p>
            </div>
          )}
        </div>
      </main>

      {/* History Panel */}
      {showHistoryPanel && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowHistoryPanel(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between p-4 border-b border-slate-200">
              <h2 className="text-xl font-bold text-slate-800">Query History & Saved Queries</h2>
              <button onClick={() => setShowHistoryPanel(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-auto p-4 space-y-6">
              {/* Pinned Queries */}
              {savedQueries.filter(q => q.pinned).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <Pin size={16} className="text-cyan-600" />
                    Pinned Queries
                  </h3>
                  <div className="space-y-2">
                    {savedQueries.filter(q => q.pinned).map(query => (
                      <div key={query.id} className="bg-cyan-50 border border-cyan-200 rounded-lg p-3">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800">{query.name}</h4>
                            <p className="text-xs text-slate-500">
                              {new Date(query.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleShare(query)}
                              className={`p-1 rounded ${query.createdBy === teamId ? 'hover:bg-cyan-200 text-cyan-600' : 'text-slate-300 cursor-not-allowed'}`}
                              title={query.createdBy === teamId ? "Share" : "Only owner can share"}
                              disabled={query.createdBy !== teamId}
                            >
                              <Users size={16} />
                            </button>
                            <button
                              onClick={() => togglePin(query.id)}
                              className="p-1 hover:bg-cyan-200 rounded text-cyan-600"
                              title="Unpin"
                            >
                              <Pin size={16} fill="currentColor" />
                            </button>
                            <button
                              onClick={() => deleteSavedQuery(query.id)}
                              className="p-1 hover:bg-red-100 rounded text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <pre className="text-xs bg-white p-2 rounded border border-cyan-200 overflow-x-auto font-mono mb-2">
                          {query.query}
                        </pre>
                        <button
                          onClick={() => loadQuery(query.query, query.docId, query.vizConfig)}
                          className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                        >
                          Load Query →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Saved Queries */}
              {savedQueries.filter(q => !q.pinned).length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <Save size={16} />
                    Saved Queries
                  </h3>
                  <div className="space-y-2">
                    {savedQueries.filter(q => !q.pinned).map(query => (
                      <div key={query.id} className="bg-slate-50 border border-slate-200 rounded-lg p-3">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <div className="flex-1">
                            <h4 className="font-semibold text-slate-800">{query.name}</h4>
                            <p className="text-xs text-slate-500">
                              {new Date(query.timestamp).toLocaleString()}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => handleShare(query)}
                              className={`p-1 rounded ${query.createdBy === teamId ? 'hover:bg-slate-200 text-slate-600' : 'text-slate-300 cursor-not-allowed'}`}
                              title={query.createdBy === teamId ? "Share" : "Only owner can share"}
                              disabled={query.createdBy !== teamId}
                            >
                              <Users size={16} />
                            </button>
                            <button
                              onClick={() => togglePin(query.id)}
                              className="p-1 hover:bg-slate-200 rounded text-slate-600"
                              title="Pin"
                            >
                              <Pin size={16} />
                            </button>
                            <button
                              onClick={() => deleteSavedQuery(query.id)}
                              className="p-1 hover:bg-red-100 rounded text-red-600"
                              title="Delete"
                            >
                              <Trash2 size={16} />
                            </button>
                          </div>
                        </div>
                        <pre className="text-xs bg-white p-2 rounded border border-slate-200 overflow-x-auto font-mono mb-2">
                          {query.query}
                        </pre>
                        <button
                          onClick={() => loadQuery(query.query, query.docId, query.vizConfig)}
                          className="text-xs text-slate-600 hover:text-slate-800 font-medium"
                        >
                          Load Query →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Query History */}
              {queryHistory.length > 0 && (
                <div>
                  <h3 className="text-sm font-semibold text-slate-700 mb-2 flex items-center gap-2">
                    <Clock size={16} />
                    Recent History ({queryHistory.length}/50)
                  </h3>
                  <div className="space-y-2">
                    {queryHistory.slice(0, 20).map(item => (
                      <div key={item.id} className="bg-white border border-slate-200 rounded-lg p-3 hover:border-cyan-300 transition-colors">
                        <div className="flex justify-between items-start gap-2 mb-2">
                          <p className="text-xs text-slate-500">
                            {new Date(item.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <pre className="text-xs bg-slate-50 p-2 rounded border border-slate-200 overflow-x-auto font-mono mb-2">
                          {item.query}
                        </pre>
                        <button
                          onClick={() => loadQuery(item.query, item.docId)}
                          className="text-xs text-cyan-600 hover:text-cyan-700 font-medium"
                        >
                          Load Query →
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {queryHistory.length === 0 && savedQueries.length === 0 && (
                <div className="text-center py-12 text-slate-500">
                  <History size={48} className="mx-auto mb-4 text-slate-300" />
                  <p className="text-lg font-medium mb-2">No Query History</p>
                  <p className="text-sm">Execute queries to build your history</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Share Modal */}
      <ShareQueryModal
        isOpen={showShareModal}
        onClose={() => setShowShareModal(false)}
        queryName={queryToShare?.name}
        currentSharedWith={queryToShare?.sharedWith}
        onSave={saveSharing}
        getHeaders={getHeaders}
        getUrl={getUrl}
        docId={PWA_DATA_DOC_ID}
      />

      {/* Save Query Dialog */}
      {showSaveDialog && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50" onClick={() => setShowSaveDialog(false)}>
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold text-slate-800">Save Query</h2>
              <button onClick={() => setShowSaveDialog(false)} className="text-slate-400 hover:text-slate-700">
                <X size={20} />
              </button>
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Query Name</label>
              <input
                type="text"
                value={saveQueryName}
                onChange={(e) => setSaveQueryName(e.target.value)}
                placeholder="e.g., Customer List Query"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-cyan-500 focus:border-cyan-500 transition-all outline-none"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveQueryWithName();
                }}
                autoFocus
              />
            </div>

            <div className="mb-4">
              <label className="block text-sm font-medium text-slate-700 mb-2">Query Preview</label>
              <pre className="text-xs bg-slate-50 p-3 rounded border border-slate-200 overflow-x-auto font-mono max-h-40">
                {sqlQuery}
              </pre>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={saveQueryWithName}
                disabled={!saveQueryName.trim()}
                className="flex-1"
                icon={Save}
              >
                Save Query
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowSaveDialog(false)}
              >
                Cancel
              </Button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};

// Main App Component

export default function App() {
  const { loginWithRedirect, logout, user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();
  const [teamId, setTeamId] = useState(null);
  const [loadingTeamId, setLoadingTeamId] = useState(false);

  // Global impersonation state
  // Global impersonation state
  const [impersonateEmail, setImpersonateEmail] = useState(() => {
    return localStorage.getItem('impersonateEmail') || '';
  });
  const [teamMembers, setTeamMembers] = useState([]);
  const [loadingTeamMembers, setLoadingTeamMembers] = useState(false);

  // Derived user object for impersonation
  const derivedUser = useMemo(() => {
    if (!user) return null;

    if (impersonateEmail) {
      const impersonatedMember = teamMembers.find(m => m.Email === impersonateEmail);
      if (impersonatedMember) {
        return {
          ...user,
          email: impersonatedMember.Email,
          name: impersonatedMember.Name,
          id: impersonatedMember.id, // Ensure ID is available
          picture: user.picture, // Keep original picture or use placeholder if available
          originalUser: user // Keep reference to original user
        };
      }
    }

    // Not impersonating or member not found
    return {
      ...user,
      id: teamId // Add the fetched teamId to the user object
    };
  }, [user, impersonateEmail, teamMembers, teamId]);

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

  // Update LocalStorage when impersonation changes
  useEffect(() => {
    if (impersonateEmail) {
      localStorage.setItem('impersonateEmail', impersonateEmail);
    } else {
      localStorage.removeItem('impersonateEmail');
    }
  }, [impersonateEmail]);

  // Fetch team members for impersonation dropdown
  const fetchTeamMembers = async () => {
    if (teamMembers.length > 0) return; // Already fetched
    setLoadingTeamMembers(true);
    try {
      const headers = await getHeaders();
      const DOC_ID = '8vRFY3UUf4spJroktByH4u';
      const url = getUrl(`/api/docs/${DOC_ID}/sql`);
      const response = await fetch(url, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sql: "SELECT id, Name, Email FROM Team WHERE Email != ''",
          args: []
        })
      });

      if (response.ok) {
        const data = await response.json();
        const members = data.records.map(r => r.fields);
        setTeamMembers(members);
      }
    } catch (e) {
      console.error('Error fetching team members:', e);
    } finally {
      setLoadingTeamMembers(false);
    }
  };

  const getHeaders = async (overrideImpersonateEmail = null) => {
    try {
      const token = await getAccessTokenSilently();
      const headers = {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // Use override if provided, otherwise use global impersonation state
      const emailToUse = overrideImpersonateEmail !== null ? overrideImpersonateEmail : impersonateEmail;

      // Add impersonation header if provided
      if (emailToUse) {
        headers['X-Impersonate'] = emailToUse;
      }

      return headers;
    } catch (e) {
      console.error("Failed to get access token", e);
      throw new Error("Failed to authenticate with Auth0");
    }
  };

  // Fetch Team ID for the logged-in user
  const fetchTeamId = async () => {
    console.log('fetchTeamId called, user email:', user?.email, 'current teamId:', teamId);
    if (!user?.email || teamId) return; // Skip if already fetched

    setLoadingTeamId(true);
    try {
      const headers = await getHeaders();
      const DOC_ID = '8vRFY3UUf4spJroktByH4u';
      const url = getUrl(`/api/docs/${DOC_ID}/sql`);

      console.log('Fetching Team ID for email:', user.email);
      const response = await fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          sql: 'SELECT id FROM Team WHERE Email = ?',
          args: [user.email]
        })
      });

      if (response.ok) {
        const data = await response.json();
        console.log('Team ID fetch response:', data);
        if (data.records && data.records.length > 0) {
          const id = data.records[0].fields.id;
          setTeamId(id);
          console.log('Team ID fetched and set:', id);
        } else {
          console.warn('No Team record found for user:', user.email);
        }
      } else {
        const errorText = await response.text();
        console.error('Team ID fetch failed:', response.status, errorText);
      }
    } catch (e) {
      console.error('Error fetching Team ID:', e);
    } finally {
      setLoadingTeamId(false);
    }
  };

  // Fetch Team ID when user authenticates
  useEffect(() => {
    if (isAuthenticated && user?.email && !teamId && !loadingTeamId) {
      console.log('Triggering fetchTeamId from useEffect');
      fetchTeamId();
    }
  }, [isAuthenticated, user, teamId, loadingTeamId]);

  // Fetch team members when authenticated
  useEffect(() => {
    if (isAuthenticated && user?.email) {
      fetchTeamMembers();
    }
  }, [isAuthenticated, user]);

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
            <h1 className="text-2xl font-bold text-slate-800">SRB Grist PWA</h1>
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

  // Main Application - Render based on URL routes
  return (
    <Routes>
      <Route path="/" element={<HomePage onNavigate={(path) => navigate(`/${path}`)} user={derivedUser} onLogout={handleLogout} impersonateEmail={impersonateEmail} setImpersonateEmail={setImpersonateEmail} teamMembers={teamMembers} loadingTeamMembers={loadingTeamMembers} />} />
      <Route
        path="/telecaller"
        element={
          <TelecallerView
            onBack={() => navigate('/')}
            user={derivedUser}
            teamId={derivedUser?.id}
            onLogout={handleLogout}
            getHeaders={getHeaders}
            getUrl={getUrl}
          />
        }
      />
      <Route
        path="/design"
        element={
          <DesignConfirmationView
            onBack={() => navigate('/')}
            user={derivedUser}
            onLogout={handleLogout}
          />
        }
      />
      <Route
        path="/table"
        element={
          <CustomTableViewer
            onBack={() => navigate('/')}
            user={derivedUser}
            onLogout={handleLogout}
            getHeaders={getHeaders}
            getUrl={getUrl}
          />
        }
      />
      <Route
        path="/factory"
        element={
          <FactoryView
            onBack={() => navigate('/')}
            user={derivedUser}
            onLogout={handleLogout}
            getHeaders={getHeaders}
            getUrl={getUrl}
          />
        }
      />
      <Route path="/sql" element={<SQLAnalysisView onBack={() => navigate('/dashboards')} user={derivedUser} teamId={derivedUser?.id} onLogout={handleLogout} getHeaders={getHeaders} getUrl={getUrl} />} />
      <Route path="/dashboards" element={<DashboardList onNavigate={(id) => navigate(`/dashboards/${id}`)} onBack={() => navigate('/')} teamId={derivedUser?.id} getHeaders={getHeaders} getUrl={getUrl} user={derivedUser} />} />
      <Route path="/dashboards/:id" element={<DashboardWrapper onBack={() => navigate('/dashboards')} getHeaders={getHeaders} getUrl={getUrl} teamId={derivedUser?.id} user={derivedUser} />} />
      <Route path="/telecaller/customer/:customerId" element={<TelecallerCustomerView onBack={() => navigate('/telecaller')} user={derivedUser} getHeaders={getHeaders} getUrl={getUrl} />} />
      <Route path="/salesman" element={<SalesmanView onBack={() => navigate('/')} user={derivedUser} teamId={derivedUser?.id} onLogout={handleLogout} getHeaders={getHeaders} getUrl={getUrl} />} />
      <Route path="/salesman/customer/:customerId" element={<SalesmanCustomerView onBack={() => navigate('/salesman')} user={derivedUser} getHeaders={getHeaders} getUrl={getUrl} />} />
    </Routes>
  );
}
