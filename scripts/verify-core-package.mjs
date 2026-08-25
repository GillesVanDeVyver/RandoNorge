// Guards the one promise @fjellrute/core makes: it runs anywhere.
//
// WHY A SCRIPT AND NOT JUST tsc. packages/core/tsconfig.json already sets
// `lib: ["ES2023"]` and `types: []`, so a module that names `document` fails to
// compile. That is the primary defence and it is a good one — but it is one
// line in one file, it protects nothing the moment somebody adds "DOM" back to
// fix an unrelated error, and it cannot see through the escape hatch the
// package itself uses in three places:
//
//   (globalThis as { localStorage?: … }).localStorage
//
// That expression type-checks under `types: []` by construction. It has to:
// it is how the browser defaults in the three adapters resolve. Which means the
// exact syntax that makes the adapters work is also the syntax that would let a
// fourth module reach for a browser API and compile clean. So this script reads
// the source as text and asks the question tsc cannot: which files mention a
// platform global at all, and are they the three we decided may?
//
// It also resolves every subpath in the exports map, because that map is
// hand-written — 34 entries with no wildcard, on purpose — and a typo in one of
// them is invisible until an app imports that subpath. The apps import most of
// them, so most typos would surface in `pnpm build`; the ones that would not
// are precisely the entry points nothing uses yet, which is where the phone app
// starts in Phase 2.
//
// Run with:  node scripts/verify-core-package.mjs   (needs Node >= 22)
// Wired into `pnpm test:core`.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { CORE } from './lib/tree.mjs';

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(detail);
  }
};

const pkg = JSON.parse(readFileSync(join(CORE, 'package.json'), 'utf8'));

/** Every .ts/.tsx under packages/core/src, as repo-relative paths. */
function sourceFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...sourceFiles(full));
    else if (/\.tsx?$/.test(entry)) out.push(full);
  }
  return out;
}
const files = sourceFiles(join(CORE, 'src'));

// ---------------------------------------------------------------------------
// 1. No module names a platform global.
//
// The list is the globals that have actually bitten a shared package before,
// split by which platform is missing them: the browser set is absent under
// Hermes and in the Worker, and the Node set is absent in the browser. A module
// here has to survive all four hosts, so neither set is allowed.
//
// Matching is textual, on word boundaries, after comments and string literals
// are stripped — the files are heavily commented and half of them explain in
// prose why they do NOT use `document` or `OffscreenCanvas`, so scanning the
// raw text would fail on the very comments that document the boundary.
// ---------------------------------------------------------------------------
console.log('\n[globals] no module reaches for a platform API');

const FORBIDDEN = [
  // Browser-only.
  'document',
  'window',
  'localStorage',
  'sessionStorage',
  'DOMParser',
  'XMLHttpRequest',
  'OffscreenCanvas',
  'createImageBitmap',
  'HTMLElement',
  'HTMLCanvasElement',
  'Image',
  'Worker',
  'indexedDB',
  'navigator',
  'alert',
  'requestAnimationFrame',
  'IntersectionObserver',
  'matchMedia',
  'location',
  'history',
  'atob',
  'btoa',
  // Node-only. `process` is the one that hides longest, because bundlers
  // define it and so a `process.env.NODE_ENV` read works in the browser right
  // up until it does not.
  'process',
  'Buffer',
  'require',
  '__dirname',
  '__filename',
  'global',
];

/**
 * Blank out comments and string/template literals, preserving offsets so line
 * numbers stay honest. Not a parser — but it only has to be right about where
 * code is not, and TypeScript source that defeats it would have to be strange.
 */
function stripNonCode(src) {
  let out = '';
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') {
        out += ' ';
        i += 1;
      }
      continue;
    }
    if (c === '/' && next === '*') {
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) {
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += '  ';
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      const quote = c;
      out += ' ';
      i += 1;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === '\\') {
          out += '  ';
          i += 2;
          continue;
        }
        out += src[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      out += ' ';
      i += 1;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

// The three adapters, and the reason each is allowed to name what it names.
// This is the exhaustive list from packages/core/README.md; adding a fourth
// entry is a decision about the package's shape, which is why it has to be
// made here rather than by writing the code and finding the gate silent.
const ALLOWED = new Map([
  [
    'src/routes/xml.ts',
    { globals: new Set(['DOMParser']), why: 'the XML parser adapter' },
  ],
  [
    'src/i18n/environment.ts',
    {
      // Not `window`: the store used to guard with `typeof window ===
      // 'undefined'` and the adapter reads localStorage and document off
      // globalThis directly, so the name is gone.
      globals: new Set(['localStorage', 'document']),
      why: 'the locale persistence adapter',
    },
  ],
  [
    'src/elevation/raster.ts',
    {
      globals: new Set(['createImageBitmap', 'OffscreenCanvas']),
      why: 'the raster decode adapter',
    },
  ],
  [
    'src/offline/layers.ts',
    {
      globals: new Set(['location']),
      why: 'the terrain tile URL, same-origin to our own Worker',
    },
  ],
]);

for (const file of files) {
  const rel = relative(CORE, file).split('\\').join('/');
  const code = stripNonCode(readFileSync(file, 'utf8'));
  const allowed = ALLOWED.get(rel)?.globals ?? new Set();
  const found = FORBIDDEN.filter(
    (g) => !allowed.has(g) && new RegExp(`\\b${g}\\b`).test(code),
  );
  const where = found.map((g) => {
    const line =
      code.slice(0, code.search(new RegExp(`\\b${g}\\b`))).split('\n').length;
    return `${g} (line ${line})`;
  });
  check(
    rel,
    found.length === 0,
    found.length === 0
      ? undefined
      : `        names ${where.join(', ')} — this package compiles for the ` +
          'browser, a Cloudflare Worker, Node and Hermes, and at least one of ' +
          'those has no such thing. Either move the module to apps/web, or ' +
          'put the difference behind an adapter like src/routes/xml.ts and ' +
          'add it to ALLOWED in this script.',
  );
}

// The allowances are themselves checked, in both directions: an adapter that
// stops needing its global should lose the exemption rather than keep a
// standing licence, and a name in ALLOWED that matches nothing is either a
// typo or a file that was deleted, in which case the entry protects nothing
// while looking like it protects something.
console.log('\n[allowances] every exemption is still earned');
for (const [rel, { globals, why }] of ALLOWED) {
  const file = join(CORE, rel);
  let code;
  try {
    code = stripNonCode(readFileSync(file, 'utf8'));
  } catch {
    check(`${rel} exists`, false, `        ALLOWED names a file that is gone`);
    continue;
  }
  const unused = [...globals].filter((g) => !new RegExp(`\\b${g}\\b`).test(code));
  check(
    `${rel} — ${why}`,
    unused.length === 0,
    `        is exempted for ${unused.join(', ')} but no longer uses it; ` +
      'drop it from ALLOWED so the next addition is not waved through',
  );
}

// ---------------------------------------------------------------------------
// 2. The exports map is honest.
//
// Every subpath resolves to a file that exists, no subpath is a wildcard, and
// — the direction that actually rots — every module under src/ is either
// exported or imported by one that is. A file reachable through neither is
// dead code that still type-checks, and the reason to catch it here is that
// the extraction moved 31 files at once: a module left behind by a rewrite
// looks exactly like a module that is simply not exported yet.
// ---------------------------------------------------------------------------
console.log('\n[exports] every subpath resolves and every module is reachable');

const entries = Object.entries(pkg.exports ?? {});
check('the exports map is not empty', entries.length > 0);
check(
  'no subpath is a wildcard',
  entries.every(([sub, target]) => !sub.includes('*') && !target.includes('*')),
  '        a `./*` entry publishes every internal file, including the private ' +
    'halves of the adapters, so a component could reach past an entry point',
);

const exported = new Set();
for (const [sub, target] of entries) {
  let ok = false;
  try {
    ok = statSync(join(CORE, target)).isFile();
  } catch {
    ok = false;
  }
  check(`${sub} -> ${target}`, ok, `        no such file`);
  if (ok) exported.add(relative(CORE, join(CORE, target)).split('\\').join('/'));
}

// Follow relative imports from the exported entry points to find everything
// genuinely reachable. The specifiers here are written with explicit .ts
// extensions or without any, both of which appear in the package.
function resolveImport(fromRel, spec) {
  const base = join(CORE, fromRel, '..', spec);
  const candidates = [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, 'index.ts'),
    join(base, 'index.tsx'),
  ];
  for (const c of candidates) {
    try {
      if (statSync(c).isFile()) {
        return relative(CORE, c).split('\\').join('/');
      }
    } catch {
      /* try the next shape */
    }
  }
  return null;
}

const reachable = new Set(exported);
const queue = [...exported];
const unresolved = [];
while (queue.length) {
  const rel = queue.pop();
  const code = stripNonCode(readFileSync(join(CORE, rel), 'utf8'));
  // Comments and strings are blanked above, which also blanks the specifier —
  // so the specifiers are read from the raw text instead, and the stripped
  // copy is only used to check the line is really an import.
  const raw = readFileSync(join(CORE, rel), 'utf8');
  const codeLines = new Set(
    code
      .split('\n')
      .map((l, n) => (/\b(?:import|export)\b/.test(l) ? n : -1))
      .filter((n) => n >= 0),
  );
  raw.split('\n').forEach((line, n) => {
    if (!codeLines.has(n)) return;
    const m = /from\s+'(\.[^']+)'/.exec(line);
    if (!m) return;
    const target = resolveImport(rel, m[1]);
    if (!target) {
      unresolved.push(`${rel}:${n + 1} -> ${m[1]}`);
      return;
    }
    if (!reachable.has(target)) {
      reachable.add(target);
      queue.push(target);
    }
  });
}

check(
  'every relative import inside the package resolves',
  unresolved.length === 0,
  `        ${unresolved.join('\n        ')}`,
);

const orphans = files
  .map((f) => relative(CORE, f).split('\\').join('/'))
  // globals.d.ts is ambient: nothing imports it and everything depends on it.
  .filter((rel) => !rel.endsWith('.d.ts'))
  .filter((rel) => !reachable.has(rel));
check(
  `all ${files.length - 1} modules are reachable from an entry point`,
  orphans.length === 0,
  `        unreachable: ${orphans.join(', ')}\n` +
    '        either export it in package.json or delete it — a module that no ' +
    'entry point reaches is compiled, type-checked and never run',
);

// ---------------------------------------------------------------------------
// 3. The tsconfig that makes check 1 mostly unnecessary is still in place.
//
// Checked last because it is the cheap one, and checked at all because every
// other assertion in this file is a second line of defence: if `lib` grows a
// "DOM" one day, the textual scan above is all that is left.
// ---------------------------------------------------------------------------
console.log('\n[tsconfig] the compiler still refuses the platform');

const tsconfig = readFileSync(join(CORE, 'tsconfig.json'), 'utf8');
// Comments are legal in tsconfig and this one has plenty, so read the two
// settings that matter with a regex rather than JSON.parse.
const lib = /"lib"\s*:\s*\[([^\]]*)\]/.exec(tsconfig)?.[1] ?? '';
const types = /"types"\s*:\s*\[([^\]]*)\]/.exec(tsconfig)?.[1] ?? 'MISSING';
check(
  'lib excludes DOM',
  !/dom/i.test(lib) && lib.trim().length > 0,
  `        "lib": [${lib}] — adding DOM back makes every browser global ` +
    'declared again, and the next platform dependency compiles silently',
);
check(
  'types is empty',
  types.trim().length === 0,
  `        "types": [${types}] — an empty array is what stops @types/node ` +
    'from declaring `process` and `Buffer` here',
);

// ---------------------------------------------------------------------------
// 4. The package declares the types it needs to check itself.
//
// `types: []` above stops @types/* from being included AUTOMATICALLY; it does
// nothing about a type reached by an ordinary `import from 'react'`, which the
// hooks here do. That type has to be resolvable from this directory, and for a
// long time it was resolvable only by accident — pnpm had hoisted a copy where
// the compiler's node_modules/@types walk happened to find it. An install that
// placed @types/react under apps/web and apps/mobile only turned `pnpm build`
// into 24 TS7016/TS7006 errors inside files nobody had edited, which is a bad
// way to learn that a manifest was incomplete.
//
// This asserts the declaration rather than the resolution, deliberately. The
// build already fails when resolution breaks; what it cannot tell you is that
// the cause is a missing line in package.json, three directories away from the
// errors it prints.
// ---------------------------------------------------------------------------
console.log('\n[manifest] the package asks for the types it needs');

const declared = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
// Anything imported by name from a hook here and typed by a separate @types
// package. Derived from the source rather than hard-coded to 'react', so a
// second such import is covered without editing this list.
const typeImports = new Set();
for (const file of files) {
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/\bfrom\s+'(react)'/g)) typeImports.add(m[1]);
}
check(
  'every bare import that needs an @types package has one declared',
  [...typeImports].every((name) => `@types/${name}` in declared),
  `        imports ${[...typeImports].join(', ') || '(none)'} but declares ` +
    `${Object.keys(declared).join(', ') || 'nothing'} — without @types/<name> ` +
    'in this package.json the build depends on where pnpm happened to hoist it',
);

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — @fjellrute/core is still platform-free'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
