// Android: o que outro app compartilhou ("Compartilhar" → Ideario) vira uma nota nova; tocar na notificação de um
// lembrete abre a nota dele. Pergunta ao núcleo ao abrir e sempre que o app volta para a frente (compartilhar com o
// app já aberto o traz de volta).
import { api } from './api'
import { app } from './app.svelte'

async function take() {
  const shared = await api.takeShared().catch(() => null)
  if (shared?.note) {
    app.settingsOpen = false
    app.openNote(shared.note)
    return
  }
  if (!shared || (!shared.text?.trim() && !shared.subject?.trim() && !shared.files.length)) return
  app.settingsOpen = false
  app.openNew(undefined, { shared })
}

if (document.documentElement.dataset.platform === 'android') {
  void take()
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && void take())
}
