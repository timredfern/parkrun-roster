// Validate a (possibly hand-edited) set of role assignments against the rostering rules.
// Pure and side-effect free: used LIVE in the editors (client) and as a backstop on save
// (server). It WARNS — it never blocks — so the coordinator can make a deliberate override after
// review. The predicates mirror the hard constraints the generator enforces while building a draft
// (score.ts): RD eligibility, the 2-role cap, and sanctioned pairs only.

import {
  CONCURRENCY_EXEMPT,
  isSanctionedDouble,
  MAX_ROLES_PER_PERSON,
  MIN_PEOPLE,
  RD_TID,
  roleName,
  sanctionedPartners,
} from './rules.ts';

const orList = (xs: string[]): string =>
  xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} or ${xs[xs.length - 1]}`;

// Explain an illegal double in terms of what each role CAN pair with, e.g.
// "Ethel Eames: Run Director + Timekeeper isn't allowed — Run Director can only pair with Finish
//  Tokens, and Timekeeper can only pair with First Timers Welcome."
function doubleMessage(name: string, a: number, b: number): string {
  if (a === b) return `${name} is assigned ${roleName(a)} twice.`;
  const rule = (tid: number) => {
    const partners = sanctionedPartners(tid).map(roleName);
    return partners.length
      ? `${roleName(tid)} can only pair with ${orList(partners)}`
      : `${roleName(tid)} can't be paired with another role`;
  };
  return `${name}: ${roleName(a)} + ${roleName(b)} isn't allowed — ${rule(a)}, and ${rule(b)}.`;
}

export interface CheckPerson {
  rdEligible: boolean;
  name: string;
}

export interface RosterSlot {
  tid: number;
  athleteId: number | null;
}

export type IssueKind = 'unfilled' | 'min_people' | 'over_cap' | 'illegal_double' | 'rd_ineligible';

export interface RosterIssue {
  kind: IssueKind;
  message: string;
  athleteIds: number[]; // people to highlight (empty when the issue isn't person-specific)
  tids: number[]; // roles involved
}

export function checkRoster(slots: RosterSlot[], people: Map<number, CheckPerson>): RosterIssue[] {
  const issues: RosterIssue[] = [];
  const nameOf = (id: number) => people.get(id)?.name ?? `A${id}`;

  // Unfilled roles.
  const unfilled = slots.filter((s) => s.athleteId == null);
  if (unfilled.length) {
    issues.push({
      kind: 'unfilled',
      message: `${unfilled.length} role(s) unfilled: ${unfilled.map((s) => roleName(s.tid)).join(', ')}.`,
      athleteIds: [],
      tids: unfilled.map((s) => s.tid),
    });
  }

  // Distinct headcount.
  const filled = slots.filter((s): s is { tid: number; athleteId: number } => s.athleteId != null);
  const distinct = new Set(filled.map((s) => s.athleteId));
  if (distinct.size > 0 && distinct.size < MIN_PEOPLE) {
    issues.push({
      kind: 'min_people',
      message: `Only ${distinct.size} distinct volunteer(s) — the minimum is ${MIN_PEOPLE}.`,
      athleteIds: [],
      tids: [],
    });
  }

  // Per-person checks: RD eligibility, the concurrency cap, and sanctioned pairs.
  const byPerson = new Map<number, number[]>();
  for (const s of filled) {
    if (s.tid === RD_TID && !people.get(s.athleteId)?.rdEligible) {
      issues.push({
        kind: 'rd_ineligible',
        message: `${nameOf(s.athleteId)} is Run Director but isn't RD-eligible.`,
        athleteIds: [s.athleteId],
        tids: [RD_TID],
      });
    }
    let list = byPerson.get(s.athleteId);
    if (!list) byPerson.set(s.athleteId, (list = []));
    list.push(s.tid);
  }

  for (const [id, tids] of byPerson) {
    const dur = tids.filter((t) => !CONCURRENCY_EXEMPT.has(t)); // during-run roles only
    if (dur.length > MAX_ROLES_PER_PERSON) {
      issues.push({
        kind: 'over_cap',
        message: `${nameOf(id)} is in ${dur.length} during-run roles (max ${MAX_ROLES_PER_PERSON}): ${dur.map(roleName).join(', ')}.`,
        athleteIds: [id],
        tids: dur,
      });
      continue; // an over-cap person also has unsanctioned pairs; the cap message is enough
    }
    for (let i = 0; i < dur.length; i++)
      for (let j = i + 1; j < dur.length; j++)
        if (!isSanctionedDouble(dur[i]!, dur[j]!)) {
          issues.push({
            kind: 'illegal_double',
            message: doubleMessage(nameOf(id), dur[i]!, dur[j]!),
            athleteIds: [id],
            tids: [dur[i]!, dur[j]!],
          });
        }
  }

  return issues;
}
