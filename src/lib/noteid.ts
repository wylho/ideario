import { t } from '@wylho/atrio'

// ID curto da nota, para falar dela com o Claude (MCP): "#" + os 8 últimos caracteres do id (a parte aleatória do
// UUID; o começo é a data, igual em notas criadas juntas). O MCP aceita o curto ou o id inteiro.
export const shortId = (id: string) => '#' + id.replace(/-/g, '').slice(-8)

/** Copia o ID curto e avisa. */
export async function copyNoteId(id: string, say: (msg: string) => void) {
  const short = shortId(id)
  try {
    await navigator.clipboard.writeText(short)
    say(t('ID {id} copiado: diga ao Claude "na nota {id}…"', { id: short }))
  } catch {
    say(t('Não foi possível copiar'))
  }
}
