<script lang="ts">
  // Ícone oficial do Ideario (o mesmo de src-tauri/icons/source/ideario.svg), desenhado inline para não piscar.
  const u = `ideario-${Math.random().toString(36).slice(2, 8)}`
</script>

<svg class="brand-mark" viewBox="0 0 512 512" fill="none" aria-hidden="true">
  <rect width="512" height="512" rx="115" fill="white"/>
  <g clip-path="url(#{u}-0)">
    <rect x="96" y="64" width="178" height="179" rx="32" fill="url(#{u}-3)"/>
    <g filter="url(#{u}-1)">
      <rect x="148" y="149" width="215" height="215" rx="36" fill="url(#{u}-4)"/>
    </g>
    <g filter="url(#{u}-2)">
      <rect x="238" y="269" width="178" height="179" rx="32" fill="url(#{u}-5)"/>
    </g>
  </g>
  <defs>
    <filter id="{u}-1" x="148" y="149" width="225" height="225" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dx="10" dy="10"/>
      <feGaussianBlur stdDeviation="15"/>
      <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0.34902 0 0 0 0 0 0 0 0 0 1 0 0 0 1 0"/>
      <feBlend mode="lighten" in2="shape" result="effect1_innerShadow_1607_11"/>
    </filter>
    <filter id="{u}-2" x="238" y="269" width="188" height="189" filterUnits="userSpaceOnUse" color-interpolation-filters="sRGB">
      <feFlood flood-opacity="0" result="BackgroundImageFix"/>
      <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape"/>
      <feColorMatrix in="SourceAlpha" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 127 0" result="hardAlpha"/>
      <feOffset dx="10" dy="10"/>
      <feGaussianBlur stdDeviation="15"/>
      <feComposite in2="hardAlpha" operator="arithmetic" k2="-1" k3="1"/>
      <feColorMatrix type="matrix" values="0 0 0 0 0 0 0 0 0 0.407843 0 0 0 0 1 0 0 0 1 0"/>
      <feBlend mode="lighten" in2="shape" result="effect1_innerShadow_1607_11"/>
    </filter>
    <linearGradient id="{u}-3" x1="274" y1="243" x2="95.0028" y2="65.0028" gradientUnits="userSpaceOnUse">
      <stop stop-color="#5900FF"/>
      <stop offset="1" stop-color="#5900FF" stop-opacity="0.8"/>
    </linearGradient>
    <linearGradient id="{u}-4" x1="363" y1="364" x2="148" y2="149" gradientUnits="userSpaceOnUse">
      <stop stop-color="#0068FF"/>
      <stop offset="1" stop-color="#0068FF" stop-opacity="0.9"/>
    </linearGradient>
    <linearGradient id="{u}-5" x1="416" y1="448" x2="237.003" y2="270.003" gradientUnits="userSpaceOnUse">
      <stop stop-color="#FFD500"/>
      <stop offset="1" stop-color="#FFD500" stop-opacity="0.9"/>
    </linearGradient>
    <clipPath id="{u}-0">
      <rect width="320" height="384" fill="white" transform="translate(96 64)"/>
    </clipPath>
  </defs>
</svg>
