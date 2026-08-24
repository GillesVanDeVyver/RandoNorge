// Reads the JSONL a recording produced and answers the two questions the spike
// exists to answer: were there gaps, and what did it cost per hour.
//
// WHY A SCRIPT AND NOT AN EYEBALL. A six-hour recording is ~2,200 lines. The
// failure being hunted is a run of missing minutes somewhere in the middle,
// which is exactly the thing scrolling through a file does not reveal — and the
// temptation, after six hours of walking, is to conclude it worked. So the
// judgement is made by arithmetic before anyone forms an opinion.
//
// WHAT COUNTS AS A GAP. The recorder asks for a fix every 10 seconds, so the
// expected spacing is 10 s. Anything over 60 s means the OS stopped delivering:
// a battery manager suspending the task, a doze window, or an OEM killing the
// foreground service. GPS in a valley loses accuracy, not fixes, so poor sky
// view is not an explanation for a gap of minutes.
//
// Usage:  node analyse.mjs spike-fixes.jsonl
//         node analyse.mjs spike-fixes.jsonl --gap 90

import { readFileSync } from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const gapIndex = args.indexOf('--gap');
const GAP_S = gapIndex === -1 ? 60 : Number(args[gapIndex + 1]);

if (!file) {
  console.error('usage: node analyse.mjs <spike-fixes.jsonl> [--gap seconds]');
  process.exit(2);
}

const rows = readFileSync(file, 'utf8')
  .split('\n')
  .filter((l) => l.trim())
  .map((l, i) => {
    try {
      return JSON.parse(l);
    } catch {
      console.warn(`line ${i + 1}: unparseable, skipped`);
      return null;
    }
  })
  .filter(Boolean);

const errors = rows.filter((r) => r.kind === 'error');
// Sorted by the fix's own timestamp, not by arrival: a batch delivered late
// carries the times the fixes were actually taken, and those are what describe
// the recording's coverage.
const fixes = rows.filter((r) => r.kind === 'fix').sort((a, b) => a.t - b.t);

if (fixes.length < 2) {
  console.error(`only ${fixes.length} fix(es) in ${file}; nothing to analyse.`);
  process.exit(1);
}

const first = fixes[0];
const last = fixes[fixes.length - 1];
const spanS = (last.t - first.t) / 1000;
const hours = spanS / 3600;

// --- gaps ------------------------------------------------------------------
const gaps = [];
const deltas = [];
for (let i = 1; i < fixes.length; i++) {
  const dt = (fixes[i].t - fixes[i - 1].t) / 1000;
  deltas.push(dt);
  if (dt > GAP_S) {
    gaps.push({
      from: fixes[i - 1].t,
      to: fixes[i].t,
      seconds: dt,
    });
  }
}
deltas.sort((a, b) => a - b);
const median = deltas[Math.floor(deltas.length / 2)];
const lostS = gaps.reduce((sum, g) => sum + g.seconds, 0);

// --- battery ---------------------------------------------------------------
// Only readings we actually have; a null battery is a failed read, not a 0%.
const batteryReadings = fixes.filter((f) => typeof f.battery === 'number');
let batteryPerHour = null;
if (batteryReadings.length >= 2) {
  const b0 = batteryReadings[0];
  const b1 = batteryReadings[batteryReadings.length - 1];
  const dropPct = (b0.battery - b1.battery) * 100;
  const h = (b1.t - b0.t) / 3_600_000;
  // A charging phone reads as a negative drop; say so rather than reporting a
  // flattering cost.
  if (h > 0.1) batteryPerHour = dropPct / h;
}

// --- accuracy --------------------------------------------------------------
const accs = fixes
  .map((f) => f.acc)
  .filter((a) => typeof a === 'number')
  .sort((a, b) => a - b);
const accMedian = accs.length ? accs[Math.floor(accs.length / 2)] : null;

const fmtTime = (t) => new Date(t).toISOString().slice(11, 19);
const fmtDur = (s) => {
  const m = Math.floor(s / 60);
  return m >= 60
    ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
    : `${m}m ${String(Math.round(s % 60)).padStart(2, '0')}s`;
};

console.log('');
console.log(`file            ${file}`);
console.log(`fixes           ${fixes.length}`);
console.log(`span            ${fmtDur(spanS)}  (${fmtTime(first.t)} → ${fmtTime(last.t)} UTC)`);
console.log(`median spacing  ${median.toFixed(1)} s`);
console.log(`median accuracy ${accMedian === null ? '—' : `${accMedian.toFixed(1)} m`}`);
console.log(
  `battery cost    ${
    batteryPerHour === null
      ? '— (not enough readings, or the phone was charging)'
      : `${batteryPerHour.toFixed(1)} %/hour`
  }`,
);
console.log(`task errors     ${errors.length}`);
console.log('');

if (gaps.length === 0) {
  console.log(`no gaps over ${GAP_S} s. Continuous coverage.`);
} else {
  console.log(`${gaps.length} gap(s) over ${GAP_S} s, ${fmtDur(lostS)} unrecorded in total:`);
  for (const g of gaps.slice(0, 40)) {
    console.log(`  ${fmtTime(g.from)} → ${fmtTime(g.to)}   ${fmtDur(g.seconds)}`);
  }
  if (gaps.length > 40) console.log(`  … and ${gaps.length - 40} more`);
}
for (const e of errors.slice(0, 10)) {
  console.log(`  error at ${fmtTime(e.t)}: ${e.message}`);
}
console.log('');

// --- the verdict -----------------------------------------------------------
// Stated in the terms Phase 4 needs, so the answer is not re-derived later from
// the numbers by someone hoping for a different one. Six hours is the plan's
// own bar; a shorter walk cannot clear it however clean it looks.
const coverage = 1 - lostS / spanS;
const longEnough = hours >= 6;
const clean = gaps.length === 0;

console.log('VERDICT');
if (!longEnough) {
  console.log(
    `  Inconclusive: ${fmtDur(spanS)} recorded, the bar is 6 h. OEM battery`,
  );
  console.log('  managers typically intervene after hours, not minutes.');
} else if (clean) {
  console.log('  PASS — free expo-location holds up on this phone. Phase 4 can');
  console.log('  use it; no need to buy react-native-background-geolocation.');
} else if (coverage > 0.98) {
  console.log(`  MARGINAL — ${(coverage * 100).toFixed(1)}% coverage. Decide whether a`);
  console.log('  recorded tour may be missing minutes. For a track you draw on a');
  console.log('  map, perhaps. For a distance or ascent total, no.');
} else {
  console.log(`  FAIL — ${(coverage * 100).toFixed(1)}% coverage on this phone. Free`);
  console.log('  background location is not sufficient; price the paid library');
  console.log('  into Phase 4 before building on it.');
}
console.log('');
console.log('Test the same build on a Samsung and a Xiaomi before believing a PASS.');
console.log('');
