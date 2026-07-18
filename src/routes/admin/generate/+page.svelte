<script lang="ts">
  import RosterEditor from '$lib/components/RosterEditor.svelte';
  let { data, form } = $props();
  const g = $derived(form?.generated);
</script>

<h1>Generate a roster</h1>

{#if !data.hasVolunteers}
  <div class="box warn">No volunteers yet — <a href="/admin/import">import a saved EMS page</a> first.</div>
{:else}
  <form method="GET" style="margin-bottom:1rem">
    <label>Week:
      <select name="date" onchange={(e) => e.currentTarget.form?.requestSubmit()}>
        <option value="" selected={!data.date}>— pick a week —</option>
        {#each data.weeks as w (w.date)}
          <option value={w.date} selected={w.date === data.date}>
            {w.label} — {w.count ? `${w.count} responded` : 'no responses yet'}
          </option>
        {/each}
      </select>
    </label>
  </form>

  {#if !data.date}
    <p class="muted">Pick a week above to see who's available and generate a draft.</p>
  {:else}
  <form method="POST" action="?/generate">
    <input type="hidden" name="date" value={data.date} />
    <p class="muted small">Generating for <strong>{data.date}</strong> — ticked from the poll; adjust as needed.</p>
    <div class="tablewrap">
    <table>
      <thead>
        <tr><th>Available</th><th>Volunteer</th><th>Requested role</th></tr>
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
            <td class="muted small">{v.requests || '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    </div>

    <p><button type="submit">Generate draft</button></p>
  </form>
  {/if}
{/if}

{#if form?.confirmed}
  <div class="box ok">Roster for {form.date} saved ({form.count} volunteers). It’s now part of history.</div>
{/if}

{#if g}
  <h2>Draft for {g.date}</h2>
  <p class="small muted">Adjust any assignment; the rule warnings update live. Then confirm — it's saved to
    history, then you enter it into EMS.</p>
  {#key g}
    <RosterEditor
      slots={g.rows.map((r) => ({ tid: r.tid, athleteId: r.athleteId }))}
      volunteers={data.volunteers}
      date={g.date}
      action="?/confirm"
      submitLabel="Confirm & save this roster" />
  {/key}
{/if}
