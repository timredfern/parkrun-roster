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
      <select name="date" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
        {#each data.weeks as w (w.date)}
          <option value={w.date} selected={w.date === data.date}>
            {w.label} — {w.count ? `${w.count} responded` : 'no responses yet'}
          </option>
        {/each}
      </select>
    </label>
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
  <p class="small muted">Adjust any assignment if you like, then confirm. (Warnings below reflect the auto-generated draft.)</p>
  <form method="POST" action="?/confirm">
    <input type="hidden" name="date" value={g.date} />
    <div class="tablewrap">
      <table>
        <thead><tr><th>Job</th><th>Person</th><th>Why</th></tr></thead>
        <tbody>
          {#each g.rows as r, i (i)}
            <tr>
              <td class="role">{r.role}</td>
              <td>
                <input type="hidden" name={`tid_${i}`} value={r.tid} />
                <select name={`slot_${i}`}>
                  <option value="">— unfilled —</option>
                  {#each data.volunteers as v (v.athleteId)}
                    <option value={v.athleteId} selected={v.athleteId === r.athleteId}>{v.name}</option>
                  {/each}
                </select>
              </td>
              <td class="muted small">{r.rationale}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
    <p class="small muted">{g.filled}/{g.total} jobs filled · {g.distinct} distinct people (before edits)</p>

    {#if g.warnings.length}
      <div class="box warn"><strong>Warnings</strong><ul>{#each g.warnings as w}<li>{w}</li>{/each}</ul></div>
    {:else}
      <div class="box ok">No warnings.</div>
    {/if}

    <p><button type="submit">Confirm &amp; save this roster</button>
    <span class="muted small">Saves it to history; then enter it into EMS.</span></p>
  </form>
{/if}
