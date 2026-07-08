import { loadRegistry, stats } from '$lib/server/db';

export function load() {
  const reg = loadRegistry();
  const rdEligibleCount = [...reg.volunteers.values()].filter((v) => v.rdEligible).length;
  return { stats: stats(), rdEligibleCount };
}
