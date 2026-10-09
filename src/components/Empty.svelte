<script lang="ts">
  import type { Component } from 'svelte'

  let { icon: Icon, title, text }: { icon: Component; title: string; text: string } = $props()
</script>

<div class="empty">
  <div class="empty-ico"><Icon /></div>
  <h3>{title}</h3>
  <p>{text}</p>
</div>
