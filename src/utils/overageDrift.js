// The production overage lives in two places: PRODUCTION_OVERAGE here in the app
// (which drives roll allocation and the counts the operator sees) and an OVERAGE
// dict inside the Grist formula for Factory_Production_Jobs.Required_Quantity_Kg_
// (which drives what the job row reports). They have to agree — if they drift, the
// app reserves rolls for one figure while Grist plans another, silently. This
// module reads the live formula and diffs the two.
import { PRODUCTION_OVERAGE } from './productionBatch';

export const OVERAGE_TABLE = 'Factory_Production_Jobs';
export const OVERAGE_COLUMN = 'Required_Quantity_Kg_';

// Grist keeps every column's formula source in its metadata tables, so the check
// reads the real thing rather than a copy that could itself go stale.
export const OVERAGE_FORMULA_SQL = `
    SELECT c.formula AS formula
    FROM _grist_Tables_column c
    JOIN _grist_Tables t ON t.id = c.parentId
    WHERE t.tableId = '${OVERAGE_TABLE}' AND c.colId = '${OVERAGE_COLUMN}'`;

const near = (a, b) => Math.abs(Number(a || 0) - Number(b || 0)) < 1e-9;

// Pull `OVERAGE = { "TYPE": 0.1, ... }` out of the formula source. Returns
// `found: false` when the formula carries no such dict at all, and `applied`
// reports whether it is actually used (a dict nobody multiplies by is inert).
export const parseGristOverage = (formula) => {
    const src = String(formula || '');
    const start = src.search(/OVERAGE\s*=\s*\{/);
    if (start === -1) return { found: false, applied: false, map: {} };
    const open = src.indexOf('{', start);
    let depth = 0, end = -1;
    for (let i = open; i < src.length; i += 1) {
        if (src[i] === '{') depth += 1;
        else if (src[i] === '}') { depth -= 1; if (depth === 0) { end = i; break; } }
    }
    if (end === -1) return { found: false, applied: false, map: {} };
    const body = src.slice(open + 1, end);
    const map = {};
    for (const m of body.matchAll(/["']([^"']+)["']\s*:\s*(-?[\d.]+)/g)) {
        map[m[1].trim().toUpperCase()] = Number(m[2]);
    }
    return { found: true, applied: /OVERAGE\s*\.\s*get\s*\(/.test(src), map };
};

// Every batch type where the two sides disagree, as { batchType, app, grist }.
// A type absent from either side counts as 0 — no allowance.
export const overageDiff = (gristMap) => {
    const keys = [...new Set([...Object.keys(PRODUCTION_OVERAGE), ...Object.keys(gristMap || {})])];
    return keys
        .map((k) => ({
            batchType: k,
            app: Number(PRODUCTION_OVERAGE[k] || 0),
            grist: Number((gristMap || {})[k] || 0)
        }))
        .filter((r) => !near(r.app, r.grist))
        .sort((a, b) => a.batchType.localeCompare(b.batchType));
};

// The dict as the app would write it — only the types that carry an allowance, so
// the line stays short — ready to paste over the one in the Grist formula.
export const gristOverageSnippet = () => {
    const entries = Object.entries(PRODUCTION_OVERAGE)
        .filter(([, v]) => Number(v) > 0)
        .map(([k, v]) => `    "${k}": ${Number(v)}`);
    return entries.length > 0 ? `OVERAGE = {\n${entries.join(',\n')}\n}` : 'OVERAGE = {}';
};

// One call: fetch the formula and report what (if anything) is out of step.
// Returns { ok, checked, diffs, found, applied, error }.
export const checkOverageDrift = async ({ docId, getHeaders, getUrl }) => {
    try {
        const headers = await getHeaders();
        const res = await fetch(getUrl(`/api/docs/${docId}/sql`), {
            method: 'POST',
            headers: { ...headers, 'Content-Type': 'application/json' },
            body: JSON.stringify({ sql: OVERAGE_FORMULA_SQL, args: [] })
        });
        if (!res.ok) throw new Error(res.statusText);
        const data = await res.json();
        const formula = (data.records || [])[0]?.fields?.formula;
        if (formula == null) return { ok: true, checked: false, diffs: [], found: false, applied: false };
        const { found, applied, map } = parseGristOverage(formula);
        const diffs = overageDiff(map);
        // A dict that exists but is never multiplied in is as wrong as a wrong number.
        const ok = diffs.length === 0 && (found ? applied : true);
        return { ok, checked: true, diffs, found, applied };
    } catch (err) {
        // The check is a safety net; never let it take the page down.
        return { ok: true, checked: false, diffs: [], found: false, applied: false, error: err.message || String(err) };
    }
};
