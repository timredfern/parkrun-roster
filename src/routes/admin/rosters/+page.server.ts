import { confirmedRosterDates, getConfirmedRoster } from '$lib/server/db';
import { roleName } from '$lib/core/rules';
import type { PageServerLoad } from './$types';

const label = (iso: string) =>
  new Date(iso + 'T00:00:00Z').toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });

export const load: PageServerLoad = ({ url }) => {
  const dates = confirmedRosterDates().map((d) => ({ date: d, label: label(d) }));
  const selected = url.searchParams.get('date') || dates[0]?.date || null;
  const roster = selected
    ? getConfirmedRoster(selected).map((s) => ({ role: roleName(s.tid), name: s.name, athleteId: s.athleteId }))
    : [];
  return { dates, selected, roster };
};
