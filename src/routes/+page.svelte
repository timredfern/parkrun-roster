<script lang="ts">
  import { enhance } from '$app/forms';
  let { data, form } = $props();

  let dialog = $state<HTMLDialogElement>();
  let mode = $state<'any' | 'prefer' | 'only'>('any');

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

        <h3>Which Saturday?</h3>
        <div class="choices">
          {#each data.weeks as w (w.date)}
            <label class="choice"><input type="radio" name="date" value={w.date} required /> {w.label} <span class="muted small">— {w.count} so far</span></label>
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
              <label><input type="checkbox" name="role" value={r.tid} /> {r.name}</label>
            {/each}
          </div>
        {/if}

        <p class="small">
          <label><input type="checkbox" name="consent" /> I agree that my name and parkrun barcode may be stored to build the roster. They're kept privately and I can ask to be removed.</label>
        </p>
        <p><button type="submit">Submit</button></p>
      </form>
    </article>
  </dialog>
{/if}
