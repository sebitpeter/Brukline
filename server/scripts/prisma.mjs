// Runs the Prisma CLI against the right schema for your DATABASE_URL.
//   postgresql://...  -> prisma/schema.prisma          (Neon / local PostgreSQL)
//   file:./dev.db     -> prisma/sqlite/schema.prisma   (generated copy, offline dev)
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envFile = join(root, '.env');
if (existsSync(envFile) && !process.env.DATABASE_URL) process.loadEnvFile(envFile);

const url = process.env.DATABASE_URL || '';
let schema = join(root, 'prisma', 'schema.prisma');
if (url.startsWith('file:')) {
  const src = readFileSync(schema, 'utf8').replace('provider = "postgresql"', 'provider = "sqlite"');
  const dir = join(root, 'prisma', 'sqlite');
  mkdirSync(dir, { recursive: true });
  schema = join(dir, 'schema.prisma');
  writeFileSync(schema, src);
  // SQLite paths in DATABASE_URL are relative to the schema file; keep dev.db in prisma/sqlite/.
}

// Run the Prisma CLI with the current node binary (no shell, so paths with spaces work on Windows).
const prismaCli = createRequire(import.meta.url).resolve('prisma/build/index.js');
const args = [prismaCli, ...process.argv.slice(2), '--schema', schema];
const res = spawnSync(process.execPath, args, { stdio: 'inherit', cwd: root });
process.exit(res.status ?? 1);
