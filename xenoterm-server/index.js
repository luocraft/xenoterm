const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const md5 = require('md5');
const fs = require('fs');
const path = require('path');
const config = require('./config');

// Ensure data directory exists
const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const { stmts } = require('./db');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ============ Helper ============

function generateLicenseKey() {
  // Format: XENO-XXXX-XXXX-XXXX-XXXX
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const segments = [];
  for (let i = 0; i < 4; i++) {
    let seg = '';
    for (let j = 0; j < 4; j++) {
      seg += chars[crypto.randomInt(chars.length)];
    }
    segments.push(seg);
  }
  return 'XENO-' + segments.join('-');
}

function signLicense(licenseKey, machineId) {
  return crypto
    .createHmac('sha256', config.licenseSecret)
    .update(`${licenseKey}:${machineId}`)
    .digest('hex');
}

// YunGouOS sign: sort params alphabetically, concat as key=value&, append &key=API_KEY, then MD5 uppercase
function yungouosSign(params) {
  const sorted = Object.keys(params).sort();
  const str = sorted.map((k) => `${k}=${params[k]}`).join('&');
  return md5(str + '&key=' + config.yungouos.apiKey).toUpperCase();
}

// ============ Routes ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

// Create payment order (called by Electron client)
app.post('/api/pay/create', async (req, res) => {
  try {
    const { payType = 'native' } = req.body; // native = scan QR code
    const orderId = uuidv4();
    const outTradeNo = 'XT' + Date.now() + crypto.randomInt(1000, 9999);

    // Save order to DB
    stmts.createOrder.run(orderId, outTradeNo, config.product.price, 'pending');

    // Call YunGouOS API to create payment
    const params = {
      out_trade_no: outTradeNo,
      total_fee: String(config.product.price),
      mch_id: config.yungouos.merchantId,
      body: config.product.name,
      notify_url: config.callbackUrl,
    };
    params.sign = yungouosSign(params);

    // Determine API endpoint based on pay type
    const apiUrl =
      payType === 'alipay'
        ? 'https://api.pay.yungouos.com/api/pay/alipay/nativePay'
        : 'https://api.pay.yungouos.com/api/pay/wxpay/nativePay';

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
    });
    const result = await response.json();

    if (result.code === 0 && result.data) {
      res.json({
        success: true,
        orderId,
        outTradeNo,
        qrCodeUrl: result.data, // QR code image URL or payment URL
      });
    } else {
      res.json({ success: false, error: result.msg || 'Payment creation failed' });
    }
  } catch (err) {
    console.error('Create payment error:', err);
    res.status(500).json({ success: false, error: err.message });
  }
});

// YunGouOS payment callback (called by YunGouOS server)
app.post('/api/pay/callback', (req, res) => {
  try {
    const { code, outTradeNo, sign, ...rest } = req.body;

    // Verify sign
    const checkParams = { ...rest, code, outTradeNo };
    delete checkParams.sign;
    const expectedSign = yungouosSign(checkParams);

    if (sign !== expectedSign) {
      console.warn('Invalid callback sign');
      return res.send('FAIL');
    }

    if (code !== 1 && code !== '1') {
      return res.send('FAIL');
    }

    // Payment successful - generate license
    const order = stmts.getOrderByTradeNo.get(outTradeNo);
    if (!order) {
      console.warn('Order not found:', outTradeNo);
      return res.send('FAIL');
    }

    if (order.status === 'paid') {
      // Already processed
      return res.send('SUCCESS');
    }

    const licenseKey = generateLicenseKey();
    stmts.updateOrderPaid.run('paid', licenseKey, outTradeNo);
    stmts.createLicense.run(licenseKey, order.id, 'active');

    console.log(`Payment success: ${outTradeNo} -> License: ${licenseKey}`);
    res.send('SUCCESS');
  } catch (err) {
    console.error('Callback error:', err);
    res.send('FAIL');
  }
});

// Query order status & get license key (polled by Electron client)
app.get('/api/pay/query/:orderId', (req, res) => {
  const order = stmts.getOrder.get(req.params.orderId);
  if (!order) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }
  res.json({
    success: true,
    status: order.status,
    licenseKey: order.status === 'paid' ? order.license_key : null,
  });
});

// Activate license (bind to machine)
app.post('/api/license/activate', (req, res) => {
  const { licenseKey, machineId } = req.body;
  if (!licenseKey || !machineId) {
    return res.status(400).json({ success: false, error: 'Missing licenseKey or machineId' });
  }

  const license = stmts.getLicense.get(licenseKey);
  if (!license) {
    return res.json({ success: false, error: 'Invalid license key' });
  }
  if (license.status !== 'active') {
    return res.json({ success: false, error: 'License is not active' });
  }
  if (license.machine_id && license.machine_id !== machineId) {
    return res.json({ success: false, error: 'License already bound to another machine' });
  }

  stmts.activateLicense.run(machineId, licenseKey, machineId);
  const signature = signLicense(licenseKey, machineId);

  res.json({ success: true, licenseKey, machineId, signature });
});

// Verify license (called by Electron client on startup)
app.post('/api/license/verify', (req, res) => {
  const { licenseKey, machineId } = req.body;
  if (!licenseKey || !machineId) {
    return res.status(400).json({ success: false, valid: false });
  }

  const license = stmts.getLicense.get(licenseKey);
  if (!license || license.status !== 'active' || license.machine_id !== machineId) {
    return res.json({ success: true, valid: false });
  }

  const signature = signLicense(licenseKey, machineId);
  res.json({ success: true, valid: true, signature });
});

// ============ Start ============

app.listen(config.port, '0.0.0.0', () => {
  console.log(`XenoTerm License Server running on port ${config.port}`);
});
