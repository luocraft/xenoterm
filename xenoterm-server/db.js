const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

function createStore(filename) {
  if (filename !== ':memory:') fs.mkdirSync(path.dirname(filename), { recursive: true });
  const db = new Database(filename);
  db.pragma('journal_mode = WAL');
  // Keep the existing database and all historical orders/licenses intact.
  db.exec(`
    CREATE TABLE IF NOT EXISTS download_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, event_type TEXT NOT NULL,
      file_name TEXT, version TEXT, source TEXT, client_ip TEXT, user_agent TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_download_events_type_created_at ON download_events(event_type, created_at DESC);
    CREATE TABLE IF NOT EXISTS download_dedup (key TEXT PRIMARY KEY, seen_at INTEGER NOT NULL);
  `);
  const insert = db.prepare(`INSERT INTO download_events (event_type,file_name,version,source) VALUES (?,?,?,?)`);
  const seen = db.prepare('SELECT seen_at FROM download_dedup WHERE key = ?');
  const saveSeen = db.prepare('INSERT OR REPLACE INTO download_dedup (key,seen_at) VALUES (?,?)');
  const prune = db.prepare('DELETE FROM download_dedup WHERE seen_at < ?');
  const record = db.transaction((event, key, now = Date.now()) => {
    prune.run(now - 30 * 60 * 1000);
    if (seen.get(key)) return false;
    insert.run(event.type, event.file, event.version, event.source);
    saveSeen.run(key, now);
    return true;
  });
  const counts = `
    COALESCE(SUM(event_type='manual_download'),0) AS manual_downloads,
    COALESCE(SUM(event_type='update_download'),0) AS update_downloads,
    COALESCE(SUM(event_type='update_check'),0) AS update_checks,
    COALESCE(SUM(event_type IN ('manual_download','update_download')),0) AS downloads`;
  function stats(days = 30) {
    const summary = db.prepare(`SELECT ${counts}, COUNT(*) AS total_events, MAX(created_at) AS last_event_at FROM download_events`).get();
    summary.today_downloads = db.prepare(`SELECT COUNT(*) AS n FROM download_events WHERE event_type IN ('manual_download','update_download') AND date(created_at,'+8 hours')=date('now','+8 hours')`).get().n;
    const daily = db.prepare(`SELECT date(created_at,'+8 hours') AS day, ${counts} FROM download_events WHERE date(created_at,'+8 hours') >= date('now','+8 hours',?) GROUP BY day ORDER BY day`).all(`-${days - 1} days`);
    const byVersion = db.prepare(`SELECT COALESCE(version,'unknown') AS version, ${counts} FROM download_events GROUP BY version ORDER BY MAX(created_at) DESC`).all();
    const recent = db.prepare(`SELECT id,event_type,file_name,version,source,created_at FROM download_events ORDER BY id DESC LIMIT 50`).all();
    return { summary, daily, byVersion, recent, timezone: 'Asia/Shanghai', days };
  }
  return { db, record, stats, close: () => db.close() };
}
module.exports = { createStore };
