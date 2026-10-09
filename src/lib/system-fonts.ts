// Aplica a fonte da área de trabalho que o núcleo Rust detectou (só no Linux; ver src-tauri/src/system_fonts.rs).
// Nos outros sistemas `system-ui` já resolve para a fonte nativa e nada é injetado.

declare global {
  interface Window {
    __IDEARIO_SYSTEM_FONTS__?: { ui?: string | null; mono?: string | null }
  }
}

const quote = (family: string) => `"${family.replace(/["\\]/g, '')}"`

export function applySystemFonts() {
  const fonts = window.__IDEARIO_SYSTEM_FONTS__
  const root = document.documentElement.style
  if (fonts?.ui) root.setProperty('--font-system', quote(fonts.ui))
  if (fonts?.mono) root.setProperty('--font-system-mono', quote(fonts.mono))
}
