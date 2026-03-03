import { Client, type ConnectConfig, type ClientChannel } from 'ssh2';
import { randomUUID } from 'crypto';
import { readFileSync } from 'fs';
import type { HostEntry, SSHSession, SessionStatus } from '../../shared/types';

interface SessionEntry {
  session: SSHSession;
  client: Client;
  stream: ClientChannel | null;
  jumpClient: Client | null;
  /** Password stored in memory for reconnect (never persisted to disk) */
  password?: string;
  dataCallbacks: Array<(data: string) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  keepAliveTimer: ReturnType<typeof setInterval> | null;
}

export class SSHService {
  private sessions: Map<string, SessionEntry> = new Map();
  private hostResolver?: (id: string) => HostEntry | undefined;

  setHostResolver(resolver: (id: string) => HostEntry | undefined): void {
    this.hostResolver = resolver;
  }

  async connect(hostEntry: HostEntry, password?: string): Promise<SSHSession> {
    const sessionId = randomUUID();
    const session: SSHSession = {
      id: sessionId,
      hostEntryId: hostEntry.id,
      status: 'connecting'
    };

    const entry: SessionEntry = {
      session,
      client: new Client(),
      stream: null,
      jumpClient: null,
      password,
      dataCallbacks: [],
      closeCallbacks: [],
      errorCallbacks: [],
      keepAliveTimer: null
    };

    this.sessions.set(sessionId, entry);

    try {
      await this._establishConnection(entry, hostEntry, password);
      return entry.session;
    } catch (err) {
      // Clean up failed session from map
      this.sessions.delete(sessionId);
      entry.client.end();
      if (entry.jumpClient) entry.jumpClient.end();
      entry.session.status = 'error';
      entry.session.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  private async _establishConnection(
    entry: SessionEntry,
    hostEntry: HostEntry,
    password?: string
  ): Promise<void> {
    // Handle jump host
    if (hostEntry.jumpHost && this.hostResolver) {
      const jumpHostEntry = this.hostResolver(hostEntry.jumpHost);
      if (jumpHostEntry) {
        entry.jumpClient = new Client();
        await this._connectViaJumpHost(entry, jumpHostEntry, hostEntry, password);
        return;
      }
    }

    const config = this._buildConnectConfig(hostEntry, password);
    await this._connectClient(entry, config);
  }

  private _buildConnectConfig(hostEntry: HostEntry, password?: string): ConnectConfig {
    const config: ConnectConfig = {
      host: hostEntry.hostname,
      port: hostEntry.port,
      username: hostEntry.username,
      readyTimeout: 2000,
      keepaliveInterval: (hostEntry.keepAliveInterval || 60) * 1000,
      keepaliveCountMax: 3
    };

    if (hostEntry.authMethod === 'password') {
      config.password = password;
    } else if (hostEntry.authMethod === 'publicKey' && hostEntry.privateKeyPath) {
      try {
        config.privateKey = readFileSync(hostEntry.privateKeyPath);
        if (hostEntry.passphrase) {
          config.passphrase = hostEntry.passphrase;
        }
      } catch (err) {
        throw new Error(`Failed to read private key: ${hostEntry.privateKeyPath}`);
      }
    }

    return config;
  }

  private _connectClient(entry: SessionEntry, config: ConnectConfig): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = entry.client; // capture reference to detect stale close events
      const timeout = setTimeout(() => {
        entry.client.end();
        reject(new Error('Connection timeout: exceeded 2 seconds'));
      }, 2000);

      client
        .on('ready', () => {
          clearTimeout(timeout);
          entry.session.status = 'connected';
          entry.session.connectedAt = new Date().toISOString();
          this._setupKeepAlive(entry);
          resolve();
        })
        .on('error', (err) => {
          clearTimeout(timeout);
          // Ignore events from a replaced client (after reconnect)
          if (entry.client !== client) return;
          entry.session.status = 'error';
          entry.session.error = this._formatError(err);
          entry.errorCallbacks.forEach((cb) => cb(entry.session.error!));
          reject(new Error(entry.session.error));
        })
        .on('close', () => {
          // Ignore events from a replaced client (after reconnect)
          if (entry.client !== client) return;
          if (entry.session.status === 'connected') {
            entry.session.status = 'disconnected';
            entry.closeCallbacks.forEach((cb) => cb());
          }
          this._cleanupSession(entry);
        })
        .connect(config);
    });
  }

  private async _connectViaJumpHost(
    entry: SessionEntry,
    jumpHostEntry: HostEntry,
    targetHostEntry: HostEntry,
    password?: string
  ): Promise<void> {
    const jumpConfig = this._buildConnectConfig(jumpHostEntry);

    return new Promise((resolve, reject) => {
      entry.jumpClient!
        .on('ready', () => {
          entry.jumpClient!.forwardOut(
            '127.0.0.1',
            0,
            targetHostEntry.hostname,
            targetHostEntry.port,
            (err, stream) => {
              if (err) {
                reject(new Error(`Jump host forwarding failed: ${err.message}`));
                return;
              }
              const targetConfig = this._buildConnectConfig(targetHostEntry, password);
              targetConfig.sock = stream;
              delete targetConfig.host;
              delete targetConfig.port;
              this._connectClient(entry, targetConfig).then(resolve).catch(reject);
            }
          );
        })
        .on('error', (err) => {
          reject(new Error(`Jump host connection failed: ${err.message}`));
        })
        .connect(jumpConfig);
    });
  }

  private _setupKeepAlive(entry: SessionEntry): void {
    // ssh2 handles keepalive internally via keepaliveInterval config
    // This is a placeholder for any additional keep-alive logic
  }

  private _cleanupSession(entry: SessionEntry): void {
    if (entry.keepAliveTimer) {
      clearInterval(entry.keepAliveTimer);
      entry.keepAliveTimer = null;
    }
    if (entry.stream) {
      entry.stream.close();
      entry.stream = null;
    }
  }

  private _formatError(err: Error & { level?: string }): string {
    if (err.message.includes('Authentication failed') || err.level === 'client-authentication') {
      return 'Authentication failed: invalid credentials or key';
    }
    if (err.message.includes('ECONNREFUSED')) {
      return 'Connection refused: server may be down or port is incorrect';
    }
    if (err.message.includes('ENOTFOUND') || err.message.includes('getaddrinfo')) {
      return 'Host not found: check hostname or DNS settings';
    }
    if (err.message.includes('ETIMEDOUT')) {
      return 'Connection timeout: server did not respond';
    }
    return `Connection error: ${err.message}`;
  }

  disconnect(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;
    entry.session.status = 'disconnected';
    entry.client.end();
    if (entry.jumpClient) {
      entry.jumpClient.end();
    }
    this._cleanupSession(entry);
    entry.closeCallbacks.forEach((cb) => cb());
    this.sessions.delete(sessionId);
  }

  async reconnect(sessionId: string, password?: string): Promise<SSHSession> {
    const oldEntry = this.sessions.get(sessionId);
    if (!oldEntry) throw new Error('Session not found');

    const hostEntry = this.hostResolver?.(oldEntry.session.hostEntryId);
    if (!hostEntry) throw new Error('Host not found');

    // Use stored password if none provided
    const effectivePassword = password ?? oldEntry.password;

    // Clean up old connection without firing close callbacks
    try { oldEntry.client.end(); } catch { /* ignore */ }
    if (oldEntry.jumpClient) { try { oldEntry.jumpClient.end(); } catch { /* ignore */ } }
    this._cleanupSession(oldEntry);

    // Create new client, reuse same sessionId and callbacks
    oldEntry.client = new Client();
    oldEntry.stream = null;
    oldEntry.jumpClient = null;
    oldEntry.session.status = 'connecting';
    oldEntry.session.error = undefined;

    try {
      await this._establishConnection(oldEntry, hostEntry, effectivePassword);
      return oldEntry.session;
    } catch (err) {
      oldEntry.session.status = 'error';
      oldEntry.session.error = err instanceof Error ? err.message : String(err);
      throw err;
    }
  }

  getSession(sessionId: string): SSHSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  listSessions(): SSHSession[] {
    return Array.from(this.sessions.values()).map((e) => e.session);
  }

  write(sessionId: string, data: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.stream) return;
    entry.stream.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const entry = this.sessions.get(sessionId);
    if (!entry?.stream) return;
    entry.stream.setWindow(rows, cols, 0, 0);
  }

  openShell(sessionId: string, cols?: number, rows?: number): Promise<void> {
      const entry = this.sessions.get(sessionId);
      if (!entry || entry.session.status !== 'connected') {
        return Promise.reject(new Error('Session not connected'));
      }

      return new Promise((resolve, reject) => {
        entry.client.shell(
          { term: 'xterm-256color', cols: cols || 80, rows: rows || 24 },
          (err, stream) => {
            if (err) {
              reject(new Error(`Failed to open shell: ${err.message}`));
              return;
            }
            entry.stream = stream;

            stream.on('data', (data: Buffer) => {
              const str = data.toString('utf-8');
              entry.dataCallbacks.forEach((cb) => cb(str));
            });

            stream.on('close', () => {
              // Client 'close' event handles closeCallbacks — no need to fire here
              entry.stream = null;
            });

            resolve();
          }
        );
      });
    }


  onData(sessionId: string, callback: (data: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.dataCallbacks.push(callback);
  }

  onClose(sessionId: string, callback: () => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.closeCallbacks.push(callback);
  }

  onError(sessionId: string, callback: (error: string) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.errorCallbacks.push(callback);
  }

  getSFTPClient(sessionId: string): Client | undefined {
    const entry = this.sessions.get(sessionId);
    if (entry?.session.status === 'connected') {
      return entry.client;
    }
    return undefined;
  }
}

export const sshService = new SSHService();
