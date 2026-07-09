<script lang="ts">
  let { data } = $props();
</script>

<h1>Saved rosters</h1>

{#if data.dates.length === 0}
  <div class="box">No saved rosters yet — generate one and click <strong>Confirm &amp; save</strong>.</div>
{:else}
  <form method="GET" style="margin-bottom:1rem">
    <label>Week:
      <select name="date" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
        {#each data.dates as d (d.date)}
          <option value={d.date} selected={d.date === data.selected}>{d.label}</option>
        {/each}
      </select>
    </label>
  </form>

  <div class="tablewrap">
    <table>
      <thead><tr><th>Job</th><th>Person</th></tr></thead>
      <tbody>
        {#each data.roster as r (r.role + r.athleteId)}
          <tr><td class="role">{r.role}</td><td>{r.name} <span class="muted small">A{r.athleteId}</span></td></tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
