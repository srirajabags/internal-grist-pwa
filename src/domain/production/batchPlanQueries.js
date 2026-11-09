// The reads behind Create Production Job Batch.
//
// Grist interrupts /sql at about 1 second and its tables carry no indexes, so a
// subquery that runs once per outer row scans its whole table every time. Each
// lookup here is built once in a WITH clause and joined instead -- see
// batchPlanQueries.test.js for the incident.

const TXN_TABLE = 'Inventory_Transactions';
const SUMMARY_BY_ID_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';
const SUMMARY_BY_CODE_TABLE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Location';

// Every job, with its batch type and the weight it has physically drawn so far.
// The jobs stay the outer table: the ready-stock deduction walks them in this order.
export const existingJobsSql = () => `
    WITH drawn AS (
        SELECT Production_Job AS job, ROUND(SUM(ABS(Weight_Kg_)), 3) AS kg
        FROM ${TXN_TABLE}
        WHERE Transaction_Type = 'LESS' AND Production_Job != 0
        GROUP BY Production_Job
    )
    SELECT j.id AS id, b.Type AS type, j.Sub_Orders AS subOrders,
           j.Inventory_Items AS invItems, j.Job_Overage AS overage,
           COALESCE(b.Remaining_Inventory_Returned, 0) AS returned,
           d.kg AS drawn
    FROM Factory_Production_Jobs j
    LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
    LEFT JOIN drawn d ON d.job = j.id`;

// Acknowledged godown stock per physical item.
//
// Only the by-code summary carries counts; each non-roll code has exactly one
// physical item, so a count maps one to one. MIN(id) keeps a single row per code
// and godown, so a repeated summary line cannot double a stock row.
//
// A ROLL promised to an open batch is not on the shelf, whatever the summary says:
// it leaves whole and belongs to one job. Between creating a batch and collecting
// it the godown balance is untouched, so without this the next batch plans the very
// same rolls again. Ready-made stock is a POOL, not one object -- 2,900 sheets can
// fund several jobs -- so it stays listed, and what open jobs have claimed of it is
// deducted by the caller.
export const godownStockSql = () => `
    WITH counts AS (
        SELECT Item_Code AS code, Location AS location,
               Available_Count_Bundles_ AS bundles, MIN(id)
        FROM ${SUMMARY_BY_CODE_TABLE}
        WHERE Incharge_Ack = 1
        GROUP BY Item_Code, Location
    ),
    promised AS (
        SELECT DISTINCT ji.value AS item
        FROM Factory_Production_Jobs j
        JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
        JOIN json_each(CASE WHEN json_valid(j.Inventory_Items)
                            THEN j.Inventory_Items ELSE '[]' END) ji
        WHERE COALESCE(b.Remaining_Inventory_Returned, 0) = 0
    )
    SELECT s.Item_ID AS itemId, s.Item_Code AS codeId,
           it.Item_ID AS itemName, it.Created_at AS intakeAt,
           ic.Type AS type, ic.Material AS material, ic.Colour AS colour,
           ic.GSM AS gsm, ic.Width_Inches_ AS width,
           ic.Height_Inches_ AS height,
           ic.Item_Code AS name,
           s.Available_Weight_Kg_ AS availWeight,
           COALESCE(c.bundles, 0) AS availCount
    FROM ${SUMMARY_BY_ID_TABLE} s
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = s.Item_Code
    LEFT JOIN Inventory_Items it ON it.id = s.Item_ID
    LEFT JOIN counts c ON c.code = s.Item_Code AND c.location = s.Location
    WHERE s.Item_Code != 0
       AND s.Location IN ('ROLLS GODOWN', 'BAGS GODOWN')
       AND s.Incharge_Ack = 1
       AND NOT (
           UPPER(COALESCE(ic.Type, '')) = 'ROLL'
           AND s.Item_ID IN (SELECT item FROM promised)
       )`;
