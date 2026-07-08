import type { HistoryEntry, ParsedPage } from './parse.ts';
import { RD_TID } from './rules.ts';

export interface Volunteer {
  athleteId: number;
  first: string;
  last: string;
  vc: number; // lifetime volunteer count (experience)
  rdEligible: boolean;
}

export interface Registry {
  volunteers: Map<number, Volunteer>;
  history: HistoryEntry[]; // deduped, chronological
}

export interface RdOverrides {
  eligible?: number[]; // force-eligible athlete ids
  ineligible?: number[]; // force-ineligible athlete ids (wins over derived + eligible)
}

// Merge one or more saved EMS pages into a registry + deduped history.
export function buildRegistry(pages: ParsedPage[], overrides: RdOverrides = {}): Registry {
  const volunteers = new Map<number, Volunteer>();

  for (const page of pages) {
    for (const s of page.slots) {
      const existing = volunteers.get(s.i);
      if (!existing) {
        volunteers.set(s.i, { athleteId: s.i, first: s.f, last: s.l, vc: s.vc, rdEligible: false });
      } else {
        // Keep the highest vc seen (most recent snapshot) and refresh the name.
        if (s.vc >= existing.vc) {
          existing.vc = s.vc;
          existing.first = s.f;
          existing.last = s.l;
        }
      }
    }
  }

  // Dedup history across pages (overlapping weeks are common).
  const seen = new Set<string>();
  const history: HistoryEntry[] = [];
  for (const page of pages) {
    for (const e of page.entries) {
      const key = `${e.date}|${e.athleteId}|${e.tid}`;
      if (seen.has(key)) continue;
      seen.add(key);
      history.push(e);
    }
  }
  history.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Derive RD eligibility: anyone who has held Run Director in history.
  const derivedRd = new Set<number>();
  for (const e of history) if (e.tid === RD_TID) derivedRd.add(e.athleteId);

  const forceElig = new Set(overrides.eligible ?? []);
  const forceInelig = new Set(overrides.ineligible ?? []);
  for (const v of volunteers.values()) {
    v.rdEligible = (derivedRd.has(v.athleteId) || forceElig.has(v.athleteId)) && !forceInelig.has(v.athleteId);
  }
  // Overrides may reference people not seen in any slot — add stubs so they're usable.
  for (const id of forceElig) {
    if (!volunteers.has(id) && !forceInelig.has(id)) {
      volunteers.set(id, { athleteId: id, first: '?', last: `A${id}`, vc: 0, rdEligible: true });
    }
  }

  return { volunteers, history };
}

export function fullName(v: Volunteer): string {
  return `${v.first} ${v.last}`.trim();
}
