// proxy-server.ts – Railway Bun Function (Auth0 Integrated)
/// <reference types="@railway/cli" />

// ────────────────────────────── CONFIG ──────────────────────────────
const GRIST_BASE_URL = process.env.GRIST_URL ?? "https://your-grist.railway.app";
const AUTH0_DOMAIN = process.env.AUTH0_DOMAIN ?? "your-tenant.us.auth0.com";

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
        // Handle CORS preflight requests
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type, Authorization",
                },
            });
        }

        const url = new URL(request.url);

        // Root check
        if (url.pathname === "/" || url.pathname === "") {
            return new Response(JSON.stringify({ message: "Grist Auth0 Proxy is running" }), {
                headers: { "Content-Type": "application/json" },
            });
        }

        // 1. Extract Auth0 Token
        const authHeader = request.headers.get("Authorization");
        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return new Response('{"error":"Missing or invalid Authorization header"}', {
                status: 401,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
                        headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
                return new Response('{"error":"Failed to validate token"}', { status: 502 });
            }
        }

        // 3. Map User to Grist API Key
        // Try mapping by Email first, then by Sub (User ID)
        const userEmail = userProfile.email;
        const userSub = userProfile.sub;

        const gristKey = USER_KEY_MAP[userEmail] || USER_KEY_MAP[userSub];

        if (!gristKey) {
            console.warn(`No Grist Key found for user: ${userEmail} (${userSub})`);
            return new Response('{"error":"User not authorized for Grist access"}', {
                status: 403,
                headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
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
            return new Response('{"error":"Rate limit exceeded"}', { status: 429 });
        }

        record.count++;
        rateLimits.set(rateKey, record);

        // 5. Forward to Grist
        const targetUrl = new URL(url.pathname + url.search, GRIST_BASE_URL);
        console.log(targetUrl.toString());

        const headers = new Headers(request.headers);
        headers.delete("host");
        headers.delete("origin");
        headers.delete("user-agent");
        // REPLACE the Auth0 token with the Grist API Key
        headers.set("Authorization", `Bearer ${gristKey}`);

        try {
            const upstream = await fetch(targetUrl.toString(), {
                method: request.method,
                headers,
                body: request.body,
                redirect: "follow",
            });

            // 6. Return Response with CORS
            const response = new Response(upstream.body, upstream);
            response.headers.set("Access-Control-Allow-Origin", "*");
            response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
            response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

            return response;
        } catch (e: any) {
            console.error("Upstream error:", e.message);
            return new Response('{"error":"Failed to reach Grist"}', { status: 502 });
        }
    },
};
