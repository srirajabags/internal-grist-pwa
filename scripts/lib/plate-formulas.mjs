// Grist formulas shared by scripts/create-printing-tables.mjs (which defines
// the tables) and scripts/plate-sides.mjs (which switches Printing_Plates.Status
// to it), so the two can never disagree.

// A design's status from its sides (user, 15 Nov 2026). Same rule as
// designStatus in src/domain/printing/plateSets.js -- change both.
export const DESIGN_STATUS_FORMULA = [
    'sides = Plate_Sides.lookupRecords(Design=$id)',
    'if not sides:',
    '  return None',
    'retired = ("DAMAGED", "DISCARDED")',
    'live = [s for s in sides if s.Status not in retired]',
    'if not live:',
    '  return "DISCARDED" if all(s.Status == "DISCARDED" for s in sides) else "DAMAGED"',
    'if set(s.Side_No for s in sides) - set(s.Side_No for s in live):',
    '  return "DAMAGED"',
    'for status in ("NOT FOUND", "TO BE VERIFIED", "ISSUED"):',
    '  if any(s.Status == status for s in live):',
    '    return status',
    'return "IN RACK"'
].join('\n');
