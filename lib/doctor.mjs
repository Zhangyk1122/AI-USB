import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from './diagnostics.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const allowed = ['--verify-hashes', '--no-probe'];
if (args.some(arg => !allowed.includes(arg))) {
  console.error('Usage: doctor.mjs [--verify-hashes] [--no-probe]');
  process.exitCode = 1;
} else {
  const rows = await diagnose(root, { verifyHashes: args.includes('--verify-hashes'), probe: !args.includes('--no-probe') });
  for (const row of rows) console.log('[' + row.status + '] ' + row.name + ': ' + row.detail);
  process.exitCode = rows.some(row => row.status === 'FAIL') ? 1 : 0;
}
