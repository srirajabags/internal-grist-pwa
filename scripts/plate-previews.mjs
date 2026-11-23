#!/usr/bin/env node
// A picture of each plate of a design, made from its design files (user, 15 Nov
// 2026), so the person holding a plate can tell which one it is. Two-plate
// designs first; one-plate designs since 23 Nov 2026 (PL-03018).
//
// For every design with no picture yet: find its
// sub-order's files (plate order, then the designer's TIFF task, then an old
// TIFF), open archives, and when there is exactly one artwork per plate, draw
// each as an 800 px JPG, upload them to Grist and write each side's
// Plate_Sides.Picture.
// Which picture goes on which plate: src/domain/printing/platePreviews.js.
// Designs it cannot do (one file for two plates, no files, ...) are left for
// the godown to photograph, and listed in the log.
//
//   GRIST_API_KEY=xxxx node scripts/plate-previews.mjs [--dry-run] [--set 6124] [--limit 20]
//       [--concurrency 3] [--max-mb 600] [--log path.jsonl] [--made-since 7]
//
// --made-since N: only designs with a plate made in the last N days. The
// nightly run on Railway uses it, so designs whose files could not give a
// picture are tried once, not every night.
//
// Needs `magick` (ImageMagick 7) and `bsdtar` (libarchive, reads RAR5) on PATH,
// and the Plate_Sides table (scripts/create-printing-tables.mjs, scripts/plate-sides.mjs).
// Safe to run again: a design with any picture or photo is skipped.
//
// Where the files come from. Grist keeps attachments in the MinIO "Bucket"
// service. With S3_ENDPOINT, S3_ACCESS_KEY, S3_SECRET_KEY, S3_BUCKET and
// S3_KEY_PREFIX set (on Railway: the Bucket's private address), each file is
// read from there -- free over the private network -- and only the lists and
// the pictures go through Grist's public address. Without them, files come
// through Grist itself (fine for a run on a laptop). Either way the bytes must
// hash to the file's name: Grist names a stored file after its SHA-1.
//
//   --probe <fileIdent>: list the Bucket's buckets and find that file's key,
//   to learn S3_BUCKET and S3_KEY_PREFIX. Reads nothing from Grist.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm, writeFile, readFile, mkdir, appendFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { s3Client } from './lib/s3.mjs';
import { plateSets } from '../src/domain/printing/plateSets.js';
import { plateFromRow, SIDE_COLUMNS, SIDES_FROM } from '../src/domain/printing/printingJobs.js';
import { fileKind, artworksIn, fileSources, candidateFiles, pictureActions, needsPictures, pictureName } from '../src/domain/printing/platePreviews.js';

const run = promisify(execFile);
const DOC_ID = '8vRFY3UUf4spJroktByH4u';
const BASE = (process.env.GRIST_URL || 'https://grist.srirajabags.in').replace(/\/$/, '');
const KEY = process.env.GRIST_API_KEY;
if (!KEY) throw new Error('GRIST_API_KEY is required.');
const arg = (name, dflt) => {
    const i = process.argv.indexOf(`--${name}`);
    return i > 0 ? process.argv[i + 1] : dflt;
};
const DRY_RUN = process.argv.includes('--dry-run');
const ONLY_SET = Number(arg('set', 0)) || null;
const LIMIT = Number(arg('limit', 0)) || Infinity;
const CONCURRENCY = Number(arg('concurrency', 3));
const MAX_BYTES = Number(arg('max-mb', 600)) * 1024 * 1024;
const LOG = arg('log', null);
const MADE_SINCE_DAYS = Number(arg('made-since', 0)) || null;
const PROBE = arg('probe', null);

const S3 = process.env.S3_ENDPOINT ? s3Client({
    endpoint: process.env.S3_ENDPOINT, accessKey: process.env.S3_ACCESS_KEY, secretKey: process.env.S3_SECRET_KEY
}) : null;
const S3_BUCKET = process.env.S3_BUCKET || '';
const S3_KEY_PREFIX = process.env.S3_KEY_PREFIX || '';

// Find one stored file in the Bucket, to learn where Grist keeps them.
if (PROBE) {
    if (!S3) throw new Error('--probe needs S3_ENDPOINT, S3_ACCESS_KEY and S3_SECRET_KEY.');
    const buckets = await S3.buckets();
    console.log(`Buckets: ${buckets.join(', ')}`);
    for (const bucket of buckets) {
        const top = await S3.list(bucket, { delimiter: '/' });
        console.log(`${bucket}/ top level: ${[...top.prefixes, ...top.keys].slice(0, 20).join('  ')}`);
        let token = null;
        let seen = 0;
        do {
            const page = await S3.list(bucket, { token });
            seen += page.keys.length;
            const hit = page.keys.find((k) => k.endsWith(PROBE));
            if (hit) {
                console.log(`FOUND in ${bucket}: ${hit}`);
                console.log(`S3_BUCKET=${bucket}  S3_KEY_PREFIX=${hit.slice(0, -PROBE.length)}`);
                process.exit(0);
            }
            token = page.next;
        } while (token && seen < 500000);
        console.log(`${bucket}: not found in ${seen} keys`);
    }
    process.exit(1);
}

const url = (p) => `${BASE}/api/docs/${DOC_ID}${p}`;
const auth = { Authorization: `Bearer ${KEY}` };
const api = async (method, p, body) => {
    const res = await fetch(url(p), { method, headers: { ...auth, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const text = await res.text();
    if (!res.ok) throw new Error(`${method} ${p}: ${res.status} ${text.slice(0, 300)}`);
    return text ? JSON.parse(text) : null;
};
const sql = async (q, args = []) => ((await api('POST', '/sql', { sql: q, args })).records || []).map((r) => r.fields);
const list = (v) => { try { return JSON.parse(v || '[]') || []; } catch { return []; } };
const chunks = (xs, n = 400) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
// One chunk at a time: all at once, Grist refuses with 429 "too many backlogged
// requests" (23 Nov 2026, once one-plate designs made it ~5,700 designs).
const sqlIn = async (q, ids) => {
    const out = [];
    for (const c of chunks(ids)) out.push(...await sql(q.replace('(?)', `(${c.map(() => '?').join(',')})`), c));
    return out;
};
const tally = { done: 0, skipped: 0, failed: 0 };
const log = async (entry) => {
    tally[entry.result] += 1;
    console.log(`  ${entry.set} ${entry.result}${entry.why ? ` -- ${entry.why}` : ''}`);
    if (LOG) await appendFile(LOG, `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
};

// 1. The designs, as their sides.
const rows = await sql(`SELECT ${SIDE_COLUMNS} FROM ${SIDES_FROM}`);
let sets = plateSets(rows.map(plateFromRow)).filter(needsPictures);
if (ONLY_SET) sets = sets.filter((s) => s.key === ONLY_SET);
if (MADE_SINCE_DAYS) {
    const from = Date.now() / 1000 - MADE_SINCE_DAYS * 86400;
    sets = sets.filter((s) => s.plates.some((p) => Number(p.madeOn) >= from));
}
sets = sets.slice(0, LIMIT);
console.log(`${sets.length} design(s) with no picture yet`);
if (!sets.length) process.exit(0);

// 2. Their files.
const subOrders = [...new Set(sets.map((s) => s.lead.sourceSubOrder).filter(Boolean))];
const longest = (rowsOf) => {
    const m = new Map();
    for (const r of rowsOf) {
        const f = list(r.f);
        if (f.length > (m.get(r.so) || []).length) m.set(r.so, f);
    }
    return m;
};
const plateOrder = longest(await sqlIn('SELECT Sub_Order_in_Context AS so, TIFF_File AS f FROM Plate_Orders WHERE TIFF_File IS NOT NULL AND Sub_Order_in_Context IN (?)', subOrders));
const designerTask = longest(await sqlIn(`SELECT Sub_Order AS so, Files AS f FROM Designer_Tasks WHERE Task_Type = 'TIFF FILE' AND Files IS NOT NULL AND Sub_Order IN (?)`, subOrders));
const oldTiff = longest(await sqlIn('SELECT id AS so, Old_TIFF_File AS f FROM Sub_Orders WHERE Old_TIFF_File IS NOT NULL AND id IN (?)', subOrders));
const sourcesOf = (so) => fileSources({ plateOrder: plateOrder.get(so), designerTask: designerTask.get(so), oldTiff: oldTiff.get(so) });
const allIds = [...new Set(subOrders.flatMap((so) => sourcesOf(so).flat()))];
const metaById = Object.fromEntries((await sqlIn('SELECT id, fileName, fileSize, fileIdent FROM _grist_Attachments WHERE id IN (?)', allIds))
    .map((r) => [r.id, { fileName: r.fileName, fileSize: Number(r.fileSize) || 0, fileIdent: r.fileIdent || '' }]));

const plans = sets.map((set) => ({ set, candidates: candidateFiles(set.expected, sourcesOf(set.lead.sourceSubOrder), metaById) }));
const doable = plans.filter((p) => p.candidates.length);
const bytes = doable.reduce((n, p) => n + p.candidates[0].ids.reduce((m, id) => m + metaById[id].fileSize, 0), 0);
console.log(`${doable.length} have files that may give one picture per plate (${(bytes / 1024 ** 3).toFixed(1)} GB to download); ${plans.length - doable.length} do not`);
if (DRY_RUN) {
    // Where the bytes go: sure bets (one file per plate) and long shots (fewer
    // archives than plates, which usually hold one artwork between them).
    const gb = (ps) => (ps.reduce((n, p) => n + p.candidates[0].ids.reduce((m, id) => m + metaById[id].fileSize, 0), 0) / 1024 ** 3).toFixed(1);
    const sure = doable.filter((p) => p.candidates[0].ids.length === p.set.expected);
    const long = doable.filter((p) => p.candidates[0].ids.length < p.set.expected);
    const huge = doable.filter((p) => p.candidates[0].ids.some((id) => metaById[id].fileSize > MAX_BYTES));
    console.log(`  one file per plate: ${sure.length} designs, ${gb(sure)} GB · fewer files than plates: ${long.length}, ${gb(long)} GB · a file over ${MAX_BYTES >> 20} MB: ${huge.length}`);
    const sizes = sure.flatMap((p) => p.candidates[0].ids.map((id) => metaById[id].fileSize)).sort((x, y) => x - y);
    const at = (q) => `${(sizes[Math.floor(q * (sizes.length - 1))] / 1024 ** 2).toFixed(0)} MB`;
    console.log(`  file sizes (one file per plate): median ${at(0.5)}, 90th ${at(0.9)}, largest ${at(1)}`);
    for (const p of plans.slice(0, 15)) {
        console.log(`  ${p.set.key}: ${p.candidates.length ? p.candidates[0].ids.map((id) => metaById[id].fileName).join(' | ') : 'no usable files'}`);
    }
    console.log('Dry run: nothing downloaded or written.');
    process.exit(0);
}

// 3. One design at a time per worker.
const download = async (id, dir) => {
    const { fileIdent, fileName } = metaById[id];
    let bytes;
    if (S3) {
        bytes = await S3.get(S3_BUCKET, `${S3_KEY_PREFIX}${fileIdent}`);
    } else {
        const res = await fetch(url(`/attachments/${id}/download`), { headers: auth });
        if (!res.ok) throw new Error(`download ${id}: ${res.status}`);
        bytes = Buffer.from(await res.arrayBuffer());
    }
    // Grist names a stored file after its SHA-1: anything else is the wrong file
    // or a broken copy, and no picture is made from it.
    const sha1 = createHash('sha1').update(bytes).digest('hex');
    if (fileIdent && !fileIdent.startsWith(sha1)) throw new Error(`file ${id}: SHA-1 ${sha1} does not match ${fileIdent}`);
    const file = path.join(dir, `${id}.${fileName.split('.').pop().toLowerCase()}`);
    await writeFile(file, bytes);
    return file;
};

// The artworks a file gives: itself, or what an archive holds, each unpacked
// into its own empty folder. bsdtar refuses paths that climb out of it.
const artworksOf = async (id, dir) => {
    const file = await download(id, dir);
    if (fileKind(metaById[id].fileName) !== 'archive') return [file];
    const { stdout } = await run('bsdtar', ['-tf', file], { maxBuffer: 1 << 24 });
    const names = artworksIn(stdout.split('\n').filter(Boolean));
    if (!names.length) return [];
    const out = path.join(dir, `x${id}`);
    await mkdir(out);
    await run('bsdtar', ['-xf', file, '-C', out, ...names], { maxBuffer: 1 << 24 });
    return names.map((n) => path.join(out, n));
};

const draw = async (src, out) => {
    await run('magick', [`${src}[0]`, '-colorspace', 'sRGB', '-background', 'white', '-alpha', 'remove', '-alpha', 'off',
        '-fuzz', '2%', '-trim', '+repage', '-resize', '800x800>', '-bordercolor', 'white', '-border', '20',
        '-strip', '-quality', '78', out], { timeout: 120000 });
    return out;
};

const upload = async (files) => {
    const form = new FormData();
    for (const { file, name } of files) form.append('upload', new Blob([await readFile(file)], { type: 'image/jpeg' }), name);
    const res = await fetch(url('/attachments'), { method: 'POST', headers: auth, body: form });
    if (!res.ok) throw new Error(`upload: ${res.status} ${(await res.text()).slice(0, 200)}`);
    return res.json();
};

const doSet = async ({ set, candidates }) => {
    if (!candidates.length) return log({ set: set.key, result: 'skipped', why: 'no file per plate (photo needed)' });
    const dir = await mkdtemp(path.join(tmpdir(), `plate-${set.key}-`));
    try {
        for (const cand of candidates) {
            const big = cand.ids.find((id) => metaById[id].fileSize > MAX_BYTES);
            if (big) { await log({ set: set.key, result: 'skipped', why: `file ${big} over ${MAX_BYTES >> 20} MB` }); continue; }
            const art = [];
            for (const id of cand.ids) art.push(...await artworksOf(id, dir));
            if (art.length !== set.expected) continue;
            const pics = [];
            for (const [i, src] of art.entries()) pics.push({ file: await draw(src, path.join(dir, `p${i + 1}.jpg`)), name: pictureName(set, i + 1) });
            const ids = await upload(pics);
            await api('POST', '/apply', pictureActions(set, ids));
            return log({ set: set.key, result: 'done', files: cand.ids, pictures: ids });
        }
        return log({ set: set.key, result: 'skipped', why: 'files did not give one artwork per plate (photo needed)' });
    } catch (err) {
        return log({ set: set.key, result: 'failed', why: err.message.slice(0, 300) });
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
};

const queue = [...plans];
await Promise.all(Array.from({ length: CONCURRENCY }, async () => {
    while (queue.length) await doSet(queue.shift());
}));
console.log('Finished.', tally, LOG ? `Log: ${LOG}` : '');
