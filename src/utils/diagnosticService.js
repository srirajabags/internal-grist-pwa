import { APP_VERSION, BUILD_TIMESTAMP_IST_READABLE } from '../version.js';

/**
 * Diagnostic Service for generating comprehensive reports
 * to debug API reachability and application issues
 */

// Helper function to safely get navigator connection info
const getNetworkInfo = () => {
  try {
    if (navigator.connection) {
      return {
        effectiveType: navigator.connection.effectiveType,
        downlink: navigator.connection.downlink,
        rtt: navigator.connection.rtt,
        saveData: navigator.connection.saveData
      };
    }
  } catch (e) {
    console.warn('Could not access network connection info:', e);
  }
  return {
    effectiveType: 'unknown',
    downlink: 0,
    rtt: 0,
    saveData: false
  };
};

// Helper function to get system information
export const getSystemInfo = () => {
  try {
    return {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      language: navigator.language,
      languages: navigator.languages,
      screenResolution: `${window.screen.width}x${window.screen.height}`,
      viewport: `${window.innerWidth}x${window.innerHeight}`,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      online: navigator.onLine,
      ...getNetworkInfo()
    };
  } catch (e) {
    console.error('Error getting system info:', e);
    return {
      error: 'Failed to collect system information',
      details: e.message
    };
  }
};

// Helper function to test CORS
export const testCORS = async (url) => {
  try {
    const startTime = Date.now();
    const response = await fetch(url, {
      method: 'OPTIONS',
      mode: 'cors',
      headers: {
        'Origin': window.location.origin
      }
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    return {
      success: response.ok,
      status: response.status,
      responseTime,
      headers: Object.fromEntries(response.headers.entries()),
      error: null
    };
  } catch (error) {
    const endTime = Date.now();
    return {
      success: false,
      status: 0,
      responseTime: endTime - Date.now(),
      headers: {},
      error: error.message
    };
  }
};

// Helper function to test API endpoint
export const testAPIEndpoint = async (url, method = 'GET', headers = {}, body = null) => {
  const startTime = Date.now();

  try {
    const response = await fetch(url, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers
      },
      body: body ? JSON.stringify(body) : null
    });

    const endTime = Date.now();
    const responseTime = endTime - startTime;

    let responseData;
    try {
      responseData = await response.json();
    } catch (parseError) {
      console.warn('Failed to parse JSON response, falling back to text:', parseError.message);
      responseData = await response.text();
    }

    return {
      success: response.ok,
      status: response.status,
      responseTime,
      response: responseData,
      error: null
    };
  } catch (error) {
    const endTime = Date.now();

    // Capture comprehensive error information
    const errorInfo = {
      name: error.name,
      message: error.message,
      stack: error.stack,
      cause: error.cause,
      type: error.constructor.name
    };

    // Check for specific "Failed to fetch" error
    if (error.name === 'TypeError' && error.message.includes('Failed to fetch')) {
      errorInfo.specificError = 'Network Fetch Error';
      errorInfo.likelyCauses = [
        'Network connectivity issues',
        'CORS configuration problems',
        'Server unavailable or misconfigured',
        'Browser security restrictions',
        'Firewall or proxy blocking requests'
      ];
      errorInfo.recommendation = 'Check network connection, CORS headers, and server status';
    }

    return {
      success: false,
      status: 0,
      responseTime: endTime - startTime,
      response: null,
      error: error.message,
      errorType: error.name,
      errorStack: error.stack,
      errorDetails: errorInfo
    };
  }
};

// Generate diagnostic report
export const generateDiagnosticReport = async (getHeaders, getUrl) => {
  const report = {
    metadata: {
      generatedAt: new Date().toISOString(),
      reportVersion: '1.0.0',
      appVersion: APP_VERSION,
      buildTimestamp: BUILD_TIMESTAMP_IST_READABLE
    },
    systemInfo: getSystemInfo(),
    networkTests: [],
    apiTests: [],
    errorLogs: [],
    configuration: {
      gristServerUrl: import.meta.env.VITE_GRIST_SERVER_URL,
      appVersion: APP_VERSION,
      buildTimestamp: BUILD_TIMESTAMP_IST_READABLE,
      featureFlags: {
        consoleEnabled: localStorage.getItem('consoleEnabled') === 'true'
      }
    },
    localStorage: {}
  };

  // Add network connectivity tests
  try {
    report.networkTests.push({
      name: 'Online Status',
      test: 'navigator.onLine',
      result: navigator.onLine ? 'online' : 'offline'
    });

    report.networkTests.push({
      name: 'CORS Test',
      test: 'OPTIONS request to API server',
      result: await testCORS(getUrl('/api'))
    });
  } catch (e) {
    report.networkTests.push({
      name: 'Network Tests',
      test: 'Network connectivity tests',
      result: {
        error: 'Failed to run network tests',
        details: e.message
      }
    });
  }

  // Add API diagnostic tests
  try {
    // Test 1: Team ID fetch (the specific error mentioned in the task)
    try {
      const headers = await getHeaders();
      const teamTest = await testAPIEndpoint(getUrl('/api/docs/8vRFY3UUf4spJroktByH4u/sql'), 'POST', headers, {
        sql: 'SELECT id FROM Team WHERE Email = ?',
        args: ['test@example.com'] // Use a dummy email to test the endpoint
      });

      report.apiTests.push({
        name: 'Team ID Fetch Test',
        endpoint: '/api/docs/8vRFY3UUf4spJroktByH4u/sql',
        method: 'POST',
        ...teamTest
      });
    } catch (e) {
      // Capture detailed stack trace for the specific "Failed to fetch" error
      const errorDetails = {
        name: e.name,
        message: e.message,
        stack: e.stack,
        cause: e.cause,
        type: 'TypeError'
      };

      // Check if this is the specific error we're targeting
      if (e.name === 'TypeError' && e.message.includes('Failed to fetch')) {
        errorDetails.specificError = 'Team ID Fetch Failed to Fetch Error';
        errorDetails.recommendation = 'This typically indicates network connectivity issues, CORS problems, or server unavailability';
      }

      report.apiTests.push({
        name: 'Team ID Fetch Test',
        endpoint: '/api/docs/8vRFY3UUf4spJroktByH4u/sql',
        method: 'POST',
        success: false,
        error: 'Failed to test Team ID fetch - Detailed error captured',
        errorType: e.name,
        errorMessage: e.message,
        errorStack: e.stack,
        errorDetails: errorDetails
      });
    }

    // Test 2: Document discovery (with auth)
    try {
      const headers = await getHeaders();
      const docsTest = await testAPIEndpoint(getUrl('/api/orgs'), 'GET', headers);
      report.apiTests.push({
        name: 'Document Discovery',
        endpoint: '/api/orgs',
        method: 'GET',
        ...docsTest
      });
    } catch (e) {
      report.apiTests.push({
        name: 'Document Discovery',
        endpoint: '/api/orgs',
        method: 'GET',
        success: false,
        error: 'Failed to test document discovery',
        details: e.message
      });
    }

  } catch (e) {
    report.apiTests.push({
      name: 'API Tests',
      endpoint: 'Multiple endpoints',
      method: 'Various',
      success: false,
      error: 'Failed to run API tests',
      details: e.message
    });
  }

  // Add error logs from console (if available)
  try {
    if (window.console && window.console._logs) {
      report.errorLogs = window.console._logs || [];
    }
  } catch (e) {
    report.errorLogs.push({
      timestamp: new Date().toISOString(),
      type: 'warning',
      message: 'Could not access console logs',
      details: e.message
    });
  }

  // Add local storage information (redact sensitive data)
  try {
    const storageData = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      const value = localStorage.getItem(key);

      // Redact potentially sensitive keys
      if (key && typeof key === 'string') {
        if (key.toLowerCase().includes('token') ||
            key.toLowerCase().includes('password') ||
            key.toLowerCase().includes('secret') ||
            key.toLowerCase().includes('auth')) {
          storageData[key] = '[REDACTED - SENSITIVE DATA]';
        } else {
          storageData[key] = value;
        }
      }
    }
    report.localStorage = storageData;
  } catch (e) {
    report.localStorage = {
      error: 'Failed to access localStorage',
      details: e.message
    };
  }

  return report;
};

// Download report as JSON file
export const downloadDiagnosticReport = (report, filenamePrefix = 'grist-pwa-diagnostic') => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${filenamePrefix}-report-${timestamp}.json`;

    const jsonStr = JSON.stringify(report, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    return {
      success: true,
      filename,
      size: jsonStr.length
    };
  } catch (e) {
    return {
      success: false,
      error: 'Failed to download diagnostic report',
      details: e.message
    };
  }
};

// Generate and download report in one step
export const generateAndDownloadDiagnosticReport = async (getHeaders, getUrl) => {
  try {
    const report = await generateDiagnosticReport(getHeaders, getUrl);
    const downloadResult = downloadDiagnosticReport(report);

    if (!downloadResult.success) {
      throw new Error(downloadResult.error);
    }

    return {
      success: true,
      report,
      downloadResult
    };
  } catch (e) {
    return {
      success: false,
      error: 'Failed to generate and download diagnostic report',
      details: e.message,
      stack: e.stack
    };
  }
};