// Guards the one thing about the privacy policy that no type checker can:
// that its two copies still say the same thing.
//
// src/terms/privacy.ts is canonical — it is what the acceptance gate shows
// and what the user actually agrees to. public/privacy.html is a static
// mirror, needed because the Google OAuth consent screen demands a plain
// public URL. Both files carry a comment telling the next person to update
// the other one, which is exactly the kind of instruction that gets missed:
// nothing breaks, the build stays green, and the policy the user accepted
// quietly stops matching the policy Google links to.
//
// So: extract the text of every section from both files, normalise away the
// markup and line wrapping, and require an exact match per section and per
// language. Also require the date in the mirror to equal PRIVACY_VERSION.
//
// Run with:  node scripts/verify-privacy-sync.mjs   (needs Node >= 22)
// Wired into `pnpm test:privacy`.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ensureTypeStripping } from './lib/type-stripping.mjs';

// Before the `await import(tsPath)` below. See the helper.
ensureTypeStripping();

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsPath = join(root, 'src/terms/privacy.ts');
const htmlPath = join(root, 'public/privacy.html');

/** Collapse every run of whitespace so line wrapping cannot cause a diff. */
function normalise(text) {
  return text.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// The canonical source.
//
// Imported for real rather than regex-scraped, so that the comparison is
// against the same object the app renders. Node strips the TypeScript types;
// the file's only import is `import type`, which erasure removes entirely.
// ---------------------------------------------------------------------------
const { PRIVACY, PRIVACY_VERSION } = await import(tsPath);

function sectionsFromTs(lang) {
  const out = new Map();
  for (const { heading, body } of PRIVACY[lang].sections) {
    out.set(normalise(heading), normalise(body.join(' ')));
  }
  return { intro: normalise(PRIVACY[lang].intro), sections: out };
}

// ---------------------------------------------------------------------------
// The static mirror.
// ---------------------------------------------------------------------------
const html = readFileSync(htmlPath, 'utf8');

/** Inner text of an HTML fragment: drop tags, decode the few entities used. */
function textOf(fragment) {
  return normalise(
    fragment
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'"),
  );
}

/**
 * Split the mirror into its two language halves at the second <h1>, then
 * into sections at each <h2>. Paragraphs within a section are joined with a
 * single space, matching how the canonical body array is joined above.
 */
function sectionsFromHtml(source = html) {
  const body = source.slice(source.indexOf('<body>'), source.indexOf('</body>'));
  const halves = body.split(/<hr\s*\/?>/);
  if (halves.length !== 2) {
    throw new Error(`expected exactly one <hr> splitting the two languages, ` +
      `found ${halves.length - 1}`);
  }
  const parse = (half) => {
    const sections = new Map();
    // Everything before the first <h2> is the title, the updated line and
    // the intro paragraph.
    const firstH2 = half.indexOf('<h2');
    const head = half.slice(0, firstH2 === -1 ? half.length : firstH2);
    const headParas = [...head.matchAll(/<p(?![^>]*class="updated")[^>]*>([\s\S]*?)<\/p>/g)];
    const updated = /<p class="updated">([\s\S]*?)<\/p>/.exec(head);
    const chunks = half.slice(firstH2).split(/<h2[^>]*>/).slice(1);
    for (const chunk of chunks) {
      const end = chunk.indexOf('</h2>');
      const heading = textOf(chunk.slice(0, end));
      const paras = [...chunk.slice(end).matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)];
      sections.set(heading, normalise(paras.map((m) => textOf(m[1])).join(' ')));
    }
    return {
      intro: normalise(headParas.map((m) => textOf(m[1])).join(' ')),
      updated: updated ? textOf(updated[1]) : '',
      sections,
    };
  };
  return { en: parse(halves[0]), no: parse(halves[1]) };
}

// ---------------------------------------------------------------------------
// Compare.
// ---------------------------------------------------------------------------
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

/** Show where two long strings first diverge, rather than dumping both. */
function firstDiff(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
  const at = Math.max(0, i - 60);
  return (
    `          diverges at character ${i}:\n` +
    `          canonical: …${a.slice(at, i + 60)}\n` +
    `          mirror:    …${b.slice(at, i + 60)}`
  );
}

const mirror = sectionsFromHtml();

for (const lang of ['en', 'no']) {
  console.log(`\n[${lang}] canonical src/terms/privacy.ts vs public/privacy.html`);
  const source = sectionsFromTs(lang);
  const copy = mirror[lang];

  check(
    'intro paragraph matches',
    source.intro === copy.intro,
    source.intro === copy.intro ? '' : firstDiff(source.intro, copy.intro),
  );

  const sourceHeadings = [...source.sections.keys()];
  const copyHeadings = [...copy.sections.keys()];
  check(
    `same sections, same order (${sourceHeadings.length})`,
    JSON.stringify(sourceHeadings) === JSON.stringify(copyHeadings),
    `          canonical: ${JSON.stringify(sourceHeadings)}\n` +
      `          mirror:    ${JSON.stringify(copyHeadings)}`,
  );

  for (const [heading, text] of source.sections) {
    const mirrored = copy.sections.get(heading);
    if (mirrored === undefined) {
      check(`§ ${heading} present in mirror`, false);
      continue;
    }
    check(
      `§ ${heading} text matches`,
      text === mirrored,
      text === mirrored ? '' : firstDiff(text, mirrored),
    );
  }

  check(
    `mirror's "last updated" carries PRIVACY_VERSION (${PRIVACY_VERSION})`,
    copy.updated.includes(PRIVACY_VERSION),
    `          mirror says: ${copy.updated}`,
  );
}

// ---------------------------------------------------------------------------
// Negative control. Everything above passing is only meaningful if this file
// would have failed on real drift — a broken extractor returning empty text
// on both sides would otherwise report a clean run. So: edit the mirror in
// memory, the way a careless hand-edit would, and require detection.
// ---------------------------------------------------------------------------
console.log('\n[control] the extractor detects drift planted in the mirror');
{
  // A word silently added to a sentence — the realistic failure mode.
  //
  // The plant is derived from §1's own text rather than quoted from it. A
  // hardcoded quote rots the moment that section is reworded, and then this
  // control fails for a reason that has nothing to do with drift: it did
  // exactly that on 2026-08-08, when §1 was rewritten to name the controller
  // and the old quote ("Fjellrute is the data controller") stopped existing.
  // A control that cries wolf about itself is one nobody reads, and this one
  // is the only thing standing behind every PASS above.
  const heading = '1. Who is responsible';
  const canonical = sectionsFromTs('en').sections.get(heading);
  // First word of the section, taken from the canonical text so it is
  // guaranteed to appear in a faithful mirror, and injected a second time.
  // Planted *after* the §1 heading, because that word ("Fjellrute") also
  // occurs in the title and the intro, and a plant landing there would leave
  // §1 itself identical — the control would then fail while reporting
  // nothing useful.
  const at = html.indexOf(`<h2>${heading}</h2>`);
  const firstWord = canonical.split(' ')[0];
  const wordPlanted =
    at === -1
      ? html // heading missing: leave html untouched so the check below fails
      : html.slice(0, at) +
        html.slice(at).replace(firstWord, `${firstWord} possibly`);
  check(
    'a changed word is caught',
    wordPlanted !== html &&
      sectionsFromHtml(wordPlanted).en.sections.get(heading) !== canonical,
  );

  // A whole paragraph dropped — what happens when one file gets updated and
  // the other does not, which is the case this script exists for.
  const paraDropped = html.replace(
    /<p>\s*Separately, our server writes[\s\S]*?<\/p>/,
    '',
  );
  check(
    'a dropped paragraph is caught',
    paraDropped !== html &&
      sectionsFromHtml(paraDropped).en.sections.get('5. How long we keep it') !==
        sectionsFromTs('en').sections.get('5. How long we keep it'),
  );

  // A stale version date in the mirror.
  const staleDate = html.replace(PRIVACY_VERSION, '1999-01-01');
  check(
    'a stale "last updated" date is caught',
    staleDate !== html &&
      !sectionsFromHtml(staleDate).en.updated.includes(PRIVACY_VERSION),
  );

  // And the extractor is finding real content, not empty strings.
  const parsed = sectionsFromHtml().en;
  check(
    `extractor found 8 sections and a non-empty intro`,
    parsed.sections.size === 8 && parsed.intro.length > 100,
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — the two copies agree'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
