import { beforeEach, describe, expect, it } from 'vitest';
import initSqlJs from 'sql.js';
import { existingJobsSql, godownStockSql } from './batchPlanQueries';

// Incident, 9 Nov 2026: Create Production Job Batch stopped on "a slow statement
// resulted in a database interrupt" for every batch type. Grist interrupts /sql at
// about 1 second and its tables have no indexes, so a subquery that runs once per
// outer row scans a whole table each time -- 985 jobs x 9,319 transactions. These
// tests hold both the speed (no such subquery) and what the rows have to say.

const SQL = await initSqlJs();
const BY_ID = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Item_ID_Location';
const BY_CODE = 'Inventory_Transactions_summary_Incharge_Ack_Item_Code_Location';

let db;

const rows = (sql) => {
    const [res] = db.exec(sql);
    if (!res) return [];
    return res.values.map((v) => Object.fromEntries(res.columns.map((c, i) => [c, v[i]])));
};
const plan = (sql) => rows(`EXPLAIN QUERY PLAN ${sql}`).map((r) => r.detail).join('\n');
const insert = (table, row) => {
    const cols = Object.keys(row);
    db.run(
        `INSERT INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        Object.values(row)
    );
};
const job = (id, batch, inventoryItems = null) => insert('Factory_Production_Jobs', {
    id, Factory_Production_Job_Batch: batch, Sub_Orders: '["L",1]',
    Inventory_Items: inventoryItems, Job_Overage: 0
});
const batch = (id, returned = 0) => insert('Factory_Production_Job_Batches', {
    id, Type: 'ROLLS TO HANDLES', Remaining_Inventory_Returned: returned
});
let txId = 0;
const tx = (jobId, type, kg) => insert('Inventory_Transactions', {
    id: ++txId, Production_Job: jobId, Transaction_Type: type, Weight_Kg_: kg
});
const code = (id, type) => insert('Inventory_Item_Codes', {
    id, Type: type, Material: 'NON-WOVEN', Colour: 'RED', GSM: 70,
    Width_Inches_: 12, Height_Inches_: 16, Item_Code: `CODE-${id}`
});
const item = (id) => insert('Inventory_Items', { id, Item_ID: `ITEM-${id}`, Created_at: 1000 + id });
let summaryId = 0;
const onShelf = (itemId, codeId, overrides = {}) => insert(BY_ID, {
    id: ++summaryId, Item_ID: itemId, Item_Code: codeId, Location: 'ROLLS GODOWN',
    Incharge_Ack: 1, Available_Weight_Kg_: 50, ...overrides
});
const counted = (codeId, count, overrides = {}) => insert(BY_CODE, {
    id: ++summaryId, Item_Code: codeId, Location: 'ROLLS GODOWN',
    Incharge_Ack: 1, Available_Count_Bundles_: count, ...overrides
});
const stockIds = () => rows(godownStockSql()).map((r) => r.itemId).sort((a, b) => a - b);

beforeEach(() => {
    txId = 0;
    summaryId = 0;
    db = new SQL.Database();
    db.exec(`
        CREATE TABLE Factory_Production_Jobs (id INTEGER PRIMARY KEY, Factory_Production_Job_Batch INTEGER,
            Sub_Orders TEXT, Inventory_Items TEXT, Job_Overage NUMERIC);
        CREATE TABLE Factory_Production_Job_Batches (id INTEGER PRIMARY KEY, Type TEXT, Remaining_Inventory_Returned INTEGER);
        CREATE TABLE Inventory_Transactions (id INTEGER PRIMARY KEY, Production_Job INTEGER, Transaction_Type TEXT, Weight_Kg_ NUMERIC);
        CREATE TABLE Inventory_Item_Codes (id INTEGER PRIMARY KEY, Type TEXT, Material TEXT, Colour TEXT, GSM NUMERIC,
            Width_Inches_ NUMERIC, Height_Inches_ NUMERIC, Item_Code TEXT);
        CREATE TABLE Inventory_Items (id INTEGER PRIMARY KEY, Item_ID TEXT, Created_at NUMERIC);
        CREATE TABLE ${BY_ID} (id INTEGER PRIMARY KEY, Item_ID INTEGER, Item_Code INTEGER, Location TEXT,
            Incharge_Ack INTEGER, Available_Weight_Kg_ NUMERIC);
        CREATE TABLE ${BY_CODE} (id INTEGER PRIMARY KEY, Item_Code INTEGER, Location TEXT,
            Incharge_Ack INTEGER, Available_Count_Bundles_ NUMERIC);
    `);
});

describe('existingJobsSql', () => {
    it('does not scan the transactions once per job', () => {
        expect(plan(existingJobsSql())).not.toMatch(/CORRELATED/);
    });

    it('totals only what a job drew, as a positive weight', () => {
        batch(1);
        job(10, 1);
        tx(10, 'LESS', -4.5);
        tx(10, 'LESS', 1.25);
        tx(10, 'ADD', 100);
        expect(rows(existingJobsSql())[0].drawn).toBe(5.75);
    });

    it('keeps one job from borrowing another job\'s draw', () => {
        batch(1);
        job(10, 1);
        job(11, 1);
        tx(10, 'LESS', -2);
        tx(11, 'LESS', -3);
        expect(rows(existingJobsSql()).map((r) => [r.id, r.drawn])).toEqual([[10, 2], [11, 3]]);
    });

    it('leaves drawn empty for a job that has drawn nothing', () => {
        batch(1);
        job(10, 1);
        tx(10, 'ADD', 5);
        expect(rows(existingJobsSql())[0].drawn).toBeNull();
    });

    it('still lists a job whose batch row is gone', () => {
        job(10, 99);
        expect(rows(existingJobsSql())).toMatchObject([{ id: 10, type: null, returned: 0 }]);
    });

    it('lists the jobs in id order, which the ready-stock deduction walks', () => {
        batch(1);
        job(12, 1);
        job(10, 1);
        tx(12, 'LESS', -1);
        expect(rows(existingJobsSql()).map((r) => r.id)).toEqual([10, 12]);
    });
});

describe('godownStockSql', () => {
    it('does not run a subquery per stock row', () => {
        expect(plan(godownStockSql())).not.toMatch(/CORRELATED/);
    });

    it('hides a roll promised to an open batch', () => {
        code(1, 'ROLL');
        item(100);
        item(101);
        onShelf(100, 1);
        onShelf(101, 1);
        batch(1);
        job(10, 1, '["L",100]');
        expect(stockIds()).toEqual([101]);
    });

    it('offers a roll again once its batch has returned the remainder', () => {
        code(1, 'ROLL');
        item(100);
        onShelf(100, 1);
        batch(1, 1);
        job(10, 1, '["L",100]');
        expect(stockIds()).toEqual([100]);
    });

    it('keeps a roll that one open and one returned batch both name hidden', () => {
        code(1, 'ROLL');
        item(100);
        onShelf(100, 1);
        batch(1, 1);
        batch(2, 0);
        job(10, 1, '["L",100]');
        job(11, 2, '["L",100]');
        expect(stockIds()).toEqual([]);
    });

    it('keeps ready stock on an open batch, because it is a pool', () => {
        code(1, 'SHEET');
        item(100);
        onShelf(100, 1, { Location: 'BAGS GODOWN' });
        batch(1);
        job(10, 1, '["L",100]');
        expect(stockIds()).toEqual([100]);
    });

    it('survives a job whose item list is blank or not JSON', () => {
        code(1, 'ROLL');
        item(100);
        onShelf(100, 1);
        batch(1);
        job(10, 1, null);
        job(11, 1, 'not json');
        expect(stockIds()).toEqual([100]);
    });

    it('lists a pooled item once however many open jobs name it', () => {
        code(1, 'SHEET');
        item(100);
        onShelf(100, 1);
        batch(1);
        job(10, 1, '["L",100]');
        job(11, 1, '["L",100]');
        expect(stockIds()).toEqual([100]);
    });

    it('reads the count for the same code, godown and acknowledgement', () => {
        code(1, 'SHEET');
        item(100);
        onShelf(100, 1, { Location: 'BAGS GODOWN', Available_Weight_Kg_: 0 });
        counted(1, 999, { Location: 'ROLLS GODOWN' });
        counted(1, 888, { Location: 'BAGS GODOWN', Incharge_Ack: 0 });
        counted(1, 2900, { Location: 'BAGS GODOWN' });
        expect(rows(godownStockSql())).toMatchObject([{ itemId: 100, availCount: 2900 }]);
    });

    it('counts zero when the code has no acknowledged count', () => {
        code(1, 'ROLL');
        item(100);
        onShelf(100, 1);
        expect(rows(godownStockSql())[0].availCount).toBe(0);
    });

    it('never doubles a stock row, even if a count were repeated', () => {
        code(1, 'SHEET');
        item(100);
        onShelf(100, 1);
        counted(1, 5);
        counted(1, 7);
        expect(rows(godownStockSql())).toHaveLength(1);
    });

    it('leaves out unacknowledged, other-location and code-less rows', () => {
        code(1, 'ROLL');
        item(100);
        item(101);
        item(102);
        onShelf(100, 1, { Incharge_Ack: 0 });
        onShelf(101, 1, { Location: 'FACTORY' });
        onShelf(102, 0);
        expect(stockIds()).toEqual([]);
    });
});
