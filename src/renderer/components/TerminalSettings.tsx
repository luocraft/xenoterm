import React, { useState } from 'react';

interface TerminalSettingsProps {
  onClose: () => void;
}

const FONT_OPTIONS = [
  "'JetBrains Mono', monospace",
  "'Cascadia Code', monospace",
  "'Fira Code', monospace",
  "'Source Code Pro', monospace",
  "monospace"
];

const FONT_SIZE_OPTIONS = [10, 11, 12, 13, 14, 15, 16, 18, 20];

const COLOR_SCHEMES = [
  { name: 'Default (Indigo)', value: 'default' },
  { name: 'Monokai', value: 'monokai' },
  { name: 'Dracula', value: 'dracula' },
  { name: 'Solarized Dark', value: 'solarized' }
];

export default function TerminalSettings({ onClose }: TerminalSettingsProps) {
  const [fontFamily, setFontFamily] = useState(FONT_OPTIONS[0]);
  const [fontSize, setFontSize] = useState(14);
  const [colorScheme, setColorScheme] = useState('default');

  const handleSave = async () => {
    try {
      await window.api.config.setAppConfig({
        terminal: { fontFamily, fontSize, colorScheme }
      });
      onClose();
    } catch (err) {
      console.error('Failed to save terminal settings:', err);
    }
  };

  const inputClass =
    'w-full px-2.5 py-1.5 text-xs rounded-lg outline-none focus:border-[var(--color-accent)] transition-colors';

  const inputStyle = {
    backgroundColor: 'var(--color-input-bg)',
    border: '1px solid var(--color-input-border)',
    color: 'var(--color-text-primary)',
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }} onClick={onClose}>
      <div
        className="bg-[var(--color-sidebar)] rounded-xl shadow-2xl w-[360px]"
        style={{ border: '1px solid var(--color-input-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>Terminal Settings</h2>
          <button onClick={onClose} className="text-lg" style={{ color: 'var(--color-text-muted)' }}>×</button>
        </div>

        <div className="p-4 space-y-4">
          {/* Font family */}
          <div>
            <label className="block text-[10px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Font</label>
            <select className={inputClass} style={inputStyle} value={fontFamily} onChange={(e) => setFontFamily(e.target.value)}>
              {FONT_OPTIONS.map((f) => (
                <option key={f} value={f}>{f.split("'")[1] || f}</option>
              ))}
            </select>
          </div>

          {/* Font size */}
          <div>
            <label className="block text-[10px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Size</label>
            <div className="flex gap-1 flex-wrap">
              {FONT_SIZE_OPTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => setFontSize(s)}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                    fontSize === s
                      ? 'bg-[var(--color-accent)] text-white'
                      : ''
                  }`}
                  style={fontSize !== s ? { backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' } : undefined}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>

          {/* Color scheme */}
          <div>
            <label className="block text-[10px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>Color Scheme</label>
            <select className={inputClass} style={inputStyle} value={colorScheme} onChange={(e) => setColorScheme(e.target.value)}>
              {COLOR_SCHEMES.map((c) => (
                <option key={c.value} value={c.value}>{c.name}</option>
              ))}
            </select>
          </div>

          {/* Preview */}
          <div
            className="rounded-lg p-3 text-xs"
            style={{ fontFamily, fontSize: `${fontSize}px`, background: '#0d0e1c', border: '1px solid var(--color-border)' }}
          >
            <span style={{ color: '#4ade80' }}>user@server</span>
            <span style={{ color: '#e4e4e7' }}>:</span>
            <span style={{ color: '#60a5fa' }}>~</span>
            <span style={{ color: '#e4e4e7' }}>$ ls -la</span>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-1">
            <button onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}>
              Cancel
            </button>
            <button onClick={handleSave}
              className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity">
              Save
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
