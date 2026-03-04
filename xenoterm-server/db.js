const Database = require('better-sqlite3');
const path = require('path');

const db = new Database(path.join(__dirname, 'data', 'license.db'));

// Enable WAL mode for better concurrent read performance
db.pragma('journal_mode = WAL');

// Create tables
db.exec(`
  CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    out_trade_no TEXT UNIQUE NOT NULL,
    license_key TEXT,
    machine_id TEXT,
    amount REAL NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    paid_at TEXT,
    activated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS licenses (
    key TEXT PRIMARY KEY,
    machine_id TEXT,
    order_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    expires_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    activated_at TEXT,
    FOREIGN KEY (order_id) REFERENCES orders(id)
  );
`);

// Prepared statements
const stmts = {
  createOrder: db.prepare(
    'INSERT INTO orders (id, out_trade_no, amount, status) VALUES (?, ?, ?, ?)'
  ),
  getOrder: db.prepare('SELECT * FROM orders WHERE id = ?'),
  getOrderByTradeNo: db.prepare('SELECT * FROM orders WHERE out_trade_no = ?'),
  updateOrderPaid: db.prepare(
    'UPDATE orders SET status = ?, license_key = ?, paid_at = CURRENT_TIMESTAMP WHERE out_trade_no = ?'
  ),
  createLicense: db.prepare(
    'INSERT INTO licenses (key, order_id, status) VALUES (?, ?, ?)'
  ),
  getLicense: db.prepare('SELECT * FROM licenses WHERE key = ?'),
  activateLicense: db.prepare(
    'UPDATE licenses SET machine_id = ?, activated_at = CURRENT_TIMESTAMP WHERE key = ? AND (machine_id IS NULL OR machine_id = ?)'
  ),
  getLicenseByMachine: db.prepare(
    "SELECT * FROM licenses WHERE machine_id = ? AND status = 'active'"
  ),
  updateLicenseExpiry: db.prepare(
    'UPDATE licenses SET expires_at = ? WHERE key = ?'
  ),
};

module.exports = { db, stmts };
