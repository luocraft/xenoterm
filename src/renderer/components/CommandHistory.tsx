import React, { useState, useMemo } from 'react';
import { useAppStore } from '../store/app-store';

interface CommandHistoryProps {
  onClose: () => void;
}

export default function CommandHistory({ onClose }: CommandHistoryProps) {
  const activeSessionId = useAppStore((s) => s.activeSessionId);
  const commandHistory = useAppStore((s) => s.commandHistory);

  const [filter, setFilter] = useState('');
  const [selectedHost, setSelectedHost] = useState<string>('all');

  // Get unique host names from history
  const hostNames = useMemo(() => {
    const names = new Set<string>();
    for (const entry of commandHistory) {
      if (entry.hostName) names.add(entry.hostName);
    }
    return Array.from(names);
  }, [commandHistory]);

  // Filter and sort commands (newest first)
  const commands = useMemo(() => {
    let result = [...commandHistory];

    if (selectedHost !== 'all') {
      result = result.filter((c) => c.hostName === selectedHost);
    }

    if (filter) {
      const lower = filter.toLowerCase();
      result = result.filter((c) => c.cmd.toLowerCase().includes(lower));
    }

    result.sort((a, b) => b.ts - a.ts);
    return result;
  }, [commandHistory, selectedHost, filter]);

  const handleSendCommand = (cmd: string) => {
    if (!activeSessionId) return;
    window.api.ssh.write(activeSessionId, cmd + '\r');
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <div className="h-full flex flex-col" style={{ backgroundColor: 'var(--color-surface)' }}>
      {/* Header */}
      <div className="px-3 py-2 flex items-center justify-between flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <span className="text-xs font-medium" style={{ color: 'var(--color-text-primary)' }}>Command History</span>
        <button onClick={onClose} className="text-sm" style={{ color: 'var(--color-text-muted)' }}>×</button>
      </div>

      {/* Filter & host selector */}
      <div className="px-2 py-1.5 flex gap-1.5 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Search commands..."
          className="flex-1 px-2 py-1 text-xs rounded outline-none focus:border-[var(--color-accent)] transition-colors"
          style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
        />
        {hostNames.length > 1 && (
          <select
            value={selectedHost}
            onChange={(e) => setSelectedHost(e.target.value)}
            className="px-1.5 py-1 text-xs rounded outline-none"
            style={{ backgroundColor: 'var(--color-input-bg)', border: '1px solid var(--color-input-border)', color: 'var(--color-text-primary)' }}
          >
            <option value="all">All hosts</option>
            {hostNames.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        )}
      </div>

      {/* Command list */}
      <div className="flex-1 overflow-y-auto">
        {commands.length === 0 ? (
          <div className="flex items-center justify-center h-20 text-xs" style={{ color: 'var(--color-text-dim)' }}>
            {commandHistory.length === 0 ? 'No commands yet' : 'No matching commands'}
          </div>
        ) : (
          commands.map((entry, i) => (
            <div
              key={`${entry.ts}-${i}`}
              onClick={() => handleSendCommand(entry.cmd)}
              className="px-3 py-1.5 cursor-pointer transition-colors group flex items-center gap-2"
              style={{ borderBottom: '1px solid var(--color-border)' }}
              onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-hover-bg)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
              title="Click to send to active terminal"
            >
              <span className="text-[10px] opacity-50" style={{ color: 'var(--color-text-dim)' }}>$</span>
              <span className="text-xs font-mono truncate flex-1" style={{ color: 'var(--color-text-primary)' }}>{entry.cmd}</span>
              <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--color-text-dim)' }}>
                {selectedHost === 'all' && hostNames.length > 1 && entry.hostName
                  ? `${entry.hostName} · ${formatTime(entry.ts)}`
                  : formatTime(entry.ts)
                }
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
