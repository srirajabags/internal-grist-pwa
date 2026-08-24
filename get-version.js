#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Two files come out of this, and they have to agree: src/version.js is compiled
// into the bundle and says which build is *running*, while public/version.json is
// served unhashed and says which build is *deployed*. The running app compares
// the two to notice it is out of date.
const writeVersionFiles = (commitId) => {
  const utcTimestamp = new Date().toISOString();

  // Format current time in IST timezone directly using toLocaleString
  const istReadable = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: true
  }) + ' IST';

  // Also create IST ISO timestamp by converting to IST timezone
  const istDate = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const istTimestamp = istDate.toISOString();

  fs.writeFileSync(
    path.join(__dirname, 'src', 'version.js'),
    `// Auto-generated version file
export const APP_VERSION = '${commitId}';
export const BUILD_TIMESTAMP_UTC = '${utcTimestamp}';
export const BUILD_TIMESTAMP_IST = '${istTimestamp}';
export const BUILD_TIMESTAMP_IST_READABLE = '${istReadable}';
`
  );

  fs.writeFileSync(
    path.join(__dirname, 'public', 'version.json'),
    JSON.stringify({
      version: commitId,
      buildTimestampUtc: utcTimestamp,
      buildTimestampIst: istTimestamp,
      buildTimestampIstReadable: istReadable
    }, null, 2) + '\n'
  );
};

try {
  // Get the current git commit hash
  const commitId = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  writeVersionFiles(commitId);
  console.log(`Version file generated with commit: ${commitId}`);
} catch (error) {
  console.error('Failed to generate version file:', error.message);
  // Fallback to a default version if git command fails
  writeVersionFiles('unknown');
}
