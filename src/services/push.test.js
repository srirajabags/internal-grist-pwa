import { describe, it, expect } from 'vitest';
import { pushSupport, readEnvironment, urlBase64ToUint8Array, deviceLabel } from './push.js';

const env = (over = {}) => ({ hasServiceWorker: true, hasPushManager: true, hasNotification: true, isIOS: false, isStandalone: false, ...over });

describe('pushSupport — what to tell the person on this phone', () => {
    it('is supported where the browser has a service worker, PushManager and Notification', () => {
        expect(pushSupport(env())).toBe('supported');
    });

    it('asks iPhone users to add the app to the Home Screen first', () => {
        // Safari has no PushManager in a normal tab; it only appears in the
        // installed app. Saying "unsupported" there would be wrong.
        expect(pushSupport(env({ hasPushManager: false, hasNotification: false, isIOS: true }))).toBe('ios-install');
    });

    it('reports an installed iPhone app that still lacks push (iOS before 16.4) as unsupported, not as "install"', () => {
        expect(pushSupport(env({ hasPushManager: false, isIOS: true, isStandalone: true }))).toBe('unsupported');
    });

    it('is unsupported on a browser without push', () => {
        expect(pushSupport(env({ hasPushManager: false }))).toBe('unsupported');
        expect(pushSupport(env({ hasServiceWorker: false }))).toBe('unsupported');
    });
});

describe('readEnvironment', () => {
    it('treats an iPad that reports itself as a Mac as iOS', () => {
        const win = { navigator: { userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15', maxTouchPoints: 5 }, matchMedia: () => ({ matches: false }) };
        expect(readEnvironment(win).isIOS).toBe(true);
        expect(readEnvironment({ ...win, navigator: { ...win.navigator, maxTouchPoints: 0 } }).isIOS).toBe(false);
    });
});

describe('urlBase64ToUint8Array', () => {
    it('decodes unpadded base64url, which is how push public keys are written', () => {
        // "-_8" is base64url for bytes 0xfb 0xff; a plain atob() would reject it.
        expect(Array.from(urlBase64ToUint8Array('-_8'))).toEqual([0xfb, 0xff]);
        expect(urlBase64ToUint8Array('B' + 'A'.repeat(86)).length).toBe(65);
    });
});

describe('deviceLabel', () => {
    it('names the phone and browser', () => {
        expect(deviceLabel('Mozilla/5.0 (Linux; Android 14; SM-A146B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36')).toBe('Android · Chrome');
        expect(deviceLabel('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 SamsungBrowser/26.0 Chrome/122.0 Mobile Safari/537.36')).toBe('Android · Samsung Internet');
        expect(deviceLabel('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1')).toBe('iPhone · Safari');
    });
});
