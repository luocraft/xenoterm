import { randomUUID } from 'crypto';
import type {
  TransferProgress,
  TransferDirection,
  TransferStatus,
  FileEntry
} from '../../shared/types';

/**
 * Calculate transfer percentage from bytes transferred and total bytes.
 * Returns a value clamped to [0, 100].
 */
export function calculateTransferPercentage(
  bytesTransferred: number,
  totalBytes: number
): number {
  if (totalBytes <= 0) return 0;
  const pct = (bytesTransferred / totalBytes) * 100;
  return Math.min(100, Math.max(0, pct));
}

/**
 * Create a new TransferProgress entry.
 */
export function createTransferProgress(
  filename: string,
  direction: TransferDirection,
  totalBytes: number
): TransferProgress {
  return {
    transferId: randomUUID(),
    filename,
    direction,
    bytesTransferred: 0,
    totalBytes,
    speed: 0,
    status: 'pending'
  };
}

/**
 * Detect file conflicts: files in sourceFiles whose names also appear in targetFiles.
 */
export function detectConflicts(
  sourceFiles: FileEntry[],
  targetFiles: FileEntry[]
): FileEntry[] {
  const targetNames = new Set(targetFiles.map((f) => f.name));
  return sourceFiles.filter((f) => targetNames.has(f.name));
}

/**
 * Represents a node in a directory tree for recursive traversal.
 */
export interface DirTreeNode {
  name: string;
  isDirectory: boolean;
  children?: DirTreeNode[];
}

/**
 * Flatten a directory tree into a list of file paths (non-directory nodes).
 * Returns all file paths relative to the root.
 */
export function flattenDirTree(node: DirTreeNode, prefix: string = ''): string[] {
  const currentPath = prefix ? `${prefix}/${node.name}` : node.name;

  if (!node.isDirectory) {
    return [currentPath];
  }

  if (!node.children || node.children.length === 0) {
    return [];
  }

  const results: string[] = [];
  for (const child of node.children) {
    results.push(...flattenDirTree(child, currentPath));
  }
  return results;
}

/**
 * Count total files in a directory tree (non-directory nodes only).
 */
export function countFilesInTree(node: DirTreeNode): number {
  if (!node.isDirectory) return 1;
  if (!node.children || node.children.length === 0) return 0;
  return node.children.reduce((sum, child) => sum + countFilesInTree(child), 0);
}

/**
 * Transfer queue: manages a list of transfer progress entries.
 */
export class TransferQueue {
  private transfers: Map<string, TransferProgress> = new Map();

  addTransfer(progress: TransferProgress): void {
    this.transfers.set(progress.transferId, progress);
  }

  addTransfers(items: TransferProgress[]): void {
    for (const item of items) {
      this.transfers.set(item.transferId, item);
    }
  }

  getTransfer(transferId: string): TransferProgress | undefined {
    return this.transfers.get(transferId);
  }

  updateTransfer(transferId: string, updates: Partial<TransferProgress>): void {
    const existing = this.transfers.get(transferId);
    if (existing) {
      Object.assign(existing, updates);
    }
  }

  cancelTransfer(transferId: string): void {
    const existing = this.transfers.get(transferId);
    if (existing && existing.status !== 'completed') {
      existing.status = 'cancelled';
    }
  }

  listTransfers(): TransferProgress[] {
    return Array.from(this.transfers.values());
  }

  get size(): number {
    return this.transfers.size;
  }
}
