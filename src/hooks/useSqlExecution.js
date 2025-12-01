import { useState, useEffect, useCallback } from 'react';

export const useSqlExecution = (initialQuery, docId, getHeaders, getUrl, refreshTrigger = 0) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);

    // Variable State
    const [variables, setVariables] = useState({});
    const [parsedVars, setParsedVars] = useState([]);

    // Parse variables on init
    useEffect(() => {
        if (!initialQuery || typeof initialQuery !== 'string') return;

        const regex = /\{\{([^}]+)\}\}/g;
        const matches = [...initialQuery.matchAll(regex)];

        const newVars = [];
        const newVarState = {};
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
            // We check against existing variables to preserve state if query re-parses but vars are same
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
        // Only set initial variables if we found some, to avoid overwriting if this effect runs again?
        // Actually, for now let's just set them. If we want to persist, we'd need more complex logic.
        if (hasNewVars) {
            setVariables(newVarState);
        }
    }, [initialQuery]);

    const setVariable = (name, value) => {
        setVariables(prev => ({
            ...prev,
            [name]: value
        }));
    };

    const execute = useCallback(async () => {
        if (!docId || !initialQuery || typeof initialQuery !== 'string') return;

        setLoading(true);
        setError(null);

        try {
            const headers = await getHeaders();

            // Interpolate variables
            let finalQuery = initialQuery;
            parsedVars.forEach(v => {
                let value = variables[v.name];

                // Debug log for variable interpolation
                console.log(`Interpolating ${v.name} (${v.type}):`, value);

                if (v.type === 'boolean') {
                    value = value ? 1 : 0;
                }

                const escapedRaw = v.raw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                finalQuery = finalQuery.replace(new RegExp(escapedRaw, 'g'), value);
            });

            console.log("Executing SQL:", finalQuery);

            const url = getUrl(`/api/docs/${docId}/sql?q=${encodeURIComponent(finalQuery)}`);
            const response = await fetch(url, { headers });

            if (!response.ok) {
                throw new Error(`Query failed: ${response.statusText}`);
            }

            const result = await response.json();
            setData(result.records);
        } catch (err) {
            console.error("SQL Execution Error:", err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, [docId, initialQuery, parsedVars, variables, getHeaders, getUrl]);

    // Auto-execute when variables change, refreshTrigger changes, or on mount
    useEffect(() => {
        // Debounce slightly to avoid double execution on mount
        const timer = setTimeout(() => {
            if (docId && initialQuery) {
                execute();
            }
        }, 100);
        return () => clearTimeout(timer);
    }, [execute, refreshTrigger]);

    return {
        data,
        loading,
        error,
        variables,
        parsedVars,
        setVariable,
        execute
    };
};
