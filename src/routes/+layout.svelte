<script lang="ts">
  import '@picocss/pico/css/pico.min.css';
  import '../app.css';
  let { children, data } = $props();
</script>

<header class="site">
  <div class="inner">
    <strong>{data.eventName} · Roster</strong>
    <nav>
      <a href="/">Status</a>
      <a href="/poll">Poll</a>
      <a href="/generate">Generate</a>
      <a href="/import">Import EMS</a>
    </nav>
  </div>
</header>

<main>
  {@render children()}
</main>
