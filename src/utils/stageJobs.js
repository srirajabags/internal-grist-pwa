// Configuration for the two post-production floor stages, /printing and
// /stitching. Both work the same way -- a batch holds one job per sub-order, each
// job is started, then completed with the output actually produced -- so one page
// component is driven by the config below rather than duplicated per stage.
//
// The pipeline these sit in:
//   ROLLS GODOWN --(production)--> PRINTING AREA --(printing)--> stitching
//   --(stitching)--> BAGS GODOWN
// Work in progress between printing and stitching is tracked by the stitching
// job itself, not as godown stock: 'STITCHING AREA' is not one of the choices on
// Inventory_Transactions.Location, and inventing a value the column does not
// allow would leave rows that no stock query can see. Add the choice in Grist and
// set `wipLocation` below if that WIP should show up in /inventory.

export const STAGES = {
    printing: {
        key: 'printing',
        route: '/printing',
        title: 'Printing Jobs',
        subtitle: 'Print what production has cut',
        // Tailwind accents, matching how each page's header is themed.
        accent: 'fuchsia',
        batchTable: 'Printing_Job_Batches',
        jobTable: 'Printing_Jobs',
        batchRef: 'Printing_Job_Batch',
        startedCol: 'Printing_Started',
        completedCol: 'Printing_Completed',
        startLabel: 'Start Printing',
        completeLabel: 'Complete Printing',
        // Printing draws down the output production parked in the printing area.
        inputLocation: 'PRINTING AREA',
        wipLocation: null,
        outputLabel: 'Printed weight'
    },
    stitching: {
        key: 'stitching',
        route: '/stitching',
        title: 'Stitching Jobs',
        subtitle: 'Stitch printed sheets into finished bags',
        accent: 'violet',
        batchTable: 'Stitching_Job_Batches',
        jobTable: 'Stitching_Jobs',
        batchRef: 'Stitching_Job_Batch',
        startedCol: 'Stitching_Started',
        completedCol: 'Stitching_Completed',
        startLabel: 'Start Stitching',
        completeLabel: 'Complete Stitching',
        // Stitching consumes printed work in progress, which is not godown stock,
        // so nothing is drawn down here -- only the finished bags are credited.
        inputLocation: null,
        wipLocation: null,
        outputLabel: 'Finished weight'
    }
};

// Where finished output lands once a stage is done with it. A stitching bag is
// only finished after stitching; everything else is finished once printed.
export const FINISHED_LOCATION = 'BAGS GODOWN';
export const needsStitching = (model) => String(model || '').trim().toUpperCase() === 'STITCHING';
export const needsPrinting = (print) => {
    const p = String(print || '').trim().toUpperCase();
    return p !== '' && p !== 'NO PRINT';
};

// The whole tree for one stage: open batches -> jobs -> the sub-order behind each.
// Reference-list columns are JSON, so json_each() expands them, matching how
// ProductionJobsView reads the production tree.
export const treeSql = (cfg) => `
    SELECT
        b.id AS batch_id, b.Date AS batch_date, b.Notes AS batch_notes,
        j.id AS job_id,
        j.Inventory_Item_Code AS job_item_code, j.Inventory_Items AS job_inv_items,
        j.Input_Location AS job_input_location,
        j.Required_Quantity_Kg_ AS job_required_kg,
        j.Available_Weight_Kg_ AS job_available_kg,
        j.Output_Weight_Kg_ AS job_output_kg, j.Output_Count_ AS job_output_count,
        j.Wastage_Weight_Kg_ AS job_wastage_kg,
        j.${cfg.startedCol} AS job_started, j.${cfg.startedCol}_At AS job_started_at,
        j.${cfg.completedCol} AS job_completed, j.${cfg.completedCol}_At AS job_completed_at,
        j.Source_Job AS job_source,
        ic.Item_Code AS item_name, ic.Type AS item_type, ic.Material AS item_material,
        ic.Colour AS item_colour, ic.GSM AS item_gsm, ic.Width_Inches_ AS item_width,
        so.id AS so_id, so.Model AS so_model, so.Print AS so_print,
        so.Quantity AS so_qty, so.Quantity_Type AS so_qty_type,
        so.Bag_Width AS so_bag_w, so.Bag_Height AS so_bag_h, so.Sheet_Size AS so_sheet_size,
        so.Bag_Colour AS so_bag_colour, so.Bag_GSM AS so_bag_gsm,
        so.Factory_Updated_Date AS so_factory_updated_date,
        o.Order_ID AS so_order_id, c.Shop_Name AS so_shop
    FROM ${cfg.batchTable} b
    LEFT JOIN ${cfg.jobTable} j ON j.${cfg.batchRef} = b.id
    LEFT JOIN Inventory_Item_Codes ic ON ic.id = j.Inventory_Item_Code
    LEFT JOIN Sub_Orders so ON so.id = j.Sub_Order
    LEFT JOIN Orders o ON o.id = so."Order"
    LEFT JOIN Customers c ON c.id = so.Customer
    ORDER BY b.Date DESC, b.id DESC, j.id`;

// Sub-orders ready for this stage and not already in one of its jobs.
//
// Printing takes anything a completed production job has put into the printing
// area that carries a print. Stitching takes STITCHING-model sub-orders once
// their printing is done -- or straight away when they carry no print at all.
export const queueSql = (cfg) => {
    const done = cfg.key === 'printing'
        ? `EXISTS (
               SELECT 1 FROM Factory_Production_Jobs pj
               WHERE pj.Production_Completed = 1
                 AND so.id IN (SELECT value FROM json_each(
                     CASE WHEN json_valid(pj.Sub_Orders) THEN pj.Sub_Orders ELSE '[]' END))
           )
           AND upper(trim(coalesce(so.Print, ''))) NOT IN ('', 'NO PRINT')`
        : `upper(trim(coalesce(so.Model, ''))) = 'STITCHING'
           AND (
               upper(trim(coalesce(so.Print, ''))) IN ('', 'NO PRINT')
               OR EXISTS (
                   SELECT 1 FROM Printing_Jobs pr
                   WHERE pr.Sub_Order = so.id AND pr.Printing_Completed = 1
               )
           )`;
    return `
        SELECT so.id AS so_id, so.Model AS so_model, so.Print AS so_print,
               so.Quantity AS so_qty, so.Quantity_Type AS so_qty_type,
               so.Bag_Width AS so_bag_w, so.Bag_Height AS so_bag_h,
               so.Sheet_Size AS so_sheet_size, so.Bag_Colour AS so_bag_colour,
               so.Bag_GSM AS so_bag_gsm, so.Material AS so_material,
               so.Factory_Updated_Date AS so_factory_updated_date,
               o.Order_ID AS so_order_id, c.Shop_Name AS so_shop,
               (
                   SELECT pj.id FROM Factory_Production_Jobs pj
                   WHERE so.id IN (SELECT value FROM json_each(
                       CASE WHEN json_valid(pj.Sub_Orders) THEN pj.Sub_Orders ELSE '[]' END))
                   ORDER BY pj.id DESC LIMIT 1
               ) AS source_job,
               (
                   SELECT pj.Inventory_Item_Code FROM Factory_Production_Jobs pj
                   WHERE so.id IN (SELECT value FROM json_each(
                       CASE WHEN json_valid(pj.Sub_Orders) THEN pj.Sub_Orders ELSE '[]' END))
                   ORDER BY pj.id DESC LIMIT 1
               ) AS source_code
        FROM Sub_Orders so
        LEFT JOIN Orders o ON o.id = so."Order"
        LEFT JOIN Customers c ON c.id = so.Customer
        WHERE so.Status = 'UPDATED TO FACTORY'
          AND NOT EXISTS (SELECT 1 FROM ${cfg.jobTable} ex WHERE ex.Sub_Order = so.id)
          AND ${done}
        ORDER BY so.Factory_Updated_Date DESC, so.id DESC`;
};
