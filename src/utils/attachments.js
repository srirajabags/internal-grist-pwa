// Grist stores an attachment column as ["L", id, …] over the records API and as
// the raw JSON string over /sql, and a single-attachment column sometimes comes
// back as a bare number. Take the first id out of whichever shape arrived.
export const parseAttachmentId = (val) => {
    if (!val) return null;
    if (typeof val === 'number') return val;
    if (Array.isArray(val)) return val.find((v) => typeof v === 'number') ?? null;
    try {
        const parsed = JSON.parse(val);
        if (Array.isArray(parsed)) return parsed.find((v) => typeof v === 'number') ?? null;
        if (typeof parsed === 'number') return parsed;
    } catch { /* not parseable */ }
    return null;
};
