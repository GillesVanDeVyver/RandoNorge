// Lets a plain `node scripts/verify-*.mjs` import a TypeScript module.
//
// Two harnesses import src/terms/*.ts for real rather than regex-scraping
// them, because the point is to compare against the same values the app
// renders. Node can do that — it strips the types and runs the result — but
// only from 22.18 (and 23.6) without a flag. On 22.6 through 22.17 the same
// capability exists behind --experimental-strip-types, and the failure without
// it is an ERR_UNKNOWN_FILE_EXTENSION thrown at import time: a stack trace
// that looks like a broken harness rather than a Node version to bump.
//
// So: check whether this process can already strip types, and if it cannot,
// re-run the same script once with the flag. Anything older than 22.6 rejects
// the flag and says so, which is the message the reader needs.
//
// Called at the very top of the harness, before any `await import` of a .ts
// file — an import is hoisted, so the guard cannot be a plain statement above
// it in the same module; it belongs in a module the harness imports first.

import { spawnSync } from 'node:child_process';

/**
 * Ensure this process can import TypeScript, re-execing with the flag if not.
 *
 * Never returns in the child-spawning case: it exits with the re-run's status
 * so the harness's own exit code still means what it meant.
 */
export function ensureTypeStripping() {
  // 'strip' or 'transform' when enabled; undefined on Node < 22.10, false when
  // the capability is present but off.
  if (process.features.typescript) return;

  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', ...process.argv.slice(1)],
    { stdio: 'inherit' },
  );

  if (result.error) {
    console.error(
      `could not re-run under --experimental-strip-types: ${result.error.message}\n` +
        `this harness imports TypeScript directly; use Node >= 22.18.`,
    );
    process.exit(1);
  }
  // The child had the flag, so it did not take this branch again.
  process.exit(result.status ?? 1);
}
