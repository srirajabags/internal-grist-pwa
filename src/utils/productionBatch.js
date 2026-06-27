// Pure config + logic for creating a Production Job Batch.
// No React / no network here so the grouping + stock-allocation rules are easy
// to read, tweak and test in isolation. The CreateBatchModal feeds this module
// plain rows fetched from Grist and renders whatever `buildPlan` returns.

// The five batch types, mirrored from Factory_Production_Job_Batches.Type metadata.
export const BATCH_TYPES = [
    'ROLLS TO SHEETS',
    'ROLLS TO DCUT',
    'ROLLS TO UCUT',
    'ROLLS TO WCUT',
    'ROLLS TO SIDEPATTY',
    'ROLLS TO HANDLES'
];

// Only sub-orders updated to the factory on/after this date are ever considered,
// unless the operator picks a later start date in the wizard.
export const HARD_START_DATE = '2026-06-25';

// Each batch type turns rolls into one finished/semi-finished output form. The
// value is the Inventory_Item_Codes.Type string for that output.
export const OUTPUT_TYPE = {
    'ROLLS TO SHEETS': 'SHEET',
    'ROLLS TO DCUT': 'DCUT BAG',
    'ROLLS TO UCUT': 'UCUT BAG',
    'ROLLS TO WCUT': 'WCUT BAG',
    'ROLLS TO SIDEPATTY': 'SIDEPATTY',
    'ROLLS TO HANDLES': 'HANDLE'
};

// Sub-order Roll_Material -> Inventory_Item_Codes.Material. Plastic variants have
// no item codes yet, so they intentionally fall through (soft-match returns null).
export const MATERIAL_MAP = {
    'NW REGULAR': 'NW NORMAL',
    'NW VIRGIN': 'NW VIRGIN',
    'NW BOPP': 'NW BOPP'
};

const norm = (v) => String(v ?? '').trim().toUpperCase();
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const isSet = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// Types counted in bundles/pieces rather than kg (mirrors the Grist
// Planned_Count_Bundles_ formula).
const isPieceType = (batchType) =>
    batchType === 'ROLLS TO SIDEPATTY' || batchType === 'ROLLS TO HANDLES';

// --- Roll-width matching ---
// Some batch types are produced by cutting a roll of a fixed width. A sub-order's
// required roll width is derived from its output geometry (sheet size / bag
// height) and matched to one of these fixed widths — exactly, or the next larger.
const ROLL_WIDTHS_SHEETS = [13, 15, 16, 17, 19];
const ROLL_WIDTHS_DCUT = [27, 32, 36, 42, 45];   // DCUT-model bags
const ROLL_WIDTHS_DCUT_HANDLE = [36, 38, 42];    // HANDLE-model bags (in a DCUT batch)

// Batch types whose sub-orders are grouped — and matched to rolls — by roll width
// rather than by output size. One job then represents one physical roll width.
export const ROLL_WIDTH_TYPES = new Set(['ROLLS TO SHEETS', 'ROLLS TO DCUT']);

// Smallest available width >= target (exact match wins, else next larger); null
// when nothing is wide enough.
const nextRollWidth = (target, widths) => {
    const sorted = [...widths].sort((a, b) => a - b);
    return sorted.find((w) => w >= target - 1e-6) ?? null;
};

// Parse a "WxH" sheet-size string into [w, h], or null if unparseable (blank or
// junk like "cancel").
const parseSheetSize = (v) => {
    const m = String(v ?? '').toLowerCase().match(/(\d+(?:\.\d+)?)\s*x\s*(\d+(?:\.\d+)?)/);
    return m ? [Number(m[1]), Number(m[2])] : null;
};

// Required roll width for a sub-order, or one of two sentinels:
//   'ignore' -> not enough / junk geometry; drop the sub-order silently.
//   null     -> a genuine requirement that no available roll width can satisfy;
//               the caller flags it during allocation so it is not lost.
export const requiredRollWidth = (batchType, so) => {
    if (batchType === 'ROLLS TO SHEETS') {
        const dims = parseSheetSize(so.Sheet_Size);
        if (!dims) return 'ignore';
        const [w, h] = dims;
        const rolls = ROLL_WIDTHS_SHEETS;
        // 1st: 16" if it matches either dimension. 2nd: the smaller dimension.
        // 3rd: the larger dimension. Each only if it is an available roll width.
        if (rolls.includes(16) && (w === 16 || h === 16)) return 16;
        const small = Math.min(w, h), large = Math.max(w, h);
        if (rolls.includes(small)) return small;
        if (rolls.includes(large)) return large;
        return null;
    }
    if (batchType === 'ROLLS TO DCUT') {
        const h = num(so.Bag_Height);
        if (!h) return 'ignore';
        // HANDLE-model bags use a tighter allowance (+2") than DCUT bags (+4").
        const handle = norm(so.Model) === 'HANDLE';
        const target = handle ? h * 2 + 2 : h * 2 + 4;
        const rolls = handle ? ROLL_WIDTHS_DCUT_HANDLE : ROLL_WIDTHS_DCUT;
        return nextRollWidth(target, rolls);
    }
    return null;
};

// --- Qualification: does this sub-order need the chosen output? ---
// Centralised so the factory's real rules are a one-place edit. A sub-order can
// satisfy several types (e.g. a STITCHING bag needs a body AND a side-patty).
export const typeNeedsSubOrder = (batchType, so) => {
    const model = norm(so.Model);
    switch (batchType) {
        case 'ROLLS TO DCUT': return model === 'DCUT' || model === 'HANDLE';
        case 'ROLLS TO UCUT': return model === 'UCUT';
        case 'ROLLS TO HANDLES': return model === 'STITCHING';
        case 'ROLLS TO SHEETS': return model === 'STITCHING' || model === 'PLAIN';
        case 'ROLLS TO SIDEPATTY':
            return isSet(so.Sidepatty_Width) || isSet(so.Sidepatty_Colour);
        default: return false;
    }
};

// The attributes that define a group / item-code. For side-patty batches the
// relevant colour/gsm/width live on the Sidepatty_* fields, otherwise the Bag_*
// fields. Material always comes from Roll_Material.
export const groupAttrs = (batchType, so) => {
    if (batchType === 'ROLLS TO SIDEPATTY') {
        if (so.Sidepatty_Colour == 'PRINTED') {
            return {
                material: 'NW REGULAR',
                colour: so.Handle_Colour || '',
                gsm: '110',
                width: (Number(so.Sidepatty_Width) - 0.5).toFixed(2) || ''
            };
        }
        return {
            material: 'NW REGULAR',
            colour: so.Sidepatty_Colour || '',
            gsm: so.Sidepatty_GSM || '',
            width: so.Sidepatty_Width || ''
        };
    }
    if (batchType === 'ROLLS TO HANDLES') {
        return {
            material: 'NW REGULAR',
            colour: so.Sidepatty_Colour || so.Handle_Colour,
            gsm: '110',
            width: '2'
        };
    }
    // Roll-width types group by the required roll width, not the bag/sheet size, so
    // every sub-order cuttable from the same roll lands in one job.
    if (ROLL_WIDTH_TYPES.has(batchType)) {
        const rw = requiredRollWidth(batchType, so);
        return {
            material: so.Roll_Material || '',
            colour: so.Bag_Colour || '',
            gsm: so.Bag_GSM || '',
            width: typeof rw === 'number' ? String(rw) : ''
        };
    }
    return {
        material: so.Roll_Material || '',
        colour: so.Bag_Colour || '',
        gsm: so.Bag_GSM || '',
        width: so.Bag_Width || ''
    };
};

// The output item Type a sub-order produces. Most batch types have a single
// output, but a ROLLS TO DCUT batch yields DCUT BAG or HANDLE BAG by bag model.
export const outputTypeFor = (batchType, so) =>
    batchType === 'ROLLS TO DCUT'
        ? (norm(so.Model) === 'HANDLE' ? 'HANDLE BAG' : 'DCUT BAG')
        : OUTPUT_TYPE[batchType];

// Group key: roll-width batches group purely by material + roll width + colour +
// gsm, so every output (e.g. DCUT and HANDLE bags) cuttable from the same roll
// shares one job. Output products are split out later, at completion, by model.
export const groupKeyFor = (batchType, so) => {
    const a = groupAttrs(batchType, so);
    return [norm(a.material), norm(a.width), norm(a.colour), norm(a.gsm)].join(' | ');
};

// Find an Inventory_Item_Codes row of the given output Type whose mapped
// attributes match the group. Returns the row id or null. `outputType` overrides
// the batch's default output type (used for per-model DCUT/HANDLE bags).
export const softMatchItemCode = (attrs, itemCodes, batchType, outputType) => {
    const wantType = outputType || OUTPUT_TYPE[batchType];
    const wantMat = MATERIAL_MAP[norm(attrs.material)] || null;
    const hit = itemCodes.find((ic) =>
        norm(ic.Type) === norm(wantType) &&
        (wantMat ? norm(ic.Material) === norm(wantMat) : true) &&
        norm(ic.Colour) === norm(attrs.colour) &&
        norm(ic.GSM) === norm(attrs.gsm) &&
        norm(ic.Width_Inches_) === norm(attrs.width)
    );
    return hit ? hit.id : null;
};

// Available stock relevant to a group, split into finished (output-form) and raw
// rolls. `inventory` rows are joined summary rows: { itemId, codeId, type,
// material, colour, gsm, width, availWeight, availBundles }.
const relevantStock = (attrs, inventory, batchType, outputType) => {
    const wantMat = MATERIAL_MAP[norm(attrs.material)] || null;
    const matchAttrs = (r, requireWidth) =>
        (wantMat ? norm(r.material) === norm(wantMat) : false) &&
        norm(r.colour) === norm(attrs.colour) &&
        norm(r.gsm) === norm(attrs.gsm) &&
        (!requireWidth || norm(r.width) === norm(attrs.width));

    const availOf = (r) => (isPieceType(batchType) ? num(r.availBundles) : num(r.availWeight));
    const outType = norm(outputType || OUTPUT_TYPE[batchType]);

    // Finished stock must match width too (a 16" sheet ≠ a 32" sheet). For
    // roll-width types the group's width IS the roll width, so rolls must match it
    // exactly; for other types rolls are wide and get cut down, so width is free.
    const requireRollWidth = ROLL_WIDTH_TYPES.has(batchType);
    const finished = inventory
        .filter((r) => norm(r.type) === outType && matchAttrs(r, true) && availOf(r) > 0)
        .map((r) => ({ ...r, avail: availOf(r) }))
        .sort((a, b) => b.avail - a.avail);
    const rolls = inventory
        .filter((r) => norm(r.type) === 'ROLL' && matchAttrs(r, requireRollWidth) && availOf(r) > 0)
        .map((r) => ({ ...r, avail: availOf(r) }))
        .sort((a, b) => b.avail - a.avail);

    return { finished, rolls };
};

// Greedily take from a list of stock rows up to `need`. Returns the picks (with
// the amount taken) and how much was covered.
const takeFrom = (stock, need) => {
    const picks = [];
    let covered = 0;
    for (const s of stock) {
        if (covered >= need) break;
        const take = Math.min(s.avail, need - covered);
        if (take > 0) { picks.push({ itemId: s.itemId, codeId: s.codeId, take }); covered += take; }
    }
    return { picks, covered };
};

// Split sub-orders (oldest first) into the prefix that fits within `capacity`
// and the remainder that must be postponed.
const splitByCapacity = (subOrders, capacity) => {
    const sorted = [...subOrders].sort(
        (a, b) => num(a.Factory_Updated_Date) - num(b.Factory_Updated_Date) || a.id - b.id
    );
    const fulfilled = [];
    const postponed = [];
    let used = 0;
    for (const so of sorted) {
        const qty = num(so.Quantity);
        if (used + qty <= capacity + 1e-6) { fulfilled.push(so); used += qty; }
        else postponed.push(so);
    }
    return { fulfilled, postponed };
};

// Run the 5-priority ladder for one group. Returns the allocation describing the
// job to create (if any) and which sub-orders are postponed.
export const allocateStock = (attrs, subOrders, inventory, batchType, outputType) => {
    const required = subOrders.reduce((s, so) => s + num(so.Quantity), 0);
    const { finished, rolls } = relevantStock(attrs, inventory, batchType, outputType);
    const finishedTotal = finished.reduce((s, r) => s + r.avail, 0);
    const rollsTotal = rolls.reduce((s, r) => s + r.avail, 0);

    // Priority 1 — finished/semi stock covers the whole requirement.
    if (finishedTotal >= required && required > 0) {
        const { picks } = takeFrom(finished, required);
        return { priority: 1, picks, fulfilledQty: required, fulfilled: subOrders, postponed: [] };
    }
    // Priority 2 — a raw roll (or rolls) covers the whole requirement.
    if (rollsTotal >= required && required > 0) {
        const { picks } = takeFrom(rolls, required);
        return { priority: 2, picks, fulfilledQty: required, fulfilled: subOrders, postponed: [] };
    }
    // Priority 3 — mix: rolls take the major share, finished covers the rest.
    if (rollsTotal > 0 && rollsTotal + finishedTotal >= required && required > 0) {
        const fromRolls = takeFrom(rolls, required);
        const fromFinished = takeFrom(finished, required - fromRolls.covered);
        return {
            priority: 3,
            picks: [...fromRolls.picks, ...fromFinished.picks],
            fulfilledQty: required,
            fulfilled: subOrders,
            postponed: []
        };
    }
    // Priority 4 — partial: take everything available, postpone what does not fit.
    const capacity = rollsTotal + finishedTotal;
    if (capacity > 0) {
        const fromRolls = takeFrom(rolls, capacity);
        const fromFinished = takeFrom(finished, capacity - fromRolls.covered);
        const { fulfilled, postponed } = splitByCapacity(subOrders, capacity);
        if (fulfilled.length > 0) {
            const fulfilledQty = fulfilled.reduce((s, so) => s + num(so.Quantity), 0);
            return {
                priority: 4,
                picks: [...fromRolls.picks, ...fromFinished.picks],
                fulfilledQty,
                fulfilled,
                postponed
            };
        }
    }
    // Priority 5 — nothing usable; postpone the whole group.
    return { priority: 5, picks: [], fulfilledQty: 0, fulfilled: [], postponed: subOrders };
};

export const PRIORITY_LABEL = {
    1: 'Finished stock (full)',
    2: 'Raw roll (full)',
    3: 'Roll + finished mix',
    4: 'Partial — some postponed',
    5: 'No stock — all postponed'
};

// Orchestrate: qualify -> group -> allocate. Returns { groups, postponedCount,
// totalPlannedQty } where each group is everything the review UI and the writer
// need. `inventory` is the joined summary rows described in relevantStock.
export const buildPlan = ({ batchType, subOrders, itemCodes, inventory }) => {
    const eligible = subOrders.filter((so) => typeNeedsSubOrder(batchType, so));

    // For roll-width batch types, resolve each sub-order's roll width first: drop
    // the ones with blank/junk geometry ('ignore'), and set aside the ones with a
    // genuine requirement no roll width can meet (null) so they can be flagged.
    const usesRollWidth = ROLL_WIDTH_TYPES.has(batchType);
    const unmatched = [];
    const groupable = [];
    for (const so of eligible) {
        if (!usesRollWidth) { groupable.push(so); continue; }
        const rw = requiredRollWidth(batchType, so);
        if (rw === 'ignore') continue;
        if (rw == null) { unmatched.push(so); continue; }
        groupable.push(so);
    }

    const byKey = new Map();
    for (const so of groupable) {
        const key = groupKeyFor(batchType, so);
        if (!byKey.has(key)) byKey.set(key, { key, attrs: groupAttrs(batchType, so), subOrders: [] });
        byKey.get(key).subOrders.push(so);
    }

    // Work on a mutable copy of inventory and deduct what each group consumes, so
    // a physical roll/sheet is never allocated to two groups in the same run.
    // Largest-requirement groups are served first.
    const pieces = isPieceType(batchType);
    const stock = inventory.map((r) => ({ ...r }));
    const stockById = new Map(stock.map((r) => [r.itemId, r]));

    const groups = [...byKey.values()]
        .map((g) => ({ ...g, requiredQty: g.subOrders.reduce((s, so) => s + num(so.Quantity), 0) }))
        .sort((a, b) => b.requiredQty - a.requiredQty)
        .map((g) => {
            const alloc = allocateStock(g.attrs, g.subOrders, stock, batchType);
            for (const p of alloc.picks) {
                const row = stockById.get(p.itemId);
                if (!row) continue;
                if (pieces) row.availBundles = num(row.availBundles) - p.take;
                else row.availWeight = num(row.availWeight) - p.take;
            }
            // Roll-width jobs are identified by the roll they consume (one roll code
            // per group), so output codes can be resolved per model at completion.
            const rollCodeId = usesRollWidth ? (alloc.picks.find((p) => p.codeId)?.codeId ?? null) : null;
            return {
                ...g,
                rollWidth: usesRollWidth ? num(g.attrs.width) : null,
                rollCodeId,
                matchedCodeId: usesRollWidth ? rollCodeId : softMatchItemCode(g.attrs, itemCodes, batchType),
                ...alloc
            };
        });

    const postponedCount = groups.reduce((s, g) => s + g.postponed.length, 0);
    const totalPlannedQty = groups.reduce((s, g) => s + g.fulfilledQty, 0);
    const jobCount = groups.filter((g) => g.fulfilled.length > 0).length;

    return {
        groups, postponedCount, totalPlannedQty, jobCount,
        isPieces: isPieceType(batchType),
        unmatched, unmatchedCount: unmatched.length
    };
};
