// Guards public/coming-soon.html against the four things Google's OAuth
// verification rejected it for.
//
// Google reviews the "application home page" declared on the consent screen,
// which for us is the site root (worker/index.js serves coming-soon.html for
// "/"). The review failed on: the app name not matching the consent screen,
// the page not explaining the app's purpose, and the page appearing to be
// behind a login. None of that is expressible as a type, and all of it is easy
// to undo by accident — a redesign that moves the copy into JavaScript, a
// tidy-up that turns the <h1> back into a slogan, or a broken privacy link.
// The cost of finding out is a rejected re-review weeks later, so it is worth
// a test.
//
// The app name is not hard-coded here: it is read out of the consent-screen
// table in docs/AUTH_SETUP.md, which is where the value that Google actually
// compares against is recorded. Change the name on the consent screen, update
// that table, and this script tells you the page has to change too.
//
// Run with:  node scripts/verify-landing-page.mjs   (needs Node >= 22)
// Wired into `pnpm test:landing`.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pagePath = join(root, 'public/coming-soon.html');
const authDocPath = join(root, 'docs/AUTH_SETUP.md');
const workerPath = join(root, 'worker/index.js');

const page = readFileSync(pagePath, 'utf8');
const authDoc = readFileSync(authDocPath, 'utf8');
const worker = readFileSync(workerPath, 'utf8');

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label}`);
    if (detail) console.log(`        ${detail}`);
  }
};

const normalise = (t) => t.replace(/\s+/g, ' ').trim();
const stripTags = (t) => normalise(t.replace(/<[^>]+>/g, ''));

/**
 * The page as a reviewer, a crawler, or a browser with JavaScript disabled
 * receives it: <script>, <style> and HTML comments removed. Anything that only
 * exists after the script runs must not be required to pass a check.
 *
 * <style> has to go for two reasons found the hard way. A CSS comment
 * mentioning an element — `/* the app name, as an h1 … *\/` — is not an HTML
 * comment, so it survives comment-stripping and its angle brackets are then
 * parsed as real markup, swallowing everything up to the next closing tag.
 * And a stylesheet this long is thousands of characters that would let the
 * "is there real prose here" check pass on CSS alone.
 */
function withoutScripts(source = page) {
  return source
    .replace(/<script[\s\S]*?<\/script>/g, '')
    .replace(/<style[\s\S]*?<\/style>/g, '')
    .replace(/<!--[\s\S]*?-->/g, '');
}

const static_ = withoutScripts();

/**
 * The visible prose of a script-free page, with line wrapping collapsed.
 *
 * Phrase checks must use this rather than the raw HTML: the source is wrapped
 * at 80 columns, so "not a safety device" is split across two lines and a
 * plain substring search for it silently finds nothing — a false pass waiting
 * to happen the moment a marker phrase lands on a line break.
 */
function proseOf(source = static_) {
  const body = source.slice(source.indexOf('<body>'), source.indexOf('</body>'));
  return stripTags(body)
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

const prose = proseOf();

// ---------------------------------------------------------------------------
// 1. The app name, matching the consent screen.
//
// Google: "The app name 'Fjellrute' on your OAuth consent screen does not
// match the app name on your home page."
// ---------------------------------------------------------------------------
console.log('\n[name] the app name on the page matches the consent screen');

// | App name | Fjellrute | _____ |
// Leading whitespace allowed: the table is indented inside a numbered list.
const nameRow = /^\s*\|\s*App name\s*\|\s*([^|]+?)\s*\|/m.exec(authDoc);
const expectedName = nameRow ? nameRow[1] : null;
check(
  'docs/AUTH_SETUP.md records the consent-screen app name',
  expectedName !== null && expectedName.length > 0,
  'expected a table row "| App name | <name> |" in the consent-screen section',
);

const h1s = [...static_.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
  stripTags(m[1]),
);
check(
  `exactly one <h1> in the static HTML (found ${h1s.length})`,
  h1s.length === 1,
  `<h1> texts: ${JSON.stringify(h1s)}`,
);
if (expectedName) {
  check(
    `the <h1> reads exactly "${expectedName}"`,
    h1s.length === 1 && h1s[0] === expectedName,
    `<h1> reads: ${JSON.stringify(h1s[0] ?? null)}`,
  );
}

// ---------------------------------------------------------------------------
// 2. The page explains what the app is — without JavaScript.
//
// Google: "Your home page does not explain the purpose of your app." The two
// failure modes worth catching are the section being deleted and the copy
// being moved into the script, so both languages are checked against the
// script-free HTML.
// ---------------------------------------------------------------------------
console.log('\n[purpose] the explanation is present in the served HTML');

check(
  'an explanation section with id="about" exists',
  /id="about"/.test(static_),
);

// Phrases specific enough that they cannot survive the section being gutted,
// but not so specific that ordinary rewording trips them.
const purposeMarkers = {
  nb: ['turplanlegger', 'topptur', 'bratthet', 'skredvarsel'],
  en: ['tour planner', 'backcountry', 'steepness', 'avalanche'],
};
const lowerProse = prose.toLowerCase();
for (const [lang, markers] of Object.entries(purposeMarkers)) {
  const missing = markers.filter((m) => !lowerProse.includes(m.toLowerCase()));
  check(
    `[${lang}] the purpose is described (${markers.length} marker phrases)`,
    missing.length === 0,
    `missing from the static HTML: ${JSON.stringify(missing)}`,
  );
}

// The limits of the service, stated before sign-up rather than only inside the
// acceptance gate. Kept in step with §1 of the terms (src/terms/content.ts).
check(
  'the "not a safety device" limitation is stated in both languages',
  /ikke sikkerhetsutstyr/.test(prose) && /not a safety device/.test(prose),
);

// Enough prose to be an explanation at all. A page that technically contains
// the marker words inside a single sentence would pass everything above.
check(
  `the static body carries real prose (${prose.length} characters)`,
  prose.length > 1500,
  'the explanation looks too short to satisfy a human reviewer',
);

// ---------------------------------------------------------------------------
// 2b. The page says what the app does with *Google user data*.
//
// Google's verification guidance asks the home page for two things, and the
// second is easy to miss because the first is so prominent: what the app does,
// *and* what it does with the Google user data it requests. An earlier version
// of this page mentioned "Continue with Google" and stopped there — a purpose
// statement about the app that says nothing about the data. The Accounts /
// Konto sections now name the scopes in prose, and this check exists because
// that paragraph reads like marketing copy and is the obvious thing for a
// future tidy-up to cut.
// ---------------------------------------------------------------------------
console.log('\n[google-data] the page says what Google data is used for, and why');

// Each entry: the fact that has to be stated, and phrases proving it is.
const googleDataMarkers = {
  nb: {
    'the sign-in method is named': ['fortsett med google'],
    'the fields received are named': ['navnet og e-postadressen'],
    'the purpose is stated': ['identifisere kontoen'],
    'the scopes not requested are named': ['gmail'],
    'non-use for advertising is stated': ['annonser'],
  },
  en: {
    'the sign-in method is named': ['continue with google'],
    'the fields received are named': ['name and email address'],
    'the purpose is stated': ['identify your account'],
    'the scopes not requested are named': ['gmail'],
    'non-use for advertising is stated': ['advertising'],
  },
};
for (const [lang, facts] of Object.entries(googleDataMarkers)) {
  for (const [fact, phrases] of Object.entries(facts)) {
    check(
      `[${lang}] ${fact}`,
      phrases.some((p) => lowerProse.includes(p)),
      `none of ${JSON.stringify(phrases)} in the static HTML`,
    );
  }
}

// ---------------------------------------------------------------------------
// 2c. The page reads as a product that exists.
//
// Not a written rule, unlike everything else here, but it is the spirit of the
// check Google failed the page on: an OAuth reviewer is deciding whether there
// is a real application behind the consent screen. This page led with a
// "Coming soon" badge and a Status section beginning "Fjellrute is in closed
// alpha" while the app was in fact running and in daily use by invited
// testers — an accurate description of the *rollout* that reads as a
// placeholder for a product that has not been built.
//
// The wording may of course change. What must not come back is the future
// tense, so the forbidden list is short and specific rather than a judgement
// this script cannot make.
// ---------------------------------------------------------------------------
console.log('\n[product] no placeholder-page wording in the served copy');

const placeholderPhrases = [
  'coming soon',
  'kommer snart',
  'closed alpha',
  'lukket alfa',
  'under construction',
  'under utvikling',
  'work in progress',
];
{
  const found = placeholderPhrases.filter((p) => lowerProse.includes(p));
  check(
    `none of the ${placeholderPhrases.length} placeholder phrases appear`,
    found.length === 0,
    `found in the visible copy: ${JSON.stringify(found)} — accurate about the ` +
      'rollout, but it reads to a reviewer as a page for an app that does not ' +
      'exist yet. Describe the invitation limit instead.',
  );
}
// Comments count. They are invisible to a visitor but they are in the bytes
// served, and the phrases above lived on in three HTML comments for a while
// after the visible copy was fixed — including one that existed only to explain
// the fix. Whether any automated part of Google's review reads comments is
// unknown and not worth finding out: paraphrase instead of quoting the old
// wording. The forbidden phrases are of course listed in this script, which is
// not served.
{
  const rawLower = page.toLowerCase();
  const inComments = placeholderPhrases.filter((p) => rawLower.includes(p));
  check(
    'none of them survive in HTML comments either',
    inComments.length === 0,
    `found in the page source: ${JSON.stringify(inComments)} — describe the ` +
      'old wording rather than quoting it',
  );
}

// The counterpart: having removed the forthcoming-product wording, the page must
// still say somewhere that access is limited, or it over-promises to a member of
// the public who then cannot sign up.
check(
  'the invitation-only limit is still disclosed in both languages',
  /invitasjonsbasert|inviterte/.test(prose) &&
    /invitation-based|invitation only|invited/i.test(prose),
  'softening the alpha wording must not turn into hiding that sign-up is closed',
);

// ---------------------------------------------------------------------------
// 3. Both languages are static, and the script only hides one.
//
// This is what keeps check 2 honest over time. Text injection is the natural
// way to write a bilingual page and it is exactly what must not happen here.
// ---------------------------------------------------------------------------
console.log('\n[static] the language switch hides rather than injects');

check(
  'no data-i18n placeholders remain (the injection pattern)',
  !/data-i18n/.test(page),
  'data-i18n means copy is filled in by JavaScript, so a crawler sees an empty element',
);

const langBlocks = [...page.matchAll(/data-lang-block="([^"]+)"/g)].map(
  (m) => m[1],
);
const nb = langBlocks.filter((l) => l === 'nb').length;
const en = langBlocks.filter((l) => l === 'en').length;
check(
  `every Norwegian block has an English counterpart (${nb} nb, ${en} en)`,
  nb > 0 && nb === en,
);
check(
  'data-lang-block only ever says nb or en',
  langBlocks.every((l) => l === 'nb' || l === 'en'),
  `found: ${JSON.stringify([...new Set(langBlocks)])}`,
);
check(
  'the script hides blocks by setting .hidden',
  /\.hidden\s*=\s*true/.test(page),
);
// Without this rule the UA's [hidden] loses to any class-based `display`, and
// a visitor sees both languages stacked.
check(
  'CSS forces hidden blocks to display:none !important',
  /\[data-lang-block\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(
    page,
  ),
);

// ---------------------------------------------------------------------------
// 4. Nothing is behind a login, and every link resolves.
//
// Google: "Your home page is behind a login page." The Worker must answer the
// bare root with this file and no session check; and the privacy-policy link
// the consent screen depends on must actually exist.
// ---------------------------------------------------------------------------
console.log('\n[reachable] the root serves this page, and links resolve');

check(
  'worker/index.js serves coming-soon.html for the exact path "/"',
  /pathname === '\/'/.test(worker) && /coming-soon\.html/.test(worker),
);
// The intercept must come before anything that touches authentication, so a
// signed-out visitor (and a reviewer) reaches the page unconditionally. Any
// auth call ahead of it — or any `session`/`user` test inside the branch — is
// how a home page ends up "behind a login page".
{
  const rootAt = worker.indexOf("pathname === '/'");
  const authAt = [...worker.matchAll(/getAuth\(|getSession\(/g)].map(
    (m) => m.index,
  );
  const earliestAuth = authAt.length ? Math.min(...authAt) : Infinity;
  check(
    'no authentication call precedes the root intercept',
    rootAt !== -1 && rootAt < earliestAuth,
    `root intercept at ${rootAt}, earliest auth call at ${earliestAuth}`,
  );
  // The branch itself: assets fetch and a 200, nothing conditional on a user.
  const branch = worker.slice(rootAt, worker.indexOf('\n    }', rootAt));
  check(
    'the root branch itself does not consult a session',
    !/session|getAuth|cookie/i.test(branch),
    `branch reads: ${normalise(branch).slice(0, 160)}…`,
  );
}
check(
  'the page links to the privacy policy',
  /href="\/privacy\.html"/.test(static_),
);

// Every same-origin link and asset must exist in public/. This is the check
// that would have caught the consent screen's terms-of-service URL: there is
// no public/terms.html, so any /terms… link here would 404 for a reviewer.
const refs = new Set();
for (const m of page.matchAll(/(?:href|src)="(\/[^"#?]*)"/g)) refs.add(m[1]);
for (const m of page.matchAll(/'(\/[\w./-]+\.(?:jpg|png|svg|html|css|js))'/g))
  refs.add(m[1]);
const dangling = [...refs].filter(
  (r) => !existsSync(join(root, 'public', r.replace(/^\//, ''))),
);
check(
  `all ${refs.size} same-origin references exist in public/`,
  dangling.length === 0,
  `missing: ${JSON.stringify(dangling)}`,
);

// A <title> and description, since the reviewer's first impression is the tab.
check(
  'the <title> names the app',
  expectedName === null ||
    new RegExp(expectedName).test(/<title>([\s\S]*?)<\/title>/.exec(page)?.[1] ?? ''),
);
check(
  'a meta description explains the app',
  /<meta\s+name="description"\s+content="[^"]{80,}"/.test(page),
);

// ---------------------------------------------------------------------------
// Negative controls. Every check above passing means nothing unless these
// prove the checks can fail — a regex that never matches anything reports a
// clean run just as loudly.
// ---------------------------------------------------------------------------
console.log('\n[control] the checks detect the regressions they exist for');
{
  // The <h1> demoted back to a slogan, which is how the page failed review.
  const renamed = page.replace(
    /<h1 class="appName">Fjellrute<\/h1>/,
    '<h1 class="appName">Les fjellet.</h1>',
  );
  check(
    'a renamed <h1> is caught',
    renamed !== page &&
      [...withoutScripts(renamed).matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map(
        (m) => stripTags(m[1]),
      )[0] !== expectedName,
  );

  // The explanation moved into the script — passes a browser check, fails a
  // crawler, and is the reason check 2 runs against script-free HTML.
  const gutted = page.replace(/<main class="about"[\s\S]*?<\/main>/, '');
  check(
    'a deleted explanation section is caught',
    gutted !== page && !/id="about"/.test(withoutScripts(gutted)),
  );

  // A privacy link pointing at a file that does not exist, the /terms.html
  // mistake one directory over.
  const brokenLink = page.replace(/href="\/privacy\.html"/g, 'href="/terms.html"');
  const brokenRefs = new Set();
  for (const m of brokenLink.matchAll(/(?:href|src)="(\/[^"#?]*)"/g))
    brokenRefs.add(m[1]);
  check(
    'a link to a non-existent page is caught',
    brokenLink !== page &&
      [...brokenRefs].some(
        (r) => !existsSync(join(root, 'public', r.replace(/^\//, ''))),
      ),
  );

  // And the stripper is returning the page's content, not nothing — and not
  // the stylesheet, which would let the prose check pass on CSS.
  check(
    'the script-free extract kept the content and lost script + style',
    prose.length > 1500 &&
      !/navigator\.language/.test(static_) &&
      !/backdrop-filter/.test(static_),
  );

  // The Google-data paragraph cut as redundant — the page still explains the
  // app perfectly well, which is what makes this the plausible mistake.
  //
  // The two paragraphs are found by the fact they exist to state rather than by
  // their opening words. The first version of this control matched the
  // Norwegian paragraph's first clause, and the clause was then reworded for
  // style — at which point the control was mutating nothing and asserting that
  // nothing had changed. It failed rather than passing silently, but only
  // because a control has to check that its own mutation happened; without that
  // `!== page`, a negative control quietly stops testing anything.
  const cutParagraphContaining = (src, marker) =>
    src.replace(
      new RegExp(`\\s*<p>(?:(?!</p>)[\\s\\S])*?${marker}[\\s\\S]*?</p>`),
      '',
    );
  let noGoogleData = cutParagraphContaining(page, 'e-postadressen din fra Google');
  noGoogleData = cutParagraphContaining(noGoogleData, 'name and email address');
  const withoutGoogleDataProse = proseOf(withoutScripts(noGoogleData))
    .toLowerCase();
  check(
    'a removed Google-data disclosure is caught',
    noGoogleData !== page &&
      !withoutGoogleDataProse.includes('navnet og e-postadressen') &&
      !withoutGoogleDataProse.includes('name and email address'),
    `mutation removed ${page.length - noGoogleData.length} characters`,
  );

  // The badge reverted to "Coming soon", the single loudest placeholder signal
  // on the page and the one most likely to be restored by someone who reads it
  // as a plain statement of fact.
  const comingSoon = page.replace(/>Tidlig tilgang</, '>Kommer snart<');
  const comingSoonProse = proseOf(withoutScripts(comingSoon)).toLowerCase();
  check(
    'restored "coming soon" wording is caught',
    comingSoon !== page &&
      placeholderPhrases.some((p) => comingSoonProse.includes(p)),
  );

  // And the opposite failure: the invitation limit dropped along with the
  // alpha wording, leaving a page that reads as generally available.
  const overPromising = page
    .replace(/invitasjonsbasert/g, 'åpen')
    .replace(/invitation-based/g, 'open');
  const overPromisingProse = proseOf(withoutScripts(overPromising));
  check(
    'a page that stops disclosing the invitation limit is caught',
    overPromising !== page &&
      !(
        /invitasjonsbasert/.test(overPromisingProse) &&
        /invitation-based/i.test(overPromisingProse)
      ),
  );
}

console.log(
  failures === 0
    ? '\nALL CHECKS PASSED — the landing page still meets the OAuth requirements'
    : `\n${failures} CHECK(S) FAILED`,
);
process.exit(failures === 0 ? 0 : 1);
