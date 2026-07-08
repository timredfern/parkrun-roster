import { env } from '$env/dynamic/private';

// Event name is display-only config (e.g. "Clonbur Woods"); defaults to a generic label.
export function load() {
  return { eventName: env.EVENT_NAME || 'parkrun' };
}
