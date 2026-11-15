import { describe, it, expect } from 'vitest';
import {
    waitingRuns, ordersAwaitingRun, runSplit, runBooking, runCompletionProblems, runCompletionActions,
    runJobFields, runBatchProblem, companyPlateRecord, companySideFields, runColours, MODEL_RUN_MACHINE, runBatchFields
} from './modelRuns.js';
import { groupQueue, AWAITING_RUN } from './printingMachines.js';
import { pickList, ordersServedBy, COMPANY_PLATE } from './printingPlates.js';
import { queueSql, platesQuery } from './printingJobs.js';

// Job 945 (2026-11-05, ROLLS TO SHEETS, 16x19), as Grist returned it on 12 Nov:
// one F12 order of 200 bags (440 sheets with the overage) among seven plain ones.
const so13368 = {
    job_id: 945, job_type: 'ROLLS TO SHEETS', rate: 0.1, job_name: '2026-11-05 - ROLLS TO SHEETS - 104 - 945',
    id: 13368, Material: 'NON-WOVEN', Model: 'STITCHING', Print: 'MODEL NUMBER', Roll_Material: 'NW VIRGIN',
    Quantity: 200, Quantity_Type: 'PIECES', Bag_Colour: '["F12"]', Bag_GSM: '110', Bag_Width: '16', Bag_Height: '18',
    Sheet_Size: '16x19', Sidepatty_Colour: 'BREEZE', Sidepatty_GSM: '75', Sidepatty_Width: '6', Handle_Colour: 'BREEZE',
    customer: 5179, shop: 'MUBARAK CLOTH CENTRE TYPE-3 (Aft)    D-390', city: 'Dharmavaram'
};
const plain945 = { job_id: 945, type: 'ADD', location: 'PRINTING AREA', item: 5, code_type: 'SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'WHITE', w: '16', h: '19', count: 13401 };
const f12Items = [
    { item: 776, item_id: 'MODELSHEET_F12_16X19', material: 'NW VIRGIN', gsm: '110', colour: 'F12', w: '16', h: '19' },
    { item: 777, item_id: 'MODELSHEET_F12_12X17', material: 'NW VIRGIN', gsm: '110', colour: 'F12', w: '12', h: '17' }
];
const job945 = { subOrderRows: [so13368], stockRows: [plain945], modelItemRows: f12Items };

describe('waitingRuns: job 945', () => {
    it('prints the F12 design on the whole 1,100-sheet run: 440 for the order, 660 back to stock', () => {
        const [run] = waitingRuns(job945);
        expect(run).toMatchObject({
            sourceJob: 945, model: 'F12', sheetSize: '16x19',
            runSheets: 1100, orderSheets: 440, stockSheets: 660,
            plainItem: 5, modelItem: 776, problem: null
        });
        expect(run.subOrders.map((so) => so.id)).toEqual([13368]);
    });

    it('is made once: a run already in a printing job is not offered again', () => {
        const madeRuns = [{ id: 1, model: 'F12', source_jobs: '[945]', sub_orders: '[13368]', completed: 1 }];
        expect(waitingRuns({ ...job945, madeRuns })).toEqual([]);
    });

    it('needs no run when printed F12 stock answered the order in full', () => {
        const drawn = { job_id: 945, type: 'LESS', location: 'BAGS GODOWN', item: 776, code_type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'F12', w: '16', h: '19', count: 440 };
        expect(waitingRuns({ ...job945, stockRows: [plain945, drawn] })).toEqual([]);
    });

    it('leaves the orders only what printed stock did not answer, and still runs the full plate', () => {
        const drawn = { job_id: 945, type: 'LESS', location: 'BAGS GODOWN', item: 776, code_type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'F12', w: '16', h: '19', count: 240 };
        const [run] = waitingRuns({ ...job945, stockRows: [plain945, drawn] });
        expect(run).toMatchObject({ runSheets: 1100, orderSheets: 200, readySheets: 240, stockSheets: 900 });
    });

    it('runs the orders, not the plate minimum, when the orders are bigger', () => {
        const big = { ...so13368, Quantity: 1000 };
        const [run] = waitingRuns({ ...job945, subOrderRows: [big] });
        expect(run).toMatchObject({ runSheets: 2200, orderSheets: 2200, stockSheets: 0 });
    });

    it('stops with the code to add when there is no printed-sheet item for the design', () => {
        const [run] = waitingRuns({ ...job945, modelItemRows: [f12Items[1]] });
        expect(run.modelItem).toBeNull();
        expect(run.problem).toBe('No stock item for MODEL NUMBER SHEET - NW VIRGIN - F12 - 110GSM (16x19). Ask the office to add it.');
        expect(runBatchProblem([run])).toBe(run.problem);
    });

    it('does not guess between two different plain sheets of the size', () => {
        const other = { ...plain945, item: 9, colour: 'CREAM' };
        const [run] = waitingRuns({ ...job945, stockRows: [plain945, other] });
        expect(run.plainItem).toBeNull();
        expect(run.problem).toMatch(/2 different 16x19 sheets/);
    });

    it('stops when the job booked no plain sheet of the size to print on', () => {
        const [run] = waitingRuns({ ...job945, stockRows: [] });
        expect(run.problem).toBe('Job 945 booked no 16x19 sheets into the printing area to print on.');
    });
});

// Job 997 (2026-11-07, ROLLS TO SHEETS): an F6 order of 800 bags on 12x17
// sheets (1,760 with the overage), 650 of them answered by printed F6 stock off
// the shelf. 12x17 has no plate minimum, so the run is the orders' own sheets --
// and the queue used to offer no run at all, leaving the F6 design unprinted on
// the books.
const so13416 = {
    job_id: 997, job_type: 'ROLLS TO SHEETS', rate: 0.1, job_name: '2026-11-07 - ROLLS TO SHEETS - 109 - 997',
    id: 13416, Material: 'NON-WOVEN', Model: 'STITCHING', Print: 'MODEL NUMBER', Roll_Material: 'NW VIRGIN',
    Quantity: 800, Quantity_Type: 'PIECES', Bag_Colour: '["F6"]', Bag_GSM: '110', Bag_Width: '12', Bag_Height: '16',
    Sheet_Size: '12x17', Sidepatty_Colour: 'RED', Sidepatty_GSM: '75', Sidepatty_Width: '8', Handle_Colour: 'RED',
    customer: 16300, shop: 'Sri Datta Bhageswara Cloth Store - TYPE-1 (AFT)  P-343', city: 'Pamidi'
};
const stock997 = [
    { job_id: 997, type: 'ADD', location: 'PRINTING AREA', item: 2, code_type: 'SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'WHITE', w: '17', h: '17', count: 4200 },
    { job_id: 997, type: 'ADD', location: 'PRINTING AREA', item: 3376, code_type: 'SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'WHITE', w: '12', h: '17', count: 1254 },
    { job_id: 997, type: 'LESS', location: 'BAGS GODOWN', item: 2264, code_type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'F6', w: '12', h: '17', count: 650 }
];
const f6Items = [
    { item: 768, item_id: 'MODELSHEET_F6_16X19', material: 'NW VIRGIN', gsm: '110', colour: 'F6', w: '16', h: '19' },
    { item: 2264, item_id: 'MODEL_NUMBER_SHEET_NW_VIRGIN_F6_110_12X17', material: 'NW VIRGIN', gsm: '110', colour: 'F6', w: '12', h: '17' }
];

describe('waitingRuns: job 997, a size with no plate minimum', () => {
    it('still prints the design, on the sheets the orders need beyond printed stock', () => {
        const runs = waitingRuns({ subOrderRows: [so13416], stockRows: stock997, modelItemRows: f6Items });
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({
            sourceJob: 997, model: 'F6', sheetSize: '12x17',
            runSheets: 1110, orderSheets: 1110, readySheets: 650, stockSheets: 0,
            plainItem: 3376, modelItem: 2264, problem: null
        });
    });
});

// Sub-order 13416 again, with its sheet size corrected to 24x17 (user, 12 Nov):
// a 12x16 bag is cut as one 24x17 sheet, printed with the design twice and cut
// into two 12x17 sheets. The run is 1,100 cut sheets -- 2,200 printed halves --
// and printed stock is held as halves.
describe('waitingRuns: a sheet printed two-up and cut in half', () => {
    const so = { ...so13416, job_id: 1100, Sheet_Size: '24x17' };
    const plain24 = { job_id: 1100, type: 'ADD', location: 'PRINTING AREA', item: 15, code_type: 'SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'WHITE', w: '24', h: '17', count: 1100 };

    it('runs 1,100 plain 24x17 sheets into 2,200 F6 12x17: 1,760 for the order, 440 to stock', () => {
        const [run] = waitingRuns({ subOrderRows: [so], stockRows: [plain24], modelItemRows: f6Items });
        expect(run).toMatchObject({
            sheetSize: '17x24', finishedSize: '12x17', cutInto: 2,
            runSheets: 1100, orderSheets: 1760, stockSheets: 440,
            plainItem: 15, modelItem: 2264, problem: null
        });
    });

    it('counts printed stock off the shelf in halves', () => {
        const drawn = { job_id: 1100, type: 'LESS', location: 'BAGS GODOWN', item: 2264, code_type: 'MODEL NUMBER SHEET', material: 'NW VIRGIN', gsm: '110', colour: 'F6', w: '12', h: '17', count: 650 };
        const [run] = waitingRuns({ subOrderRows: [so], stockRows: [plain24, drawn], modelItemRows: f6Items });
        expect(run).toMatchObject({ runSheets: 1100, orderSheets: 1110, readySheets: 650, stockSheets: 1090 });
    });

    it('books the halves when the run is completed', () => {
        const job = { id: 9, modelDesign: 'F6', cutInto: 2, runSheets: 1100, orderSheets: 1760, plainItem: 15, modelItem: 2264 };
        const rows = runBooking(job, { sheetsUsed: '1100', printedCount: '1100' }, 1)
            .map((r) => [r.Transaction_Type, r.Location, r.Item_ID, r.Count_Bundles_]);
        expect(rows).toEqual([
            ['LESS', 'PRINTING AREA', 15, 1100],
            ['ADD', 'PRINTING AREA', 2264, 1760],
            ['ADD', 'BAGS GODOWN', 2264, 440]
        ]);
    });
});

describe('ordersAwaitingRun and the queue hold', () => {
    const [run] = waitingRuns(job945);
    const customerOrder = { id: 13368, customer: 5179, shop: 'MUBARAK', printingColour: '["MAGENTA"]', print: 'MODEL NUMBER' };

    it('holds the customer print while the run waits in the queue', () => {
        const { machines, held } = groupQueue([customerOrder], ordersAwaitingRun([run], []));
        expect(machines).toEqual([]);
        expect(held).toEqual([{ so: customerOrder, state: AWAITING_RUN }]);
    });

    it('holds it while the run is made but not completed, and lets it go once it is', () => {
        const making = [{ id: 7, model: 'F12', source_jobs: '[945]', sub_orders: '[13368]', completed: 0 }];
        expect(ordersAwaitingRun([], making).has(13368)).toBe(true);
        const done = [{ ...making[0], completed: 1 }];
        const { machines } = groupQueue([customerOrder], ordersAwaitingRun([], done));
        expect(machines.map((m) => m.machine)).toEqual(['SINGLE COLOUR']);
    });

    it('does not count a model run as taking its orders out of the queue', () => {
        expect(queueSql()).toMatch(/WHERE COALESCE\(j\.Model_Design, ''\) = ''/);
    });
});

describe('a run job', () => {
    it('is made on the multi-colour machine, named for its design, with both stock items', () => {
        const [run] = waitingRuns(job945);
        expect(runBatchFields({ date: 1 })).toEqual({ Date: 1, Machine: 'MULTI COLOUR' });
        expect(MODEL_RUN_MACHINE).toBe('MULTI COLOUR');
        expect(runJobFields(3, run)).toEqual({
            Printing_Job_Batch: 3, Printing_Colours: 'F12 DESIGN', Sub_Orders: ['L', 13368], Source_Jobs: ['L', 945],
            Model_Design: 'F12', Sheet_Size: '16x19', Run_Sheets: 1100, Order_Sheets: 440, Cut_Into: 1, Plain_Item: 5, Model_Item: 776
        });
        expect(runColours(' f12 ')).toBe('F12 DESIGN');
    });
});

describe('completing a run', () => {
    const job = { id: 7, modelDesign: 'F12', orderSheets: 440, runSheets: 1100, plainItem: 5, modelItem: 776, plates: [21], outputs: [{ id: 30 }] };
    const form = { sheetsUsed: '1100', printedCount: '1100', printedKg: '24', misprintKg: '0', wastageKg: '0', damaged: [] };

    it('books 1,100 plain sheets out, 440 F12 to the printing area and 660 F12 to the godown', () => {
        const rows = runBooking(job, form, 100).map((r) => [r.Transaction_Type, r.Location, r.Item_ID, r.Count_Bundles_, r.Printing_Job]);
        expect(rows).toEqual([
            ['LESS', 'PRINTING AREA', 5, 1100, 7],
            ['ADD', 'PRINTING AREA', 776, 440, 7],
            ['ADD', 'BAGS GODOWN', 776, 660, 7]
        ]);
    });

    it('leaves every booking for the area incharge to acknowledge', () => {
        expect(runBooking(job, form, 100).every((r) => !('Incharge_Ack' in r))).toBe(true);
    });

    it('fills the orders first on a short run, and books nothing to stock', () => {
        expect(runSplit(job, 400)).toEqual({ toOrders: 400, toStock: 0, short: 40 });
        const rows = runBooking(job, { ...form, printedCount: '400' }, 100);
        expect(rows.map((r) => r.Location)).toEqual(['PRINTING AREA', 'PRINTING AREA']);
    });

    it('books the figures, the stock and the job closed in one bundle', () => {
        const actions = runCompletionActions(job, form, 100);
        expect(actions.map((a) => `${a[0]} ${a[1]}`)).toEqual([
            'UpdateRecord Printing_Job_Outputs', 'AddRecord Inventory_Transactions', 'AddRecord Inventory_Transactions',
            'AddRecord Inventory_Transactions', 'UpdateRecord Printing_Jobs'
        ]);
        expect(actions.at(-1)[3]).toMatchObject({ Printing_Completed: true, Wastage_Weight_Kg_: 0 });
    });

    it('refuses more printed than went in, and blanks', () => {
        expect(runCompletionProblems(job, form)).toEqual([]);
        expect(runCompletionProblems(job, { ...form, printedCount: '1200' })).toContain('1200 printed is more than the 1100 plain sheets used.');
        expect(runCompletionProblems(job, { ...form, sheetsUsed: '' })).toContain('Enter the plain sheets used, as a whole number.');
        expect(runCompletionProblems(job, { ...form, printedKg: '0' })).toContain('The printed weight cannot be 0 when something was printed.');
        expect(runCompletionProblems({ ...job, modelItem: null }, form)).toContain('This run has no stock items to book; it was made before they were set.');
    });
});

describe('the company plate', () => {
    const runJob = { id: 7, modelDesign: 'F12', subOrderIds: [13368], subOrders: [{ id: 13368, customer: 5179 }] };
    const company = { id: 21, plateType: COMPANY_PLATE, modelDesign: 'F12', status: 'IN RACK' };
    const customers = { id: 22, plateType: 'PLATE', customer: 5179, sourceSubOrder: 13368, status: 'IN RACK' };

    it('is what a run picks, never the customer\'s own plate', () => {
        const { lines, missing } = pickList([runJob], [company, customers]);
        expect(lines.map((l) => l.plate.id)).toEqual([21]);
        expect(missing).toEqual([]);
    });

    it('is registered when first picked if the register has none', () => {
        const { missing } = pickList([runJob], [customers]);
        expect(missing).toEqual([{ job: runJob, so: null }]);
        expect(companyPlateRecord(runJob)).toMatchObject({ Plate_Type: 'COMPANY', Model_Design: 'F12', Orders: ['L', 13368] });
        // Out with the run on its one side; the design's status is its sides'.
        expect(companyPlateRecord(runJob)).not.toHaveProperty('Status');
        expect(companySideFields(runJob)).toEqual({ Status: 'ISSUED', Issued_To_Job: 7, Verified: true });
    });

    it('records the run\'s orders in its history', () => {
        expect(ordersServedBy(runJob, company)).toEqual([13368]);
    });

    it('is found by design when the batch\'s plates are read', () => {
        const q = platesQuery([], [], [], ['f12']);
        expect(q.sql).toMatch(/p\.Plate_Type = 'COMPANY' AND UPPER\(TRIM\(p\.Model_Design\)\) IN \(\?\)/);
        expect(q.args).toEqual(['F12']);
    });
});
