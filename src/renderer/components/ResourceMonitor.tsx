import React, { useEffect, useState } from 'react';
import type { RemoteResources } from '../../shared/types';
import { useAppStore } from '../store/app-store';
import { useI18nStore } from '../i18n';

function bytes(value: number): string {
  const unit = value >= 1024 ** 3 ? 1024 ** 3 : 1024 ** 2;
  return `${(value / unit).toFixed(1)} ${unit === 1024 ** 3 ? 'GiB' : 'MiB'}`;
}

function Meter({ label, percent, detail }: { label: string; percent: number | null; detail?: string }) {
  return <div className="resource-metric">
    <div className="resource-metric-label"><span>{label}</span><strong>{percent === null ? '—' : `${percent.toFixed(1)}%`}</strong></div>
    <div className="resource-track"><span style={{ width: `${percent ?? 0}%`, background: percent !== null && percent >= 90 ? '#c15f4a' : undefined }} /></div>
    {detail && <small>{detail}</small>}
  </div>;
}

function ConnectedResources({ sessionId, hostName }: { sessionId: string; hostName: string }) {
  const zh = useI18nStore(s => s.locale === 'zh');
  const [data, setData] = useState<RemoteResources | null>(null);
  const [error, setError] = useState(false);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (paused) return;
    let stopped = false;
    let busy = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      if (stopped || busy || document.hidden) return;
      busy = true;
      let delay = 5000;
      try {
        const getResources = window.api?.ssh?.getResources;
        if (typeof getResources !== 'function') throw new Error('Resource monitoring is unavailable until the app is restarted');
        const sample = await getResources(sessionId);
        if (!stopped) { setData(sample); setError(false); }
      } catch {
        delay = 30000;
        if (!stopped) { setData(null); setError(true); }
      } finally {
        busy = false;
        if (!stopped && !document.hidden) timer = setTimeout(poll, delay);
      }
    };
    const visibility = () => { clearTimeout(timer); if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', visibility);
    void poll();
    return () => { stopped = true; clearTimeout(timer); document.removeEventListener('visibilitychange', visibility); };
  }, [sessionId, paused]);

  const rootDisk = data?.disks.find(disk => disk.mount === '/');
  const status = paused ? (zh ? '已暂停' : 'Paused') : error ? (zh ? '暂不可用 · 30 秒后重试' : 'Unavailable · retry in 30s') : data ? (zh ? '每 5 秒刷新' : 'Refreshes every 5s') : (zh ? '正在采集…' : 'Sampling…');
  return <section className="resource-monitor resource-sidebar" aria-label={zh ? '远端资源监控' : 'Remote resources'}>
    <details>
      <summary className="resource-summary">
        <div className="resource-host"><span className="resource-eyebrow">{zh ? '远端资源' : 'REMOTE RESOURCES'}</span><strong title={hostName}>{hostName}</strong><small>{status}</small></div>
        <Meter label="CPU" percent={data?.cpuPercent ?? null} detail={data && data.cpuPercent === null ? (zh ? '等待下一次采样' : 'Awaiting next sample') : (zh ? '总使用率' : 'Total utilization')} />
        <Meter label={zh ? '内存' : 'Memory'} percent={data ? data.memory.used / data.memory.total * 100 : null} detail={data ? `${bytes(data.memory.used)} / ${bytes(data.memory.total)}` : '—'} />
        <Meter label={zh ? '磁盘 /' : 'Disk /'} percent={rootDisk?.percent ?? null} detail={rootDisk ? `${bytes(rootDisk.used)} / ${bytes(rootDisk.total)}` : '—'} />
        <span className="resource-expand" title={zh ? '展开详情' : 'Show details'}>⌄</span>
      </summary>
      <div className="resource-details">
        <div className="resource-detail-heading"><span>{zh ? '系统负载（1 / 5 / 15 分钟）' : 'System load (1 / 5 / 15 min)'}: {data?.loadAverage.length ? data.loadAverage.map(n => n.toFixed(2)).join(' / ') : '—'}</span><button onClick={() => setPaused(value => !value)}>{paused ? (zh ? '继续刷新' : 'Resume') : (zh ? '暂停刷新' : 'Pause')}</button></div>
        {error && <p role="status">{zh ? '无法读取资源信息。需要 Linux /proc 和 df，并允许 SSH 执行命令；终端仍可正常使用。' : 'Cannot read resources. Requires Linux /proc, df and SSH exec access; the terminal remains available.'}</p>}
        {data && <><p>{zh ? '内存占用不包含可回收缓存；磁盘按挂载点显示，不累加重复挂载。' : 'Memory excludes reclaimable cache. Disks are shown by mount point, without summing duplicate mounts.'}</p>
          <div className="resource-disk-scroll"><table><thead><tr><th>{zh ? '挂载点 / 文件系统' : 'Mount / Filesystem'}</th><th>{zh ? '已用 / 总量' : 'Used / Total'}</th><th>{zh ? '可用' : 'Available'}</th><th>{zh ? '占用' : 'Usage'}</th></tr></thead>
            <tbody>{data.disks.map((disk, index) => <tr key={`${disk.mount}-${index}`}><td><strong>{disk.mount}</strong><small>{disk.filesystem}</small></td><td>{bytes(disk.used)} / {bytes(disk.total)}</td><td>{bytes(disk.available)}</td><td>{disk.percent}%</td></tr>)}</tbody></table></div>
          {!data.disks.length && <p>{zh ? '没有可读取的磁盘信息。' : 'No disk information available.'}</p>}
          <p>{zh ? '采样时间' : 'Sampled at'}: {new Date(data.sampledAt).toLocaleTimeString()}</p>
        </>}
      </div>
    </details>
  </section>;
}

export default function ResourceMonitor({ sessionId: requestedSessionId }: { sessionId?: string } = {}) {
  const activeSessionId = useAppStore(s => s.activeSessionId);
  const sessionId = requestedSessionId ?? activeSessionId;
  const session = useAppStore(s => s.sessions.find(item => item.id === sessionId));
  const host = useAppStore(s => s.hosts.find(item => item.id === session?.hostEntryId));
  if (session?.status !== 'connected') return null;
  return <ConnectedResources key={`${sessionId}-${session.connectedAt}`} sessionId={sessionId!} hostName={host?.name ?? host?.hostname ?? 'SSH'} />;
}
