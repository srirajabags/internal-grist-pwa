// The finalisation screenshots behind a plate: what the customer approved,
// newest first, so whoever is holding the plate can see the design without
// opening a TIFF.
//
// They are the same pictures the /factory page and Grist's TIFF checking
// dashboard show: Customer_Conversations.Screenshots on a conversation whose
// outcomes include FINALISED DESIGN, for one of the orders the plate printed.

export const FINALISED = 'FINALISED DESIGN';

const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);

const ids = (v) => {
    if (Array.isArray(v)) return v.filter((x) => typeof x === 'number');
    try {
        const parsed = JSON.parse(v || '[]');
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === 'number') : [];
    } catch {
        return [];
    }
};

// Outcomes is a choice list, stored as JSON (["FINALISED DESIGN", …]), so the
// match takes the quotes too: only that exact outcome, never a longer choice
// that happens to contain the words.
export const proofQuery = (orderIds) => {
    const list = [...new Set((orderIds || []).map(num).filter(Boolean))];
    if (!list.length) return null;
    return {
        sql: `SELECT cc.id, cc.Sub_Order_in_Context AS so_id, cc.Screenshots AS shots, cc.Created_At AS at,
                     o.Order_ID AS order_id
              FROM Customer_Conversations cc
              LEFT JOIN Sub_Orders so ON so.id = cc.Sub_Order_in_Context
              LEFT JOIN Orders o ON o.id = so."Order"
              WHERE cc.Outcomes LIKE '%"${FINALISED}"%'
                AND cc.Sub_Order_in_Context IN (${list.map(() => '?').join(',')})`,
        args: list
    };
};

// Every screenshot once, the latest conversation's first: the last order's
// approval is the design most likely on the plate now.
export const proofShots = (rows, limit = 10) => {
    const seen = new Set();
    const out = [];
    const sorted = [...(rows || [])].sort((a, b) => num(b.at) - num(a.at) || num(b.id) - num(a.id));
    for (const r of sorted) {
        for (const attId of ids(r.shots)) {
            if (seen.has(attId)) continue;
            seen.add(attId);
            out.push({ attId, subOrderId: num(r.so_id), orderId: r.order_id ?? '', at: r.at ?? null });
        }
    }
    return out.slice(0, limit);
};

// Where an order's screenshot sits in the carousel: its newest one, or -1 when
// the order has none there.
export const shotIndexFor = (shots, subOrderId) => (shots || [])
    .findIndex((s) => s.subOrderId === Number(subOrderId));

// Whether a file is a picture a phone can show and afford to download. A few
// "screenshots" are design TIFFs of over 100 MB; those are left for Grist.
// Pasted screenshots often arrive with no extension ("…clipboard"), and are
// images all the same.
export const MAX_PROOF_BYTES = 10 * 1024 * 1024;
const SHOWABLE = ['png', 'jpg', 'jpeg', 'webp', 'gif'];

export const isShowableProof = ({ fileName = '', fileSize = 0 } = {}) => {
    if (num(fileSize) > MAX_PROOF_BYTES) return false;
    const m = /\.([a-z0-9]{2,5})$/i.exec(String(fileName));
    return !m || SHOWABLE.includes(m[1].toLowerCase());
};
