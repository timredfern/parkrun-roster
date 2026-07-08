import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseEmsHtml } from '../src/lib/core/parse.ts';
import type { ParsedPage } from '../src/lib/core/parse.ts';
import { buildRegistry, fullName } from '../src/lib/core/registry.ts';
import { generateRoster } from '../src/lib/core/score.ts';
import type { Availability } from '../src/lib/core/score.ts';
import { roleName, STANDARD_TEMPLATE } from '../src/lib/core/rules.ts';

function parseArgs(argv: string[]) {
  const files: string[] = [];
  let avail: string | undefined;
  let date: string | undefined;
  let seed: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (a === '--avail') avail = argv[++i];
    else if (a === '--date') date = argv[++i];
    else if (a === '--seed') seed = Number(argv[++i]);
    else files.push(a);
  }
  return { files, avail, date, seed };
}

function findSavedPages(dir: string): string[] {
  return readdirSync(dir)
    .filter((f) => /^Volunteer Rosters _ EMS.*\.html$/.test(f))
    .map((f) => join(dir, f))
    .sort();
}

function nextSaturday(fromIso: string): string {
  const d = new Date(fromIso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 7);
  return d.toISOString().slice(0, 10);
}

const { files, avail, date, seed } = parseArgs(process.argv.slice(2));
const cwd = process.cwd();
const htmlFiles = files.length > 0 ? files : findSavedPages(cwd);
if (htmlFiles.length === 0) {
  console.error('No EMS saved pages found. Pass paths, or run from a folder containing "Volunteer Rosters _ EMS*.html".');
  process.exit(1);
}

const pages: ParsedPage[] = htmlFiles.map((f) => parseEmsHtml(readFileSync(f, 'utf8')));
const registry = buildRegistry(pages);

// Availability may be a bare array, or an object { date?, available: [...], unmatched?: [...] }.
let available: Availability[] | undefined;
let availDate: string | undefined;
let unmatched: { pollName: string; phone?: string; note?: string }[] = [];
if (avail) {
  const raw = JSON.parse(readFileSync(avail, 'utf8'));
  if (Array.isArray(raw)) {
    available = raw as Availability[];
  } else {
    available = raw.available as Availability[];
    availDate = raw.date;
    unmatched = raw.unmatched ?? [];
  }
}

const allDates = new Set<string>();
for (const p of pages) for (const d of p.dates) allDates.add(d);
const sortedDates = [...allDates].sort();
const latest = sortedDates[sortedDates.length - 1]!;
const targetDate = date ?? availDate ?? nextSaturday(latest);

console.log('=== Imported EMS data ===');
console.log(`Files: ${htmlFiles.map((f) => f.replace(cwd + '/', '')).join(', ')}`);
console.log(`Weeks: ${sortedDates.length} (${sortedDates[0]} .. ${latest})`);
console.log(`Volunteers known: ${registry.volunteers.size}`);
console.log(`History entries: ${registry.history.length}`);
const rdEligible = [...registry.volunteers.values()].filter((v) => v.rdEligible);
console.log(`RD-eligible (derived): ${rdEligible.map(fullName).join(', ') || '(none)'}`);

// Availability: from --avail (loaded above), else default to everyone known (proves the pipeline).
if (!available) {
  available = [...registry.volunteers.keys()].map((athleteId) => ({ athleteId }));
  console.log('\n(no --avail given; treating all known volunteers as available)');
}
if (unmatched.length) {
  console.log(`\n⚠ Unresolved poll voters (no barcode — excluded): ${unmatched.map((u) => u.pollName).join(', ')}`);
}

const result = generateRoster({ registry, available, targetDate, seed });

console.log(`\n=== Proposed roster for ${result.targetDate} ===`);
const pad = (s: string, n: number) => (s.length >= n ? s : s + ' '.repeat(n - s.length));
for (const a of result.assignments) {
  const who = a.athleteId != null ? `${a.name} (A${a.athleteId})` : '— UNFILLED —';
  console.log(`  ${pad(roleName(a.tid), 24)} ${pad(who, 34)} ${a.rationale}`);
}
const filledSlots = result.assignments.filter((a) => a.athleteId != null);
const distinct = new Set(filledSlots.map((a) => a.athleteId)).size;
console.log(`\nSlots filled: ${filledSlots.length}/${STANDARD_TEMPLATE.length}   Distinct people: ${distinct}`);
if (result.warnings.length) {
  console.log('\n⚠ Warnings:');
  for (const w of result.warnings) console.log(`  - ${w}`);
} else {
  console.log('\nNo warnings.');
}
