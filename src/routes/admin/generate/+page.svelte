<script lang="ts">
  let { data, form } = $props();
  const g = $derived(form?.generated);
</script>

<h1>Generate a roster</h1>

{#if data.volunteers.length === 0}
  <div class="box warn">No volunteers yet — <a href="/admin/import">import a saved EMS page</a> first.</div>
{:else}
  <form method="GET" style="margin-bottom:1rem">
    <label>Week:
      <select name="date">
        {#each data.weeks as w (w.date)}
          <option value={w.date} selected={w.date === data.date}>
            {w.label} — {w.count ? `${w.count} responded` : 'no responses yet'}
          </option>
        {/each}
      </select>
    </label>
    <button class="secondary" type="submit">Load</button>
  </form>

  <form method="POST" action="?/generate">
    <input type="hidden" name="date" value={data.date} />
    <p class="muted small">Generating for <strong>{data.date}</strong> — ticked from the poll; adjust as needed.</p>
    <div class="tablewrap">
    <table>
      <thead>
        <tr><th>Available</th><th>Volunteer</th><th>Requested job</th></tr>
      </thead>
      <tbody>
        {#each data.volunteers as v (v.athleteId)}
          <tr>
            <td><input type="checkbox" name="available" value={v.athleteId} checked={v.available} /></td>
            <td>
              {v.name}
              {#if v.rdEligible}<span class="badge rd">RD</span>{/if}
              <span class="muted small">· {v.vc}×</span>
            </td>
            <td class="muted small">{v.requests.length ? v.requests.join(', ') : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    </div>

    <p><button type="submit">Generate draft</button></p>
  </form>
{/if}

{#if form?.confirmed}
  <div class="box ok">Roster for {form.date} saved ({form.count} people). It’s now part of history.</div>
{/if}

{#if g}
  <h2>Draft for {g.date}</h2>
  <div class="tablewrap">
  <table>
    <thead><tr><th>Job</th><th>Person</th><th>Why</th></tr></thead>
    <tbody>
      {#each g.rows as r (r.role + (r.athleteId ?? 'x'))}
        <tr>
          <td class="role">{r.role}</td>
          <td>{r.name ?? '— unfilled —'}</td>
          <td class="muted small">{r.rationale}</td>
        </tr>
      {/each}
    </tbody>
  </table>
  </div>
  <p class="small muted">{g.filled}/{g.total} jobs filled · {g.distinct} distinct people</p>

  {#if g.warnings.length}
    <div class="box warn">
      <strong>Warnings</strong>
      <ul>{#each g.warnings as w}<li>{w}</li>{/each}</ul>
    </div>
  {:else}
    <div class="box ok">No warnings.</div>
  {/if}

  <form method="POST" action="?/confirm">
    <input type="hidden" name="date" value={g.date} />
    <input type="hidden" name="slots" value={form?.slotsJson} />
    <button type="submit" disabled={g.filled === 0}>Confirm &amp; save this roster</button>
    <span class="muted small">Saves it as history and (you) enter it into EMS.</span>
  </form>
{/if}
