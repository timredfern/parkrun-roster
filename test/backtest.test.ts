// Two tiers:
//   1. Synthetic fixture (test/fixtures/synthetic-ems.html) — fake people, committed, runs
//      everywhere with no personal data. Pins the rules/invariants deterministically.
//   2. Real-data backtest — reads the coordinator's saved EMS pages from data/ (gitignored
//      personal data); SKIPPED when they're not present (CI, fresh clone, the box).
// Run: npm test   (deterministic — fixed seed)

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { parseEmsHtml } from '../src/lib/core/parse.ts';
import { buildRegistry } from '../src/lib/core/registry.ts';
import { generateRoster } from '../src/lib/core/score.ts';
import type { Availability, RosterResult } from '../src/lib/core/score.ts';
import { CONCURRENCY_EXEMPT, isSanctionedDouble, RD_TID } from '../src/lib/core/rules.ts';

const root = process.cwd();

function tidsByPerson(r: RosterResult): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const a of r.assignments) {
    if (a.athleteId == null) continue;
    let set = m.get(a.athleteId);
    if (!set) m.set(a.athleteId, (set = new Set()));
    set.add(a.tid);
  }
  return m;
}

function unhonouredRequests(r: RosterResult, available: Availability[]): number[] {
  const byPerson = tidsByPerson(r);
  const bad: number[] = [];
  for (const av of available) {
    if (!av.prefer?.length) continue;
    const got = byPerson.get(av.athleteId);
    if (!got || !av.prefer.some((t) => got.has(t))) bad.push(av.athleteId);
  }
  return bad;
}

// Every person holding 2 during-run roles must be holding a sanctioned pair.
function nonSanctionedDoubles(r: RosterResult): [number, number, number][] {
  const bad: [number, number, number][] = [];
  for (const [id, tids] of tidsByPerson(r)) {
    const dur = [...tids].filter((t) => !CONCURRENCY_EXEMPT.has(t));
    for (let i = 0; i < dur.length; i++)
      for (let j = i + 1; j < dur.length; j++) if (!isSanctionedDouble(dur[i]!, dur[j]!)) bad.push([id, dur[i]!, dur[j]!]);
  }
  return bad;
}

const allFilled = (r: RosterResult) => r.assignments.every((a) => a.athleteId != null);
const rdIsEligibleIfFilled = (r: RosterResult, reg: ReturnType<typeof buildRegistry>) => {
  const rd = r.assignments.find((a) => a.tid === RD_TID);
  return rd?.athleteId == null || !!reg.volunteers.get(rd.athleteId)?.rdEligible;
};

let failed = 0;
function test(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${(e as Error).message.replace(/\n/g, '\n      ')}`);
  }
}

// ============ Tier 1: synthetic fixture (always) ============
console.log('synthetic fixture — rules & invariants (always runs):');
{
  const page = parseEmsHtml(readFileSync(join(root, 'test/fixtures/synthetic-ems.html'), 'utf8'));
  const reg = buildRegistry([page]);
  const date = '2026-07-01';

  test('parser: 12 volunteers across 2 weeks', () => {
    assert.equal(reg.volunteers.size, 12);
    assert.equal(new Set(reg.history.map((h) => h.date)).size, 2);
  });
  test('barcode == athlete id', () => assert.equal(page.slots[0]!.i, 1000001));
  test('RD-eligibility derived from history (tid=1)', () =>
    assert.deepEqual(
      [...reg.volunteers.values()].filter((v) => v.rdEligible).map((v) => v.athleteId).sort(),
      [1000001, 1000002],
    ));

  // Healthy: 9 available incl an RD-eligible, two job requests.
  {
    const available: Availability[] = [
      { athleteId: 1000001 }, { athleteId: 1000002 }, { athleteId: 1000003 }, { athleteId: 1000004 },
      { athleteId: 1000005 }, { athleteId: 1000006 }, { athleteId: 1000007, prefer: [7] },
      { athleteId: 1000008, prefer: [19] }, { athleteId: 1000009 },
    ];
    const r = generateRoster({ registry: reg, available, targetDate: date, seed: 12345 });
    console.log(' healthy (9 available):');
    test('all 9 roles filled', () => assert.ok(allFilled(r)));
    test('no warnings', () => assert.equal(r.warnings.length, 0, r.warnings.join(' | ')));
    test('every request honoured', () => assert.deepEqual(unhonouredRequests(r, available), []));
    test('no non-sanctioned doubles', () => assert.deepEqual(nonSanctionedDoubles(r), []));
    test('Run Director is RD-eligible', () => assert.ok(rdIsEligibleIfFilled(r, reg)));
  }

  // Short: 5 available (incl an RD-eligible) — can't fill 9 with sanctioned doubling alone.
  {
    const available = [1000001, 1000003, 1000004, 1000005, 1000006].map((athleteId) => ({ athleteId }));
    const r = generateRoster({ registry: reg, available, targetDate: date, seed: 12345 });
    console.log(' short (5 available):');
    test('cannot fill all 9 (leaves roles unfilled)', () => assert.ok(!allFilled(r)));
    test('still no non-sanctioned doubles', () => assert.deepEqual(nonSanctionedDoubles(r), []));
    test('warns you need more people', () =>
      assert.ok(r.warnings.some((w) => /more volunteers|minimum/.test(w)), r.warnings.join(' | ')));
  }

  // No RD-eligible person available.
  {
    const available = [1000003, 1000004, 1000005, 1000006, 1000007, 1000008].map((athleteId) => ({ athleteId }));
    const r = generateRoster({ registry: reg, available, targetDate: date, seed: 12345 });
    console.log(' no RD-eligible available:');
    test('Run Director left unfilled', () => {
      const rd = r.assignments.find((a) => a.tid === RD_TID);
      assert.equal(rd?.athleteId, null);
    });
    test('flags Run Director / need more people', () =>
      assert.ok(r.warnings.some((w) => /Run Director|more volunteers/.test(w)), r.warnings.join(' | ')));
  }
}

// ============ Tier 2: real data from data/ (skipped if absent) ============
const dataDir = join(root, 'data');
const realFiles = existsSync(dataDir)
  ? readdirSync(dataDir).filter((f) => /^Volunteer Rosters _ EMS.*\.html$/.test(f)).map((f) => join(dataDir, f))
  : [];

if (realFiles.length === 0) {
  console.log('\nreal-data backtest — SKIPPED (no EMS pages in data/)');
} else {
  console.log(`\nreal-data backtest — ${realFiles.length} EMS page(s) in data/:`);
  const reg = buildRegistry(realFiles.map((f) => parseEmsHtml(readFileSync(f, 'utf8'))));
  for (const name of ['2026-07-04.json', '2026-07-11.json', '2026-07-18.json', '2026-07-25.json']) {
    const path = join(root, 'scenarios', name);
    if (!existsSync(path)) continue;
    const raw = JSON.parse(readFileSync(path, 'utf8'));
    const r = generateRoster({ registry: reg, available: raw.available as Availability[], targetDate: raw.date, seed: 12345 });
    test(`${name}: no non-sanctioned doubles`, () => assert.deepEqual(nonSanctionedDoubles(r), []));
    test(`${name}: any rostered Run Director is eligible`, () => assert.ok(rdIsEligibleIfFilled(r, reg)));
  }
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
