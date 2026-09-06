const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createApp({ config, store }) {
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 'loopback');
  app.use(express.json({ limit: '16kb' }));
  const downloadRoot = path.resolve(config.downloads.dir);
  const digest = value => crypto.createHash('sha256').update(value).digest();
  const failedAuth = new Map();
  function requireAdmin(req, res, next) {
    res.set('Cache-Control', 'no-store');
    if (!config.adminToken) return res.status(503).json({ error: '管理密钥尚未配置' });
    const now = Date.now();
    for (const [ip, value] of failedAuth) if (value.until < now) failedAuth.delete(ip);
    const attempts = failedAuth.get(req.ip);
    if (attempts?.count >= 20) return res.status(429).json({ error: '尝试次数过多，请一分钟后重试' });
    const token = (req.get('authorization') || '').replace(/^Bearer /, '');
    if (!crypto.timingSafeEqual(digest(token), digest(config.adminToken))) {
      failedAuth.set(req.ip, { count: (attempts?.count || 0) + 1, until: attempts?.until || now + 60000 });
      return res.status(401).json({ error: '管理密钥不正确' });
    }
    failedAuth.delete(req.ip);
    next();
  }
  function resolveFile(file) {
    if (!/^(?:XenoTerm-Setup-\d+\.\d+\.\d+\.exe(?:\.blockmap)?|latest\.yml)$/.test(file)) return null;
    const target = path.join(downloadRoot, file);
    try {
      const real = fs.realpathSync(target);
      if (!real.startsWith(fs.realpathSync(downloadRoot) + path.sep) || !fs.statSync(real).isFile()) return null;
      return real;
    } catch { return null; }
  }
  function serveDownload(req, res, next) {
    const file = req.params.fileName;
    const target = resolveFile(file);
    if (!target) return res.status(404).json({ success: false, error: '文件不存在' });
    const version = /\d+\.\d+\.\d+/.exec(file)?.[0] || (file === 'latest.yml' ? /^version:\s*(\S+)/m.exec(fs.readFileSync(target, 'utf8'))?.[1] : null);
    const type = file === 'latest.yml' ? 'update_check' : req.path.startsWith('/api/update/') ? 'update_download' : 'manual_download';
    const source = type === 'update_check' || type === 'update_download' ? 'auto-updater' : 'website';
    // Count served downloads, not HEAD checks, failed transfers, blockmaps or
    // resumed chunks. Coalesce retries by client + file for 30 minutes.
    if (req.method === 'GET' && (file === 'latest.yml' || file.endsWith('.exe'))) {
      const key = crypto.createHmac('sha256', config.adminToken || 'local-stats').update(`${req.ip}|${req.get('user-agent') || ''}|${file}`).digest('hex');
      res.on('finish', () => {
        const firstRange = /^bytes 0-/i.test(res.getHeader('content-range') || '');
        if (res.statusCode === 200 || (res.statusCode === 206 && firstRange)) {
          try { store.record({ type, file, version, source }, key); } catch (err) { console.error('[stats]', err.message); }
        }
      });
    }
    if (file === 'latest.yml') res.set('Cache-Control', 'no-cache');
    if (file.endsWith('.exe')) res.attachment(file);
    res.sendFile(target, err => { if (err) next(err); });
  }
  app.get('/api/health', (req, res) => res.json({ status: 'ok', edition: 'free', time: new Date().toISOString() }));
  app.get('/api/release', (req, res) => {
    res.set('Cache-Control', 'no-cache');
    try {
      const release = JSON.parse(fs.readFileSync(path.join(downloadRoot, 'release.json'), 'utf8'));
      if (!resolveFile(release.fileName)) throw Error('missing release');
      res.json({ ...release, free: true, downloadUrl: '/api/download/' + release.fileName });
    } catch { res.status(503).json({ error: '安装包暂不可用，请稍后重试' }); }
  });
  app.get(['/api/download/:fileName', '/api/update/:fileName', '/downloads/:fileName'], serveDownload);
  app.get('/api/stats/downloads', requireAdmin, (req, res) => {
    const days = Math.max(1, Math.min(365, Number.parseInt(req.query.days, 10) || 30));
    res.json({ success: true, ...store.stats(days) });
  });
  // Older clients must upgrade; these endpoints can no longer create charges.
  app.all(['/api/pay/*', '/api/license/*'], (req, res) => res.status(410).json({ success: false, free: true, code: 'FREE_EDITION', error: 'XenoTerm 已免费，请下载新版，无需购买或激活。', downloadUrl: config.downloads.publicBaseUrl }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.status === 416 ? '无效的下载范围' : '请求未完成' });
  });
  return app;
}
if (require.main === module) {
  const config = require('./config');
  const store = require('./db').createStore(path.join(config.dataDir, 'license.db'));
  const server = createApp({ config, store }).listen(config.port, config.host, () => console.log(`XenoTerm free server listening on ${config.host}:${config.port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => server.close(() => { store.close(); process.exit(0); }));
}
module.exports = { createApp };
