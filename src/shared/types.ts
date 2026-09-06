// === SSH / Connection Types ===

export type SessionStatus = 'connecting' | 'connected' | 'disconnected' | 'error';

export interface RemoteDiskUsage {
  filesystem: string;
  mount: string;
  total: number;
  used: number;
  available: number;
  percent: number;
}

export interface RemoteResources {
  sampledAt: number;
  cpuPercent: number | null;
  loadAverage: number[];
  memory: { total: number; used: number; available: number };
  disks: RemoteDiskUsage[];
}

export interface HostEntry {
  id: string;
  name: string;
  hostname: string;
  port: number;
  username: string;
  authMethod: 'password' | 'publicKey';
  password?: string;
  privateKeyPath?: string;
  passphrase?: string;
  group?: string;
  jumpHost?: string;
  keepAliveInterval?: number;
  createdAt: string;
  updatedAt: string;
}

export interface SSHSession {
  id: string;
  hostEntryId: string;
  status: SessionStatus;
  connectedAt?: string;
  error?: string;
}

export interface ConnectionGroup {
  id: string;
  name: string;
  parentId?: string;
  hostIds: string[];
}


export interface FileEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  modifiedAt: string;
  permissions: string;
}

export type TransferDirection = 'upload' | 'download';
export type TransferStatus = 'pending' | 'transferring' | 'completed' | 'failed' | 'cancelled';

export interface TransferProgress {
  transferId: string;
  filename: string;
  direction: TransferDirection;
  bytesTransferred: number;
  totalBytes: number;
  speed: number;
  status: TransferStatus;
  error?: string;
}

export interface AppConfig {
  theme: 'dark' | 'light';
  terminal: {
    fontFamily: string;
    fontSize: number;
    colorScheme: string;
  };
  sidebarCollapsed: boolean;
  defaultKeepAlive: number;
  autoCheckUpdates: boolean;
}

export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
  | 'disabled';

export interface UpdateStatusSnapshot {
  enabled: boolean;
  currentVersion: string;
  autoCheckOnStartup: boolean;
  state: UpdateState;
  availableVersion?: string;
  downloadedVersion?: string;
  progressPercent?: number;
  transferredBytes?: number;
  totalBytes?: number;
  bytesPerSecond?: number;
  releaseDate?: string;
  checkedAt?: string;
  lastCheckManual: boolean;
  error?: string;
}

export interface ExportData {
  version: string;
  hosts: HostEntry[];
  groups: ConnectionGroup[];
}

export interface ImportResult {
  imported: number;
  errors: string[];
}

// === Network Debug Types ===

export type NetProtocol = 'tcp-client' | 'tcp-server' | 'udp';

export type NetSessionStatus = 'idle' | 'connecting' | 'connected' | 'listening' | 'error' | 'closed';

export interface NetSession {
  id: string;
  protocol: NetProtocol;
  host: string;
  port: number;
  localPort?: number;
  status: NetSessionStatus;
  error?: string;
  createdAt: string;
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
  friendlyName?: string;
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
