import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useCanDebugStore, getSessionStartTime } from '../store/can-store';
import { useT } from '../i18n';
import type { CanSession, CanMessageRow, CanSessionUI, SendListItem, MessageStats } from '../store/can-store';
import type { DbcMessage, DbcSignal } from '../../main/services/can/dbc-parser';
import { parseJ1939Id, getSAName, getPGNName, TpReassembler } from '../../main/services/can/j1939-parser';

// ─── Connection Config Bar ───
function ConnectionBar() {
  const t = useT();
  const [driverName, setDriverName] = useState('Virtual');
  const [deviceType, setDeviceType] = useState(4);
  const [deviceIndex, setDeviceIndex] = useState(0);
  const [channel, setChannel] = useState(0);
  const [baudRate, setBaudRate] = useState(500000);
  const [dataBaudRate, setDataBaudRate] = useState(5000000);
  const [fdProtocol, setFdProtocol] = useState(1); // 0=CAN, 1=CANFD
  // CH1 independent config
  const [ch1BaudRate, setCh1BaudRate] = useState(500000);
  const [ch1DataBaudRate, setCh1DataBaudRate] = useState(5000000);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState('');

  const openDevice = useCanDebugStore((s) => s.openDevice);
  const sessions = useCanDebugStore((s) => s.sessions);
  const activeSessionId = useCanDebugStore((s) => s.activeSessionId);
  const closeDevice = useCanDebugStore((s) => s.closeDevice);

  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isConnected = activeSession?.status === 'connected';

  const isFdDriver = driverName === 'GC-FD';
  // Multi-channel device types: USBCAN-II(4), USBCAN-2E-U(33), USBCANFD(6), GC USBCAN-II(4)
  const isMultiChannel = [4, 6, 33].includes(deviceType);
  const baudRates = isFdDriver
    ? [125000, 250000, 500000, 800000, 1000000]
    : [5000, 10000, 20000, 50000, 100000, 125000, 250000, 500000, 800000, 1000000];
  const dataBaudRates = [500000, 1000000, 2000000, 4000000, 5000000, 8000000];

  const handleConnect = async () => {
    setError('');
    setConnecting(true);
    try {
      const fdConfig = isFdDriver ? {
        protocol: fdProtocol, dataBaudRate, mode: 0,
        ch1BaudRate, ch1DataBaudRate,
      } : isMultiChannel ? { ch1BaudRate } : undefined;
      await openDevice(driverName, deviceType, deviceIndex, channel, baudRate, fdConfig);
    } catch (err) {
      setError((err as Error).message);
    }
    setConnecting(false);
  };

  const handleDisconnect = () => {
    if (!activeSessionId) return;
    // Find the active session to identify its device
    const active = sessions.find((s) => s.id === activeSessionId);
    if (!active) return;
    // Close all sibling sessions from the same device (multi-channel)
    const siblings = sessions.filter(
      (s) => s.driverName === active.driverName && s.deviceType === active.deviceType && s.deviceIndex === active.deviceIndex && s.status === 'connected'
    );
    for (const s of siblings) closeDevice(s.id);
  };

  // When switching driver, reset device type
  const handleDriverChange = (name: string) => {
    setDriverName(name);
    if (name === 'GC-FD') {
      setDeviceType(6);  // USBCANFD = 6 per SDK header
      if (baudRate < 125000) setBaudRate(500000);
    } else if (name === 'GC') {
      setDeviceType(4);
    } else if (name === 'ZLG') {
      setDeviceType(4);
    }
  };

  const selectStyle = {
    border: '1px solid var(--color-input-border)',
  };

  const formatRate = (b: number) => b >= 1000000 ? `${b / 1000000}M` : `${b / 1000}K`;

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 flex-wrap" style={{ borderBottom: '1px solid var(--color-border)' }}>
      <select value={driverName} onChange={(e) => handleDriverChange(e.target.value)}
        className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
        <option value="Virtual">{t('can.virtual')}</option>
        <option value="ZLG">{t('can.zlg')}</option>
        <option value="GC">{t('can.gc')}</option>
        <option value="GC-FD">{t('can.gcFd')}</option>
      </select>
      <select value={deviceType} onChange={(e) => setDeviceType(Number(e.target.value))}
        className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
        {isFdDriver ? (
          <option value={6}>USBCANFD</option>
        ) : driverName === 'GC' ? (
          <>
            <option value={3}>USBCAN-I</option>
            <option value={4}>USBCAN-II</option>
          </>
        ) : (
          <>
            <option value={3}>USBCAN-I</option>
            <option value={4}>USBCAN-II</option>
            <option value={21}>USBCAN-E-U</option>
            <option value={33}>USBCAN-2E-U</option>
          </>
        )}
      </select>
      {isFdDriver && (
        <><label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{t('can.protocol')}:</label>
          <select value={fdProtocol} onChange={(e) => setFdProtocol(Number(e.target.value))}
            className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
            <option value={0}>CAN</option>
            <option value={1}>CAN FD</option>
          </select>
        </>
      )}
      {isMultiChannel ? (
        <>
          <span className="text-[10px] px-1 rounded" style={{ color: 'var(--color-text-dim)', border: '1px solid var(--color-border)' }}>CH0</span>
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}
            className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
            {baudRates.map((b) => (
              <option key={b} value={b}>{formatRate(b)}</option>
            ))}
          </select>
          {isFdDriver && fdProtocol === 1 && (
            <select value={dataBaudRate} onChange={(e) => setDataBaudRate(Number(e.target.value))}
              className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
              {dataBaudRates.map((b) => (
                <option key={b} value={b}>{formatRate(b)}</option>
              ))}
            </select>
          )}
          <span className="text-[10px] px-1 rounded" style={{ color: 'var(--color-text-dim)', border: '1px solid var(--color-border)' }}>CH1</span>
          <select value={ch1BaudRate} onChange={(e) => setCh1BaudRate(Number(e.target.value))}
            className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
            {baudRates.map((b) => (
              <option key={b} value={b}>{formatRate(b)}</option>
            ))}
          </select>
          {isFdDriver && fdProtocol === 1 && (
            <select value={ch1DataBaudRate} onChange={(e) => setCh1DataBaudRate(Number(e.target.value))}
              className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
              {dataBaudRates.map((b) => (
                <option key={b} value={b}>{formatRate(b)}</option>
              ))}
            </select>
          )}
        </>
      ) : !isFdDriver ? (
        <>
          <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>Baud:</label>
          <select value={baudRate} onChange={(e) => setBaudRate(Number(e.target.value))}
            className="px-1.5 py-1 text-[11px] rounded" style={selectStyle} disabled={isConnected}>
            {baudRates.map((b) => (
              <option key={b} value={b}>{formatRate(b)}</option>
            ))}
          </select>
        </>
      ) : null}
      {!isConnected ? (
        <button onClick={handleConnect} disabled={connecting}
          className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90 disabled:opacity-50">
          {connecting ? t('common.connecting') : t('common.connect')}
        </button>
      ) : (
        <button onClick={handleDisconnect}
          className="px-3 py-1 text-[11px] rounded text-white bg-red-500 hover:bg-red-600">
          {t('common.disconnect')}
        </button>
      )}
      {error && <span className="text-[10px] text-red-400 truncate max-w-[200px]">{error}</span>}
    </div>
  );
}


// ─── Message Table (virtual scroll) ───
function MessageTable({ sessionId, idFilter, messageFilter }: {
  sessionId: string;
  idFilter: string;
  messageFilter: 'all' | 'tx' | 'rx';
}) {
  const messages = useCanDebugStore((s) => s.messages.get(sessionId) || []);
  const dbc = useCanDebugStore((s) => s.dbc);
  const autoScroll = useCanDebugStore((s) => s.sessionUI.get(sessionId)?.autoScroll ?? true);
  const containerRef = useRef<HTMLDivElement>(null);
  const [nameColWidth, setNameColWidth] = useState(96);
  const draggingName = useRef(false);
  const [expandedSeq, setExpandedSeq] = useState<number | null>(null);

  // Parse ID filter
  const filterIds = idFilter.trim()
    ? idFilter.split(',').map((s) => parseInt(s.trim(), 16)).filter((n) => !isNaN(n))
    : null;

  const filtered = messages.filter((m) => {
    if (filterIds && !filterIds.includes(m.frame.id)) return false;
    if (messageFilter === 'tx' && m.frame.direction !== 'tx') return false;
    if (messageFilter === 'rx' && m.frame.direction !== 'rx') return false;
    return true;
  });

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [filtered.length, autoScroll]);

  const ROW_HEIGHT = 20;
  const EXPANDED_HEIGHT = 120; // extra height for signal detail panel
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(400);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setViewHeight(el.clientHeight));
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const handleScroll = useCallback(() => {
    if (containerRef.current) setScrollTop(containerRef.current.scrollTop);
  }, []);

  // Find expanded row index in filtered list
  const expandedIdx = expandedSeq != null ? filtered.findIndex((r) => r.seq === expandedSeq) : -1;

  // Calculate total height accounting for expanded row
  const totalHeight = filtered.length * ROW_HEIGHT + (expandedIdx >= 0 ? EXPANDED_HEIGHT : 0);

  // Calculate visible range accounting for expanded row
  const getRowTop = (idx: number) => {
    if (expandedIdx < 0 || idx <= expandedIdx) return idx * ROW_HEIGHT;
    return idx * ROW_HEIGHT + EXPANDED_HEIGHT;
  };

  // Find start index from scrollTop
  let startIdx = 0;
  if (expandedIdx < 0) {
    startIdx = Math.floor(scrollTop / ROW_HEIGHT);
  } else {
    const expandedTop = expandedIdx * ROW_HEIGHT;
    const expandedBottom = expandedTop + ROW_HEIGHT + EXPANDED_HEIGHT;
    if (scrollTop <= expandedTop) {
      startIdx = Math.floor(scrollTop / ROW_HEIGHT);
    } else if (scrollTop <= expandedBottom) {
      startIdx = expandedIdx;
    } else {
      startIdx = expandedIdx + 1 + Math.floor((scrollTop - expandedBottom) / ROW_HEIGHT);
    }
  }
  startIdx = Math.max(0, startIdx);
  const visibleCount = Math.ceil(viewHeight / ROW_HEIGHT) + 4;
  const visible = filtered.slice(startIdx, startIdx + visibleCount);

  const hasDbc = !!dbc;
  const headerStyle = { color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' };

  // Resolve DBC signals for a frame
  const getSignals = useCallback((frame: { id: number; extended: boolean; dlc: number; data: number[] }) => {
    if (!dbc) return null;
    const dbcMsg = dbc.messages.find((m) => m.id === frame.id && m.extended === frame.extended);
    if (!dbcMsg || dbcMsg.signals.length === 0) return null;
    return dbcMsg;
  }, [dbc]);

  const handleNameResize = (e: React.MouseEvent) => {
    e.preventDefault();
    draggingName.current = true;
    const startX = e.clientX;
    const startW = nameColWidth;
    const onMove = (ev: MouseEvent) => {
      if (!draggingName.current) return;
      setNameColWidth(Math.max(48, Math.min(300, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      draggingName.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Header */}
      <div className="flex text-[10px] font-medium px-1 py-0.5 flex-shrink-0" style={headerStyle}>
        <span className="w-12 text-center">#</span>
        <span className="w-16 text-center">ID</span>
        <span className="w-8 text-center">Dir</span>
        <span className="w-8 text-center">DLC</span>
        {hasDbc && (
          <span className="truncate relative flex-shrink-0" style={{ width: nameColWidth }}>
            Name
            <span className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-[var(--color-accent)]"
              style={{ opacity: 0.5 }} onMouseDown={handleNameResize} />
          </span>
        )}
        <span className="flex-1">Data</span>
        <span className="w-20 text-right">Time</span>
      </div>
      {/* Virtual scroll body */}
      <div ref={containerRef} className="flex-1 overflow-y-auto min-h-0" onScroll={handleScroll}
        style={{ fontFamily: 'Consolas, monospace', fontSize: '11px' }}>
        <div style={{ height: totalHeight, position: 'relative' }}>
          {visible.map((row, i) => {
            const idx = startIdx + i;
            const top = getRowTop(idx);
            const f = row.frame;
            const idHex = f.id.toString(16).toUpperCase().padStart(3, '0');
            const dataHex = f.data.slice(0, f.dlc).map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
            const timeStr = typeof f.timestamp === 'number' ? ((f.timestamp - getSessionStartTime(sessionId)) / 1000).toFixed(3) : '';
            const dirColor = f.direction === 'tx' ? '#60a5fa' : '#4ade80';
            const isExpanded = row.seq === expandedSeq;
            const dbcMsg = isExpanded ? getSignals(f) : null;
            return (
              <React.Fragment key={row.seq}>
                <div className="flex items-center px-1 hover:bg-[var(--color-hover-bg)] cursor-pointer"
                  style={{ position: 'absolute', top, height: ROW_HEIGHT, width: '100%', color: 'var(--color-text-secondary)',
                    backgroundColor: isExpanded ? 'var(--color-hover-bg)' : undefined }}
                  onClick={() => setExpandedSeq(isExpanded ? null : row.seq)}>
                  <span className="w-12 text-center text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{row.seq}</span>
                  <span className="w-16 text-center">{idHex}{f.extended ? 'x' : ''}</span>
                  <span className="w-8 text-center" style={{ color: dirColor }}>{f.direction === 'tx' ? 'TX' : 'RX'}</span>
                  <span className="w-8 text-center">{f.dlc}{f.fd ? <span className="text-[7px] ml-0.5" style={{ color: '#f59e0b' }}>FD</span> : ''}</span>
                  {hasDbc && (
                    <span className="truncate text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-dim)', width: nameColWidth }}
                      title={row.messageName || ''}>{row.messageName || ''}</span>
                  )}
                  <span className="flex-1 tracking-wider">{dataHex}</span>
                  <span className="w-20 text-right text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{timeStr}</span>
                </div>
                {isExpanded && (
                  <div className="px-4 py-1.5 text-[10px] overflow-y-auto"
                    style={{ position: 'absolute', top: top + ROW_HEIGHT, width: '100%', height: EXPANDED_HEIGHT,
                      backgroundColor: 'var(--color-surface-hover)', borderBottom: '1px solid var(--color-border)' }}>
                    {dbcMsg ? (
                      <>
                        <div className="font-medium mb-1" style={{ color: 'var(--color-text-secondary)' }}>
                          {dbcMsg.name} — {dbcMsg.signals.length} signals
                        </div>
                        <div className="grid gap-0.5" style={{ gridTemplateColumns: 'auto auto auto' }}>
                          {dbcMsg.signals.map((sig) => {
                            const val = decodeSignal(f.data, sig);
                            const display = sig.factor < 1 ? val.toFixed(2) : val.toFixed(0);
                            return (
                              <React.Fragment key={sig.name}>
                                <span style={{ color: 'var(--color-accent)' }}>{sig.name}</span>
                                <span style={{ color: 'var(--color-text-primary)', textAlign: 'right', paddingRight: 4 }}>{display}</span>
                                <span style={{ color: 'var(--color-text-dim)' }}>{sig.unit}</span>
                              </React.Fragment>
                            );
                          })}
                        </div>
                      </>
                    ) : (
                      <div style={{ color: 'var(--color-text-dim)' }}>No DBC signals defined for this ID</div>
                    )}
                  </div>
                )}
              </React.Fragment>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ─── Signal Encoder: physical value → raw bytes ───
function encodeSignal(data: number[], signal: DbcSignal, physicalValue: number): void {
  const rawValue = Math.round((physicalValue - signal.offset) / signal.factor);
  const { startBit, bitLength, byteOrder } = signal;

  // Clamp to bit range
  const mask = (1 << bitLength) - 1;
  let raw = rawValue & mask;
  // Handle signed: convert negative to two's complement
  if (signal.valueType === 'signed' && rawValue < 0) {
    raw = (rawValue + (1 << bitLength)) & mask;
  }

  if (byteOrder === 'little_endian') {
    for (let i = 0; i < bitLength; i++) {
      const bitPos = startBit + i;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        if ((raw >> i) & 1) {
          data[byteIdx] |= (1 << bitIdx);
        } else {
          data[byteIdx] &= ~(1 << bitIdx);
        }
      }
    }
  } else {
    let bitPos = startBit;
    for (let i = bitLength - 1; i >= 0; i--) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) {
        if ((raw >> i) & 1) {
          data[byteIdx] |= (1 << bitIdx);
        } else {
          data[byteIdx] &= ~(1 << bitIdx);
        }
      }
      if (bitIdx === 0) bitPos += 15;
      else bitPos -= 1;
    }
  }
}

// ─── Signal Decoder: raw bytes → physical value ───
function decodeSignal(data: number[], signal: DbcSignal): number {
  const { startBit, bitLength, byteOrder } = signal;
  let rawValue = 0;
  if (byteOrder === 'little_endian') {
    for (let i = 0; i < bitLength; i++) {
      const bitPos = startBit + i;
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) rawValue |= ((data[byteIdx] >> bitIdx) & 1) << i;
    }
  } else {
    let bitPos = startBit;
    for (let i = bitLength - 1; i >= 0; i--) {
      const byteIdx = Math.floor(bitPos / 8);
      const bitIdx = bitPos % 8;
      if (byteIdx < data.length) rawValue |= ((data[byteIdx] >> bitIdx) & 1) << i;
      if (bitIdx === 0) bitPos += 15; else bitPos -= 1;
    }
  }
  // Handle signed
  if (signal.valueType === 'signed' && bitLength > 0 && bitLength < 32) {
    const signBit = 1 << (bitLength - 1);
    if (rawValue & signBit) rawValue = rawValue - (1 << bitLength);
  }
  return rawValue * signal.factor + signal.offset;
}

// ─── DBC Message Send Editor (popup) ───
function DbcSendEditor({ msg, sessionId, onClose, sendListItemId }: { msg: DbcMessage; sessionId: string; onClose: () => void; sendListItemId?: string }) {
  const t = useT();
  const [signalValues, setSignalValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    // If editing a send list item, decode existing data to get signal values
    if (sendListItemId) {
      const currentUI = useCanDebugStore.getState().sessionUI.get(sessionId);
      const item = currentUI?.sendList.find((i) => i.id === sendListItemId);
      if (item) {
        const dataBytes = item.data.replace(/\s/g, '').match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) || [];
        for (const sig of msg.signals) {
          const val = decodeSignal(dataBytes, sig);
          init[sig.name] = Number.isInteger(val) ? String(val) : val.toFixed(4).replace(/\.?0+$/, '');
        }
        return init;
      }
    }
    for (const sig of msg.signals) init[sig.name] = '0';
    return init;
  });
  const sendFrame = useCanDebugStore((s) => s.sendFrame);
  const updateUI = useCanDebugStore((s) => s.updateSessionUI);
  const addSendListItem = useCanDebugStore((s) => s.addSendListItem);
  const updateSendListItem = useCanDebugStore((s) => s.updateSendListItem);
  const ui = useCanDebugStore((s) => s.sessionUI.get(sessionId));

  const buildData = (): number[] => {
    const data = new Array(8).fill(0);
    for (const sig of msg.signals) {
      const val = parseFloat(signalValues[sig.name] || '0');
      if (!isNaN(val)) encodeSignal(data, sig, val);
    }
    return data.slice(0, msg.dlc);
  };

  const buildHex = () => buildData().map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  const fillToSendPanel = () => {
    updateUI(sessionId, {
      sendId: msg.id.toString(16).toUpperCase(),
      sendDlc: String(msg.dlc),
      sendData: buildHex(),
      sendExtended: msg.extended,
    });
    onClose();
  };

  const sendNow = () => {
    updateUI(sessionId, {
      sendId: msg.id.toString(16).toUpperCase(),
      sendDlc: String(msg.dlc),
      sendData: buildHex(),
      sendExtended: msg.extended,
    });
    setTimeout(() => sendFrame(sessionId), 0);
  };

  const addToSendList = () => {
    addSendListItem(sessionId);
    // Get the newly added item (last one) and update it
    setTimeout(() => {
      const currentUI = useCanDebugStore.getState().sessionUI.get(sessionId);
      if (!currentUI) return;
      const lastItem = currentUI.sendList[currentUI.sendList.length - 1];
      if (!lastItem) return;
      updateSendListItem(sessionId, lastItem.id, {
        canId: msg.id.toString(16).toUpperCase(),
        dlc: msg.dlc,
        data: buildHex(),
        extended: msg.extended,
      });
    }, 0);
    onClose();
  };

  const updateListItem = () => {
    if (sendListItemId) {
      updateSendListItem(sessionId, sendListItemId, { data: buildHex() });
    }
    onClose();
  };

  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  const previewData = buildData();
  const previewHex = previewData.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }}
      onClick={onClose}>
      <div className="rounded-xl shadow-2xl w-[380px] max-h-[80vh] flex flex-col"
        style={{ backgroundColor: 'var(--color-sidebar)', border: '1px solid var(--color-input-border)' }}
        onClick={(e: React.MouseEvent) => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-2" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>
              📤 {msg.name}
            </span>
            <span className="text-[10px] ml-2" style={{ color: 'var(--color-text-dim)' }}>
              ID: 0x{msg.id.toString(16).toUpperCase()} DLC: {msg.dlc}
            </span>
          </div>
          <button onClick={onClose} className="text-xs hover:text-red-400" style={{ color: 'var(--color-text-dim)' }}>✕</button>
        </div>

        {/* Signal inputs */}
        <div className="flex-1 overflow-y-auto px-4 py-2 space-y-1.5">
          {msg.signals.map((sig) => (
            <div key={sig.name} className="flex items-center gap-2">
              <label className="w-32 text-[11px] truncate flex-shrink-0" style={{ color: 'var(--color-text-secondary)' }} title={sig.name}>
                {sig.name}
              </label>
              <input
                value={signalValues[sig.name] || ''}
                onChange={(e) => setSignalValues((prev) => ({ ...prev, [sig.name]: e.target.value }))}
                className="w-24 px-1.5 py-0.5 text-[11px] rounded text-right font-mono flex-shrink-0" style={inputStyle}
                inputMode="decimal"
              />
              <span className="w-8 text-[9px] truncate flex-shrink-0" style={{ color: 'var(--color-text-dim)' }}>{sig.unit}</span>
              {sig.min !== sig.max && (
                <input type="range" min={sig.min} max={sig.max}
                  step={sig.factor < 1 ? sig.factor : 1}
                  value={parseFloat(signalValues[sig.name] || '0') || 0}
                  onChange={(e) => setSignalValues((prev) => ({ ...prev, [sig.name]: e.target.value }))}
                  className="flex-1 h-3" style={{ accentColor: 'var(--color-accent)' }} />
              )}
              {sig.min === sig.max && (
                <span className="text-[8px] flex-shrink-0" style={{ color: 'var(--color-text-dim)' }}>
                  [{sig.min}~{sig.max}]
                </span>
              )}
            </div>
          ))}
        </div>

        {/* Preview + actions */}
        <div className="px-4 py-2 space-y-2" style={{ borderTop: '1px solid var(--color-border)' }}>
          <div className="text-[10px] font-mono" style={{ color: 'var(--color-text-dim)' }}>
            Data: {previewHex}
          </div>
          <div className="flex justify-end gap-2">
            {sendListItemId ? (
              <button onClick={updateListItem}
                className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90">
                {t('can.updateData')}
              </button>
            ) : (
              <>
                <button onClick={addToSendList}
                  className="px-3 py-1 text-[11px] rounded transition-colors"
                  style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
                  {t('can.addToSendList')}
                </button>
                <button onClick={fillToSendPanel}
                  className="px-3 py-1 text-[11px] rounded transition-colors"
                  style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
                  {t('can.fillSend')}
                </button>
                <button onClick={sendNow}
                  className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90">
                  {t('can.sendNow')}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DBC Signal Tree ───
function SignalTree({ onAddMonitor, onSendMessage }: {
  onAddMonitor: (msg: DbcMessage, sig: DbcSignal) => void;
  onSendMessage?: (msg: DbcMessage) => void;
}) {
  const t = useT();
  const dbc = useCanDebugStore((s) => s.dbc);
  const unloadDbc = useCanDebugStore((s) => s.unloadDbc);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [width, setWidth] = useState(200);
  const dragging = useRef(false);

  if (!dbc) return null;

  const toggle = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const startX = e.clientX;
    const startW = width;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current) return;
      setWidth(Math.max(120, Math.min(400, startW + ev.clientX - startX)));
    };
    const onUp = () => {
      dragging.current = false;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex flex-col h-full relative" style={{ borderRight: '1px solid var(--color-border)', width }}>
      <div className="flex items-center justify-between px-2 py-1" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.dbcSignals')}</span>
        <button onClick={unloadDbc} className="text-[10px] text-red-400 hover:text-red-300" title={t('can.unloadDbc')}>✕</button>
      </div>
      <div className="flex-1 overflow-y-auto text-[11px]">
        {dbc.messages.map((msg) => {
          const fullName = `${msg.name} (0x${msg.id.toString(16).toUpperCase()})`;
          return (
            <div key={msg.id}>
              <div className="flex items-center gap-1 px-2 py-0.5 cursor-pointer hover:bg-[var(--color-hover-bg)]"
                onClick={() => toggle(msg.id)} title={fullName}>
                <span className="text-[8px]">{expanded.has(msg.id) ? '▼' : '▶'}</span>
                <span className="flex-1 truncate" style={{ color: 'var(--color-text-secondary)' }}>
                  {msg.name} <span className="text-[9px]" style={{ color: 'var(--color-text-dim)' }}>0x{msg.id.toString(16).toUpperCase()}</span>
                </span>
                {onSendMessage && (
                  <button onClick={(e) => { e.stopPropagation(); onSendMessage(msg); }}
                    className="text-[9px] px-1 rounded hover:bg-[var(--color-accent)] hover:text-white" title={t('can.sendThisMsg')}>📤</button>
                )}
              </div>
              {expanded.has(msg.id) && msg.signals.map((sig) => (
                <div key={sig.name} className="flex items-center gap-1 pl-5 pr-2 py-0.5 hover:bg-[var(--color-hover-bg)]"
                  style={{ color: 'var(--color-text-dim)' }} title={`${sig.name} [${sig.min}~${sig.max}] ${sig.unit}`}>
                  <span className="flex-1 truncate">{sig.name}</span>
                  <button onClick={() => onAddMonitor(msg, sig)}
                    className="text-[9px] px-1 rounded hover:bg-[var(--color-accent)] hover:text-white" title={t('can.addMonitor')}>+</button>
                </div>
              ))}
            </div>
          );
        })}
      </div>
      {/* Resize handle */}
      <div className="absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-[var(--color-accent)]"
        style={{ opacity: 0.4 }} onMouseDown={handleMouseDown} />
    </div>
  );
}

// ─── Signal Panel (unified monitor + chart with tabs) ───
const CHART_COLORS_DARK = ['#60a5fa', '#f472b6', '#4ade80', '#facc15', '#c084fc', '#fb923c', '#22d3ee', '#a3e635'];
const CHART_COLORS_LIGHT = ['#2563eb', '#db2777', '#16a34a', '#ca8a04', '#9333ea', '#ea580c', '#0891b2', '#65a30d'];
const CHART_PAD = { left: 52, right: 12, top: 14, bottom: 22 };

function SignalPanel() {
  const t = useT();
  const activeSessionId = useCanDebugStore((s) => s.activeSessionId);
  const allMonitored = useCanDebugStore((s) => s.monitoredSignals);
  const monitored = useMemo(() => allMonitored.filter((ms) => ms.sessionId === activeSessionId), [allMonitored, activeSessionId]);
  const removeMonitorSignal = useCanDebugStore((s) => s.removeMonitorSignal);
  const [tab, setTab] = useState<'gauge' | 'chart' | 'table'>('chart');
  const [height, setHeight] = useState(200);
  const [paused, setPaused] = useState(false);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef<{ x: number; y: number } | null>(null);
  const viewRef = useRef<{ start: number; end: number; pinned: boolean }>({ start: 0, end: 0, pinned: false });
  const pausedDataRef = useRef<typeof monitored | null>(null);
  const dragRef = useRef<{ dragging: boolean; lastX: number }>({ dragging: false, lastX: 0 });
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; sigIdx: number } | null>(null);

  // Pause / resume: snapshot data when pausing
  useEffect(() => {
    if (paused) {
      pausedDataRef.current = monitored;
    } else {
      pausedDataRef.current = null;
      viewRef.current.pinned = false;
    }
  }, [paused]); // eslint-disable-line react-hooks/exhaustive-deps

  // rAF-based 30fps chart rendering
  useEffect(() => {
    if (tab !== 'chart') return;
    let rafId = 0;
    let lastDraw = 0;
    const draw = (now: number) => {
      rafId = requestAnimationFrame(draw);
      if (now - lastDraw < 33) return; // ~30fps
      lastDraw = now;
      const canvas = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) return;
      const data = paused ? pausedDataRef.current : useCanDebugStore.getState().monitoredSignals.filter((ms) => ms.sessionId === activeSessionId);
      if (!data || data.length === 0) return;

      const dpr = window.devicePixelRatio || 1;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + 'px';
        canvas.style.height = h + 'px';
      }
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const pl = CHART_PAD.left, pr = CHART_PAD.right, pt = CHART_PAD.top, pb = CHART_PAD.bottom;
      const cw = w - pl - pr, ch = h - pt - pb;
      if (cw <= 0 || ch <= 0) return;

      // Theme-aware colors: detect dark/light by checking .light class or surface luminance
      const isLight = container.closest('.light') !== null || document.documentElement.classList.contains('light');
      const isDark = !isLight;
      const textColor = isDark ? 'rgba(255,255,255,0.6)' : 'rgba(0,0,0,0.75)';
      const textDimColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.6)';
      const gridColor = isDark ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.1)';
      const gridFaintColor = isDark ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.05)';
      const bgOverlay = isDark ? 'rgba(0,0,0,0.15)' : 'rgba(0,0,0,0.03)';
      const crosshairColor = isDark ? 'rgba(255,255,255,0.35)' : 'rgba(0,0,0,0.3)';
      const tooltipBg = isDark ? 'rgba(30,30,30,0.92)' : 'rgba(255,255,255,0.95)';
      const tooltipBorder = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
      const tooltipText = isDark ? 'rgba(255,255,255,0.85)' : 'rgba(0,0,0,0.85)';
      const CHART_COLORS = isDark ? CHART_COLORS_DARK : CHART_COLORS_LIGHT;

      // Determine time range
      let tMin = Infinity, tMax = -Infinity;
      for (const ms of data) {
        if (ms.history.length > 0) {
          tMin = Math.min(tMin, ms.history[0].t);
          tMax = Math.max(tMax, ms.history[ms.history.length - 1].t);
        }
      }
      if (tMin >= tMax) return;

      const vr = viewRef.current;
      if (!vr.pinned) { vr.start = tMin; vr.end = tMax; }
      const viewStart = vr.start, viewEnd = vr.end;
      const tRange = viewEnd - viewStart || 1;

      // Background
      ctx.fillStyle = bgOverlay;
      ctx.fillRect(pl, pt, cw, ch);

      // Grid lines (horizontal)
      ctx.strokeStyle = gridColor;
      ctx.lineWidth = 1;
      const gridRows = 4;
      for (let i = 0; i <= gridRows; i++) {
        const y = pt + (ch / gridRows) * i;
        ctx.beginPath(); ctx.moveTo(pl, y); ctx.lineTo(pl + cw, y); ctx.stroke();
      }

      // X-axis time labels (relative seconds)
      ctx.fillStyle = textColor;
      ctx.font = '9px Consolas, monospace';
      ctx.textAlign = 'center';
      const xTicks = Math.max(2, Math.min(8, Math.floor(cw / 70)));
      for (let i = 0; i <= xTicks; i++) {
        const t = viewStart + (tRange / xTicks) * i;
        const x = pl + (cw / xTicks) * i;
        const relSec = ((t - tMin) / 1000).toFixed(1);
        ctx.fillText(`${relSec}s`, x, h - 4);
        // Vertical grid
        ctx.strokeStyle = gridFaintColor;
        ctx.beginPath(); ctx.moveTo(x, pt); ctx.lineTo(x, pt + ch); ctx.stroke();
      }

      // Clip to chart area so lines don't overflow
      ctx.save();
      ctx.beginPath();
      ctx.rect(pl, pt, cw, ch);
      ctx.clip();

      // Compute unified Y range across ALL signals
      let globalMinV = Infinity, globalMaxV = -Infinity;
      for (const ms of data) {
        if (ms.signal.min !== ms.signal.max) {
          if (ms.signal.min < globalMinV) globalMinV = ms.signal.min;
          if (ms.signal.max > globalMaxV) globalMaxV = ms.signal.max;
        } else {
          for (const p of ms.history) {
            if (p.t >= viewStart && p.t <= viewEnd) {
              if (p.v < globalMinV) globalMinV = p.v;
              if (p.v > globalMaxV) globalMaxV = p.v;
            }
          }
        }
      }
      if (globalMinV >= globalMaxV) { globalMinV = 0; globalMaxV = 1; }
      if (globalMinV >= 0) globalMinV = 0;
      const globalMargin = (globalMaxV - globalMinV) * 0.05 || 1;
      globalMaxV += globalMargin;
      const globalVRange = globalMaxV - globalMinV || 1;

      // Draw each signal using unified Y range
      data.forEach((ms, idx) => {
        const pts = ms.history;
        if (pts.length < 2) return;
        const color = CHART_COLORS[idx % CHART_COLORS.length];

        // Draw line
        ctx.strokeStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        let started = false;
        for (const p of pts) {
          const x = pl + ((p.t - viewStart) / tRange) * cw;
          const y = pt + ch - ((p.v - globalMinV) / globalVRange) * ch;
          if (!started) { ctx.moveTo(x, y); started = true; } else ctx.lineTo(x, y);
        }
        ctx.stroke();
      });

      // Restore clip so labels/tooltip draw outside chart area
      ctx.restore();

      // Y-axis labels (unified range)
      ctx.fillStyle = textDimColor;
      ctx.font = '9px Consolas, monospace';
      ctx.textAlign = 'right';
      for (let i = 0; i <= gridRows; i++) {
        const val = globalMaxV - (globalVRange / gridRows) * i;
        const y = pt + (ch / gridRows) * i;
        ctx.fillText(val.toFixed(1), pl - 4, y + 3);
      }

      // Legend (drawn outside clip)
      data.forEach((ms, idx) => {
        const pts = ms.history;
        if (pts.length < 2) return;
        const color = CHART_COLORS[idx % CHART_COLORS.length];
        ctx.fillStyle = color;
        ctx.font = '10px Consolas, monospace';
        ctx.textAlign = 'left';
        const lastPt = pts[pts.length - 1];
        ctx.fillText(`${ms.signal.name}: ${lastPt.v.toFixed(2)} ${ms.signal.unit}`, pl + 4, pt + 11 + idx * 13);
      });

      // Crosshair + tooltip on hover
      const mouse = mouseRef.current;
      if (mouse && mouse.x >= pl && mouse.x <= pl + cw && mouse.y >= pt && mouse.y <= pt + ch) {
        // Vertical line
        ctx.strokeStyle = crosshairColor;
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 3]);
        ctx.beginPath(); ctx.moveTo(mouse.x, pt); ctx.lineTo(mouse.x, pt + ch); ctx.stroke();
        // Horizontal line
        ctx.beginPath(); ctx.moveTo(pl, mouse.y); ctx.lineTo(pl + cw, mouse.y); ctx.stroke();
        ctx.setLineDash([]);

        // Tooltip: find time at cursor
        const cursorT = viewStart + ((mouse.x - pl) / cw) * tRange;
        const relSec = ((cursorT - tMin) / 1000).toFixed(2);
        const lines: string[] = [`t = ${relSec}s`];
        for (let i = 0; i < data.length; i++) {
          const ms = data[i];
          const pts = ms.history;
          // Find nearest point
          let nearest = pts[0];
          let bestDist = Infinity;
          for (const p of pts) {
            const d = Math.abs(p.t - cursorT);
            if (d < bestDist) { bestDist = d; nearest = p; }
          }
          if (nearest) lines.push(`${ms.signal.name}: ${nearest.v.toFixed(2)} ${ms.signal.unit}`);
        }

        // Draw tooltip box
        ctx.font = '10px Consolas, monospace';
        const lineH = 13;
        const maxW = Math.max(...lines.map((l) => ctx.measureText(l).width));
        const boxW = maxW + 12;
        const boxH = lines.length * lineH + 8;
        let tx = mouse.x + 10;
        let ty = mouse.y - boxH - 5;
        if (tx + boxW > w - pr) tx = mouse.x - boxW - 10;
        if (ty < pt) ty = mouse.y + 10;
        ctx.fillStyle = tooltipBg;
        ctx.strokeStyle = tooltipBorder;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.roundRect(tx, ty, boxW, boxH, 4);
        ctx.fill(); ctx.stroke();
        ctx.fillStyle = tooltipText;
        ctx.textAlign = 'left';
        lines.forEach((line, i) => {
          if (i > 0) ctx.fillStyle = CHART_COLORS[(i - 1) % CHART_COLORS.length];
          ctx.fillText(line, tx + 6, ty + 13 + i * lineH);
        });
      }

      // Paused indicator
      if (paused) {
        ctx.fillStyle = 'rgba(239,68,68,0.8)';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText('⏸ PAUSED', w - pr - 4, pt + 12);
      }
    };
    rafId = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(rafId);
  }, [tab, paused, activeSessionId]);

  // Mouse handlers for crosshair, pan, zoom
  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    mouseRef.current = { x, y };
    // Pan
    if (dragRef.current.dragging) {
      const dx = e.clientX - dragRef.current.lastX;
      dragRef.current.lastX = e.clientX;
      const container = containerRef.current;
      if (!container) return;
      const cw = container.clientWidth - CHART_PAD.left - CHART_PAD.right;
      const vr = viewRef.current;
      const tRange = vr.end - vr.start;
      const dt = -(dx / cw) * tRange;
      vr.start += dt;
      vr.end += dt;
      vr.pinned = true;
    }
  }, []);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 0) {
      dragRef.current = { dragging: true, lastX: e.clientX };
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    dragRef.current.dragging = false;
  }, []);

  const handleMouseLeave = useCallback(() => {
    mouseRef.current = null;
    dragRef.current.dragging = false;
  }, []);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const pl = CHART_PAD.left, pr = CHART_PAD.right;
    const cw = container.clientWidth - pl - pr;
    const frac = Math.max(0, Math.min(1, (mx - pl) / cw));

    const vr = viewRef.current;
    const tRange = vr.end - vr.start;
    const factor = e.deltaY > 0 ? 1.15 : 1 / 1.15;
    const newRange = Math.max(500, tRange * factor); // min 500ms view
    const pivot = vr.start + tRange * frac;
    vr.start = pivot - newRange * frac;
    vr.end = pivot + newRange * (1 - frac);
    vr.pinned = true;
  }, []);

  // Resize handle
  const handleResizeDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    const onMove = (ev: MouseEvent) => {
      setHeight(Math.max(100, Math.min(500, startH - (ev.clientY - startY))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [height]);

  // Context menu
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    // Find which signal legend was clicked (approximate)
    const sigIdx = Math.floor((my - CHART_PAD.top) / 13);
    const data = paused ? pausedDataRef.current : useCanDebugStore.getState().monitoredSignals;
    if (data && sigIdx >= 0 && sigIdx < data.length && mx < CHART_PAD.left + 200 && my < CHART_PAD.top + data.length * 13 + 5) {
      setCtxMenu({ x: e.clientX, y: e.clientY, sigIdx });
    } else {
      setCtxMenu({ x: e.clientX, y: e.clientY, sigIdx: -1 });
    }
  }, [paused]);

  const exportCsv = useCallback(() => {
    const data = paused ? pausedDataRef.current : useCanDebugStore.getState().monitoredSignals;
    if (!data || data.length === 0) return;
    const headers = ['time_ms', ...data.map((ms) => `${ms.signal.name}(${ms.signal.unit})`)];
    // Collect all unique timestamps
    const allTimes = new Set<number>();
    for (const ms of data) for (const p of ms.history) allTimes.add(p.t);
    const sorted = [...allTimes].sort((a, b) => a - b);
    const valMaps = data.map((ms) => {
      const m = new Map<number, number>();
      for (const p of ms.history) m.set(p.t, p.v);
      return m;
    });
    const rows = sorted.map((t) => [t, ...valMaps.map((m) => m.get(t)?.toFixed(4) ?? '')].join(','));
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `signals_${Date.now()}.csv`; a.click();
    URL.revokeObjectURL(url);
    setCtxMenu(null);
  }, [paused]);

  // Close context menu on click outside
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, [ctxMenu]);

  if (monitored.length === 0) return null;

  return (
    <div className="flex-shrink-0 flex flex-col" style={{ borderTop: '1px solid var(--color-border)' }}>
      {/* Resize handle (top edge) */}
      <div className="h-1 cursor-ns-resize hover:bg-[var(--color-accent)]" style={{ opacity: 0.4 }}
        onMouseDown={handleResizeDown} />

      {/* Tab bar */}
      <div className="flex items-center gap-1 px-2 py-0.5" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-[10px] font-medium mr-1" style={{ color: 'var(--color-text-dim)' }}>📊</span>
        {(['gauge', 'chart', 'table'] as const).map((tabKey) => (
          <button key={tabKey} onClick={() => setTab(tabKey)}
            className="px-1.5 py-0.5 text-[10px] rounded"
            style={{
              backgroundColor: tab === tabKey ? 'var(--color-hover-bg)' : 'transparent',
              color: tab === tabKey ? 'var(--color-text-primary)' : 'var(--color-text-dim)',
            }}>
            {tabKey === 'gauge' ? t('can.signal.gauge') : tabKey === 'chart' ? t('can.signal.chart') : t('can.signal.table')}
          </button>
        ))}
        {tab === 'chart' && (
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={() => setPaused(!paused)}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
              style={{ color: paused ? '#ef4444' : 'var(--color-text-dim)' }}>
              {paused ? t('can.signal.resume') : t('can.signal.pause')}
            </button>
            <button onClick={() => { viewRef.current.pinned = false; }}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
              style={{ color: 'var(--color-text-dim)' }}>
              {t('can.signal.reset')}
            </button>
            <button onClick={exportCsv}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
              style={{ color: 'var(--color-text-dim)' }}>
              📥 CSV
            </button>
          </div>
        )}
      </div>

      {/* Gauge (dashboard) view */}
      {tab === 'gauge' && (
        <div className="overflow-y-auto" style={{ maxHeight: height }}>
          {monitored.map((ms, idx) => {
            const pct = ms.signal.max !== ms.signal.min
              ? Math.max(0, Math.min(100, ((ms.value - ms.signal.min) / (ms.signal.max - ms.signal.min)) * 100))
              : 0;
            return (
              <div key={`${ms.messageId}-${ms.signal.name}`} className="flex items-center gap-2 px-2 py-0.5 text-[11px]">
                <button onClick={() => removeMonitorSignal(ms.signal.name, ms.messageId, ms.sessionId)}
                  className="text-[9px] text-red-400 hover:text-red-300">✕</button>
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: CHART_COLORS_DARK[idx % CHART_COLORS_DARK.length] }} />
                <span className="w-28 truncate" style={{ color: 'var(--color-text-secondary)' }}>{ms.signal.name}</span>
                <div className="flex-1 h-3 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--color-input-bg)' }}>
                  <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: CHART_COLORS_DARK[idx % CHART_COLORS_DARK.length] }} />
                </div>
                <span className="w-24 text-right" style={{ color: 'var(--color-text-primary)', fontFamily: 'Consolas, monospace' }}>
                  {ms.value.toFixed(2)} {ms.signal.unit}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {/* Table (signal watch) view */}
      {tab === 'table' && (
        <div className="overflow-y-auto" style={{ maxHeight: height }}>
          <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)' }}>
                <th className="text-left px-2 py-0.5 text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.signal.name')}</th>
                <th className="text-right px-2 py-0.5 text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.signal.current')}</th>
                <th className="text-right px-2 py-0.5 text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.signal.min')}</th>
                <th className="text-right px-2 py-0.5 text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.signal.max')}</th>
                <th className="text-left px-2 py-0.5 text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.signal.unit')}</th>
                <th className="w-6"></th>
              </tr>
            </thead>
            <tbody>
              {monitored.map((ms, idx) => {
                const histMin = ms.history.length > 0 ? Math.min(...ms.history.map((p) => p.v)) : ms.value;
                const histMax = ms.history.length > 0 ? Math.max(...ms.history.map((p) => p.v)) : ms.value;
                return (
                  <tr key={`${ms.messageId}-${ms.signal.name}`} className="hover:bg-[var(--color-hover-bg)]"
                    style={{ borderBottom: '1px solid var(--color-border)' }}>
                    <td className="px-2 py-0.5" style={{ color: CHART_COLORS_DARK[idx % CHART_COLORS_DARK.length], fontFamily: 'Consolas, monospace' }}>
                      {ms.signal.name}
                    </td>
                    <td className="px-2 py-0.5 text-right" style={{ color: 'var(--color-text-primary)', fontFamily: 'Consolas, monospace' }}>
                      {ms.value.toFixed(2)}
                    </td>
                    <td className="px-2 py-0.5 text-right" style={{ color: 'var(--color-text-dim)', fontFamily: 'Consolas, monospace' }}>
                      {histMin.toFixed(2)}
                    </td>
                    <td className="px-2 py-0.5 text-right" style={{ color: 'var(--color-text-dim)', fontFamily: 'Consolas, monospace' }}>
                      {histMax.toFixed(2)}
                    </td>
                    <td className="px-2 py-0.5" style={{ color: 'var(--color-text-dim)' }}>{ms.signal.unit}</td>
                    <td className="px-1">
                      <button onClick={() => removeMonitorSignal(ms.signal.name, ms.messageId, ms.sessionId)}
                        className="text-[9px] text-red-400 hover:text-red-300">✕</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Chart (waveform) view */}
      {tab === 'chart' && (
        <div ref={containerRef} style={{ height, cursor: dragRef.current.dragging ? 'grabbing' : 'crosshair', position: 'relative' }}
          onMouseMove={handleMouseMove} onMouseDown={handleMouseDown} onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseLeave} onWheel={handleWheel} onContextMenu={handleContextMenu}>
          <canvas ref={canvasRef} style={{ display: 'block' }} />
        </div>
      )}

      {/* Context menu */}
      {ctxMenu && (
        <div className="fixed z-50 rounded shadow-lg py-1 text-[11px]"
          style={{ left: ctxMenu.x, top: ctxMenu.y, backgroundColor: 'var(--color-bg)', border: '1px solid var(--color-border)', minWidth: 120 }}>
          <button className="w-full text-left px-3 py-1 hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--color-text-primary)' }}
            onClick={() => { setPaused(!paused); setCtxMenu(null); }}>
            {paused ? t('can.signal.resume') : t('can.signal.pause')}
          </button>
          <button className="w-full text-left px-3 py-1 hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--color-text-primary)' }}
            onClick={() => { viewRef.current.pinned = false; setCtxMenu(null); }}>
            {t('can.signal.resetView')}
          </button>
          <button className="w-full text-left px-3 py-1 hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--color-text-primary)' }}
            onClick={exportCsv}>
            {t('can.signal.exportCsvFull')}
          </button>
          {ctxMenu.sigIdx >= 0 && ctxMenu.sigIdx < monitored.length && (
            <button className="w-full text-left px-3 py-1 hover:bg-[var(--color-hover-bg)]"
              style={{ color: '#ef4444' }}
              onClick={() => {
                const ms = monitored[ctxMenu.sigIdx];
                removeMonitorSignal(ms.signal.name, ms.messageId, ms.sessionId);
                setCtxMenu(null);
              }}>
              {t('can.signal.remove', { name: monitored[ctxMenu.sigIdx].signal.name })}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Message Stats View ───
function MessageStatsView({ sessionId }: { sessionId: string }) {
  const t = useT();
  const statsMap = useCanDebugStore((s) => s.messageStats.get(sessionId));
  const stats = useMemo(() => {
    if (!statsMap) return [];
    return Array.from(statsMap.values()).sort((a, b) => a.canId - b.canId);
  }, [statsMap]);

  const headerStyle = { color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex text-[10px] font-medium px-1 py-0.5 flex-shrink-0" style={headerStyle}>
        <span className="w-16 text-center">ID</span>
        <span className="w-28 truncate">Name</span>
        <span className="w-16 text-right">Count</span>
        <span className="w-14 text-right">FPS</span>
        <span className="w-16 text-right">Period</span>
        <span className="w-8 text-center">DLC</span>
        <span className="flex-1">Last Data</span>
      </div>
      <div className="flex-1 overflow-y-auto" style={{ fontFamily: 'Consolas, monospace', fontSize: '11px' }}>
        {stats.length === 0 ? (
          <div className="flex items-center justify-center h-full text-[11px]" style={{ color: 'var(--color-text-dim)' }}>
            {t('can.noStats')}
          </div>
        ) : stats.map((s) => {
          const idHex = s.canId.toString(16).toUpperCase().padStart(3, '0');
          const dataHex = s.lastData.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' ');
          const period = s.fps > 0 ? (1000 / s.fps).toFixed(1) : '-';
          return (
            <div key={s.canId} className="flex items-center px-1 py-0.5 hover:bg-[var(--color-hover-bg)]"
              style={{ color: 'var(--color-text-secondary)' }}>
              <span className="w-16 text-center">{idHex}{s.extended ? 'x' : ''}</span>
              <span className="w-28 truncate text-[10px]" style={{ color: 'var(--color-text-dim)' }}>{s.name || ''}</span>
              <span className="w-16 text-right">{s.count}</span>
              <span className="w-14 text-right">{s.fps.toFixed(1)}</span>
              <span className="w-16 text-right">{period}ms</span>
              <span className="w-8 text-center">{s.lastDlc}</span>
              <span className="flex-1 tracking-wider">{dataHex}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── J1939 Parsed Message Table ───
interface J1939Row {
  seq: number;
  pgn: number;
  pgnName: string;
  priority: number;
  sa: number;
  saName: string;
  da: number | null;
  daName: string;
  dlc: number;
  dataHex: string;
  time: number;
  direction: 'tx' | 'rx';
  isTp: boolean;
  tpType?: string; // 'BAM' | 'RTS' | 'CTS' | 'EOM' | 'ABORT' | 'DT' | 'DONE'
}

function J1939Table({ sessionId, idFilter, messageFilter }: {
  sessionId: string;
  idFilter: string;
  messageFilter: 'all' | 'tx' | 'rx';
}) {
  const t = useT();
  const messages = useCanDebugStore((s) => s.messages.get(sessionId) || []);
  const ui = useCanDebugStore((s) => s.sessionUI.get(sessionId));
  const containerRef = useRef<HTMLDivElement>(null);
  const tpRef = useRef(new TpReassembler());
  const [expandedRow, setExpandedRow] = useState<number | null>(null);
  const dbc = useCanDebugStore((s) => s.dbc);

  // Incremental processing state
  const incRef = useRef<{
    rows: J1939Row[];
    seq: number;
    lastMsgSeq: number; // last processed message seq number
    prevFilter: string;
    prevMsgFilter: string;
  }>({ rows: [], seq: 0, lastMsgSeq: 0, prevFilter: '', prevMsgFilter: 'all' });

  // Parse filter PGNs
  const filterPgns = useMemo(() => {
    if (!idFilter.trim()) return null;
    return idFilter.split(',').map((s) => parseInt(s.trim(), 10)).filter((n) => !isNaN(n));
  }, [idFilter]);

  // Convert CAN messages to J1939 rows (incremental)
  const j1939Rows = useMemo(() => {
    const inc = incRef.current;
    const filterKey = idFilter + '|' + messageFilter;
    const prevFilterKey = inc.prevFilter + '|' + inc.prevMsgFilter;

    // Resolve PGN name: DBC first, then built-in dictionary
    const resolvePgnName = (pgn: number): string => {
      if (dbc) {
        const dbcMsg = dbc.messages.find((m) => m.extended && parseJ1939Id(m.id).pgn === pgn);
        if (dbcMsg) return dbcMsg.name;
      }
      return getPGNName(pgn) || '';
    };

    // If filters changed, full reset
    if (filterKey !== prevFilterKey) {
      tpRef.current.clear();
      inc.rows = [];
      inc.seq = 0;
      inc.lastMsgSeq = 0;
      inc.prevFilter = idFilter;
      inc.prevMsgFilter = messageFilter;
    }

    // Find where to start processing — skip messages we've already seen
    let startIdx = 0;
    if (inc.lastMsgSeq > 0) {
      // Binary-ish search: messages are ordered by seq, find first unprocessed
      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].seq <= inc.lastMsgSeq) {
          startIdx = i + 1;
          break;
        }
      }
    }

    // Process only new messages
    for (let i = startIdx; i < messages.length; i++) {
      const msg = messages[i];
      const f = msg.frame;
      if (!f.extended) continue;
      if (messageFilter !== 'all' && f.direction !== messageFilter) continue;

      const hdr = parseJ1939Id(f.id);
      if (filterPgns && !filterPgns.includes(hdr.pgn)) continue;

      // Detect TP frame type for display
      let tpType: string | undefined;
      if (hdr.pgn === 60416 && f.data.length >= 1) {
        const cb = f.data[0];
        if (cb === 32) tpType = 'BAM';
        else if (cb === 16) tpType = 'RTS';
        else if (cb === 17) tpType = 'CTS';
        else if (cb === 19) tpType = 'EOM';
        else if (cb === 255) tpType = 'ABORT';
        else tpType = 'CM';
      } else if (hdr.pgn === 60160) {
        tpType = `DT.${f.data[0]}`; // seq number
      }

      const tpResult = tpRef.current.process(f.id, f.data, f.timestamp);
      if (tpResult) {
        inc.seq++;
        inc.rows.push({
          seq: inc.seq,
          pgn: tpResult.pgn,
          pgnName: resolvePgnName(tpResult.pgn),
          priority: hdr.priority,
          sa: tpResult.sa,
          saName: getSAName(tpResult.sa) || '',
          da: tpResult.da,
          daName: tpResult.da != null ? (getSAName(tpResult.da) || '') : '',
          dlc: tpResult.data.length,
          dataHex: tpResult.data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          time: f.timestamp,
          direction: f.direction,
          isTp: true,
          tpType: 'DONE',
        });
        continue;
      }

      // Show TP.CM and TP.DT frames with their type labels
      if (hdr.pgn === 60416 || hdr.pgn === 60160) {
        inc.seq++;
        inc.rows.push({
          seq: inc.seq,
          pgn: hdr.pgn,
          pgnName: resolvePgnName(hdr.pgn),
          priority: hdr.priority,
          sa: hdr.sourceAddress,
          saName: getSAName(hdr.sourceAddress) || '',
          da: hdr.destinationAddress,
          daName: hdr.destinationAddress != null ? (getSAName(hdr.destinationAddress) || '') : '',
          dlc: f.dlc,
          dataHex: f.data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
          time: f.timestamp,
          direction: f.direction,
          isTp: true,
          tpType,
        });
        continue;
      }

      inc.seq++;
      inc.rows.push({
        seq: inc.seq,
        pgn: hdr.pgn,
        pgnName: resolvePgnName(hdr.pgn),
        priority: hdr.priority,
        sa: hdr.sourceAddress,
        saName: getSAName(hdr.sourceAddress) || '',
        da: hdr.destinationAddress,
        daName: hdr.destinationAddress != null ? (getSAName(hdr.destinationAddress) || '') : '',
        dlc: f.dlc,
        dataHex: f.data.map((b) => b.toString(16).padStart(2, '0').toUpperCase()).join(' '),
        time: f.timestamp,
        direction: f.direction,
        isTp: false,
      });
    }
    if (messages.length > 0) {
      inc.lastMsgSeq = messages[messages.length - 1].seq;
    }

    // Trim rows to prevent unbounded growth (keep last 5000)
    if (inc.rows.length > 5000) {
      inc.rows = inc.rows.slice(-5000);
    }

    return [...inc.rows];
  }, [messages, messageFilter, filterPgns, idFilter]);

  // Auto-scroll
  useEffect(() => {
    if (ui?.autoScroll && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [j1939Rows.length, ui?.autoScroll]);

  // Resolve DBC signals for a PGN
  const getSignals = useCallback((pgn: number, dataHex: string) => {
    if (!dbc) return null;
    // Find DBC message matching this PGN (extended ID encodes PGN)
    const dbcMsg = dbc.messages.find((m) => {
      if (!m.extended) return false;
      const h = parseJ1939Id(m.id);
      return h.pgn === pgn;
    });
    if (!dbcMsg || dbcMsg.signals.length === 0) return null;
    const dataBytes = dataHex.split(' ').map((h) => parseInt(h, 16));
    return { msg: dbcMsg, data: dataBytes };
  }, [dbc]);

  const startTime = getSessionStartTime(sessionId);
  const timeStr = (ms: number) => ((ms - startTime) / 1000).toFixed(3);

  return (
    <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-0 text-[9px] font-medium px-2 py-0.5 flex-shrink-0"
        style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
        <span className="w-10 text-center">#</span>
        <span className="w-14">PGN</span>
        <span className="flex-1 min-w-[100px]">PGN Name</span>
        <span className="w-8 text-center">Pri</span>
        <span className="w-10 text-center">SA</span>
        <span className="w-20">SA Name</span>
        <span className="w-10 text-center">DA</span>
        <span className="w-8 text-center">DLC</span>
        <span className="flex-1 min-w-[120px]">Data</span>
        <span className="w-16 text-right">Time</span>
      </div>
      {/* Rows */}
      <div ref={containerRef} className="flex-1 overflow-y-auto font-mono text-[10px]"
        style={{ backgroundColor: 'var(--color-surface)' }}>
        {j1939Rows.length === 0 && (
          <div className="flex items-center justify-center h-full text-xs" style={{ color: 'var(--color-text-dim)' }}>
            {t('can.j1939Empty')}
          </div>
        )}
        {j1939Rows.map((row) => (
          <React.Fragment key={row.seq}>
            <div
              className="flex items-center gap-0 px-2 py-0.5 cursor-pointer hover:bg-[var(--color-hover-bg)]"
              style={{ borderBottom: '1px solid var(--color-border)', backgroundColor: row.isTp ? 'rgba(37, 99, 235, 0.1)' : undefined }}
              onClick={() => setExpandedRow(expandedRow === row.seq ? null : row.seq)}
            >
              <span className="w-10 text-center" style={{ color: 'var(--color-text-dim)' }}>{row.seq}</span>
              <span className="w-14" style={{ color: 'var(--color-accent)', fontWeight: 500 }}>{row.pgn}</span>
              <span className="flex-1 min-w-[100px] truncate" style={{ color: 'var(--color-text-secondary)' }}>
                {row.tpType && <span className="text-[8px] px-0.5 rounded mr-1" style={{
                  backgroundColor: row.tpType === 'DONE' ? '#16a34a' : row.tpType === 'BAM' || row.tpType === 'RTS' ? '#2563eb' : row.tpType === 'CTS' || row.tpType === 'EOM' ? '#9333ea' : row.tpType === 'ABORT' ? '#dc2626' : '#6b7280',
                  color: 'white'
                }}>{row.tpType}</span>}
                {row.pgnName || '-'}
              </span>
              <span className="w-8 text-center" style={{ color: 'var(--color-text-dim)' }}>{row.priority}</span>
              <span className="w-10 text-center" style={{ color: row.direction === 'tx' ? '#2563eb' : '#16a34a' }}>
                {row.sa.toString(16).toUpperCase().padStart(2, '0')}
              </span>
              <span className="w-20 truncate" style={{ color: 'var(--color-text-dim)' }}>{row.saName || '-'}</span>
              <span className="w-10 text-center" style={{ color: 'var(--color-text-dim)' }}>
                {row.da != null ? row.da.toString(16).toUpperCase().padStart(2, '0') : '-'}
              </span>
              <span className="w-8 text-center" style={{ color: 'var(--color-text-dim)' }}>{row.dlc}</span>
              <span className="flex-1 min-w-[120px] truncate" style={{ color: 'var(--color-text-primary)' }}>{row.dataHex}</span>
              <span className="w-16 text-right" style={{ color: 'var(--color-text-dim)' }}>{timeStr(row.time)}</span>
            </div>
            {/* Expanded signal detail */}
            {expandedRow === row.seq && (() => {
              const sigInfo = getSignals(row.pgn, row.dataHex);
              if (!sigInfo) return (
                <div className="px-4 py-1 text-[9px]" style={{ color: 'var(--color-text-dim)', backgroundColor: 'var(--color-surface-hover)' }}>
                  {t('can.j1939noSignals')}
                </div>
              );
              return (
                <div className="px-4 py-1 text-[9px]" style={{ backgroundColor: 'var(--color-surface-hover)' }}>
                  <div className="font-medium mb-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                    {sigInfo.msg.name} — {sigInfo.msg.signals.length} signals
                  </div>
                  {sigInfo.msg.signals.map((sig) => {
                    // Simple raw extraction for display
                    let rawVal = 0;
                    const bytePos = Math.floor(sig.startBit / 8);
                    const bitInByte = sig.startBit % 8;
                    if (sig.byteOrder === 'little_endian') {
                      for (let i = 0; i < sig.bitLength && bytePos + Math.floor((bitInByte + i) / 8) < sigInfo.data.length; i++) {
                        const bi = bytePos + Math.floor((bitInByte + i) / 8);
                        const bit = (bitInByte + i) % 8;
                        if (sigInfo.data[bi] & (1 << bit)) rawVal |= (1 << i);
                      }
                    } else {
                      // Motorola / big-endian
                      for (let i = 0; i < sig.bitLength; i++) {
                        const srcByte = Math.floor(sig.startBit / 8) - Math.floor(i / 8);
                        const srcBit = sig.startBit % 8 - (i % 8);
                        const adjByte = srcByte + (srcBit < 0 ? -1 : 0);
                        const adjBit = srcBit < 0 ? srcBit + 8 : srcBit;
                        if (adjByte >= 0 && adjByte < sigInfo.data.length && (sigInfo.data[adjByte] & (1 << adjBit))) {
                          rawVal |= (1 << (sig.bitLength - 1 - i));
                        }
                      }
                    }
                    const phys = rawVal * sig.factor + sig.offset;
                    return (
                      <div key={sig.name} className="flex gap-2" style={{ color: 'var(--color-text-primary)' }}>
                        <span style={{ color: 'var(--color-accent)' }}>{sig.name}</span>
                        <span>= {phys.toFixed(sig.factor < 1 ? 2 : 0)} {sig.unit}</span>
                      </div>
                    );
                  })}
                </div>
              );
            })()}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
}

// ─── Send List Panel ───
function SendListPanel({ sessionId, onEditDbcItem }: { sessionId: string; onEditDbcItem?: (msg: DbcMessage, itemId: string) => void }) {
  const t = useT();
  const ui = useCanDebugStore((s) => s.sessionUI.get(sessionId));
  const dbc = useCanDebugStore((s) => s.dbc);
  const addItem = useCanDebugStore((s) => s.addSendListItem);
  const removeItem = useCanDebugStore((s) => s.removeSendListItem);
  const updateItem = useCanDebugStore((s) => s.updateSendListItem);
  const toggleItem = useCanDebugStore((s) => s.toggleSendListItem);
  const sendOnce = useCanDebugStore((s) => s.sendListItemOnce);
  const session = useCanDebugStore((s) => s.sessions.find((ss) => ss.id === sessionId));

  if (!ui) return null;
  const isConnected = session?.status === 'connected';

  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="flex-shrink-0 flex flex-col" style={{ borderTop: '1px solid var(--color-border)', maxHeight: 200 }}>
      {/* Fixed header */}
      <div className="flex items-center justify-between px-2 py-0.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-[10px] font-medium" style={{ color: 'var(--color-text-dim)' }}>{t('can.sendListTitle')}</span>
        <button onClick={() => addItem(sessionId)}
          className="text-[10px] px-1.5 py-0.5 rounded hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
          {t('can.sendListAdd')}
        </button>
      </div>
      {ui.sendList.length === 0 ? (
        <div className="text-[10px] text-center py-2" style={{ color: 'var(--color-text-dim)' }}>
          {t('can.sendListEmpty')}
        </div>
      ) : (
        <div className="text-[11px] flex flex-col min-h-0">
          {/* Fixed column header */}
          <div className="flex items-center gap-1 px-2 py-0.5 text-[9px] flex-shrink-0" style={{ color: 'var(--color-text-dim)', borderBottom: '1px solid var(--color-border)' }}>
            <span className="w-12"></span>
            {dbc && <span className="w-5"></span>}
            <span className="w-16">ID (HEX)</span>
            <span className="w-10">DLC</span>
            <span className="flex-1">Data (HEX)</span>
            <span className="w-16">{t('can.sendListIntervalMs')}</span>
            <span className="w-16 text-center">{t('can.sendListActions')}</span>
          </div>
          {/* Scrollable rows */}
          <div className="overflow-y-auto flex-1">
          {ui.sendList.map((item) => (
            <div key={item.id} className="flex items-center gap-1 px-2 py-0.5 hover:bg-[var(--color-hover-bg)]">
              <button onClick={() => {
                if (!isConnected) return;
                sendOnce(sessionId, item.id);
              }}
                className="w-6 text-center text-[10px]"
                style={{ color: 'var(--color-text-secondary)', cursor: isConnected ? 'pointer' : 'default' }}
                title={t('can.sendOnce')}>
                📤
              </button>
              <button onClick={() => isConnected && toggleItem(sessionId, item.id)}
                className="w-6 text-center text-[10px]"
                style={{ color: item.enabled ? '#4ade80' : 'var(--color-text-dim)', cursor: isConnected ? 'pointer' : 'default' }}
                title={item.enabled ? t('can.timerStop') : t('can.timerStart')}>
                {item.enabled ? '⏹' : '⏱'}
              </button>
              {(() => {
                const canId = parseInt(item.canId, 16);
                const dbcMsg = dbc?.messages.find((m) => m.id === canId && m.extended === item.extended);
                if (dbcMsg && onEditDbcItem) {
                  return (
                    <button onClick={() => onEditDbcItem(dbcMsg, item.id)}
                      className="w-5 text-center text-[10px] rounded hover:bg-[var(--color-accent)] hover:text-white"
                      style={{ color: 'var(--color-text-dim)' }}
                      title={`${t('can.editSignal')}: ${dbcMsg.name}`}>
                      ✏️
                    </button>
                  );
                }
                return dbc ? <span className="w-5"></span> : null;
              })()}
              <input value={item.canId} onChange={(e) => updateItem(sessionId, item.id, { canId: e.target.value })}
                className="w-16 px-1 py-0.5 text-[10px] rounded" style={inputStyle} disabled={item.enabled} />
              <input value={item.dlc} onChange={(e) => updateItem(sessionId, item.id, { dlc: parseInt(e.target.value) || 8 })}
                className="w-10 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} disabled={item.enabled} />
              <input value={item.data} onChange={(e) => updateItem(sessionId, item.id, { data: e.target.value })}
                className="flex-1 px-1 py-0.5 text-[10px] rounded font-mono" style={inputStyle} disabled={item.enabled} />
              <input value={item.intervalMs} onChange={(e) => updateItem(sessionId, item.id, { intervalMs: parseInt(e.target.value) || 100 })}
                className="w-16 px-1 py-0.5 text-[10px] rounded text-center" style={inputStyle} disabled={item.enabled} />
              <button onClick={() => removeItem(sessionId, item.id)}
                className="w-16 text-center text-[9px] text-red-400 hover:text-red-300" title={t('can.deleteSendItem')}>
                🗑
              </button>
            </div>
          ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Send Panel ───
function SendPanel({ sessionId }: { sessionId: string }) {
  const t = useT();
  const ui = useCanDebugStore((s) => s.sessionUI.get(sessionId));
  const updateUI = useCanDebugStore((s) => s.updateSessionUI);
  const sendFrame = useCanDebugStore((s) => s.sendFrame);
  const startTimer = useCanDebugStore((s) => s.startTimer);
  const stopTimer = useCanDebugStore((s) => s.stopTimer);
  const session = useCanDebugStore((s) => s.sessions.find((ss) => ss.id === sessionId));

  if (!ui || !session || session.status !== 'connected') return null;

  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  const fdDlcOptions = [0, 1, 2, 3, 4, 5, 6, 7, 8, 12, 16, 20, 24, 32, 48, 64];

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 flex-wrap" style={{ borderTop: '1px solid var(--color-border)' }}>
      <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>ID:</label>
      <input value={ui.sendId} onChange={(e) => updateUI(sessionId, { sendId: e.target.value })}
        className="w-16 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle} placeholder="1A0" />
      <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
        <input type="checkbox" checked={ui.sendExtended} onChange={(e) => updateUI(sessionId, { sendExtended: e.target.checked })} />
        EXT
      </label>
      <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
        <input type="checkbox" checked={ui.sendFd} onChange={(e) => {
          updateUI(sessionId, { sendFd: e.target.checked, sendBrs: e.target.checked ? ui.sendBrs : false });
          if (e.target.checked && parseInt(ui.sendDlc) <= 8) updateUI(sessionId, { sendDlc: '8' });
        }} />
        FD
      </label>
      {ui.sendFd && (
        <label className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--color-text-dim)' }}>
          <input type="checkbox" checked={ui.sendBrs} onChange={(e) => updateUI(sessionId, { sendBrs: e.target.checked })} />
          BRS
        </label>
      )}
      <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>DLC:</label>
      {ui.sendFd ? (
        <select value={ui.sendDlc} onChange={(e) => updateUI(sessionId, { sendDlc: e.target.value })}
          className="w-14 px-1 py-0.5 text-[11px] rounded" style={inputStyle}>
          {fdDlcOptions.map((v) => <option key={v} value={v}>{v}</option>)}
        </select>
      ) : (
        <input value={ui.sendDlc} onChange={(e) => updateUI(sessionId, { sendDlc: e.target.value })}
          className="w-10 px-1.5 py-0.5 text-[11px] rounded text-center" style={inputStyle} />
      )}
      <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>Data:</label>
      <input value={ui.sendData} onChange={(e) => updateUI(sessionId, { sendData: e.target.value })}
        className="flex-1 min-w-[120px] px-1.5 py-0.5 text-[11px] rounded font-mono" style={inputStyle}
        placeholder="01 02 03 04 05 06 07 08" />
      <button onClick={() => sendFrame(sessionId)}
        className="px-3 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90">
        {t('common.send')}
      </button>
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
      <input value={ui.timerInterval} onChange={(e) => updateUI(sessionId, { timerInterval: e.target.value })}
        className="w-14 px-1.5 py-0.5 text-[11px] rounded text-center" style={inputStyle} placeholder="ms" disabled={ui.timerRunning} />
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>ms</span>
      {!ui.timerRunning ? (
        <button onClick={() => startTimer(sessionId)}
          className="px-2 py-1 text-[11px] rounded text-white bg-[var(--color-accent)] hover:opacity-90">
          {t('can.timerBtn')}
        </button>
      ) : (
        <button onClick={() => stopTimer(sessionId)}
          className="px-2 py-1 text-[11px] rounded text-white bg-red-500 hover:bg-red-600">
          {t('can.timerStopBtn')}
        </button>
      )}
    </div>
  );
}

// ─── UDS Diagnostic Panel ───
interface UdsLogRow {
  seq: number;
  timestamp: number;
  direction: 'tx' | 'rx';
  serviceId: number;
  serviceName: string;
  data: number[];
  positive?: boolean;
  nrc?: number;
  nrcName?: string;
}

type UdsServiceType = 'sessionControl' | 'ecuReset' | 'clearDtc' | 'readDtc' | 'readDid' | 'writeDid' | 'securityAccess' | 'ioControl' | 'routineControl' | 'raw';

function UdsPanel({ sessionId }: { sessionId: string }) {
  const t = useT();
  const [txId, setTxId] = useState('7DF');
  const [rxId, setRxId] = useState('7E8');
  const [service, setService] = useState<UdsServiceType>('readDid');
  const [sending, setSending] = useState(false);
  const [tpRunning, setTpRunning] = useState(false);
  const [logs, setLogs] = useState<UdsLogRow[]>([]);
  const logRef = useRef<HTMLDivElement>(null);

  // Service-specific params
  const [sessionType, setSessionType] = useState('03');
  const [resetType, setResetType] = useState('01');
  const [did, setDid] = useState('F190');
  const [writeData, setWriteData] = useState('');
  const [secLevel, setSecLevel] = useState('01');
  const [secKey, setSecKey] = useState('');
  const [routineType, setRoutineType] = useState('01');
  const [routineId, setRoutineId] = useState('FF00');
  const [routineData, setRouteData] = useState('');
  const [rawHex, setRawHex] = useState('22 F1 90');
  const [dtcSubFunc, setDtcSubFunc] = useState('01');

  // Listen for UDS log entries from main process
  useEffect(() => {
    const cleanup = window.api.can.onUdsLog(sessionId, (entry: UdsLogRow) => {
      setLogs((prev) => {
        const next = [...prev, entry];
        if (next.length > 2000) next.splice(0, 500);
        return next;
      });
    });
    return cleanup;
  }, [sessionId]);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [logs]);

  // Cleanup TesterPresent on unmount
  useEffect(() => {
    return () => {
      if (tpRunning) {
        const tx = parseInt(txId, 16);
        const rx = parseInt(rxId, 16);
        if (!isNaN(tx) && !isNaN(rx)) {
          window.api.can.udsStopTesterPresent(sessionId, tx, rx);
        }
      }
    };
  }, [tpRunning, sessionId, txId, rxId]);

  const buildPayload = (): number[] | null => {
    switch (service) {
      case 'sessionControl': return [0x10, parseInt(sessionType, 16)];
      case 'ecuReset': return [0x11, parseInt(resetType, 16)];
      case 'clearDtc': return [0x14, 0xFF, 0xFF, 0xFF];
      case 'readDtc': return [0x19, parseInt(dtcSubFunc, 16), 0xFF];
      case 'readDid': {
        const d = parseInt(did, 16);
        return [0x22, (d >> 8) & 0xFF, d & 0xFF];
      }
      case 'writeDid': {
        const d = parseInt(did, 16);
        const bytes = writeData.trim().split(/\s+/).map((s) => parseInt(s, 16)).filter((n) => !isNaN(n));
        return [0x2E, (d >> 8) & 0xFF, d & 0xFF, ...bytes];
      }
      case 'securityAccess': {
        const lvl = parseInt(secLevel, 16);
        if (secKey.trim()) {
          const keyBytes = secKey.trim().split(/\s+/).map((s) => parseInt(s, 16)).filter((n) => !isNaN(n));
          return [0x27, lvl + 1, ...keyBytes]; // sendKey = level + 1
        }
        return [0x27, lvl]; // requestSeed
      }
      case 'ioControl': {
        const d = parseInt(did, 16);
        const bytes = writeData.trim().split(/\s+/).map((s) => parseInt(s, 16)).filter((n) => !isNaN(n));
        return [0x2F, (d >> 8) & 0xFF, d & 0xFF, ...bytes];
      }
      case 'routineControl': {
        const rt = parseInt(routineType, 16);
        const rid = parseInt(routineId, 16);
        const bytes = routineData.trim() ? routineData.trim().split(/\s+/).map((s) => parseInt(s, 16)).filter((n) => !isNaN(n)) : [];
        return [0x31, rt, (rid >> 8) & 0xFF, rid & 0xFF, ...bytes];
      }
      case 'raw': {
        const bytes = rawHex.trim().split(/\s+/).map((s) => parseInt(s, 16)).filter((n) => !isNaN(n));
        return bytes.length > 0 ? bytes : null;
      }
    }
    return null;
  };

  const handleSend = async () => {
    const tx = parseInt(txId, 16);
    const rx = parseInt(rxId, 16);
    if (isNaN(tx) || isNaN(rx)) return;
    const payload = buildPayload();
    if (!payload) return;
    setSending(true);
    try {
      await window.api.can.udsRequest(sessionId, tx, rx, payload);
    } catch (err: any) {
      setLogs((prev) => [...prev, {
        seq: prev.length + 1, timestamp: Date.now(), direction: 'rx',
        serviceId: payload[0], serviceName: 'Error', data: [],
        positive: false, nrcName: err.message,
      }]);
    }
    setSending(false);
  };

  const handleTpToggle = () => {
    const tx = parseInt(txId, 16);
    const rx = parseInt(rxId, 16);
    if (isNaN(tx) || isNaN(rx)) return;
    if (tpRunning) {
      window.api.can.udsStopTesterPresent(sessionId, tx, rx);
      setTpRunning(false);
    } else {
      window.api.can.udsStartTesterPresent(sessionId, tx, rx);
      setTpRunning(true);
    }
  };

  const inputStyle: React.CSSProperties = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  const selectStyle: React.CSSProperties = { ...inputStyle };

  const services: { key: UdsServiceType; label: string }[] = [
    { key: 'sessionControl', label: t('can.uds.sessionControl') },
    { key: 'ecuReset', label: t('can.uds.ecuReset') },
    { key: 'readDid', label: t('can.uds.readDid') },
    { key: 'writeDid', label: t('can.uds.writeDid') },
    { key: 'readDtc', label: t('can.uds.readDtc') },
    { key: 'clearDtc', label: t('can.uds.clearDtc') },
    { key: 'securityAccess', label: t('can.uds.securityAccess') },
    { key: 'ioControl', label: t('can.uds.ioControl') },
    { key: 'routineControl', label: t('can.uds.routineControl') },
    { key: 'raw', label: t('can.uds.raw') },
  ];

  const renderParams = () => {
    switch (service) {
      case 'sessionControl':
        return (
          <select value={sessionType} onChange={(e) => setSessionType(e.target.value)}
            className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
            <option value="01">{t('can.uds.sessionDefault')}</option>
            <option value="02">{t('can.uds.sessionProgramming')}</option>
            <option value="03">{t('can.uds.sessionExtended')}</option>
          </select>
        );
      case 'ecuReset':
        return (
          <select value={resetType} onChange={(e) => setResetType(e.target.value)}
            className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
            <option value="01">{t('can.uds.resetHard')}</option>
            <option value="02">{t('can.uds.resetKeyOff')}</option>
            <option value="03">{t('can.uds.resetSoft')}</option>
          </select>
        );
      case 'readDid':
        return (
          <input value={did} onChange={(e) => setDid(e.target.value)}
            className="w-20 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
            placeholder="F190" />
        );
      case 'writeDid':
        return (
          <>
            <input value={did} onChange={(e) => setDid(e.target.value)}
              className="w-20 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder="F190" />
            <input value={writeData} onChange={(e) => setWriteData(e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder={t('can.uds.data')} />
          </>
        );
      case 'readDtc':
        return (
          <select value={dtcSubFunc} onChange={(e) => setDtcSubFunc(e.target.value)}
            className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
            <option value="01">reportNumberOfDTCByStatusMask (01)</option>
            <option value="02">reportDTCByStatusMask (02)</option>
            <option value="06">reportDTCExtDataRecordByDTCNumber (06)</option>
            <option value="0A">reportSupportedDTC (0A)</option>
          </select>
        );
      case 'clearDtc':
        return <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>Clear all DTCs (FF FF FF)</span>;
      case 'securityAccess':
        return (
          <>
            <select value={secLevel} onChange={(e) => setSecLevel(e.target.value)}
              className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
              <option value="01">Level 1 (01)</option>
              <option value="03">Level 2 (03)</option>
              <option value="05">Level 3 (05)</option>
              <option value="11">Level 9 (11)</option>
            </select>
            <input value={secKey} onChange={(e) => setSecKey(e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder={t('can.uds.secSendKey') + ' (Hex, empty=RequestSeed)'} />
          </>
        );
      case 'ioControl':
        return (
          <>
            <input value={did} onChange={(e) => setDid(e.target.value)}
              className="w-20 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder="DID" />
            <input value={writeData} onChange={(e) => setWriteData(e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder="03 (ShortTermAdj) + value bytes" />
          </>
        );
      case 'routineControl':
        return (
          <>
            <select value={routineType} onChange={(e) => setRoutineType(e.target.value)}
              className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
              <option value="01">{t('can.uds.routineStart')}</option>
              <option value="02">{t('can.uds.routineStop')}</option>
              <option value="03">{t('can.uds.routineResult')}</option>
            </select>
            <input value={routineId} onChange={(e) => setRoutineId(e.target.value)}
              className="w-20 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder="FF00" />
            <input value={routineData} onChange={(e) => setRouteData(e.target.value)}
              className="flex-1 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle}
              placeholder={t('can.uds.data')} />
          </>
        );
      case 'raw':
        return (
          <input value={rawHex} onChange={(e) => setRawHex(e.target.value)}
            className="flex-1 px-1.5 py-0.5 text-[11px] rounded font-mono" style={inputStyle}
            placeholder="22 F1 90" />
        );
    }
  };

  const formatHex = (data: number[]) => data.map((b) => b.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}.${d.getMilliseconds().toString().padStart(3, '0')}`;
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      {/* Config bar */}
      <div className="flex items-center gap-2 px-2 py-1 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>TxID:</label>
        <input value={txId} onChange={(e) => setTxId(e.target.value)}
          className="w-16 px-1.5 py-0.5 text-[11px] rounded font-mono" style={inputStyle} />
        <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>RxID:</label>
        <input value={rxId} onChange={(e) => setRxId(e.target.value)}
          className="w-16 px-1.5 py-0.5 text-[11px] rounded font-mono" style={inputStyle} />
        <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
        <button onClick={handleTpToggle}
          className="px-1.5 py-0.5 text-[10px] rounded"
          style={{
            backgroundColor: tpRunning ? '#22c55e' : 'var(--color-input-bg)',
            color: tpRunning ? 'white' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-input-border)',
          }}>
          {tpRunning ? t('can.uds.tpStop') : t('can.uds.tpStart')}
        </button>
        <button onClick={() => setLogs([])}
          className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
          style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
          🗑 {t('can.uds.clearLog')}
        </button>
      </div>

      {/* Service selector + params + send */}
      <div className="flex items-center gap-1.5 px-2 py-1 flex-shrink-0 flex-wrap"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <select value={service} onChange={(e) => setService(e.target.value as UdsServiceType)}
          className="px-1.5 py-0.5 text-[11px] rounded" style={selectStyle}>
          {services.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        {renderParams()}
        <button onClick={handleSend} disabled={sending}
          className="px-2 py-0.5 text-[11px] rounded font-medium"
          style={{
            backgroundColor: 'var(--color-accent)',
            color: 'white',
            opacity: sending ? 0.6 : 1,
          }}>
          {sending ? t('can.uds.sending') : t('can.uds.send')}
        </button>
      </div>

      {/* Log table */}
      <div ref={logRef} className="flex-1 overflow-auto" style={{ fontFamily: 'Consolas, monospace' }}>
        {logs.length === 0 ? (
          <div className="flex items-center justify-center h-full" style={{ color: 'var(--color-text-dim)' }}>
            <span className="text-xs">{t('can.uds.noLog')}</span>
          </div>
        ) : (
          <table className="w-full text-[11px]" style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--color-border)', position: 'sticky', top: 0, backgroundColor: 'var(--color-bg)', zIndex: 1 }}>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)', width: 40 }}>#</th>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)', width: 80 }}>{t('can.uds.logTime')}</th>
                <th className="px-1.5 py-0.5 text-center" style={{ color: 'var(--color-text-dim)', width: 30 }}>{t('can.uds.logDir')}</th>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)', width: 40 }}>SID</th>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)', width: 160 }}>{t('can.uds.logService')}</th>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)' }}>{t('can.uds.logData')}</th>
                <th className="px-1.5 py-0.5 text-left" style={{ color: 'var(--color-text-dim)', width: 120 }}>{t('can.uds.logResult')}</th>
              </tr>
            </thead>
            <tbody>
              {logs.map((row, i) => (
                <tr key={i} style={{
                  borderBottom: '1px solid var(--color-border)',
                  backgroundColor: row.direction === 'tx' ? 'rgba(59,130,246,0.05)' : row.positive === false ? 'rgba(239,68,68,0.08)' : 'transparent',
                }}>
                  <td className="px-1.5 py-0.5" style={{ color: 'var(--color-text-dim)' }}>{row.seq}</td>
                  <td className="px-1.5 py-0.5" style={{ color: 'var(--color-text-secondary)' }}>{formatTime(row.timestamp)}</td>
                  <td className="px-1.5 py-0.5 text-center">
                    <span style={{ color: row.direction === 'tx' ? '#3b82f6' : '#22c55e' }}>
                      {row.direction === 'tx' ? '↑TX' : '↓RX'}
                    </span>
                  </td>
                  <td className="px-1.5 py-0.5" style={{ color: 'var(--color-text-primary)' }}>
                    {row.serviceId.toString(16).toUpperCase().padStart(2, '0')}
                  </td>
                  <td className="px-1.5 py-0.5" style={{ color: 'var(--color-text-primary)' }}>{row.serviceName}</td>
                  <td className="px-1.5 py-0.5" style={{ color: 'var(--color-text-secondary)' }}>{formatHex(row.data)}</td>
                  <td className="px-1.5 py-0.5">
                    {row.direction === 'rx' && (
                      row.positive ? (
                        <span style={{ color: '#22c55e' }}>{t('can.uds.positive')}</span>
                      ) : row.nrcName ? (
                        <span style={{ color: '#ef4444' }} title={row.nrcName}>❌ {row.nrcName}</span>
                      ) : null
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ─── Toolbar ───
function Toolbar({ sessionId }: { sessionId: string }) {
  const t = useT();
  const ui = useCanDebugStore((s) => s.sessionUI.get(sessionId));
  const updateUI = useCanDebugStore((s) => s.updateSessionUI);
  const clearMessages = useCanDebugStore((s) => s.clearMessages);
  const loadDbc = useCanDebugStore((s) => s.loadDbc);
  const dbc = useCanDebugStore((s) => s.dbc);
  const startRecording = useCanDebugStore((s) => s.startRecording);
  const stopRecording = useCanDebugStore((s) => s.stopRecording);
  const busLoad = useCanDebugStore((s) => s.busLoad.get(sessionId) ?? 0);
  const replayAsc = useCanDebugStore((s) => s.replayAsc);
  const messages = useCanDebugStore((s) => s.messages.get(sessionId) || []);

  if (!ui) return null;

  const handleDbcDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.dbc')) return;
    const text = await file.text();
    await loadDbc(text);
  };

  const handleDbcFileInput = async () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dbc';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await loadDbc(text);
    };
    input.click();
  };

  const handleRecordToggle = async () => {
    if (ui.recording) {
      await stopRecording(sessionId);
    } else {
      const filePath = await window.api.dialog.selectSaveLocation('can_log.asc');
      if (filePath) await startRecording(sessionId, filePath);
    }
  };

  const handleReplayAsc = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.asc';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      replayAsc(sessionId, text);
    };
    input.click();
  };

  const handleExportBlf = async () => {
    if (messages.length === 0) return;
    const filePath = await window.api.dialog.selectSaveLocation('can_log.blf');
    if (!filePath) return;
    // Build BLF binary in memory
    const startTime = getSessionStartTime(sessionId);
    const objectBuffers: ArrayBuffer[] = [];
    for (const row of messages) {
      const f = row.frame;
      const dataLen = Math.min(f.dlc, f.data.length);
      // CAN Message object (objectType=1)
      // Object header: 16 bytes signature + base header, then CAN message payload
      const objHeaderSize = 16; // 'BL' signature(4) + headerSize(2) + headerVer(2) + objSize(4) + objType(4)
      const canMsgSize = 24 + dataLen; // channel(2) + dlc(1) + flags(1) + id(4) + timestamp(8) + pad(8) + data
      const totalObjSize = objHeaderSize + canMsgSize;
      // Pad to 4-byte alignment
      const paddedSize = (totalObjSize + 3) & ~3;
      const buf = new ArrayBuffer(paddedSize);
      const view = new DataView(buf);
      // Object signature "LOBJ"
      view.setUint8(0, 0x4C); view.setUint8(1, 0x4F); view.setUint8(2, 0x42); view.setUint8(3, 0x4A);
      view.setUint16(4, objHeaderSize, true); // headerSize
      view.setUint16(6, 1, true); // headerVersion
      view.setUint32(8, paddedSize, true); // objSize
      view.setUint32(12, 1, true); // objectType = CAN_MESSAGE
      // CAN message payload
      const p = objHeaderSize;
      view.setUint16(p, 0, true); // channel
      view.setUint8(p + 2, dataLen); // dlc
      view.setUint8(p + 3, (f.direction === 'tx' ? 0x40 : 0) | (f.extended ? 0x04 : 0)); // flags
      view.setUint32(p + 4, f.id, true); // id
      // timestamp in nanoseconds (relative)
      const tsNs = BigInt(Math.round((f.timestamp - startTime) * 1000000));
      view.setBigUint64(p + 8, tsNs, true);
      // data
      for (let i = 0; i < dataLen; i++) {
        view.setUint8(p + 24 + i, f.data[i] || 0);
      }
      objectBuffers.push(buf);
    }
    // File header (144 bytes)
    const fileHeaderSize = 144;
    const objectsSize = objectBuffers.reduce((sum, b) => sum + b.byteLength, 0);
    const totalFileSize = fileHeaderSize + objectsSize;
    const fileHeader = new ArrayBuffer(fileHeaderSize);
    const fv = new DataView(fileHeader);
    // Signature "BLF0400"
    const sig = [0x42, 0x4C, 0x46, 0x30, 0x34, 0x30, 0x30];
    for (let i = 0; i < 7; i++) fv.setUint8(i, sig[i]);
    fv.setUint32(8, fileHeaderSize, true); // statisticsSize (header size)
    fv.setUint32(12, 0x0403, true); // apiVersion
    fv.setUint32(24, messages.length, true); // objectCount
    // objectsRead (same as objectCount for export)
    fv.setUint32(28, messages.length, true);
    // fileSize
    const fileSizeBig = BigInt(totalFileSize);
    fv.setBigUint64(32, fileSizeBig, true);
    // uncompressedFileSize
    fv.setBigUint64(40, fileSizeBig, true);
    // objectCount again at offset 48
    fv.setUint32(48, messages.length, true);
    // Measurement start time (SYSTEMTIME at offset 72, 16 bytes)
    const startDate = new Date(startTime);
    fv.setUint16(72, startDate.getFullYear(), true);
    fv.setUint16(74, startDate.getMonth() + 1, true);
    fv.setUint16(76, startDate.getDay(), true);
    fv.setUint16(78, startDate.getHours(), true);
    fv.setUint16(80, startDate.getMinutes(), true);
    fv.setUint16(82, startDate.getSeconds(), true);
    fv.setUint16(84, startDate.getMilliseconds(), true);
    // Last object timestamp (offset 88, 16 bytes SYSTEMTIME)
    if (messages.length > 0) {
      const endDate = new Date(messages[messages.length - 1].frame.timestamp);
      fv.setUint16(88, endDate.getFullYear(), true);
      fv.setUint16(90, endDate.getMonth() + 1, true);
      fv.setUint16(92, endDate.getDay(), true);
      fv.setUint16(94, endDate.getHours(), true);
      fv.setUint16(96, endDate.getMinutes(), true);
      fv.setUint16(98, endDate.getSeconds(), true);
      fv.setUint16(100, endDate.getMilliseconds(), true);
    }
    // Combine all buffers
    const blob = new Blob([fileHeader, ...objectBuffers], { type: 'application/octet-stream' });
    // Use recording API to write binary — or just download via blob URL
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `can_log_${Date.now()}.blf`; a.click();
    URL.revokeObjectURL(url);
  };

  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  const busLoadColor = busLoad > 80 ? '#ef4444' : busLoad > 50 ? '#facc15' : 'var(--color-text-secondary)';

  return (
    <div className="flex items-center gap-1.5 px-2 py-1 flex-shrink-0 flex-wrap"
      style={{ borderBottom: '1px solid var(--color-border)' }}
      onDragOver={(e) => e.preventDefault()} onDrop={handleDbcDrop}>
      {/* View mode toggle */}
      {(['trace', 'stats', 'j1939', 'uds'] as const).map((mode) => (
        <button key={mode} onClick={() => updateUI(sessionId, { viewMode: mode })}
          className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{
            backgroundColor: ui.viewMode === mode ? 'var(--color-accent)' : 'var(--color-input-bg)',
            color: ui.viewMode === mode ? 'white' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-input-border)',
          }}>
          {mode === 'trace' ? '📜 Trace' : mode === 'stats' ? '📊 Stats' : mode === 'j1939' ? '🚛 J1939' : '🔧 UDS'}
        </button>
      ))}
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
      {/* Filter */}
      <label className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>Filter ID:</label>
      <input value={ui.idFilter} onChange={(e) => updateUI(sessionId, { idFilter: e.target.value })}
        className="w-24 px-1.5 py-0.5 text-[11px] rounded" style={inputStyle} placeholder="1A0,2B0" />
      {/* Direction filter */}
      {(['all', 'tx', 'rx'] as const).map((f) => (
        <button key={f} onClick={() => updateUI(sessionId, { messageFilter: f })}
          className="px-1.5 py-0.5 text-[10px] rounded transition-colors"
          style={{
            backgroundColor: ui.messageFilter === f ? 'var(--color-accent)' : 'var(--color-input-bg)',
            color: ui.messageFilter === f ? 'white' : 'var(--color-text-secondary)',
            border: '1px solid var(--color-input-border)',
          }}>
          {f === 'all' ? 'All' : f === 'tx' ? '↑TX' : '↓RX'}
        </button>
      ))}
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
      {/* Auto scroll */}
      <button onClick={() => updateUI(sessionId, { autoScroll: !ui.autoScroll })}
        className="px-1.5 py-0.5 text-[10px] rounded"
        style={{
          backgroundColor: ui.autoScroll ? 'var(--color-accent)' : 'var(--color-input-bg)',
          color: ui.autoScroll ? 'white' : 'var(--color-text-secondary)',
          border: '1px solid var(--color-input-border)',
        }}>
        ⬇ Auto
      </button>
      {/* Clear */}
      <button onClick={() => clearMessages(sessionId)}
        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
        style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
        🗑 {t('common.clear')}
      </button>
      <span className="text-[10px]" style={{ color: 'var(--color-text-dim)' }}>|</span>
      {/* DBC */}
      <button onClick={handleDbcFileInput}
        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
        style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
        📂 {dbc ? t('can.changeDbc').replace('📂 ', '') : t('can.importDbc').replace('📂 ', '')}
      </button>
      {/* Recording */}
      <button onClick={handleRecordToggle}
        className="px-1.5 py-0.5 text-[10px] rounded"
        style={{
          backgroundColor: ui.recording ? '#ef4444' : 'var(--color-input-bg)',
          color: ui.recording ? 'white' : 'var(--color-text-secondary)',
          border: '1px solid var(--color-input-border)',
        }}>
        {ui.recording ? t('can.stopRecord') : t('can.recordAsc')}
      </button>
      {/* ASC Replay */}
      <button onClick={handleReplayAsc}
        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
        style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
        {t('can.replayAsc')}
      </button>
      {/* BLF Export */}
      <button onClick={handleExportBlf}
        className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
        style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
        {t('can.exportBlf')}
      </button>
      {/* Bus load */}
      <span className="text-[10px] ml-auto" style={{ color: busLoadColor, fontFamily: 'Consolas, monospace' }}>
        Bus: {busLoad.toFixed(1)}%
      </span>
    </div>
  );
}

// ─── Session Tabs ───
function SessionTabs() {
  const sessions = useCanDebugStore((s) => s.sessions);
  const activeSessionId = useCanDebugStore((s) => s.activeSessionId);
  const setActiveSession = useCanDebugStore((s) => s.setActiveSession);
  const removeSession = useCanDebugStore((s) => s.removeSession);

  if (sessions.length === 0) return null;

  return (
    <div className="flex items-center gap-0.5 px-2 py-0.5 overflow-x-auto flex-shrink-0"
      style={{ borderBottom: '1px solid var(--color-border)' }}>
      {sessions.map((s) => (
        <div key={s.id}
          className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded cursor-pointer"
          style={{
            backgroundColor: s.id === activeSessionId ? 'var(--color-hover-bg)' : 'transparent',
            color: s.status === 'connected' ? 'var(--color-text-primary)' : 'var(--color-text-dim)',
          }}
          onClick={() => setActiveSession(s.id)}>
          <span className="text-[8px]" style={{ color: s.status === 'connected' ? '#4ade80' : '#ef4444' }}>●</span>
          <span>{s.driverName} CH{s.channel}</span>
          <button onClick={(e) => { e.stopPropagation(); removeSession(s.id); }}
            className="text-[9px] hover:text-red-400 ml-1">✕</button>
        </div>
      ))}
    </div>
  );
}

// ─── Main Panel ───
export default function CanDebugPanel({ onClose }: { onClose: () => void }) {
  const t = useT();
  const activeSessionId = useCanDebugStore((s) => s.activeSessionId);
  const dbc = useCanDebugStore((s) => s.dbc);
  const loadDbc = useCanDebugStore((s) => s.loadDbc);
  const unloadDbc = useCanDebugStore((s) => s.unloadDbc);
  const addMonitorSignal = useCanDebugStore((s) => s.addMonitorSignal);
  const ui = useCanDebugStore((s) => activeSessionId ? s.sessionUI.get(activeSessionId) : undefined);
  const [sendEditorMsg, setSendEditorMsg] = useState<DbcMessage | null>(null);
  const [editingItemId, setEditingItemId] = useState<string | undefined>(undefined);

  const handleDbcFileInput = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.dbc';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) return;
      const text = await file.text();
      await loadDbc(text);
    };
    input.click();
  };

  const handleDbcDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file || !file.name.endsWith('.dbc')) return;
    const text = await file.text();
    await loadDbc(text);
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-bg)' }}
      onDragOver={(e) => e.preventDefault()} onDrop={handleDbcDrop}>
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-semibold" style={{ color: 'var(--color-text-primary)' }}>🚗 CAN Debug</span>
        <div className="flex items-center gap-1.5">
          <button onClick={handleDbcFileInput}
            className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)]"
            style={{ color: 'var(--color-text-secondary)', border: '1px solid var(--color-input-border)' }}>
            📂 {dbc ? t('can.changeDbc').replace('📂 ', '') : t('can.importDbc').replace('📂 ', '')}
          </button>
          {dbc && (
            <button onClick={unloadDbc}
              className="px-1.5 py-0.5 text-[10px] rounded hover:bg-[var(--color-hover-bg)] text-red-400"
              style={{ border: '1px solid var(--color-input-border)' }}>
              {t('can.unloadDbc')}
            </button>
          )}
          <button onClick={onClose} className="text-xs hover:text-red-400" style={{ color: 'var(--color-text-dim)' }}>✕</button>
        </div>
      </div>

      {/* Connection bar */}
      <ConnectionBar />

      {/* Session tabs */}
      <SessionTabs />

      {activeSessionId && ui ? (
        <>
          {/* Toolbar */}
          <Toolbar sessionId={activeSessionId} />

          {/* Main content: optional signal tree + message table or stats */}
          <div className="flex-1 flex min-h-0 overflow-hidden">
            {dbc && (
              <SignalTree
                onAddMonitor={(msg, sig) => addMonitorSignal(activeSessionId, msg.id, msg.extended, sig)}
                onSendMessage={(msg) => setSendEditorMsg(msg)}
              />
            )}
            <div className="flex-1 flex flex-col min-h-0">
              {ui.viewMode === 'stats' ? (
                <MessageStatsView sessionId={activeSessionId} />
              ) : ui.viewMode === 'j1939' ? (
                <J1939Table
                  sessionId={activeSessionId}
                  idFilter={ui.idFilter}
                  messageFilter={ui.messageFilter}
                />
              ) : ui.viewMode === 'uds' ? (
                <UdsPanel sessionId={activeSessionId} />
              ) : (
                <MessageTable
                  sessionId={activeSessionId}
                  idFilter={ui.idFilter}
                  messageFilter={ui.messageFilter}
                />
              )}
              <SignalPanel />
            </div>
          </div>

          {/* Send list */}
          <SendListPanel sessionId={activeSessionId} onEditDbcItem={(msg, itemId) => {
            setEditingItemId(itemId);
            setSendEditorMsg(msg);
          }} />

          {/* Send panel */}
          <SendPanel sessionId={activeSessionId} />
        </>
      ) : (
        <div className="flex-1 flex min-h-0 overflow-hidden">
          {dbc ? (
            <SignalTree
              onAddMonitor={(msg, sig) => activeSessionId && addMonitorSignal(activeSessionId, msg.id, msg.extended, sig)}
              onSendMessage={activeSessionId ? (msg) => setSendEditorMsg(msg) : undefined}
            />
          ) : null}
          <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--color-text-dim)' }}>
            <div className="text-center">
              <div className="text-3xl mb-2 opacity-30">🚗</div>
              <p className="text-xs">{t('can.emptyHint1')}</p>
              <p className="text-[10px] mt-1">{t('can.emptyHint2')}</p>
              <p className="text-[10px] mt-0.5">{t('can.emptyHint3')}</p>
            </div>
          </div>
        </div>
      )}

      {/* DBC Message Send Editor popup */}
      {sendEditorMsg && activeSessionId && (
        <DbcSendEditor msg={sendEditorMsg} sessionId={activeSessionId}
          sendListItemId={editingItemId}
          onClose={() => { setSendEditorMsg(null); setEditingItemId(undefined); }} />
      )}
    </div>
  );
}

