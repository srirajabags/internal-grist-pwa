import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Trash2, Download, Share2 } from 'lucide-react';

const Console = () => {
  const [logs, setLogs] = useState([]);
  const [isMinimized, setIsMinimized] = useState(false);
  const logContainerRef = useRef(null);

  // Helper to format timestamp
  const formatTime = (date) => {
    return date.toLocaleTimeString('en-US', {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3
    });
  };

  // Function to add log entry
  const addLog = useCallback((type, args) => {
    const timestamp = new Date();
    const logEntry = {
      id: Date.now() + Math.random(),
      type,
      timestamp,
      message: args.map(arg => {
        // Handle Error objects specially to show full details
        if (arg instanceof Error) {
          return `${arg.name}: ${arg.message}${arg.stack ? '\n' + arg.stack : ''}`;
        }
        // Handle regular objects
        if (typeof arg === 'object' && arg !== null) {
          try {
            return JSON.stringify(arg, null, 2);
          } catch {
            return String(arg);
          }
        }
        return String(arg);
      }).join(' ')
    };
    
    setLogs(prevLogs => [...prevLogs, logEntry]);
  }, []);

  // Auto-scroll to bottom when new logs are added
  useEffect(() => {
    if (logContainerRef.current && !isMinimized) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isMinimized]);

  // Intercept console methods
  useEffect(() => {
    const originalLog = console.log;
    const originalWarn = console.warn;
    const originalError = console.error;

    console.log = (...args) => {
      addLog('log', args);
      originalLog.apply(console, args);
    };

    console.warn = (...args) => {
      addLog('warn', args);
      originalWarn.apply(console, args);
    };

    console.error = (...args) => {
      addLog('error', args);
      originalError.apply(console, args);
    };

    // Cleanup function to restore original methods
    return () => {
      console.log = originalLog;
      console.warn = originalWarn;
      console.error = originalError;
    };
  }, [addLog]);

  // Clear all logs
  const clearLogs = () => {
    setLogs([]);
  };

  // Export logs as text file
  const exportLogs = () => {
    if (logs.length === 0) {
      alert('No logs to export');
      return;
    }

    const logText = logs.map(log => {
      const timestamp = formatTime(log.timestamp);
      const logInfo = getLogInfo(log.type);
      return `[${timestamp}] ${logInfo.label}: ${log.message}`;
    }).join('\n');

    const blob = new Blob([logText], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `console-logs-${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.txt`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  // Share logs via Web Share API or copy to clipboard
  const shareLogs = async () => {
    if (logs.length === 0) {
      alert('No logs to share');
      return;
    }

    const logText = logs.map(log => {
      const timestamp = formatTime(log.timestamp);
      const logInfo = getLogInfo(log.type);
      return `[${timestamp}] ${logInfo.label}: ${log.message}`;
    }).join('\n');

    const shareText = `Console Logs (${logs.length} entries)\nGenerated on: ${new Date().toLocaleString()}\n\n${logText}`;

    try {
      // Try Web Share API first (works on mobile and some desktop browsers)
      if (navigator.share) {
        await navigator.share({
          title: 'Console Logs',
          text: shareText
        });
      } else {
        // Fallback: Copy to clipboard
        await navigator.clipboard.writeText(shareText);
        alert('Logs copied to clipboard! You can now paste them in WhatsApp or any other app.');
      }
    } catch (error) {
      console.error('Error sharing logs:', error);
      // Final fallback: show prompt with text to copy manually
      prompt('Copy the logs below:', shareText);
    }
  };

  // Get log styling based on type
  const getLogStyle = (type) => {
    switch (type) {
      case 'error':
        return 'text-red-400 bg-red-900/20 border-red-800/30';
      case 'warn':
        return 'text-yellow-400 bg-yellow-900/20 border-yellow-800/30';
      default:
        return 'text-white bg-gray-800/50 border-gray-700/30';
    }
  };

  // Get log type icon and label
  const getLogInfo = (type) => {
    switch (type) {
      case 'error':
        return { label: 'ERROR', className: 'text-red-400' };
      case 'warn':
        return { label: 'WARN', className: 'text-yellow-400' };
      default:
        return { label: 'LOG', className: 'text-white' };
    }
  };

  if (isMinimized) {
    return (
      <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 z-50">
        <div className="flex items-center justify-between px-4 py-2">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
            <span className="text-white text-sm font-medium">Console</span>
            <span className="text-gray-400 text-xs">({logs.length} entries)</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={exportLogs}
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              title="Export Logs"
            >
              <Download size={14} />
            </button>
            <button
              onClick={shareLogs}
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              title="Share Logs"
            >
              <Share2 size={14} />
            </button>
            <button
              onClick={clearLogs}
              className="text-gray-400 hover:text-white p-1 rounded transition-colors"
              title="Clear Console"
            >
              <Trash2 size={14} />
            </button>
            <button
              onClick={() => setIsMinimized(false)}
              className="text-gray-400 hover:text-white px-2 py-1 text-xs border border-gray-600 rounded hover:border-gray-500 transition-colors"
            >
              Expand
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-gray-900 border-t border-gray-700 z-50 flex flex-col max-h-64">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 bg-green-400 rounded-full animate-pulse"></div>
          <span className="text-white text-sm font-medium">Console</span>
          <span className="text-gray-400 text-xs">({logs.length} entries)</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={exportLogs}
            className="text-gray-400 hover:text-white p-1 rounded transition-colors"
            title="Export Logs"
          >
            <Download size={14} />
          </button>
          <button
            onClick={shareLogs}
            className="text-gray-400 hover:text-white p-1 rounded transition-colors"
            title="Share Logs"
          >
            <Share2 size={14} />
          </button>
          <button
            onClick={clearLogs}
            className="text-gray-400 hover:text-white p-1 rounded transition-colors"
            title="Clear Console"
          >
            <Trash2 size={14} />
          </button>
          <button
            onClick={() => setIsMinimized(true)}
            className="text-gray-400 hover:text-white px-2 py-1 text-xs border border-gray-600 rounded hover:border-gray-500 transition-colors"
          >
            Minimize
          </button>
        </div>
      </div>

      {/* Log Content */}
      <div 
        ref={logContainerRef}
        className="flex-1 overflow-y-auto p-2 space-y-1 text-xs font-mono"
        style={{ maxHeight: '200px' }}
      >
        {logs.length === 0 ? (
          <div className="text-gray-500 italic text-center py-8">
            Console is ready. Check your browser's developer console for more details.
          </div>
        ) : (
          logs.map((log) => {
            const logInfo = getLogInfo(log.type);
            return (
              <div
                key={log.id}
                className={`flex items-start gap-2 p-2 rounded border ${getLogStyle(log.type)}`}
              >
                <span className={`text-xs font-bold min-w-[3rem] ${logInfo.className}`}>
                  {logInfo.label}
                </span>
                <span className="text-gray-400 text-xs min-w-[5rem]">
                  {formatTime(log.timestamp)}
                </span>
                <div className="flex-1 text-wrap break-words">
                  {log.message}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Console;