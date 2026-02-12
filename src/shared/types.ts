// Shared types - stub for task 1.1
// Full implementation in task 1.2
export {};

// === Network Debug Types ===

export type NetProtocol = 'tcp-client' | 'tcp-server' | 'udp';

export type NetSessionStatus = 'idle' | 'connecting' | 'connected' | 'listening' | 'error' | 'closed';

export interface NetSession {
  id: string;
  protocol: NetProtocol;
  host: string;
  port: number;
  /** For UDP: bind port for receiving */
  localPort?: number;
  status: NetSessionStatus;
  error?: string;
  createdAt: string;
  /** For TCP server: connected client addresses */
  clients?: string[];
}

export type NetDataDirection = 'send' | 'recv';
export type NetDataEncoding = 'utf8' | 'hex';

export interface NetMessage {
  id: string;
  sessionId: string;
  direction: NetDataDirection;
  data: string;
  encoding: NetDataEncoding;
  timestamp: number;
  /** For TCP server / UDP: remote address */
  remoteAddress?: string;
}


// === Serial Port Types ===

export type SerialSessionStatus = 'closed' | 'opening' | 'open' | 'error';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  pnpId?: string;
  vendorId?: string;
  productId?: string;
}

export interface SerialConfig {
  path: string;
  baudRate: number;
  dataBits: 5 | 6 | 7 | 8;
  stopBits: 1 | 1.5 | 2;
  parity: 'none' | 'even' | 'odd' | 'mark' | 'space';
  rtscts: boolean;
  xon: boolean;
  xoff: boolean;
}

export interface SerialSession {
  id: string;
  config: SerialConfig;
  status: SerialSessionStatus;
  error?: string;
  createdAt: string;
  dtr: boolean;
  rts: boolean;
}

export interface SerialMessage {
  id: string;
  sessionId: string;
  direction: NetDataDirection;
  data: string;
  encoding: NetDataEncoding;
  timestamp: number;
}
