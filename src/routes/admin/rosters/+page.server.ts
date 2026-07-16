import { confirmedRosterDates, getConfirmedRoster, confirmRoster, loadRegistry } from '$lib/server/db';
import { fullName } from '$lib/core/registry';
import { STANDARD_TEMPLATE } from '$lib/core/rules';
import { checkRoster } from '$lib/core/check';
import type { Actions, PageServerLoad } from './$types';

const label = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const load: PageServerLoad = ({ url }) => {
  const dates = confirmedRosterDates().map((d) => ({ date: d, label: label(d) }));
  const selected = url.searchParams.get('date') || null; // nothing opened until a week is chosen

  const reg = loadRegistry();
  const volunteers = [...reg.volunteers.values()]
    .sort((a, b) => fullName(a).localeCompare(fullName(b)))
    .map((v) => ({ athleteId: v.athleteId, name: fullName(v), rdEligible: v.rdEligible }));

  let slots: { tid: number; athleteId: number | null }[] = [];
  let extras: { tid: number; athleteId: number }[] = [];
  if (selected) {
    // Lay the saved roster over the standard template so unfilled roles are still editable.
    const byTid = new Map<number, number[]>();
    for (const c of getConfirmedRoster(selected)) {
      let q = byTid.get(c.tid);
      if (!q) byTid.set(c.tid, (q = []));
      q.push(c.athleteId);
    }
    slots = STANDARD_TEMPLATE.map((tid) => ({ tid, athleteId: byTid.get(tid)?.shift() ?? null }));
    for (const [tid, q] of byTid) for (const athleteId of q) extras.push({ tid, athleteId }); // anything beyond the template
  }

  return { dates, selected, volunteers, slots, extras };
};

export const actions: Actions = {
  // Save corrections to a confirmed roster. Replaces that date's confirmed record (confirmRoster
  // deletes + re-inserts). No blocking — the record must be able to reflect the actual day.
  save: async ({ request }) => {
    const form = await request.formData();
    const date = String(form.get('date'));
    const slots: { tid: number; athleteId: number }[] = [];
    for (let i = 0; form.get(`tid_${i}`) !== null; i++) {
      const tid = Number(form.get(`tid_${i}`));
      const raw = form.get(`slot_${i}`);
      if (raw) slots.push({ tid, athleteId: Number(raw) });
    }
    confirmRoster(date, slots);

    // Backstop check for the confirmation banner (the editor already warns live).
    const reg = loadRegistry();
    const people = new Map(
      [...reg.volunteers.values()].map((v) => [v.athleteId, { rdEligible: v.rdEligible, name: fullName(v) }]),
    );
    const warnings = checkRoster(slots, people).map((iss) => iss.message);
    return { saved: true, date, count: new Set(slots.map((s) => s.athleteId)).size, warnings };
  },
};
