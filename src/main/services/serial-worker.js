/**
 * Serial port worker process.
 * Runs under system Node.js (not Electron) to avoid Electron 28's
 * file-read issues with native addons in node_modules.
 *
 * Communication protocol (JSON over stdin/stdout):
 *   Request:  { id, method, params }
 *   Response: { id, result } | { id, error }
 *   Event:    { event, sessionId, data }
 */
const { SerialPort } = require('serialport');

const sessions = new Map(); // id -> SerialPort

process.stdin.setEncoding('utf8');

let inputBuf = '';
process.stdin.on('data', (chunk) => {
  inputBuf += chunk;
  let nl;
  while ((nl = inputBuf.indexOf('\n')) !== -1) {
    const line = inputBuf.slice(0, nl).trim();
    inputBuf = inputBuf.slice(nl + 1);
    if (line) handleMessage(line);
  }
});

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

async function handleMessage(line) {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  const { id, method, params } = msg;
  try {
    const result = await dispatch(method, params || {});
    send({ id, result });
  } catch (err) {
    send({ id, error: err.message || String(err) });
  }
}

async function dispatch(method, params) {
  switch (method) {
    case 'list':
      return listPorts();
    case 'open':
      return openPort(params);
    case 'write':
      return writePort(params);
    case 'close':
      return closePort(params);
    case 'set':
      return setSignals(params);
    case 'ping':
      return 'pong';
    default:
      throw new Error('Unknown method: ' + method);
  }
}

async function listPorts() {
  const ports = await SerialPort.list();
  return ports.map((p) => ({
    path: p.path,
    manufacturer: p.manufacturer,
    serialNumber: p.serialNumber,
    pnpId: p.pnpId,
    vendorId: p.vendorId,
    productId: p.productId,
    friendlyName: p.friendlyName,
  }));
}

function openPort({ sessionId, config }) {
  return new Promise((resolve, reject) => {
    const port = new SerialPort({
      path: config.path,
      baudRate: config.baudRate,
      dataBits: config.dataBits || 8,
      stopBits: config.stopBits || 1,
      parity: config.parity || 'none',
      rtscts: config.rtscts || false,
      xon: config.xon || false,
      xoff: config.xoff || false,
      autoOpen: false,
    });

    port.open((err) => {
      if (err) return reject(err);
      sessions.set(sessionId, port);

      port.on('data', (data) => {
        send({ event: 'data', sessionId, data: data.toString('base64') });
      });
      port.on('error', (err) => {
        send({ event: 'error', sessionId, data: err.message });
      });
      port.on('close', () => {
        send({ event: 'close', sessionId });
        sessions.delete(sessionId);
      });

      resolve({ status: 'open' });
    });
  });
}

function writePort({ sessionId, data }) {
  const port = sessions.get(sessionId);
  if (!port || !port.isOpen) throw new Error('Port not open');
  const buf = Buffer.from(data, 'base64');
  port.write(buf);
  return { written: buf.length };
}

function closePort({ sessionId }) {
  const port = sessions.get(sessionId);
  if (!port) return { status: 'already_closed' };
  if (port.isOpen) port.close();
  sessions.delete(sessionId);
  return { status: 'closed' };
}

function setSignals({ sessionId, signals }) {
  const port = sessions.get(sessionId);
  if (!port || !port.isOpen) throw new Error('Port not open');
  port.set(signals);
  return { ok: true };
}

process.on('disconnect', () => {
  for (const [id, port] of sessions) {
    try { if (port.isOpen) port.close(); } catch {}
  }
  process.exit(0);
});
