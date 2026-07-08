<script lang="ts">
  let { form } = $props();
</script>

<h1>Import from EMS</h1>
<p class="muted">
  In EMS, open the Volunteer Rosters page (use the “weeks back” control to include past weeks for
  history), then <strong>Save Page As</strong> and upload the saved <code>.html</code> file(s) here.
  Re-importing is safe — overlapping weeks are merged.
</p>

<form method="POST" enctype="multipart/form-data">
  <p><input type="file" name="pages" accept=".html,text/html" multiple required /></p>
  <p><button type="submit">Import</button></p>
</form>

{#if form?.ok}
  <div class="box ok">
    Imported {form.fileCount} file(s): {form.volunteers} volunteers, {form.weeks} week(s),
    {form.entries} roster entries added/updated.
    <div class="small"><a href="/">Back to status</a> · <a href="/generate">Generate a roster</a></div>
  </div>
{:else if form?.error}
  <div class="box warn">Couldn’t import: {form.error}</div>
{/if}
