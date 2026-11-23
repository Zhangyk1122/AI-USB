import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

// The set of files an update replaces. User data (data/, workspace/) is never included.
export const PACKAGE_DIRS = ['lib', 'tests', 'platforms'];
export const PACKAGE_FILE = /\.(?:bat|ps1|md|txt|json)$/;
// CI-only artifacts that live in the checked-out root but are never part of the package.
export const CI_ARTIFACTS = new Set(['SHA256SUMS.txt', 'test-output.txt']);
export const isPackageRootFile = name => PACKAGE_FILE.test(name) && !CI_ARTIFACTS.has(name) && !name.startsWith('delta-from-');

// The only top-level entries an update may replace. data/, config/ and workspace/ are user data.
export const isPackageTopLevel = name => PACKAGE_DIRS.includes(name) || (!name.includes('/') && isPackageRootFile(name));

export function packageItems(dir) {
  return fs.readdirSync(dir).filter(isPackageTopLevel);
}

export function sha256File(file) {
  const hash = createHash('sha256');
  const fd = fs.openSync(file, 'r');
  const buffer = Buffer.alloc(1024 * 1024);
  try {
    let n;
    while ((n = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, n));
  } finally { fs.closeSync(fd); }
  return hash.digest('hex');
}
