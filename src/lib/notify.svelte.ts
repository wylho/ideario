import { isTauri } from '@tauri-apps/api/core'
import { api } from './api'
import { app } from './app.svelte'
import { background } from './background.svelte'

// Lembretes que avisam (Fase 4). O núcleo confere a hora e mostra a notificação do sistema; aqui a janela mostra o
// mesmo aviso (com Abrir, Adiar e Concluir) e atende os botões da notificação que precisam da janela.

export interface Alert {
  id: string
  title: string
  at: number
  late: boolean
  repeats: boolean
}

/** Avisos na tela, o mais novo por último. */
export const alerts = $state<{ list: Alert[] }>({ list: [] })

const SNOOZE_MS = 10 * 60 * 1000
const TIP_KEY = 'ideario.tip.background'

export function dismiss(id: string) {
  alerts.list = alerts.list.filter((a) => a.id !== id)
}

export function openAlert(a: Alert) {
  dismiss(a.id)
  app.openNote(a.id)
}

export function snooze(a: Alert) {
  dismiss(a.id)
  void api.updateNote(a.id, { reminderAt: Date.now() + SNOOZE_MS, reminderDone: false })
  app.say('Adiado por 10 minutos')
}

export function complete(a: Alert) {
  dismiss(a.id)
  void api.setReminderDone(a.id, true)
}

if (isTauri()) {
  void import('@tauri-apps/api/event').then(({ listen }) => {
    void listen<Alert[]>('reminders', (e) => {
      const fresh = e.payload.filter((a) => !alerts.list.some((x) => x.id === a.id))
      alerts.list = [...alerts.list, ...fresh].slice(-4)
    })
    // botões da notificação do sistema
    void listen<string>('open-note', (e) => {
      dismiss(e.payload)
      app.openNote(e.payload)
    })
    void listen<string>('open-view', () => app.setView('reminders'))
  })
}

/** Ao marcar um lembrete: com o segundo plano desligado, sugere ligar (uma vez), para avisar com a janela fechada. */
export async function reminderSet() {
  if (!isTauri() || background.enabled) return
  try {
    if (localStorage.getItem(TIP_KEY)) return
    localStorage.setItem(TIP_KEY, '1')
  } catch {
    return
  }
  app.say('Para avisar com a janela fechada, deixe o Ideario na bandeja', { label: 'Ligar', run: () => background.set(true) })
}
