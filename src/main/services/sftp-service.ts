import type { Client, SFTPWrapper } from 'ssh2';
import { createReadStream, createWriteStream, statSync, readdirSync } from 'fs';
import { join, basename, posix } from 'path';
import type { FileEntry, TransferProgress } from '../../shared/types';
import {
  createTransferProgress,
  TransferQueue
} from './sftp-utils';

export class SFTPService {
  private queue = new TransferQueue();
  private progressCallbacks: Map<string, Array<(p: TransferProgress) => void>> = new Map();
  private globalProgressCallbacks: Array<(p: TransferProgress) => void> = [];

  private _getSFTP(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) reject(new Error(`SFTP session failed: ${err.message}`));
        else resolve(sftp);
      });
    });
  }

  async listDirectory(client: Client, remotePath: string): Promise<FileEntry[]> {
    const sftp = await this._getSFTP(client);
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

  async upload(
    client: Client,
    localPath: string,
    remotePath: string
  ): Promise<TransferProgress> {
    const sftp = await this._getSFTP(client);
    const stats = statSync(localPath);
    const progress = createTransferProgress(basename(localPath), 'upload', stats.size);
    this.queue.addTransfer(progress);

    return new Promise((resolve, reject) => {
      progress.status = 'transferring';
      this._emitProgress(progress);

      const readStream = createReadStream(localPath);
      const writeStream = sftp.createWriteStream(remotePath);
      let transferred = 0;
      const startTime = Date.now();

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        progress.bytesTransferred = transferred;
        const elapsed = (Date.now() - startTime) / 1000;
        progress.speed = elapsed > 0 ? transferred / elapsed : 0;
        this._emitProgress(progress);
      });

      writeStream.on('close', () => {
        progress.status = 'completed';
        progress.bytesTransferred = stats.size;
        this._emitProgress(progress);
        resolve(progress);
      });

      writeStream.on('error', (err: Error) => {
        progress.status = 'failed';
        progress.error = err.message;
        this._emitProgress(progress);
        reject(new Error(`Upload failed: ${err.message}`));
      });

      readStream.pipe(writeStream);
    });
  }

  async download(
    client: Client,
    remotePath: string,
    localPath: string
  ): Promise<TransferProgress> {
    const sftp = await this._getSFTP(client);

    const remoteStats = await new Promise<{ size: number }>((resolve, reject) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) reject(new Error(`Failed to stat remote file: ${err.message}`));
        else resolve({ size: stats.size });
      });
    });

    const progress = createTransferProgress(basename(remotePath), 'download', remoteStats.size);
    this.queue.addTransfer(progress);

    return new Promise((resolve, reject) => {
      progress.status = 'transferring';
      this._emitProgress(progress);

      const readStream = sftp.createReadStream(remotePath);
      const writeStream = createWriteStream(localPath);
      let transferred = 0;
      const startTime = Date.now();

      readStream.on('data', (chunk: Buffer) => {
        transferred += chunk.length;
        progress.bytesTransferred = transferred;
        const elapsed = (Date.now() - startTime) / 1000;
        progress.speed = elapsed > 0 ? transferred / elapsed : 0;
        this._emitProgress(progress);
      });

      writeStream.on('close', () => {
        progress.status = 'completed';
        progress.bytesTransferred = remoteStats.size;
        this._emitProgress(progress);
        resolve(progress);
      });

      readStream.on('error', (err: Error) => {
        progress.status = 'failed';
        progress.error = err.message;
        this._emitProgress(progress);
        reject(new Error(`Download failed: ${err.message}`));
      });

      readStream.pipe(writeStream);
    });
  }

  async uploadDirectory(
    client: Client,
    localPath: string,
    remotePath: string
  ): Promise<TransferProgress[]> {
    const sftp = await this._getSFTP(client);
    const results: TransferProgress[] = [];

    // Ensure remote directory exists
    await new Promise<void>((resolve) => {
      sftp.mkdir(remotePath, () => resolve()); // ignore error if exists
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
    const { mkdirSync, existsSync } = await import('fs');
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

  cancelTransfer(transferId: string): void {
    this.queue.cancelTransfer(transferId);
    const transfer = this.queue.getTransfer(transferId);
    if (transfer) {
      this._emitProgress(transfer);
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

  private _emitProgress(progress: TransferProgress): void {
    const callbacks = this.progressCallbacks.get(progress.transferId) || [];
    callbacks.forEach((cb) => cb(progress));
    this.globalProgressCallbacks.forEach((cb) => cb(progress));
  }
}

export const sftpService = new SFTPService();
