import { loadRegistry, confirmRoster, getPollForDate, pollCounts } from '$lib/server/db';
import { fullName } from '$lib/core/registry';
import { generateRoster } from '$lib/core/score';
import { roleName } from '$lib/core/rules';
import type { Actions, PageServerLoad } from './$types';

function nextSaturday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function nextSaturdays(n: number): string[] {
  const out: string[] = [];
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + ((6 - d.getUTCDay() + 7) % 7 || 7));
  for (let i = 0; i < n; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function satLabel(iso: string): string {
  return new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IE', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

export const load: PageServerLoad = ({ url }) => {
  const reg = loadRegistry();
  const counts = new Map(pollCounts().map((c) => [c.date, c.n]));
  const weeks = nextSaturdays(6).map((d) => ({ date: d, label: satLabel(d), count: counts.get(d) ?? 0 }));
  const date = url.searchParams.get('date') || weeks[0]!.date;
  const poll = getPollForDate(date);
  const availSet = new Set(poll.map((p) => p.athleteId));
  const reqMap = new Map(poll.map((p) => [p.athleteId, p.prefer]));
  const volunteers = [...reg.volunteers.values()]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((v) => ({
      athleteId: v.athleteId,
      name: fullName(v),
      vc: v.vc,
      rdEligible: v.rdEligible,
      available: availSet.has(v.athleteId),
      requests: (reqMap.get(v.athleteId) ?? []).map(roleName),
    }));
  return { volunteers, weeks, date, pollCount: poll.length };
};

export const actions: Actions = {
  generate: async ({ request }) => {
    const form = await request.formData();
    const date = String(form.get('date') || nextSaturday());
    const ids = form.getAll('available').map(Number);

    // Requests come from the poll (a person may nominate several jobs); the coordinator's
    // checkboxes only decide who's in.
    const poll = getPollForDate(date);
    const prefById = new Map(poll.map((p) => [p.athleteId, p.prefer]));
    const available = ids.map((id) => ({ athleteId: id, prefer: prefById.get(id) }));

    const reg = loadRegistry();
    const result = generateRoster({ registry: reg, available, targetDate: date });

    const rows = result.assignments.map((a) => ({
      role: roleName(a.tid),
      tid: a.tid,
      athleteId: a.athleteId,
      name: a.name,
      rationale: a.rationale,
    }));
    const slots = rows.filter((r) => r.athleteId != null).map((r) => ({ tid: r.tid, athleteId: r.athleteId }));
    const distinct = new Set(slots.map((s) => s.athleteId)).size;

    return {
      generated: { date, rows, warnings: result.warnings, distinct, filled: slots.length, total: rows.length },
      slotsJson: JSON.stringify(slots),
    };
  },

  confirm: async ({ request }) => {
    const form = await request.formData();
    const date = String(form.get('date'));
    const slots = JSON.parse(String(form.get('slots'))) as { tid: number; athleteId: number }[];
    confirmRoster(date, slots);
    return { confirmed: true, date, count: slots.length };
  },
};
