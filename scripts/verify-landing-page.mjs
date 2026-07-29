// Guards the Google OAuth "application home page" against the four things
// verification rejected it for.
//
// Google reviews the home page declared on the consent screen. That review
// failed on: the app name not matching the consent screen, the page not
// explaining the app's purpose, and the page appearing to be behind a login.
// None of that is expressible as a type, and all of it is easy to undo by
// accident — a redesign that moves the copy into JavaScript, a tidy-up that
// turns the <h1> back into a slogan, or a broken privacy link. The cost of
// finding out is a rejected re-review weeks later, so it is worth a test.
//
// TWO PAGES, ON PURPOSE. Until 2026-07-29 the declared home page was the site
// root, so the root had to carry several hundred words of explanation written
// for a reviewer rather than for a visitor. The audiences were then split:
//
//   public/about.html        the declared home page. All the content Google
//                            requires lives here, and checks 1–4 below are
//                            about this file.
//   public/coming-soon.html  the site root, served by worker/index.js for "/".
//                            Deliberately almost empty — wordmark and a line
//                            saying the product is on its way.
//
// The split is itself a thing that can be broken, and it breaks silently: point
// the consent screen back at "/" and the review fetches a page with nothing on
// it. So the home-page URL recorded in docs/AUTH_SETUP.md is checked against
// the file this script verifies (check 0), and the placeholder-wording check
// that used to cover the root now covers only the home page — the root is
// *supposed* to say the product is coming.
//
// The app name is not hard-coded here either: it is read out of the
// consent-screen table in docs/AUTH_SETUP.md, which is where the value Google
// actually compares against is recorded. Change the name on the consent screen,
// update that table, and this script tells you the page has to change too.
//
// Run with:  node scripts/verify-landing-page.mjs   (needs Node >= 22)
// Wired into `pnpm test:landing`.

import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// The declared OAuth home page — the file that has to satisfy the review.
const homePath = join(root, 'public/about.html');
// The site root. Almost nothing is required of it; see check 5.
const rootPagePath = join(root, 'public/coming-soon.html');
const authDocPath = join(root, 'docs/AUTH_SETUP.md');
const workerPath = join(root, 'worker/index.js');

// `page` throughout the checks below means the OAuth home page, since that is
// what the review reads. The site root is `rootPage`, examined only in check 5.
const page = readFileSync(homePath, 'utf8');
const rootPage = readFileSync(rootPagePath, 'utf8');
const authDoc = readFileSync(authDocPath, 'utf8');
const worker = readFileSync(workerPath, 'utf8');

let failures = 0;
// Warnings are for facts this repository can state but not enforce — the value
// of a field in Google's console being the only one so far. They are reported
// and counted, and deliberately do not affect the exit code.
let warnings = 0;
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
// 0. The consent screen points at the page this script is checking.
//
// Everything below verifies public/about.html. All of it is wasted if the
// "Application home page" field on the consent screen names a different URL,
// and the specific different URL to worry about is the bare site root: that is
// where the field pointed until 2026-07-29, and the root is now a near-empty
// holding page. Reverting the field is a one-click change in a console this
// repo cannot see, so the best available check is the recorded value in
// docs/AUTH_SETUP.md — which is also the thing a future reader will trust.
// ---------------------------------------------------------------------------
console.log('\n[consent-url] the declared home page is the page checked here');

// | Application home page | <should be> | <verified as> |
const homeRow = /^\s*\|\s*Application home page\s*\|([^|]*)\|([^|]*)\|/m.exec(
  authDoc,
);
check(
  'docs/AUTH_SETUP.md records the consent-screen home page URL',
  homeRow !== null,
  'expected a table row "| Application home page | … | … |"',
);
if (homeRow) {
  const [intended, observed] = [homeRow[1], homeRow[2]].map(normalise);

  // The intended value is a fact about this repository, so it is a hard
  // failure: if the home page is supposed to be somewhere other than the file
  // checked below, then this script is verifying the wrong thing.
  check(
    'the intended home page is /about.html',
    /about\.html/.test(intended),
    `"Should be" reads: ${JSON.stringify(intended)} — if the home page really ` +
      'moved, point this script at the new file rather than editing the row',
  );

  // The observed value is a fact about the Google Cloud console, which this
  // repository cannot read or change. Failing on it would mean a red test suite
  // for a reason no code change can fix, so it warns instead — but loudly,
  // because until someone edits that field the review still fetches the old URL.
  //
  // Read the *first backticked URL* in the cell rather than searching the whole
  // cell for "about.html". The prose recording the change necessarily mentions
  // the new path ("…the content moved to `/about.html`"), so a substring search
  // reports the console as updated on the strength of the note saying it is not
  // — which is precisely the false pass this check exists to avoid. The
  // convention the cell must follow: state the observed URL first, in backticks.
  const observedUrl = /`([^`]+)`/.exec(observed)?.[1] ?? '';
  check(
    'the "Verified as" cell opens with the observed URL in backticks',
    observedUrl.length > 0,
    `cell reads: ${JSON.stringify(observed)} — put the URL actually in the ` +
      'console first, in backticks, so it can be told apart from the commentary',
  );
  const stillRoot = !/about\.html$/.test(observedUrl.replace(/\/$/, ''));
  if (stillRoot) {
    console.log('  WARN  the console has not been updated to /about.html yet');
    console.log(
      '        "Verified as" reads: ' +
        JSON.stringify(observed) +
        '\n        Set Application home page to https://fjellrute.no/about.html' +
        '\n        (console → APIs & Services → OAuth consent screen → Branding),' +
        '\n        then record it in the table in docs/AUTH_SETUP.md.',
    );
    warnings += 1;
  } else {
    console.log('  PASS  the console is recorded as pointing at /about.html');
  }
}

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

// No Worker branch may shadow the home page. The root gets one (it has to, to
// beat the SPA fallback); about.html is served straight from ASSETS, and the
// moment it acquires a branch it becomes something that can redirect or gate.
check(
  'no worker/index.js branch intercepts /about.html',
  !/about\.html/.test(worker.replace(/\/\/[^\n]*/g, '')),
  'about.html should be a plain static asset, not a path the Worker handles',
);

// Every same-origin link and asset must exist in public/, on both pages. This
// is the check that would have caught the consent screen's terms-of-service
// URL: there is no public/terms.html, so any /terms… link would 404 for a
// reviewer. The root is included because a dead link there is still a dead link
// on the domain a reviewer was given.
const refs = new Set();
for (const source of [page, rootPage]) {
  for (const m of source.matchAll(/(?:href|src)="(\/[^"#?]*)"/g))
    refs.add(m[1]);
  for (const m of source.matchAll(
    /'(\/[\w./-]+\.(?:jpg|png|svg|html|css|js))'/g,
  ))
    refs.add(m[1]);
}
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
// 5. The site root, which has almost no requirements — and shouldn't grow any.
//
// This section is short by design. The root is the holding page; the reason it
// is checked at all is that it is the page a member of the public actually
// reaches, and there are two ways for the split to rot from this side. It can
// re-acquire the reviewer-facing copy (someone deciding the root looks empty),
// which puts the project back where it started. Or the app name can vanish from
// it, leaving an unattributed photo on the domain the consent screen's
// authorized-domain field names.
// ---------------------------------------------------------------------------
console.log('\n[root] the holding page stays a holding page');

const rootStatic = withoutScripts(rootPage);
const rootProse = proseOf(rootStatic);

// The name, as real text — not only the <title> and not only the logo.
const rootH1s = [...rootStatic.matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)].map((m) =>
  stripTags(m[1]),
);
check(
  `the root names the app in an <h1> (found ${JSON.stringify(rootH1s)})`,
  expectedName === null ||
    (rootH1s.length === 1 && rootH1s[0] === expectedName),
);

// It is allowed to say the product is coming — that is its whole job, and the
// phrase is checked for rather than merely permitted so that a silent
// truncation to a bare logo shows up as a failure.
check(
  'the root says the product is on its way, in both languages',
  /kommer snart/i.test(rootProse) && /coming soon/i.test(rootProse),
  'the holding page should still tell a visitor what it is holding',
);

// And it must NOT grow the reviewer-facing content back. The threshold is
// deliberately loose: the page is a handful of words, so anything approaching
// the old length means the explanation has come back.
check(
  `the root stays short (${rootProse.length} characters of visible text)`,
  rootProse.length < 400,
  'the reviewer-facing explanation belongs in public/about.html; the root is ' +
    'for visitors',
);
check(
  'the root does not restate the product explanation',
  !/turplanlegger|tour planner/i.test(rootProse),
  'this copy exists for the OAuth review and lives in public/about.html',
);

// The bilingual mechanism, same rule as the home page: both strings static,
// script only hides. Cheaper to keep honest than to rediscover.
check(
  'the root ships both languages statically and hides one',
  /data-lang-block="nb"/.test(rootPage) &&
    /data-lang-block="en"/.test(rootPage) &&
    /\.hidden\s*=\s*true/.test(rootPage),
);
check(
  'the root forces hidden blocks to display:none !important',
  /\[data-lang-block\]\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(
    rootPage,
  ),
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

  // The home page's Status section put back into the future tense — now the
  // likeliest version of this mistake, since the root page one directory over
  // says exactly this and copying the line across would feel like consistency.
  const comingSoon = page.replace(/Fjellrute er i drift/, 'Fjellrute kommer snart');
  const comingSoonProse = proseOf(withoutScripts(comingSoon)).toLowerCase();
  check(
    'forthcoming-product wording on the home page is caught',
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

  // The consent screen repointed at the bare root — the failure this whole
  // two-page arrangement exists to prevent, and the one no amount of checking
  // the HTML would catch on its own.
  const revertedUrl = authDoc.replace(
    /(\|\s*Application home page\s*\|)[^|]*\|[^|]*\|/,
    '$1 `https://fjellrute.no/` | `https://fjellrute.no` — 2026-01-01 |',
  );
  const revertedRow = /^\s*\|\s*Application home page\s*\|([^|]*)\|([^|]*)\|/m.exec(
    revertedUrl,
  );
  check(
    'a home-page URL reverted to the site root is caught',
    revertedUrl !== authDoc &&
      revertedRow !== null &&
      !/about\.html/.test(revertedRow[1]),
  );

  // The root growing the reviewer-facing copy back, which is check 5's job.
  const chattyRoot = rootPage.replace(
    /<h1 class="appName">Fjellrute<\/h1>/,
    '<h1 class="appName">Fjellrute</h1><p>En turplanlegger for topptur.</p>',
  );
  check(
    'explanatory copy creeping back onto the root is caught',
    chattyRoot !== rootPage &&
      /turplanlegger/i.test(proseOf(withoutScripts(chattyRoot))),
  );

  // And the root losing the app name, the other direction the split can rot.
  const namelessRoot = rootPage.replace(
    /<h1 class="appName">Fjellrute<\/h1>/,
    '<p class="appName">Fjellrute</p>',
  );
  check(
    'an app name demoted out of the root <h1> is caught',
    namelessRoot !== rootPage &&
      [...withoutScripts(namelessRoot).matchAll(/<h1[^>]*>([\s\S]*?)<\/h1>/g)]
        .length === 0,
  );
}

const warningNote =
  warnings > 0 ? ` (${warnings} warning(s) — see above)` : '';
console.log(
  failures === 0
    ? `\nALL CHECKS PASSED — the home page still meets the OAuth requirements${warningNote}`
    : `\n${failures} CHECK(S) FAILED${warningNote}`,
);
process.exit(failures === 0 ? 0 : 1);
