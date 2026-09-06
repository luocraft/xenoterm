const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionsDir = path.join(rootDir, 'extensions');

fs.mkdirSync(extensionsDir, { recursive: true });

const entries = fs
  .readdirSync(extensionsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

if (entries.length === 0) {
  console.log('[build-extensions] No extensions found, skipping.');
} else {
  console.log(`[build-extensions] Found ${entries.length} extension(s): ${entries.join(', ')}`);
}
