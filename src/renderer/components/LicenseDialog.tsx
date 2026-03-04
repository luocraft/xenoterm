import React, { useState, useEffect, useCallback, useRef } from 'react';
import QRCode from 'qrcode';
import { useT } from '../i18n';
interface LicenseStatus {
  licensed: boolean;
  trial: boolean;
  daysLeft: number;
  expired: boolean;
  licenseKey?: string;
  licenseExpired?: boolean;
  licenseDaysLeft?: number;
  expiresAt?: string;
}

// ============ License Status Bar (shown in Sidebar) ============

export function LicenseStatusBar({ onClick }: { onClick: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<LicenseStatus | null>(null);

  useEffect(() => {
    window.api.license.getStatus().then(setStatus).catch(() => {});
  }, []);

  if (!status) return null;

  if (status.licensed) {
    return (
      <button onClick={onClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[var(--color-hover-bg)]">
        <span className="text-xs">✅</span>
        <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>
          {t('license.licensed')}
          {status.licenseDaysLeft != null && status.licenseDaysLeft <= 30 && (
            <span style={{ color: '#ef4444', marginLeft: 4 }}>({status.licenseDaysLeft}d)</span>
          )}
        </span>
      </button>
    );
  }

  if (status.licenseExpired) {
    return (
      <button onClick={onClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
        style={{ backgroundColor: '#ef444415' }}>
        <span className="text-xs">⚠️</span>
        <span className="text-[10px] font-medium" style={{ color: '#ef4444' }}>{t('license.licenseExpired')}</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>{t('license.renew')}</span>
      </button>
    );
  }

  if (status.expired) {
    return (
      <button onClick={onClick}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors"
        style={{ backgroundColor: '#ef444415' }}>
        <span className="text-xs">⚠️</span>
        <span className="text-[10px] font-medium" style={{ color: '#ef4444' }}>{t('license.trialExpired')}</span>
        <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium"
          style={{ backgroundColor: '#ef444420', color: '#ef4444' }}>{t('license.buy')}</span>
      </button>
    );
  }

  return (
    <button onClick={onClick}
      className="w-full flex items-center gap-2 px-2 py-1.5 rounded-lg text-left transition-colors hover:bg-[var(--color-hover-bg)]">
      <span className="text-xs">⏳</span>
      <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>
        {t('license.trialDays', { days: String(status.daysLeft) })}
      </span>
      <span className="ml-auto text-[9px] px-1.5 py-0.5 rounded-full font-medium"
        style={{ backgroundColor: 'var(--color-accent)', color: '#fff', opacity: 0.8 }}>{t('license.buy')}</span>
    </button>
  );
}


// ============ Main License Dialog ============

type DialogTab = 'status' | 'activate' | 'buy';

export function LicenseDialog({ onClose }: { onClose: () => void }) {
  const t = useT();
  const [status, setStatus] = useState<LicenseStatus | null>(null);
  const [machineId, setMachineId] = useState('');
  const [tab, setTab] = useState<DialogTab>('status');
  const [activateKey, setActivateKey] = useState('');
  const [activateMsg, setActivateMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [activating, setActivating] = useState(false);

  // Payment state
  const [payType, setPayType] = useState<'alipay' | 'wxpay'>('alipay');
  const [qrUrl, setQrUrl] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [payStatus, setPayStatus] = useState<'idle' | 'loading' | 'polling' | 'success' | 'error'>('idle');
  const [payError, setPayError] = useState('');
  const [paidLicenseKey, setPaidLicenseKey] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await window.api.license.getStatus();
      setStatus(s);
      const mid = await window.api.license.getMachineId();
      setMachineId(mid);
      if (s.expired && !s.licensed) setTab('buy');
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [refreshStatus]);

  // Activate license key
  const handleActivate = async () => {
    if (!activateKey.trim()) return;
    setActivating(true);
    setActivateMsg(null);
    try {
      const res = await window.api.license.activate(activateKey.trim());
      if (res.success) {
        setActivateMsg({ ok: true, text: 'Activated successfully!' });
        await refreshStatus();
      } else {
        setActivateMsg({ ok: false, text: res.error || 'Activation failed' });
      }
    } catch (err: any) {
      setActivateMsg({ ok: false, text: err.message || 'Network error' });
    }
    setActivating(false);
  };

  // Create payment
  const handleCreatePayment = async () => {
    setPayStatus('loading');
    setPayError('');
    setQrUrl(null);
    setPaidLicenseKey(null);
    if (pollRef.current) clearInterval(pollRef.current);
    try {
      const res = await window.api.license.createPayment(payType);
      if (res.success && res.qrCodeUrl && res.orderId) {
        setQrUrl(res.qrCodeUrl);
        setOrderId(res.orderId);
        setPayStatus('polling');
        // Poll for payment completion
        pollRef.current = setInterval(async () => {
          try {
            const q = await window.api.license.queryPayment(res.orderId!);
            console.log('[License] poll result:', JSON.stringify(q));
            if (q.success && q.status === 'paid' && q.licenseKey) {
              if (pollRef.current) clearInterval(pollRef.current);
              setPaidLicenseKey(q.licenseKey);
              setPayStatus('success');
              // Auto-activate
              setActivateKey(q.licenseKey);
            }
          } catch (e) {
            console.error('[License] poll error:', e);
          }
        }, 3000);
      } else {
        setPayStatus('error');
        setPayError(res.error || 'Failed to create payment');
      }
    } catch (err: any) {
      setPayStatus('error');
      setPayError(err.message || 'Network error');
    }
  };

  const tabStyle = (t: DialogTab) => ({
    color: tab === t ? 'var(--color-accent)' : 'var(--color-text-dim)',
    borderBottom: tab === t ? '2px solid var(--color-accent)' : '2px solid transparent',
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'var(--color-overlay)' }} onClick={onClose}>
      <div className="rounded-xl shadow-2xl w-[420px] max-h-[80vh] overflow-hidden flex flex-col"
        style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-border)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}>

        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-4 pb-2">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            🔑 License Management
          </h2>
          <button onClick={onClose} className="w-6 h-6 rounded-md flex items-center justify-center text-xs
            hover:bg-[var(--color-hover-bg)] transition-colors" style={{ color: 'var(--color-text-dim)' }}>✕</button>
        </div>

        {/* Tabs */}
        <div className="flex gap-4 px-4 text-[11px] font-medium">
          <button style={tabStyle('status')} className="pb-1.5 transition-colors" onClick={() => setTab('status')}>{t('license.tabStatus')}</button>
          <button style={tabStyle('activate')} className="pb-1.5 transition-colors" onClick={() => setTab('activate')}>{t('license.tabActivate')}</button>
          <button style={tabStyle('buy')} className="pb-1.5 transition-colors" onClick={() => setTab('buy')}>{t('license.tabBuy')}</button>
        </div>
        <div className="h-px" style={{ backgroundColor: 'var(--color-border)' }} />

        {/* Content */}
        <div className="p-4 overflow-y-auto flex-1">
          {tab === 'status' && status && <StatusTab status={status} machineId={machineId} onRenew={() => setTab('buy')} />}
          {tab === 'activate' && (
            <ActivateTab
              activateKey={activateKey}
              setActivateKey={setActivateKey}
              activateMsg={activateMsg}
              activating={activating}
              onActivate={handleActivate}
            />
          )}
          {tab === 'buy' && (
            <BuyTab
              payType={payType}
              setPayType={setPayType}
              payStatus={payStatus}
              payError={payError}
              qrUrl={qrUrl}
              paidLicenseKey={paidLicenseKey}
              onCreatePayment={handleCreatePayment}
              onActivate={async () => { setTab('activate'); }}
            />
          )}
        </div>
      </div>
    </div>
  );
}


// ============ Tab: Status ============

function StatusTab({ status, machineId, onRenew }: { status: LicenseStatus; machineId: string; onRenew: () => void }) {
  const t = useT();
  const [copied, setCopied] = useState(false);

  const copyMachineId = () => {
    navigator.clipboard.writeText(machineId);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-3">
      {/* License state */}
      <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">{status.licensed ? '✅' : (status.licenseExpired || status.expired) ? '🚫' : '⏳'}</span>
          <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {status.licensed ? t('license.licensed') : status.licenseExpired ? t('license.licenseExpired') : status.expired ? t('license.trialExpired') : 'Free Trial'}
          </span>
        </div>
        {status.licensed && status.licenseKey && (
          <>
            <p className="text-[10px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
              Key: {status.licenseKey}
            </p>
            {status.expiresAt && (
              <p className="text-[10px] mt-1" style={{ color: 'var(--color-text-dim)' }}>
                {t('license.expiresAt', { date: new Date(status.expiresAt).toLocaleDateString() })}
              </p>
            )}
            {status.licenseDaysLeft != null && status.licenseDaysLeft >= 0 && (
              <div className="flex items-center gap-2 mt-1.5">
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
                  <div className="h-full rounded-full transition-all"
                    style={{
                      width: `${Math.min(100, (status.licenseDaysLeft / 365) * 100)}%`,
                      backgroundColor: status.licenseDaysLeft <= 30 ? '#ef4444' : 'var(--color-accent)',
                    }} />
                </div>
                <span className="text-[10px] font-medium" style={{ color: status.licenseDaysLeft <= 30 ? '#ef4444' : 'var(--color-text-dim)' }}>
                  {t('license.licenseDays', { days: String(status.licenseDaysLeft) })}
                </span>
              </div>
            )}
          </>
        )}
        {!status.licensed && !status.expired && !status.licenseExpired && (
          <div className="flex items-center gap-2">
            <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-border)' }}>
              <div className="h-full rounded-full transition-all"
                style={{
                  width: `${(status.daysLeft / 15) * 100}%`,
                  backgroundColor: status.daysLeft <= 3 ? '#ef4444' : 'var(--color-accent)',
                }} />
            </div>
            <span className="text-[10px] font-medium" style={{ color: status.daysLeft <= 3 ? '#ef4444' : 'var(--color-text-dim)' }}>
              {status.daysLeft} days left
            </span>
          </div>
        )}
        {status.licenseExpired && (
          <div>
            <p className="text-[10px]" style={{ color: '#ef4444' }}>
              {t('license.licenseExpired')}
            </p>
            {status.licenseKey && (
              <p className="text-[10px] font-mono mt-1" style={{ color: 'var(--color-text-dim)' }}>
                Key: {status.licenseKey}
              </p>
            )}
            <button onClick={onRenew}
              className="mt-2 w-full py-1.5 text-xs rounded-lg text-white font-medium"
              style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}>
              {t('license.renew')}
            </button>
          </div>
        )}
        {status.expired && !status.licenseExpired && (
          <p className="text-[10px]" style={{ color: '#ef4444' }}>
            Your trial has expired. Please purchase a license to continue using XenoTerm.
          </p>
        )}
      </div>

      {/* Machine ID */}
      <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
        <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--color-text-dim)' }}>{t('license.machineId')}</p>
        <div className="flex items-center gap-2">
          <code className="text-[10px] font-mono flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
            {machineId}
          </code>
          <button onClick={copyMachineId}
            className="text-[10px] px-2 py-0.5 rounded transition-colors hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--color-accent)' }}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ============ Tab: Activate ============

function ActivateTab({
  activateKey, setActivateKey, activateMsg, activating, onActivate
}: {
  activateKey: string;
  setActivateKey: (v: string) => void;
  activateMsg: { ok: boolean; text: string } | null;
  activating: boolean;
  onActivate: () => void;
}) {
  return (
    <div className="space-y-3">
      <p className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
        Enter your license key to activate XenoTerm.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); onActivate(); }}>
        <input
          type="text"
          value={activateKey}
          onChange={(e) => setActivateKey(e.target.value.toUpperCase())}
          placeholder="XENO-XXXX-XXXX-XXXX-XXXX"
          className="w-full px-3 py-2 text-xs font-mono rounded-lg outline-none focus:border-[var(--color-accent)] transition-colors tracking-wider text-center"
          style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
        />
        <button type="submit" disabled={activating || !activateKey.trim()}
          className="w-full mt-3 py-2 text-xs rounded-lg text-white font-medium transition-opacity disabled:opacity-40"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}>
          {activating ? 'Activating...' : 'Activate License'}
        </button>
      </form>
      {activateMsg && (
        <div className="p-2 rounded-lg text-[11px] text-center"
          style={{
            backgroundColor: activateMsg.ok ? '#22c55e15' : '#ef444415',
            color: activateMsg.ok ? '#22c55e' : '#ef4444',
          }}>
          {activateMsg.ok ? '✅ ' : '❌ '}{activateMsg.text}
        </div>
      )}
    </div>
  );
}

// ============ Tab: Buy ============

function QrCanvas({ data, size }: { data: string; size: number }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    if (ref.current) {
      QRCode.toCanvas(ref.current, data, { width: size, margin: 2 });
    }
  }, [data, size]);
  return <canvas ref={ref} className="rounded-lg" style={{ border: '1px solid var(--color-border)', width: size, height: size }} />;
}

function BuyTab({
  payType, setPayType, payStatus, payError, qrUrl, paidLicenseKey, onCreatePayment, onActivate
}: {
  payType: 'alipay' | 'wxpay';
  setPayType: (v: 'alipay' | 'wxpay') => void;
  payStatus: string;
  payError: string;
  qrUrl: string | null;
  paidLicenseKey: string | null;
  onCreatePayment: () => void;
  onActivate: () => void;
}) {
  const t = useT();
  if (payStatus === 'success' && paidLicenseKey) {
    return (
      <div className="text-center space-y-3">
        <span className="text-3xl">🎉</span>
        <p className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>{t('license.paySuccess')}</p>
        <div className="p-3 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
          <p className="text-[10px] mb-1" style={{ color: 'var(--color-text-dim)' }}>Your License Key</p>
          <p className="text-xs font-mono font-semibold tracking-wider" style={{ color: 'var(--color-accent)' }}>
            {paidLicenseKey}
          </p>
        </div>
        <button onClick={onActivate}
          className="w-full py-2 text-xs rounded-lg text-white font-medium"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), #8b5cf6)' }}>
          {t('license.activateNow')}
        </button>
      </div>
    );
  }

  if (payStatus === 'polling' && qrUrl) {
    return (
      <div className="text-center space-y-3">
        <p className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>
          {t('license.scanQr')}
        </p>
        <div className="flex justify-center">
          <QrCanvas data={qrUrl} size={192} />
        </div>
        <div className="flex items-center justify-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-[var(--color-accent)] animate-pulse" />
          <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{t('license.waitingPay')}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="p-3 rounded-lg text-center" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-border)' }}>
        <p className="text-lg font-bold" style={{ color: 'var(--color-text-primary)' }}>¥99</p>
        <p className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{t('license.productName')}</p>
        <p className="text-[9px] mt-1" style={{ color: 'var(--color-text-dim)' }}>{t('license.productDesc')}</p>
      </div>

      {/* Payment method */}
      <div className="flex gap-2">
        {(['alipay', 'wxpay'] as const).map((pt) => (
          <button key={pt} onClick={() => setPayType(pt)}
            className="flex-1 py-2 rounded-lg text-xs font-medium transition-all"
            style={{
              backgroundColor: payType === pt ? (pt === 'alipay' ? '#1677ff15' : '#07c16015') : 'var(--color-input-bg)',
              border: `1px solid ${payType === pt ? (pt === 'alipay' ? '#1677ff' : '#07c160') : 'var(--color-border)'}`,
              color: payType === pt ? (pt === 'alipay' ? '#1677ff' : '#07c160') : 'var(--color-text-dim)',
            }}>
            {pt === 'alipay' ? t('license.alipay') : t('license.wxpay')}
          </button>
        ))}
      </div>

      <button onClick={onCreatePayment} disabled={payStatus === 'loading'}
        className="w-full py-2 text-xs rounded-lg text-white font-medium transition-opacity disabled:opacity-40"
        style={{ background: payType === 'alipay' ? 'linear-gradient(135deg, #1677ff, #4096ff)' : 'linear-gradient(135deg, #07c160, #2aae67)' }}>
        {payStatus === 'loading' ? 'Creating order...' : t('license.payNow')}
      </button>

      {payStatus === 'error' && payError && (
        <div className="p-2 rounded-lg text-[11px] text-center" style={{ backgroundColor: '#ef444415', color: '#ef4444' }}>
          ❌ {payError}
        </div>
      )}
    </div>
  );
}
