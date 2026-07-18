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
  const hasVolunteers = reg.volunteers.size > 0;
  // No week chosen yet → don't build the list; the page shows only the week picker.
  const date = url.searchParams.get('date');
  if (!date) return { volunteers: [], weeks, date: null, pollCount: 0, hasVolunteers };
  const poll = getPollForDate(date);
  const pollById = new Map(poll.map((p) => [p.athleteId, p]));
  const volunteers = [...reg.volunteers.values()]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((v) => {
      const p = pollById.get(v.athleteId);
      let requests = '';
      if (p) {
        if (p.mode === 'any') requests = 'any role';
        else requests = (p.mode === 'only' ? 'only: ' : '') + p.prefer.map(roleName).join(', ');
      }
      return { athleteId: v.athleteId, name: fullName(v), vc: v.vc, rdEligible: v.rdEligible, available: !!p, requests };
    });
  return { volunteers, weeks, date, pollCount: poll.length, hasVolunteers };
};

export const actions: Actions = {
  generate: async ({ request }) => {
    const form = await request.formData();
    const date = String(form.get('date') || nextSaturday());
    const ids = form.getAll('available').map(Number);

    // Role prefs/mode come from the poll (any / prefer / only + arrival time); the coordinator's
    // checkboxes only decide who's in.
    const poll = getPollForDate(date);
    const pollById = new Map(poll.map((p) => [p.athleteId, p]));
    const available = ids.map((id) => {
      const p = pollById.get(id);
      if (!p) return { athleteId: id };
      if (p.mode === 'only') return { athleteId: id, only: p.prefer, prefer: p.prefer, since: p.since };
      if (p.mode === 'prefer') return { athleteId: id, prefer: p.prefer, since: p.since };
      return { athleteId: id, since: p.since };
    });

    const reg = loadRegistry();
    const result = generateRoster({ registry: reg, available, targetDate: date });

    const rows = result.assignments.map((a) => ({
      role: roleName(a.tid),
      tid: a.tid,
      athleteId: a.athleteId,
      name: a.name,
      rationale: a.rationale,
    }));
    const filled = rows.filter((r) => r.athleteId != null);
    const distinct = new Set(filled.map((r) => r.athleteId)).size;

    return {
      generated: { date, rows, warnings: result.warnings, distinct, filled: filled.length, total: rows.length },
    };
  },

  // Save the (possibly hand-tweaked) draft. Each slot is a tid_<i>/slot_<i> pair from the form.
  confirm: async ({ request }) => {
    const form = await request.formData();
    const date = String(form.get('date'));
    const slots: { tid: number; athleteId: number }[] = [];
    for (let i = 0; form.get(`tid_${i}`) !== null; i++) {
      const tid = Number(form.get(`tid_${i}`));
      const raw = form.get(`slot_${i}`);
      if (raw) slots.push({ tid, athleteId: Number(raw) });
    }
    confirmRoster(date, slots);
    return { confirmed: true, date, count: new Set(slots.map((s) => s.athleteId)).size };
  },
};
