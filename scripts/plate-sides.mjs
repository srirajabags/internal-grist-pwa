#!/usr/bin/env node
// Fills Plate_Sides -- one row per physical plate or stereo of each design
// (user, 15 Nov 2026) -- and, at deploy time, makes it the source of each
// design's status.
//
//   GRIST_API_KEY=xxxx node scripts/plate-sides.mjs [--dry-run]            backfill
//   GRIST_API_KEY=xxxx node scripts/plate-sides.mjs --switch [--dry-run]   backfill, then switch
//
// Backfill (safe at any time, and again later -- it only adds what is missing):
//   - a design with no sides gets one per plate (Plate_Count, 1 when blank),
//     each with the design's status, check and job, and the picture of its
//     place from Printing_Plates.Preview when there is one per plate
//   - a side with no picture takes its place's picture from Preview
//   - while Printing_Plates.Status is still a data column (the app in use
//     writes it), a design changed since its sides were gets its status,
//     check and job copied to them
//
// Switch (with the deploy of the app that reads Plate_Sides, never before --
// the app in use writes the design's Status and would then fail):
//   - Printing_Plates.Status becomes the formula over its sides
//   - Printing_Jobs.Plates and Damaged_Plates point at Plate_Sides (refused
//     unless they are empty, as they are on 15 Nov 2026)
//   - the design columns the sides now hold go (user, 15 Nov 2026: "keep the
//     overlap columns as minimum as possible"): Verified, Verified_At,
//     Verified_By, Issued_To_Job, and Preview -- that last only once every
//     picture in it is on its sides, and the picture job writes the sides
//   - and the sides' look-ups of their design go: Rack_Code, Shop, Expires_On
//
// Needs an owner key, and scripts/create-printing-tables.mjs run first.

import { sideRecords } from '../src/domain/printing/plateSets.js';
import { STATUS } from '../src/domain/printing/printingPlates.js';
import { DESIGN_STATUS_FORMULA } from './lib/plate-formulas.mjs';

const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
if (!KEY) throw new Error('GRIST_API_KEY is required (an owner key).');
const DRY_RUN = process.argv.includes('--dry-run');
const SWITCH = process.argv.includes('--switch');

const api = async (method, path, body) => {
    const res = await fetch(`${BASE}/api/docs/${DOC_ID}${path}`, {
        method, headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${path}: ${res.status} ${text.slice(0, 400)}`);
    return text ? JSON.parse(text) : null;
};
const sql = async (q, args = []) => ((await api('POST', '/sql', { sql: q, args })).records || []).map((r) => r.fields);
const apply = async (actions) => (DRY_RUN || !actions.length ? [] : (await api('POST', '/apply', actions)).retValues);
const applyInChunks = async (actions, label, size = 400) => {
    for (let i = 0; i < actions.length; i += size) {
        await apply(actions.slice(i, i + size));
        console.log(`  ${label}: ${Math.min(i + size, actions.length)}/${actions.length}`);
    }
};
const list = (v) => { try { return (JSON.parse(v || '[]') || []).map(Number).filter(Boolean); } catch { return []; } };
const say = (m) => console.log(`${DRY_RUN ? '[dry run] ' : ''}${m}`);

const isFormula = async (table, colId) => (await sql(`SELECT c.isFormula AS f FROM _grist_Tables_column c
    JOIN _grist_Tables t ON t.id = c.parentId WHERE t.tableId = ? AND c.colId = ?`, [table, colId]))[0]?.f === 1;

// ---- backfill --------------------------------------------------------------------

const statusIsData = !(await isFormula('Printing_Plates', 'Status'));
// After the switch the design no longer has its own check, job or pictures:
// read only the columns still there (a new design's sides start unchecked).
const designHas = new Set((await api('GET', '/tables/Printing_Plates/columns')).columns.map((c) => c.id));
const pick = (col, as) => (designHas.has(col) ? `${col} AS ${as}` : `NULL AS ${as}`);
const designs = await sql(`SELECT id, Plate_Count AS n, ${statusIsData ? 'Status' : 'NULL'} AS status, ${pick('Verified', 'verified')},
    ${pick('Verified_At', 'verified_at')}, ${pick('Verified_By', 'verified_by')}, ${pick('Issued_To_Job', 'job')},
    ${pick('Preview', 'preview')}, Updated_At AS updated_at FROM Printing_Plates`);
const sides = await sql('SELECT id, Design AS design, Side_No AS side_no, Picture AS picture, Updated_At AS updated_at FROM Plate_Sides');
const sidesOf = new Map();
for (const s of sides) {
    if (!sidesOf.has(s.design)) sidesOf.set(s.design, []);
    sidesOf.get(s.design).push(s);
}

// A design's state as its sides start with it.
const stateOf = (d) => ({
    Status: d.status || STATUS.UNVERIFIED,
    Verified: Boolean(d.verified),
    ...(d.verified && d.verified_at ? { Verified_At: d.verified_at } : {}),
    ...(d.verified && d.verified_by ? { Verified_By: d.verified_by } : {}),
    Issued_To_Job: d.job || null
});
// The picture of place `at` (1-based): Preview holds one per plate, in order.
const pictureFor = (d, count, at) => {
    const pics = list(d.preview);
    return pics.length === count ? pics[at - 1] : null;
};

const adds = [];
const pictureFills = [];
const syncs = [];
for (const d of designs) {
    const count = Math.max(1, Number(d.n) || 1);
    const own = sidesOf.get(d.id) || [];
    if (!own.length) {
        for (const fields of sideRecords(d.id, count, stateOf(d))) {
            const pic = pictureFor(d, count, fields.Side_No);
            adds.push(['AddRecord', 'Plate_Sides', null, pic ? { ...fields, Picture: ['L', pic] } : fields]);
        }
        continue;
    }
    for (const s of own) {
        const pic = list(s.picture).length ? null : pictureFor(d, count, s.side_no);
        if (pic) pictureFills.push(['UpdateRecord', 'Plate_Sides', s.id, { Picture: ['L', pic] }]);
    }
    // The app in use still writes the design: a change made there since its
    // sides were last touched is the latest word on all of them.
    const sidesTouched = Math.max(...own.map((s) => Number(s.updated_at) || 0));
    if (statusIsData && Number(d.updated_at) > sidesTouched) {
        for (const s of own) syncs.push(['UpdateRecord', 'Plate_Sides', s.id, stateOf(d)]);
    }
}
say(`${designs.length} designs, ${sides.length} sides so far`);
say(`Adding ${adds.length} sides for ${designs.length - sidesOf.size} designs; ${pictureFills.length} pictures to fill; ${syncs.length} sides to bring up to date${statusIsData ? '' : ' (Status is already the formula: no syncing)'}`);
await applyInChunks(adds, 'sides added');
await applyInChunks(pictureFills, 'pictures filled');
await applyInChunks(syncs, 'sides synced');

// ---- switch ----------------------------------------------------------------------

if (SWITCH) {
    if (statusIsData) {
        say('Printing_Plates.Status: becoming the formula over its sides');
        await apply([['ModifyColumn', 'Printing_Plates', 'Status', { isFormula: true, formula: DESIGN_STATUS_FORMULA }]]);
    } else {
        say('Printing_Plates.Status: already the formula');
    }
    for (const col of ['Plates', 'Damaged_Plates']) {
        const [{ type }] = await sql(`SELECT c.type FROM _grist_Tables_column c JOIN _grist_Tables t ON t.id = c.parentId
            WHERE t.tableId = 'Printing_Jobs' AND c.colId = ?`, [col]);
        if (type === 'RefList:Plate_Sides') { say(`Printing_Jobs.${col}: already points at Plate_Sides`); continue; }
        const [{ n }] = await sql(`SELECT COUNT(*) AS n FROM Printing_Jobs WHERE ${col} IS NOT NULL AND ${col} NOT IN ('', '[]')`);
        if (n > 0) throw new Error(`Printing_Jobs.${col} holds plates on ${n} job(s): map them to sides by hand before switching.`);
        say(`Printing_Jobs.${col}: now RefList:Plate_Sides`);
        await apply([['ModifyColumn', 'Printing_Jobs', col, { type: 'RefList:Plate_Sides' }]]);
    }
    // Every Preview picture must be on its sides before Preview goes. The
    // backfill above copied what it could; anything left is a design whose
    // sides do not match its pictures one for one, and is reported, not lost.
    // A join, not a correlated subquery: Grist's /sql stops slow statements.
    const left = await sql(`SELECT DISTINCT p.id FROM Printing_Plates p JOIN Plate_Sides s ON s.Design = p.id
        WHERE p.Preview IS NOT NULL AND p.Preview NOT IN ('', '[]') AND (s.Picture IS NULL OR s.Picture IN ('', '[]'))`);
    const haveCols = async (table) => new Set((await api('GET', `/tables/${table}/columns`)).columns.map((c) => c.id));
    const designCols = await haveCols('Printing_Plates');
    const legacy = ['Verified_At', 'Verified_By', 'Verified', 'Issued_To_Job', ...(left.length ? [] : ['Preview'])].filter((c) => designCols.has(c));
    if (left.length) say(`Printing_Plates.Preview stays: ${left.length} design(s) have pictures not on their sides yet (first: ${left.slice(0, 5).map((r) => r.id).join(', ')})`);
    for (const c of legacy) {
        say(`Printing_Plates.${c}: removing (the sides hold it)`);
        await apply([['RemoveColumn', 'Printing_Plates', c]]);
    }
    const sideCols = await haveCols('Plate_Sides');
    for (const c of ['Rack_Code', 'Shop', 'Expires_On'].filter((x) => sideCols.has(x))) {
        say(`Plate_Sides.${c}: removing (the design has it)`);
        await apply([['RemoveColumn', 'Plate_Sides', c]]);
    }
    say('Switched.');
}
say('Done.');
