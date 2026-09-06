const fs = require('fs');
const path = require('path');
const dataDir = process.env.XENOTERM_DATA_DIR || path.join(__dirname, 'data');
let adminToken = process.env.XENOTERM_ADMIN_TOKEN || '';
if (!adminToken) {
  try { adminToken = fs.readFileSync(path.join(dataDir, '.admin-token'), 'utf8').trim(); } catch {}
}
module.exports = {
  port: Number(process.env.PORT || 3000),
  host: process.env.XENOTERM_HOST || '127.0.0.1',
  dataDir,
  adminToken,
  downloads: {
    dir: process.env.XENOTERM_DOWNLOADS_DIR || path.resolve(__dirname, '../xenoterm-website/downloads'),
    publicBaseUrl: process.env.XENOTERM_PUBLIC_BASE_URL || 'https://xenotech.net',
  },
};
