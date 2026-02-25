import React from 'react';
import { useT } from '../i18n';
export type ConflictAction = 'overwrite' | 'rename' | 'skip';

interface ConflictDialogProps {
  filename: string;
  onResolve: (action: ConflictAction) => void;
}

export default function ConflictDialog({ filename, onResolve }: ConflictDialogProps) {
  const t = useT();
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }}>
      <div className="bg-[var(--color-sidebar)] rounded-xl shadow-2xl w-[340px] p-4" style={{ border: '1px solid var(--color-input-border)' }}>
        <h3 className="text-sm font-semibold mb-2" style={{ color: 'var(--color-text-primary)' }}>{t('conflict.title')}</h3>
        <p className="text-xs mb-4" style={{ color: 'var(--color-text-secondary)' }}>
          {t('conflict.msg', { filename })}
        </p>
        <div className="flex flex-col gap-1.5">
          <button
            onClick={() => onResolve('overwrite')}
            className="w-full px-3 py-2 text-xs rounded-lg bg-red-500/20 text-red-300 hover:bg-red-500/30 transition-colors text-left"
          >
            {t('conflict.overwrite')}
          </button>
          <button
            onClick={() => onResolve('rename')}
            className="w-full px-3 py-2 text-xs rounded-lg bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 transition-colors text-left"
          >
            {t('conflict.rename')}
          </button>
          <button
            onClick={() => onResolve('skip')}
            className="w-full px-3 py-2 text-xs rounded-lg transition-colors text-left"
            style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}
          >
            {t('conflict.skip')}
          </button>
        </div>
      </div>
    </div>
  );
}
