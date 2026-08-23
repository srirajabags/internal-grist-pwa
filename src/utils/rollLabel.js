// Printable label for a roll: the QR the scanner reads, with the id in plain text
// underneath so a person can read it when the code is scuffed or the phone is
// flat. The encoder is imported dynamically -- it is only needed when someone
// actually books a roll in, and bundling it would weigh on every other page.

// Labels carry the id exactly as the UI shows it, hash included, which is what
// the scanner's parser already expects.
export const rollLabelText = (itemId) => `#${String(itemId || '').trim().toUpperCase().replace(/^#/, '')}`;

const QR_PX = 640;          // generous, so a phone reads it from a distance
const PAD = 48;
const TEXT_PX = 64;         // starting size; shrunk to fit if the id is long
const FONT = (px) => `bold ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

// Returns { blob, url } for a PNG of the label. Revoke the url when finished.
export const makeRollLabelPng = async (itemId) => {
    const text = rollLabelText(itemId);
    // The browser build is CommonJS, so depending on interop the exports land on
    // .default or on the namespace itself.
    const mod = await import('qrcode');
    const QRCode = mod.default ?? mod;

    // Render the code on its own canvas first, then compose the label around it.
    const qr = document.createElement('canvas');
    await QRCode.toCanvas(qr, text, {
        width: QR_PX,
        margin: 1,
        errorCorrectionLevel: 'M',
        color: { dark: '#000000', light: '#ffffff' }
    });

    const canvas = document.createElement('canvas');
    canvas.width = QR_PX + PAD * 2;
    const ctx = canvas.getContext('2d');

    // Measure before sizing anything: a 21-character id at the starting size is
    // wider than the label, and the ends were being cut off. Shrink the font until
    // the whole id fits between the margins.
    const maxTextWidth = canvas.width - PAD * 2;
    let fontPx = TEXT_PX;
    ctx.font = FONT(fontPx);
    const naturalWidth = ctx.measureText(text).width;
    if (naturalWidth > maxTextWidth) {
        fontPx = Math.max(12, Math.floor((fontPx * maxTextWidth) / naturalWidth));
    }

    canvas.height = PAD + QR_PX + Math.round(fontPx * 1.6) + PAD;
    // Sizing the canvas resets the context, so everything is set after this point.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(qr, PAD, PAD);

    ctx.fillStyle = '#000000';
    ctx.font = FONT(fontPx);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    // maxWidth as a backstop: whatever the font metrics turn out to be, the text
    // cannot spill past the margins.
    ctx.fillText(text, canvas.width / 2, PAD + QR_PX + Math.round(fontPx * 0.9), maxTextWidth);

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { blob, url: URL.createObjectURL(blob), filename: `${text.replace(/^#/, '')}.png` };
};
