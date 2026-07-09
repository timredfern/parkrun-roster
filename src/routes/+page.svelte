<script lang="ts">
  let { data, form } = $props();
  const weeksCsv = $derived(data.weeks.map((w) => w.date).join(','));

  // per-week job dropdowns (0 by default; "+ request role" adds one)
  let jobSlots = $state<Record<string, number>>({});
  const slotsFor = (d: string) => jobSlots[d] ?? 0;
  const addJob = (d: string) => (jobSlots[d] = slotsFor(d) + 1);

  // barcode lookup: only ask for a name when it's unknown
  let lookup = $state<{ known: boolean; name: string | null } | null>(null);
  async function checkBarcode(e: Event) {
    const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '');
    if (!digits) {
      lookup = null;
      return;
    }
    try {
      lookup = await (await fetch(`/lookup?barcode=${digits}`)).json();
    } catch {
      lookup = null;
    }
  }
  const showName = $derived((!!lookup && !lookup.known) || (!!form && 'needName' in form && !!form.needName));
</script>

<h1>{data.monthLabel} — volunteer poll</h1>

<div class="cards">
  <div class="card"><div class="n">{data.stats.volunteers}</div><div class="muted small">volunteers known</div></div>
  <div class="card"><div class="n">{data.stats.weeks}</div><div class="muted small">weeks of history</div></div>
  <div class="card"><div class="n">{data.rdEligibleCount}</div><div class="muted small">eligible run directors</div></div>
</div>

<h2>Responses so far</h2>
<div class="tablewrap">
  <table>
    <thead><tr><th>Saturday</th><th>Volunteers</th></tr></thead>
    <tbody>
      {#each data.weeks as w (w.date)}
        <tr><td>{w.label}</td><td>{w.count}</td></tr>
      {/each}
    </tbody>
  </table>
</div>

{#if !data.votable}
  <div class="box">This poll is closed (historical view). <a href="/">Go to the current poll →</a></div>
{:else}
  {#if form?.ok}
    <div class="box ok">Thanks{form.name ? `, ${form.name}` : ''}! Saved — you're down for {form.availCount} Saturday(s). Submit again any time to change your answers.</div>
  {:else if form?.error}
    <div class="box warn">{form.error}</div>
  {/if}

  <h2>Volunteer</h2>
  <form method="POST">
    <input type="hidden" name="weeks" value={weeksCsv} />
    <input type="hidden" name="month" value={data.month} />

    <p><strong>Your parkrun barcode</strong></p>
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

    <p class="small muted">Tick the Saturdays you can help; request a role only if you want one.</p>
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
{/if}
