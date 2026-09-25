// Creates (or re-invites) a super admin and prints the one-time setup link.
//
//   npm run admin:invite -- you@infocusfilmschool.com "Your Name"            (local database)
//   npm run admin:invite -- you@infocusfilmschool.com "Your Name" --remote   (production)
//
// The person opens the link, sets a password, and can then sign in at /login
// and invite everyone else from Staff accounts.
import { spawnSync } from 'node:child_process';
import { randomBytes, createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [email, name] = args.filter((a) => !a.startsWith('--'));
if (!email || !name) {
  console.error('Usage: npm run admin:invite -- <email> "<name>" [--remote]');
  process.exit(1);
}

const token = randomBytes(32).toString('base64url');
const hash = createHash('sha256').update(token).digest('base64');
const expires = new Date(Date.now() + 72 * 3600 * 1000).toISOString();
const now = new Date().toISOString();
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const lower = email.trim().toLowerCase();

// Insert if new; otherwise refresh the invite and make sure they are an admin.
const sql = `INSERT INTO users (id, email, name, roles, status, invite_hash, invite_expires_at, created_at)
VALUES (${q(randomUUID())}, ${q(lower)}, ${q(name)}, '["admin"]', 'invited', ${q(hash)}, ${q(expires)}, ${q(now)})
ON CONFLICT(email) DO UPDATE SET
  invite_hash = excluded.invite_hash,
  invite_expires_at = excluded.invite_expires_at,
  roles = '["admin"]',
  status = CASE WHEN users.status = 'disabled' THEN 'invited' ELSE users.status END;
`;

// Passed as a file: shells (especially on Windows) mangle inline SQL.
const dir = mkdtempSync(join(tmpdir(), 'ifs-invite-'));
const file = join(dir, 'invite.sql');
writeFileSync(file, sql, 'utf8');
try {
  const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'infocus', remote ? '--remote' : '--local', '--file', file], {
    stdio: 'inherit',
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}

const base = remote ? 'https://infocusfilmschool.com' : 'http://localhost:4321';
console.log('\nSetup link (valid 72 hours, single use):\n');
console.log(`  ${base}/login/setup?token=${token}\n`);
