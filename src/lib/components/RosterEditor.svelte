<script lang="ts">
  // Editable roster with LIVE rule-checking. Used for both the generated draft (?/confirm) and
  // editing a saved roster (?/save). Each role slot is a dropdown; warnings recompute as you change
  // any slot. It warns, never blocks — overrides are the coordinator's call after review.
  import { untrack } from 'svelte';
  import { checkRoster } from '$lib/core/check';
  import { roleName } from '$lib/core/rules';

  interface Vol {
    athleteId: number;
    name: string;
    rdEligible: boolean;
  }
  interface Slot {
    tid: number;
    athleteId: number | null;
  }
  let {
    slots,
    volunteers,
    date,
    action,
    submitLabel,
    extras = [],
  }: {
    slots: Slot[];
    volunteers: Vol[];
    date: string;
    action: string;
    submitLabel: string;
    extras?: { tid: number; athleteId: number }[];
  } = $props();

  // Seed local editable state from the initial slots; the parent remounts (via {#key}) to reset.
  let rows = $state(untrack(() => slots.map((s) => ({ ...s }))));
  const people = $derived(new Map(volunteers.map((v) => [v.athleteId, { rdEligible: v.rdEligible, name: v.name }])));
  const issues = $derived(checkRoster([...rows, ...extras], people));
  const badPeople = $derived(new Set(issues.flatMap((i) => i.athleteIds)));
</script>

<form method="POST" {action}>
  <input type="hidden" name="date" value={date} />
  <div class="draft">
    {#each rows as row, i (i)}
      <div class="draftrow" class:bad={row.athleteId != null && badPeople.has(row.athleteId)} class:empty={row.athleteId == null}>
        <input type="hidden" name={`tid_${i}`} value={row.tid} />
        <input type="hidden" name={`slot_${i}`} value={row.athleteId ?? ''} />
        <div class="draftrole">{roleName(row.tid)}</div>
        <select bind:value={row.athleteId}>
          <option value={null}>— unfilled —</option>
          {#each volunteers as v (v.athleteId)}
            <option value={v.athleteId}>{v.name}{v.rdEligible ? ' · RD' : ''}</option>
          {/each}
        </select>
      </div>
    {/each}
    <!-- Preserve any saved rows beyond the standard slots (rare) so a Save never drops them. -->
    {#each extras as ex, j (j)}
      <input type="hidden" name={`tid_${rows.length + j}`} value={ex.tid} />
      <input type="hidden" name={`slot_${rows.length + j}`} value={ex.athleteId} />
    {/each}
  </div>

  {#if extras.length}
    <p class="small muted">
      Plus {extras.length} extra assignment(s) kept from the saved record: {extras.map((e) => roleName(e.tid)).join(', ')}.
    </p>
  {/if}

  {#if issues.length}
    <div class="box warn">
      <strong>Rule warnings</strong> — these don't block saving:
      <ul>{#each issues as x}<li>{x.message}</li>{/each}</ul>
    </div>
  {:else}
    <div class="box ok">No rule issues.</div>
  {/if}

  <p><button type="submit">{submitLabel}</button></p>
</form>
