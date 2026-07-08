import type { Registry, Volunteer } from './registry.ts';
import { fullName } from './registry.ts';
import {
  CONCURRENCY_EXEMPT,
  isSanctionedDouble,
  MAX_ROLES_PER_PERSON,
  MIN_PEOPLE,
  RD_TID,
  roleName,
  STANDARD_TEMPLATE,
} from './rules.ts';

// POLICY: honour explicit requests first, then fill the rest at random within the HARD rules.
// One person may only hold two during-run roles if they form a SANCTIONED pair (RD+Finish Tokens;
// First Timers Welcome + Course Check/Barcode/Timekeeper). Any other double is physically
// impossible (can't be in two places during the run), so it's never produced — the role is left
// UNFILLED and surfaced as "need more people". No rotation scoring — randomness gives variety.

export interface Availability {
  athleteId: number;
  prefer?: number[]; // task ids the volunteer requested
  avoid?: number[]; // task ids they will not do (hard exclusion)
}

export interface Assignment {
  slotIndex: number;
  tid: number;
  athleteId: number | null;
  name: string | null;
  rationale: string;
}

export interface RosterResult {
  targetDate: string;
  assignments: Assignment[];
  warnings: string[];
  restarts: number;
}

const W_REQUEST = 1500;
const W_UNFILLED = -3000; // per empty mandatory slot (applied to the total)
const W_SANCTIONED_DBL = -20; // mild nudge to prefer a fresh person over a legal double
const W_EXTRA_LOAD = -120; // per role already held (keeps people single until we must double)

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Breakdown {
  score: number;
  reasons: string[];
}

function scoreCandidate(tid: number, avail: Availability | undefined, assignedTids: number[]): Breakdown {
  const reasons: string[] = [];
  let score = 0;

  // A `prefer` list means "any ONE of these is fine" — honour at most one per person.
  const preferred = avail?.prefer ?? [];
  const alreadyGotPreferred = assignedTids.some((t) => preferred.includes(t));
  if (preferred.includes(tid) && !alreadyGotPreferred) {
    score += W_REQUEST;
    reasons.push('requested');
  }

  // Any second during-run role reaching here is a sanctioned pair (non-sanctioned is filtered out
  // as ineligible before scoring).
  if (!CONCURRENCY_EXEMPT.has(tid)) {
    for (const other of assignedTids) {
      if (CONCURRENCY_EXEMPT.has(other)) continue;
      score += W_SANCTIONED_DBL;
      reasons.push(`also ${roleName(other)}`);
    }
  }
  if (assignedTids.length > 0) score += W_EXTRA_LOAD * assignedTids.length;

  if (reasons.length === 0) reasons.push('available');
  return { score, reasons };
}

export function generateRoster(opts: {
  registry: Registry;
  available: Availability[];
  targetDate: string;
  template?: number[];
  restarts?: number;
  seed?: number;
}): RosterResult {
  const template = opts.template ?? STANDARD_TEMPLATE;
  const restarts = opts.restarts ?? 300;
  const rng = mulberry32(opts.seed ?? 12345);

  const availById = new Map<number, Availability>();
  for (const a of opts.available) availById.set(a.athleteId, a);

  const pool: Volunteer[] = opts.available.map(
    (a) => opts.registry.volunteers.get(a.athleteId) ?? { athleteId: a.athleteId, first: '?', last: `A${a.athleteId}`, vc: 0, rdEligible: false },
  );

  interface Chosen {
    athleteId: number | null;
    reasons: string[];
    score: number;
  }

  let best: { chosen: Chosen[]; total: number } | null = null;

  for (let r = 0; r < restarts; r++) {
    const order = template.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [order[i], order[j]] = [order[j]!, order[i]!];
    }

    const chosen: Chosen[] = template.map(() => ({ athleteId: null, reasons: [], score: 0 }));
    const assignedByPerson = new Map<number, number[]>();
    const usedSameTid = new Set<string>();

    for (const slotIndex of order) {
      const tid = template[slotIndex]!;
      const thisDuringRun = !CONCURRENCY_EXEMPT.has(tid);
      let bestCand: { v: Volunteer; b: Breakdown; s: number } | null = null;

      for (const v of pool) {
        const av = availById.get(v.athleteId);
        if (tid === RD_TID && !v.rdEligible) continue; // hard: RD must be eligible
        if (av?.avoid?.includes(tid)) continue; // hard: won't do this role
        if (usedSameTid.has(`${v.athleteId}:${tid}`)) continue; // no duplicate on same role
        if (thisDuringRun) {
          const held = (assignedByPerson.get(v.athleteId) ?? []).filter((t) => !CONCURRENCY_EXEMPT.has(t));
          if (held.length >= MAX_ROLES_PER_PERSON) continue; // physical cap
          // HARD: a second during-run role is only possible as a sanctioned pair — otherwise the
          // person can't physically do both, so they're ineligible and the slot may go unfilled.
          if (!held.every((other) => isSanctionedDouble(other, tid))) continue;
        }
        const b = scoreCandidate(tid, av, assignedByPerson.get(v.athleteId) ?? []);
        const s = b.score + rng() * 10; // jitter = the "random" among otherwise-equal candidates
        if (!bestCand || s > bestCand.s) bestCand = { v, b, s };
      }

      if (bestCand) {
        chosen[slotIndex] = { athleteId: bestCand.v.athleteId, reasons: bestCand.b.reasons, score: bestCand.b.score };
        const list = assignedByPerson.get(bestCand.v.athleteId) ?? [];
        list.push(tid);
        assignedByPerson.set(bestCand.v.athleteId, list);
        usedSameTid.add(`${bestCand.v.athleteId}:${tid}`);
      }
    }

    const total = chosen.reduce((sum, c) => sum + (c.athleteId != null ? c.score : W_UNFILLED), 0);
    if (!best || total > best.total) best = { chosen, total };
  }

  const chosen = best!.chosen;
  const assignments: Assignment[] = template.map((tid, slotIndex) => {
    const c = chosen[slotIndex]!;
    if (c.athleteId == null) return { slotIndex, tid, athleteId: null, name: null, rationale: 'no available volunteer' };
    const v = opts.registry.volunteers.get(c.athleteId);
    return { slotIndex, tid, athleteId: c.athleteId, name: v ? fullName(v) : `A${c.athleteId}`, rationale: c.reasons.join('; ') };
  });

  // Warnings — when short, the honest answer is "need more people", not an impossible double.
  const warnings: string[] = [];
  const distinctPeople = new Set(assignments.filter((a) => a.athleteId != null).map((a) => a.athleteId)).size;
  const unfilled = assignments.filter((a) => a.athleteId == null);
  if (unfilled.length > 0) {
    warnings.push(
      `Not enough people — ${unfilled.length} role(s) can't be filled: ${unfilled.map((a) => roleName(a.tid)).join(', ')}. You need more volunteers.`,
    );
  }
  if (distinctPeople < MIN_PEOPLE) {
    warnings.push(`Only ${distinctPeople} distinct volunteers — the minimum is ${MIN_PEOPLE}.`);
  }

  return { targetDate: opts.targetDate, assignments, warnings, restarts };
}
