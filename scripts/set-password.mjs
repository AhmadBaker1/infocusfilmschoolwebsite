// Sets a staff member's password directly and activates the account.
//
//   npm run staff:password -- someone@infocusfilmschool.com "their password"            (local database)
//   npm run staff:password -- someone@infocusfilmschool.com "their password" --remote   (production)
//
// The hash is computed exactly as src/lib/server/auth.ts does it (PBKDF2 +
// HMAC with the session secret), so the secret must be the one the target
// environment uses: .secrets/SESSION_SECRET.txt for production, .dev.vars
// locally. Prefer setup links (invite-admin.mjs) when the person can set
// their own password; use this when you must hand someone a password.
import { spawnSync } from 'node:child_process';
import { webcrypto as crypto } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const remote = args.includes('--remote');
const [email, password] = args.filter((a) => !a.startsWith('--'));
if (!email || !password) {
  console.error('Usage: npm run staff:password -- <email> "<password>" [--remote]');
  process.exit(1);
}
if (password.length < 12) {
  console.error('Password must be at least 12 characters.');
  process.exit(1);
}

const root = fileURLToPath(new URL('..', import.meta.url));
let secret = '';
if (remote) {
  const f = join(root, '.secrets', 'SESSION_SECRET.txt');
  if (!existsSync(f)) {
    console.error('Missing .secrets/SESSION_SECRET.txt (the production session secret).');
    process.exit(1);
  }
  secret = readFileSync(f, 'utf8').trim();
} else {
  const f = join(root, '.dev.vars');
  secret = existsSync(f) ? (readFileSync(f, 'utf8').match(/^SESSION_SECRET=(.*)$/m)?.[1] ?? '').trim() : '';
  if (!secret) secret = 'dev-only-secret-not-for-production';
}

const enc = new TextEncoder();
const b64 = (buf) => Buffer.from(buf).toString('base64');
const salt = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey('raw', enc.encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 100_000 }, key, 256);
const hk = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
const mac = await crypto.subtle.sign('HMAC', hk, bits);
const hash = `pbkdf2$100000$${b64(salt)}$${b64(mac)}`;

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const sql = `UPDATE users SET password_hash = ${q(hash)}, status = 'active', invite_hash = NULL, invite_expires_at = NULL
WHERE email = ${q(email.trim().toLowerCase())};
DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email = ${q(email.trim().toLowerCase())});
SELECT email, name, roles, status FROM users WHERE email = ${q(email.trim().toLowerCase())};
`;

const dir = mkdtempSync(join(tmpdir(), 'ifs-pw-'));
const file = join(dir, 'pw.sql');
writeFileSync(file, sql, 'utf8');
const wranglerBin = fileURLToPath(new URL('../node_modules/wrangler/bin/wrangler.js', import.meta.url));
try {
  const r = spawnSync(process.execPath, [wranglerBin, 'd1', 'execute', 'infocus', remote ? '--remote' : '--local', '--file', file], { stdio: 'inherit' });
  if (r.status !== 0) process.exit(r.status ?? 1);
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\nPassword set for ${email}. They can sign in at /login now.`);
