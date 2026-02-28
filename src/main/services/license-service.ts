import { app } from 'electron';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import * as os from 'os';

// ============ Config ============

const LICENSE_SERVER = 'http://39.105.198.48:3000'; // Change to your domain later
const LICENSE_SECRET = '012a91f83ff088b7876cf490a16d1f8ad77a24a5179edd1664876b7e1c0ba406'; // Must match server config

// ============ Machine ID ============

function getRawMachineId(): string {
  const interfaces = os.networkInterfaces();
  const macs: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      if (!iface.internal && iface.mac && iface.mac !== '00:00:00:00:00:00') {
        macs.push(iface.mac);
      }
    }
  }
  macs.sort();
  const raw = macs.length > 0 ? macs[0] : os.hostname();
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 32);
}

let cachedMachineId: string | null = null;
export function getMachineId(): string {
  if (!cachedMachineId) cachedMachineId = getRawMachineId();
  return cachedMachineId;
}

// ============ Local Storage ============

interface LicenseData {
  licenseKey?: string;
  machineId?: string;
  signature?: string;
  trialStart?: string; // ISO date string
  extensions?: string[];    // Licensed extension IDs
  bundles?: string[];       // Purchased bundle IDs
}

function getLicensePath(): string {
  return path.join(app.getPath('userData'), '.license');
}

function readLicenseData(): LicenseData {
  try {
    const raw = fs.readFileSync(getLicensePath(), 'utf-8');
    // Simple obfuscation: base64
    const json = Buffer.from(raw, 'base64').toString('utf-8');
    return JSON.parse(json);
  } catch {
    return {};
  }
}

function writeLicenseData(data: LicenseData): void {
  const json = JSON.stringify(data);
  const encoded = Buffer.from(json).toString('base64');
  fs.writeFileSync(getLicensePath(), encoded, 'utf-8');
}

// ============ Trial ============

export function getTrialInfo(): { isTrialing: boolean; daysLeft: number; expired: boolean } {
  const data = readLicenseData();
  if (!data.trialStart) {
    // First launch - start trial
    data.trialStart = new Date().toISOString();
    writeLicenseData(data);
  }

  const start = new Date(data.trialStart);
  const now = new Date();
  const elapsed = Math.floor((now.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
  const daysLeft = Math.max(0, 15 - elapsed);

  return {
    isTrialing: daysLeft > 0,
    daysLeft,
    expired: daysLeft <= 0,
  };
}

// ============ License Verification ============

function verifySignatureOffline(licenseKey: string, machineId: string, signature: string): boolean {
  const expected = crypto
    .createHmac('sha256', LICENSE_SECRET)
    .update(`${licenseKey}:${machineId}`)
    .digest('hex');
  return expected === signature;
}

export function isLicensed(): boolean {
  const data = readLicenseData();
  if (!data.licenseKey || !data.machineId || !data.signature) return false;
  // Offline verification
  return verifySignatureOffline(data.licenseKey, data.machineId, data.signature);
}

export async function verifyLicenseOnline(): Promise<boolean> {
  const data = readLicenseData();
  if (!data.licenseKey || !data.machineId) return false;

  try {
    const res = await fetch(`${LICENSE_SERVER}/api/license/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey: data.licenseKey, machineId: data.machineId }),
    });
    const result = await res.json();
    if (result.success && result.valid && result.signature) {
      // Update local signature
      data.signature = result.signature;
      writeLicenseData(data);
      return true;
    }
    return false;
  } catch {
    // Network error - fall back to offline check
    return isLicensed();
  }
}

// ============ Activation ============

export async function activateLicense(licenseKey: string): Promise<{ success: boolean; error?: string }> {
  const machineId = getMachineId();
  try {
    const res = await fetch(`${LICENSE_SERVER}/api/license/activate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseKey, machineId }),
    });
    const result = await res.json();
    if (result.success) {
      const data = readLicenseData();
      data.licenseKey = licenseKey;
      data.machineId = machineId;
      data.signature = result.signature;
      writeLicenseData(data);
      return { success: true };
    }
    return { success: false, error: result.error };
  } catch (err: any) {
    return { success: false, error: 'Network error: ' + err.message };
  }
}

// ============ Payment ============

export async function createPayment(payType: 'wxpay' | 'alipay' = 'wxpay'): Promise<{
  success: boolean;
  orderId?: string;
  qrCodeUrl?: string;
  error?: string;
}> {
  try {
    const res = await fetch(`${LICENSE_SERVER}/api/pay/create`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ payType }),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: 'Network error: ' + err.message };
  }
}

export async function queryPayment(orderId: string): Promise<{
  success: boolean;
  status?: string;
  licenseKey?: string;
}> {
  try {
    const res = await fetch(`${LICENSE_SERVER}/api/pay/query/${orderId}`);
    return await res.json();
  } catch {
    return { success: false };
  }
}

// ============ Status Summary ============

export function getLicenseStatus(): {
  licensed: boolean;
  trial: boolean;
  daysLeft: number;
  expired: boolean;
  licenseKey?: string;
} {
  if (isLicensed()) {
    const data = readLicenseData();
    return { licensed: true, trial: false, daysLeft: 0, expired: false, licenseKey: data.licenseKey };
  }
  const trial = getTrialInfo();
  return {
    licensed: false,
    trial: trial.isTrialing,
    daysLeft: trial.daysLeft,
    expired: trial.expired,
  };
}

// ============ Extension License ============

export function isExtensionLicensed(extensionId: string): boolean {
  // During trial, all extensions are available
  const trial = getTrialInfo();
  if (trial.isTrialing) return true;

  // If fully licensed (legacy key), all extensions available
  if (isLicensed()) return true;

  // Check per-extension license
  const data = readLicenseData();
  return (data.extensions ?? []).includes(extensionId);
}

export function addExtensionLicense(extensionId: string): void {
  const data = readLicenseData();
  if (!data.extensions) data.extensions = [];
  if (!data.extensions.includes(extensionId)) {
    data.extensions.push(extensionId);
  }
  // Re-sign the data
  data.signature = signLicenseData(data);
  writeLicenseData(data);
}

export function addBundleLicense(bundleId: string, extensionIds: string[]): void {
  const data = readLicenseData();
  if (!data.bundles) data.bundles = [];
  if (!data.bundles.includes(bundleId)) {
    data.bundles.push(bundleId);
  }
  if (!data.extensions) data.extensions = [];
  for (const id of extensionIds) {
    if (!data.extensions.includes(id)) {
      data.extensions.push(id);
    }
  }
  data.signature = signLicenseData(data);
  writeLicenseData(data);
}

export function getLicensedExtensions(): string[] {
  const data = readLicenseData();
  return data.extensions ?? [];
}

function signLicenseData(data: LicenseData): string {
  const payload = JSON.stringify({
    licenseKey: data.licenseKey,
    machineId: data.machineId,
    extensions: data.extensions,
    bundles: data.bundles
  });
  return crypto.createHmac('sha256', LICENSE_SECRET).update(payload).digest('hex');
}
