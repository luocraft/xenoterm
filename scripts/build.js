/**
 * Build script - works around file encryption software.
 * 1. Build with asar:false so files are unpacked
 * 2. Use Node.js (transparent decrypt) to manually create asar
 * 3. This way the asar contains clean unencrypted data
 * 4. Keep native modules unpacked so Electron can load them reliably
 */
var fs2 = require('fs');
var path2 = require('path');
var { execSync } = require('child_process');
var asar = require('@electron/asar');

var rootDir = path2.resolve(__dirname, '..');

console.log('[build] Running electron-builder (asar:false)...');
try {
  execSync('npx electron-builder --win --dir', {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });
} catch (e) {
  console.error('[build] electron-builder failed');
  process.exit(1);
}

var appDir = path2.join(rootDir, 'release', 'win-unpacked', 'resources', 'app');
var asarPath = path2.join(rootDir, 'release', 'win-unpacked', 'resources', 'app.asar');
var unpackDir = path2.join(rootDir, 'release', 'win-unpacked', 'resources', 'app.asar.unpacked');

if (!fs2.existsSync(appDir)) {
  if (fs2.existsSync(asarPath)) {
    console.log('[build] app.asar already exists, skipping manual asar creation.');
    process.exit(0);
  }
  console.error('[build] app dir not found');
  process.exit(1);
}

if (fs2.existsSync(asarPath)) {
  fs2.rmSync(asarPath, { force: true });
}
if (fs2.existsSync(unpackDir)) {
  fs2.rmSync(unpackDir, { recursive: true, force: true });
}

// Create asar from app dir using Node.js (transparent decrypt)
console.log('[build] Creating asar from app dir...');
asar.createPackageWithOptions(appDir, asarPath, {
  unpack: '**/*.{node,dll,exe}'
}).then(function() {
  // Verify
  try {
    var buf = asar.extractFile(asarPath, 'package.json');
    var parsed = JSON.parse(buf.toString('utf-8'));
    console.log('[build] asar verified OK:', parsed.name, parsed.version);
  } catch (e) {
    console.error('[build] asar verification FAILED:', e.message);
  }

  // Remove the unpacked app dir (asar replaces it)
  fs2.rmSync(appDir, { recursive: true, force: true });
  console.log('[build] Done!');
});
