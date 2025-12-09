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

- `get-version.js` - Script that generates the version file with UTC and IST timestamps
- `src/version.js` - Auto-generated file with current commit info and timestamps
- `src/App.jsx` - Imports and displays the version and IST timestamp in settings modal

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