import React, { useState, useEffect } from 'react';
import { Routes, Route, useNavigate } from 'react-router-dom';
import { Settings, LogOut, Database, Loader2, AlertCircle, RefreshCw, Search, X, User, Phone, CheckSquare, Table, Home, ArrowLeft, Factory } from 'lucide-react';
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

// Home Page Component
const HomePage = ({ onNavigate }) => {
  const pageOptions = [
    {
      id: 'telecaller',
      title: 'Telecaller View',
      description: 'Manage telecaller operations and calls',
      icon: Phone,
      color: 'bg-blue-600',
      hoverColor: 'hover:bg-blue-700'
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
    {
      id: 'factory',
      title: 'Factory View',
      description: 'View today\'s factory updates',
      icon: Factory,
      color: 'bg-orange-600',
      hoverColor: 'hover:bg-orange-700'
    }
  ];

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 px-4 py-4">
        <div className="max-w-7xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-green-600 rounded-xl flex items-center justify-center text-white">
              <Database size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-slate-800">Grist Connector</h1>
              <p className="text-sm text-slate-500">Select a view to get started</p>
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 p-4 md:p-8">
        <div className="max-w-6xl mx-auto">
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
    </div>
  );
};

// Telecaller View Component (Placeholder)
const TelecallerView = ({ onBack, user, onLogout }) => {
  const [showSettings, setShowSettings] = useState(false);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3">
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
          <Button
            variant="secondary"
            onClick={() => setShowSettings(true)}
            className="!px-3"
          >
            <Settings size={18} />
          </Button>
        </div>
      </header>

      <main className="flex-1 p-4 overflow-auto">
        <div className="max-w-7xl mx-auto">
          <Card className="p-8 text-center">
            <Phone size={64} className="mx-auto mb-4 text-blue-600" />
            <h2 className="text-2xl font-bold text-slate-800 mb-2">Telecaller View</h2>
            <p className="text-slate-600 mb-4">
              This view is ready to be customized with telecaller-specific functionality.
            </p>
            <p className="text-sm text-slate-500">
              Connect this view to your Grist data to manage calls, contacts, and telecaller operations.
            </p>
          </Card>
        </div>
      </main>

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          user={user}
          onLogout={onLogout}
        />
      )}
    </div>
  );
};

// Design Confirmation View Component (Placeholder)
const DesignConfirmationView = ({ onBack, user, onLogout }) => {
  const [showSettings, setShowSettings] = useState(false);

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
          <Button
            variant="secondary"
            onClick={() => setShowSettings(true)}
            className="!px-3"
          >
            <Settings size={18} />
          </Button>
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

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          user={user}
          onLogout={onLogout}
        />
      )}
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
const FactoryView = ({ onBack, user, onLogout, getHeaders, getUrl }) => {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showSettings, setShowSettings] = useState(false);

  // Preview State
  const [previewImage, setPreviewImage] = useState(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  // Filter State
  const [selectedPlate, setSelectedPlate] = useState('');
  const [selectedDate, setSelectedDate] = useState('');
  const [selectedPrint, setSelectedPrint] = useState('');
  const [availablePlates, setAvailablePlates] = useState([]);
  const [availableDates, setAvailableDates] = useState([]);
  const [availablePrints, setAvailablePrints] = useState([]);

  // Data Maps
  const [customerMap, setCustomerMap] = useState({});

  const DOC_ID = '8vRFY3UUf4spJroktByH4u';
  const TABLE_ID = 'Sub_Orders';
  const ORDERS_TABLE_ID = 'Orders';
  const CUSTOMERS_TABLE_ID = 'Customers';

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

  const [orderMap, setOrderMap] = useState({});

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const headers = await getHeaders();

      // 1. Fetch Sub_Orders
      // Use limit=0 to fetch all records (or a sufficiently high limit if 0 isn't supported, but 0 is standard for 'no limit' in some APIs, 
      // Grist might require a high number or pagination. Let's try without limit first, but if we suspect truncation, we should check.
      // Actually, Grist API default limit is often 100. We MUST use a limit.
      const url = getUrl(`/api/docs/${DOC_ID}/tables/${TABLE_ID}/records?limit=0`);
      const response = await fetch(url, { headers });

      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.statusText}`);
      }

      const data = await response.json();
      const allRecords = data.records || [];

      // 2. Extract unique values for filters and lookups
      const plates = new Set();
      const dates = new Set();
      const prints = new Set();
      const customerIds = new Set();
      const orderRefIds = new Set();

      allRecords.forEach(r => {
        if (r.fields['Plate']) plates.add(r.fields['Plate']);
        if (r.fields['Print']) prints.add(r.fields['Print']);
        const d = formatDate(r.fields['Factory_Updated_Date']);
        if (d) dates.add(d);

        const custId = extractId(r.fields['Customer']);
        if (custId) customerIds.add(custId);

        const orderId = extractId(r.fields['Order']);
        if (orderId) orderRefIds.add(orderId);
      });

      setAvailablePlates(Array.from(plates).sort());
      setAvailablePrints(Array.from(prints).sort());
      setAvailableDates(Array.from(dates).sort().reverse()); // Newest first

      // Set default date to today if available, otherwise first available
      const todayStr = new Date().toLocaleDateString('en-CA');
      if (dates.has(todayStr)) {
        setSelectedDate(todayStr);
      } else if (dates.size > 0) {
        setSelectedDate(Array.from(dates).sort().reverse()[0]);
      }

      // 3. Fetch Customers
      // Fetch all customers to ensure we have a complete map. 
      // Using a very high limit (100000) because limit=0 might be interpreted as default (100) or have issues.
      if (customerIds.size > 0) {
        const custUrl = getUrl(`/api/docs/${DOC_ID}/tables/${CUSTOMERS_TABLE_ID}/records?limit=100000`);
        const custRes = await fetch(custUrl, { headers });

        if (custRes.ok) {
          const custData = await custRes.json();
          const custMap = {};
          let minId = Infinity;
          let maxId = -Infinity;

          custData.records.forEach(c => {
            custMap[c.id] = c.fields['Shop_Name'] || `Customer ${c.id}`;
            if (c.id < minId) minId = c.id;
            if (c.id > maxId) maxId = c.id;
          });
          setCustomerMap(custMap);
        } else {
          console.error("Failed to fetch customers:", custRes.status, custRes.statusText);
        }
      }

      // 4. Fetch Orders to resolve Order_ID
      if (orderRefIds.size > 0) {
        const ordersUrl = getUrl(`/api/docs/${DOC_ID}/tables/${ORDERS_TABLE_ID}/records?limit=100000`);
        const ordersRes = await fetch(ordersUrl, { headers });

        if (ordersRes.ok) {
          const ordersData = await ordersRes.json();
          const oMap = {};
          ordersData.records.forEach(o => {
            // Map Row ID -> Order_ID column value
            oMap[o.id] = o.fields['Order_ID'];
          });
          setOrderMap(oMap);
        } else {
          console.error("Failed to fetch orders:", ordersRes.status, ordersRes.statusText);
        }
      }

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
  }, []);

  // Filter records based on selection
  const filteredRecords = records.filter(record => {
    const recordDate = formatDate(record.fields['Factory_Updated_Date']);
    const recordPlate = record.fields['Plate'];
    const recordPrint = record.fields['Print'];

    const dateMatch = !selectedDate || recordDate === selectedDate;
    const plateMatch = !selectedPlate || recordPlate === selectedPlate;
    const printMatch = !selectedPrint || recordPrint === selectedPrint;

    return dateMatch && plateMatch && printMatch;
  });

  const handleViewOrderForm = async (orderRefId) => {
    if (!orderRefId) {
      alert("No Order Reference ID found");
      return;
    }

    setLoadingPreview(true);
    setPreviewImage(null); // Open modal immediately in loading state

    try {
      const headers = await getHeaders();

      // 1. Fetch the Order record from 'Orders' table
      // We use the filter query param to find the record by ID (which is what the ref is)
      // Grist API: /records?filter={"id": [REF_ID]}
      const filter = JSON.stringify({ id: [orderRefId] });
      const queryUrl = getUrl(`/api/docs/${DOC_ID}/tables/${ORDERS_TABLE_ID}/records?filter=${encodeURIComponent(filter)}`);

      const orderRes = await fetch(queryUrl, { headers });
      if (!orderRes.ok) throw new Error("Failed to fetch order details");

      const orderData = await orderRes.json();
      if (!orderData.records || orderData.records.length === 0) {
        throw new Error("Order record not found");
      }

      const orderRecord = orderData.records[0];
      const rawAttachments = orderRecord.fields['Order_Form'];

      if (!rawAttachments || !Array.isArray(rawAttachments)) {
        throw new Error("No Order Form attachment found");
      }

      // Filter out 'L' marker which Grist sometimes includes in list values
      const attachments = rawAttachments.filter(item => item !== 'L');

      if (attachments.length === 0) {
        throw new Error("No Order Form attachment found");
      }

      // 2. Fetch the image blob
      // Use the first attachment
      const attachmentId = attachments[0];
      // Handle case where attachment might be an object or just ID (Grist API varies slightly by version/column type)
      const attId = typeof attachmentId === 'object' ? attachmentId.id : attachmentId;

      const imgUrl = getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`);
      const imgRes = await fetch(imgUrl, { headers });

      if (!imgRes.ok) throw new Error("Failed to download image");

      const blob = await imgRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      setPreviewImage(objectUrl);

    } catch (err) {
      console.error("Preview Error:", err);
      alert(`Error loading preview: ${err.message}`);
      setLoadingPreview(false); // Close modal on error (or we could show error state in modal)
      setPreviewImage(null); // Ensure modal closes or shows error
    } finally {
      // If we have an image, we keep loadingPreview true until the modal renders?
      // No, we set loadingPreview false to show the image.
      // But if we errored, we might want to close it.
      // Let's handle state carefully:
      // If success: previewImage = url, loadingPreview = false
      // If error: previewImage = null, loadingPreview = false (modal closes)
      // Wait, if previewImage is null, modal doesn't show?
      // We need a way to show the modal while loading.
      // Let's use a separate state 'showPreviewModal' or just rely on 'loadingPreview || previewImage'
    }
  };

  // Wrapper to manage modal state
  const openPreview = (orderRefId) => {
    setLoadingPreview(true); // This triggers modal open
    handleViewOrderForm(orderRefId).then(() => {
      setLoadingPreview(false);
    });
  };

  const closePreview = () => {
    if (previewImage) {
      URL.revokeObjectURL(previewImage);
    }
    setPreviewImage(null);
    setLoadingPreview(false);
  };

  const handleViewScreenshot = async (subOrderId) => {
    if (!subOrderId) {
      alert("No Sub-Order ID found");
      return;
    }

    setLoadingPreview(true);
    setPreviewImage(null);

    try {
      const headers = await getHeaders();
      const CONVERSATIONS_TABLE_ID = 'Customer_Conversations';

      // 1. Fetch conversations linked to this sub-order
      const filter = JSON.stringify({ Sub_Order_in_Context: [subOrderId] });
      const queryUrl = getUrl(`/api/docs/${DOC_ID}/tables/${CONVERSATIONS_TABLE_ID}/records?filter=${encodeURIComponent(filter)}`);

      const res = await fetch(queryUrl, { headers });
      if (!res.ok) throw new Error("Failed to fetch conversation details");

      const data = await res.json();
      if (!data.records || data.records.length === 0) {
        throw new Error("No conversation records found for this order");
      }

      // 2. Find the record with "FINALISED DESIGN" in Outcomes
      const targetRecord = data.records.find(r => {
        const outcomes = r.fields['Outcomes'];
        // Outcomes might be a string or a list (if choice list)
        if (Array.isArray(outcomes)) {
          return outcomes.includes("FINALISED DESIGN");
        }
        return outcomes === "FINALISED DESIGN";
      });

      if (!targetRecord) {
        throw new Error("No 'FINALISED DESIGN' record found");
      }

      const rawAttachments = targetRecord.fields['Screenshots'];

      if (!rawAttachments || !Array.isArray(rawAttachments)) {
        throw new Error("No Screenshot attachment found");
      }

      // Filter out 'L' marker
      const attachments = rawAttachments.filter(item => item !== 'L');

      if (attachments.length === 0) {
        throw new Error("No Screenshot attachment found");
      }

      // 3. Fetch the image blob
      const attachmentId = attachments[0];
      const attId = typeof attachmentId === 'object' ? attachmentId.id : attachmentId;

      const imgUrl = getUrl(`/api/docs/${DOC_ID}/attachments/${attId}/download`);
      const imgRes = await fetch(imgUrl, { headers });

      if (!imgRes.ok) throw new Error("Failed to download screenshot");

      const blob = await imgRes.blob();
      const objectUrl = URL.createObjectURL(blob);
      setPreviewImage(objectUrl);

    } catch (err) {
      console.error("Screenshot Preview Error:", err);
      alert(`Error loading screenshot: ${err.message}`);
      setLoadingPreview(false);
      setPreviewImage(null);
    }
  };

  // Wrapper to manage modal state
  const openScreenshotPreview = (subOrderId) => {
    setLoadingPreview(true);
    handleViewScreenshot(subOrderId).then(() => {
      setLoadingPreview(false);
    });
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
                onClick={fetchData}
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

          {/* Filters */}
          <div className="flex gap-3">
            <Select
              value={selectedDate}
              onChange={setSelectedDate}
              options={availableDates.map(d => ({ value: d, label: d === new Date().toLocaleDateString('en-CA') ? `${d} (Today)` : d }))}
              placeholder="All Dates"
              className="flex-1"
            />
            <Select
              value={selectedPlate}
              onChange={setSelectedPlate}
              options={availablePlates.map(p => ({ value: p, label: p }))}
              placeholder="All Plates"
              className="flex-1"
            />
            <Select
              value={selectedPrint}
              onChange={setSelectedPrint}
              options={availablePrints.map(p => ({ value: p, label: p }))}
              placeholder="All Prints"
              className="flex-1"
            />
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
                            {customerMap[String(extractId(record.fields['Customer']))] || 'Unknown Customer'}
                          </h3>
                          <span className="bg-blue-100 text-blue-800 text-xs font-bold px-2.5 py-1 rounded-full shrink-0">
                            #{orderMap[extractId(record.fields['Order'])] || extractId(record.fields['Order'])}
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
                        </div>
                      </div>

                      <div className="mt-auto flex flex-col gap-2 pt-2">
                        <Button
                          variant="outline"
                          className="w-full text-sm"
                          onClick={() => openPreview(record.fields['Order'])}
                        >
                          View Order Form
                        </Button>
                        <Button
                          variant="primary"
                          className="w-full text-sm bg-orange-600 hover:bg-orange-700"
                          onClick={() => openScreenshotPreview(record.id)}
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

      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          user={user}
          onLogout={onLogout}
        />
      )}
    </div>
  );
};

// Custom Table Viewer Component (Extracted from main App)
const CustomTableViewer = ({ onBack, user, onLogout, getHeaders, getUrl }) => {
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
          onLogout={onLogout}
        />
      )}
    </div>
  );
};

// Main App Component
export default function App() {
  const { loginWithRedirect, logout, user, isAuthenticated, isLoading, getAccessTokenSilently } = useAuth0();
  const navigate = useNavigate();

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

  const handleNavigate = (view) => {
    navigate(`/${view}`);
  };

  const handleBackToHome = () => {
    navigate('/');
  };

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

  // Main Application - Render based on URL routes
  return (
    <Routes>
      <Route path="/" element={<HomePage onNavigate={handleNavigate} />} />
      <Route
        path="/telecaller"
        element={
          <TelecallerView
            onBack={handleBackToHome}
            user={user}
            onLogout={handleLogout}
          />
        }
      />
      <Route
        path="/design"
        element={
          <DesignConfirmationView
            onBack={handleBackToHome}
            user={user}
            onLogout={handleLogout}
          />
        }
      />
      <Route
        path="/table"
        element={
          <CustomTableViewer
            onBack={handleBackToHome}
            user={user}
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
            onBack={handleBackToHome}
            user={user}
            onLogout={handleLogout}
            getHeaders={getHeaders}
            getUrl={getUrl}
          />
        }
      />
    </Routes>
  );
}
