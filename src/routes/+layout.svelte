<script lang="ts">
  import '@picocss/pico/css/pico.min.css';
  import '../app.css';
  import { page } from '$app/state';
  let { children, data } = $props();
  const isAdmin = $derived(page.url.pathname.startsWith('/admin'));
</script>

<svelte:head>
  <title>{data.eventName} parkrun roster</title>
</svelte:head>

<header class="site">
  <div class="inner"><a href="/" class="brand"><strong>{data.eventName} parkrun roster</strong></a></div>
</header>

<main>
  {@render children()}
</main>

{#if !isAdmin}
  <footer class="site-footer"><a href="/admin" class="muted small">Coordinator →</a></footer>
{/if}
