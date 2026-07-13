import { fail } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { loadRegistry, stats, pollCounts, savePoll, volunteerExists, volunteerName } from '$lib/server/db';
import { roleName, STANDARD_TEMPLATE, ROLES } from '$lib/core/rules';
import type { Actions, PageServerLoad } from './$types';

function nextCalendarMonth(): { year: number; month0: number } {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  return m0 === 11 ? { year: y + 1, month0: 0 } : { year: y, month0: m0 + 1 };
}
const monthStr = (y: number, m0: number) => `${y}-${String(m0 + 1).padStart(2, '0')}`;

function parseMonth(p: string | null): { year: number; month0: number } | null {
  if (p && /^\d{4}-\d{2}$/.test(p)) {
    const [y, m] = p.split('-').map(Number);
    return { year: y!, month0: m! - 1 };
  }
  return null;
}

function saturdaysInMonth(year: number, month0: number): { date: string; label: string }[] {
  const out: { date: string; label: string }[] = [];
  const d = new Date(Date.UTC(year, month0, 1));
  while (d.getUTCDay() !== 6) d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCMonth() === month0) {
    out.push({
      date: d.toISOString().slice(0, 10),
      label: d.toLocaleDateString('en-IE', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }),
    });
    d.setUTCDate(d.getUTCDate() + 7);
  }
  return out;
}

// Roles OFFERED IN THE POLL (requestable) for this parkrun. Set POLL_ROLES in the env to a
// comma-separated list of task ids; if unset, offer every role in the standard template. The
// generator still fills roles not offered here (e.g. Clonbur drops First Timers Welcome + Finish
// Tokens because they're always paired/absorbed) — this only controls what volunteers can request.
function pollRoles(): { tid: number; name: string }[] {
  const raw = (env.POLL_ROLES ?? '').trim();
  const tids = raw ? raw.split(',').map((s) => Number(s.trim())) : [...STANDARD_TEMPLATE];
  const seen = new Set<number>();
  const out: { tid: number; name: string }[] = [];
  for (const t of tids) {
    if (!ROLES[t] || seen.has(t)) continue;
    seen.add(t);
    out.push({ tid: t, name: roleName(t) });
  }
  return out;
}

export const load: PageServerLoad = ({ url }) => {
  const open = nextCalendarMonth();
  const target = parseMonth(url.searchParams.get('month')) ?? open;
  const votable = target.year === open.year && target.month0 === open.month0; // only the current/open poll
  const monthLabel = new Date(Date.UTC(target.year, target.month0, 1)).toLocaleDateString('en-IE', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const counts = new Map(pollCounts().map((c) => [c.date, c.n]));
  const weeks = saturdaysInMonth(target.year, target.month0).map((d) => ({ ...d, count: counts.get(d.date) ?? 0 }));
  const reg = loadRegistry();
  const rdEligibleCount = [...reg.volunteers.values()].filter((v) => v.rdEligible).length;

  return {
    stats: stats(),
    rdEligibleCount,
    monthLabel,
    month: monthStr(target.year, target.month0),
    votable,
    weeks,
    roles: pollRoles(),
  };
};

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const barcode = String(form.get('barcode') ?? '');
    const first = String(form.get('first') ?? '').trim();
    const last = String(form.get('last') ?? '').trim();
    const echo = { barcode, first, last };

    const open = nextCalendarMonth();
    // Voting is only allowed for the current/open poll.
    if (String(form.get('month')) !== monthStr(open.year, open.month0)) {
      return fail(403, { error: 'This poll is closed — you can only volunteer for the current month.', ...echo });
    }

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

    const date = String(form.get('date') ?? '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return fail(400, { error: 'Please choose a Saturday.', ...echo });

    const mode = (['any', 'prefer', 'only'].includes(String(form.get('mode'))) ? String(form.get('mode')) : 'any') as
      | 'any'
      | 'prefer'
      | 'only';
    const roles = mode === 'any' ? [] : form.getAll('role').map(Number).filter((n) => n > 0);
    if (mode !== 'any' && roles.length === 0) {
      return fail(400, { error: 'Pick at least one role, or choose "Any role".', ...echo });
    }

    savePoll({ athleteId, first: first || '?', last: last || '?', date, mode, roles });
    return { ok: true, name: volunteerName(athleteId), date, ...echo };
  },
};
