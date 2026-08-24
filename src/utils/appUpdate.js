// Noticing that the deployed build has moved on, and getting this tab onto it.
//
// The PWA's service worker is registered with `autoUpdate`, which picks up a new
// build on the next navigation -- but an installed PWA can sit on one screen for
// days without ever navigating, so the floor keeps running a build nobody has
// shipped to in a week. This compares the build compiled into the bundle against
// the one the server is serving right now.
import { APP_VERSION, BUILD_TIMESTAMP_UTC, BUILD_TIMESTAMP_IST_READABLE } from '../version.js';

// Written by get-version.js and served unhashed, next to index.html.
const VERSION_URL = '/version.json';

export const RUNNING_BUILD = {
    version: APP_VERSION,
    buildTimestampUtc: BUILD_TIMESTAMP_UTC,
    buildTimestampIstReadable: BUILD_TIMESTAMP_IST_READABLE
};

// The deployed build, straight from the network. A cached answer would report the
// running build as the newest one for as long as the cache lived, which is the
// one thing this file cannot afford to get wrong -- hence both the `no-store` and
// the cache-busting parameter, since intermediaries honour them unevenly.
export const fetchDeployedBuild = async () => {
    const res = await fetch(`${VERSION_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`version.json returned ${res.status}`);
    const data = await res.json();
    if (!data || typeof data.version !== 'string' || !data.version) {
        throw new Error('version.json is not a build record');
    }
    return data;
};

// A deploy this tab is not on. A rollback counts as much as a new build: either
// way the assets held here no longer match what the server hands out.
export const isDifferentBuild = (deployed) =>
    !!deployed?.version && typeof deployed.version === 'string' && deployed.version !== APP_VERSION;

// Reload onto the deployed build. The service worker owns the asset cache, so it
// has to go first -- a plain reload would be served the very build we are trying
// to leave. Unregistering also means the next load installs a fresh worker that
// precaches the new assets, rather than patching the old one.
export const applyUpdate = async () => {
    try {
        const regs = (await navigator.serviceWorker?.getRegistrations?.()) || [];
        await Promise.all(regs.map((r) => r.unregister().catch(() => { })));
    } catch { /* no service worker here -- the reload alone does the job */ }
    try {
        const keys = (await globalThis.caches?.keys?.()) || [];
        await Promise.all(keys.map((k) => globalThis.caches.delete(k).catch(() => { })));
    } catch { /* ditto */ }
    window.location.reload();
};

// Reloading cannot fix a mismatch the server itself is serving -- a half-finished
// deploy where version.json is new but index.html is not, say. Count the attempts
// per target build so the app can stop insisting after a couple and let the user
// carry on, instead of becoming unusable until the server catches up.
export const MAX_FORCED_ATTEMPTS = 2;
const attemptKey = (version) => `appUpdate.attempts.${version}`;

export const updateAttempts = (version) => {
    try { return Number(sessionStorage.getItem(attemptKey(version))) || 0; } catch { return 0; }
};

export const noteUpdateAttempt = (version) => {
    try { sessionStorage.setItem(attemptKey(version), String(updateAttempts(version) + 1)); } catch { /* private mode */ }
};
