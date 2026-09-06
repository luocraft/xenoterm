var path2 = require('path');
var { execSync } = require('child_process');

var rootDir = path2.resolve(__dirname, '..');

console.log('[build-installer] Building NSIS installer from prepackaged app...');
try {
  execSync('npx electron-builder --win nsis --prepackaged release/win-unpacked', {
    cwd: rootDir,
    stdio: 'inherit',
    env: process.env
  });
  console.log('[build-installer] Done!');
} catch (e) {
  console.error('[build-installer] electron-builder failed');
  process.exit(1);
}
