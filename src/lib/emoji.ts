// Emoji grande de capa da nota. A regra é a mesma do núcleo (`clean_emoji` em src-tauri/src/store.rs).

/** Um emoji só (sequências com ZWJ, tom de pele, bandeiras e teclas incluídas), sem letras nem espaços; senão, null. */
export function cleanEmoji(s: string): string | null {
  const t = s.trim()
  const ok =
    t.length > 0 &&
    new TextEncoder().encode(t).length <= 32 &&
    /[^\x00-\x7f]/.test(t) &&
    !/[\s\p{Cc}A-Za-z]/u.test(t)
  return ok ? t : null
}
