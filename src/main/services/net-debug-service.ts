import * as net from 'net';
import * as dgram from 'dgram';
import { randomUUID } from 'crypto';
import type { NetSession, NetProtocol } from '../../shared/types';

interface TcpClientEntry {
  session: NetSession;
  socket: net.Socket;
  dataCallbacks: Array<(data: Buffer, remote?: string) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  clientCallbacks: Array<(clients: string[]) => void>;
}

interface TcpServerEntry {
  session: NetSession;
  server: net.Server;
  clients: Map<string, net.Socket>;
  dataCallbacks: Array<(data: Buffer, remote?: string) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  clientCallbacks: Array<(clients: string[]) => void>;
}

interface UdpEntry {
  session: NetSession;
  socket: dgram.Socket;
  dataCallbacks: Array<(data: Buffer, remote?: string) => void>;
  closeCallbacks: Array<() => void>;
  errorCallbacks: Array<(error: string) => void>;
  clientCallbacks: Array<(clients: string[]) => void>;
}

type SessionEntry = TcpClientEntry | TcpServerEntry | UdpEntry;

export class NetDebugService {
  private sessions: Map<string, SessionEntry> = new Map();

  async createSession(
    protocol: NetProtocol,
    host: string,
    port: number,
    localPort?: number
  ): Promise<NetSession> {
    const id = randomUUID();
    const session: NetSession = {
      id,
      protocol,
      host,
      port,
      localPort,
      status: 'idle',
      createdAt: new Date().toISOString(),
    };

    switch (protocol) {
      case 'tcp-client':
        return this._createTcpClient(session);
      case 'tcp-server':
        return this._createTcpServer(session);
      case 'udp':
        return this._createUdp(session);
    }
  }

  private _createTcpClient(session: NetSession): Promise<NetSession> {
    return new Promise((resolve, reject) => {
      const socket = new net.Socket();
      const entry: TcpClientEntry = {
        session,
        socket,
        dataCallbacks: [],
        closeCallbacks: [],
        errorCallbacks: [],
        clientCallbacks: [],
      };
      this.sessions.set(session.id, entry);

      session.status = 'connecting';

      const timeout = setTimeout(() => {
        socket.destroy();
        session.status = 'error';
        session.error = 'Connection timeout';
        reject(new Error('Connection timeout'));
      }, 10000);

      socket.connect(session.port, session.host, () => {
        clearTimeout(timeout);
        session.status = 'connected';
        resolve(session);
      });

      socket.on('data', (data) => {
        const remote = `${socket.remoteAddress}:${socket.remotePort}`;
        entry.dataCallbacks.forEach((cb) => cb(data, remote));
      });

      socket.on('error', (err) => {
        clearTimeout(timeout);
        session.status = 'error';
        session.error = err.message;
        entry.errorCallbacks.forEach((cb) => cb(err.message));
        if (session.status === 'connecting') {
          reject(err);
        }
      });

      socket.on('close', () => {
        session.status = 'closed';
        entry.closeCallbacks.forEach((cb) => cb());
      });
    });
  }

  private _createTcpServer(session: NetSession): Promise<NetSession> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      const entry: TcpServerEntry = {
        session,
        server,
        clients: new Map(),
        dataCallbacks: [],
        closeCallbacks: [],
        errorCallbacks: [],
        clientCallbacks: [],
      };
      this.sessions.set(session.id, entry);

      session.status = 'connecting';
      session.clients = [];

      server.on('connection', (socket) => {
        const addr = `${socket.remoteAddress}:${socket.remotePort}`;
        entry.clients.set(addr, socket);
        session.clients = Array.from(entry.clients.keys());
        entry.clientCallbacks.forEach((cb) => cb(session.clients!));

        socket.on('data', (data) => {
          entry.dataCallbacks.forEach((cb) => cb(data, addr));
        });

        socket.on('close', () => {
          entry.clients.delete(addr);
          session.clients = Array.from(entry.clients.keys());
          entry.clientCallbacks.forEach((cb) => cb(session.clients!));
        });

        socket.on('error', () => {
          entry.clients.delete(addr);
          session.clients = Array.from(entry.clients.keys());
        });
      });

      server.on('error', (err) => {
        session.status = 'error';
        session.error = err.message;
        entry.errorCallbacks.forEach((cb) => cb(err.message));
        reject(err);
      });

      server.listen(session.port, session.host === '0.0.0.0' ? undefined : session.host, () => {
        session.status = 'listening';
        resolve(session);
      });
    });
  }

  private _createUdp(session: NetSession): Promise<NetSession> {
    return new Promise((resolve, reject) => {
      const socket = dgram.createSocket('udp4');
      const entry: UdpEntry = {
        session,
        socket,
        dataCallbacks: [],
        closeCallbacks: [],
        errorCallbacks: [],
        clientCallbacks: [],
      };
      this.sessions.set(session.id, entry);

      socket.on('message', (msg, rinfo) => {
        const remote = `${rinfo.address}:${rinfo.port}`;
        entry.dataCallbacks.forEach((cb) => cb(msg, remote));
      });

      socket.on('error', (err) => {
        session.status = 'error';
        session.error = err.message;
        entry.errorCallbacks.forEach((cb) => cb(err.message));
      });

      socket.on('close', () => {
        session.status = 'closed';
        entry.closeCallbacks.forEach((cb) => cb());
      });

      const bindPort = session.localPort || 0;
      socket.bind(bindPort, () => {
        session.status = 'connected';
        session.localPort = socket.address().port;
        resolve(session);
      });
    });
  }

  send(sessionId: string, data: Buffer, remoteAddress?: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    if (entry.session.protocol === 'tcp-client') {
      (entry as TcpClientEntry).socket.write(data);
    } else if (entry.session.protocol === 'tcp-server') {
      const serverEntry = entry as TcpServerEntry;
      if (remoteAddress) {
        const client = serverEntry.clients.get(remoteAddress);
        if (client) client.write(data);
      } else {
        // Broadcast to all clients
        serverEntry.clients.forEach((client) => client.write(data));
      }
    } else if (entry.session.protocol === 'udp') {
      const udpEntry = entry as UdpEntry;
      udpEntry.socket.send(data, entry.session.port, entry.session.host);
    }
  }

  close(sessionId: string): void {
    const entry = this.sessions.get(sessionId);
    if (!entry) return;

    if (entry.session.protocol === 'tcp-client') {
      (entry as TcpClientEntry).socket.destroy();
    } else if (entry.session.protocol === 'tcp-server') {
      const serverEntry = entry as TcpServerEntry;
      serverEntry.clients.forEach((client) => client.destroy());
      serverEntry.server.close();
    } else if (entry.session.protocol === 'udp') {
      (entry as UdpEntry).socket.close();
    }

    entry.session.status = 'closed';
    entry.closeCallbacks.forEach((cb) => cb());
    this.sessions.delete(sessionId);
  }

  getSession(sessionId: string): NetSession | undefined {
    return this.sessions.get(sessionId)?.session;
  }

  onData(sessionId: string, callback: (data: Buffer, remote?: string) => void): void {
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

  onClientChange(sessionId: string, callback: (clients: string[]) => void): void {
    const entry = this.sessions.get(sessionId);
    if (entry) entry.clientCallbacks.push(callback);
  }
}
