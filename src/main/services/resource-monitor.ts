import type { Client, ClientChannel } from 'ssh2';
import { StringDecoder } from 'string_decoder';
import type { RemoteResources } from '../../shared/types';

// A separate exec channel never writes into the user's interactive shell.
export const RESOURCE_COMMAND = `export LC_ALL=C
test -r /proc/stat && test -r /proc/meminfo || exit 64
printf '\\n__XT_CPU__\\n'; cat /proc/stat
printf '\\n__XT_MEMORY__\\n'; cat /proc/meminfo
printf '\\n__XT_LOAD__\\n'; cat /proc/loadavg
printf '\\n__XT_DISKS__\\n'; df -Pk 2>/dev/null
printf '\\n__XT_END__\\n'`;

interface CpuSample { total: number; idle: number }
const clamp = (value: number, max: number) => Math.max(0, Math.min(max, value));

export function parseResources(output: string, previous?: CpuSample): { resources: RemoteResources; cpu: CpuSample } {
  const section = (name: string, next: string) => output.split(`__XT_${name}__\n`)[1]?.split(`__XT_${next}__`)[0] ?? '';
  const cpuValues = section('CPU', 'MEMORY').match(/^cpu\s+(.+)$/m)?.[1].trim().split(/\s+/).slice(0, 8).map(Number);
  const mem = new Map<string, number>();
  for (const match of section('MEMORY', 'LOAD').matchAll(/^(\w+):\s+(\d+)\s+kB/gm)) mem.set(match[1], Number(match[2]) * 1024);
  const total = mem.get('MemTotal') ?? 0;
  if (!output.includes('__XT_END__') || !cpuValues || cpuValues.length < 4 || cpuValues.some(v => !Number.isFinite(v) || v < 0) || total <= 0) {
    throw new Error('Resource monitoring requires Linux /proc data');
  }
  const cpu = { total: cpuValues.reduce((a, b) => a + b, 0), idle: cpuValues[3] + (cpuValues[4] ?? 0) };
  const delta = previous ? cpu.total - previous.total : 0;
  const idleDelta = previous ? cpu.idle - previous.idle : 0;
  const available = clamp(mem.get('MemAvailable') ??
    ((mem.get('MemFree') ?? 0) + (mem.get('Buffers') ?? 0) + (mem.get('Cached') ?? 0) + (mem.get('SReclaimable') ?? 0) - (mem.get('Shmem') ?? 0)), total);
  const disks: RemoteResources['disks'] = [];
  for (const line of section('DISKS', 'END').split('\n')) {
    const match = line.match(/^(.*?)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)%\s+(.+)$/);
    if (!match || Number(match[2]) === 0 || /^(tmpfs|devtmpfs|udev)$/.test(match[1])) continue;
    disks.push({ filesystem: match[1], total: Number(match[2]) * 1024, used: Number(match[3]) * 1024,
      available: Number(match[4]) * 1024, percent: clamp(Number(match[5]), 100), mount: match[6].trim() });
  }
  return { cpu, resources: {
    sampledAt: Date.now(),
    cpuPercent: delta > 0 && idleDelta >= 0 ? clamp(100 * (1 - idleDelta / delta), 100) : null,
    loadAverage: section('LOAD', 'DISKS').trim().split(/\s+/).slice(0, 3).filter(Boolean).map(Number).filter(Number.isFinite),
    memory: { total, available, used: total - available }, disks
  } };
}

export class ResourceMonitor {
  private previous = new WeakMap<Client, CpuSample>();
  private pending = new WeakMap<Client, Promise<RemoteResources>>();

  read(client: Client): Promise<RemoteResources> {
    const pending = this.pending.get(client);
    if (pending) return pending;
    const request = this.execute(client).then(output => {
      const { resources, cpu } = parseResources(output, this.previous.get(client));
      this.previous.set(client, cpu);
      return resources;
    }).finally(() => this.pending.delete(client));
    this.pending.set(client, request);
    return request;
  }

  private execute(client: Client): Promise<string> {
    return new Promise((resolve, reject) => {
      let channel: ClientChannel | undefined;
      let done = false;
      let output = '';
      let bytes = 0;
      const decoder = new StringDecoder('utf8');
      const finish = (error?: Error) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        client.removeListener('close', disconnected);
        if (error) { channel?.close(); reject(error); } else resolve(output + decoder.end());
      };
      const disconnected = () => finish(new Error('SSH connection closed'));
      const timer = setTimeout(() => finish(new Error('Resource sampling timed out')), 8000);
      client.once('close', disconnected);
      try {
        client.exec(RESOURCE_COMMAND, (error, stream) => {
          if (done) { if (stream) { stream.on('error', () => {}); stream.close(); } return; }
          if (error) { finish(error); return; }
          channel = stream;
          stream.on('error', finish);
          stream.on('data', (chunk: Buffer) => {
            if (done) return;
            bytes += chunk.length;
            if (bytes > 1024 * 1024) { finish(new Error('Resource output exceeds limit')); return; }
            output += decoder.write(chunk);
          });
          stream.stderr.on('data', () => {});
          stream.on('close', (code: number | null) => finish(code === 0 ? undefined : new Error('Resource command unavailable; Linux is required')));
        });
      } catch (error) { finish(error instanceof Error ? error : new Error(String(error))); }
    });
  }
}
