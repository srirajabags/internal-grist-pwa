import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import { X, Compass } from 'lucide-react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import LocationService from '../utils/locationService';

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
    const [userLocation, setUserLocation] = useState(null);
    const [locationError, setLocationError] = useState(null);
    const [isLoadingLocation, setIsLoadingLocation] = useState(false);

    // Filter customers that have valid latitude and longitude
    const customersWithCoordinates = customers.filter(customer =>
        customer.Latitude && customer.Longitude &&
        !isNaN(parseFloat(customer.Latitude)) &&
        !isNaN(parseFloat(customer.Longitude))
    );

    // Add user location to the list if available
    const allLocations = useMemo(() => {
        return userLocation
            ? [...customersWithCoordinates, userLocation]
            : customersWithCoordinates;
    }, [customersWithCoordinates, userLocation]);

    /**
     * Get user's current location using the location service
     */
    const getUserLocation = useCallback(async () => {
        try {
            setIsLoadingLocation(true);
            setLocationError(null);

            const location = await LocationService.getLocationForMap();
            setUserLocation(location);
            setIsLoadingLocation(false);
        } catch (error) {
            console.error('Failed to get user location:', error);
            setLocationError(error.message);
            setIsLoadingLocation(false);
        }
    }, [setUserLocation, setLocationError, setIsLoadingLocation]);

    useEffect(() => {
        if (!mapContainer.current || allLocations.length === 0) return;

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

        // Add markers for each location
        allLocations.forEach(location => {
            const lat = parseFloat(location.Latitude);
            const lng = parseFloat(location.Longitude);

            if (!isNaN(lat) && !isNaN(lng)) {
                // Create custom marker for user location
                let marker;
                if (location.Shop_Name === 'Your Current Location') {
                    // Blue marker for user location
                    marker = L.marker([lat, lng], {
                        icon: L.divIcon({
                            className: 'user-location-marker',
                            html: '<div style="background-color: #3b82f6; width: 24px; height: 24px; border-radius: 50%; border: 3px solid white; box-shadow: 0 0 0 2px #3b82f6;"></div>',
                            iconSize: [24, 24],
                            iconAnchor: [12, 12]
                        })
                    }).addTo(mapRef.current);
                } else {
                    // Default marker for customers
                    marker = L.marker([lat, lng]).addTo(mapRef.current);
                }

                // Add popup with location info
                const popupContent = `
                    <div class="leaflet-popup-content">
                        <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: bold;">${location.Shop_Name}</h3>
                        <p style="margin: 4px 0; font-size: 14px;">${location.Address || ''}</p>
                        <p style="margin: 4px 0; font-size: 14px;">${location.City || ''}</p>
                        <p style="margin: 4px 0; font-size: 12px; color: #666;">
                            Lat: ${lat.toFixed(6)}, Long: ${lng.toFixed(6)}
                        </p>
                    </div>
                `;

                marker.bindPopup(popupContent);

                // Center map on user location when first retrieved
                if (location.Shop_Name === 'Your Current Location' && allLocations.length === 1) {
                    mapRef.current.setView([lat, lng], 15);
                }
            }
        });

        // Fit map bounds to show all markers if there are multiple
        if (allLocations.length > 1) {
            const bounds = allLocations.map(location => [
                parseFloat(location.Latitude),
                parseFloat(location.Longitude)
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
    }, [allLocations, getUserLocation]);

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

                {/* Location Controls */}
                <div className="p-4 border-t border-slate-200 flex items-center gap-2">
                    <button
                        onClick={getUserLocation}
                        disabled={isLoadingLocation}
                        className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed transition-colors"
                    >
                        <Compass size={16} />
                        <span>{isLoadingLocation ? 'Locating...' : 'Show My Location'}</span>
                    </button>
                    {locationError && (
                        <div className="text-red-600 text-sm flex-1">
                            <span className="font-medium">Error:</span> {locationError}
                        </div>
                    )}
                </div>

                {/* Customer List */}
                <div className="p-4 border-t border-slate-200 max-h-[250px] overflow-auto">
                    <h3 className="text-sm font-medium text-slate-600 mb-2">Locations ({allLocations.length})</h3>
                    {allLocations.length === 0 ? (
                        <p className="text-slate-500 text-sm">No locations with valid coordinates available.</p>
                    ) : (
                        <div className="space-y-2">
                            {allLocations.map((location, index) => (
                                <div key={index} className="flex items-start gap-2 p-2 rounded-lg hover:bg-slate-50">
                                    <div className={`w-2 h-2 rounded-full flex-shrink-0 mt-2 ${location.Shop_Name === 'Your Current Location' ? 'bg-blue-600' : 'bg-indigo-600'}`}></div>
                                    <div className="text-sm">
                                        <div className="font-medium text-slate-800">{location.Shop_Name}</div>
                                        <div className="text-slate-500 text-xs">
                                            {location.Address}, {location.City}
                                        </div>
                                        <div className="text-slate-400 text-xs">
                                            Lat: {parseFloat(location.Latitude).toFixed(6)}, Long: {parseFloat(location.Longitude).toFixed(6)}
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