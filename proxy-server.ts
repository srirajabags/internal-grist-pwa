// proxy-server.ts – Railway Bun Function (Auth0 Integrated)
/// <reference types="@railway/cli" />

// ────────────────────────────── CONFIG ──────────────────────────────
const ALLOW_ORIGIN = process.env.ALLOW_ORIGIN ?? "*"; // CORS Allowed Origin
const GRIST_BASE_URL = process.env.GRIST_URL ?? "https://your-grist.railway.app";
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN ?? "your-tenant.us.auth0.com";
const SQL_KEY = process.env.SQL_KEY; // Dedicated API key for SQL endpoints
const IMPERSONATION_ALLOWED_USERS = process.env.IMPERSONATION_ALLOWED_USERS
    ? process.env.IMPERSONATION_ALLOWED_USERS.split(',').map(email => email.trim())
    : []; // Comma-separated list of emails allowed to impersonate

// Map Auth0 User Emails (or 'sub' IDs) to Grist API Keys
// Map Auth0 User Emails (or 'sub' IDs) to Grist API Keys
// Loaded dynamically from environment variables: USER_1_EMAIL, USER_1_KEY, etc.
const getUserKeyMap = () => {
    const map: Record<string, string> = {};

    // 1. Add hardcoded defaults if needed (optional)
    // map["user@example.com"] = "key...";

    // 2. Iterate over environment variables
    for (const key in process.env) {
        // Look for pattern USER_(\d+)_EMAIL
        const match = key.match(/^USER_(\d+)_EMAIL$/);
        if (match) {
            const index = match[1];
            const email = process.env[key];
            const apiKey = process.env[`USER_${index}_KEY`];

            if (email && apiKey) {
                map[email] = apiKey;
                console.log(`Loaded mapping for user: ${email}`);
            }
        }
    }
    return map;
};

const USER_KEY_MAP = getUserKeyMap();

// --- Public order tracking ------------------------------------------------
// Customers get an opaque code instead of their order id: ids are sequential, so
// handing one out invites the next customer to try id+1. TRACK_CODE_KEY keys a
// reversible permutation of the id, so codes look unrelated and only this server
// can turn one back into an id. The key never reaches a browser.
const TRACK_CODE_KEY = process.env.TRACK_CODE_KEY ?? "";
const TRACK_DOC_ID = process.env.TRACK_DOC_ID ?? "8vRFY3UUf4spJroktByH4u";
// Public traffic is anonymous, so it gets its own, tighter budget per IP.
const PUBLIC_RATE_LIMIT = 20;
const publicRateLimits = new Map<string, { count: number; resetAt: number }>();

// 32-bit balanced Feistel network. Four rounds of a keyed hash is enough to
// scatter neighbouring ids across the whole space, and it is exactly invertible,
// so no lookup table of codes has to be kept anywhere.
const roundHash = (value: number, round: number): number => {
    let h = 2166136261 >>> 0;
    const data = `${TRACK_CODE_KEY}:${round}:${value}`;
    for (let i = 0; i < data.length; i++) {
        h ^= data.charCodeAt(i);
        h = Math.imul(h, 16777619) >>> 0;
    }
    return h & 0xffff;
};

const feistel = (input: number, decrypt = false): number => {
    let left = (input >>> 16) & 0xffff;
    let right = input & 0xffff;
    const rounds = decrypt ? [3, 2, 1, 0] : [0, 1, 2, 3];
    for (const r of rounds) {
        const next = left ^ roundHash(right, r);
        left = right;
        right = next;
    }
    return (((right << 16) >>> 0) | left) >>> 0;
};

// Crockford base32: no I/L/O/U, so a code read down a phone line survives.
const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const toBase32 = (n: number): string => {
    let out = "";
    let v = n >>> 0;
    for (let i = 0; i < 7; i++) {
        out = ALPHABET[v % 32] + out;
        v = Math.floor(v / 32);
    }
    return out;
};
const fromBase32 = (code: string): number | null => {
    let v = 0;
    for (const ch of code) {
        const idx = ALPHABET.indexOf(ch);
        if (idx === -1) return null;
        v = v * 32 + idx;
    }
    return v >>> 0;
};

// A code carries what it points at, so one entry box serves both id kinds.
const KIND_TAG: Record<string, number> = { order: 1, suborder: 2 };
const TAG_KIND: Record<number, string> = { 1: "order", 2: "suborder" };

export const makeTrackCode = (kind: string, id: number): string | null => {
    const tag = KIND_TAG[kind];
    if (!tag || !Number.isInteger(id) || id <= 0 || id > 0x0fffffff) return null;
    const raw = feistel(((tag << 28) >>> 0 | id) >>> 0);
    const body = toBase32(raw);
    return `${body.slice(0, 4)}-${body.slice(4)}`;
};

export const readTrackCode = (code: string): { kind: string; id: number } | null => {
    const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "")
        // Crockford: these are commonly mistyped for digits.
        .replace(/O/g, "0").replace(/[IL]/g, "1");
    if (clean.length !== 7) return null;
    const raw = fromBase32(clean);
    if (raw === null) return null;
    const decoded = feistel(raw, true);
    const kind = TAG_KIND[(decoded >>> 28) & 0xf];
    const id = decoded & 0x0fffffff;
    return kind && id > 0 ? { kind, id } : null;
};

const RATE_LIMIT = 60; // requests per minute per user
const rateLimits = new Map<string, { count: number; resetAt: number }>();

// Token cache to avoid repeated Auth0 calls
const tokenCache = new Map<string, { userProfile: any; expiresAt: number }>();

// Helper function to decode JWT and extract expiration
const getTokenExpiration = (token: string): number | null => {
    try {
        // JWT format: header.payload.signature
        const parts = token.split('.');
        if (parts.length !== 3) return null;

        // Decode the payload (base64url)
        const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));

        // Return expiration time in milliseconds (exp is in seconds)
        return payload.exp ? payload.exp * 1000 : null;
    } catch (e) {
        console.error('Failed to decode token:', e);
        return null;
    }
};

// ─────────────────────────── MAIN HANDLER ───────────────────────────
export default {
    async fetch(request: Request): Promise<Response> {
        const corsHeaders = {
            "Access-Control-Allow-Origin": ALLOW_ORIGIN,
            "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Impersonate",
        };

        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: corsHeaders,
            });
        }

        const url = new URL(request.url);

        // Root check
        if (url.pathname === "/" || url.pathname === "") {
            return new Response(JSON.stringify({ message: "Grist Auth0 Proxy is running" }), {
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        // 0. Public order tracking. Deliberately ahead of the auth gate: this is
        // embedded on the public website, so there is no user and no token. It
        // never proxies arbitrary Grist calls -- it decodes one code, runs fixed
        // queries, and returns only the fields a customer should see.
        if (url.pathname.startsWith("/public/track/")) {
            const publicCors = {
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
                "Access-Control-Allow-Headers": "Content-Type",
            };
            const jsonHeaders = { "Content-Type": "application/json", ...publicCors };

            if (!TRACK_CODE_KEY || !SQL_KEY) {
                return new Response('{"error":"Tracking is not configured"}', { status: 503, headers: jsonHeaders });
            }

            // Anonymous traffic, so the budget is per IP and tighter than the
            // signed-in one.
            const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
                || request.headers.get("cf-connecting-ip") || "unknown";
            const now = Date.now();
            const bucket = publicRateLimits.get(ip);
            if (!bucket || bucket.resetAt < now) {
                publicRateLimits.set(ip, { count: 1, resetAt: now + 60_000 });
            } else if (bucket.count >= PUBLIC_RATE_LIMIT) {
                return new Response('{"error":"Too many lookups. Please wait a minute."}', { status: 429, headers: jsonHeaders });
            } else {
                bucket.count++;
            }

            const target = readTrackCode(decodeURIComponent(url.pathname.slice("/public/track/".length)));
            // One message for "bad code" and "no such order" alike: telling them
            // apart would let someone probe for codes that exist.
            const notFound = new Response('{"error":"We could not find an order for that code."}', { status: 404, headers: jsonHeaders });
            if (!target) return notFound;

            const gristSql = async (sql: string, args: any[]) => {
                const res = await fetch(`${GRIST_BASE_URL}/api/docs/${TRACK_DOC_ID}/sql`, {
                    method: "POST",
                    headers: { Authorization: `Bearer ${SQL_KEY}`, "Content-Type": "application/json" },
                    body: JSON.stringify({ sql, args }),
                });
                if (!res.ok) throw new Error(`grist ${res.status}`);
                return ((await res.json()).records || []).map((r: any) => r.fields);
            };

            try {
                // Sub-orders are the unit everything downstream tracks; an order
                // code simply widens the same query to all of its sub-orders.
                const where = target.kind === "order" ? 'o.id = ?' : 'so.id = ?';
                const subOrders = await gristSql(
                    `SELECT so.id AS id, so.Status AS status, so.Model AS model,
                            so.Print AS print, so.Quantity AS quantity,
                            so.Quantity_Type AS quantityType,
                            so.Bag_Width AS bagWidth, so.Bag_Height AS bagHeight,
                            so.Bag_Colour AS bagColour,
                            so.Order_Form_Date AS orderedAt,
                            so.Factory_Updated_Date AS factoryAt,
                            o.Order_ID AS orderNo, o.Order_Form_Date AS orderPlacedAt,
                            c.Shop_Name AS shop
                     FROM Sub_Orders so
                     LEFT JOIN Orders o ON o.id = so."Order"
                     LEFT JOIN Customers c ON c.id = so.Customer
                     WHERE ${where}
                     ORDER BY so.id`,
                    [target.id]
                );
                if (subOrders.length === 0) return notFound;

                // Production progress per sub-order. Printing and stitching live in
                // tables that may not exist yet, so each is attempted separately and
                // simply reports nothing rather than failing the whole lookup.
                const ids = subOrders.map((s: any) => Number(s.id));
                const placeholders = ids.map(() => "?").join(",");
                const safe = async (sql: string) => {
                    try { return await gristSql(sql, ids); } catch { return []; }
                };
                const production = await safe(
                    `SELECT so.value AS subOrderId, b.Type AS jobType,
                            j.Production_Started AS started, j.Production_Started_At AS startedAt,
                            j.Production_Completed AS completed, j.Production_Completed_At AS completedAt
                     FROM Factory_Production_Jobs j
                     JOIN json_each(CASE WHEN json_valid(j.Sub_Orders) THEN j.Sub_Orders ELSE '[]' END) so
                       ON so.value != 'L'
                     LEFT JOIN Factory_Production_Job_Batches b ON b.id = j.Factory_Production_Job_Batch
                     WHERE so.value IN (${placeholders})`
                );
                const printing = await safe(
                    `SELECT p.Sub_Order AS subOrderId, 'PRINTING' AS jobType,
                            p.Printing_Started AS started, p.Printing_Started_At AS startedAt,
                            p.Printing_Completed AS completed, p.Printing_Completed_At AS completedAt
                     FROM Printing_Jobs p WHERE p.Sub_Order IN (${placeholders})`
                );
                const stitching = await safe(
                    `SELECT s.Sub_Order AS subOrderId, 'STITCHING' AS jobType,
                            s.Stitching_Started AS started, s.Stitching_Started_At AS startedAt,
                            s.Stitching_Completed AS completed, s.Stitching_Completed_At AS completedAt
                     FROM Stitching_Jobs s WHERE s.Sub_Order IN (${placeholders})`
                );

                // Collapse the jobs into per-stage progress. A customer needs to know
                // how far along their order is, not how the floor split the work, so
                // job types and batch names never leave the building -- the internal
                // page reads those straight from Grist with a signed-in user.
                const progress: Record<string, any> = {};
                const fold = (rows: any[], stage: string) => {
                    for (const r of rows) {
                        const key = String(Number(r.subOrderId));
                        const p = progress[key] || (progress[key] = {});
                        const st = p[stage] || (p[stage] = { total: 0, done: 0, startedAt: null, completedAt: null });
                        st.total += 1;
                        if (r.started && r.startedAt) st.startedAt = st.startedAt ? Math.min(st.startedAt, r.startedAt) : r.startedAt;
                        if (r.completed) {
                            st.done += 1;
                            if (r.completedAt) st.completedAt = st.completedAt ? Math.max(st.completedAt, r.completedAt) : r.completedAt;
                        }
                    }
                };
                fold(production, "production");
                fold(printing, "printing");
                fold(stitching, "stitching");

                return new Response(JSON.stringify({
                    kind: target.kind,
                    subOrders,
                    progress,
                }), { headers: jsonHeaders });
            } catch (e: any) {
                console.error("track lookup failed:", e?.message);
                return new Response('{"error":"Could not read the order right now. Please try again."}', { status: 502, headers: jsonHeaders });
            }
        }

        // 1. Extract Auth0 Token
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response('{"error":"Missing or invalid Authorization header"}', {
                status: 401,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }
        const token = authHeader.split(" ")[1];

        // 2. Validate Token & Get User Info
        // Check cache first to avoid repeated Auth0 calls
        const currentTime = Date.now();
        const cachedEntry = tokenCache.get(token);

        let userProfile;

        if (cachedEntry && cachedEntry.expiresAt > currentTime) {
            // Use cached profile
            userProfile = cachedEntry.userProfile;
            console.log(`Using cached profile for user: ${userProfile.email}`);
        } else {
            // Cache miss or expired - validate with Auth0
            try {
                const userRes = await fetch(`https://${AUTH0_DOMAIN}/userinfo`, {
                    headers: { Authorization: `Bearer ${token}` },
                });

                if (!userRes.ok) {
                    console.error("Auth0 validation failed:", userRes.status);
                    return new Response('{"error":"Invalid Auth0 Token"}', {
                        status: 401,
                        headers: { "Content-Type": "application/json", ...corsHeaders },
                    });
                }

                userProfile = await userRes.json();

                // Get token expiration from JWT
                const tokenExpiration = getTokenExpiration(token);
                const cacheExpiration = tokenExpiration || (currentTime + 60 * 60 * 1000); // Fallback to 1 hour

                console.log(`Validated new token for user: ${userProfile.email}, expires at: ${new Date(cacheExpiration).toISOString()}`);

                // Cache the validated token until it expires
                tokenCache.set(token, {
                    userProfile,
                    expiresAt: cacheExpiration,
                });
            } catch (e) {
                console.error("Auth0 connection error:", e);
                return new Response('{"error":"Failed to validate token"}', {
                    status: 502,
                    headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
        }

        // 3. Map User to Grist API Key
        // Try mapping by Email first, then by Sub (User ID)
        const userEmail = userProfile.email;
        const userSub = userProfile.sub;

        // Check for impersonation header
        const impersonateEmail = request.headers.get("X-Impersonate");
        let effectiveEmail = userEmail;

        if (impersonateEmail) {
            // Validate that the current user is allowed to impersonate
            if (!IMPERSONATION_ALLOWED_USERS.includes(userEmail)) {
                console.warn(`Impersonation denied: ${userEmail} is not in allowed list`);
                return new Response('{"error":"User not authorized to impersonate"}', {
                    status: 403,
                    headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }

            // Check if the impersonated user exists in the key map
            if (!USER_KEY_MAP[impersonateEmail]) {
                console.warn(`Impersonation failed: No key found for ${impersonateEmail}`);
                return new Response('{"error":"Impersonated user not found or not authorized"}', {
                    status: 404,
                    headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }

            effectiveEmail = impersonateEmail;
            console.log(`User ${userEmail} is impersonating ${impersonateEmail}`);
        }

        const gristKey = USER_KEY_MAP[effectiveEmail] || USER_KEY_MAP[userSub];

        if (!gristKey) {
            console.warn(`No Grist Key found for user: ${effectiveEmail} (${userSub})`);
            return new Response('{"error":"User not authorized for Grist access"}', {
                status: 403,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        // 4. Rate Limiting (per user)
        const rateKey = userSub || "unknown";
        const now = Date.now();
        const record = rateLimits.get(rateKey) ?? { count: 0, resetAt: now + 60_000 };

        if (now > record.resetAt) {
            record.count = 0;
            record.resetAt = now + 60_000;
        }

        if (record.count >= RATE_LIMIT) {
            return new Response('{"error":"Rate limit exceeded"}', {
                status: 429,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        record.count++;
        rateLimits.set(rateKey, record);

        // 4b. The code for an id, for signed-in staff. Sits behind the same auth and
        // rate limiting as everything else, so the mapping is never public.
        if (url.pathname === "/internal/track-code") {
            const kind = (url.searchParams.get("kind") || "").toLowerCase();
            const id = Number(url.searchParams.get("id"));
            const code = TRACK_CODE_KEY ? makeTrackCode(kind, id) : null;
            if (!code) {
                return new Response('{"error":"Pass kind=order|suborder and a valid id"}', {
                    status: 400,
                    headers: { "Content-Type": "application/json", ...corsHeaders },
                });
            }
            return new Response(JSON.stringify({ kind, id, code }), {
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }

        // 5. Forward to Grist
        const targetUrl = new URL(url.pathname + url.search, GRIST_BASE_URL);
        console.log(targetUrl.toString());

        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.delete("origin");
        headers.delete("user-agent");

        // Determine which API key to use
        // Use SQL_KEY for SQL endpoints if available, otherwise use user's regular key
        const isSqlEndpoint = url.pathname.includes('/sql');
        const apiKeyToUse = (isSqlEndpoint && SQL_KEY) ? SQL_KEY : gristKey;

        // REPLACE the Auth0 token with the appropriate Grist API Key
        headers.set("Authorization", `Bearer ${apiKeyToUse}`);

        try {
            const upstream = await fetch(targetUrl.toString(), {
                method: request.method,
                headers,
                body: request.body,
                redirect: "follow",
            });

            // 6. Return Response with CORS
            const response = new Response(upstream.body, upstream);
            Object.entries(corsHeaders).forEach(([key, value]) => {
                response.headers.set(key, value);
            });
            response.headers.delete("content-encoding");
            response.headers.delete("content-length");

            return response;
        } catch (e: any) {
            console.error("Upstream error:", e.message);
            return new Response('{"error":"Failed to reach Grist"}', {
                status: 502,
                headers: { "Content-Type": "application/json", ...corsHeaders },
            });
        }
    },
};
