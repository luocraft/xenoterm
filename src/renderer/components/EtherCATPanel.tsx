/**
 * EtherCAT 主站调试面板 — 美化版
 */
import { useEffect, useState, useCallback, useRef } from 'react';
import { useEthercatStore, groupOdEntries } from '../store/ethercat-store';
import { useT } from '../i18n';
import type { EcSlaveUI } from '../store/ethercat-store';

const EC_STATE = { NONE: 0x00, INIT: 0x01, PRE_OP: 0x02, SAFE_OP: 0x04, OP: 0x08, ERROR: 0x10 };

const AL_STATUS_CODES: Record<number, string> = {};

function formatAlStatus(code: number, t: ReturnType<typeof useT>): string {
  if (code === 0) return '';
  const key = `ecat.al.0x${code.toString(16).padStart(4, '0')}` as any;
  const translated = t(key);
  return translated !== key ? translated : `${t('ecat.unknownError')} (0x${code.toString(16).padStart(4, '0')})`;
}

function stateLabel(s: number): string {
  if (s & EC_STATE.ERROR) return 'ERROR';
  switch (s) {
    case EC_STATE.INIT: return 'INIT';
    case EC_STATE.PRE_OP: return 'PRE-OP';
    case EC_STATE.SAFE_OP: return 'SAFE-OP';
    case EC_STATE.OP: return 'OP';
    default: return `0x${s.toString(16)}`;
  }
}

function stateColor(s: number): string {
  if (s & EC_STATE.ERROR) return '#ef4444';
  switch (s) {
    case EC_STATE.OP: return '#22c55e';
    case EC_STATE.SAFE_OP: return '#eab308';
    case EC_STATE.PRE_OP: return '#3b82f6';
    default: return 'var(--color-text-dim)';
  }
}

const inputStyle = {
  backgroundColor: 'var(--color-input-bg)',
  border: '1px solid var(--color-input-border)',
  color: 'var(--color-text-primary)',
};

const pillBtn = (active: boolean) => ({
  backgroundColor: active ? 'var(--color-accent)' : 'var(--color-input-bg)',
  color: active ? 'white' : 'var(--color-text-secondary)',
  border: '1px solid var(--color-input-border)',
});

/* ─── ConnectionBar ─── */
function ConnectionBar() {
  const t = useT();
  const { adapters, selectedAdapter, setSelectedAdapter, session,
    connect, disconnect, loadAdapters, checkAvailability, error, clearError } = useEthercatStore();

  useEffect(() => { checkAvailability(); loadAdapters(); }, [checkAvailability, loadAdapters]);

  const connected = session && session.status !== 'closed';

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 flex-shrink-0 text-xs flex-wrap"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      <select
        value={selectedAdapter}
        onChange={(e) => setSelectedAdapter(e.target.value)}
        disabled={!!connected}
        className="px-1.5 py-0.5 rounded text-[11px] outline-none max-w-[240px]"
        style={inputStyle}>
        {adapters.length === 0 && <option value="">{t('ecat.noAdapter')}</option>}
        {adapters.map((a) => (
          <option key={a.name} value={a.name}>{a.description || a.name}</option>
        ))}
      </select>

      {!connected ? (
        <button onClick={connect} disabled={!selectedAdapter}
          className="px-2 py-0.5 rounded text-[10px] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
          {t('ecat.connect')}
        </button>
      ) : (
        <button onClick={disconnect}
          className="px-2 py-0.5 rounded text-[10px] text-white hover:opacity-90" style={{ backgroundColor: '#ef4444' }}>
          {t('ecat.disconnect')}
        </button>
      )}

      {connected && (
        <span className="text-[10px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
          {t('ecat.slaves')} {session?.slaveCount ?? 0} · {session?.status}
        </span>
      )}

      {error && (
        <span className="flex items-center gap-1 ml-auto text-[10px]" style={{ color: '#ef4444' }}>
          <span className="truncate max-w-[260px]">{error}</span>
          <button onClick={clearError} className="opacity-60 hover:opacity-100">✕</button>
        </span>
      )}
    </div>
  );
}

/* ─── SlaveList ─── */
function SlaveList() {
  const t = useT();
  const { slaves, selectedSlaveIndex, selectSlave } = useEthercatStore();

  if (slaves.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
        {t('ecat.noSlaves')}
      </div>
    );
  }

  return (
    <div className="overflow-y-auto flex-1 py-0.5">
      {slaves.map((s) => {
        const selected = selectedSlaveIndex === s.index;
        return (
          <div
            key={s.index}
            onClick={() => selectSlave(s.index)}
            className="flex items-center gap-1.5 px-2 py-1 mx-0.5 rounded cursor-pointer transition-colors"
            style={{ backgroundColor: selected ? 'var(--color-hover-bg)' : 'transparent' }}
          >
            <span className="w-5 text-right text-[10px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
              #{s.index}
            </span>
            <span className="flex-1 truncate text-[11px]" title={s.name}
              style={{ color: selected ? 'var(--color-text-primary)' : 'var(--color-text-secondary)' }}>
              {s.name || `Slave ${s.index}`}
            </span>
            <span className="text-[9px] font-mono px-1 py-px rounded-sm"
              style={{ color: stateColor(s.state), backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)' }}>
              {stateLabel(s.state)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* ─── SlaveInfoTab ─── */
function SlaveInfoTab({ slave }: { slave: EcSlaveUI }) {
  const t = useT();
  const requestState = useEthercatStore((s) => s.requestState);
  const loadErrorCounters = useEthercatStore((s) => s.loadErrorCounters);
  const clearErrorCounters = useEthercatStore((s) => s.clearErrorCounters);
  const errorCounters = useEthercatStore((s) => s.errorCounters.get(slave.index));

  const stateButtons: { label: string; state: number; emoji: string }[] = [
    { label: 'INIT', state: EC_STATE.INIT, emoji: '⬜' },
    { label: 'PRE-OP', state: EC_STATE.PRE_OP, emoji: '🔵' },
    { label: 'SAFE-OP', state: EC_STATE.SAFE_OP, emoji: '🟡' },
    { label: 'OP', state: EC_STATE.OP, emoji: '🟢' },
  ];

  const infoRows: [string, string][] = [
    [t('ecat.slaveIndex'), `#${slave.index}`],
    [t('ecat.slaveName'), slave.name],
    [t('ecat.vendorId'), `0x${slave.vendorId.toString(16).padStart(8, '0')}`],
    [t('ecat.productCode'), `0x${slave.productCode.toString(16).padStart(8, '0')}`],
    [t('ecat.revisionNo'), `0x${slave.revision.toString(16).padStart(8, '0')}`],
    [t('ecat.serialNo'), `0x${slave.serial.toString(16).padStart(8, '0')}`],
    [t('ecat.output'), `${slave.obits} bits`],
    [t('ecat.input'), `${slave.ibits} bits`],
  ];

  return (
    <div className="p-3 text-[11px] space-y-3 overflow-y-auto">
      {/* 状态指示 */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)' }}>
        <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: stateColor(slave.state) }} />
        <span className="font-medium" style={{ color: stateColor(slave.state) }}>{stateLabel(slave.state)}</span>
        {slave.alStatusCode !== 0 && (
          <span className="text-[10px] font-mono ml-auto" style={{ color: '#ef4444' }}
            title={formatAlStatus(slave.alStatusCode, t)}>
            AL: 0x{slave.alStatusCode.toString(16).padStart(4, '0')} — {formatAlStatus(slave.alStatusCode, t)}
          </span>
        )}
      </div>

      {/* 信息表格 */}
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
        {infoRows.map(([label, value], i) => (
          <div key={label} className="flex items-center px-3 py-1.5"
            style={{ backgroundColor: i % 2 === 0 ? 'var(--color-input-bg)' : 'transparent', borderBottom: i < infoRows.length - 1 ? '1px solid var(--color-input-border)' : 'none' }}>
            <span className="w-20 flex-shrink-0" style={{ color: 'var(--color-text-dim)' }}>{label}</span>
            <span className="font-mono" style={{ color: 'var(--color-text-primary)' }}>{value}</span>
          </div>
        ))}
      </div>

      {/* 状态控制 */}
      <div>
        <div className="text-[10px] mb-1.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('ecat.stateControl')}</div>
        <div className="flex gap-1.5">
          {stateButtons.map((b) => {
            const active = slave.state === b.state;
            return (
              <button key={b.label}
                onClick={() => requestState(slave.index, b.state)}
                className="flex-1 py-1.5 rounded-md text-[10px] font-medium transition-all"
                style={{
                  ...pillBtn(active),
                  boxShadow: active ? '0 0 0 1px var(--color-accent)' : 'none',
                }}>
                {b.emoji} {b.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* 错误计数器 */}
      <div>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>{t('ecat.errorCounters')}</span>
          <button onClick={() => loadErrorCounters(slave.index)}
            className="px-1.5 py-0.5 rounded text-[9px] hover:opacity-90"
            style={{ backgroundColor: 'var(--color-accent)', color: 'white' }}>
            🔄 刷新
          </button>
          {errorCounters && (
            <button onClick={() => clearErrorCounters(slave.index)}
              className="px-1.5 py-0.5 rounded text-[9px] hover:opacity-90"
              style={{ backgroundColor: '#ef4444', color: 'white' }}>
              🗑️ 清零
            </button>
          )}
        </div>
        {errorCounters ? (
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
            <div className="flex items-center px-2 py-1 text-[9px] uppercase tracking-wider"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-input-border)' }}>
              <span className="w-24">类型</span>
              <span className="flex-1 text-center">Port 0</span>
              <span className="flex-1 text-center">Port 1</span>
              <span className="flex-1 text-center">Port 2</span>
              <span className="flex-1 text-center">Port 3</span>
            </div>
            {([
              ['Invalid Frame', errorCounters.invalidFrame],
              ['RX Error', errorCounters.rxError],
              ['Lost Link', errorCounters.lostLink],
            ] as [string, [number, number, number, number]][]).map(([label, vals], i) => (
              <div key={label} className="flex items-center px-2 py-1 font-mono text-[10px]"
                style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-input-bg)', borderBottom: '1px solid var(--color-input-border)' }}>
                <span className="w-24 text-[10px]" style={{ color: 'var(--color-text-secondary)' }}>{label}</span>
                {vals.map((v, p) => (
                  <span key={p} className="flex-1 text-center" style={{ color: v > 0 ? '#ef4444' : 'var(--color-text-dim)' }}>
                    {v}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[10px] text-center py-2" style={{ color: 'var(--color-text-dim)' }}>
            点击刷新按钮读取错误计数器
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── SdoTab ─── */
function SdoTab({ slave }: { slave: EcSlaveUI }) {
  const { sdoRead, sdoWrite, sdoHistory } = useEthercatStore();
  const [idx, setIdx] = useState('1000');
  const [subIdx, setSubIdx] = useState('0');
  const [size, setSize] = useState('4');
  const [dataType, setDataType] = useState('UDINT');
  const [writeVal, setWriteVal] = useState('');

  const handleRead = () => sdoRead(slave.index, parseInt(idx, 16), parseInt(subIdx), parseInt(size));
  const handleWrite = () => sdoWrite(slave.index, parseInt(idx, 16), parseInt(subIdx), writeVal, dataType);

  const slaveHistory = sdoHistory.filter((h) => h.slaveIndex === slave.index);

  const fieldClass = "px-1.5 py-1 rounded text-[11px] font-mono outline-none focus:border-[var(--color-accent)] transition-colors";

  return (
    <div className="p-3 text-[11px] space-y-3 overflow-y-auto flex-1">
      {/* 读取行 */}
      <div className="flex items-end gap-1.5 flex-wrap">
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>Index</div>
          <input value={idx} onChange={(e) => setIdx(e.target.value)}
            className={`w-14 ${fieldClass}`} style={inputStyle} placeholder="1000" />
        </div>
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>Sub</div>
          <input value={subIdx} onChange={(e) => setSubIdx(e.target.value)}
            className={`w-8 ${fieldClass}`} style={inputStyle} placeholder="0" />
        </div>
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>Size</div>
          <input value={size} onChange={(e) => setSize(e.target.value)}
            className={`w-8 ${fieldClass}`} style={inputStyle} placeholder="4" />
        </div>
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>Type</div>
          <select value={dataType} onChange={(e) => setDataType(e.target.value)}
            className={`${fieldClass}`} style={inputStyle}>
            {['BOOL','SINT','USINT','INT','UINT','DINT','UDINT','REAL','LREAL'].map((t) => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
        </div>
        <button onClick={handleRead}
          className="px-2.5 py-1 rounded text-[10px] bg-[var(--color-accent)] text-white hover:opacity-90">
          📖 读取
        </button>
      </div>

      {/* 写入行 */}
      <div className="flex items-end gap-1.5">
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>写入值 (hex)</div>
          <input value={writeVal} onChange={(e) => setWriteVal(e.target.value)}
            placeholder="00000000"
            className={`w-24 ${fieldClass}`} style={inputStyle} />
        </div>
        <button onClick={handleWrite} disabled={!writeVal}
          className="px-2.5 py-1 rounded text-[10px] text-white hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: '#f59e0b' }}>
          ✏️ 写入
        </button>
      </div>

      {/* 历史 */}
      {slaveHistory.length > 0 && (
        <div>
          <div className="text-[9px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>操作历史</div>
          <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
            <div className="max-h-[200px] overflow-y-auto">
              {slaveHistory.map((h, i) => (
                <div key={i} className="flex items-center gap-2 font-mono text-[10px] px-2 py-1"
                  style={{ backgroundColor: i % 2 === 0 ? 'var(--color-input-bg)' : 'transparent', borderBottom: '1px solid var(--color-input-border)' }}>
                  <span className="w-3 text-center" style={{ color: h.operation === 'read' ? '#3b82f6' : '#f59e0b' }}>
                    {h.operation === 'read' ? 'R' : 'W'}
                  </span>
                  <span style={{ color: 'var(--color-text-secondary)' }}>
                    0x{h.index.toString(16).padStart(4, '0')}:{h.subIndex.toString().padStart(2, '0')}
                  </span>
                  <span className="flex-1 truncate" style={{ color: 'var(--color-text-primary)' }}>{h.dataHex || '—'}</span>
                  {h.success ? (
                    <span style={{ color: '#22c55e' }}>✓</span>
                  ) : (
                    <span className="truncate max-w-[120px]" style={{ color: '#ef4444' }} title={h.errorMessage}>{h.errorMessage ?? '✗'}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── OutputWriteCell ─── */
function OutputWriteCell({ slave, sig, writeOutputPdo }: {
  slave: EcSlaveUI;
  sig: { bitOffset: number; bitSize: number; dataType: string };
  writeOutputPdo: (slaveIndex: number, offset: number, data: number[]) => Promise<void>;
}) {
  const [val, setVal] = useState('');
  const byteOffset = Math.floor(sig.bitOffset / 8);
  const byteLen = Math.ceil(sig.bitSize / 8);

  const handleWrite = () => {
    if (!val.trim()) return;
    const bytes: number[] = [];
    // 根据数据类型编码
    const num = parseFloat(val);
    if (isNaN(num)) return;
    const ab = new ArrayBuffer(8);
    const dv = new DataView(ab);
    switch (sig.dataType) {
      case 'BOOL': bytes.push(num ? 1 : 0); break;
      case 'USINT': dv.setUint8(0, num); bytes.push(...new Uint8Array(ab, 0, 1)); break;
      case 'SINT': dv.setInt8(0, num); bytes.push(...new Uint8Array(ab, 0, 1)); break;
      case 'UINT': dv.setUint16(0, num, true); bytes.push(...new Uint8Array(ab, 0, 2)); break;
      case 'INT': dv.setInt16(0, num, true); bytes.push(...new Uint8Array(ab, 0, 2)); break;
      case 'UDINT': dv.setUint32(0, num, true); bytes.push(...new Uint8Array(ab, 0, 4)); break;
      case 'DINT': dv.setInt32(0, num, true); bytes.push(...new Uint8Array(ab, 0, 4)); break;
      case 'REAL': dv.setFloat32(0, num, true); bytes.push(...new Uint8Array(ab, 0, 4)); break;
      case 'LREAL': dv.setFloat64(0, num, true); bytes.push(...new Uint8Array(ab, 0, 8)); break;
      default: {
        // hex string
        const hex = val.replace(/\s/g, '');
        for (let i = 0; i < hex.length; i += 2) bytes.push(parseInt(hex.substring(i, i + 2), 16) || 0);
      }
    }
    writeOutputPdo(slave.index, byteOffset, bytes.slice(0, byteLen));
    setVal('');
  };

  return (
    <span className="w-20 flex items-center justify-end gap-0.5">
      <input value={val} onChange={(e) => setVal(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && handleWrite()}
        className="w-14 px-1 py-0 rounded text-[9px] font-mono outline-none"
        style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
        placeholder="..." />
      <button onClick={handleWrite} className="text-[8px] px-0.5 rounded hover:opacity-80" style={{ color: '#f59e0b' }} title="写入">✎</button>
    </span>
  );
}

/* ─── PdoChart (Canvas 2D) ─── */
const CHART_COLORS = ['#3b82f6', '#ef4444', '#22c55e', '#f59e0b'];

function PdoChart({ chartSignals, chartData }: { chartSignals: Set<string>; chartData: Map<string, number[]> }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const w = rect.width;
    const h = rect.height;
    const pad = { top: 10, right: 10, bottom: 20, left: 50 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // 清空
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'var(--color-input-bg)';
    ctx.fillRect(0, 0, w, h);

    // 计算全局 Y 范围
    let yMin = Infinity, yMax = -Infinity;
    const keys = Array.from(chartSignals);
    for (const key of keys) {
      const arr = chartData.get(key) ?? [];
      for (const v of arr) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
    if (!isFinite(yMin)) { yMin = 0; yMax = 1; }
    if (yMin === yMax) { yMin -= 1; yMax += 1; }
    const yRange = yMax - yMin;

    // 网格线
    ctx.strokeStyle = 'rgba(128,128,128,0.15)';
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (plotH * i) / 4;
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(pad.left + plotW, y); ctx.stroke();
      const val = yMax - (yRange * i) / 4;
      ctx.fillStyle = 'rgba(128,128,128,0.6)';
      ctx.font = '9px monospace';
      ctx.textAlign = 'right';
      ctx.fillText(val.toFixed(1), pad.left - 4, y + 3);
    }

    // 绘制曲线
    keys.forEach((key, ci) => {
      const arr = chartData.get(key) ?? [];
      if (arr.length < 2) return;
      ctx.strokeStyle = CHART_COLORS[ci % CHART_COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = pad.left + (plotW * i) / (arr.length - 1);
        const y = pad.top + plotH - ((arr[i] - yMin) / yRange) * plotH;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    });

    // 图例
    ctx.font = '9px sans-serif';
    keys.forEach((key, ci) => {
      const label = key.split(':')[1] ?? key;
      ctx.fillStyle = CHART_COLORS[ci % CHART_COLORS.length];
      const x = pad.left + ci * 80;
      ctx.fillRect(x, h - 12, 8, 8);
      ctx.fillText(label, x + 12, h - 4);
    });
  }, [chartSignals, chartData]);

  return (
    <canvas ref={canvasRef} className="w-full rounded-lg"
      style={{ height: 160, border: '1px solid var(--color-input-border)', backgroundColor: 'var(--color-input-bg)' }} />
  );
}

/* ─── PDO 信号值提取 ─── */
function extractSignalValue(bytes: number[], bitOffset: number, bitSize: number, dataType: string): string {
  if (bytes.length === 0) return '—';
  const byteOffset = Math.floor(bitOffset / 8);
  const bitInByte = bitOffset % 8;

  if (dataType === 'BOOL') {
    if (byteOffset >= bytes.length) return '—';
    return ((bytes[byteOffset] >> bitInByte) & 1).toString();
  }

  const byteLen = Math.ceil(bitSize / 8);
  if (byteOffset + byteLen > bytes.length) return '—';

  const slice = bytes.slice(byteOffset, byteOffset + byteLen);
  const buf = new Uint8Array(slice);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);

  try {
    switch (dataType) {
      case 'USINT': return dv.getUint8(0).toString();
      case 'SINT': return dv.getInt8(0).toString();
      case 'UINT': return dv.getUint16(0, true).toString();
      case 'INT': return dv.getInt16(0, true).toString();
      case 'UDINT': return dv.getUint32(0, true).toString();
      case 'DINT': return dv.getInt32(0, true).toString();
      case 'REAL': return dv.getFloat32(0, true).toFixed(3);
      case 'LREAL': return dv.getFloat64(0, true).toFixed(6);
      default:
        return slice.map((b) => b.toString(16).padStart(2, '0')).join('');
    }
  } catch {
    return '—';
  }
}

/* ─── PdoTab ─── */
function PdoTab({ slave }: { slave: EcSlaveUI }) {
  const { pdoRunning, startPdo, stopPdo, wkcError, slaves, pdoSignals, resolvePdoSignals,
    chartSignals, toggleChartSignal, chartData, chartPaused, setChartPaused, pushChartData, writeOutputPdo } = useEthercatStore();
  const signals = pdoSignals.get(slave.index) ?? [];
  const [showChart, setShowChart] = useState(false);

  const formatBytes = (bytes: number[]) =>
    bytes.length > 0 ? bytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ') : '—';

  const inputSignals = signals.filter((s) => s.direction === 'input');
  const outputSignals = signals.filter((s) => s.direction === 'output');

  // 推送图表数据 (当 PDO 数据更新时)
  useEffect(() => {
    if (!pdoRunning || chartSignals.size === 0 || chartPaused) return;
    for (const key of chartSignals) {
      const sig = signals.find((s) => `${s.direction}:${s.name}:${s.bitOffset}` === key);
      if (!sig) continue;
      const bytes = sig.direction === 'input' ? slave.inputData : slave.outputData;
      const val = parseFloat(extractSignalValue(bytes, sig.bitOffset, sig.bitSize, sig.dataType));
      if (!isNaN(val)) pushChartData(key, val);
    }
  }, [slave.inputData, slave.outputData, pdoRunning, chartPaused]);

  const makeSignalKey = (sig: { direction: string; name: string; bitOffset: number }) =>
    `${sig.direction}:${sig.name}:${sig.bitOffset}`;

  const renderSignalTable = (sigs: typeof signals, label: string, emoji: string, dataSource: number[], valueColor: string, editable = false) => (
    <div>
      <div className="text-[9px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>
        {emoji} {label} — {sigs.length} 个
      </div>
      <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
        <div className="flex items-center px-2 py-1 text-[9px] uppercase tracking-wider"
          style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-input-border)' }}>
          <span className="w-5">📈</span>
          <span className="flex-1">信号名</span>
          <span className="w-14 text-center">类型</span>
          <span className="w-12 text-center">位偏移</span>
          <span className="w-20 text-right">当前值</span>
          {editable && <span className="w-20 text-right">写入</span>}
        </div>
        {sigs.map((sig, i) => {
          const key = makeSignalKey(sig);
          const checked = chartSignals.has(key);
          return (
            <div key={`${sig.direction}-${i}`} className="flex items-center px-2 py-1 font-mono text-[10px]"
              style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-input-bg)', borderBottom: '1px solid var(--color-input-border)' }}>
              <input type="checkbox" checked={checked} onChange={() => toggleChartSignal(key)}
                className="w-4 h-4 mr-1 accent-[var(--color-accent)]" title={checked ? '取消图表' : '加入图表 (最多4个)'} />
              <span className="flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{sig.name}</span>
              <span className="w-14 text-center text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{sig.dataType}</span>
              <span className="w-12 text-center text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{sig.bitOffset}</span>
              <span className="w-20 text-right" style={{ color: valueColor }}>
                {extractSignalValue(dataSource, sig.bitOffset, sig.bitSize, sig.dataType)}
              </span>
              {editable && <OutputWriteCell slave={slave} sig={sig} writeOutputPdo={writeOutputPdo} />}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="p-3 text-[11px] space-y-3 overflow-y-auto">
      {/* 控制栏 */}
      <div className="flex items-center gap-2">
        {!pdoRunning ? (
          <button onClick={() => startPdo()}
            className="px-2.5 py-1 rounded text-[10px] bg-[var(--color-accent)] text-white hover:opacity-90">
            ▶ 启动 PDO
          </button>
        ) : (
          <button onClick={stopPdo}
            className="px-2.5 py-1 rounded text-[10px] text-white hover:opacity-90" style={{ backgroundColor: '#ef4444' }}>
            ⏹ 停止
          </button>
        )}
        <button onClick={() => resolvePdoSignals(slave.index)}
          className="px-2 py-1 rounded text-[10px] hover:opacity-90"
          style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
          📡 解析信号
        </button>
        {pdoRunning && (
          <span className="text-[10px] font-mono animate-pulse" style={{ color: '#22c55e' }}>● 运行中</span>
        )}
        {wkcError && (
          <span className="text-[10px] ml-auto" style={{ color: '#ef4444' }}>
            ⚠ WKC 期望 {wkcError.expected} 实际 {wkcError.actual}
          </span>
        )}
      </div>

      {/* 信号表 (有信号定义时) */}
      {signals.length > 0 ? (
        <div className="space-y-2">
          {inputSignals.length > 0 && renderSignalTable(inputSignals, '输入信号 (TxPDO)', '📥', slave.inputData, '#3b82f6')}
          {outputSignals.length > 0 && renderSignalTable(outputSignals, '输出信号 (RxPDO)', '📤', slave.outputData, '#f59e0b', true)}

          {/* 实时曲线 */}
          {chartSignals.size > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[9px] uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>📈 实时曲线</span>
                <button onClick={() => setShowChart(!showChart)}
                  className="text-[9px] px-1.5 py-0.5 rounded"
                  style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
                  {showChart ? '▼ 收起' : '▶ 展开'}
                </button>
                {showChart && (
                  <button onClick={() => setChartPaused(!chartPaused)}
                    className="text-[9px] px-1.5 py-0.5 rounded"
                    style={{ backgroundColor: chartPaused ? '#22c55e' : '#ef4444', color: 'white' }}>
                    {chartPaused ? '▶ 恢复' : '⏸ 暂停'}
                  </button>
                )}
              </div>
              {showChart && <PdoChart chartSignals={chartSignals} chartData={chartData} />}
            </div>
          )}
        </div>
      ) : (
        /* 无信号定义时显示原始字节 */
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
          <div className="flex items-center px-2 py-1 text-[9px] uppercase tracking-wider"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-input-border)' }}>
            <span className="w-8">#</span>
            <span className="w-24">名称</span>
            <span className="flex-1">输入 (Input)</span>
            <span className="flex-1">输出 (Output)</span>
          </div>
          {slaves.filter((s) => s.state === EC_STATE.OP || s.index === slave.index).map((s, i) => (
            <div key={s.index} className="flex items-center px-2 py-1.5 font-mono text-[10px]"
              style={{
                backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-input-bg)',
                borderBottom: '1px solid var(--color-input-border)',
                color: s.index === slave.index ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
              }}>
              <span className="w-8" style={{ color: 'var(--color-text-dim)' }}>#{s.index}</span>
              <span className="w-24 truncate text-[10px]" title={s.name}>{s.name.split(' ')[0]}</span>
              <span className="flex-1" style={{ color: s.inputData.length > 0 ? '#3b82f6' : 'var(--color-text-dim)' }}>
                {formatBytes(s.inputData)}
              </span>
              <span className="flex-1" style={{ color: s.outputData.length > 0 ? '#f59e0b' : 'var(--color-text-dim)' }}>
                {formatBytes(s.outputData)}
              </span>
            </div>
          ))}
        </div>
      )}

      {!pdoRunning && (
        <div className="text-[10px] text-center py-2" style={{ color: 'var(--color-text-dim)' }}>
          将从站切换到 OP 状态后启动 PDO 监控{signals.length === 0 ? '，导入 ESI 后可解析信号' : ''}
        </div>
      )}
    </div>
  );
}

/* ─── OdBrowserTab ─── */
function OdBrowserTab({ slave }: { slave: EcSlaveUI }) {
  const { scanOd, sdoWrite, odEntries, esiDevices } = useEthercatStore();
  const [scanning, setScanning] = useState(false);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [editKey, setEditKey] = useState<string | null>(null);
  const [editVal, setEditVal] = useState('');
  const [editFeedback, setEditFeedback] = useState<{ key: string; ok: boolean } | null>(null);

  const entries = odEntries.get(slave.index) ?? [];
  const esiKey = `${slave.vendorId}:${slave.productCode}`;
  const esiDevice = esiDevices.get(esiKey);
  const esiMap = new Map<string, string>();
  if (esiDevice) {
    for (const o of esiDevice.objects) {
      esiMap.set(`${o.index}:${o.subIndex}`, o.name);
    }
  }

  const enriched = entries.map((e) => ({
    ...e,
    name: esiMap.get(`${e.index}:${e.subIndex}`) || e.name,
  }));

  let groups = groupOdEntries(enriched);

  // 搜索过滤
  if (search.trim()) {
    const q = search.trim().toLowerCase();
    groups = groups.filter((g) => {
      const hexStr = `0x${g.index.toString(16).padStart(4, '0')}`;
      if (hexStr.includes(q) || g.name.toLowerCase().includes(q)) return true;
      return g.entries.some((e) => e.name.toLowerCase().includes(q));
    });
  }

  const handleScan = async () => {
    setScanning(true);
    await scanOd(slave.index);
    setScanning(false);
  };

  const toggleGroup = (index: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };

  const handleEditConfirm = async (index: number, subIndex: number, dataType: string) => {
    const key = `${index}:${subIndex}`;
    await sdoWrite(slave.index, index, subIndex, editVal, dataType);
    setEditKey(null);
    setEditFeedback({ key, ok: true });
    setTimeout(() => setEditFeedback(null), 1500);
    // 刷新 OD
    await scanOd(slave.index);
  };

  return (
    <div className="p-3 text-[11px] space-y-2 overflow-y-auto flex-1">
      <div className="flex items-center gap-2">
        <button onClick={handleScan} disabled={scanning}
          className="px-2.5 py-1 rounded text-[10px] bg-[var(--color-accent)] text-white hover:opacity-90 disabled:opacity-40">
          {scanning ? '⏳ 扫描中...' : '🔍 扫描 OD'}
        </button>
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索 0x 索引或名称..."
          className="flex-1 px-2 py-1 rounded text-[10px] font-mono outline-none"
          style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }} />
        {groups.length > 0 && (
          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-dim)' }}>
            {groups.length} 个对象
          </span>
        )}
      </div>

      {groups.length > 0 ? (
        <div className="rounded-lg overflow-hidden" style={{ border: '1px solid var(--color-input-border)' }}>
          {groups.map((g, gi) => (
            <div key={g.index}>
              <div
                onClick={() => toggleGroup(g.index)}
                className="flex items-center gap-1.5 px-2 py-1 cursor-pointer hover:bg-[var(--color-hover-bg)] transition-colors"
                style={{ backgroundColor: gi % 2 === 0 ? 'var(--color-input-bg)' : 'transparent', borderBottom: '1px solid var(--color-input-border)' }}>
                <span className="text-[9px] w-3">{expanded.has(g.index) ? '▼' : '▶'}</span>
                <span className="font-mono text-[10px]" style={{ color: 'var(--color-accent)' }}>
                  0x{g.index.toString(16).padStart(4, '0')}
                </span>
                <span className="flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{g.name}</span>
                <span className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{g.entries.length} sub</span>
              </div>
              {expanded.has(g.index) && g.entries.map((e, ei) => {
                const eKey = `${e.index}:${e.subIndex}`;
                const isEditing = editKey === eKey;
                const fb = editFeedback?.key === eKey ? editFeedback : null;
                return (
                  <div key={eKey}
                    className="flex items-center gap-2 px-2 py-0.5 pl-7 font-mono text-[10px]"
                    style={{
                      backgroundColor: fb?.ok ? 'rgba(34,197,94,0.1)' : ei % 2 === 0 ? 'transparent' : 'var(--color-input-bg)',
                      borderBottom: '1px solid var(--color-input-border)',
                      color: 'var(--color-text-secondary)',
                      transition: 'background-color 0.3s',
                    }}>
                    <span className="w-5 text-right" style={{ color: 'var(--color-text-dim)' }}>{e.subIndex}</span>
                    <span className="flex-1 truncate">{e.name}</span>
                    {e.dataType && <span className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>{e.dataType}</span>}
                    {isEditing ? (
                      <span className="flex items-center gap-1">
                        <input value={editVal} onChange={(ev) => setEditVal(ev.target.value)}
                          onKeyDown={(ev) => ev.key === 'Enter' && handleEditConfirm(e.index, e.subIndex, e.dataType)}
                          className="w-20 px-1 py-0 rounded text-[9px] font-mono outline-none"
                          style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-accent)', color: 'var(--color-text-primary)' }}
                          autoFocus placeholder={e.dataType || 'hex'} />
                        <button onClick={() => handleEditConfirm(e.index, e.subIndex, e.dataType)}
                          className="text-[9px]" style={{ color: '#22c55e' }}>✓</button>
                        <button onClick={() => setEditKey(null)}
                          className="text-[9px]" style={{ color: '#ef4444' }}>✕</button>
                      </span>
                    ) : (
                      <span className="text-[9px] px-1 rounded cursor-pointer hover:ring-1 hover:ring-[var(--color-accent)]"
                        style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-primary)' }}
                        onDoubleClick={() => { setEditKey(eKey); setEditVal(e.defaultValue ?? ''); }}
                        title="双击编辑">
                        {e.defaultValue ?? '—'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      ) : !scanning ? (
        <div className="text-[10px] text-center py-6" style={{ color: 'var(--color-text-dim)' }}>
          点击扫描按钮读取从站对象字典
        </div>
      ) : null}
    </div>
  );
}

/* ─── FoeTab ─── */
function FoeTab({ slave }: { slave: EcSlaveUI }) {
  const { foeUpload, foeProgress } = useEthercatStore();
  const [password, setPassword] = useState('0');
  const [fileName, setFileName] = useState('');
  const [fileData, setFileData] = useState<number[] | null>(null);

  const handleSelectFile = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bin,.fw,.hex';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      setFileName(file.name);
      const buf = await file.arrayBuffer();
      setFileData(Array.from(new Uint8Array(buf)));
    };
    input.click();
  };

  const handleUpload = () => {
    if (!fileData) return;
    foeUpload(slave.index, fileName, fileData, parseInt(password) || 0);
  };

  const uploading = foeProgress !== null;

  return (
    <div className="p-3 text-[11px] space-y-3 overflow-y-auto">
      <div className="space-y-2">
        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>固件文件</div>
          <div className="flex items-center gap-2">
            <button onClick={handleSelectFile} disabled={uploading}
              className="px-2 py-1 rounded text-[10px] hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
              📁 选择文件
            </button>
            <span className="text-[10px] font-mono truncate" style={{ color: fileName ? 'var(--color-text-primary)' : 'var(--color-text-dim)' }}>
              {fileName || '未选择'}
              {fileData && <span style={{ color: 'var(--color-text-dim)' }}> ({(fileData.length / 1024).toFixed(1)} KB)</span>}
            </span>
          </div>
        </div>

        <div>
          <div className="text-[9px] mb-0.5 uppercase tracking-wider" style={{ color: 'var(--color-text-dim)' }}>密码 (可选)</div>
          <input value={password} onChange={(e) => setPassword(e.target.value)}
            className="w-24 px-1.5 py-1 rounded text-[10px] font-mono outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
            placeholder="0" />
        </div>

        <button onClick={handleUpload} disabled={!fileData || uploading}
          className="px-3 py-1.5 rounded text-[10px] text-white hover:opacity-90 disabled:opacity-40"
          style={{ backgroundColor: '#f59e0b' }}>
          📤 {uploading ? '上传中...' : '开始上传'}
        </button>
      </div>

      {uploading && (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-input-bg)' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${foeProgress}%`, backgroundColor: '#f59e0b' }} />
            </div>
            <span className="text-[10px] font-mono w-10 text-right" style={{ color: 'var(--color-text-primary)' }}>{foeProgress}%</span>
          </div>
        </div>
      )}

      <div className="text-[10px] rounded-lg p-2" style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', border: '1px solid var(--color-input-border)' }}>
        💡 FoE (File over EtherCAT) 用于从站固件更新。从站需处于 Bootstrap 或 PRE-OP 状态。
      </div>
    </div>
  );
}

/* ─── SiiTab ─── */
function SiiTab({ slave }: { slave: EcSlaveUI }) {
  const { siiRead, siiWrite, siiData } = useEthercatStore();
  const data = siiData.get(slave.index);

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob([new Uint8Array(data)], { type: 'application/octet-stream' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `slave${slave.index}_eeprom.bin`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.bin';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      if (!confirm(`确定要写入 EEPROM 吗？这可能导致从站无法启动。`)) return;
      const buf = await file.arrayBuffer();
      await siiWrite(slave.index, Array.from(new Uint8Array(buf)));
      await siiRead(slave.index);
    };
    input.click();
  };

  return (
    <div className="p-3 text-[11px] space-y-2 overflow-y-auto">
      <div className="flex items-center gap-2">
        <button onClick={() => siiRead(slave.index)}
          className="px-2.5 py-1 rounded text-[10px] bg-[var(--color-accent)] text-white hover:opacity-90">
          📖 读取 EEPROM
        </button>
        {data && (
          <>
            <button onClick={handleExport}
              className="px-2 py-1 rounded text-[10px] hover:opacity-90"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
              💾 导出 .bin
            </button>
            <button onClick={handleImport}
              className="px-2 py-1 rounded text-[10px] text-white hover:opacity-90"
              style={{ backgroundColor: '#ef4444' }}>
              📥 从 .bin 写入
            </button>
            <span className="text-[10px] ml-auto" style={{ color: 'var(--color-text-dim)' }}>
              {data.length} bytes
            </span>
          </>
        )}
      </div>

      {data ? (
        <div className="rounded-lg overflow-hidden font-mono text-[9px]" style={{ border: '1px solid var(--color-input-border)' }}>
          <div className="flex items-center px-2 py-0.5 text-[8px] uppercase tracking-wider"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-input-border)' }}>
            <span className="w-12">Offset</span>
            <span className="flex-1">00 01 02 03 04 05 06 07 08 09 0A 0B 0C 0D 0E 0F</span>
          </div>
          <div className="max-h-[300px] overflow-y-auto">
            {Array.from({ length: Math.ceil(data.length / 16) }, (_, row) => {
              const offset = row * 16;
              const rowBytes = data.slice(offset, offset + 16);
              return (
                <div key={row} className="flex items-center px-2 py-px"
                  style={{ backgroundColor: row % 2 === 0 ? 'transparent' : 'var(--color-input-bg)' }}>
                  <span className="w-12" style={{ color: 'var(--color-text-dim)' }}>
                    {offset.toString(16).padStart(4, '0')}
                  </span>
                  <span className="flex-1" style={{ color: 'var(--color-text-primary)' }}>
                    {rowBytes.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ')}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div className="text-[10px] text-center py-6" style={{ color: 'var(--color-text-dim)' }}>
          点击读取按钮查看从站 EEPROM 内容
        </div>
      )}
    </div>
  );
}

/* ─── Emergency 错误代码映射 ─── */
const EMERGENCY_CODES_UI: Record<number, string> = {
  0x0000: '无错误', 0x1000: '一般错误', 0x2000: '电流错误', 0x3000: '电压错误',
  0x4000: '温度错误', 0x5000: '硬件错误', 0x6000: '软件错误', 0x7000: '模块错误',
  0x8000: '监控错误', 0x8100: '通信错误', 0x9000: '外部错误', 0xFF00: '设备特定错误',
};

function formatEmgCode(code: number): string {
  const desc = EMERGENCY_CODES_UI[code];
  if (desc) return desc;
  const high = code & 0xFF00;
  return EMERGENCY_CODES_UI[high] ?? `0x${code.toString(16).padStart(4, '0')}`;
}

/* ─── EmergencyPanel ─── */
function EmergencyPanel() {
  const emergencyMessages = useEthercatStore((s) => s.emergencyMessages);
  const [collapsed, setCollapsed] = useState(true);

  if (emergencyMessages.length === 0) return null;

  return (
    <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
      <div className="flex items-center gap-2 px-2 py-0.5 cursor-pointer"
        onClick={() => setCollapsed(!collapsed)}
        style={{ backgroundColor: 'var(--color-input-bg)' }}>
        <span className="text-[9px]">{collapsed ? '▶' : '▼'}</span>
        <span className="text-[10px] font-medium" style={{ color: '#ef4444' }}>
          🚨 Emergency ({emergencyMessages.length})
        </span>
      </div>
      {!collapsed && (
        <div className="max-h-[120px] overflow-y-auto text-[10px] font-mono">
          {[...emergencyMessages].reverse().map((m, i) => (
            <div key={i} className="flex items-center gap-2 px-2 py-0.5"
              style={{ backgroundColor: i % 2 === 0 ? 'transparent' : 'var(--color-input-bg)', borderBottom: '1px solid var(--color-input-border)' }}>
              <span style={{ color: 'var(--color-text-dim)' }}>{new Date(m.timestamp).toLocaleTimeString()}</span>
              <span style={{ color: 'var(--color-text-secondary)' }}>#{m.slaveIndex}</span>
              <span style={{ color: '#ef4444' }}>0x{m.errorCode.toString(16).padStart(4, '0')}</span>
              <span className="flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>{formatEmgCode(m.errorCode)}</span>
              <span style={{ color: 'var(--color-text-dim)' }}>reg:0x{m.errorRegister.toString(16).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Main Panel ─── */
export default function EtherCATPanel({ onClose }: { onClose: () => void }) {
  const { session, slaves, selectedSlaveIndex, activeTab, setActiveTab, importEsi } = useEthercatStore();
  const t = useT();
  const selectedSlave = slaves.find((s) => s.index === selectedSlaveIndex) ?? null;
  const connected = session && session.status !== 'closed';

  const handleImportEsi = useCallback(async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.xml';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await importEsi(text);
    };
    input.click();
  }, [importEsi]);

  const tabs: { key: 'info' | 'sdo' | 'pdo' | 'od' | 'foe' | 'sii'; label: string }[] = [
    { key: 'info', label: `📋 ${t('ecat.tabStatus')}` },
    { key: 'sdo', label: `🔧 SDO` },
    { key: 'pdo', label: `📊 PDO` },
    { key: 'od', label: `📖 OD` },
    { key: 'foe', label: `📤 FoE` },
    { key: 'sii', label: `💾 SII` },
  ];

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg)', color: 'var(--color-text-primary)' }}>
      {/* 标题栏 */}
      <div className="flex items-center justify-between px-3 h-8 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold flex items-center gap-1.5">
          ⚙️ EtherCAT
          {connected && (
            <span className="text-[9px] font-normal px-1.5 py-px rounded-full"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)', border: '1px solid var(--color-input-border)' }}>
              {session?.adapter?.includes('Virtual') ? '模拟' : '硬件'}
            </span>
          )}
        </span>
        <div className="flex items-center gap-1">
          {connected && (
            <button onClick={handleImportEsi}
              className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover-bg)] transition-colors"
              style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}
              title="导入 ESI 文件">
              📄 ESI
            </button>
          )}
          <button onClick={onClose} className="text-[11px] w-5 h-5 flex items-center justify-center rounded hover:bg-[var(--color-hover-bg)] transition-colors"
            style={{ color: 'var(--color-text-dim)' }}>✕</button>
        </div>
      </div>

      {/* 连接栏 */}
      <ConnectionBar />

      {/* 主体 */}
      {connected ? (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {/* 左侧从站列表 */}
          <div className="flex-shrink-0 flex flex-col overflow-hidden" style={{ width: 180, borderRight: '1px solid var(--color-border)' }}>
            <div className="px-2 py-1 text-[9px] font-medium uppercase tracking-wider"
              style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
              从站列表 ({slaves.length})
            </div>
            <SlaveList />
          </div>

          {/* 右侧详情 */}
          <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
            {selectedSlave ? (
              <>
                {/* 标签页栏 */}
                <div className="flex items-center gap-0.5 px-2 py-1"
                  style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)' }}>
                  {tabs.map((t) => (
                    <button key={t.key}
                      onClick={() => setActiveTab(t.key)}
                      className="px-2 py-0.5 rounded text-[10px] transition-all"
                      style={pillBtn(activeTab === t.key)}>
                      {t.label}
                    </button>
                  ))}
                  <span className="ml-auto text-[9px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
                    #{selectedSlave.index} {selectedSlave.name.split(' ')[0]}
                  </span>
                </div>

                {/* 标签页内容 */}
                <div className="flex-1 overflow-y-auto min-h-0">
                  {activeTab === 'info' && <SlaveInfoTab slave={selectedSlave} />}
                  {activeTab === 'sdo' && <SdoTab slave={selectedSlave} />}
                  {activeTab === 'pdo' && <PdoTab slave={selectedSlave} />}
                  {activeTab === 'od' && <OdBrowserTab slave={selectedSlave} />}
                  {activeTab === 'foe' && <FoeTab slave={selectedSlave} />}
                  {activeTab === 'sii' && <SiiTab slave={selectedSlave} />}
                </div>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--color-text-dim)' }}>
                <span className="text-2xl opacity-30">⚙️</span>
                <span className="text-[11px]">{t('ecat.selectSlave')}</span>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center gap-2" style={{ color: 'var(--color-text-dim)' }}>
          <span className="text-3xl opacity-20">⚙️</span>
          <span className="text-[11px]">选择网络适配器并连接</span>
          <span className="text-[10px]">支持 SOEM 硬件和虚拟模拟模式</span>
        </div>
      )}

      {/* Emergency 面板 */}
      {connected && <EmergencyPanel />}

      {/* 状态栏 */}
      <div className="flex items-center gap-3 px-3 py-0.5 text-[9px] font-mono flex-shrink-0"
        style={{ borderTop: '1px solid var(--color-border)', backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-dim)' }}>
        <span className="flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: connected ? '#22c55e' : 'var(--color-text-dim)' }} />
          {session?.status ?? '未连接'}
        </span>
        {session && <span>从站 {session.slaveCount}</span>}
        {session?.adapter && <span className="ml-auto truncate max-w-[200px]">{session.adapter}</span>}
      </div>
    </div>
  );
}
