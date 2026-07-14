<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props();

  let dialog = $state<HTMLDialogElement>();
  let mode = $state<'any' | 'prefer' | 'only'>('any');
  let selectedDate = $state('');
  let selectedRoles = $state<number[]>([]);

  // barcode lookup: ask for a name only when unknown; pre-fill an existing signup for this month.
  type Lookup = { known: boolean; name: string | null; current: { date: string; mode: string; roles: number[] } | null };
  let lookup = $state<Lookup | null>(null);
  async function checkBarcode(e: Event) {
    const digits = (e.currentTarget as HTMLInputElement).value.replace(/[^0-9]/g, '');
    if (!digits) {
      lookup = null;
      return;
    }
    try {
      lookup = await (await fetch(`/lookup?barcode=${digits}`)).json();
      if (lookup?.current) {
        selectedDate = lookup.current.date;
        mode = (['any', 'prefer', 'only'].includes(lookup.current.mode) ? lookup.current.mode : 'any') as 'any' | 'prefer' | 'only';
        selectedRoles = lookup.current.roles;
      }
    } catch {
      lookup = null;
    }
  }
  const showName = $derived((!!lookup && !lookup.known) || (!!form && 'needName' in form && !!form.needName));
  const currentLabel = $derived.by(() => {
    const c = lookup?.current;
    if (!c) return '';
    return data.weeks.find((w) => w.date === c.date)?.label ?? c.date;
  });
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
  <p><button onclick={() => dialog?.showModal()}>Volunteer for {data.monthLabel} →</button></p>

  <dialog bind:this={dialog}>
    <article>
      <header class="dlg-head">
        <strong>Volunteer — {data.monthLabel}</strong>
        <button class="secondary close-x" aria-label="Close" onclick={() => dialog?.close()}>✕</button>
      </header>

      {#if form?.ok}
        <div class="box ok">Thanks{form.name ? `, ${form.name}` : ''}! You're down for {form.date}. Submit again any time to change it.</div>
      {:else if form?.error}
        <div class="box warn">{form.error}</div>
      {/if}

      <form method="POST" use:enhance>
        <input type="hidden" name="month" value={data.month} />

        <p><strong>Your parkrun barcode</strong></p>
        <p><input name="barcode" placeholder="A1234567" value={form?.barcode ?? ''} onblur={checkBarcode} /></p>
        {#if lookup?.known}
          <p class="small ok-text">✓ Welcome back, {lookup.name}</p>
        {/if}
        {#if showName}
          <p class="small muted">We don't have you yet — add your name once and we'll remember you:</p>
          <p class="small">
            First name <input name="first" value={form?.first ?? ''} />
            Surname <input name="last" value={form?.last ?? ''} />
          </p>
          <p class="small">
            <label><input type="checkbox" name="consent" /> I agree that my name and parkrun barcode may be stored to build the roster. They're kept privately and I can ask to be removed.</label>
          </p>
        {/if}

        {#if lookup?.current}
          <div class="box">You're already down for <strong>{currentLabel}</strong>. Change it below, or just close to keep it.</div>
        {/if}

        <h3>Which Saturday?</h3>
        <div class="choices">
          {#each data.weeks as w (w.date)}
            <label class="choice"><input type="radio" name="date" value={w.date} bind:group={selectedDate} /> {w.label} <span class="muted small">— {w.count} so far</span></label>
          {/each}
        </div>

        <h3>Which role?</h3>
        <div class="choices">
          <label class="choice"><input type="radio" name="mode" value="any" bind:group={mode} /> Any role <span class="muted small">— put me where I'm needed</span></label>
          <label class="choice"><input type="radio" name="mode" value="prefer" bind:group={mode} /> I'd prefer… <span class="muted small">(but I'll do others if needed)</span></label>
          <label class="choice"><input type="radio" name="mode" value="only" bind:group={mode} /> I can only do… <span class="muted small">(please don't put me elsewhere)</span></label>
        </div>
        {#if mode !== 'any'}
          <div class="rolegrid">
            {#each data.roles as r (r.tid)}
              <label><input type="checkbox" name="role" value={r.tid} bind:group={selectedRoles} /> {r.name}</label>
            {/each}
          </div>
        {/if}

        <p><button type="submit">Submit</button></p>
      </form>
    </article>
  </dialog>
{/if}
