// Pictures of a design's plates from its design files (user, 15 Nov 2026):
// "for both plates there would be two corresponding TIFF files in the design
// task records. Can we generate a preview image from the corresponding TIFF
// files which can be used to identify plates individually." Tried first on
// PL-06124, Kiran Mobiles A-284: plate order 5724 holds 30547 (Telugu side)
// and 30548 (English side, the "B" file), each a RAR with one TIFF inside.

import { describe, it, expect } from 'vitest';
import { fileKind, artworksIn, fileSources, candidateFiles, pictureActions, needsPictures, pictureName } from './platePreviews';
import { plateSets } from './plateSets';
import { STATUS } from './printingPlates';

const meta = {
    30547: { fileName: '1C  - 10x14 - Dcut - Kiran Mobiles.rar' },
    30548: { fileName: '1C  - B - 10x14 - Dcut - Kiran Mobiles.rar' },
    1: { fileName: 'mahadev tel.tif' },
    2: { fileName: 'mahadev eng.tif' },
    3: { fileName: 'mahadev mockup.jpg' },
    4: { fileName: 'notes.txt' },
    5: { fileName: 'Sri Srinivasa 2C.tif' }
};

describe('which files a design\'s pictures are made from', () => {
    it('knows print files, pictures and archives by their names', () => {
        expect(fileKind('A.TIF')).toBe('print');
        expect(fileKind('a.psd')).toBe('print');
        expect(fileKind('a.jpg')).toBe('picture');
        expect(fileKind('a.rar')).toBe('archive');
        expect(fileKind('a.cdr')).toBe(null);
    });

    it('takes the print files in an archive over a mock-up, in reading order, without packing junk', () => {
        expect(artworksIn(['x 10.tif', 'x 2.tif', 'x.jpg', '__MACOSX/._x 2.tif', 'folder/']))
            .toEqual(['x 2.tif', 'x 10.tif']);
        expect(artworksIn(['only.jpg'])).toEqual(['only.jpg']);
    });

    it('looks at the plate order first, then the designer\'s TIFF task, then an old TIFF', () => {
        expect(fileSources({ plateOrder: [], designerTask: [1, 2], oldTiff: [5] })).toEqual([[1, 2], [5]]);
    });

    it('takes two archives for two plates, to be opened and counted', () => {
        expect(candidateFiles(2, [[30547, 30548]], meta)).toEqual([{ ids: [30547, 30548], needsLook: true }]);
    });

    it('takes two TIFFs for two plates, leaving out the customer mock-up and anything unreadable', () => {
        expect(candidateFiles(2, [[1, 3, 2, 4]], meta)).toEqual([{ ids: [1, 2], needsLook: false }]);
    });

    it('does not take one TIFF for a two-colour design\'s two plates', () => {
        // The plate maker separates one file into one plate per ink: a picture
        // of the whole design would not tell them apart.
        expect(candidateFiles(2, [[5]], meta)).toEqual([]);
    });

    it('falls through to the next source when the first has the wrong number of files', () => {
        expect(candidateFiles(2, [[5], [1, 2]], meta)).toEqual([{ ids: [1, 2], needsLook: false }]);
    });

    it('keeps one archive as a maybe -- it may hold both artworks', () => {
        expect(candidateFiles(2, [[30547]], meta)).toEqual([{ ids: [30547], needsLook: true }]);
        expect(candidateFiles(2, [[30547, 30548, 1]], meta)).toEqual([]);
    });
});

describe('which plate each picture belongs to', () => {
    // PL-06124's two sides, as Plate_Sides rows read with their design.
    const s1 = { id: 501, designId: 6124, plateInSet: 1, plateCount: 2, status: STATUS.UNVERIFIED };
    const s2 = { ...s1, id: 502, plateInSet: 2 };

    it('gives each side the picture of its place', () => {
        const [set] = plateSets([s2, s1]);
        expect(pictureActions(set, [901, 902])).toEqual([
            ['UpdateRecord', 'Plate_Sides', 501, { Picture: ['L', 901] }],
            ['UpdateRecord', 'Plate_Sides', 502, { Picture: ['L', 902] }]
        ]);
    });

    it('gives a new side the same picture as the damaged one it replaced', () => {
        const gone = { ...s2, status: STATUS.DAMAGED };
        const fresh = { ...s2, id: 503, replaces: 502, status: STATUS.IN_RACK };
        const [set] = plateSets([s1, gone, fresh]);
        expect(pictureActions(set, [901, 902])).toEqual([
            ['UpdateRecord', 'Plate_Sides', 501, { Picture: ['L', 901] }],
            ['UpdateRecord', 'Plate_Sides', 503, { Picture: ['L', 902] }],
            ['UpdateRecord', 'Plate_Sides', 502, { Picture: ['L', 902] }]
        ]);
    });

    it('writes nothing when the pictures do not match the places one for one', () => {
        expect(pictureActions(plateSets([s1, s2])[0], [901])).toEqual([]);
        // A design with a side missing from the register is not guessed at.
        expect(pictureActions(plateSets([s1])[0], [901, 902])).toEqual([]);
    });

    it('leaves a design alone once any side has a picture or photo', () => {
        expect(needsPictures(plateSets([s1, s2])[0])).toBe(true);
        expect(needsPictures(plateSets([{ ...s1, preview: [55] }, s2])[0])).toBe(false);
        expect(needsPictures(plateSets([{ id: 9, designId: 9, plateCount: 1 }])[0])).toBe(false);
    });

    it('names each picture after its plate', () => {
        expect(pictureName(plateSets([s1, s2])[0], 2)).toBe('PL-06124-2 picture.jpg');
    });
});
