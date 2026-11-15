// A small read-only S3 client for the Grist file store (the MinIO "Bucket"
// service on Railway), signed with AWS Signature V4 so no SDK is needed.
// Used by scripts/plate-previews.mjs to read design files over Railway's
// private network instead of through Grist's public address (user, 15 Nov 2026):
// private traffic is free, public is egress.
//
// Only GETs: list buckets, list objects, get an object.

import { createHash, createHmac } from 'node:crypto';

const sha256 = (d) => createHash('sha256').update(d).digest('hex');
const hmac = (k, d) => createHmac('sha256', k).update(d).digest();
// RFC 3986 encoding, as SigV4 wants it.
const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const tags = (xml, tag) => [...xml.matchAll(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'"));

export const s3Client = ({ endpoint, accessKey, secretKey, region = 'us-east-1' }) => {
    const base = new URL(endpoint);
    const request = async (path, query = {}) => {
        const amzDate = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
        const day = amzDate.slice(0, 8);
        const canonPath = path.split('/').map(enc).join('/') || '/';
        const qs = Object.keys(query).sort().map((k) => `${enc(k)}=${enc(query[k])}`).join('&');
        const payload = 'UNSIGNED-PAYLOAD';
        const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';
        const canonical = ['GET', canonPath, qs, `host:${base.host}\nx-amz-content-sha256:${payload}\nx-amz-date:${amzDate}\n`, signedHeaders, payload].join('\n');
        const scope = `${day}/${region}/s3/aws4_request`;
        const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256(canonical)].join('\n');
        const key = hmac(hmac(hmac(hmac(`AWS4${secretKey}`, day), region), 's3'), 'aws4_request');
        const signature = createHmac('sha256', key).update(toSign).digest('hex');
        const res = await fetch(`${base.origin}${canonPath}${qs ? `?${qs}` : ''}`, {
            headers: {
                'x-amz-content-sha256': payload,
                'x-amz-date': amzDate,
                Authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
            }
        });
        if (!res.ok) throw new Error(`S3 GET ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return res;
    };

    return {
        buckets: async () => tags(await (await request('/')).text(), 'Name'),
        // One page of a listing: { keys, prefixes, next }.
        list: async (bucket, { prefix = '', delimiter, token } = {}) => {
            const q = { 'list-type': '2', prefix, 'max-keys': '1000' };
            if (delimiter) q.delimiter = delimiter;
            if (token) q['continuation-token'] = token;
            const xml = await (await request(`/${bucket}`, q)).text();
            return {
                keys: tags(xml, 'Key'),
                prefixes: tags(xml, 'Prefix').filter((p) => p !== prefix),
                next: tags(xml, 'NextContinuationToken')[0] || null
            };
        },
        get: async (bucket, key) => Buffer.from(await (await request(`/${bucket}/${key}`)).arrayBuffer())
    };
};
