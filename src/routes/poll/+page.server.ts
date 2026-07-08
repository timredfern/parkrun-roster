import { fail } from '@sveltejs/kit';
import { savePoll, volunteerExists, volunteerName } from '$lib/server/db';
import { roleName, STANDARD_TEMPLATE } from '$lib/core/rules';
import type { Actions, PageServerLoad } from './$types';

// The month the poll is for: `?month=YYYY-MM` if given, otherwise next calendar month.
function targetMonth(param: string | null): { year: number; month0: number } {
  if (param && /^\d{4}-\d{2}$/.test(param)) {
    const [y, m] = param.split('-').map(Number);
    return { year: y!, month0: m! - 1 };
  }
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  return m0 === 11 ? { year: y + 1, month0: 0 } : { year: y, month0: m0 + 1 };
}

function saturdaysInMonth(year: number, month0: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const d = new Date(Date.UTC(year, month0, 1));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1); // first Saturday
  while (d.getUTCMonth() === month0) {
    out.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

function uniqueRoles(): { tid: number; name: string }[] {
  const seen = new Set<number>();
  const out: { tid: number; name: string }[] = [];
  for (const tid of STANDARD_TEMPLATE) {
    if (seen.has(tid)) continue;
    seen.add(tid);
    out.push({ tid, name: roleName(tid) });
  }
  return out;
}

export const load: PageServerLoad = ({ url }) => {
  const { year, month0 } = targetMonth(url.searchParams.get('month'));
  const monthLabel = new Date(Date.UTC(year, month0, 1)).toLocaleDateString('en-IE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { roles: uniqueRoles(), weeks: saturdaysInMonth(year, month0), monthLabel };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const barcode = String(form.get('barcode') ?? '');
    const first = String(form.get('first') ?? '').trim();
    const last = String(form.get('last') ?? '').trim();

    const echo = { barcode, first, last };

    const digits = barcode.replace(/[^0-9]/g, '');
    if (!digits) return fail(400, { error: 'Enter your parkrun barcode (e.g. A1234567).', ...echo });
    const athleteId = Number(digits);

    if (!form.get('consent')) return fail(400, { error: 'Please tick the box to accept the privacy notice.', ...echo });

    const known = volunteerExists(athleteId);
    if (!known && (!first || !last)) {
      return fail(400, {
        error: `We don't recognise barcode A${athleteId} yet — add your first name and surname and we'll register you.`,
        needName: true,
        ...echo,
      });
    }

    const weeks = String(form.get('weeks') ?? '').split(',').filter(Boolean);
    const entries = weeks.map((date) => ({
      date,
      available: !!form.get(`avail_${date}`),
      prefer: form.getAll(`job_${date}`).filter((v) => v !== '').map(Number),
    }));
    savePoll({ athleteId, first: first || '?', last: last || '?', entries });

    return { ok: true, availCount: entries.filter((e) => e.available).length, name: volunteerName(athleteId) };
  },
};
