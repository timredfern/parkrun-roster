import type { Registry, Volunteer } from './registry.ts';
import { fullName } from './registry.ts';
import type { HistoryEntry } from './parse.ts';
import {
  CONCURRENCY_EXEMPT,
  isSanctionedDouble,
  MAX_ROLES_PER_PERSON,
  MIN_PEOPLE,
  RD_TID,
  roleName,
  STANDARD_TEMPLATE,
} from './rules.ts';

// POLICY: requests first, then ROTATE. An explicit request is honoured whenever feasible; the
// remaining slots go to whoever is most "due" for that role (hasn't done it recently, per the
// saved history), so roles rotate around the pool over time. Hard rules on top: a second
// during-run role is only possible as a SANCTIONED pair (else impossible → left unfilled + "need
// more people"); ≤2 during-run roles/person; Run Director only from the RD-eligible set.

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

const W_REQUEST = 1500; // dominant — a feasible request always wins its slot
const W_UNFILLED = -3000; // per empty mandatory slot (applied to the total)
const W_SANCTIONED_DBL = -20; // mild nudge to prefer a fresh person over a legal double
const W_EXTRA_LOAD = -120; // per role already held (keeps people single until we must double)
const W_ROTATION_PER_WEEK = 2; // reward weeks since the person last did this role
const W_NEVER_DID = 15; // bonus for a role the person has never done
const ROTATION_CAP_WEEKS = 26;

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

interface PersonStats {
  lastDateForRole: Map<number, string>;
  timesForRole: Map<number, number>;
}

function computeStats(history: HistoryEntry[]): Map<number, PersonStats> {
  const stats = new Map<number, PersonStats>();
  for (const e of history) {
    let s = stats.get(e.athleteId);
    if (!s) stats.set(e.athleteId, (s = { lastDateForRole: new Map(), timesForRole: new Map() }));
    const prev = s.lastDateForRole.get(e.tid);
    if (!prev || e.date > prev) s.lastDateForRole.set(e.tid, e.date);
    s.timesForRole.set(e.tid, (s.timesForRole.get(e.tid) ?? 0) + 1);
  }
  return stats;
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
function weeksSince(from: string | undefined, target: string): number {
  if (!from) return ROTATION_CAP_WEEKS; // never done → maximally due
  const diff = (Date.parse(target) - Date.parse(from)) / WEEK_MS;
  if (Number.isNaN(diff)) return ROTATION_CAP_WEEKS;
  return Math.max(0, Math.min(ROTATION_CAP_WEEKS, diff));
}

interface Breakdown {
  score: number;
  reasons: string[];
}

function scoreCandidate(
  tid: number,
  avail: Availability | undefined,
  assignedTids: number[],
  stats: PersonStats | undefined,
  target: string,
): Breakdown {
  const reasons: string[] = [];
  let score = 0;

  // Requests dominate (honour at most one per person: "Marshal or Tail Walker" = one of them).
  const preferred = avail?.prefer ?? [];
  const alreadyGotPreferred = assignedTids.some((t) => preferred.includes(t));
  const requested = preferred.includes(tid) && !alreadyGotPreferred;
  if (requested) {
    score += W_REQUEST;
    reasons.push('requested');
  }

  // Rotation: reward people who haven't done this role recently.
  const wk = weeksSince(stats?.lastDateForRole.get(tid), target);
  score += wk * W_ROTATION_PER_WEEK;
  const times = stats?.timesForRole.get(tid) ?? 0;
  if (!requested) {
    if (times === 0) {
      score += W_NEVER_DID;
      reasons.push('new to this role');
    } else if (wk >= 8) {
      reasons.push(`not done in ${Math.round(wk)}wk`);
    } else {
      reasons.push('available');
    }
  }

  // Any second during-run role reaching here is a sanctioned pair (non-sanctioned is filtered out).
  if (!CONCURRENCY_EXEMPT.has(tid)) {
    for (const other of assignedTids) {
      if (CONCURRENCY_EXEMPT.has(other)) continue;
      score += W_SANCTIONED_DBL;
      reasons.push(`also ${roleName(other)}`);
    }
  }
  if (assignedTids.length > 0) score += W_EXTRA_LOAD * assignedTids.length;

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
  // Only weeks BEFORE the target count for rotation.
  const stats = computeStats(opts.registry.history.filter((e) => e.date < opts.targetDate));

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
          if (!held.every((other) => isSanctionedDouble(other, tid))) continue; // sanctioned pairs only
        }
        const b = scoreCandidate(tid, av, assignedByPerson.get(v.athleteId) ?? [], stats.get(v.athleteId), opts.targetDate);
        const s = b.score + rng() * 4; // small jitter breaks ties among equally-due people
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
