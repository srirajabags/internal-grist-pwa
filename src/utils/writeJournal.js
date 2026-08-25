// A record of what a multi-step write actually managed to do.
//
// Most of these flows write several times — transactions, then a flag; jobs, then
// the batch — and Grist can refuse any one of them on access rules. When that
// happens the operator needs to know precisely which writes landed, because the
// ones that landed have to be reversed by hand, by someone with the rights to do
// it. Swallowing the error, or reporting only the last failure, leaves stock
// half-moved with nobody aware.

export const newJournal = () => {
    const steps = [];
    return {
        steps,
        // Run one write. Records it either way and re-throws on failure, so the
        // caller stops where it stopped but the journal survives to be shown.
        run: async (label, fn) => {
            const entry = { label, status: 'done' };
            try {
                const result = await fn();
                steps.push(entry);
                return result;
            } catch (err) {
                entry.status = 'failed';
                entry.detail = err?.message || String(err);
                steps.push(entry);
                throw err;
            }
        },
        // A step that was deliberately not needed, so the list reads as a complete
        // account rather than leaving the operator wondering what happened to it.
        skip: (label, detail) => { steps.push({ label, status: 'skipped', detail }); }
    };
};

// Whether a failure is Grist turning the write down rather than anything the
// operator did — the case where the answer is "ask for the permission", not
// "try again".
export const isPermissionFailure = (message) =>
    /\b(403|401)\b|forbidden|unauthori[sz]ed|access rules|not authorized|permission/i.test(String(message || ''));

// Everything the journal knows, as text an operator can paste into a message to
// whoever has to put it right.
export const journalToText = ({ title, error, steps }) => [
    title || 'Write failed',
    error ? `Error: ${error}` : null,
    '',
    ...(steps || []).map((s) => {
        const mark = s.status === 'done' ? '[done]' : s.status === 'failed' ? '[FAILED]' : '[skipped]';
        return `${mark} ${s.label}${s.detail ? ` — ${s.detail}` : ''}`;
    }),
    (steps || []).some((s) => s.status === 'failed') ? '[not attempted] everything after the failed step' : null,
    '',
    `Reported at ${new Date().toLocaleString('en-IN')}`
].filter((l) => l !== null).join('\n');
