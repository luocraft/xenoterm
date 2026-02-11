import { describe, it, expect } from 'vitest';
import * as fc from 'fast-check';
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

// --- Generators ---

const fileEntryArb = fc.record({
  name: fc.string({ minLength: 1, maxLength: 50 }).filter((s) => s.trim().length > 0),
  path: fc.string({ minLength: 1 }),
  isDirectory: fc.constant(false),
  size: fc.nat(),
  modifiedAt: fc.constant(new Date().toISOString()),
  permissions: fc.constant('644')
});

const dirTreeLeaf: fc.Arbitrary<DirTreeNode> = fc.record({
  name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0 && !s.includes('/')),
  isDirectory: fc.constant(false as boolean)
});

const dirTreeNode: fc.Arbitrary<DirTreeNode> = fc.letrec((tie) => ({
  tree: fc.oneof(
    { depthSize: 'small' },
    dirTreeLeaf,
    fc.record({
      name: fc.string({ minLength: 1, maxLength: 20 }).filter((s) => s.trim().length > 0 && !s.includes('/')),
      isDirectory: fc.constant(true as boolean),
      children: fc.array(tie('tree') as fc.Arbitrary<DirTreeNode>, { minLength: 0, maxLength: 4 })
    })
  )
})).tree;

describe('Feature: ssh-client-app, Property 6: Transfer progress calculation', () => {
  /**
   * **Validates: Requirements 4.5**
   *
   * For any transfer with totalBytes > 0 and bytesTransferred in [0, totalBytes],
   * the percentage should always be in [0, 100].
   */
  it('should always produce percentage in [0, 100]', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 1_000_000_000 }),
        fc.double({ min: 0, max: 1, noNaN: true }),
        (totalBytes, ratio) => {
          const bytesTransferred = Math.floor(totalBytes * ratio);
          const pct = calculateTransferPercentage(bytesTransferred, totalBytes);
          expect(pct).toBeGreaterThanOrEqual(0);
          expect(pct).toBeLessThanOrEqual(100);
        }
      ),
      { numRuns: 100 }
    );
  });

  it('should return 0 when totalBytes is 0', () => {
    expect(calculateTransferPercentage(0, 0)).toBe(0);
  });

  it('should return correct percentage', () => {
    expect(calculateTransferPercentage(50, 100)).toBe(50);
    expect(calculateTransferPercentage(100, 100)).toBe(100);
  });
});

describe('Feature: ssh-client-app, Property 7: Transfer queue management', () => {
  /**
   * **Validates: Requirements 4.7, 5.5**
   *
   * For any set of file transfer requests, all files should appear in the
   * transfer queue, and the queue length should equal the number of requests.
   */
  it('should contain all added transfers with correct count', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            filename: fc.string({ minLength: 1 }).filter((s) => s.trim().length > 0),
            direction: fc.constantFrom('upload' as const, 'download' as const),
            totalBytes: fc.nat({ max: 1_000_000 })
          }),
          { minLength: 0, maxLength: 20 }
        ),
        (requests) => {
          const queue = new TransferQueue();
          const progresses = requests.map((r) =>
            createTransferProgress(r.filename, r.direction, r.totalBytes)
          );
          queue.addTransfers(progresses);

          expect(queue.size).toBe(requests.length);
          expect(queue.listTransfers().length).toBe(requests.length);

          for (const p of progresses) {
            const found = queue.getTransfer(p.transferId);
            expect(found).toBeDefined();
            expect(found!.filename).toBe(p.filename);
            expect(found!.direction).toBe(p.direction);
          }
        }
      ),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 8: Recursive directory traversal completeness', () => {
  /**
   * **Validates: Requirements 4.8**
   *
   * For any directory tree, the recursive traversal should produce a flat list
   * containing every file, and the count should match.
   */
  it('should flatten all files and match count', () => {
    fc.assert(
      fc.property(dirTreeNode, (tree) => {
        const flatFiles = flattenDirTree(tree);
        const fileCount = countFilesInTree(tree);

        expect(flatFiles.length).toBe(fileCount);

        // All entries should be non-empty strings
        for (const f of flatFiles) {
          expect(f.length).toBeGreaterThan(0);
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('Feature: ssh-client-app, Property 9: File conflict detection', () => {
  /**
   * **Validates: Requirements 5.6**
   *
   * For any list of source files and target files, the conflict detection should
   * identify exactly those files whose names appear in both lists.
   */
  it('should detect exactly the overlapping filenames', () => {
    fc.assert(
      fc.property(
        fc.array(fileEntryArb, { minLength: 0, maxLength: 10 }),
        fc.array(fileEntryArb, { minLength: 0, maxLength: 10 }),
        (sourceFiles, targetFiles) => {
          const conflicts = detectConflicts(
            sourceFiles as FileEntry[],
            targetFiles as FileEntry[]
          );

          const targetNames = new Set(targetFiles.map((f) => f.name));

          // Every conflict should have its name in target
          for (const c of conflicts) {
            expect(targetNames.has(c.name)).toBe(true);
          }

          // Every source file with name in target should be in conflicts
          const conflictNames = new Set(conflicts.map((c) => c.name));
          for (const s of sourceFiles) {
            if (targetNames.has(s.name)) {
              expect(conflictNames.has(s.name)).toBe(true);
            }
          }

          // Conflict count should not exceed source count
          expect(conflicts.length).toBeLessThanOrEqual(sourceFiles.length);
        }
      ),
      { numRuns: 100 }
    );
  });
});
