// Push notifications for the signed-in person, on this phone.
//
// Turning them on asks the browser for permission, subscribes this browser to
// push with the server's public key, and hands the subscription to the proxy,
// which stores it in Grist (Push_Subscriptions) under the real sign-in. The
// push job on Railway sends to it from there. Turning them off unsubscribes the
// browser and tells the proxy, which switches the row off.
//
// The calls always go without the impersonation header: a subscription belongs
// to the phone in this person's hand, whoever they are viewing the app as.

// What this browser can do. Pure, so each case can be tested without a phone.
//   supported     Push works here.
//   ios-install   iPhone/iPad Safari: push exists only once the app is added to
//                 the Home Screen and opened from there (iOS 16.4 and later).
//   unsupported   No push in this browser at all.
export const pushSupport = ({ hasServiceWorker, hasPushManager, hasNotification, isIOS, isStandalone }) => {
    if (hasServiceWorker && hasPushManager && hasNotification) return 'supported';
    if (isIOS && !isStandalone) return 'ios-install';
    return 'unsupported';
};

export const readEnvironment = (win = globalThis) => {
    const nav = win.navigator || {};
    const ua = nav.userAgent || '';
    return {
        hasServiceWorker: 'serviceWorker' in nav,
        hasPushManager: 'PushManager' in win,
        hasNotification: 'Notification' in win,
        // iPadOS reports itself as a Mac, but a Mac has no touch screen.
        isIOS: /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (nav.maxTouchPoints || 0) > 1),
        isStandalone: !!(win.matchMedia?.('(display-mode: standalone)')?.matches || nav.standalone),
    };
};

// The server's key arrives base64url; subscribe() wants the raw bytes.
export const urlBase64ToUint8Array = (base64) => {
    const padded = (base64 + '='.repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(padded);
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
};

// "Android · Chrome", so a person with two phones can tell the rows apart.
export const deviceLabel = (ua = '') => {
    const os = /Android/.test(ua) ? 'Android'
        : /iPhone/.test(ua) ? 'iPhone'
            : /iPad/.test(ua) ? 'iPad'
                : /Windows/.test(ua) ? 'Windows'
                    : /Mac OS X|Macintosh/.test(ua) ? 'Mac'
                        : /Linux/.test(ua) ? 'Linux' : 'Unknown';
    const browser = /EdgA?\//.test(ua) ? 'Edge'
        : /SamsungBrowser\//.test(ua) ? 'Samsung Internet'
            : /Firefox\/|FxiOS\//.test(ua) ? 'Firefox'
                : /CriOS\/|Chrome\//.test(ua) ? 'Chrome'
                    : /Safari\//.test(ua) ? 'Safari' : 'Browser';
    return `${os} · ${browser}`;
};

// The service worker is only registered in a production build. In `vite dev`
// navigator.serviceWorker.ready never settles, so give up after a few seconds
// instead of leaving the button spinning.
const registration = async (timeoutMs = 5000) => {
    const ready = globalThis.navigator.serviceWorker.ready;
    const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('The app is not installed as a PWA in this window (no service worker).')), timeoutMs));
    return Promise.race([ready, timeout]);
};

export const currentSubscription = async () => {
    const reg = await registration();
    return reg.pushManager.getSubscription();
};

const call = async (getHeaders, getUrl, path, init = {}) => {
    // '' rather than null: no impersonation header on these calls.
    const headers = await getHeaders('');
    const res = await fetch(getUrl(path), { ...init, headers });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `The server answered ${res.status}.`);
    return data;
};

export const turnOn = async (getHeaders, getUrl) => {
    const permission = await globalThis.Notification.requestPermission();
    if (permission !== 'granted') {
        throw new Error(permission === 'denied'
            ? 'Notifications are blocked for this app. Allow them in the phone settings, then try again.'
            : 'Notifications were not allowed.');
    }
    const { publicKey } = await call(getHeaders, getUrl, '/internal/push/key');
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
        sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    }
    await call(getHeaders, getUrl, '/internal/push/subscription', {
        method: 'POST',
        body: JSON.stringify({ subscription: sub.toJSON(), device: deviceLabel(globalThis.navigator.userAgent) }),
    });
    return sub;
};

export const turnOff = async (getHeaders, getUrl) => {
    const sub = await currentSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    await call(getHeaders, getUrl, '/internal/push/subscription', { method: 'DELETE', body: JSON.stringify({ endpoint }) });
};
