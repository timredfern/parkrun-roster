<script lang="ts">
  import '@picocss/pico/css/pico.min.css';
  import '../app.css';
  import { page } from '$app/state';
  let { children, data } = $props();
  const isAdmin = $derived(page.url.pathname.startsWith('/admin'));
</script>

<header class="site">
  <div class="inner"><strong>{data.eventName} · Roster</strong></div>
</header>

<main>
  {@render children()}
</main>

{#if !isAdmin}
  <footer class="site-footer"><a href="/admin" class="muted small">Coordinator →</a></footer>
{/if}
