/**
 * Location Service for handling geolocation functionality
 * Provides a clean interface for getting user's current location
 * and handles errors and permissions gracefully
 */

class LocationService {
  /**
   * Get the current position of the user
   * @returns {Promise<Object>} Promise that resolves to location data {latitude, longitude}
   * @throws {Error} If geolocation fails or is not supported
   */
  static getCurrentPosition() {
    return new Promise((resolve, reject) => {
      // Check if geolocation is supported by the browser
      if (!('geolocation' in navigator)) {
        reject(new Error('Geolocation is not supported by this browser'));
        return;
      }

      // Get current position with high accuracy
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { latitude, longitude, accuracy } = position.coords;
          resolve({
            latitude,
            longitude,
            accuracy,
            timestamp: position.timestamp
          });
        },
        (error) => {
          // Handle geolocation errors
          reject(this._handleGeolocationError(error));
        },
        {
          enableHighAccuracy: true,
          timeout: 10000, // 10 seconds timeout
          maximumAge: 0 // Don't use cached positions
        }
      );
    });
  }

  /**
   * Handle geolocation errors and permissions
   * @param {GeolocationPositionError} error - The error object from the geolocation API
   * @returns {Error} - A user-friendly error with appropriate message
   * @private
   */
  static _handleGeolocationError(error) {
    let errorMessage;

    switch (error.code) {
      case error.PERMISSION_DENIED:
        errorMessage = 'User denied the request for Geolocation.';
        break;
      case error.POSITION_UNAVAILABLE:
        errorMessage = 'Location information is unavailable.';
        break;
      case error.TIMEOUT:
        errorMessage = 'The request to get user location timed out.';
        break;
      case error.UNKNOWN_ERROR:
      default:
        errorMessage = 'An unknown error occurred while getting location.';
        break;
    }

    return new Error(errorMessage);
  }

  /**
   * Check if geolocation is available in the browser
   * @returns {boolean} True if geolocation is supported
   */
  static isGeolocationSupported() {
    return 'geolocation' in navigator;
  }

  /**
   * Get location data in format compatible with existing map implementation
   * @returns {Promise<Object>} Promise that resolves to map-compatible location data
   */
  static async getLocationForMap() {
    try {
      const position = await this.getCurrentPosition();
      return {
        Latitude: position.latitude.toString(),
        Longitude: position.longitude.toString(),
        Shop_Name: 'Your Current Location',
        Address: `Current location (accuracy: ${Math.round(position.accuracy)} meters)`,
        City: 'Current Location'
      };
    } catch (error) {
      console.error('Failed to get location for map:', error);
      throw error;
    }
  }
}

// Export the LocationService class
export default LocationService;