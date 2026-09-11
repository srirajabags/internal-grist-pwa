import { describe, it, expect } from 'vitest';
import { compressibleBody } from './proxy-server.ts';

const req = (accept = 'gzip, deflate, br', method = 'POST') =>
    new Request('https://x/api', { method, headers: accept ? { 'accept-encoding': accept } : {} });
const res = (body, { type = 'application/json; charset=utf-8', status = 200, length } = {}) => {
    const h = { 'content-type': type };
    if (length !== undefined) h['content-length'] = String(length);
    return new Response(status === 204 || status === 304 ? null : body, { status, headers: h });
};
const big = JSON.stringify({ records: Array.from({ length: 500 }, (_, i) => ({ fields: { id: i, name: 'SIDEPATTY - NW REGULAR - RED - 75GSM (6x54)' } })) });
// Web APIs only, the same ones the proxy runs on.
const read = async (body) => new Uint8Array(await new Response(body).arrayBuffer());
const text = (bytes) => new TextDecoder().decode(bytes);
const gunzip = async (bytes) =>
    read(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip')));

// Railway's function-bun:1.3.0 has no CompressionStream. That is not a hypothetical
// -- the first deploy of this reported `no-compressionstream` on x-proxy-encoding
// and served every reply whole. Run the same expectations with it taken away.
const withoutCompressionStream = async (fn) => {
    const real = globalThis.CompressionStream;
    delete globalThis.CompressionStream;
    try { return await fn(); } finally { globalThis.CompressionStream = real; }
};

describe('compressibleBody — gzip, but only when it is safe and worth it', () => {
    it('says why it declined, since every refusal looks the same from outside', async () => {
        expect((await compressibleBody(req('identity'), res(big))).reason).toBe('client-declined');
        expect((await compressibleBody(req(), res(big, { type: 'image/png' }))).reason).toBe('not-text');
        expect((await compressibleBody(req(), res('{"ok":1}', { length: 8 }))).reason).toBe('too-small');
        expect((await compressibleBody(req(), res(null, { status: 204 }))).reason).toBe('no-body');
        expect((await compressibleBody(req(), res(big, { length: 99 * 1024 * 1024 }))).reason).toBe('too-big');
    });

    it('compresses a big JSON reply for a client that asked', async () => {
        const out = await compressibleBody(req(), res(big));
        expect(out.encoding).toBe('gzip');
        const gz = await read(out.body);
        expect(gz.length).toBeLessThan(new TextEncoder().encode(big).length / 2);
    });

    it('produces something the client can actually read back', async () => {
        const out = await compressibleBody(req(), res(big));
        expect(text(await gunzip(await read(out.body)))).toBe(big);
    });

    it('leaves it alone when the client cannot read gzip', async () => {
        // Sending gzip to a client that did not ask is not slow, it is broken.
        for (const enc of ['identity', '', 'deflate, br']) {
            expect((await compressibleBody(req(enc), res(big))).encoding).toBeNull();
        }
    });

    it('is not fooled by an encoding that merely contains "gzip"', async () => {
        expect((await compressibleBody(req('x-gzip-ish'), res(big))).encoding).toBeNull();
        expect((await compressibleBody(req('gzip;q=0'), res(big))).encoding).toBe('gzip');
    });

    it('leaves anything that is not text alone', async () => {
        for (const type of ['image/png', 'application/octet-stream', 'application/pdf']) {
            expect((await compressibleBody(req(), res(big, { type }))).encoding).toBeNull();
        }
        expect((await compressibleBody(req(), res(big, { type: 'text/csv' }))).encoding).toBe('gzip');
    });

    it('does not bother with a reply too small to pay for it', async () => {
        expect((await compressibleBody(req(), res('{"ok":1}', { length: 8 }))).encoding).toBeNull();
        expect((await compressibleBody(req(), res(big, { length: 100000 }))).encoding).toBe('gzip');
    });

    it('never touches a reply that carries no body', async () => {
        // Compressing one produces a malformed response rather than a small one.
        expect((await compressibleBody(req(), res(null, { status: 204 }))).encoding).toBeNull();
        expect((await compressibleBody(req(), res(null, { status: 304 }))).encoding).toBeNull();
        expect((await compressibleBody(req('gzip', 'HEAD'), res(big))).encoding).toBeNull();
    });

    it('hands the original body straight back whenever it declines', async () => {
        const out = await compressibleBody(req('identity'), res(big));
        expect(text(await read(out.body))).toBe(big);
    });
});

describe('compressibleBody — on a runtime with no CompressionStream', () => {
    it('still gzips, by buffering instead of streaming', async () => {
        const out = await withoutCompressionStream(() => compressibleBody(req(), res(big)));
        expect(out.encoding).toBe('gzip');
        expect(out.reason).toBe('gzip-buffered');
    });

    it('produces a body the client can read back, same as the streamed path', async () => {
        const out = await withoutCompressionStream(() => compressibleBody(req(), res(big)));
        expect(text(await gunzip(out.body))).toBe(big);
    });

    it('still refuses the things it should refuse', async () => {
        await withoutCompressionStream(async () => {
            expect((await compressibleBody(req('identity'), res(big))).encoding).toBeNull();
            expect((await compressibleBody(req(), res(big, { type: 'image/png' }))).encoding).toBeNull();
        });
    });

    it('catches a reply whose real size only shows once it is read', async () => {
        // No content-length to judge by, and too small to be worth it after all.
        const out = await withoutCompressionStream(() => compressibleBody(req(), res('{"ok":1}')));
        expect(out.encoding).toBeNull();
        expect(out.reason).toBe('too-small');
        expect(text(await read(out.body))).toBe('{"ok":1}');
    });
});
