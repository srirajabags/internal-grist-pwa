// A part of the page as a picture: handed to the phone's share sheet (where
// WhatsApp is), copied to the clipboard, or saved as a file where the browser
// can do neither. Whatever should not be in the picture (buttons, pickers) the
// page hides before calling: leaving nodes out of the copy instead keeps their
// space, as the copy carries each box's measured height.
import domtoimage from 'dom-to-image-more';

// A file name from a title: "Area group wise · Nov 2026" -> area-group-wise-nov-2026.
export const fileNameFor = (title) =>
    String(title || 'report').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'report';

// dom-to-image-more rather than html2canvas: the latter cannot read Tailwind
// v4's oklch colours.
const toPng = (element) => domtoimage.toBlob(element, {
    bgcolor: '#ffffff',
    scale: 2,
    // Copy every computed style, not just those that differ from a bare
    // element's: Tailwind's reset (border: 0 solid) otherwise comes out as the
    // browser's 3px "medium" border round every word.
    copyDefaultStyles: false
});

const download = (blob, name) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.download = name;
    link.href = url;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
};

// Returns 'shared', 'cancelled' or 'downloaded', so the page can say what
// happened. The image goes alone, with no title or text: given both, the share
// sheet's Copy put the picture and the text on the clipboard and WhatsApp
// pasted two things. The caption is drawn inside the picture instead.
export const shareElementImage = async (element, { title }) => {
    const blob = await toPng(element);
    const name = `${fileNameFor(title)}.png`;
    const file = new File([blob], name, { type: 'image/png' });
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file] });
            return 'shared';
        } catch (err) {
            if (err?.name === 'AbortError') return 'cancelled';
            // Some browsers refuse a share they said they could do: save instead.
        }
    }
    download(blob, name);
    return 'downloaded';
};

// One clipboard item holding one PNG, to paste into WhatsApp Web or desktop.
// The item is given the picture as a promise, not the finished blob: Safari
// only allows the write inside the tap, and drawing the picture outlasts it.
// `before` is waited on before drawing (the page showing the picture's
// caption), so call this straight from the tap, not after awaiting anything.
// Returns 'copied', or 'unsupported' where the browser cannot copy images.
export const copyElementImage = async (element, { before } = {}) => {
    if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') return 'unsupported';
    const png = (async () => {
        await before;
        return toPng(element);
    })();
    await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
    return 'copied';
};
