import type { Handle } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// Woodland palette is chosen per deployment via the THEME env var (mossy | bark | pine).
// The palettes themselves live in app.css, keyed on the data-woodland attribute we inject
// onto <html> here. Unknown/empty → mossy.
const WOODLAND = new Set(['mossy', 'bark', 'pine']);

export const handle: Handle = ({ event, resolve }) => {
  const choice = (env.THEME || 'mossy').trim().toLowerCase();
  const woodland = WOODLAND.has(choice) ? choice : 'mossy';
  return resolve(event, {
    transformPageChunk: ({ html }) =>
      html.replace('data-theme="dark"', `data-theme="dark" data-woodland="${woodland}"`),
  });
};
