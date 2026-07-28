// Executes the REAL account-deletion code path against a scratch SQLite
// database. Unlike scripts/verify-deletion-sql.py (which replays the SQL from
// the runbook), this imports deleteAccountRows() from worker/account.js, so
// the statements that ship are the statements under test — if someone adds a
// table holding personal data and forgets to delete it, the leak assertion
// here fails.
//
//     node scripts/verify-account-deletion.mjs
//
// D1 is SQLite with a promise-flavoured wrapper, so a ~20-line shim over
// node:sqlite is enough to run the Worker code unmodified.

import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { deleteAccountRows } from '../worker/account.js';
import { hashPassword, verifyPassword } from '../worker/password.js';

const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const failures = [];

function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${label}: got ${JSON.stringify(got)}`);
  if (!ok) failures.push(`${label} (wanted ${JSON.stringify(want)})`);
}

// --- minimal D1 shim over node:sqlite --------------------------------------
class Stmt {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.params = [];
  }
  bind(...params) {
    this.params = params;
    return this;
  }
  /**
   * The values in the shape node:sqlite wants for this statement.
   *
   * D1 accepts `?` and `?1` alike, and the shipped statements use `?1` where
   * one value is needed twice (the verification-token delete matches both the
   * bare address and the "reset-password:" prefixed form). node:sqlite treats
   * `?1` as a *named* parameter, so passing positional arguments for it fails
   * with "column index out of range" — an error that reads like a bug in the
   * Worker rather than a difference between two SQLite bindings. Numbered
   * statements therefore get an object keyed by position instead.
   *
   * Node >= 24 binds `?1` positionally too, so this only has to be right, not
   * permanent.
   */
  get #values() {
    if (!/\?\d/.test(this.sql)) return this.params;
    return [Object.fromEntries(this.params.map((v, i) => [String(i + 1), v]))];
  }
  async first() {
    return this.db.prepare(this.sql).get(...this.#values) ?? null;
  }
  async run() {
    const r = this.db.prepare(this.sql).run(...this.#values);
    return { meta: { changes: Number(r.changes) } };
  }
}

function d1(db) {
  return {
    prepare: (sql) => new Stmt(db, sql),
    batch: async (stmts) => Promise.all(stmts.map((s) => s.run())),
  };
}

// --- schema from the real migrations ---------------------------------------
const db = new DatabaseSync(':memory:');
db.exec('PRAGMA foreign_keys = ON');
const migrationsDir = join(REPO, 'migrations');
const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
for (const f of files) db.exec(readFileSync(join(migrationsDir, f), 'utf8'));
console.log(`schema applied from ${files.length} migrations\n`);

const env = { DB: d1(db) };
const ISO = '2027-01-15T12:00:00.000Z';

// Two accounts. The victim's address contains the other's as a substring
// ("one@example.com" inside "someone@example.com") — the exact trap that a
// naive like '%email%' falls into.
const TARGET = { id: 'u1', email: 'Someone@Example.com', username: 'someone' };
const OTHER = { id: 'u2', email: 'one@example.com', username: 'other' };

const password = 'correct horse battery staple';
const storedHash = await hashPassword(password);

for (const u of [TARGET, OTHER]) {
  db.prepare(
    'insert into "user" (id,name,email,emailVerified,createdAt,updatedAt,username)' +
      ' values (?,?,?,1,?,?,?)',
  ).run(u.id, u.username, u.email, ISO, ISO, u.username);
  db.prepare(
    'insert into "account" (id,accountId,providerId,userId,password,createdAt,updatedAt)' +
      ' values (?,?,?,?,?,?,?)',
  ).run(`cred-${u.id}`, u.email, 'credential', u.id, storedHash, ISO, ISO);
  db.prepare(
    'insert into "account" (id,accountId,providerId,userId,createdAt,updatedAt)' +
      ' values (?,?,?,?,?,?)',
  ).run(`goog-${u.id}`, `google-${u.id}`, 'google', u.id, ISO, ISO);
  db.prepare(
    'insert into "session" (id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId)' +
      ' values (?,?,?,?,?,?,?,?)',
  ).run(`s-${u.id}`, '2099-01-01', `tok-${u.id}`, ISO, ISO, '203.0.113.7', 'FF', u.id);
  db.prepare(
    'insert into "route" (id,userId,name,geometry,isShared,shareSlug,createdAt,updatedAt)' +
      ' values (?,?,?,?,1,?,?,?)',
  ).run(`r-${u.id}`, u.id, 'tur', '{}', `slug-r-${u.id}`, ISO, ISO);
  db.prepare(
    'insert into "track" (id,userId,routeId,name,geometry,startedAt,finishedAt,createdAt,isShared,shareSlug)' +
      ' values (?,?,?,?,?,?,?,?,1,?)',
  ).run(`t-${u.id}`, u.id, `r-${u.id}`, 'opptak', '{}', ISO, ISO, ISO, `slug-t-${u.id}`);
  db.prepare('insert into "invite_redemption" (code,email) values (?,?)').run(
    'ALPHA1',
    u.email,
  );
  for (const ident of [u.email, `reset-password:${u.email}`]) {
    db.prepare(
      'insert into "verification" (id,identifier,value,expiresAt,createdAt,updatedAt)' +
        ' values (?,?,?,?,?,?)',
    ).run(`v-${ident}`, ident, 'x', '2099-01-01', ISO, ISO);
  }
}

// ==========================================================================
console.log('[1] password re-authentication (worker/password.js)');
check('correct password verifies', await verifyPassword({ hash: storedHash, password }), true);
check('wrong password rejected', await verifyPassword({ hash: storedHash, password: 'wrong' }), false);
check('empty password rejected', await verifyPassword({ hash: storedHash, password: '' }), false);
check(
  'garbage hash rejected, not thrown',
  await verifyPassword({ hash: 'not-a-hash', password }),
  false,
);

console.log('\n[2] the credential lookup the endpoint re-authenticates against');
const credential = await env.DB.prepare(
  'select password from "account" ' +
    "where userId = ? and providerId = 'credential' and password is not null",
)
  .bind(TARGET.id)
  .first();
check('finds the credential row, not the Google one', credential?.password === storedHash, true);
const googleOnly = await env.DB.prepare(
  'select password from "account" ' +
    "where userId = ? and providerId = 'credential' and password is not null",
)
  .bind('nobody')
  .first();
check('no credential row → no password guard to apply', googleOnly, null);

// ==========================================================================
console.log('\n[3] deleteAccountRows() — the shipped statements');
const counts = await deleteAccountRows(env, {
  userId: TARGET.id,
  email: TARGET.email,
});
check('reported counts', counts, { tokens: 2, redemptions: 1, users: 1 });

const count = (sql, ...p) => Number(db.prepare(sql).get(...p).n);
check('user row gone', count('select count(*) n from "user" where id = ?', TARGET.id), 0);
check('sessions cascaded', count('select count(*) n from "session" where userId = ?', TARGET.id), 0);
check('accounts cascaded (both providers)', count('select count(*) n from "account" where userId = ?', TARGET.id), 0);
check('routes cascaded', count('select count(*) n from "route" where userId = ?', TARGET.id), 0);
check('tracks cascaded', count('select count(*) n from "track" where userId = ?', TARGET.id), 0);
check(
  'verification tokens gone (bare and reset-password: forms)',
  count(
    'select count(*) n from "verification" where lower(identifier) like ?',
    `%${TARGET.email.toLowerCase()}`,
  ),
  0,
);
check('invite redemption gone', count('select count(*) n from "invite_redemption" where lower(email) = lower(?)', TARGET.email), 0);

// The real assertion: no column of any table still mentions the address.
// Walks the live schema rather than a hardcoded list, so a table added by a
// future migration is covered automatically.
const addr = TARGET.email.toLowerCase();

function findLeaks(needle) {
  const found = [];
  const tables = db
    .prepare("select name from sqlite_master where type='table'")
    .all();
  for (const { name } of tables) {
    if (name.startsWith('sqlite_')) continue;
    for (const col of db.prepare(`pragma table_info("${name}")`).all()) {
      const n = count(
        `select count(*) n from "${name}" where lower(cast("${col.name}" as text)) like ?`,
        `%${needle}%`,
      );
      if (n > 0) found.push(`${name}.${col.name}`);
    }
  }
  return found;
}

check('no column in any table still contains the address', findLeaks(addr), []);

console.log('\n[4] the other account is untouched');
check('other user present', count('select count(*) n from "user" where id = ?', OTHER.id), 1);
check('other sessions kept', count('select count(*) n from "session" where userId = ?', OTHER.id), 1);
check('other accounts kept', count('select count(*) n from "account" where userId = ?', OTHER.id), 2);
check('other routes kept', count('select count(*) n from "route" where userId = ?', OTHER.id), 1);
check('other tracks kept', count('select count(*) n from "track" where userId = ?', OTHER.id), 1);
check('other tokens kept (substring trap)', count('select count(*) n from "verification"'), 2);
check('other redemption kept', count('select count(*) n from "invite_redemption"'), 1);

console.log('\n[5] deleting a non-existent account is a no-op, not an error');
const none = await deleteAccountRows(env, { userId: 'ghost', email: 'ghost@example.com' });
check('nothing deleted', none, { tokens: 0, redemptions: 0, users: 0 });
check('other account still intact', count('select count(*) n from "user"'), 1);

// Negative control: an assertion that cannot fail proves nothing. Plant the
// address in a table deleteAccountRows() does not touch and confirm the scan
// above would have caught it.
console.log('\n[6] negative control — the leak scan actually detects a leak');
db.prepare('insert into "invite_redemption" (code,email) values (?,?)').run(
  'PLANTED',
  TARGET.email,
);
check('planted row is found', findLeaks(addr), ['invite_redemption.email']);
db.prepare("delete from \"invite_redemption\" where code = 'PLANTED'").run();
check('scan clean again after removing it', findLeaks(addr), []);

console.log(
  '\n' + (failures.length ? `${failures.length} FAILED:\n - ${failures.join('\n - ')}` : 'ALL CHECKS PASSED'),
);
process.exit(failures.length ? 1 : 0);
