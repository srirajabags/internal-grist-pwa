import { describe, it, expect } from 'vitest';
import { proofQuery, proofShots, isShowableProof, shotIndexFor } from './finalisationProof';

describe('proofQuery — the finalised-design conversations of a plate\'s orders', () => {
    it('asks only for FINALISED DESIGN, for each order once', () => {
        const q = proofQuery([4130, 6766, 4130]);
        expect(q.sql).toContain(`LIKE '%"FINALISED DESIGN"%'`);
        expect(q.args).toEqual([4130, 6766]);
    });

    it('asks nothing for a plate with no orders', () => {
        expect(proofQuery([])).toBeNull();
    });
});

describe('proofShots — newest approval first', () => {
    // Yuvaraj Mens Wear AS-1: one screenshot per order (Nov 2026).
    const rows = [
        { id: 1, so_id: 4130, shots: '[9962]', at: 1769507869, order_id: 108001 },
        { id: 3, so_id: 12422, shots: '[33326]', at: 1790680778, order_id: 115001 },
        { id: 2, so_id: 6766, shots: '[17414]', at: 1776142033, order_id: 111001 }
    ];

    it('leads with the last order\'s screenshot', () => {
        expect(proofShots(rows).map((s) => s.attId)).toEqual([33326, 17414, 9962]);
        expect(proofShots(rows)[0]).toMatchObject({ subOrderId: 12422, orderId: 115001 });
    });

    it('shows a screenshot attached twice only once, and stops at the limit', () => {
        const dup = [...rows, { id: 4, so_id: 4130, shots: '[9962, 9963]', at: 1 }];
        expect(proofShots(dup, 10).map((s) => s.attId)).toEqual([33326, 17414, 9962, 9963]);
        expect(proofShots(rows, 2)).toHaveLength(2);
    });

    it('reads the API\'s list form as well as SQL JSON', () => {
        expect(proofShots([{ id: 1, shots: ['L', 5, 6], at: 1 }]).map((s) => s.attId)).toEqual([5, 6]);
    });
});

describe('isShowableProof — what a phone downloads', () => {
    it('shows ordinary screenshots, including pasted ones with no extension', () => {
        expect(isShowableProof({ fileName: 'Screenshot 2026-11-04 132225.jpg', fileSize: 90000 })).toBe(true);
        expect(isShowableProof({ fileName: 'image.PNG', fileSize: 340000 })).toBe(true);
        expect(isShowableProof({ fileName: 'Pasted from clipboard', fileSize: 500000 })).toBe(true);
    });

    it('leaves design TIFFs and anything huge for Grist', () => {
        expect(isShowableProof({ fileName: 'design.tif', fileSize: 1000 })).toBe(false);
        expect(isShowableProof({ fileName: 'big.png', fileSize: 120 * 1024 * 1024 })).toBe(false);
    });
});

describe('shotIndexFor — tapping an order brings up its screenshot', () => {
    const shots = [
        { attId: 3, subOrderId: 12422 },
        { attId: 2, subOrderId: 6766 },
        { attId: 9, subOrderId: 6766 }
    ];

    it('finds the order\'s newest screenshot', () => {
        expect(shotIndexFor(shots, 6766)).toBe(1);
        expect(shotIndexFor(shots, '12422')).toBe(0);
    });

    it('says so when the order has none', () => {
        expect(shotIndexFor(shots, 4130)).toBe(-1);
    });
});
