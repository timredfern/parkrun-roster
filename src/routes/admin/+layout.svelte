<script lang="ts">
  let { children } = $props();
</script>

<nav class="adminnav">
  <a href="/admin/generate">Generate</a>
  <a href="/admin/import">Import EMS</a>
  <a href="/">← View site</a>
</nav>

{@render children()}
