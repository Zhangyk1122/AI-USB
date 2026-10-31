import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkAPIs } from './api-diagnostics.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rows = await checkAPIs(root, { mode: process.argv.includes('--cc-switch') ? 'cc' : 'direct' });
for (const row of rows) console.log(`[${row.status}] ${row.name}: ${row.detail}`);
process.exitCode = rows.some(r => r.status === 'FAIL' || r.status === 'SKIP') ? 1 : 0;
