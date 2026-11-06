#!/usr/bin/env node
// Creates the Grist tables behind /printing and /plates, and the few columns
// and choices on existing tables they lean on:
//
//   Printing_Job_Batches      one machine type, one day
//   Printing_Jobs             one ink set on that machine, with its plates and wastage
//   Printing_Job_Outputs      one shop's orders in a job, with what was printed
//   Printing_Plates           every plate the factory keeps, and where it is
//   Printing_Plate_Movements  what happened to each plate, and who did it
//
//   Sub_Orders.Reused_Plates            old plates the office confirmed for a repeat
//   Inventory_Transactions.Printing_Job the job a printing move belongs to
//   Inventory_Transactions.Location     + PACKING AREA
//   Team.Roles                          + PRINTING PLATES INCHARGE, an operator per machine
//
// Structure changes need an owner key -- the PWA's proxy key is refused them:
//
//   GRIST_URL=https://grist.srirajabags.in GRIST_API_KEY=xxxx \
//   node scripts/create-printing-tables.mjs [--dry-run]
//
// Safe to run again: a table, column or choice that is already there is left
// alone, so it can never clobber live data.
//
// Timestamps and "who" columns are trigger formulas on data columns, not live
// formulas: they are stamped once when their flag changes and never move again
// when something else is edited. The live formulas below only read the row's own
// links (ids, lookups, display text off the customer), where following the
// source is the point.

import { MACHINE_LIST, OPERATOR_ROLES } from '../src/domain/printing/printingMachines.js';
import { STATUS_LIST, ACTION_LIST, RACKS, PLATES_INCHARGE } from '../src/domain/printing/printingPlates.js';
import { KIND } from '../src/domain/printing/rackCodes.js';

const PLATE_KINDS = [KIND.PLATE, KIND.DIGITAL, KIND.STEREO];

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
const DRY_RUN = process.argv.includes('--dry-run');

if (!KEY) {
    console.error('Set GRIST_API_KEY (an owner key) and try again.');
    process.exit(1);
}

const api = async (path, method = 'GET', body) => {
    const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
        method,
        headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${res.status} ${method} ${path}: ${text.slice(0, 500)}`);
    return text ? JSON.parse(text) : null;
};
const sql = async (q, args = []) => ((await api('/sql', 'POST', { sql: q, args })).records || []).map((r) => r.fields);
const apply = (actions) => (DRY_RUN ? null : api('/apply', 'POST', actions));

const TZ = 'DateTime:Asia/Calcutta';
const label = (id) => id.replace(/_/g, ' ').trim();
// isFormula is set explicitly: left out, Grist makes an empty formula column.
const col = (id, type, extra = {}) => ({ id, fields: { label: label(id), type, isFormula: false, ...extra } });
const choice = (id, choices, type = 'Choice') => col(id, type, { widgetOptions: JSON.stringify({ choices }) });
const live = (id, type, formula) => col(id, type, { isFormula: true, formula });
// A trigger: a data column Grist fills from `formula` when one of `deps` (column
// ids on the same table) changes -- or once, on creation, when there are none.
const trigger = (id, type, formula, deps = []) => ({ ...col(id, type, { formula }), deps });

const TABLES = [
    {
        id: 'Printing_Job_Batches',
        page: '📚 Printing Job Batches',
        columns: [
            col('Date', 'Date'),
            // A batch is one machine type's work for the day; its jobs are the
            // ink sets run on it (user, 5 Nov 2026).
            choice('Machine', MACHINE_LIST),
            live('Job_Batch_ID', 'Any', 'f"{$Date} - {$Machine} - {$id}"'),
            live('Jobs', 'RefList:Printing_Jobs', 'Printing_Jobs.lookupRecords(Printing_Job_Batch=$id)'),
            col('Plates_Collected', 'Bool'),
            trigger('Plates_Collected_At', TZ, 'NOW() if $Plates_Collected else None', ['Plates_Collected']),
            col('Plates_Returned', 'Bool'),
            trigger('Plates_Returned_At', TZ, 'NOW() if $Plates_Returned else None', ['Plates_Returned']),
            live('Printing_Started_At', TZ, 'MIN(t for t in $Jobs.Printing_Started_At if t) if any($Jobs.Printing_Started_At) else None'),
            live('Printing_Completed_At', TZ,
                '(MAX($Jobs.Printing_Completed_At) or None) if $Jobs and all($Jobs.Printing_Completed) else None'),
            trigger('Created_By', 'Ref:Team', 'user.Team'),
            col('Notes', 'Text')
        ]
    },
    {
        id: 'Printing_Jobs',
        page: '🖨️ Printing Jobs',
        columns: [
            // A job is one ink set on the batch's machine -- the setup the
            // operator dresses once -- and every shop's orders printed with it.
            col('Printing_Job_Batch', 'Ref:Printing_Job_Batches'),
            // "RED", "BLUE + RED", "MULTI COLOUR". Text, because a set is the
            // unit, not a colour.
            col('Printing_Colours', 'Text'),
            col('Sub_Orders', 'RefList:Sub_Orders'),
            // The production jobs that cut them, so a job traces back up the line.
            col('Source_Jobs', 'RefList:Factory_Production_Jobs'),
            live('Machine', 'Any', '$Printing_Job_Batch.Machine'),
            live('Outputs', 'RefList:Printing_Job_Outputs', 'Printing_Job_Outputs.lookupRecords(Printing_Job=$id)'),
            col('Printing_Started', 'Bool'),
            trigger('Printing_Started_At', TZ, 'NOW() if $Printing_Started else None', ['Printing_Started']),
            trigger('Started_By', 'Ref:Team', 'user.Team if $Printing_Started else None', ['Printing_Started']),
            col('Printing_Completed', 'Bool'),
            trigger('Printing_Completed_At', TZ, 'NOW() if $Printing_Completed else None', ['Printing_Completed']),
            trigger('Completed_By', 'Ref:Team', 'user.Team if $Printing_Completed else None', ['Printing_Completed']),
            // Wastage is one figure for the whole job (user, 1 Nov 2026); the
            // printed figures are each shop's, on its output.
            col('Wastage_Weight_Kg_', 'Numeric'),
            // The plates the job ran with, fixed when the batch's plates are
            // picked, and those the operator marked worn out at completion.
            col('Plates', 'RefList:Printing_Plates'),
            col('Damaged_Plates', 'RefList:Printing_Plates'),
            live('Job_ID', 'Any', 'f"{$Printing_Job_Batch.Job_Batch_ID} - {$Printing_Colours} - {$id}"'),
            col('Notes', 'Text')
        ]
    },
    {
        // One shop's orders within a job, like production's output groups:
        // what the operator counts and weighs at completion.
        id: 'Printing_Job_Outputs',
        page: '📤 Printing Job Outputs',
        columns: [
            col('Printing_Job', 'Ref:Printing_Jobs'),
            col('Customer', 'Ref:Customers'),
            col('Sub_Orders', 'RefList:Sub_Orders'),
            col('Printed_Count', 'Int'),
            col('Printed_Weight_Kg_', 'Numeric'),
            col('Misprint_Weight_Kg_', 'Numeric'),
            live('Shop', 'Any', '$Customer.Shop_Name if $Customer else None'),
            live('Order_IDs', 'Any', '", ".join(str(s.Order.Order_ID) for s in $Sub_Orders if s.Order)'),
            live('Output_ID', 'Any', 'f"{$Printing_Job.Job_ID} - {$Shop}"'),
            col('Notes', 'Text')
        ]
    },
    {
        id: 'Printing_Plates',
        page: '🔖 Printing Plates',
        columns: [
            // The number on the plate's label. Off the row id, which never changes.
            live('Plate_No', 'Text', 'f"PL-{$id:05d}"'),
            col('Customer', 'Ref:Customers'),
            col('Source_Sub_Order', 'Ref:Sub_Orders'),
            col('Plate_Order', 'Ref:Plate_Orders'),
            // PLATE, DIGITAL (a full-colour design's plate) or STEREO: the kind
            // letter of its rack code -- K-12, KD-12, KS-12.
            choice('Plate_Type', PLATE_KINDS),
            // As the order said when the plate was made. Copied, not looked up:
            // a later edit to the order does not change the plate in the rack.
            col('Material', 'Text'),
            col('Print', 'Text'),
            col('Printing_Colours', 'Text'),
            // The bag the plate was made for. It fits that bag and anything bigger.
            col('Bag_Width', 'Numeric'),
            col('Bag_Height', 'Numeric'),
            // How many plates the set holds: single, two, four.
            col('Plate_Count', 'Int'),
            col('Bag_Model', 'Text'),
            // Every order that printed with it, oldest first.
            col('Orders', 'RefList:Sub_Orders'),
            // When this plate was made: the design's first order, or the repeat
            // order that had it made again. Blank before the records start.
            col('Made_On', 'Date'),
            col('Last_Used_On', 'Date'),
            // Plates last six months from the day they were made, digital
            // plates a year, stereos for good (user, 5 Nov 2026) -- the same
            // rule as EXPIRY_MONTHS in printingPlates.js. A plate used with no
            // making order on record was made before the records began (1 Oct
            // 2025), so that is the latest it can date from. Live: it reads
            // only this row.
            live('Expires_On', 'Date',
                'months = {"PLATE": 6, "DIGITAL": 12}.get($Plate_Type)\n'
                + 'made = $Made_On or (DATE(2025, 10, 1) if $Last_Used_On else None)\n'
                + 'return DATEADD(made, months=months) if months and made else None'),
            // Measured on the floor; nothing on the order says it.
            col('Stereo_Size', 'Text'),
            col('Reusable', 'Bool'),
            live('Shop', 'Any', '$Customer.Shop_Name if $Customer else None'),
            live('City', 'Any', '$Customer.City if $Customer else None'),
            choice('Rack', RACKS),
            // The number after the rack letter: K-1290 is rack K, slot 1290.
            col('Slot', 'Int'),
            // The code as the office writes it. Live, because it only ever reads
            // this row's own place and kind.
            live('Rack_Code', 'Text',
                'kind = {"STEREO": "S", "DIGITAL": "D"}.get($Plate_Type, "")\n'
                + 'return "%s%s-%s" % ($Rack, kind, $Slot) if $Rack and $Slot else ""'),
            choice('Status', STATUS_LIST),
            col('Issued_To_Job', 'Ref:Printing_Jobs'),
            // Set by the on-ground check, or the first time the plate is picked.
            col('Verified', 'Bool'),
            trigger('Verified_At', TZ, 'NOW() if $Verified else None', ['Verified']),
            trigger('Verified_By', 'Ref:Team', 'user.Team if $Verified else None', ['Verified']),
            trigger('Updated_At', TZ, 'NOW()', ['Status', 'Rack', 'Slot']),
            trigger('Updated_By', 'Ref:Team', 'user.Team', ['Status', 'Rack', 'Slot']),
            live('Movements', 'RefList:Printing_Plate_Movements',
                'Printing_Plate_Movements.lookupRecords(Plate=$id, sort_by="-At")'),
            col('Notes', 'Text')
        ]
    },
    {
        id: 'Printing_Plate_Movements',
        page: '🔄 Printing Plate Movements',
        columns: [
            col('Plate', 'Ref:Printing_Plates'),
            choice('Action', ACTION_LIST),
            choice('Status_After', STATUS_LIST),
            col('Rack', 'Text'),
            col('Slot', 'Int'),
            col('Printing_Job', 'Ref:Printing_Jobs'),
            col('Notes', 'Text'),
            trigger('At', TZ, 'NOW()'),
            trigger('By', 'Ref:Team', 'user.Team')
        ]
    }
];

const EXTRA_COLUMNS = [
    { table: 'Sub_Orders', column: col('Reused_Plates', 'RefList:Printing_Plates') },
    { table: 'Inventory_Transactions', column: col('Printing_Job', 'Ref:Printing_Jobs') }
];

// Columns the first version had and the rack-code version replaced: plates
// were placed on a free-text shelf before the slot in the shop name was found
// to be the real address (1 Nov 2026). Removed only while every value is blank,
// so nothing anyone typed is lost.
const OBSOLETE_COLUMNS = [
    { table: 'Printing_Plates', column: 'Shelf' },
    { table: 'Printing_Plate_Movements', column: 'Shelf' },
    // A job was one sub-order until the batch / ink-set job / shop output
    // levels (5 Nov 2026); its per-order columns went with it.
    { table: 'Printing_Job_Batches', column: 'Printing_Colours' },
    { table: 'Printing_Jobs', column: 'Sub_Order' },
    { table: 'Printing_Jobs', column: 'Source_Job' },
    { table: 'Printing_Jobs', column: 'Plate_Condition' },
    { table: 'Printing_Jobs', column: 'Printed_Count' },
    { table: 'Printing_Jobs', column: 'Printed_Weight_Kg_' },
    { table: 'Printing_Jobs', column: 'Misprint_Weight_Kg_' },
    { table: 'Printing_Jobs', column: 'Order_ID' },
    { table: 'Printing_Jobs', column: 'Shop' }
];

const EXTRA_CHOICES = [
    { table: 'Printing_Plates', column: 'Plate_Type', add: PLATE_KINDS },
    { table: 'Inventory_Transactions', column: 'Location', add: ['PACKING AREA'] },
    { table: 'Team', column: 'Roles', add: [PLATES_INCHARGE, ...OPERATOR_ROLES] }
];

const say = (msg) => console.log(`${DRY_RUN ? '[dry run] ' : ''}${msg}`);

// 1. Tables, each born with a placeholder column so that every reference below
//    has its target in place before any column names it.
const existing = new Set((await api('/tables')).tables.map((t) => t.id));
const missing = TABLES.filter((t) => !existing.has(t.id));
if (missing.length) {
    say(`Creating tables: ${missing.map((t) => t.id).join(', ')}`);
    if (!DRY_RUN) {
        await api('/tables', 'POST', { tables: missing.map((t) => ({ id: t.id, columns: [col('Placeholder_', 'Text')] })) });
    }
}

// 1b. Columns renamed since the first run, renamed in place so their values
//     travel with them. Order_Date was the latest order's date, which is what
//     Last_Used_On now names (5 Nov 2026).
const RENAMES = [{ table: 'Printing_Plates', from: 'Order_Date', to: 'Last_Used_On' }];
for (const { table, from, to } of RENAMES) {
    if (!existing.has(table)) continue;
    const have = new Set((await api(`/tables/${table}/columns`)).columns.map((c) => c.id));
    if (!have.has(from) || have.has(to)) continue;
    say(`${table}: renaming ${from} to ${to}`);
    await apply([['RenameColumn', table, from, to]]);
    await apply([['ModifyColumn', table, to, { label: label(to) }]]);
}

// 2. Columns, skipping any already there.
const columnsOf = async (table) => {
    if (DRY_RUN && !existing.has(table)) return new Set();
    return new Set((await api(`/tables/${table}/columns`)).columns.map((c) => c.id));
};
const toAdd = [
    ...TABLES.map((t) => ({ table: t.id, columns: t.columns })),
    ...EXTRA_COLUMNS.map((e) => ({ table: e.table, columns: [e.column] }))
];
for (const { table, columns } of toAdd) {
    const have = await columnsOf(table);
    const fresh = columns.filter((c) => !have.has(c.id));
    if (!fresh.length) continue;
    say(`${table}: adding ${fresh.map((c) => c.id).join(', ')}`);
    if (!DRY_RUN) await api(`/tables/${table}/columns`, 'POST', { columns: fresh.map(({ id, fields }) => ({ id, fields })) });
}

// The placeholder goes once the real columns are in. Checked per table rather
// than for this run's new ones, so a run cut short is finished by the next.
for (const t of TABLES) {
    if (DRY_RUN) break;
    if ((await columnsOf(t.id)).has('Placeholder_')) await apply([['RemoveColumn', t.id, 'Placeholder_']]);
}

for (const { table, column } of OBSOLETE_COLUMNS) {
    if (!(await columnsOf(table)).has(column)) continue;
    // A blank reference is 0 and a blank list '[]', so those count as empty too.
    const [{ n }] = await sql(`SELECT COUNT(*) AS n FROM ${table}
        WHERE ${column} IS NOT NULL AND CAST(${column} AS TEXT) NOT IN ('', '0', '[]')`);
    if (n > 0) {
        say(`${table}.${column}: ${n} row(s) hold a value, so it stays`);
        continue;
    }
    say(`${table}.${column}: removing (empty)`);
    await apply([['RemoveColumn', table, column]]);
}

// 2b. A live formula changed since its column was made is brought up to date.
//     Only formula columns are touched; a data column is never turned into one.
for (const t of TABLES) {
    if (DRY_RUN && !existing.has(t.id)) continue;
    const current = await sql(`
        SELECT c.colId, c.formula FROM _grist_Tables_column c JOIN _grist_Tables tb ON tb.id = c.parentId
        WHERE tb.tableId = ? AND c.isFormula = 1`, [t.id]);
    for (const c of t.columns.filter((x) => x.fields.isFormula)) {
        const now = current.find((r) => r.colId === c.id);
        if (!now || now.formula === c.fields.formula) continue;
        say(`${t.id}.${c.id}: updating its formula`);
        await apply([['ModifyColumn', t.id, c.id, { formula: c.fields.formula }]]);
    }
}

// 3. Trigger dependencies, which need the column row ids that step 2 made.
const meta = DRY_RUN ? [] : await sql(`
    SELECT c.id, c.colId, t.tableId FROM _grist_Tables_column c
    JOIN _grist_Tables t ON t.id = c.parentId
    WHERE t.tableId IN (${TABLES.map(() => '?').join(',')})`, TABLES.map((t) => t.id));
const ref = (table, colId) => meta.find((m) => m.tableId === table && m.colId === colId)?.id;
const triggerActions = [];
for (const t of TABLES) {
    for (const c of t.columns.filter((x) => x.deps)) {
        const id = ref(t.id, c.id);
        if (!id && !DRY_RUN) throw new Error(`No column row for ${t.id}.${c.id}`);
        const deps = c.deps.map((d) => ref(t.id, d));
        // recalcWhen 0 = on creation and whenever a listed dependency changes;
        // with no dependencies, on creation only.
        triggerActions.push(['UpdateRecord', '_grist_Tables_column', id,
            { recalcWhen: 0, recalcDeps: deps.length ? ['L', ...deps] : null }]);
    }
}
say(`Setting ${triggerActions.length} trigger dependencies`);
await apply(triggerActions);

// 4. New choices on existing columns, keeping every choice and colour already set.
for (const { table, column, add } of EXTRA_CHOICES) {
    const [row] = await sql(`
        SELECT c.id, c.widgetOptions FROM _grist_Tables_column c
        JOIN _grist_Tables t ON t.id = c.parentId WHERE t.tableId = ? AND c.colId = ?`, [table, column]);
    const opts = row?.widgetOptions ? JSON.parse(row.widgetOptions) : {};
    const choices = opts.choices || [];
    const fresh = add.filter((c) => !choices.includes(c));
    if (!fresh.length) continue;
    say(`${table}.${column}: adding choices ${fresh.join(', ')}`);
    await apply([['ModifyColumn', table, column, { widgetOptions: JSON.stringify({ ...opts, choices: [...choices, ...fresh] }) }]]);
}

// 5. Page names: Grist shows a page's leading emoji as its icon, and the API
//    names a new page after the bare table id.
//    Only a page still carrying its table id is renamed, so a name someone has
//    since chosen in Grist stays.
for (const t of TABLES) {
    if (DRY_RUN) { say(`Page ${t.id} -> ${t.page}`); continue; }
    const [view] = await sql(`SELECT v.id, v.name FROM _grist_Views v JOIN _grist_Tables t ON t.primaryViewId = v.id WHERE t.tableId = ?`, [t.id]);
    if (!view || view.name !== t.id) continue;
    await apply([['UpdateRecord', '_grist_Views', view.id, { name: t.page }]]);
    say(`Page ${t.id} -> ${t.page}`);
}

// 6. Access: owners only, for now (user, 1 Nov 2026). The same pair of rules the
//    production tables open with -- doc owners may do anything, everyone else
//    nothing -- placed after the catalog tables' rules and before the seed rules
//    (rulePos 14). A table that already has rules of its own is left alone, so
//    this never overwrites rules someone has since set by hand.
//
//    One rule per write, each at the midpoint between the last rule before the
//    seed rules and the seed rules. Grist moves a new rule to such a midpoint
//    whatever position it is sent with, and refuses a bundle whose deny rule
//    lands ahead of its owner rule ("listed after default rule").
const OWNER_FORMULA = 'user.Access in [OWNER]';
const OWNER_PARSED = JSON.stringify(['In', ['Attr', ['Name', 'user'], 'Access'], ['List', ['Name', 'OWNER']]]);
const SEED_POS = 14;
const ruled = new Set((await sql(`
    SELECT DISTINCT s.tableId FROM _grist_ACLRules r JOIN _grist_ACLResources s ON s.id = r.resource`)).map((r) => r.tableId));
for (const t of TABLES.filter((x) => !ruled.has(x.id))) {
    say(`Access rules (owners only): ${t.id}`);
    if (DRY_RUN) continue;
    let [res] = await sql(`SELECT id FROM _grist_ACLResources WHERE tableId = ? AND colIds = '*'`, [t.id]);
    if (!res) res = { id: (await apply([['AddRecord', '_grist_ACLResources', null, { tableId: t.id, colIds: '*' }]])).retValues[0] };
    for (const rule of [
        { aclFormula: OWNER_FORMULA, aclFormulaParsed: OWNER_PARSED, permissionsText: '+CRUD' },
        { aclFormula: '', aclFormulaParsed: '', permissionsText: '-CRUD' }
    ]) {
        const [{ last }] = await sql(`SELECT MAX(rulePos) AS last FROM _grist_ACLRules WHERE rulePos < ${SEED_POS}`);
        await apply([['AddRecord', '_grist_ACLRules', null,
            { resource: res.id, rulePos: (last + SEED_POS) / 2, memo: '', ...rule }]]);
    }
}

say('Done.');
