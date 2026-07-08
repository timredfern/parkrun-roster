import { fail } from '@sveltejs/kit';
import { importEmsHtml } from '$lib/server/db';
import type { Actions } from './$types';

export const actions: Actions = {
  default: async ({ request }) => {
    const form = await request.formData();
    const files = form.getAll('pages').filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length === 0) return fail(400, { error: 'Choose at least one saved EMS page (.html).' });
    try {
      const htmls = await Promise.all(files.map((f) => f.text()));
      const r = importEmsHtml(htmls);
      return { ok: true, ...r, fileCount: files.length };
    } catch (e) {
      return fail(400, { error: (e as Error).message });
    }
  },
};
