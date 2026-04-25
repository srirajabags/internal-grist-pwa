import React, { useState, useEffect } from 'react';
import { X, Search, Loader2, Save, MapPin, CheckCircle, XCircle, UserPlus } from 'lucide-react';
import Button from './Button';

const compressImage = (file) => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const MAX_WIDTH = 1200;
                const MAX_HEIGHT = 1200;
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > MAX_WIDTH) {
                        height = Math.round((height * MAX_WIDTH) / width);
                        width = MAX_WIDTH;
                    }
                } else {
                    if (height > MAX_HEIGHT) {
                        width = Math.round((width * MAX_HEIGHT) / height);
                        height = MAX_HEIGHT;
                    }
                }

                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    resolve(new File([blob], file.name, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                    }));
                }, 'image/jpeg', 0.7);
            };
            img.onerror = (error) => reject(error);
        };
        reader.onerror = (error) => reject(error);
    });
};

const AddNewLeadModal = ({ onClose, onSuccess, teamId, getHeaders, getUrl }) => {
    const [step, setStep] = useState(1); // 1: verify phone, 2: fill form
    
    const [phoneNumber, setPhoneNumber] = useState('');
    const [verifying, setVerifying] = useState(false);
    const [verifyError, setVerifyError] = useState('');
    
    // Form State
    const [shopName, setShopName] = useState('');
    const [cityId, setCityId] = useState('');
    const [customerType, setCustomerType] = useState('');
    const [shopType, setShopType] = useState('');
    const [contactPerson, setContactPerson] = useState('');
    const [revisitDate, setRevisitDate] = useState('');
    const [bagsRequirement, setBagsRequirement] = useState([]);
    
    const [bagPhotoFiles, setBagPhotoFiles] = useState([]);
    
    const [captureLocation, setCaptureLocation] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');
    
    // Remote Data
    const [cities, setCities] = useState([]);
    const [customerTypeChoices, setCustomerTypeChoices] = useState([]);
    const [shopTypeChoices, setShopTypeChoices] = useState([]);
    const [bagsRequirementsChoices, setBagsRequirementsChoices] = useState([]);
    
    const DOC_ID = '8vRFY3UUf4spJroktByH4u';

    useEffect(() => {
        if (step === 2) {
            fetchFormData();
        }
    }, [step]);

    const fetchFormData = async () => {
        try {
            const headers = await getHeaders();
            
            // 1. Fetch Cities (from Areas)
            const citiesUrl = getUrl(`/api/docs/${DOC_ID}/sql`);
            const citiesRes = await fetch(citiesUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: "SELECT id, City_Code2 FROM Areas ORDER BY City_Code2" })
            });
            if (citiesRes.ok) {
                const data = await citiesRes.json();
                setCities(data.records.map(r => r.fields));
            }

            // 2. Fetch Columns for Choices
            const colsUrl = getUrl(`/api/docs/${DOC_ID}/tables/Customer_Leads/columns`);
            const colsRes = await fetch(colsUrl, { method: 'GET', headers });
            if (colsRes.ok) {
                const data = await colsRes.json();
                
                const parseChoices = (colName) => {
                    const col = data.columns.find(c => c.id === colName);
                    if (col && col.fields.widgetOptions) {
                        try {
                            const wOpt = JSON.parse(col.fields.widgetOptions);
                            return wOpt.choices || [];
                        } catch(e) {}
                    }
                    return [];
                };

                setCustomerTypeChoices(parseChoices('Customer_Type'));
                setShopTypeChoices(parseChoices('Shop_Type'));
                setBagsRequirementsChoices(parseChoices('Bags_Requirement'));
            }
        } catch (e) {
            console.error("Error fetching form data:", e);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        if (!phoneNumber || phoneNumber.length < 10) {
            setVerifyError("Please enter a valid 10-digit mobile number");
            return;
        }

        setVerifying(true);
        setVerifyError('');

        try {
            const headers = await getHeaders();
            const sqlUrl = getUrl(`/api/docs/${DOC_ID}/sql`);
            
            const query = `SELECT id, Shop_Name, Customer_ID FROM Customers WHERE Phone_Numbers_List LIKE ? OR Mobile_Number LIKE ?`;
            const args = [`%${phoneNumber}%`, `%${phoneNumber}%`];
            
            const res = await fetch(sqlUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: query, args })
            });

            if (!res.ok) throw new Error("Failed to verify mobile number");
            
            const data = await res.json();
            
            if (data.records && data.records.length > 0) {
                const existingShopName = data.records[0].fields.Shop_Name;
                const existingCustomerId = data.records[0].fields.Customer_ID;
                setVerifyError(`Customer already exists: ${existingShopName} (ID: ${existingCustomerId}). Cannot add as a new lead.`);
                return;
            }

            // Check Customer_Leads
            const leadsQuery = `SELECT id, Shop_Name FROM Customer_Leads WHERE Phone_Number = ? OR Phone_Number = ?`;
            const phoneInt = parseInt(phoneNumber, 10);
            const leadsArgs = [phoneInt, phoneNumber];
            
            const leadsRes = await fetch(sqlUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ sql: leadsQuery, args: leadsArgs })
            });

            if (!leadsRes.ok) throw new Error("Failed to verify mobile number in Leads");
            
            const leadsData = await leadsRes.json();

            if (leadsData.records && leadsData.records.length > 0) {
                setVerifyError(`Lead already exists for this number: ${leadsData.records[0].fields.Shop_Name}. Cannot add again.`);
                return;
            }

            // Success, proceed to step 2
            setStep(2);
        } catch (e) {
            console.error(e);
            setVerifyError("Error verifying number. " + e.message);
        } finally {
            setVerifying(false);
        }
    };

    const toggleBagRequirement = (req) => {
        setBagsRequirement(prev => 
            prev.includes(req) ? prev.filter(r => r !== req) : [...prev, req]
        );
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSubmitting(true);
        setSubmitError('');

        try {
            let lat = 0;
            let lng = 0;

            if (captureLocation) {
                if (!navigator.geolocation) {
                    throw new Error("Geolocation is not supported by this browser.");
                }
                const position = await new Promise((resolve, reject) => {
                    navigator.geolocation.getCurrentPosition(resolve, reject);
                });
                lat = position.coords.latitude;
                lng = position.coords.longitude;
            }

            const headers = await getHeaders();
            const photoAttachmentIds = [];
            if (bagPhotoFiles.length > 0) {
                const formData = new FormData();
                for (const file of bagPhotoFiles) {
                    const compressedFile = await compressImage(file);
                    formData.append('upload', compressedFile);
                }
                
                const uploadHeaders = { ...headers };
                delete uploadHeaders['Content-Type'];
                
                const attUrl = getUrl(`/api/docs/${DOC_ID}/attachments`);
                const attRes = await fetch(attUrl, {
                    method: 'POST',
                    headers: uploadHeaders, // Let browser set Content-Type with boundary automatically
                    body: formData
                });

                if (!attRes.ok) {
                    throw new Error("Failed to upload bag photos");
                }
                
                const attData = await attRes.json();
                if (Array.isArray(attData) && attData.length > 0) {
                    photoAttachmentIds.push(...attData);
                }
            }

            const recordData = {
                Phone_Number: parseInt(phoneNumber, 10),
                Shop_Name: shopName,
                City: cityId ? parseInt(cityId, 10) : 0,
                Customer_Type: customerType,
                Bags_Requirement: ["L", ...bagsRequirement],
                Revisit_Date: revisitDate ? (new Date(revisitDate).getTime() / 1000) : null,
                Entered_At: Date.now() / 1000,
                Existing_Customer_ID: 0,
                Entered_By: teamId ? parseInt(teamId, 10) : 0,
                Shop_Type: shopType,
                Contact_Person: contactPerson,
                Bag_Photos: photoAttachmentIds.length > 0 ? ["L", ...photoAttachmentIds] : null,
                Latitude: lat,
                Longitude: lng
            };

            const addUrl = getUrl(`/api/docs/${DOC_ID}/tables/Customer_Leads/records`);
            const addRes = await fetch(addUrl, {
                method: 'POST',
                headers: { ...headers, 'Content-Type': 'application/json' },
                body: JSON.stringify({ records: [{ fields: recordData }] })
            });

            if (!addRes.ok) throw new Error("Failed to save lead");

            onSuccess(); // Close modal and maybe refresh data
        } catch (e) {
            console.error(e);
            setSubmitError(e.message || "Unknown error creating lead");
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 bg-white overflow-auto flex flex-col animate-in slide-in-from-bottom duration-300">
            <header className="bg-white border-b border-slate-200 sticky top-0 z-10 px-4 py-3 flex items-center justify-between">
                <div className="flex items-center gap-2">
                    <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white">
                        <UserPlus size={18} />
                    </div>
                    <h1 className="font-bold text-slate-800">Add New Lead</h1>
                </div>
                <Button variant="ghost" onClick={onClose} className="!px-2">
                    <X size={20} />
                </Button>
            </header>

            <main className="flex-1 p-4 max-w-2xl mx-auto w-full">
                {step === 1 ? (
                    <div className="space-y-4 pt-10">
                        <div className="text-center mb-6">
                            <h2 className="text-xl font-bold text-slate-800">Verify Mobile Number</h2>
                            <p className="text-sm text-slate-500 mt-2">Enter the mobile number to check if they are already in our system.</p>
                        </div>
                        
                        <form onSubmit={handleVerify} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Mobile Number <span className="text-red-500">*</span></label>
                                <input
                                    type="tel"
                                    value={phoneNumber}
                                    onChange={(e) => setPhoneNumber(e.target.value.replace(/\D/g, ''))}
                                    placeholder="Enter 10-digit number"
                                    maxLength="10"
                                    className="w-full px-4 py-3 text-lg border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                    required
                                />
                            </div>

                            {verifyError && (
                                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-start gap-2 text-sm">
                                    <XCircle size={18} className="shrink-0 mt-0.5" />
                                    <span>{verifyError}</span>
                                </div>
                            )}

                            <Button 
                                type="submit" 
                                className="w-full py-3" 
                                disabled={verifying || phoneNumber.length < 10}
                                icon={verifying ? Loader2 : Search}
                                variant="primary"
                            >
                                {verifying ? "Verifying..." : "Verify Number"}
                            </Button>
                        </form>
                    </div>
                ) : (
                    <div className="space-y-6 pb-20">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200 flex items-center justify-between">
                            <div>
                                <p className="text-xs text-slate-500 font-medium uppercase tracking-wider">Verified Number</p>
                                <p className="text-lg font-bold text-slate-800">{phoneNumber}</p>
                            </div>
                            <CheckCircle size={24} className="text-green-500" />
                        </div>

                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Shop Name <span className="text-red-500">*</span></label>
                                <input
                                    type="text"
                                    value={shopName}
                                    onChange={e => setShopName(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Contact Person</label>
                                <input
                                    type="text"
                                    value={contactPerson}
                                    onChange={e => setContactPerson(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">City <span className="text-red-500">*</span></label>
                                <select
                                    value={cityId}
                                    onChange={e => setCityId(e.target.value)}
                                    required
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">Select City...</option>
                                    {cities.map(c => (
                                        <option key={c.id} value={c.id}>{c.City_Code2}</option>
                                    ))}
                                </select>
                            </div>

                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Customer Type</label>
                                    <select
                                        value={customerType}
                                        onChange={e => setCustomerType(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                    >
                                        <option value="">Select...</option>
                                        {customerTypeChoices.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-medium text-slate-700 mb-1">Shop Type</label>
                                    <select
                                        value={shopType}
                                        onChange={e => setShopType(e.target.value)}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                    >
                                        <option value="">Select...</option>
                                        {shopTypeChoices.map(c => (
                                            <option key={c} value={c}>{c}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-2">Bags Requirement</label>
                                <div className="grid grid-cols-2 gap-2">
                                    {bagsRequirementsChoices.map(req => (
                                        <label key={req} className="flex items-center gap-2 text-sm text-slate-700 bg-slate-50 p-2 rounded border border-slate-200 cursor-pointer hover:bg-slate-100">
                                            <input 
                                                type="checkbox" 
                                                checked={bagsRequirement.includes(req)}
                                                onChange={() => toggleBagRequirement(req)}
                                                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                                            />
                                            {req}
                                        </label>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Revisit Date</label>
                                <input
                                    type="date"
                                    value={revisitDate}
                                    onChange={e => setRevisitDate(e.target.value)}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none"
                                />
                            </div>

                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">Bag Photos (Optional)</label>
                                <input
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={e => setBagPhotoFiles(Array.from(e.target.files))}
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white text-sm file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
                                />
                                {bagPhotoFiles.length > 0 && (
                                    <p className="text-xs text-slate-500 mt-2">{bagPhotoFiles.length} file(s) selected.</p>
                                )}
                            </div>

                            <div className="pt-2 pb-4">
                                <label className="flex items-center gap-3 p-3 bg-blue-50 border border-blue-200 rounded-lg cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={captureLocation}
                                        onChange={(e) => setCaptureLocation(e.target.checked)}
                                        className="w-5 h-5 text-blue-600 rounded border-slate-300 focus:ring-blue-500"
                                    />
                                    <div>
                                        <div className="font-medium text-blue-900 flex items-center gap-2">
                                            <MapPin size={16} />
                                            Capture Current Location
                                        </div>
                                        <div className="text-xs text-blue-700 mt-1">Saves GPS coordinates with this lead</div>
                                    </div>
                                </label>
                            </div>

                            {submitError && (
                                <div className="p-3 bg-red-50 text-red-700 border border-red-200 rounded-lg flex items-start gap-2 text-sm">
                                    <XCircle size={18} className="shrink-0 mt-0.5" />
                                    <span>{submitError}</span>
                                </div>
                            )}

                            <div className="pt-4 flex gap-3">
                                <Button 
                                    type="button" 
                                    variant="secondary" 
                                    onClick={onClose} 
                                    className="flex-1"
                                >
                                    Cancel
                                </Button>
                                <Button 
                                    type="submit" 
                                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white" 
                                    disabled={submitting}
                                    icon={submitting ? Loader2 : Save}
                                    variant="primary"
                                >
                                    {submitting ? "Saving..." : "Save Lead"}
                                </Button>
                            </div>
                        </form>
                    </div>
                )}
            </main>
        </div>
    );
};

export default AddNewLeadModal;
