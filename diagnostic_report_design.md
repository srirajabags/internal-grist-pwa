# Diagnostic Report Generation Feature Design

## Overview
This feature will add a "Generate Diagnostic Report" button to the settings modal that creates a comprehensive report to help debug API reachability issues.

## Report Contents

### 1. System Information
- **Browser**: Name, version, user agent
- **Operating System**: Platform, architecture
- **Device Type**: Mobile/desktop/tablet detection
- **Screen Resolution**: Current viewport dimensions
- **Time Zone**: User's local time zone
- **Locale**: Browser language settings

### 2. Network Connectivity
- **Online Status**: navigator.onLine status
- **Connection Type**: Effective connection type (4G, WiFi, etc.)
- **Connection Speed**: Estimated bandwidth
- **CORS Test**: Test if CORS headers are properly configured
- **DNS Resolution**: Test DNS lookup for API server
- **Server Reachability**: Basic ping test to API endpoints

### 3. API Diagnostic Tests
- **Authentication Test**: Test Auth0 token validation
- **Team ID Fetch Test**: Reproduce the specific error mentioned
- **Document Discovery Test**: Test `/api/orgs` and workspace endpoints
- **Table Access Test**: Test basic table access
- **SQL Query Test**: Test SQL endpoint functionality

### 4. Error Logs
- **Console Errors**: Recent error messages from console
- **Console Warnings**: Recent warning messages
- **Network Errors**: Failed fetch requests
- **JavaScript Errors**: Uncaught exceptions

### 5. Configuration Details
- **Grist Server URL**: Current configured endpoint
- **Auth0 Configuration**: Domain, client ID (redacted)
- **App Version**: Current application version
- **Build Timestamp**: Deployment information
- **Feature Flags**: Enabled/disabled features

### 6. Performance Metrics
- **API Response Times**: Timing for each diagnostic test
- **Network Latency**: Round-trip time measurements
- **Resource Timing**: Page load performance metrics

## Implementation Plan

### 1. Create Diagnostic Service
- New utility module: `src/utils/diagnosticService.js`
- Functions for gathering system information
- Network connectivity tests
- API diagnostic functions
- Error log collection

### 2. Create Report Generator
- Function to compile all diagnostic data
- JSON and text formatting options
- File download functionality
- Error handling for report generation itself

### 3. Integrate with Settings Modal
- Add "Generate Diagnostic Report" button
- Loading state during report generation
- Error handling for report generation failures
- Success notification with download option

### 4. Error Handling
- Graceful degradation if diagnostics fail
- Timeout handling for network tests
- Permission handling for system information
- Fallback data when information is unavailable

## Technical Details

### Report Format
```json
{
  "metadata": {
    "generatedAt": "2025-12-11T07:32:00.000Z",
    "reportVersion": "1.0",
    "appVersion": "1.2.3"
  },
  "systemInfo": {
    "browser": "Chrome 120.0.0.0",
    "os": "Windows 11",
    "deviceType": "desktop",
    "screenResolution": "1920x1080",
    "timeZone": "Asia/Kolkata",
    "locale": "en-US"
  },
  "networkInfo": {
    "online": true,
    "connectionType": "wifi",
    "estimatedBandwidth": "10 Mbps",
    "corsTest": "passed",
    "dnsResolution": "successful",
    "serverReachability": "reachable"
  },
  "apiTests": [
    {
      "name": "Authentication Test",
      "endpoint": "/api/userinfo",
      "status": "success",
      "responseTime": 120,
      "error": null
    },
    {
      "name": "Team ID Fetch",
      "endpoint": "/api/docs/8vRFY3UUf4spJroktByH4u/sql",
      "status": "failed",
      "responseTime": 45,
      "error": "TypeError: Failed to fetch"
    }
  ],
  "errorLogs": [
    {
      "timestamp": "2025-12-11T07:30:15.234Z",
      "type": "error",
      "message": "Failed to fetch Team ID",
      "stack": "TypeError: Failed to fetch..."
    }
  ],
  "configuration": {
    "gristServerUrl": "https://api.example.com",
    "auth0Domain": "example.auth0.com",
    "appVersion": "1.2.3",
    "buildTimestamp": "2025-12-10T14:30:00.000Z"
  }
}
```

### File Download
- JSON format for easy parsing
- Text format for readability
- Filename: `grist-pwa-diagnostic-report-[timestamp].json`
- MIME type: `application/json`

## Security Considerations
- Redact sensitive information (tokens, personal data)
- Only collect diagnostic-relevant information
- Clear user consent before generation
- No automatic upload of reports

## User Experience
- Clear button in settings: "Generate Diagnostic Report"
- Progress indicator during generation
- Success toast with download link
- Error handling with retry option
- Help text explaining purpose and privacy