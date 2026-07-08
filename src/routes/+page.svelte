<script lang="ts">
  let { data } = $props();
</script>

<h1>Roster status</h1>
<p class="muted">The tool's stored data. Seeded from EMS, then grows as rosters are confirmed.</p>

<div class="cards">
  <div class="card"><div class="n">{data.stats.volunteers}</div><div class="muted small">volunteers known</div></div>
  <div class="card"><div class="n">{data.stats.weeks}</div><div class="muted small">weeks of history</div></div>
  <div class="card"><div class="n">{data.rdEligibleCount}</div><div class="muted small">eligible run directors</div></div>
</div>

{#if data.stats.volunteers === 0}
  <div class="box warn">
    No data yet. <a href="/import">Import a saved EMS page</a> to seed the volunteer list and history.
  </div>
{:else}
  <p><a href="/generate" role="button">Generate a roster →</a></p>
{/if}
