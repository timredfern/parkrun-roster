// Rostering rules — from the coordinator's whiteboard, reconciled with real EMS data.
// Doublings are GUIDANCE: the generator may assign outside them but warns (DESIGN.md §4, §2.5).

export interface RoleDef {
  tid: number;
  name: string;
  singleOnly: boolean; // whiteboard "single role" (a during-run role, discouraged from doubling)
}

export const RD_TID = 1;
export const RP_TID = 4; // Results Processor — post-event
export const VC_TID = 20; // Volunteer Co-ordinator — the operator

// Canonical roles (subset of the full EMS task list actually used at this event).
export const ROLES: Record<number, RoleDef> = {
  1: { tid: 1, name: 'Run Director', singleOnly: false },
  2: { tid: 2, name: 'Timekeeper', singleOnly: true },
  4: { tid: 4, name: 'Results Processor', singleOnly: false },
  7: { tid: 7, name: 'Marshal', singleOnly: true },
  8: { tid: 8, name: 'Pre-event Setup', singleOnly: false },
  11: { tid: 11, name: 'Barcode Scanning', singleOnly: false },
  13: { tid: 13, name: 'Finish Tokens', singleOnly: false },
  14: { tid: 14, name: 'Number Checker', singleOnly: true },
  15: { tid: 15, name: 'First Timers Welcome', singleOnly: false },
  19: { tid: 19, name: 'Tail Walker', singleOnly: true },
  20: { tid: 20, name: 'Volunteer Co-ordinator', singleOnly: false },
  34: { tid: 34, name: 'Event Day Course Check', singleOnly: false },
  35: { tid: 35, name: 'parkwalker', singleOnly: false },
};

export function roleName(tid: number): string {
  return ROLES[tid]?.name ?? `task ${tid}`;
}

// The 9 MANDATORY on-the-day roles (whiteboard "Mandatory Roles"). All must be covered every
// week; headcount is reduced to the minimum of 7 PEOPLE via sanctioned doubling, not by dropping
// roles. Results Processor (4) and Volunteer Co-ordinator (20) are deliberately excluded — VC is
// whoever runs the app, RP is Shauna/Yvonne, both assigned outside the poll. (DESIGN.md §4)
export const STANDARD_TEMPLATE: number[] = [1, 34, 15, 2, 2, 11, 13, 7, 19];

// Minimum distinct people per roster, and the physical cap on concurrent roles per person.
export const MIN_PEOPLE = 7;
export const MAX_ROLES_PER_PERSON = 2;

// Sanctioned doubling pairs (one person, two roles, no warning). Keys are sorted "a-b".
export const SANCTIONED_DOUBLES = new Set<string>(['1-13', '15-34', '11-15', '2-15']);

// Roles exempt from the "no two concurrent roles" concern (post-event / operator).
export const CONCURRENCY_EXEMPT = new Set<number>([RP_TID, VC_TID]);

export function pairKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

export function isSanctionedDouble(a: number, b: number): boolean {
  return SANCTIONED_DOUBLES.has(pairKey(a, b));
}

// The roles a given role is allowed to be doubled with (empty = can't be doubled at all).
export function sanctionedPartners(tid: number): number[] {
  const out: number[] = [];
  for (const key of SANCTIONED_DOUBLES) {
    const [a, b] = key.split('-').map(Number);
    if (a === tid) out.push(b!);
    else if (b === tid) out.push(a!);
  }
  return out;
}
