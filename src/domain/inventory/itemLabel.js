// Printable labels for any stock item -- rolls, sheets, patty, handles -- and the
// parsing of what a scanner reads back. The QR carries the item id, with the id in
// plain text underneath so a person can read it when the code is scuffed or the
// phone is flat. The encoder is imported dynamically: it is only needed when a
// label is actually produced, and bundling it would weigh on every other page.

// Labels carry the id exactly as the UI shows it, hash included.
export const itemLabelText = (itemId) => `#${String(itemId || '').trim().toUpperCase().replace(/^#/, '')}`;

// A scanner may hand back the id alone, the id with the # in front, or a URL with
// the id somewhere inside it. Roll ids have a known shape and are pulled out
// directly; anything else falls back to the last meaningful token, so an
// unrecognised label still reaches the lookup and earns a real "not found".
const ROLL_ID = /ROLL[_-]\d{2}-\d{2}-\d{4}[_-]\d+/i;
export const readItemLabel = (raw) => {
    const text = String(raw || '').trim();
    if (!text) return '';
    const hit = text.match(ROLL_ID);
    if (hit) return hit[0].toUpperCase();
    return text.replace(/^#/, '').split(/[\s/?#]+/).pop().trim().toUpperCase();
};

const QR_PX = 640;          // generous, so a phone reads it from a distance
const PAD = 48;
const TEXT_PX = 64;         // starting size; shrunk to fit if the id is long
const FONT = (px) => `bold ${px}px ui-monospace, SFMono-Regular, Menlo, Consolas, monospace`;

// What a label says in plain text, under the code. This is for people to read --
// the QR always carries the item id regardless, so scanning is unaffected.
//
// A roll id identifies one physical roll and is worth printing; a finished-goods
// id is just its own specification spelled out (SHEET_NW_VIRGIN_WHITE_110_16X19),
// so those labels show the item type and specification instead.
const upper = (v) => String(v ?? '').trim().toUpperCase();

export const itemLabelSpec = (item, { size, material } = {}) => {
    if (!item) return '';
    return [material && item.mat, item.col, item.gsm && `${item.gsm} GSM`, size]
        .filter(Boolean)
        .map(upper)
        .join(' - ');
};

export const itemLabelLines = (item) => {
    if (!item) return [];
    const isRoll = /ROLL/i.test(String(item.itype || ''));
    // Material (NW BOPP, NW VIRGIN, NW REGULAR) is what the racks are organised by
    // and the first thing anyone checks against an order, so every label carries it
    // on a row of its own rather than leaving it to whoever remembers.
    if (isRoll) {
        return [
            itemLabelText(item.iid),
            upper(item.mat),
            itemLabelSpec(item, { size: item.w && `${item.w}"` })
        ].filter(Boolean);
    }
    const size = item.w && item.h ? `${item.w}X${item.h}` : item.w ? `${item.w}"` : '';
    return [upper(item.itype), upper(item.mat), itemLabelSpec(item, { size })].filter(Boolean);
};

// Returns { blob, url } for a PNG of the label. Revoke the url when finished.
// `lines` are the centred text rows printed under the code; they never affect the
// encoded payload, which is always the item id. Defaults to the id itself.
export const makeItemLabelPng = async (itemId, lines) => {
    const text = itemLabelText(itemId);
    const rows = (Array.isArray(lines) && lines.length > 0 ? lines : [text])
        .map((l) => String(l || '').trim())
        .filter(Boolean);
    // The id is the headline; everything after it is printed on its own row below,
    // so a roll's material and specification stay legible instead of being run
    // together into one long line that has to shrink to fit.
    const [headline, ...subs] = rows;
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
    const naturalWidth = ctx.measureText(headline).width;
    if (naturalWidth > maxTextWidth) {
        fontPx = Math.max(12, Math.floor((fontPx * maxTextWidth) / naturalWidth));
    }

    // The rows below the id are smaller and share one size, fitted to whichever of
    // them is widest so they read as a set rather than a ransom note.
    let subPx = 0;
    if (subs.length > 0) {
        subPx = Math.round(fontPx * 0.62);
        ctx.font = FONT(subPx);
        const widest = Math.max(...subs.map((line) => ctx.measureText(line).width));
        if (widest > maxTextWidth) {
            subPx = Math.max(10, Math.floor((subPx * maxTextWidth) / widest));
        }
    }
    const subLead = Math.round(subPx * 1.35);

    canvas.height = PAD + QR_PX + Math.round(fontPx * 1.6)
        + subs.length * subLead + PAD;
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
    const idBaseline = PAD + QR_PX + Math.round(fontPx * 0.9);
    ctx.fillText(headline, canvas.width / 2, idBaseline, maxTextWidth);

    if (subs.length > 0) {
        ctx.font = FONT(subPx);
        ctx.fillStyle = '#333333';
        let y = idBaseline + Math.round(fontPx * 0.75) + Math.round(subPx * 0.5);
        for (const line of subs) {
            ctx.fillText(line, canvas.width / 2, y, maxTextWidth);
            y += subLead;
        }
    }

    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
    return { blob, url: URL.createObjectURL(blob), filename: `${text.replace(/^#/, '')}.png` };
};

// Every label on screen, as one zip. The archive is built in the browser from the
// same generator the single-label button uses, so what is printed in bulk is
// exactly what is printed one at a time.
//
// `items` are { iid, subtitle } pairs. `onProgress(done, total)` runs as each
// label is drawn -- a few hundred take a moment, and silence looks like a hang.
export const makeLabelsZip = async (items, onProgress, { filename } = {}) => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const seen = new Set();

    let done = 0;
    for (const item of items) {
        const { blob, url, filename } = await makeItemLabelPng(item.iid, item.lines);
        // The blob is what goes in the archive; the object url would leak.
        URL.revokeObjectURL(url);
        // Two rows can resolve to the same physical item, so keep names unique.
        let name = filename;
        for (let n = 2; seen.has(name); n += 1) name = filename.replace(/\.png$/, `_${n}.png`);
        seen.add(name);
        zip.file(name, blob);
        done += 1;
        onProgress?.(done, items.length);
        // Yield so the progress count actually paints between labels.
        await new Promise((r) => setTimeout(r, 0));
    }

    const stamp = new Date().toLocaleDateString('en-CA');
    return {
        blob: await zip.generateAsync({ type: 'blob' }),
        filename: filename || `item-labels_${stamp}.zip`
    };
};
