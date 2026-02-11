import { describe, it, expect } from 'vitest';
import {
  calculateTransferPercentage,
  createTransferProgress,
  detectConflicts,
  flattenDirTree,
  countFilesInTree,
  TransferQueue,
  type DirTreeNode
} from '../sftp-utils';
import type { FileEntry } from '../../../shared/types';

describe('TransferQueue state transitions', () => {
  it('should create transfer in pending status', () => {
    const p = createTransferProgress('test.txt', 'upload', 1000);
    expect(p.status).toBe('pending');
    expect(p.bytesTransferred).toBe(0);
    expect(p.transferId).toBeTruthy();
  });

  it('should update transfer status', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'upload', 1000);
    queue.addTransfer(p);

    queue.updateTransfer(p.transferId, { status: 'transferring', bytesTransferred: 500 });
    const updated = queue.getTransfer(p.transferId);
    expect(updated!.status).toBe('transferring');
    expect(updated!.bytesTransferred).toBe(500);
  });

  it('should transition to completed', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'upload', 1000);
    queue.addTransfer(p);

    queue.updateTransfer(p.transferId, { status: 'completed', bytesTransferred: 1000 });
    expect(queue.getTransfer(p.transferId)!.status).toBe('completed');
  });

  it('should transition to failed with error', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'upload', 1000);
    queue.addTransfer(p);

    queue.updateTransfer(p.transferId, { status: 'failed', error: 'Permission denied' });
    const updated = queue.getTransfer(p.transferId);
    expect(updated!.status).toBe('failed');
    expect(updated!.error).toBe('Permission denied');
  });
});

describe('TransferQueue cancel', () => {
  it('should cancel a pending transfer', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'upload', 1000);
    queue.addTransfer(p);

    queue.cancelTransfer(p.transferId);
    expect(queue.getTransfer(p.transferId)!.status).toBe('cancelled');
  });

  it('should cancel a transferring transfer', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'download', 5000);
    queue.addTransfer(p);
    queue.updateTransfer(p.transferId, { status: 'transferring' });

    queue.cancelTransfer(p.transferId);
    expect(queue.getTransfer(p.transferId)!.status).toBe('cancelled');
  });

  it('should not cancel a completed transfer', () => {
    const queue = new TransferQueue();
    const p = createTransferProgress('test.txt', 'upload', 1000);
    queue.addTransfer(p);
    queue.updateTransfer(p.transferId, { status: 'completed' });

    queue.cancelTransfer(p.transferId);
    expect(queue.getTransfer(p.transferId)!.status).toBe('completed');
  });

  it('should handle cancel of non-existent transfer gracefully', () => {
    const queue = new TransferQueue();
    queue.cancelTransfer('non-existent'); // should not throw
  });
});

describe('Empty directory traversal', () => {
  it('should return empty list for empty directory', () => {
    const emptyDir: DirTreeNode = { name: 'empty', isDirectory: true, children: [] };
    expect(flattenDirTree(emptyDir)).toEqual([]);
    expect(countFilesInTree(emptyDir)).toBe(0);
  });

  it('should return single file for leaf node', () => {
    const file: DirTreeNode = { name: 'readme.txt', isDirectory: false };
    expect(flattenDirTree(file)).toEqual(['readme.txt']);
    expect(countFilesInTree(file)).toBe(1);
  });
});

describe('Conflict detection edge cases', () => {
  it('should return empty for no overlapping names', () => {
    const source: FileEntry[] = [
      { name: 'a.txt', path: '/a.txt', isDirectory: false, size: 10, modifiedAt: '', permissions: '644' }
    ];
    const target: FileEntry[] = [
      { name: 'b.txt', path: '/b.txt', isDirectory: false, size: 20, modifiedAt: '', permissions: '644' }
    ];
    expect(detectConflicts(source, target)).toEqual([]);
  });

  it('should return empty when target is empty', () => {
    const source: FileEntry[] = [
      { name: 'a.txt', path: '/a.txt', isDirectory: false, size: 10, modifiedAt: '', permissions: '644' }
    ];
    expect(detectConflicts(source, [])).toEqual([]);
  });

  it('should return empty when source is empty', () => {
    const target: FileEntry[] = [
      { name: 'a.txt', path: '/a.txt', isDirectory: false, size: 10, modifiedAt: '', permissions: '644' }
    ];
    expect(detectConflicts([], target)).toEqual([]);
  });
});
