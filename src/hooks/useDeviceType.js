import { useState, useEffect } from 'react';

/**
 * Custom hook to detect device type based on screen width
 * @returns {Object} { isMobile, isTablet, isDesktop }
 */
const useDeviceType = () => {
    const [deviceType, setDeviceType] = useState({
        isMobile: false,
        isTablet: false,
        isDesktop: true
    });

    useEffect(() => {
        // Define media queries
        const mobileQuery = window.matchMedia('(max-width: 767px)');
        const tabletQuery = window.matchMedia('(min-width: 768px) and (max-width: 1023px)');
        const desktopQuery = window.matchMedia('(min-width: 1024px)');

        // Handler to update state based on media query matches
        const updateDeviceType = () => {
            setDeviceType({
                isMobile: mobileQuery.matches,
                isTablet: tabletQuery.matches,
                isDesktop: desktopQuery.matches
            });
        };

        // Initial check
        updateDeviceType();

        // Add listeners for changes
        mobileQuery.addEventListener('change', updateDeviceType);
        tabletQuery.addEventListener('change', updateDeviceType);
        desktopQuery.addEventListener('change', updateDeviceType);

        // Cleanup listeners on unmount
        return () => {
            mobileQuery.removeEventListener('change', updateDeviceType);
            tabletQuery.removeEventListener('change', updateDeviceType);
            desktopQuery.removeEventListener('change', updateDeviceType);
        };
    }, []);

    return deviceType;
};

export default useDeviceType;
