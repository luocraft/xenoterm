import { describe, it, expect } from 'vitest';
import { compareVersions, isNewerVersion } from '../version-compare';

describe('compareVersions', () => {
  it('returns 0 for equal versions', () => {
    expect(compareVersions('1.2.3', '1.2.3')).toBe(0);
  });

  it('returns 1 when a > b (major)', () => {
    expect(compareVersions('2.0.0', '1.0.0')).toBe(1);
  });

  it('returns -1 when a < b (major)', () => {
    expect(compareVersions('1.0.0', '2.0.0')).toBe(-1);
  });

  it('compares minor versions', () => {
    expect(compareVersions('1.2.0', '1.1.0')).toBe(1);
    expect(compareVersions('1.1.0', '1.2.0')).toBe(-1);
  });

  it('compares patch versions', () => {
    expect(compareVersions('1.0.2', '1.0.1')).toBe(1);
    expect(compareVersions('1.0.1', '1.0.2')).toBe(-1);
  });

  it('handles different number of parts', () => {
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('1.0.1', '1.0')).toBe(1);
    expect(compareVersions('1', '1.0.0')).toBe(0);
  });
});

describe('isNewerVersion', () => {
  it('returns true when candidate is newer', () => {
    expect(isNewerVersion('1.0.0', '1.0.1')).toBe(true);
  });

  it('returns false when candidate is older', () => {
    expect(isNewerVersion('1.0.1', '1.0.0')).toBe(false);
  });

  it('returns false when versions are equal', () => {
    expect(isNewerVersion('1.0.0', '1.0.0')).toBe(false);
  });
});
