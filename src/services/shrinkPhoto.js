// A phone photo made small enough to keep: the longest side at most `maxSide`
// pixels, as a JPEG. A 4 MB camera picture of a plate becomes ~150 KB and
// still shows every letter on it.
export const fitWithin = (w, h, maxSide) => {
    const scale = Math.min(1, maxSide / Math.max(w || 1, h || 1));
    return { width: Math.round(w * scale), height: Math.round(h * scale) };
};

export const shrinkPhoto = async (file, { maxSide = 1280, quality = 0.75 } = {}) => {
    // createImageBitmap honours the photo's EXIF rotation, so it comes out upright.
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const { width, height } = fitWithin(bitmap.width, bitmap.height, maxSide);
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    return new Promise((resolve, reject) => canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error('Could not read the photo'))), 'image/jpeg', quality));
};
