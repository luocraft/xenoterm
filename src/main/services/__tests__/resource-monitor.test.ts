import { EventEmitter } from 'events';
import type { Client } from 'ssh2';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parseResources, ResourceMonitor } from '../resource-monitor';

function sample(cpu = '100 0 50 850 0 0 0 0 20 0', memory = 'MemTotal: 1000 kB\nMemAvailable: 400 kB') {
  return `__XT_CPU__\ncpu ${cpu}\n__XT_MEMORY__\n${memory}\n__XT_LOAD__\n0.5 0.2 0.1 1/100 42\n__XT_DISKS__\nFilesystem 1024-blocks Used Available Capacity Mounted on\n/dev/root 10000 4000 5000 45% /\n/dev/sdb 20000 10000 10000 50% /media/my disk\ntmpfs 1000 10 990 1% /run\n__XT_END__\n`;
}
function mockClient() {
  const channel = Object.assign(new EventEmitter(), { stderr: new EventEmitter(), close: vi.fn() });
  const client = Object.assign(new EventEmitter(), { exec: vi.fn((_command, cb) => cb(null, channel)) });
  return { channel, client: client as unknown as Client, exec: client.exec };
}
afterEach(() => { vi.useRealTimers(); });
describe('Linux resource sampling', () => {
  it('uses CPU deltas without double-counting guest time and excludes reclaimable memory', () => {
    const first = parseResources(sample());
    expect(first.resources.cpuPercent).toBeNull();
    expect(first.cpu.total).toBe(1000);
    expect(parseResources(sample('120 0 60 920 0 0 0 0 40 0'), first.cpu).resources.cpuPercent).toBeCloseTo(30);
    expect(first.resources.memory).toEqual({ total: 1024000, used: 614400, available: 409600 });
    expect(first.resources.disks).toHaveLength(2);
    expect(first.resources.disks[1].mount).toBe('/media/my disk');
    expect(first.resources.disks[0].percent).toBe(45);
    expect(first.resources.loadAverage).toEqual([0.5, 0.2, 0.1]);
  });
  it('handles older kernels and counter resets without showing invented CPU usage', () => {
    const parsed = parseResources(sample(undefined, 'MemTotal: 1000 kB\nMemFree: 100 kB\nBuffers: 20 kB\nCached: 200 kB\nSReclaimable: 50 kB\nShmem: 10 kB'), { total: 5000, idle: 4000 });
    expect(parsed.resources.memory.available).toBe(360 * 1024);
    expect(parsed.resources.cpuPercent).toBeNull();
    expect(() => parseResources('not Linux')).toThrow();
    expect(() => parseResources(sample().replace('__XT_END__', ''))).toThrow();
  });
  it('shares concurrent requests and removes connection listeners', async () => {
    const { client, channel, exec } = mockClient();
    const monitor = new ResourceMonitor();
    const first = monitor.read(client);
    expect(monitor.read(client)).toBe(first);
    channel.emit('data', Buffer.from(sample())); channel.emit('close', 0);
    expect((await first).cpuPercent).toBeNull();
    expect(exec).toHaveBeenCalledTimes(1);
    expect(client.listenerCount('close')).toBe(0);
  });
  it('closes timed-out channels and permits retry', async () => {
    vi.useFakeTimers();
    const { client, channel, exec } = mockClient();
    const monitor = new ResourceMonitor();
    const failed = expect(monitor.read(client)).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(8000); await failed;
    expect(channel.close).toHaveBeenCalledOnce();
    const retry = monitor.read(client);
    channel.emit('data', Buffer.from(sample())); channel.emit('close', 0);
    await retry;
    expect(exec).toHaveBeenCalledTimes(2);
  });
  it('bounds output and cancels on disconnect', async () => {
    const { client, channel } = mockClient();
    const monitor = new ResourceMonitor();
    const oversized = expect(monitor.read(client)).rejects.toThrow('limit');
    channel.emit('data', Buffer.alloc(1024 * 1024 + 1)); await oversized;
    const disconnected = expect(monitor.read(client)).rejects.toThrow('closed');
    client.emit('close'); await disconnected;
    expect(client.listenerCount('close')).toBe(0);
  });
});
