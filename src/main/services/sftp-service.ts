import type { Client, SFTPWrapper } from 'ssh2';
import { readdirSync, mkdirSync, existsSync, statSync } from 'fs';
import { join, basename, posix } from 'path';
import type { FileEntry, TransferProgress } from '../../shared/types';
import {
  createTransferProgress,
  TransferQueue
} from './sftp-utils';

export class SFTPService {
  queue = new TransferQueue();
  private progressCallbacks: Map<string, Array<(p: TransferProgress) => void>> = new Map();
  private globalProgressCallbacks: Array<(p: TransferProgress) => void> = [];
  /** Cache SFTP sessions per Client to avoid repeated handshakes */
  private sftpCache = new WeakMap<Client, SFTPWrapper>();

  getSFTP(client: Client): Promise<SFTPWrapper> {
    const cached = this.sftpCache.get(client);
    if (cached) return Promise.resolve(cached);

    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(new Error(`SFTP session failed: ${err.message}`));
        } else {
          this.sftpCache.set(client, sftp);
          sftp.on('close', () => this.sftpCache.delete(client));
          sftp.on('end', () => this.sftpCache.delete(client));
          resolve(sftp);
        }
      });
    });
  }

  async listDirectory(client: Client, remotePath: string): Promise<FileEntry[]> {
    const sftp = await this.getSFTP(client);
    return new Promise((resolve, reject) => {
      sftp.readdir(remotePath, (err, list) => {
        if (err) {
          reject(new Error(`Failed to list directory: ${err.message}`));
          return;
        }
        const entries: FileEntry[] = list.map((item) => ({
          name: item.filename,
          path: posix.join(remotePath, item.filename),
          isDirectory: (item.attrs.mode! & 0o40000) !== 0,
          size: item.attrs.size ?? 0,
          modifiedAt: new Date((item.attrs.mtime ?? 0) * 1000).toISOString(),
          permissions: (item.attrs.mode ?? 0).toString(8).slice(-3)
        }));
        resolve(entries);
      });
    });
  }

  /**
   * Upload using fastPut — parallel reads for much faster throughput.
   */
  async upload(
    client: Client,
    localPath: string,
    remotePath: string
  ): Promise<TransferProgress> {
    const sftp = await this.getSFTP(client);
    const stats = statSync(localPath);
    const progress = createTransferProgress(basename(localPath), 'upload', stats.size);
    this.queue.addTransfer(progress);

    progress.status = 'transferring';
    this.emitProgress(progress);

    const startTime = Date.now();
    let lastEmit = 0;

    return new Promise((resolve, reject) => {
      sftp.fastPut(localPath, remotePath, {
        concurrency: 25,
        chunkSize: 128 * 1024,
        step: (transferred: number, _chunk: number, total: number) => {
          progress.bytesTransferred = transferred;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            lastEmit = now;
            const elapsed = (now - startTime) / 1000;
            progress.speed = elapsed > 0 ? transferred / elapsed : 0;
            this.emitProgress(progress);
          }
        }
      }, (err) => {
        if (err) {
          progress.status = 'failed';
          progress.error = err.message;
          this.emitProgress(progress);
          reject(new Error(`Upload failed: ${err.message}`));
        } else {
          progress.status = 'completed';
          progress.bytesTransferred = stats.size;
          this.emitProgress(progress);
          resolve(progress);
        }
      });
    });
  }

  /**
   * Download using fastGet — parallel reads for much faster throughput.
   */
  async download(
    client: Client,
    remotePath: string,
    localPath: string
  ): Promise<TransferProgress> {
    const sftp = await this.getSFTP(client);

    const remoteStats = await new Promise<{ size: number }>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) reject(new Error(`Failed to stat remote file: ${err.message}`));
        else resolve({ size: stats.size });
      });
    });

    const progress = createTransferProgress(basename(remotePath), 'download', remoteStats.size);
    this.queue.addTransfer(progress);

    progress.status = 'transferring';
    this.emitProgress(progress);

    const startTime = Date.now();
    let lastEmit = 0;

    return new Promise((resolve, reject) => {
      sftp.fastGet(remotePath, localPath, {
        concurrency: 25,
        chunkSize: 128 * 1024,
        step: (transferred: number, _chunk: number, total: number) => {
          progress.bytesTransferred = transferred;
          const now = Date.now();
          if (now - lastEmit >= 200) {
            lastEmit = now;
            const elapsed = (now - startTime) / 1000;
            progress.speed = elapsed > 0 ? transferred / elapsed : 0;
            this.emitProgress(progress);
          }
        }
      }, (err) => {
        if (err) {
          progress.status = 'failed';
          progress.error = err.message;
          this.emitProgress(progress);
          reject(new Error(`Download failed: ${err.message}`));
        } else {
          progress.status = 'completed';
          progress.bytesTransferred = remoteStats.size;
          this.emitProgress(progress);
          resolve(progress);
        }
      });
    });
  }

  async uploadDirectory(
    client: Client,
    localPath: string,
    remotePath: string
  ): Promise<TransferProgress[]> {
    const sftp = await this.getSFTP(client);
    const results: TransferProgress[] = [];

    await new Promise<void>((resolve) => {
      sftp.mkdir(remotePath, () => resolve());
    });

    const items = readdirSync(localPath, { withFileTypes: true });
    for (const item of items) {
      const localItemPath = join(localPath, item.name);
      const remoteItemPath = posix.join(remotePath, item.name);

      if (item.isDirectory()) {
        const subResults = await this.uploadDirectory(client, localItemPath, remoteItemPath);
        results.push(...subResults);
      } else {
        const result = await this.upload(client, localItemPath, remoteItemPath);
        results.push(result);
      }
    }

    return results;
  }

  async downloadDirectory(
    client: Client,
    remotePath: string,
    localPath: string
  ): Promise<TransferProgress[]> {
    if (!existsSync(localPath)) {
      mkdirSync(localPath, { recursive: true });
    }

    const entries = await this.listDirectory(client, remotePath);
    const results: TransferProgress[] = [];

    for (const entry of entries) {
      const localItemPath = join(localPath, entry.name);
      const remoteItemPath = entry.path;

      if (entry.isDirectory) {
        const subResults = await this.downloadDirectory(client, remoteItemPath, localItemPath);
        results.push(...subResults);
      } else {
        const result = await this.download(client, remoteItemPath, localItemPath);
        results.push(result);
      }
    }

    return results;
  }

  async deleteRemote(client: Client, remotePath: string): Promise<void> {
    const sftp = await this.getSFTP(client);
    // Check if it's a directory
    const stats = await new Promise<any>((resolve, reject) => {
      sftp.stat(remotePath, (err, s) => err ? reject(err) : resolve(s));
    });
    if ((stats.mode & 0o40000) !== 0) {
      // Recursively delete directory
      const entries = await this.listDirectory(client, remotePath);
      for (const entry of entries) {
        await this.deleteRemote(client, entry.path);
      }
      await new Promise<void>((resolve, reject) => {
        sftp.rmdir(remotePath, (err) => err ? reject(err) : resolve());
      });
    } else {
      await new Promise<void>((resolve, reject) => {
        sftp.unlink(remotePath, (err) => err ? reject(err) : resolve());
      });
    }
  }

  async renameRemote(client: Client, oldPath: string, newPath: string): Promise<void> {
    const sftp = await this.getSFTP(client);
    await new Promise<void>((resolve, reject) => {
      sftp.rename(oldPath, newPath, (err) => err ? reject(err) : resolve());
    });
  }

  async mkdirRemote(client: Client, remotePath: string): Promise<void> {
    const sftp = await this.getSFTP(client);
    await new Promise<void>((resolve, reject) => {
      sftp.mkdir(remotePath, (err) => err ? reject(err) : resolve());
    });
  }

  async chmodRemote(client: Client, remotePath: string, mode: number): Promise<void> {
    const sftp = await this.getSFTP(client);
    await new Promise<void>((resolve, reject) => {
      sftp.chmod(remotePath, mode, (err) => err ? reject(err) : resolve());
    });
  }

  async readRemoteFile(client: Client, remotePath: string): Promise<string> {
    const sftp = await this.getSFTP(client);
    return new Promise<string>((resolve, reject) => {
      const chunks: Buffer[] = [];
      const stream = sftp.createReadStream(remotePath, { encoding: undefined });
      stream.on('data', (chunk: Buffer) => chunks.push(chunk));
      stream.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
      stream.on('error', (err) => reject(err));
    });
  }

  async writeRemoteFile(client: Client, remotePath: string, content: string): Promise<void> {
    const sftp = await this.getSFTP(client);
    return new Promise<void>((resolve, reject) => {
      const stream = sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve());
      stream.on('error', (err) => reject(err));
      stream.end(Buffer.from(content, 'utf-8'));
    });
  }

  cancelTransfer(transferId: string): void {
    this.queue.cancelTransfer(transferId);
    const transfer = this.queue.getTransfer(transferId);
    if (transfer) {
      this.emitProgress(transfer);
    }
  }

  getTransferProgress(transferId: string): TransferProgress | undefined {
    return this.queue.getTransfer(transferId);
  }

  getQueue(): TransferQueue {
    return this.queue;
  }

  onProgress(transferId: string, callback: (p: TransferProgress) => void): void {
    if (!this.progressCallbacks.has(transferId)) {
      this.progressCallbacks.set(transferId, []);
    }
    this.progressCallbacks.get(transferId)!.push(callback);
  }

  onGlobalProgress(callback: (p: TransferProgress) => void): void {
    this.globalProgressCallbacks.push(callback);
  }

  emitProgress(progress: TransferProgress): void {
    const callbacks = this.progressCallbacks.get(progress.transferId) || [];
    callbacks.forEach((cb) => cb(progress));
    this.globalProgressCallbacks.forEach((cb) => cb(progress));
  }
}

export const sftpService = new SFTPService();
