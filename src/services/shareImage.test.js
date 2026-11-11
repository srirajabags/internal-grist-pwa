import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('dom-to-image-more', () => ({
    default: { toBlob: vi.fn(async () => new Blob(['png'], { type: 'image/png' })) }
}));

const { shareElementImage, copyElementImage, fileNameFor } = await import('./shareImage.js');

const element = {};

describe('shareElementImage — one picture, nothing else', () => {
    let share;
    beforeEach(() => {
        share = vi.fn(async () => {});
        vi.stubGlobal('navigator', { canShare: () => true, share });
    });
    afterEach(() => vi.unstubAllGlobals());

    it('shares the image alone: with a caption text too, the share sheet\'s Copy put two things on the clipboard and WhatsApp pasted twice (Sales report, Nov 2026)', async () => {
        expect(await shareElementImage(element, { title: 'Month wise · Nov 2026' })).toBe('shared');
        expect(share).toHaveBeenCalledTimes(1);
        const payload = share.mock.calls[0][0];
        expect(Object.keys(payload)).toEqual(['files']);
        expect(payload.files).toHaveLength(1);
        expect(payload.files[0].name).toBe('month-wise-nov-2026.png');
        expect(payload.files[0].type).toBe('image/png');
    });

    it('says so when the person closes the share sheet', async () => {
        share.mockRejectedValueOnce(Object.assign(new Error('closed'), { name: 'AbortError' }));
        expect(await shareElementImage(element, { title: 'x' })).toBe('cancelled');
    });
});

describe('copyElementImage — exactly one PNG on the clipboard', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('writes a single clipboard item holding only image/png', async () => {
        const write = vi.fn(async () => {});
        vi.stubGlobal('ClipboardItem', class { constructor(data) { this.data = data; } });
        vi.stubGlobal('navigator', { clipboard: { write } });
        expect(await copyElementImage(element)).toBe('copied');
        expect(write).toHaveBeenCalledTimes(1);
        const items = write.mock.calls[0][0];
        expect(items).toHaveLength(1);
        expect(Object.keys(items[0].data)).toEqual(['image/png']);
    });

    it('reports that it cannot copy where the browser has no image clipboard', async () => {
        vi.stubGlobal('navigator', {});
        expect(await copyElementImage(element)).toBe('unsupported');
    });
});

describe('fileNameFor', () => {
    it('makes a plain file name from a title', () => {
        expect(fileNameFor('Area group wise · Sep 2026 – Nov 2026')).toBe('area-group-wise-sep-2026-nov-2026');
        expect(fileNameFor('')).toBe('report');
    });
});
