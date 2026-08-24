# App Versioning System

This project uses an automatic versioning system that tracks the current git commit ID.

## How it works

1. **Automatic Version Generation**: The `get-version.js` script runs automatically before builds and development server starts
2. **Version File**: It generates `src/version.js` with the current git commit ID, UTC timestamp, and IST timestamp
3. **Dynamic Import**: The main app imports the version from this generated file

## Usage

### Development
```bash
npm run dev
```
Automatically updates version and starts dev server.

### Production Build
```bash
npm run build
```
Automatically updates version and creates production build.

### Manual Version Update
```bash
npm run update-version
```
Manually trigger version update without building.

## Files

- `get-version.js` - Script that generates the version files with UTC and IST timestamps
- `src/version.js` - Auto-generated file with current commit info and timestamps, compiled into the bundle: which build is **running**
- `public/version.json` - Auto-generated and served unhashed next to `index.html`: which build is **deployed**
- `src/utils/appUpdate.js` - Fetches `version.json`, compares it with the running build, and reloads onto the new one
- `src/components/UpdateGate.jsx` - Wraps the app and blocks it when the two disagree
- `src/App.jsx` - Imports and displays the version and IST timestamp in settings modal

## Forced updates

The service worker is registered with `autoUpdate`, which only picks up a new
build on the next navigation — an installed PWA can sit on one screen for days
and never navigate. So the running app also checks for itself:

1. `UpdateGate` fetches `/version.json` on load, when the tab becomes visible
   again, and every 15 minutes.
2. If the deployed commit differs from the one compiled into the bundle, a
   modal blocks the app. It cannot be dismissed — a stale bundle writing to a
   changed schema is the failure this prevents.
3. **Update now** unregisters the service worker, deletes every cache and
   reloads, so the next load comes from the network.
4. If two reloads fail to resolve the mismatch (a half-finished deploy, say),
   the modal offers a way past rather than leaving the app unusable.

`/track` is exempt: customers see it embedded in the public website.

`version.json` is excluded from the Workbox precache (`globIgnores`). If it were
precached, the app would compare itself against a cached copy of its own build
and conclude it was up to date forever.

## Current Version Display

The app version information is displayed in the settings modal under two sections:

### App Version
Shows the git commit ID (e.g., `1736367f797e6d7aeae36de653a9f1295d380786`)

### Build Timestamp (IST)
Shows when the version was generated in Indian Standard Time in human-readable format (e.g., `09 Dec 2025, 05:28 pm IST`)

This information helps with:
- Debugging specific app versions
- Tracking which code is deployed
- Identifying version-related issues
- Knowing exactly when the app was built

## Updating Version

The version automatically updates to the current git commit ID whenever you:
- Run `npm run dev`
- Run `npm run build`
- Run `npm run update-version`

No manual intervention required!