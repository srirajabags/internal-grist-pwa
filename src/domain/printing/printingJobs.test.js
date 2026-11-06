import { describe, it, expect } from 'vitest';
import {
    queueSql, batchesFromRows, batchStage, batchProblem, batchFields, batchPlan, jobFields, outputFields,
    newPlateRecords, collectionProblems, collectionBundle, canStart,
    completionProblems, completionActions, canReturnPlates, returnPlan, returnPlanProblems, returnBundle,
    PRINTING_RELEASED_AT
} from './printingJobs';
import { STATUS } from './printingPlates';

const so = (fields) => ({
    id: 1, material: 'NON-WOVEN', plate: 'PLATE', print: 'SINGLE COLOUR', printingColour: '["RED"]',
    customer: 7, shop: 'Zara Textiles', ...fields
});

describe('queueSql — only work cut since release (user, 1 Nov 2026)', () => {
    it('ignores production finished before printing went live', () => {
        expect(queueSql()).toContain(`Production_Completed_At >= ${PRINTING_RELEASED_AT}`);
    });

    it('leaves out orders a printing job already has, looking inside each job\'s list', () => {
        expect(queueSql()).toMatch(/json_each\(CASE WHEN json_valid\(j\.Sub_Orders\)/);
        expect(queueSql()).toMatch(/taken\.so_id IS NULL/);
    });
});

describe('batchPlan — a batch is jobs by ink set, each with an output per shop (user, 5 Nov 2026)', () => {
    const plan = batchPlan([
        so({ id: 1, customer: 7, shop: 'Zara Textiles', sourceJob: 300 }),
        so({ id: 2, customer: 8, shop: 'Anand Mens Wear', sourceJob: 301 }),
        so({ id: 3, customer: 7, shop: 'Zara Textiles', sourceJob: 300 }),
        so({ id: 4, printingColour: '["BLUE","RED"]', customer: 7, shop: 'Zara Textiles' })
    ]);

    it('makes one job per ink set', () => {
        expect(plan.map((j) => j.colours)).toEqual(['BLUE + RED', 'RED']);
    });

    it('gathers a shop\'s orders in a job into one output', () => {
        const red = plan.find((j) => j.colours === 'RED');
        expect(red.outputs.map((o) => [o.shop, o.subOrders.map((x) => x.id)]))
            .toEqual([['Anand Mens Wear', [2]], ['Zara Textiles', [1, 3]]]);
    });

    it('writes the job with all its orders and the production jobs they came from, once each', () => {
        const red = plan.find((j) => j.colours === 'RED');
        expect(jobFields(9, red)).toEqual({
            Printing_Job_Batch: 9, Printing_Colours: 'RED', Sub_Orders: ['L', 1, 2, 3], Source_Jobs: ['L', 300, 301]
        });
        expect(outputFields(40, red.outputs[1])).toEqual({ Printing_Job: 40, Customer: 7, Sub_Orders: ['L', 1, 3] });
    });

    it('needs a machine and at least one order; the batch row holds just day and machine', () => {
        expect(batchProblem('', [so({})])).toMatch(/machine/);
        expect(batchProblem('SINGLE COLOUR', [])).toMatch(/at least one/);
        expect(batchProblem('SINGLE COLOUR', [so({}), so({ id: 2, printingColour: '["BLUE"]' })])).toBeNull();
        expect(batchFields({ date: 5, machine: 'SINGLE COLOUR' })).toEqual({ Date: 5, Machine: 'SINGLE COLOUR' });
    });
});

describe('batchesFromRows — batch, jobs, outputs and the orders behind them', () => {
    const rows = [
        { batch_id: 3, machine: 'SINGLE COLOUR', plates_collected: 1, job_id: 8, colours: 'RED', sub_orders: '[40,41]', plates: '[5,6]', damaged_plates: '[6]' },
        { batch_id: 3, machine: 'SINGLE COLOUR', plates_collected: 1, job_id: 9, colours: 'BLACK', sub_orders: '[42]', plates: null },
        { batch_id: 4, machine: 'TWO COLOUR', job_id: null }
    ];
    const outputs = [{ id: 70, job_id: 8, customer: 7, shop: 'Zara Textiles', sub_orders: '[40,41]', printed_count: 500 }];
    const subOrders = [so({ id: 40 }), so({ id: 41 }), so({ id: 42 })];
    const [b3, b4] = batchesFromRows(rows, outputs, subOrders);

    it('nests jobs under their batch and keeps an empty batch', () => {
        expect(b3.jobs.map((j) => [j.id, j.colours])).toEqual([[8, 'RED'], [9, 'BLACK']]);
        expect(b4.jobs).toEqual([]);
    });

    it('hangs each shop output and its orders on its job', () => {
        const [out] = b3.jobs[0].outputs;
        expect(out).toMatchObject({ id: 70, shop: 'Zara Textiles', subOrderIds: [40, 41], printedCount: 500 });
        expect(out.subOrders.map((x) => x.id)).toEqual([40, 41]);
        expect(b3.jobs[1].outputs).toEqual([]);
    });

    it('reads reference lists from SQL JSON', () => {
        expect(b3.jobs[0]).toMatchObject({ plates: [5, 6], damagedPlates: [6], subOrderIds: [40, 41] });
        expect(b3.jobs[1].plates).toEqual([]);
    });
});

describe('batchStage — where a batch is on the floor', () => {
    const job = (f) => ({ started: false, completed: false, ...f });

    it('waits for plates before anything else', () => {
        expect(batchStage({ platesCollected: false, jobs: [job()] })).toBe('PLATES TO COLLECT');
    });

    it('asks for the plates back once every job is done', () => {
        expect(batchStage({ platesCollected: true, jobs: [job({ started: true, completed: true })] })).toBe('PLATES TO RETURN');
        expect(batchStage({ platesCollected: true, jobs: [job({ started: true, completed: true }), job()] })).toBe('PRINTING');
    });

    it('is closed only when the plates are back', () => {
        expect(batchStage({ platesCollected: true, platesReturned: true, jobs: [] })).toBe('CLOSED');
    });
});

describe('newPlateRecords — a new design\'s plates enter the register when picked', () => {
    const order = so({ id: 40, plateCount: 2, customer: 5, city: 'Kurnool', bagW: 12, bagH: 16, shop: 'New Shop TYPE-3 AFT', orderDate: 500 });

    it('registers the set as one row counting its plates, already out with the job', () => {
        const rows = newPlateRecords({ id: 12 }, order);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({
            Customer: 5, Source_Sub_Order: 40, Plate_Type: 'PLATE', Plate_Count: 2, Status: STATUS.ISSUED,
            Issued_To_Job: 12, Rack: 'K', Slot: null, Reusable: true, Verified: true,
            Orders: ['L', 40], Made_On: 500, Last_Used_On: 500
        });
    });

    it('takes the slot the office already wrote into the shop name, of its own kind', () => {
        const stereo = so({ plate: 'STEREO', shop: 'Shop TYPE-3 AFT K-12 KS 4', city: 'Kurnool' });
        expect(newPlateRecords({ id: 1 }, stereo)[0]).toMatchObject({ Plate_Type: 'STEREO', Rack: 'K', Slot: 4 });
    });

    it('marks a plastic-cover plate single-use from the start', () => {
        expect(newPlateRecords({ id: 1 }, so({ material: 'PLASTIC' }))[0].Reusable).toBe(false);
    });
});

describe('plate collection', () => {
    const job = { id: 12 };
    const inRack = { id: 5, plateNo: 'PL-00005', rackCode: 'K-2', status: STATUS.IN_RACK, rack: 'K', slot: 2 };

    it('will not take a plate another job has out', () => {
        const busy = { ...inRack, status: STATUS.ISSUED, issuedToJob: 99 };
        expect(collectionProblems([{ job, plate: busy }])).toEqual(['K-2 is out with job 99.']);
    });

    it('lets a retried collection through for a plate already out with this job', () => {
        expect(collectionProblems([{ job, plate: { ...inRack, status: STATUS.ISSUED, issuedToJob: 12 } }])).toEqual([]);
    });

    it('issues each plate, tells the job, and marks the batch collected in one bundle', () => {
        const bundle = collectionBundle({ id: 3 }, [{ job, plate: inRack }], [{ jobId: 12, plateId: 77 }]);
        expect(bundle[0]).toEqual(['UpdateRecord', 'Printing_Plates', 5, { Status: STATUS.ISSUED, Issued_To_Job: 12 }]);
        expect(bundle).toContainEqual(['UpdateRecord', 'Printing_Jobs', 12, { Plates: ['L', 5, 77] }]);
        expect(bundle.at(-1)).toEqual(['UpdateRecord', 'Printing_Job_Batches', 3, { Plates_Collected: true }]);
    });

    it('does not issue a plate twice when a collection is retried', () => {
        const already = { ...inRack, status: STATUS.ISSUED, issuedToJob: 12 };
        const bundle = collectionBundle({ id: 3 }, [{ job, plate: already }]);
        expect(bundle.filter((a) => a[1] === 'Printing_Plate_Movements')).toHaveLength(0);
    });

    it('counts picking an unchecked plate as checking it', () => {
        const [[, , , fields]] = collectionBundle({ id: 3 }, [{ job, plate: { ...inRack, status: STATUS.UNVERIFIED } }]);
        expect(fields.Verified).toBe(true);
    });
});

describe('canStart — no printing without plates', () => {
    it('waits for the batch\'s plates and needs one on the job', () => {
        expect(canStart({ platesCollected: false }, { plates: [1] })).toBe(false);
        expect(canStart({ platesCollected: true }, { plates: [] })).toBe(false);
        expect(canStart({ platesCollected: true }, { plates: [1] })).toBe(true);
        expect(canStart({ platesCollected: true }, { plates: [1], started: true })).toBe(false);
    });
});

describe('completion — every shop\'s output, and the job\'s wastage once (user, 1 Nov 2026)', () => {
    const job = { id: 8, plates: [5, 6], outputs: [{ id: 70, shop: 'Zara Textiles' }, { id: 71, shop: 'Anand Mens Wear' }] };
    const good = {
        outputs: {
            70: { printedCount: '500', printedKg: '12.5', misprintKg: '0' },
            71: { printedCount: '200', printedKg: '5', misprintKg: '0.3' }
        },
        wastageKg: '0.4',
        damaged: [6]
    };

    it('accepts a full report, zeros included', () => {
        expect(completionProblems(job, good)).toEqual([]);
    });

    it('names the shop whose figure is missing', () => {
        const form = { ...good, outputs: { ...good.outputs, 71: { ...good.outputs[71], misprintKg: '' } } };
        expect(completionProblems(job, form)).toEqual(['Anand Mens Wear: enter the misprint weight in kg (0 if none).']);
    });

    it('refuses a fractional or missing count, and a printed weight of zero', () => {
        const form = { ...good, outputs: { ...good.outputs, 70: { printedCount: '12.5', printedKg: '0', misprintKg: '0' } } };
        expect(completionProblems(job, form)).toHaveLength(2);
    });

    it('wants the job\'s wastage, once', () => {
        expect(completionProblems(job, { ...good, wastageKg: '' })).toEqual(['Enter the wastage for the job in kg (0 if none).']);
    });

    it('writes each shop\'s numbers, then the job, in one bundle', () => {
        expect(completionActions(job, good)).toEqual([
            ['UpdateRecord', 'Printing_Job_Outputs', 70, { Printed_Count: 500, Printed_Weight_Kg_: 12.5, Misprint_Weight_Kg_: 0 }],
            ['UpdateRecord', 'Printing_Job_Outputs', 71, { Printed_Count: 200, Printed_Weight_Kg_: 5, Misprint_Weight_Kg_: 0.3 }],
            ['UpdateRecord', 'Printing_Jobs', 8, { Printing_Completed: true, Wastage_Weight_Kg_: 0.4, Damaged_Plates: ['L', 6] }]
        ]);
    });

    it('only marks damaged a plate the job actually ran with', () => {
        const [, , jobUpdate] = completionActions(job, { ...good, damaged: [6, 99] });
        expect(jobUpdate[3].Damaged_Plates).toEqual(['L', 6]);
    });
});

describe('plates back', () => {
    const kept = { id: 5, plateNo: 'PL-00005', sourceSubOrder: 40, status: STATUS.ISSUED, material: 'NON-WOVEN', plateType: 'PLATE', rack: 'K', slot: 2, orders: [10] };
    const single = { id: 6, sourceSubOrder: 41, status: STATUS.ISSUED, material: 'PLASTIC', plateType: 'PLATE', rack: 'K', slot: null };
    const batch = (jobs) => ({ id: 3, platesCollected: true, jobs });
    const job = (f) => ({ id: 1, completed: true, plates: [5], damagedPlates: [], subOrders: [{ id: 40 }, { id: 41 }], ...f });

    it('waits until every job is done', () => {
        expect(canReturnPlates(batch([job(), job({ completed: false })]))).toBe(false);
        expect(canReturnPlates(batch([job()]))).toBe(true);
    });

    it('sends each plate where the operator said: back, retired, or binned when single-use', () => {
        const plan = returnPlan(batch([job({ plates: [5, 6] })]), [kept, single]);
        expect(plan.map((p) => [p.plate.id, p.action])).toEqual([[5, 'RETURNED'], [6, 'DISCARDED']]);
        const worn = returnPlan(batch([job({ damagedPlates: [5] })]), [kept]);
        expect(worn[0].action).toBe('DAMAGED');
    });

    it('puts a plate back without asking for a slot, even one that never had a number', () => {
        const plan = returnPlan(batch([job()]), [{ ...kept, slot: null }]);
        expect(returnPlanProblems(plan)).toEqual([]);
        expect(returnBundle({ id: 3 }, plan, 1000)[0]).toEqual(['UpdateRecord', 'Printing_Plates', 5,
            { Status: STATUS.IN_RACK, Issued_To_Job: null }]);
    });

    it('records on the plate only the job\'s orders it printed, and today as its last use', () => {
        const plan = returnPlan(batch([job()]), [kept]);
        expect(returnBundle({ id: 3 }, plan, 1000)).toContainEqual(['UpdateRecord', 'Printing_Plates', 5,
            { Last_Used_On: 1000, Orders: ['L', 10, 40] }]);
    });

    it('leaves a plate already put back alone on a retry', () => {
        expect(returnPlan(batch([job()]), [{ ...kept, status: STATUS.IN_RACK }])).toEqual([]);
    });
});
