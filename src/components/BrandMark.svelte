<script lang="ts">
  // Ícone oficial do Ideario (o mesmo de src-tauri/icons/source/ideario.svg), desenhado inline para não piscar.
  const id = `ideario-grad-${Math.random().toString(36).slice(2, 8)}`
</script>

<svg class="brand-mark" viewBox="0 0 512 512" aria-hidden="true">
  <defs>
    <linearGradient {id} x1="256" y1="0" x2="256" y2="512" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFE563" />
      <stop offset="1" stop-color="#EE8700" />
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="128" fill="url(#{id})" />
  <rect x="128" y="128" width="112" height="112" rx="20" fill="#fff" />
  <rect x="272" y="128" width="112" height="40" rx="20" fill="#fff" />
  <rect x="272" y="200" width="112" height="40" rx="20" fill="#fff" />
  <rect x="128" y="272" width="256" height="40" rx="20" fill="#fff" />
  <rect x="128" y="344" width="256" height="40" rx="20" fill="#fff" />
</svg>
