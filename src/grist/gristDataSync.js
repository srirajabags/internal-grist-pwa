/**
 * Utility for syncing data with Grist 'PWA_Data' table.
 * 
 * Assumes a table named 'PWA_Data' exists with columns:
 * - UUID (Text, unique identifier)
 * - Data_Type (Text, e.g., 'SQL_QUERY')
 * - Data (Text, JSON stringified object)
 */

/**
 * Fetch records from PWA_Data table for a specific type.
 * @param {string} docId - The Grist document ID.
 * @param {string} dataType - The type of data to fetch (e.g., 'SQL_QUERY').
 * @param {function} getHeaders - Function to get auth headers.
 * @param {function} getUrl - Function to construct full URL.
 * @returns {Promise<Array>} - Array of record objects.
 */
export const fetchPwaData = async (docId, dataType, getHeaders, getUrl) => {
    if (!docId) return [];

    try {
        const headers = await getHeaders();
        // Filter by Data_Type using Grist filter parameter
        const filter = JSON.stringify({ Data_Type: [dataType] });
        const url = getUrl(`/api/docs/${docId}/tables/PWA_Data/records?filter=${encodeURIComponent(filter)}`);

        const response = await fetch(url, { headers });

        if (!response.ok) {
            if (response.status === 404) {
                console.warn("PWA_Data table not found in this document.");
                return [];
            }
            throw new Error(`Failed to fetch PWA_Data: ${response.statusText}`);
        }

        const data = await response.json();
        return data.records || [];
    } catch (error) {
        console.error("Error fetching PWA_Data:", error);
        return [];
    }
};

/**
 * Save (Upsert) records to PWA_Data table.
 * Uses the 'require' parameter to ensure UUIDs are unique/matched.
 * @param {string} docId - The Grist document ID.
 * @param {Array} records - Array of objects to save. Each must have a UUID.
 * @param {string} dataType - The Data_Type for these records.
 * @param {function} getHeaders - Function to get auth headers.
 * @param {function} getUrl - Function to construct full URL.
 * @returns {Promise<void>}
 */
export const savePwaData = async (docId, records, dataType, getHeaders, getUrl) => {
    if (!docId || !records || records.length === 0) return;

    try {
        const headers = await getHeaders();
        const url = getUrl(`/api/docs/${docId}/tables/PWA_Data/records`);

        // Format records for Grist API
        // We use 'require' to match on UUID. If UUID exists, it updates; otherwise, it creates.
        const payload = {
            records: records.map(record => ({
                require: {
                    UUID: record.uuid || crypto.randomUUID() // Ensure UUID exists
                },
                fields: {
                    Data_Type: dataType,
                    Data: JSON.stringify(record)
                }
            }))
        };

        const response = await fetch(url, {
            method: 'PUT', // PUT is typically used for add/update in Grist with 'require' (or POST with upsert logic, but PUT /records is standard for bulk update/add)
            // Actually, Grist API docs say:
            // POST /records -> Add records
            // PUT /records -> Update records (needs 'id')
            // To doing "Add or Update" based on a key, we use the 'require' object in the record payload with POST or PUT? 
            // Re-reading user request: "replaceRecords endpoint with the 'require' fields"
            // The endpoint for replace/upsert is usually PUT /records (updates) but with 'require' it acts as upsert?
            // Wait, standard Grist API:
            // POST /records: Add new.
            // PUT /records: Update existing (requires 'id').
            // BUT, there is no explicit "replaceRecords" endpoint in standard REST API docs usually, it's often a client lib concept.
            // However, the user linked: https://support.getgrist.com/api/#tag/records/operation/replaceRecords
            // That endpoint is `PUT /api/docs/{docId}/tables/{tableId}/records`.
            // And it says: "Update existing records, or add new ones if they don't exist."
            // So PUT is correct.
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
            throw new Error(`Failed to save PWA_Data: ${response.statusText}`);
        }
    } catch (error) {
        console.error("Error saving PWA_Data:", error);
        throw error;
    }
};

/**
 * Delete records from PWA_Data table.
 * @param {string} docId - The Grist document ID.
 * @param {Array} uuids - Array of UUIDs to delete.
 * @param {function} getHeaders - Function to get auth headers.
 * @param {function} getUrl - Function to construct full URL.
 * @returns {Promise<void>}
 */
export const deletePwaData = async (docId, uuids, getHeaders, getUrl) => {
    if (!docId || !uuids || uuids.length === 0) return;

    try {
        // First we need to find the Row IDs for these UUIDs because DELETE requires Row IDs
        // We can reuse fetchPwaData but we need to filter by UUIDs.
        // Since Grist filter param is simple, we might have to fetch all for type or fetch specifically.
        // For simplicity, let's assume we might not have the Row IDs locally if we only synced data.
        // But wait, when we sync FROM Grist, we get the 'id' (Row ID).
        // If we saved TO Grist, we might not have the new Row ID until we fetch again.

        // Strategy:
        // 1. Fetch records matching the UUIDs to get their Row IDs.
        // 2. Call DELETE with those Row IDs.

        const headers = await getHeaders();

        // Construct filter for UUIDs
        // Grist filter: { colName: [val1, val2] }
        const filter = JSON.stringify({ UUID: uuids });
        const fetchUrl = getUrl(`/api/docs/${docId}/tables/PWA_Data/records?filter=${encodeURIComponent(filter)}`);

        const fetchRes = await fetch(fetchUrl, { headers });
        if (!fetchRes.ok) return; // Can't delete what we can't find

        const data = await fetchRes.json();
        const rowIds = data.records.map(r => r.id);

        if (rowIds.length === 0) return;

        // Now Delete
        // DELETE /api/docs/{docId}/tables/{tableId}/data/delete (or just standard records endpoint?)
        // Grist API: POST /api/docs/{docId}/tables/{tableId}/data/delete is for custom widgets?
        // Standard API: DELETE /api/docs/{docId}/tables/{tableId}/records (Not always supported directly with body?)
        // Actually, Grist API usually uses a POST to /delete or similar for bulk delete?
        // Checking docs... usually it's POST /records with X-HTTP-Method-Override: DELETE or similar?
        // No, standard is usually just passing IDs in query for single, but for bulk?
        // Let's check the user provided link context or standard Grist patterns.
        // The user didn't specify delete endpoint, but standard is usually:
        // POST /api/docs/{docId}/tables/{tableId}/data/delete (This is often internal)
        // OR standard REST: DELETE /api/docs/{docId}/tables/{tableId}/records?ids=1,2,3

        // Let's try the standard REST way with query params if list is short, or check if there's a body support.
        // If not sure, I'll use the safe approach: fetch IDs and loop if needed, or use the ?ids=... param.
        // Given the user wants "modular", I'll stick to what I know works:
        // The standard Grist API documentation says for deleting records:
        // POST /api/docs/{docId}/tables/{tableId}/records with header "X-HTTP-Method-Override: DELETE" (or just DELETE method if client supports body, but fetch does).
        // Body: [id1, id2, ...] (Array of integers)

        const deleteUrl = getUrl(`/api/docs/${docId}/tables/PWA_Data/data/delete`);
        const deleteRes = await fetch(deleteUrl, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(rowIds)
        });

        if (!deleteRes.ok) {
            console.error("Failed to delete records", await deleteRes.text());
        }

    } catch (error) {
        console.error("Error deleting PWA_Data:", error);
    }
};

/**
 * Fetch records from PWA_Data table using SQL query with teamId filter.
 * @param {string} docId - The Grist document ID.
 * @param {string} dataType - The type of data to fetch (e.g., 'SQL_QUERY').
 * @param {string} teamId - The Team ID of the logged-in user.
 * @param {function} getHeaders - Function to get auth headers.
 * @param {function} getUrl - Function to construct full URL.
 * @returns {Promise<Array>} - Array of record objects.
 */
export const fetchPwaDataSql = async (docId, dataType, teamId, getHeaders, getUrl) => {
    if (!docId || !teamId) return [];

    try {
        const headers = await getHeaders();
        const url = getUrl(`/api/docs/${docId}/sql`);

        const tId = String(teamId);
        const sqlQuery = `
            SELECT UUID, Data_Type, Data, Created_By, Created_At, Shared_With 
            FROM PWA_Data 
            WHERE Data_Type = '${dataType}' AND (
                Created_By = '${tId}' 
                OR (Shared_With LIKE '%,${tId},%' 
                OR Shared_With LIKE '%[${tId},%' 
                OR Shared_With LIKE '%,${tId}]%' 
                OR Shared_With LIKE '%[${tId}]%')
            )
        `;

        const response = await fetch(url, {
            method: 'POST',
            headers: {
                ...headers,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                sql: sqlQuery,
                args: []
            })
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch PWA_Data (SQL): ${response.statusText}`);
        }

        const data = await response.json();
        return data.records || [];
    } catch (error) {
        console.error("Error fetching PWA_Data (SQL):", error);
        return [];
    }
};
