import { json } from '@sveltejs/kit';
import { volunteerExists, volunteerName, getMyPollEntry } from '$lib/server/db';
import type { RequestHandler } from './$types';

// The open (current) poll month, YYYY-MM — matches +page.server.ts.
function openMonth(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m0 = now.getUTCMonth();
  const [oy, om0] = m0 === 11 ? [y + 1, 0] : [y, m0 + 1];
  return `${oy}-${String(om0 + 1).padStart(2, '0')}`;
}

// Live check used by the poll: is this barcode known, and have they already signed up this month?
export const GET: RequestHandler = ({ url }) => {
  const digits = (url.searchParams.get('barcode') ?? '').replace(/[^0-9]/g, '');
  if (!digits) return json({ known: false, name: null, current: null });
  const id = Number(digits);
  const entry = getMyPollEntry(id);
  const current = entry && entry.date.startsWith(openMonth()) ? entry : null; // only this month's signup
  return json({ known: volunteerExists(id), name: volunteerName(id), current });
};
