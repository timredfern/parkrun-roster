<script lang="ts">
  import RosterEditor from '$lib/components/RosterEditor.svelte';
  let { data, form } = $props();
  const selectedLabel = $derived(data.dates.find((d) => d.date === data.selected)?.label ?? data.selected);
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

  {#if form?.saved}
    <div class="box ok">
      Saved changes to the {form.date} roster ({form.count} people).{#if form.warnings?.length}
        Rule warnings remain (see below).{/if}
    </div>
  {/if}

  {#if data.selected}
    <h2>{selectedLabel} — edit this roster</h2>
    <p class="small muted">Adjust any slot after review. Warnings update live; saving overwrites this
      week's saved roster.</p>
    {#key data.selected}
      <RosterEditor
        slots={data.slots}
        volunteers={data.volunteers}
        date={data.selected}
        extras={data.extras}
        action={`?/save&date=${data.selected}`}
        submitLabel="Save changes" />
    {/key}
  {/if}
{/if}
