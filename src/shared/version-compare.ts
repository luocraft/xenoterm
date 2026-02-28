/**
 * Semantic version comparison utilities.
 * Handles standard semver format: major.minor.patch (e.g., "1.2.3")
 * Also handles versions with different number of parts (e.g., "1.0" vs "1.0.0")
 */

/**
 * Compare two semantic version strings.
 * @returns -1 if a < b, 0 if a == b, 1 if a > b
 */
export function compareVersions(a: string, b: string): number {
  const partsA = a.split('.').map(Number);
  const partsB = b.split('.').map(Number);
  const len = Math.max(partsA.length, partsB.length);

  for (let i = 0; i < len; i++) {
    const numA = partsA[i] ?? 0;
    const numB = partsB[i] ?? 0;
    if (numA > numB) return 1;
    if (numA < numB) return -1;
  }

  return 0;
}

/**
 * Check if candidate version is newer than current version.
 */
export function isNewerVersion(current: string, candidate: string): boolean {
  return compareVersions(candidate, current) === 1;
}
