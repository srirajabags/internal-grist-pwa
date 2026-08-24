// Pure config + logic for creating a Production Job Batch.
// No React / no network here so the grouping + stock-allocation rules are easy
// to read, tweak and test in isolation. The CreateBatchModal feeds this module
// plain rows fetched from Grist and renders whatever `buildPlan` returns.

// The batch types offered in the Create-Batch flow, mirrored from
// Factory_Production_Job_Batches.Type metadata. ROLLS TO UCUT and ROLLS TO WCUT
// are parked for now — their OUTPUT_TYPE / qualification rules stay defined below
// so they can be re-added here without further changes.
export const BATCH_TYPES = [
    'ROLLS TO SHEETS',
    'ROLLS TO MODEL SHEETS',
    'ROLLS TO DCUT',
    'ROLLS TO SIDEPATTY',
    'ROLLS TO BOTTOMPATTY SHEETS',
    'ROLLS TO HANDLES',
    'ROLLS TO PRESSING HANDLES'
];

// Only sub-orders updated to the factory on/after this date are ever considered,
// unless the operator picks a later start date in the wizard.
export const HARD_START_DATE = '2026-06-25';

// Each batch type turns rolls into one finished/semi-finished output form. The
// value is the Inventory_Item_Codes.Type string for that output.
export const OUTPUT_TYPE = {
    'ROLLS TO SHEETS': 'SHEET',
    'ROLLS TO MODEL SHEETS': 'MODEL NUMBER SHEET',
    'ROLLS TO DCUT': 'DCUT BAG',
    'ROLLS TO UCUT': 'UCUT BAG',
    'ROLLS TO WCUT': 'WCUT BAG',
    'ROLLS TO SIDEPATTY': 'SIDEPATTY',
    'ROLLS TO BOTTOMPATTY SHEETS': 'BOTTOMPATTY SHEET',
    'ROLLS TO HANDLES': 'HANDLE',
    'ROLLS TO PRESSING HANDLES': 'PRESSING HANDLE'
};

// Sub-order Roll_Material -> Inventory_Item_Codes.Material. Plastic variants have
// no item codes yet, so they intentionally fall through (soft-match returns null).
export const MATERIAL_MAP = {
    'NW REGULAR': 'NW REGULAR',
    'NW VIRGIN': 'NW VIRGIN',
    'NW BOPP': 'NW BOPP'
};

const norm = (v) => String(v ?? '').trim().toUpperCase();
const num = (v) => (typeof v === 'number' ? v : Number(v) || 0);
const isSet = (v) => v !== null && v !== undefined && String(v).trim() !== '';

// --- What one finished bag needs -------------------------------------------
// The factory's bill of materials, in one editable place. Each rule pairs a
// `combination` — filters matched against the sub-order — with `requirements`:
// how many of each output item ONE finished bag needs. Everything downstream
// (planned kg, bundles, the output counts shown in the batch modal) reads these
// numbers, so changing a count here changes the plan.
//
// combination values are matched case-insensitively and may be:
//   'STITCHING'            exact value
//   ['DCUT', 'UCUT']       any one of these
//   '*'                    any non-empty value
// Rules are tried top-down and the FIRST match wins, so keep the specific ones
// above the general ones. requirements keys are Inventory_Item_Codes types (the
// output types in OUTPUT_TYPE / outputTypeFor); an item absent from a rule is
// simply not needed by that bag.
export const OUTPUT_REQUIREMENTS = [
    {
        label: 'Stitching bag with a printed side patty (its gusset is a bottom patty)',
        combination: { Model: 'STITCHING', Sidepatty_Colour: 'PRINTED' },
        requirements: {
            'SHEET': 2,                  // front + back
            'MODEL NUMBER SHEET': 2,
            'HANDLE': 2,                 // one pair
            'BOTTOMPATTY': 1
        }
    },
    {
        label: 'Stitching bag with a plain side patty',
        combination: { Model: 'STITCHING' },
        requirements: {
            'SHEET': 2,                  // front + back
            'MODEL NUMBER SHEET': 2,
            'HANDLE': 2,
            'SIDEPATTY': 1
        }
    },
    {
        label: 'Handle-model bag (d-cut body, pressing handles)',
        combination: { Model: 'HANDLE' },
        requirements: {
            'HANDLE BAG': 1,
            'DCUT BAG': 1,
            'PRESSING HANDLE': 2,
            'SIDEPATTY': 1,
            'BOTTOMPATTY': 1
        }
    },
    {
        label: 'Cut bag (d-cut / u-cut / w-cut)',
        combination: { Model: ['DCUT', 'UCUT', 'WCUT'] },
        requirements: {
            'DCUT BAG': 1, 'UCUT BAG': 1, 'WCUT BAG': 1,
            'SIDEPATTY': 1, 'BOTTOMPATTY': 1
        }
    },
    {
        label: 'Plain (unstitched) sheet order',
        combination: { Model: 'PLAIN' },
        requirements: { 'SHEET': 1, 'MODEL NUMBER SHEET': 1 }
    }
];

// --- Extra production per batch type ---------------------------------------
// Some processes have to start more than the orders need: misprints and cutting
// wastage mean a run of 3,000 sheets is put on as 3,300. The fraction here is
// added to the requirement of every group of that batch type, so it carries
// through the roll allocation, the planned output and the counts on screen.
// 0 (or a type left out) = make exactly what the orders need.
export const PRODUCTION_OVERAGE = {
    'ROLLS TO SHEETS': 0.10,          // misprints + cutting wastage
    'ROLLS TO MODEL SHEETS': 0.10,   // printed the same way, same allowance
    'ROLLS TO DCUT': 0.10,
    'ROLLS TO UCUT': 0.10,
    'ROLLS TO WCUT': 0,
    'ROLLS TO SIDEPATTY': 0.10,
    'ROLLS TO BOTTOMPATTY SHEETS': 0.10,
    'ROLLS TO HANDLES': 0.10,
    'ROLLS TO PRESSING HANDLES': 0.10
};

export const overageRate = (batchType) => num(PRODUCTION_OVERAGE[batchType]) || 0;

// Note this lifts the whole requirement, including any part met from finished
// godown stock — ready stock carries no misprint risk, so if that matters the
// allowance should be split out to the roll-produced share only.
const withOverage = (batchType, qty) => qty * (1 + overageRate(batchType));

// Pieces per bundle, by output item type — how the godown counts that form
// (mirrors InventoryView). Sheets and bags are counted one at a time.
export const PIECES_PER_BUNDLE = {
    'SIDEPATTY': 50, 'BOTTOMPATTY': 50,
    'HANDLE': 100, 'PRESSING HANDLE': 100
};

const matchesCombination = (combination, so) =>
    Object.entries(combination).every(([field, want]) => {
        const have = norm(so[field]);
        if (want === '*') return have !== '';
        if (Array.isArray(want)) return want.some((w) => norm(w) === have);
        return norm(want) === have;
    });

// The rule that governs a sub-order, or null when none matches.
export const requirementRule = (so) => OUTPUT_REQUIREMENTS.find((r) => matchesCombination(r.combination, so)) || null;

// How many `outputType` items one bag of this sub-order needs. null when the
// sub-order matches no rule, or its rule does not use that item at all.
export const perBagRequirement = (so, outputType) => {
    const rule = requirementRule(so);
    if (!rule) return null;
    const key = Object.keys(rule.requirements).find((k) => norm(k) === norm(outputType));
    return key === undefined ? null : num(rule.requirements[key]);
};

// Types counted in bundles/pieces rather than kg (mirrors the Grist
// Planned_Count_Bundles_ formula). Side/bottom patty are cut from raw rolls and
// allocated in kg (see below), so only the handle types are piece-counted.
const isPieceType = (batchType) =>
    batchType === 'ROLLS TO HANDLES' ||
    batchType === 'ROLLS TO PRESSING HANDLES';

// --- Roll-width matching ---
// Some batch types are produced by cutting a roll of a fixed width. A sub-order's
// required roll width is derived from its output geometry (sheet size / bag
// height) and matched to one of these fixed widths — exactly, or the next larger.
const ROLL_WIDTHS_SHEETS = [13, 15, 16, 17, 19];
const ROLL_WIDTHS_DCUT = [27, 32, 36, 42, 45];   // DCUT-model bags
const ROLL_WIDTHS_DCUT_HANDLE = [36, 38, 42];    // HANDLE-model bags (in a DCUT batch)
const ROLL_WIDTHS_SIDEPATTY = [8, 10, 12];       // side-patty strips
const ROLL_WIDTHS_BOTTOMPATTY = [13, 17, 18];    // bottom-patty strips (PRINTED)

// Largest roll width in `widths` that is an exact whole-number multiple of the
// patty strip width (so the roll cuts into strips with no width waste); null when
// none qualifies.
const exactMultipleRollWidth = (stripWidth, widths) => {
    if (!(stripWidth > 0)) return null;
    const multiples = widths.filter((w) => {
        const n = w / stripWidth;
        return n >= 1 && Math.abs(n - Math.round(n)) < 1e-6;
    });
    return multiples.length ? Math.max(...multiples) : null;
};

// Side/bottom patty geometry for a sub-order, or null when required info is
// missing (so the caller can flag it). A PRINTED side patty is really a bottom
// patty: 0.5″ narrower, length = bag width, 110 GSM, cut from the bottom-patty
// roll set. A plain side patty uses its given width, a length that wraps the bag
// (width + 2×(height+1)), its own GSM, and the side-patty roll set.
export const pattyDims = (so) => {
    const sw = num(so.Sidepatty_Width);
    if (!sw) return null;                                   // no strip width -> flag
    const bw = num(so.Bag_Width);
    if (norm(so.Sidepatty_Colour) === 'PRINTED') {
        if (!bw) return null;                              // need bag width for length
        // Bottom patties and the sheets they are cut from are 90 GSM NW REGULAR
        // throughout the catalogue -- nothing is stocked at 110.
        return { kind: 'BOTTOMPATTY', width: sw - 0.5, length: bw, gsm: '90', rolls: ROLL_WIDTHS_BOTTOMPATTY };
    }
    const bh = num(so.Bag_Height), gsm = num(so.Sidepatty_GSM);
    if (!bw || !bh || !gsm) return null;                  // need bag dims + GSM
    return { kind: 'SIDEPATTY', width: sw, length: bw + (bh + 1) * 2, gsm: String(gsm), rolls: ROLL_WIDTHS_SIDEPATTY };
};

// A printed side patty is really a bottom patty, and those are cut from a sheet
// rather than strip by strip. The sheet is as wide as the roll it comes off and as
// long as the bag is wide, and it divides into whole strips across its width --
// 18" / 4.5" = 4 strips, 13" / 6.5" = 2, 17" / 8.5" = 2, matching the floor's
// cutting table. Returns null when the sub-order cannot be sized, or when no roll
// width is an exact multiple of the strip.
export const bottomSheetDims = (so) => {
    const d = pattyDims(so);
    if (!d || d.kind !== 'BOTTOMPATTY') return null;
    const rollWidth = exactMultipleRollWidth(d.width, d.rolls);
    if (!rollWidth) return null;
    const piecesPerSheet = Math.round(rollWidth / d.width);
    if (!(piecesPerSheet >= 1)) return null;
    // Sheet stock is catalogued smaller x bigger, like every other item size.
    const [sheetW, sheetH] = [Math.min(rollWidth, d.length), Math.max(rollWidth, d.length)];
    return {
        stripWidth: d.width,        // the finished bottom patty's width
        stripLength: d.length,      // ... which is the bag's width
        rollWidth,
        piecesPerSheet,
        sheetW,
        sheetH,
        gsm: d.gsm
    };
};

// Sheets a sub-order needs: one bottom patty per bag, divided by what a sheet
// yields. Null when the geometry does not resolve.
export const bottomSheetCount = (so) => {
    const dims = bottomSheetDims(so);
    const bags = bagPieces(so);
    if (!dims || bags == null) return null;
    const perBag = perBagRequirement(so, 'BOTTOMPATTY') ?? 1;
    return (bags * perBag) / dims.piecesPerSheet;
};

// The roll width a patty sub-order needs (exact multiple of its strip width), or
// null when its info is missing or no roll width in the set is an exact multiple.
export const pattyRollWidth = (so) => {
    const d = pattyDims(so);
    return d ? exactMultipleRollWidth(d.width, d.rolls) : null;
};

// Batch types whose sub-orders are grouped — and matched to rolls — by roll width
// rather than by output size. One job then represents one physical roll width.
export const ROLL_WIDTH_TYPES = new Set(['ROLLS TO SHEETS', 'ROLLS TO MODEL SHEETS', 'ROLLS TO DCUT']);

// Both sheet batches cut the same way (sheet geometry -> ROLL_WIDTHS_SHEETS) and
// differ only in what the finished sheet is stocked as; see isModelNumberSheet.
export const SHEET_TYPES = new Set(['ROLLS TO SHEETS', 'ROLLS TO MODEL SHEETS']);

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
    if (SHEET_TYPES.has(batchType)) {
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

// --- Quantity normalisation (pieces -> kg) ---
// Weight-based batches allocate against roll/finished stock measured in kg, but a
// STITCHING sheet sub-order's Quantity is often a piece COUNT, not kg
// (Quantity_Type = 'PIECES'). Convert it to kg from the sheet geometry so the
// numbers are comparable. Mass of one sheet (kg) = L(in) * W(in) * GSM /
// (1550 * 1000) — 1550 in² = 1 m², so this divisor is the in²->kg constant
// (the formula's "yards" label is trade shorthand; the dims are inches). Total
// kg = piece count * per-sheet mass.
const PIECE_TO_KG_DIVISOR = 1550 * 1000;

const sheetPiecesToKg = (batchType, so) => {
    const dims = parseSheetSize(so.Sheet_Size);
    const gsm = num(so.Bag_GSM);
    if (!dims || !gsm) return null;        // geometry missing -> can't convert
    // A bag is not one sheet: OUTPUT_REQUIREMENTS says how many it takes (a
    // stitching bag needs a front and a back, unless the sheet is cut double), and
    // the roll must cover all of them.
    const perBag = sheetsPerBag(so, OUTPUT_TYPE[batchType]) ?? 1;
    const [w, h] = dims;
    return num(so.Quantity) * perBag * (w * h * gsm) / PIECE_TO_KG_DIVISOR;
};

// How many bag faces come off one sheet. A face is the bag's width by its height
// plus an inch for stitching, and the sheet is filled with as many as fit, either
// way round. This is what decides how many sheets a bag takes:
//   16x19 sheet, 16x18 bag -> 1 face  -> two sheets per bag, front and back
//   20x15 sheet, 10x14 bag -> 2 faces -> one sheet covers both faces
//   16x22 sheet,  8x10 bag -> 4 faces -> one sheet makes two whole bags
// The last is what the multicolour machine is fed, but nothing here depends on
// the print type: the sheet size says how many bags come off it.
export const facesPerSheet = (so) => {
    const dims = parseSheetSize(so.Sheet_Size);
    const bw = num(so.Bag_Width), bh = num(so.Bag_Height);
    if (!dims || !bw || !bh) return 1;
    const faceW = bw, faceH = bh + 1;
    const fit = (sw, sh) => Math.floor((sw + 1e-6) / faceW) * Math.floor((sh + 1e-6) / faceH);
    return Math.max(1, fit(dims[0], dims[1]), fit(dims[1], dims[0]));
};

// Sheets one bag needs: the faces the bill of materials calls for, divided by the
// faces a sheet yields. A requirement below two is a plain sheet order rather than
// a two-sided bag, and is left alone.
export const sheetsPerBag = (so, outputType) => {
    const configured = perBagRequirement(so, outputType);
    if (configured == null) return null;
    if (configured < 2) return configured;
    return configured / facesPerSheet(so);
};

// A STITCHING order quoted in pieces feeds a kg-based sheet batch only after a
// pieces -> kg conversion from sheet geometry. Side/bottom patty are kg-based too
// but convert from their own strip geometry (pattyKg), so they're excluded here.
export const needsPieceConversion = (batchType, so) =>
    !isPieceType(batchType) &&
    batchType !== 'ROLLS TO SIDEPATTY' &&
    norm(so.Model) === 'STITCHING' &&
    norm(so.Quantity_Type) === 'PIECES';

// True when a sub-order needs the pieces -> kg conversion but can't be converted
// because its Bag_GSM (or sheet geometry) is missing — surfaced to the operator
// rather than silently mis-allocated.
export const cannotConvertQty = (batchType, so) =>
    needsPieceConversion(batchType, so) && sheetPiecesToKg(batchType, so) == null;

// --- Piece-batch quantities: bags → finished pieces → bundles ---
// Handles are produced per finished bag and stocked in fixed-size bundles, so a
// handle sub-order's requirement is (bags * 2) / bundle-size.
export const BUNDLE_SIZE = {
    'ROLLS TO HANDLES': 100,
    'ROLLS TO PRESSING HANDLES': 100
};
const PIECES_PER_BAG = {
    'ROLLS TO HANDLES': 2,
    'ROLLS TO PRESSING HANDLES': 2
};

// Number of finished bags a piece-type sub-order covers. HANDLE-model orders quote
// the total cloth weight (kg); back the count out from one bag's flat-cloth mass —
// the piece is Bag_Width × (Bag_Height*2 + 2)″ (the HANDLE-bag layout, matching the
// +2″ roll-width allowance). Everything else quotes the bag-piece count directly.
// Returns null when a weight order lacks the geometry to size it.
const bagPieces = (so) => {
    if (norm(so.Model) === 'HANDLE') {
        const w = num(so.Bag_Width), h = num(so.Bag_Height), gsm = num(so.Bag_GSM);
        if (!w || !h || !gsm) return null;
        const massPerPiece = (w * (h * 2 + 2) * gsm) / PIECE_TO_KG_DIVISOR;
        return massPerPiece > 0 ? num(so.Quantity) / massPerPiece : null;
    }
    return num(so.Quantity);
};

// A handle order that can't be sized (a weight order missing bag geometry).
export const cannotSizePieces = (batchType, so) =>
    isPieceType(batchType) && bagPieces(so) == null;

// The exact fields a flagged sub-order is missing, so the operator is told which
// cell to fill rather than a generic list. Returns [] when nothing is missing.
export const missingInfoFields = (batchType, so) => {
    const gone = [];
    if (SHEET_TYPES.has(batchType) && needsPieceConversion(batchType, so)) {
        // Sheet size is entered per sub-order (it is not the bag size — it carries
        // its own stitching/gusset allowance), and is what pieces -> kg needs.
        if (!parseSheetSize(so.Sheet_Size)) gone.push('sheet size');
        if (!num(so.Bag_GSM)) gone.push('bag GSM');
    }
    if (isPieceType(batchType) && bagPieces(so) == null) {
        if (!num(so.Bag_Width)) gone.push('bag width');
        if (!num(so.Bag_Height)) gone.push('bag height');
        if (!num(so.Bag_GSM)) gone.push('bag GSM');
    }
    if (batchType === 'ROLLS TO SIDEPATTY' && pattyDims(so) == null) {
        const printed = norm(so.Sidepatty_Colour) === 'PRINTED';
        if (!num(so.Sidepatty_Width)) gone.push('side-patty width');
        if (!num(so.Bag_Width)) gone.push('bag width');
        if (!printed) {
            if (!num(so.Bag_Height)) gone.push('bag height');
            if (!num(so.Sidepatty_GSM)) gone.push('side-patty GSM');
        }
    }
    return [...new Set(gone)];
};

// A patty order missing the info needed to size it (strip width, bag dims, GSM).
export const cannotSizePatty = (batchType, so) =>
    (batchType === 'ROLLS TO SIDEPATTY' && pattyDims(so) == null)
    || (batchType === 'ROLLS TO BOTTOMPATTY SHEETS' && bottomSheetCount(so) == null);

// Kg of roll a patty sub-order consumes: one gusset per bag, each strip weighing
// width × length × GSM / 1,550,000 kg. A roll of the chosen multiple width cuts
// into whole strips with no width waste, so roll kg needed == total strip kg.
const pattyKg = (so) => {
    const d = pattyDims(so);
    const bags = bagPieces(so);
    if (!d || bags == null) return 0;
    const perBag = perBagRequirement(so, d.kind) ?? 1;
    return bags * perBag * (d.width * d.length * num(d.gsm)) / PIECE_TO_KG_DIVISOR;
};

// --- Output counts: how many finished items a group actually needs ---
// Planning is done in kg (or bundles), but the floor thinks in pieces. The counts
// come from OUTPUT_REQUIREMENTS (items per bag) and PIECES_PER_BUNDLE (how the
// godown counts that form).
export const OUTPUT_COUNT_UNIT = {
    'ROLLS TO SHEETS': 'sheets',
    'ROLLS TO MODEL SHEETS': 'sheets',
    'ROLLS TO DCUT': 'bags',
    'ROLLS TO UCUT': 'bags',
    'ROLLS TO WCUT': 'bags',
    'ROLLS TO SIDEPATTY': 'bundles',
    'ROLLS TO BOTTOMPATTY SHEETS': 'sheets',
    'ROLLS TO HANDLES': 'bundles',
    'ROLLS TO PRESSING HANDLES': 'bundles'
};

// Cloth mass of ONE finished bag, used to back a bag count out of a weight-quoted
// order. Sheet batches multiply the sheet by however many the bag needs; cut bags
// use their flat blank. null when the geometry is missing.
const bagClothKg = (batchType, so) => {
    if (SHEET_TYPES.has(batchType)) {
        const dims = parseSheetSize(so.Sheet_Size);
        const gsm = num(so.Bag_GSM);
        const perBag = sheetsPerBag(so, OUTPUT_TYPE[batchType]);
        if (!dims || !gsm || !perBag) return null;
        return perBag * (dims[0] * dims[1] * gsm) / PIECE_TO_KG_DIVISOR;
    }
    if (batchType === 'ROLLS TO DCUT') {
        const w = num(so.Bag_Width), h = num(so.Bag_Height), gsm = num(so.Bag_GSM);
        if (!w || !h || !gsm) return null;
        // Flat blank = bag width × (both faces + the same allowance the roll-width
        // match uses): +2″ for a HANDLE bag, +4″ for a D-cut.
        const flat = norm(so.Model) === 'HANDLE' ? h * 2 + 2 : h * 2 + 4;
        return (w * flat * gsm) / PIECE_TO_KG_DIVISOR;
    }
    return null;
};

// Finished bags a sub-order covers: piece-quoted orders state it, weight-quoted
// ones are divided by one bag's cloth.
const bagCount = (batchType, so) => {
    if (norm(so.Quantity_Type) === 'PIECES') return num(so.Quantity);
    const per = bagClothKg(batchType, so);
    if (per > 0) return num(so.Quantity) / per;
    return bagPieces(so);          // HANDLE-model weight orders size themselves
};

// Finished items a sub-order needs, in the unit its output form is stocked in:
// bags × the per-bag requirement, divided into bundles where the godown counts in
// bundles. Returns { count, exact } — `exact` is false when the bag count had to
// be backed out of a weight-quoted order — or null when it can't be derived.
export const outputCount = (batchType, so) => {
    // Bottom-patty sheets are counted from the cutting geometry -- so many strips
    // to a sheet -- rather than by a per-bag requirement.
    if (batchType === 'ROLLS TO BOTTOMPATTY SHEETS') {
        const sheets = bottomSheetCount(so);
        if (sheets == null) return null;
        return {
            count: withOverage(batchType, sheets),
            exact: norm(so.Model) !== 'HANDLE'
        };
    }
    const outType = outputTypeFor(batchType, so);
    const perBag = SHEET_TYPES.has(batchType)
        ? sheetsPerBag(so, outType)
        : perBagRequirement(so, outType);
    if (perBag == null) return null;
    const bags = bagCount(batchType, so);
    if (bags == null) return null;
    const perBundle = PIECES_PER_BUNDLE[norm(outType)] || 1;
    return {
        count: withOverage(batchType, (bags * perBag) / perBundle),
        exact: norm(so.Quantity_Type) === 'PIECES'
    };
};

// Roll the per-sub-order counts up to a group: the total, whether every part of it
// is exact, and how many sub-orders could not be counted at all.
export const groupOutputCount = (batchType, subOrders) => {
    let count = 0, exact = true, unknown = 0;
    for (const so of subOrders) {
        const c = outputCount(batchType, so);
        if (!c) { unknown += 1; exact = false; continue; }
        count += c.count;
        if (!c.exact) exact = false;
    }
    return { count, exact, unknown, unit: OUTPUT_COUNT_UNIT[batchType] || 'pieces' };
};

// The quantity a sub-order contributes to its group's requirement, in the unit the
// batch allocates in (bundles for handle batches, kg otherwise). Side/bottom patty
// convert their strip geometry to kg; a STITCHING sheet order quoted in pieces is
// converted to kg; everything else as-is.
export const effectiveQty = (batchType, so) => withOverage(batchType, orderedQty(batchType, so));

// What the orders themselves call for, before any production allowance.
const orderedQty = (batchType, so) => {
    if (isPieceType(batchType)) {
        const bags = bagPieces(so);
        if (bags == null) return 0;   // un-sizable -> flagged, contributes nothing
        const perBag = perBagRequirement(so, OUTPUT_TYPE[batchType]) ?? PIECES_PER_BAG[batchType];
        return (bags * perBag) / BUNDLE_SIZE[batchType];
    }
    if (batchType === 'ROLLS TO SIDEPATTY') return pattyKg(so);
    if (batchType === 'ROLLS TO BOTTOMPATTY SHEETS') {
        const dims = bottomSheetDims(so);
        const sheets = bottomSheetCount(so);
        if (!dims || sheets == null) return 0;   // un-sizable -> flagged, contributes nothing
        return sheets * (dims.sheetW * dims.sheetH * num(dims.gsm)) / PIECE_TO_KG_DIVISOR;
    }
    if (needsPieceConversion(batchType, so)) {
        const kg = sheetPiecesToKg(batchType, so);
        if (kg != null) return kg;
    }
    return num(so.Quantity);
};

// --- Qualification: does this sub-order need the chosen output? ---
// Centralised so the factory's real rules are a one-place edit. A sub-order can
// satisfy several types (e.g. a STITCHING bag needs a body AND a side-patty).
// A model-number sheet: a non-woven stitching bag printed with the customer's
// model number. It cuts exactly like a plain sheet, but the finished sheet is
// stocked as MODEL NUMBER SHEET (one item code per model), so these sub-orders
// go to ROLLS TO MODEL SHEETS *instead of* ROLLS TO SHEETS, never both.
export const isModelNumberSheet = (so) =>
    norm(so.Material) === 'NON-WOVEN' &&
    norm(so.Model) === 'STITCHING' &&
    norm(so.Print) === 'MODEL NUMBER';

export const typeNeedsSubOrder = (batchType, so) => {
    const model = norm(so.Model);
    switch (batchType) {
        case 'ROLLS TO DCUT': return model === 'DCUT' || model === 'HANDLE';
        case 'ROLLS TO UCUT': return model === 'UCUT';
        case 'ROLLS TO HANDLES': return model === 'STITCHING';
        case 'ROLLS TO PRESSING HANDLES': return model === 'HANDLE';
        case 'ROLLS TO SHEETS': return (model === 'STITCHING' || model === 'PLAIN') && !isModelNumberSheet(so);
        case 'ROLLS TO MODEL SHEETS': return isModelNumberSheet(so);
        // ROLLS TO SIDEPATTY makes the bag's single gusset: a side patty, or a
        // bottom patty when the side patty is PRINTED. Either way needs a width.
        case 'ROLLS TO SIDEPATTY':
            return isSet(so.Sidepatty_Width);
        // A printed side patty is a bottom patty, and those come off a sheet.
        case 'ROLLS TO BOTTOMPATTY SHEETS':
            return isSet(so.Sidepatty_Width) && norm(so.Sidepatty_Colour) === 'PRINTED';
        default: return false;
    }
};

// The attributes that define a group / item-code. For side-patty batches the
// relevant colour/gsm/width live on the Sidepatty_* fields, otherwise the Bag_*
// fields. Material always comes from Roll_Material.
export const groupAttrs = (batchType, so) => {
    if (batchType === 'ROLLS TO SIDEPATTY') {
        // Group / output identity is the finished patty (its strip width + GSM +
        // colour). `rollWidth` is the raw roll the job cuts from (a multiple of the
        // strip width) — matched against stock separately from the output width.
        const d = pattyDims(so);
        const printed = norm(so.Sidepatty_Colour) === 'PRINTED';
        return {
            material: 'NW REGULAR',
            colour: (printed ? so.Handle_Colour : so.Sidepatty_Colour) || '',
            gsm: d ? d.gsm : (printed ? '110' : (so.Sidepatty_GSM || '')),
            width: d ? String(d.width) : '',
            rollWidth: d ? String(exactMultipleRollWidth(d.width, d.rolls) ?? '') : ''
        };
    }
    // Both handle types are fixed-spec: NW REGULAR, 90 GSM rolls, 2″ wide. Only the
    // length differs — normal handle 13″, pressing handle 14.5″ — and colour varies.
    if (batchType === 'ROLLS TO HANDLES' || batchType === 'ROLLS TO PRESSING HANDLES') {
        return {
            material: 'NW REGULAR',
            colour: so.Handle_Colour || so.Sidepatty_Colour || '',
            gsm: '90',
            width: '2',
            height: batchType === 'ROLLS TO PRESSING HANDLES' ? '14.5' : '13'
        };
    }
    // Bottom-patty sheets are grouped by the roll they are cut from, and stocked at
    // their own sheet size. The patty is printed to match the bag's handle, so the
    // handle colour is the sheet's colour.
    if (batchType === 'ROLLS TO BOTTOMPATTY SHEETS') {
        const dims = bottomSheetDims(so);
        return {
            material: 'NW REGULAR',
            colour: so.Handle_Colour || so.Sidepatty_Colour || '',
            gsm: dims ? dims.gsm : '110',
            width: dims ? String(dims.rollWidth) : '',
            finishedWidth: dims ? String(dims.sheetW) : '',
            finishedHeight: dims ? String(dims.sheetH) : ''
        };
    }

    // A model-number sheet is stocked under the customer's model number, which the
    // sub-order carries in Bag_Colour (e.g. K10), so finished stock is searched for
    // on that. Nothing is printed with a model number on a coloured roll: the raw
    // material is plain white NW VIRGIN, cut to the width the sheet size needs.
    if (batchType === 'ROLLS TO MODEL SHEETS') {
        const rw = requiredRollWidth(batchType, so);
        const dims = parseSheetSize(so.Sheet_Size);
        const [sheetW, sheetH] = dims ? [Math.min(...dims), Math.max(...dims)] : ['', ''];
        return {
            material: 'NW VIRGIN',
            colour: so.Bag_Colour || '',          // the model number
            gsm: so.Bag_GSM || '',
            width: typeof rw === 'number' ? String(rw) : '',
            // Ready model sheets are held at their own size, not the roll's.
            finishedWidth: String(sheetW),
            finishedHeight: String(sheetH),
            // The roll behind them is always plain white.
            rollColour: 'WHITE',
            // Failing ready model sheets, a plain white sheet of the same size can
            // be printed into one. Either sheet type will do -- what matters is
            // that it is white NW VIRGIN and the right size.
            blank: {
                types: ['SHEET', 'MODEL NUMBER SHEET'],
                material: 'NW VIRGIN',
                colour: 'WHITE',
                gsm: so.Bag_GSM || '',
                width: String(sheetW),
                height: String(sheetH)
            }
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
export const outputTypeFor = (batchType, so) => {
    if (batchType === 'ROLLS TO DCUT') return norm(so.Model) === 'HANDLE' ? 'HANDLE BAG' : 'DCUT BAG';
    // A ROLLS TO SIDEPATTY job yields a bottom patty when the side patty is PRINTED,
    // otherwise a side patty (one gusset per bag). PRINTED / non-PRINTED orders land
    // in separate groups, so each job is homogeneous.
    if (batchType === 'ROLLS TO SIDEPATTY') return norm(so.Sidepatty_Colour) === 'PRINTED' ? 'BOTTOMPATTY' : 'SIDEPATTY';
    return OUTPUT_TYPE[batchType];
};

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
// Finished output and the rolls it is cut from usually share the group's
// attributes, but not always: a model-number sheet is stocked under the customer's
// model (its "colour") while the roll it comes from is plain white NW VIRGIN. The
// group therefore carries optional finished*/roll* overrides, and each side is
// matched against its own specification.
const matchesSpec = (r, spec) => {
    const wantMat = MATERIAL_MAP[norm(spec.material)] || null;
    return (wantMat ? norm(r.material) === norm(wantMat) : false)
        && norm(r.colour) === norm(spec.colour)
        && norm(r.gsm) === norm(spec.gsm)
        && (spec.width == null || norm(r.width) === norm(spec.width))
        // Height only where the group asks for it: two model sheets can share a
        // width (16x18 and 16x19) and are different stock.
        && (!isSet(spec.height) || norm(r.height) === norm(spec.height));
};

const relevantStock = (attrs, inventory, batchType, outputType) => {
    const availOf = (r) => (isPieceType(batchType) ? num(r.availBundles) : num(r.availWeight));
    const outType = norm(outputType || OUTPUT_TYPE[batchType]);

    // Finished stock must match the output width too (a 16" sheet ≠ a 32" sheet).
    // Rolls: roll-width types match the group width (which IS the roll width);
    // side/bottom patty match a separate roll width (a multiple of the strip width)
    // carried on attrs.rollWidth; other types cut down wide rolls, so width is free.
    const requireRollWidth = ROLL_WIDTH_TYPES.has(batchType);
    const rollWidthWanted = isSet(attrs.rollWidth) ? attrs.rollWidth : (requireRollWidth ? attrs.width : null);

    const finishedSpec = {
        material: attrs.finishedMaterial ?? attrs.material,
        colour: attrs.finishedColour ?? attrs.colour,
        gsm: attrs.finishedGsm ?? attrs.gsm,
        width: attrs.finishedWidth ?? attrs.width,
        height: attrs.finishedHeight
    };
    const rollSpec = {
        material: attrs.rollMaterial ?? attrs.material,
        colour: attrs.rollColour ?? attrs.colour,
        gsm: attrs.rollGsm ?? attrs.gsm,
        width: rollWidthWanted
    };

    const finished = inventory
        .filter((r) => norm(r.type) === outType && matchesSpec(r, finishedSpec) && availOf(r) > 0)
        .map((r) => ({ ...r, avail: availOf(r) }))
        .sort((a, b) => b.avail - a.avail);
    // Blanks: stock that is already cut to size but not yet the finished article --
    // a plain white sheet a model number can still be printed onto. Only groups
    // that define one look for them.
    const blank = attrs.blank;
    const blankTypes = new Set((blank?.types || []).map(norm));
    const alternates = blank
        ? inventory
            .filter((r) => blankTypes.has(norm(r.type)) && matchesSpec(r, blank) && availOf(r) > 0)
            .map((r) => ({ ...r, avail: availOf(r) }))
            .sort((a, b) => b.avail - a.avail)
        : [];
    const rolls = inventory
        .filter((r) => norm(r.type) === 'ROLL' && matchesSpec(r, rollSpec) && availOf(r) > 0)
        .map((r) => ({ ...r, avail: availOf(r) }))
        .sort((a, b) => b.avail - a.avail);

    return { finished, alternates, rolls };
};

// Greedily take from a list of stock rows up to `need`. Returns the picks (with
// the amount taken and their `source`) and how much was covered. `source` is
// 'roll' (raw stock that must be produced) or 'finished' (ready output pulled
// from the godown) so the caller can split production output from finished stock.
const takeFrom = (stock, need, source) => {
    const picks = [];
    let covered = 0;
    for (const s of stock) {
        if (covered >= need) break;
        const take = Math.min(s.avail, need - covered);
        if (take > 0) { picks.push({ itemId: s.itemId, codeId: s.codeId, take, source }); covered += take; }
    }
    return { picks, covered };
};

// Split sub-orders (oldest first) into the prefix that fits within `capacity`
// and the remainder that must be postponed.
const splitByCapacity = (batchType, subOrders, capacity) => {
    const sorted = [...subOrders].sort(
        (a, b) => num(a.Factory_Updated_Date) - num(b.Factory_Updated_Date) || a.id - b.id
    );
    const fulfilled = [];
    const postponed = [];
    let used = 0;
    for (const so of sorted) {
        const qty = effectiveQty(batchType, so);
        if (used + qty <= capacity + 1e-6) { fulfilled.push(so); used += qty; }
        else postponed.push(so);
    }
    return { fulfilled, postponed };
};

// Run the 5-priority ladder for one group. Returns the allocation describing the
// job to create (if any) and which sub-orders are postponed.
export const allocateStock = (attrs, subOrders, inventory, batchType, outputType) => {
    const required = subOrders.reduce((s, so) => s + effectiveQty(batchType, so), 0);
    const { finished, alternates, rolls } = relevantStock(attrs, inventory, batchType, outputType);
    const finishedTotal = finished.reduce((s, r) => s + r.avail, 0);
    const rollsTotal = rolls.reduce((s, r) => s + r.avail, 0);

    // Model sheets are printed for one customer's model and are no use to anyone
    // else, so whatever is in the godown is always drawn on first and the rolls
    // only make up the shortfall. Every other type prefers to cut from a roll when
    // a roll can cover the lot.
    if (batchType === 'ROLLS TO MODEL SHEETS' && required > 0) {
        // Sheets already printed with this model come first; then plain white
        // sheets of the same size, which only need printing; and a roll is cut
        // only for whatever neither of those covers.
        const fromFinished = takeFrom(finished, Math.min(required, finishedTotal), 'finished');
        let shortfall = required - fromFinished.covered;
        const alternatesTotal = alternates.reduce((s, r) => s + r.avail, 0);
        const fromBlanks = shortfall > 0
            ? takeFrom(alternates, Math.min(shortfall, alternatesTotal), 'blank')
            : { picks: [], covered: 0 };
        shortfall -= fromBlanks.covered;
        const fromRolls = shortfall > 0 ? takeFrom(rolls, shortfall, 'roll') : { picks: [], covered: 0 };
        const covered = fromFinished.covered + fromBlanks.covered + fromRolls.covered;
        const picks = [...fromFinished.picks, ...fromBlanks.picks, ...fromRolls.picks];
        if (covered >= required) {
            return {
                // 1 when the godown covered it outright, 2 when only rolls were
                // used, 3 when it took a mix.
                priority: fromRolls.covered === 0
                    ? 1
                    : (fromFinished.covered + fromBlanks.covered) === 0 ? 2 : 3,
                picks,
                fulfilledQty: required,
                fulfilled: subOrders,
                postponed: []
            };
        }
        const { fulfilled, postponed } = splitByCapacity(batchType, subOrders, covered);
        if (fulfilled.length === 0) {
            return { priority: 5, picks: [], fulfilledQty: 0, fulfilled: [], postponed: subOrders };
        }
        return {
            priority: 4,
            picks,
            fulfilledQty: fulfilled.reduce((s, so) => s + effectiveQty(batchType, so), 0),
            fulfilled,
            postponed
        };
    }

    // Priority 1 — finished/semi stock covers the whole requirement.
    if (finishedTotal >= required && required > 0) {
        const { picks } = takeFrom(finished, required, 'finished');
        return { priority: 1, picks, fulfilledQty: required, fulfilled: subOrders, postponed: [] };
    }
    // Priority 2 — a raw roll (or rolls) covers the whole requirement.
    if (rollsTotal >= required && required > 0) {
        const { picks } = takeFrom(rolls, required, 'roll');
        return { priority: 2, picks, fulfilledQty: required, fulfilled: subOrders, postponed: [] };
    }
    // Priority 3 — mix: rolls take the major share, finished covers the rest.
    if (rollsTotal > 0 && rollsTotal + finishedTotal >= required && required > 0) {
        const fromRolls = takeFrom(rolls, required, 'roll');
        const fromFinished = takeFrom(finished, required - fromRolls.covered, 'finished');
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
        const fromRolls = takeFrom(rolls, capacity, 'roll');
        const fromFinished = takeFrom(finished, capacity - fromRolls.covered, 'finished');
        const { fulfilled, postponed } = splitByCapacity(batchType, subOrders, capacity);
        if (fulfilled.length > 0) {
            const fulfilledQty = fulfilled.reduce((s, so) => s + effectiveQty(batchType, so), 0);
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
    const missingGsm = [];   // STITCHING pieces orders with no Bag_GSM -> can't convert to kg
    const groupable = [];
    for (const so of eligible) {
        // A pieces-quoted order with no GSM (or a patty missing strip width / bag
        // dims / GSM) can't be sized; flag it rather than grouping a zero quantity.
        if (cannotConvertQty(batchType, so) || cannotSizePieces(batchType, so) || cannotSizePatty(batchType, so)) { missingGsm.push(so); continue; }
        // Side/bottom patty need a roll width that is an exact multiple of the strip
        // width; flag orders no fixed roll width can satisfy.
        if (batchType === 'ROLLS TO SIDEPATTY') {
            if (pattyRollWidth(so) == null) { unmatched.push(so); continue; }
            groupable.push(so);
            continue;
        }
        if (batchType === 'ROLLS TO BOTTOMPATTY SHEETS') {
            if (bottomSheetDims(so) == null) { unmatched.push(so); continue; }
            groupable.push(so);
            continue;
        }
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
        .map((g) => ({
            ...g,
            requiredQty: g.subOrders.reduce((s, so) => s + effectiveQty(batchType, so), 0),
            // What the floor has to turn out for this group, in whole items.
            requiredCount: groupOutputCount(batchType, g.subOrders)
        }))
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
            // Split the fulfilled requirement into what is produced from raw rolls
            // (the planned output) vs. what is pulled ready from finished godown
            // stock — finished stock is netted off the output to produce.
            const rollTaken = alloc.picks.reduce((s, p) => s + (p.source === 'roll' ? p.take : 0), 0);
            const outputQty = Math.min(rollTaken, alloc.fulfilledQty);
            const finishedQty = Math.max(alloc.fulfilledQty - outputQty, 0);
            return {
                ...g,
                rollWidth: usesRollWidth ? num(g.attrs.width) : null,
                rollCodeId,
                matchedCodeId: usesRollWidth ? rollCodeId
                    : softMatchItemCode(g.attrs, itemCodes, batchType, outputTypeFor(batchType, g.subOrders[0])),
                ...alloc,
                outputQty,
                finishedQty
            };
        });

    const postponedCount = groups.reduce((s, g) => s + g.postponed.length, 0);
    const totalPlannedQty = groups.reduce((s, g) => s + g.fulfilledQty, 0);
    const totalFinishedQty = groups.reduce((s, g) => s + g.finishedQty, 0);
    const totalOutputQty = groups.reduce((s, g) => s + g.outputQty, 0);
    const jobCount = groups.filter((g) => g.fulfilled.length > 0).length;
    // Batch-wide output requirement in items, summed from the groups.
    const totalRequiredCount = {
        count: groups.reduce((s, g) => s + g.requiredCount.count, 0),
        exact: groups.every((g) => g.requiredCount.exact),
        unknown: groups.reduce((s, g) => s + g.requiredCount.unknown, 0),
        unit: OUTPUT_COUNT_UNIT[batchType] || 'pieces'
    };

    return {
        groups, postponedCount, totalPlannedQty, totalFinishedQty, totalOutputQty, jobCount,
        totalRequiredCount,
        isPieces: isPieceType(batchType),
        unmatched, unmatchedCount: unmatched.length,
        missingGsm, missingGsmCount: missingGsm.length
    };
};
