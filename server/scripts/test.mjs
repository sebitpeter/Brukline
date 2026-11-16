// Runs the test suite against a separate SQLite database (prisma/sqlite/test.db; the tests clear its
// tables first) and a temp upload folder, so your dev data is never touched.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const env = { ...process.env, DATABASE_URL: 'file:./test.db', NODE_ENV: 'test', JWT_SECRET: 'test-secret-'.padEnd(48, 'x'), UPLOAD_DIR: mkdtempSync(join(tmpdir(), 'brukline-test-')), SMS_PROVIDER: 'console', WHATSAPP_PROVIDER: 'console', MAX_UPLOAD_MB: '1' };
const push = spawnSync(process.execPath, ['scripts/prisma.mjs', 'db', 'push', '--skip-generate'], { cwd: root, env, stdio: ['ignore', 'ignore', 'inherit'] });
if (push.status !== 0) process.exit(push.status ?? 1);
const files = readdirSync(join(root, 'tests')).filter((f) => f.endsWith('.test.js')).map((f) => join('tests', f));
const res = spawnSync(process.execPath, ['--test', '--test-concurrency=1', ...files, ...process.argv.slice(2)], { cwd: root, env, stdio: 'inherit' });
process.exit(res.status ?? 1);
