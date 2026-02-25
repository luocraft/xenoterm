import React, { useState, useEffect } from 'react';
import { useAppStore } from '../store/app-store';
import { useT } from '../i18n';
import type { HostEntry } from '../../shared/types';

interface ConnectionFormProps {
  editHost?: HostEntry | null;
  onClose: () => void;
}

interface FormData {
  name: string;
  hostname: string;
  port: string;
  username: string;
  authMethod: 'password' | 'publicKey';
  password: string;
  privateKeyPath: string;
  passphrase: string;
  group: string;
  jumpHost: string;
  keepAliveInterval: string;
}

interface FormErrors {
  [key: string]: string;
}

const defaultForm: FormData = {
  name: '',
  hostname: '',
  port: '22',
  username: '',
  authMethod: 'password',
  password: '',
  privateKeyPath: '',
  passphrase: '',
  group: '',
  jumpHost: '',
  keepAliveInterval: '60'
};

function validate(form: FormData, t: (key: any) => string): FormErrors {
  const errors: FormErrors = {};
  if (!form.name.trim()) errors.name = t('connForm.err.name');
  if (!form.hostname.trim()) errors.hostname = t('connForm.err.hostname');
  const port = parseInt(form.port, 10);
  if (isNaN(port) || port < 1 || port > 65535) errors.port = t('connForm.err.port');
  if (!form.username.trim()) errors.username = t('connForm.err.username');
  if (form.authMethod === 'publicKey' && !form.privateKeyPath.trim()) {
    errors.privateKeyPath = t('connForm.err.keyPath');
  }
  const ka = parseInt(form.keepAliveInterval, 10);
  if (form.keepAliveInterval && (isNaN(ka) || ka < 1)) {
    errors.keepAliveInterval = t('connForm.err.keepAlive');
  }
  return errors;
}

export default function ConnectionForm({ editHost, onClose }: ConnectionFormProps) {
  const t = useT();
  const addHost = useAppStore((s) => s.addHost);
  const updateHost = useAppStore((s) => s.updateHost);
  const groups = useAppStore((s) => s.groups);
  const hosts = useAppStore((s) => s.hosts);

  const [form, setForm] = useState<FormData>(defaultForm);
  const [errors, setErrors] = useState<FormErrors>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (editHost) {
      setForm({
        name: editHost.name,
        hostname: editHost.hostname,
        port: String(editHost.port),
        username: editHost.username,
        authMethod: editHost.authMethod,
        password: editHost.password || '',
        privateKeyPath: editHost.privateKeyPath || '',
        passphrase: editHost.passphrase || '',
        group: editHost.group || '',
        jumpHost: editHost.jumpHost || '',
        keepAliveInterval: String(editHost.keepAliveInterval || 60)
      });
    }
  }, [editHost]);

  const set = (field: keyof FormData, value: string) => {
    setForm((prev) => ({ ...prev, [field]: value }));
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errs = validate(form, t);
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      return;
    }

    setSaving(true);
    try {
      const data = {
        name: form.name.trim(),
        hostname: form.hostname.trim(),
        port: parseInt(form.port, 10),
        username: form.username.trim(),
        authMethod: form.authMethod,
        password: form.authMethod === 'password' && form.password ? form.password : undefined,
        privateKeyPath: form.privateKeyPath.trim() || undefined,
        passphrase: form.passphrase || undefined,
        group: form.group || undefined,
        jumpHost: form.jumpHost || undefined,
        keepAliveInterval: parseInt(form.keepAliveInterval, 10) || 60
      };

      if (editHost) {
        await updateHost(editHost.id, data);
      } else {
        await addHost(data);
      }
      onClose();
    } catch (err) {
      console.error('Save failed:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectKey = async () => {
    const path = await window.api.dialog.selectFile();
    if (path) set('privateKeyPath', path);
  };

  const inputClass = (field: string) =>
    `w-full px-2.5 py-1.5 text-xs rounded-lg transition-colors outline-none
     focus:border-[var(--color-accent)] ${
       errors[field] ? 'border-red-500/50' : ''
     }`;

  const inputStyle = (field: string) => ({
    backgroundColor: 'var(--color-input-bg)',
    border: `1px solid ${errors[field] ? 'rgba(239,68,68,0.5)' : 'var(--color-input-border)'}`,
    color: 'var(--color-text-primary)',
  });

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ backgroundColor: 'var(--color-overlay)' }} onClick={onClose}>
      <div
        className="bg-[var(--color-sidebar)] rounded-xl shadow-2xl w-[420px] max-h-[85vh] overflow-y-auto"
        style={{ border: '1px solid var(--color-input-border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 flex justify-between items-center" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <h2 className="text-sm font-semibold" style={{ color: 'var(--color-text-primary)' }}>
            {editHost ? t('connForm.title.edit') : t('connForm.title.new')}
          </h2>
          <button onClick={onClose} className="text-lg" style={{ color: 'var(--color-text-muted)' }}>×</button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-3">

          <Field label={t('connForm.name')} error={errors.name}>
            <input className={inputClass('name')} style={inputStyle('name')} value={form.name}
              onChange={(e) => set('name', e.target.value)} />
          </Field>

          <div className="grid grid-cols-3 gap-2">
            <Field label={t('connForm.hostname')} error={errors.hostname} className="col-span-2">
              <input className={inputClass('hostname')} style={inputStyle('hostname')} value={form.hostname}
                onChange={(e) => set('hostname', e.target.value)} />
            </Field>
            <Field label={t('connForm.port')} error={errors.port}>
              <input className={inputClass('port')} style={inputStyle('port')} value={form.port}
                onChange={(e) => set('port', e.target.value)} />
            </Field>
          </div>

          <Field label={t('connForm.username')} error={errors.username}>
            <input className={inputClass('username')} style={inputStyle('username')} value={form.username}
              onChange={(e) => set('username', e.target.value)} />
          </Field>

          <Field label={t('connForm.authMethod')}>
            <select
              className={inputClass('authMethod')}
              style={inputStyle('authMethod')}
              value={form.authMethod}
              onChange={(e) => set('authMethod', e.target.value)}
            >
              <option value="password">{t('connForm.password')}</option>
              <option value="publicKey">{t('connForm.publicKey')}</option>
            </select>
          </Field>

          {form.authMethod === 'password' && (
            <Field label={t('connForm.password')}>
              <input type="password" className={inputClass('password')} style={inputStyle('password')} value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={t('dialog.password.placeholder')} />
            </Field>
          )}

          {form.authMethod === 'publicKey' && (
            <>
              <Field label={t('connForm.privateKey')} error={errors.privateKeyPath}>
                <div className="flex gap-1">
                  <input className={`${inputClass('privateKeyPath')} flex-1`} style={inputStyle('privateKeyPath')} value={form.privateKeyPath}
                    onChange={(e) => set('privateKeyPath', e.target.value)} readOnly />
                  <button type="button" onClick={handleSelectKey}
                    className="px-2 py-1 text-xs rounded-lg transition-colors"
                    style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}>
                    {t('common.browse')}
                  </button>
                </div>
              </Field>
              <Field label={t('connForm.passphrase')}>
                <input type="password" className={inputClass('passphrase')} style={inputStyle('passphrase')} value={form.passphrase}
                  onChange={(e) => set('passphrase', e.target.value)} />
              </Field>
            </>
          )}

          {groups.length > 0 && (
            <Field label={t('connForm.group')}>
              <select className={inputClass('group')} style={inputStyle('group')} value={form.group}
                onChange={(e) => set('group', e.target.value)}>
                <option value="">{t('connForm.none')}</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </Field>
          )}

          <Field label={t('connForm.jumpHost')}>
            <select className={inputClass('jumpHost')} style={inputStyle('jumpHost')} value={form.jumpHost}
              onChange={(e) => set('jumpHost', e.target.value)}>
              <option value="">{t('connForm.none')}</option>
              {hosts.filter((h) => h.id !== editHost?.id).map((h) => (
                <option key={h.id} value={h.id}>{h.name}</option>
              ))}
            </select>
          </Field>

          <Field label={t('connForm.keepAlive')} error={errors.keepAliveInterval}>
            <input className={inputClass('keepAliveInterval')} style={inputStyle('keepAliveInterval')} value={form.keepAliveInterval}
              onChange={(e) => set('keepAliveInterval', e.target.value)} />
          </Field>

          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose}
              className="px-3 py-1.5 text-xs rounded-lg transition-colors"
              style={{ backgroundColor: 'var(--color-input-bg)', color: 'var(--color-text-secondary)' }}>
              {t('common.cancel')}
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-1.5 text-xs rounded-lg bg-[var(--color-accent)] text-white hover:opacity-90 transition-opacity disabled:opacity-50">
              {saving ? t('connForm.saving') : editHost ? t('connForm.update') : t('connForm.create')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, error, className, children }: {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="block text-[10px] mb-1 uppercase tracking-wider" style={{ color: 'var(--color-text-muted)' }}>{label}</label>
      {children}
      {error && <p className="text-[10px] text-red-400 mt-0.5">{error}</p>}
    </div>
  );
}
