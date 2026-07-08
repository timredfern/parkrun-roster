// Regression backtest: pins the generator's behaviour on the two real sample weeks so tuning the
// scorer later can't silently break request-honouring or the doubling rules.
// Run: npm test   (deterministic — fixed seed)

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { parseEmsHtml } from '../src/lib/core/parse.ts';
import { buildRegistry } from '../src/lib/core/registry.ts';
import { generateRoster } from '../src/lib/core/score.ts';
import type { Availability } from '../src/lib/core/score.ts';
import type { RosterResult } from '../src/lib/core/score.ts';
import type { Registry } from '../src/lib/core/registry.ts';
import { CONCURRENCY_EXEMPT, isSanctionedDouble, MIN_PEOPLE, RD_TID } from '../src/lib/core/rules.ts';

const root = process.cwd();

function loadRegistry(): Registry {
  const files = readdirSync(root)
    .filter((f) => /^Volunteer Rosters _ EMS.*\.html$/.test(f))
    .map((f) => join(root, f));
  assert.ok(files.length >= 2, 'expected the two saved EMS pages in the project root');
  return buildRegistry(files.map((f) => parseEmsHtml(readFileSync(f, 'utf8'))));
}

function loadScenario(name: string): { date: string; available: Availability[] } {
  const raw = JSON.parse(readFileSync(join(root, 'scenarios', name), 'utf8'));
  return { date: raw.date, available: raw.available as Availability[] };
}

function tidsByPerson(result: RosterResult): Map<number, Set<number>> {
  const m = new Map<number, Set<number>>();
  for (const a of result.assignments) {
    if (a.athleteId == null) continue;
    let set = m.get(a.athleteId);
    if (!set) m.set(a.athleteId, (set = new Set()));
    set.add(a.tid);
  }
  return m;
}

function unhonouredRequests(result: RosterResult, available: Availability[]): number[] {
  const byPerson = tidsByPerson(result);
  const bad: number[] = [];
  for (const av of available) {
    if (!av.prefer?.length) continue;
    const got = byPerson.get(av.athleteId);
    if (!got || !av.prefer.some((t) => got.has(t))) bad.push(av.athleteId);
  }
  return bad;
}

// Every person holding 2 during-run roles must be holding a sanctioned pair.
function nonSanctionedDoubles(result: RosterResult): [number, number, number][] {
  const bad: [number, number, number][] = [];
  for (const [id, tids] of tidsByPerson(result)) {
    const dur = [...tids].filter((t) => !CONCURRENCY_EXEMPT.has(t));
    for (let i = 0; i < dur.length; i++)
      for (let j = i + 1; j < dur.length; j++) if (!isSanctionedDouble(dur[i]!, dur[j]!)) bad.push([id, dur[i]!, dur[j]!]);
  }
  return bad;
}

function distinctPeople(result: RosterResult): number {
  return new Set(result.assignments.filter((a) => a.athleteId != null).map((a) => a.athleteId)).size;
}

function allFilled(result: RosterResult): boolean {
  return result.assignments.every((a) => a.athleteId != null);
}

// --- tiny harness ---
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

const registry = loadRegistry();

console.log('04/07 — backtest against the real human roster (7 resolved, healthy week):');
{
  const { date, available } = loadScenario('2026-07-04.json');
  const r = generateRoster({ registry, available, targetDate: date, seed: 12345 });

  test('all 9 mandatory roles filled', () => assert.ok(allFilled(r)));
  test('at least the minimum 7 distinct people', () => assert.ok(distinctPeople(r) >= MIN_PEOPLE, `got ${distinctPeople(r)}`));
  test('no warnings', () => assert.equal(r.warnings.length, 0, r.warnings.join(' | ')));
  test('every request honoured', () => assert.deepEqual(unhonouredRequests(r, available), []));
  test('no non-sanctioned doubles', () => assert.deepEqual(nonSanctionedDoubles(r), []));
  test('Run Director is RD-eligible', () => {
    const rd = r.assignments.find((a) => a.tid === RD_TID);
    assert.ok(rd?.athleteId != null && registry.volunteers.get(rd.athleteId)?.rdEligible, 'RD not eligible');
  });
}

console.log('\n11/07 — forward test (5 resolved, deliberately under-staffed):');
{
  const { date, available } = loadScenario('2026-07-11.json');
  const r = generateRoster({ registry, available, targetDate: date, seed: 12345 });

  test('cannot fill all 9 with only 5 people (leaves roles unfilled, no impossible doubles)', () =>
    assert.ok(!allFilled(r)));
  test('never produces a non-sanctioned double', () => assert.deepEqual(nonSanctionedDoubles(r), []));
  test('resolved requests still honoured', () => assert.deepEqual(unhonouredRequests(r, available), []));
  test('warns you need more people', () =>
    assert.ok(r.warnings.some((w) => /more volunteers|minimum/.test(w)), r.warnings.join(' | ')));
}

console.log('\n18/07 — forward test (4 resolved — too few to cover 9 roles):');
{
  const { date, available } = loadScenario('2026-07-18.json');
  const r = generateRoster({ registry, available, targetDate: date, seed: 12345 });

  test('Run Director is RD-eligible', () => {
    const rd = r.assignments.find((a) => a.tid === RD_TID);
    assert.ok(rd?.athleteId != null && registry.volunteers.get(rd.athleteId)?.rdEligible, 'RD not eligible');
  });
  test('cannot fill all 9 with only 4 people (a role is left open)', () => assert.ok(!allFilled(r)));
  test('warns it is under the 7-person minimum', () => assert.ok(r.warnings.some((w) => /minimum/.test(w)), r.warnings.join(' | ')));
}

console.log('\n25/07 — forward test (5 resolved, but none of them RD-eligible):');
{
  const { date, available } = loadScenario('2026-07-25.json');
  const r = generateRoster({ registry, available, targetDate: date, seed: 12345 });

  test('Run Director is left unfilled (nobody eligible is available)', () => {
    const rd = r.assignments.find((a) => a.tid === RD_TID);
    assert.equal(rd?.athleteId, null);
  });
  test('flags Run Director among the roles it can\'t fill', () => assert.ok(r.warnings.some((w) => /Run Director/.test(w)), r.warnings.join(' | ')));
  test('warns it is under the 7-person minimum', () => assert.ok(r.warnings.some((w) => /minimum/.test(w)), r.warnings.join(' | ')));
}

console.log(failed === 0 ? '\nAll checks passed.' : `\n${failed} check(s) FAILED.`);
process.exit(failed === 0 ? 0 : 1);
