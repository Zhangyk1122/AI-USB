import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diagnose } from './diagnostics.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.some(a => !['--online', '--direct', '--all-platforms', '--verify-hashes', '--no-probe'].includes(a))) {
  console.error('Usage: doctor.mjs [--online] [--direct] [--all-platforms] [--verify-hashes] [--no-probe]');
  process.exitCode = 1;
} else {
  const rows = await diagnose(root, { online: args.includes('--online'), mode: args.includes('--direct') ? 'direct' : 'cc', allPlatforms: args.includes('--all-platforms'), verifyHashes: args.includes('--verify-hashes'), probe: !args.includes('--no-probe') });
  for (const row of rows) console.log(`[${row.status}] ${row.name}: ${row.detail}`);
  process.exitCode = rows.some(r => r.status === 'FAIL') ? 1 : 0;
}
