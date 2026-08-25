// Columns Grist fills in for itself.
//
// A trigger formula lives on a *data* column: Grist runs it when the fields it
// watches change, and the value is then stored like any other. That makes such a
// column look writable over the API when it is not ours to write — sending a
// value fights the formula, and where the trigger has a PEEK() guard (the job's
// Available_Weight_Kg_ freezes itself once production starts) a stale figure can
// stick permanently. Strip them from every payload and let Grist compute.
//
// Only triggers that WATCH A DEPENDENCY belong here. A trigger with no deps runs
// once on record creation and is a default rather than a computation — e.g.
// Inventory_Transactions.Transaction_Type defaults to "ADD", and the value the
// app supplies is meant to win. Adding those here would silently turn every LESS
// transaction into an ADD, so check recalcDeps before extending this list:
//   SELECT c.colId, c.recalcDeps FROM _grist_Tables_column c
//   JOIN _grist_Tables t ON t.id = c.parentId
//   WHERE c.isFormula = 0 AND TRIM(COALESCE(c.formula,'')) != '' AND t.tableId = ?
export const TRIGGER_COLUMNS = {
    Factory_Production_Job_Batches: [
        'Inventory_Collected_At',      // NOW() if $Required_Inventory_Collected else None
        'Inventory_Returned_At',       // NOW() if $Remaining_Inventory_Returned else None
        'Finished_Stock_Collected_At'  // NOW() if $Finished_Stock_Collected else None
        // each watches the flag beside it
    ],
    Factory_Production_Jobs: [
        'Production_Started_At',       // NOW() if $Production_Started else None
        'Production_Completed_At',     // NOW() if $Production_Completed else None
        'Available_Weight_Kg_'         // watches Inventory_Items; sums their available
                                       // stock and freezes once production starts
    ]
};

// One record's fields, with anything Grist computes for itself removed. Pass the
// table id so the rule travels with the table rather than the call site.
export const writableFields = (table, fields) => {
    const managed = TRIGGER_COLUMNS[table];
    if (!managed) return fields;
    const out = {};
    for (const [key, value] of Object.entries(fields || {})) {
        if (!managed.includes(key)) out[key] = value;
    }
    return out;
};

// The same, for a whole `records` array in a POST/PATCH body.
export const writableRecords = (table, records) =>
    (records || []).map((r) => ({ ...r, fields: writableFields(table, r.fields) }));
