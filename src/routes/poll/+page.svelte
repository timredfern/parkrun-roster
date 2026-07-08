<script lang="ts">
  let { data, form } = $props();
  const weeksCsv = $derived(data.weeks.map((w) => w.date).join(','));

  // How many job dropdowns to show per week (default 0). "+ request role" bumps it.
  let jobSlots = $state<Record<string, number>>({});
  const slotsFor = (date: string) => jobSlots[date] ?? 0;
  const addJob = (date: string) => (jobSlots[date] = slotsFor(date) + 1);

  // Barcode: look it up live so we only ask for a name when it's unknown.
  let lookup = $state<{ known: boolean; name: string | null } | null>(null);
  async function checkBarcode(e: Event) {
    const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '');
    if (!digits) {
      lookup = null;
      return;
    }
    try {
      lookup = await (await fetch(`/poll/lookup?barcode=${digits}`)).json();
    } catch {
      lookup = null;
    }
  }
  const showName = $derived((!!lookup && !lookup.known) || (!!form && 'needName' in form && !!form.needName));
</script>

<h1>Volunteer poll</h1>
<p class="muted">Let us know which Saturdays you can help, and any jobs you'd prefer.</p>

{#if form?.ok}
  <div class="box ok">Thanks{form.name ? `, ${form.name}` : ''}! Saved — you're down for {form.availCount} Saturday(s). Submit again any time to change your answers.</div>
{:else if form?.error}
  <div class="box warn">{form.error}</div>
{/if}

<form method="POST">
  <input type="hidden" name="weeks" value={weeksCsv} />

  <h2>Your parkrun barcode</h2>
  <p><input name="barcode" placeholder="A1234567" value={form?.barcode ?? ''} onblur={checkBarcode} required /></p>
  {#if lookup?.known}
    <p class="small ok-text">✓ Welcome back, {lookup.name}</p>
  {/if}
  {#if showName}
    <p class="small muted">We don't have you yet — add your name once and we'll remember you:</p>
    <p class="small">
      First name <input name="first" value={form?.first ?? ''} />
      Surname <input name="last" value={form?.last ?? ''} />
    </p>
  {/if}

  <h2>Which Saturdays in {data.monthLabel}?</h2>
  <p class="small muted">Tick the dates you can help. By default you'll go where you're needed — request a specific role only if you want one.</p>
  {#each data.weeks as w (w.date)}
    <div class="week">
      <label class="wk"><input type="checkbox" name={`avail_${w.date}`} /> <strong>{w.label}</strong></label>
      <div class="jobs">
        {#each Array(slotsFor(w.date)) as _, i (i)}
          <select name={`job_${w.date}`}>
            <option value="">— choose a role —</option>
            {#each data.roles as r (r.tid)}
              <option value={r.tid}>{r.name}</option>
            {/each}
          </select>
        {/each}
        <button type="button" class="secondary addjob" onclick={() => addJob(w.date)}>+ request role</button>
      </div>
    </div>
  {/each}

  <p class="small">
    <label><input type="checkbox" name="consent" /> I agree that my name and parkrun barcode may be stored to build the roster. They're kept privately and I can ask to be removed.</label>
  </p>
  <p><button type="submit">Submit</button></p>
</form>
