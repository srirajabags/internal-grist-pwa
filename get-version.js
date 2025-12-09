#!/usr/bin/env node

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

try {
  // Get the current git commit hash
  const commitId = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  
  // Create version info
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
  
  // Write to a version file that can be imported
  const versionFilePath = path.join(__dirname, 'src', 'version.js');
  const versionContent = `// Auto-generated version file
export const APP_VERSION = '${commitId}';
export const BUILD_TIMESTAMP_UTC = '${utcTimestamp}';
export const BUILD_TIMESTAMP_IST = '${istTimestamp}';
export const BUILD_TIMESTAMP_IST_READABLE = '${istReadable}';
`;
  
  fs.writeFileSync(versionFilePath, versionContent);
  console.log(`Version file generated with commit: ${commitId}`);
} catch (error) {
  console.error('Failed to generate version file:', error.message);
  // Fallback to a default version if git command fails
  const fallbackVersion = 'unknown';
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
  
  const versionFilePath = path.join(__dirname, 'src', 'version.js');
  const versionContent = `// Auto-generated version file
export const APP_VERSION = '${fallbackVersion}';
export const BUILD_TIMESTAMP_UTC = '${utcTimestamp}';
export const BUILD_TIMESTAMP_IST = '${istTimestamp}';
export const BUILD_TIMESTAMP_IST_READABLE = '${istReadable}';
`;
  fs.writeFileSync(versionFilePath, versionContent);
}