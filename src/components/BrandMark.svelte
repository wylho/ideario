<script lang="ts">
  // Ícone oficial do Ideario (o mesmo de src-tauri/icons/source/ideario.svg), desenhado inline para não piscar.
  const u = `ideario-${Math.random().toString(36).slice(2, 8)}`
</script>

<svg class="brand-mark" viewBox="0 0 512 512" fill="none" aria-hidden="true">
  <rect width="512" height="512" rx="115" fill="white"/>
  <g clip-path="url(#{u}-0)">
    <rect x="256" y="56" width="160" height="160" rx="32" fill="url(#{u}-1)"/>
    <rect x="134" y="144" width="244" height="224" rx="36" fill="url(#{u}-2)"/>
    <rect x="96" y="296" width="160" height="160" rx="32" fill="url(#{u}-3)"/>
  </g>
  <defs>
    <linearGradient id="{u}-1" x1="256" y1="216" x2="416" y2="56" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0068FF"/>
      <stop offset="1" stop-color="#0068FF" stop-opacity="0.7"/>
    </linearGradient>
    <linearGradient id="{u}-2" x1="153.18" y1="368" x2="376.364" y2="163.11" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5900FF"/>
      <stop offset="1" stop-color="#5900FF" stop-opacity="0.7"/>
    </linearGradient>
    <linearGradient id="{u}-3" x1="96" y1="456" x2="256" y2="296" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFD500"/>
      <stop offset="1" stop-color="#FFD500" stop-opacity="0.8"/>
    </linearGradient>
    <clipPath id="{u}-0">
      <rect width="320" height="400" fill="white" transform="translate(96 56)"/>
    </clipPath>
  </defs>
</svg>
