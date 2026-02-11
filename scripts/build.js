/**
 * Build script - works around file encryption software.
 * 1. Build with asar:false so files are unpacked
 * 2. Use Node.js (transparent decrypt) to manually create asar
 * 3. This way the asar contains clean unencrypted data
 * 4. Also handle ssh2 native module by keeping it unpacked
 */
var fs2 = require('fs');
var path2 = require('path');
var { execSync } = require('child_process');
var asar = require('@electron/asar');

var rootDir = path2.resolve(__dirname, '..');

console.log('[build] Running electron-builder (asar:false)...');
try {
  execSync('npx electron-builder --win', {
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
  console.error('[build] app dir not found');
  process.exit(1);
}

// Move ssh2 native module out before creating asar
var ssh2Src = path2.join(appDir, 'node_modules', 'ssh2');
var ssh2Dest = path2.join(unpackDir, 'node_modules', 'ssh2');

if (fs2.existsSync(ssh2Src)) {
  console.log('[build] Moving ssh2 to unpacked...');
  fs2.mkdirSync(path2.join(unpackDir, 'node_modules'), { recursive: true });
  fs2.cpSync(ssh2Src, ssh2Dest, { recursive: true });
  fs2.rmSync(ssh2Src, { recursive: true, force: true });
}

// Create asar from app dir using Node.js (transparent decrypt)
console.log('[build] Creating asar from app dir...');
asar.createPackage(appDir, asarPath).then(function() {
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