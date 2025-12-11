import React, { useEffect, useRef } from 'react';
import { X } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix for default marker icons in Leaflet with Webpack
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon-2x.png',
    iconUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-icon.png',
    shadowUrl: 'https://unpkg.com/leaflet@1.7.1/dist/images/marker-shadow.png',
});

const MapViewModal = ({ customers, onClose }) => {
    const mapContainer = useRef(null);
    const mapRef = useRef(null);

    // Filter customers that have valid latitude and longitude
    const customersWithCoordinates = customers.filter(customer =>
        customer.Latitude && customer.Longitude &&
        !isNaN(parseFloat(customer.Latitude)) &&
        !isNaN(parseFloat(customer.Longitude))
    );

    useEffect(() => {
        if (!mapContainer.current || customersWithCoordinates.length === 0) return;

        // Initialize map
        if (!mapRef.current) {
            mapRef.current = L.map(mapContainer.current).setView([20.5937, 78.9629], 5); // Center on India

            // Add tile layer
            L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
                attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            }).addTo(mapRef.current);
        }

        // Clear existing markers
        if (mapRef.current) {
            mapRef.current.eachLayer(layer => {
                if (layer instanceof L.Marker) {
                    mapRef.current.removeLayer(layer);
                }
            });
        }

        // Add markers for each customer
        customersWithCoordinates.forEach(customer => {
            const lat = parseFloat(customer.Latitude);
            const lng = parseFloat(customer.Longitude);

            if (!isNaN(lat) && !isNaN(lng)) {
                const marker = L.marker([lat, lng]).addTo(mapRef.current);

                // Add popup with customer info
                const popupContent = `
                    <div class="leaflet-popup-content">
                        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">${customer.Shop_Name}</h3>
                        <p style="margin: 4px 0; font-size: 14px;">${customer.Address || ''}</p>
                        <p style="margin: 4px 0; font-size: 14px;">${customer.City || ''}</p>
                        <p style="margin: 4px 0; font-size: 12px; color: #666;">
                            Lat: ${lat.toFixed(6)}, Long: ${lng.toFixed(6)}
                        </p>
                    </div>
                `;

                marker.bindPopup(popupContent);

                // Fit map to show all markers
                if (customersWithCoordinates.length === 1) {
                    mapRef.current.setView([lat, lng], 15);
                }
            }
        });

        // Fit map bounds to show all markers if there are multiple
        if (customersWithCoordinates.length > 1) {
            const bounds = customersWithCoordinates.map(customer => [
                parseFloat(customer.Latitude),
                parseFloat(customer.Longitude)
            ]);
            mapRef.current.fitBounds(bounds);
        }

        // Cleanup function
        return () => {
            if (mapRef.current) {
                mapRef.current.remove();
                mapRef.current = null;
            }
        };
    }, [customersWithCoordinates]);

    return (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="flex justify-between items-center p-4 border-b border-slate-200">
                    <h2 className="text-lg font-semibold text-slate-800">Customer Locations Map</h2>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 p-1 rounded-full hover:bg-slate-100"
                        aria-label="Close map view"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Map Container */}
                <div className="flex-1 min-h-[500px] relative">
                    <div
                        ref={mapContainer}
                        className="absolute inset-0 w-full h-full"
                        style={{ minHeight: '500px' }}
                    />
                </div>

                {/* Customer List */}
                <div className="p-4 border-t border-slate-200 max-h-[250px] overflow-auto">
                    <h3 className="text-sm font-medium text-slate-600 mb-2">Customer Locations ({customersWithCoordinates.length})</h3>
                    {customersWithCoordinates.length === 0 ? (
                        <p className="text-slate-500 text-sm">No customer locations with valid coordinates available.</p>
                    ) : (
                        <div className="space-y-2">
                            {customersWithCoordinates.map((customer, index) => (
                                <div key={index} className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50">
                                    <div className="w-2 h-2 rounded-full bg-indigo-600 flex-shrink-0 mt-2"></div>
                                    <div className="text-sm">
                                        <div className="font-medium text-slate-800">{customer.Shop_Name}</div>
                                        <div className="text-slate-500 text-xs">
                                            {customer.Address}, {customer.City}
                                        </div>
                                        <div className="text-slate-400 text-xs">
                                            Lat: {parseFloat(customer.Latitude).toFixed(6)}, Long: {parseFloat(customer.Longitude).toFixed(6)}
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default MapViewModal;