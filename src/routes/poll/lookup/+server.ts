import { json } from '@sveltejs/kit';
import { volunteerExists, volunteerName } from '$lib/server/db';
import type { RequestHandler } from './$types';

// Live check used by the poll: is this barcode already known?
export const GET: RequestHandler = ({ url }) => {
  const digits = (url.searchParams.get('barcode') ?? '').replace(/[^0-9]/g, '');
  if (!digits) return json({ known: false, name: null });
  const id = Number(digits);
  return json({ known: volunteerExists(id), name: volunteerName(id) });
};
