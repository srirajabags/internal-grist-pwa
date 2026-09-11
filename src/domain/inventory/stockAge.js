// How old a piece of stock is, for issuing the oldest first.
//
// Roll ids carry the intake date the godown assigned — ROLL_22-08-2026_0001 —
// and that is the date the business means, so it wins. Created_at is a fallback
// for stock registered without one (and for a bulk import, where every row was
// created in the same second but the ids still say when the stock was counted).
const ID_DATE = /_(\d{2})-(\d{2})-(\d{4})_/;

export const intakeOrder = (itemId, createdAt) => {
    const m = ID_DATE.exec(String(itemId || ''));
    if (m) {
        const [, dd, mm, yyyy] = m;
        return Date.UTC(Number(yyyy), Number(mm) - 1, Number(dd)) / 1000;
    }
    const t = Number(createdAt);
    // Unknown age sorts last: never hold up real stock for something undateable.
    return Number.isFinite(t) && t > 0 ? t : Number.MAX_SAFE_INTEGER;
};

// Two pieces of stock count as the same vintage when they came in on the same
// day. Best fit is chosen within a vintage; across vintages the older wins.
export const sameVintage = (a, b) => Math.abs(a - b) < 86400;
