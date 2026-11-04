// "Abrir em nova janela": um card numa janela só dele, ao lado do app (pedido do usuário). A janela carrega o mesmo
// app com `?card=<id>`: só o card aparece (o resto fica escondido) e fechar o card fecha a janela. O que se escreve
// numa janela chega à outra pelo aviso do núcleo (`tell_other_windows`, o mesmo do sync).
import { isTauri } from '@tauri-apps/api/core'

/** A nota desta janela, quando ela é a janela de um card. */
export const cardWindowNote: string | null = new URLSearchParams(location.search).get('card')

/** Só no app do computador: no celular não há janelas, e no navegador a prévia não divide os dados entre abas. */
export const canOpenWindows = isTauri() && document.documentElement.dataset.platform !== 'android' && !cardWindowNote

/** Abre a nota numa janela nova (ou traz para a frente a que já está aberta com ela). */
export async function openCardWindow(id: string, title: string) {
  const { WebviewWindow } = await import('@tauri-apps/api/webviewWindow')
  const label = `card-${id.replace(/[^a-zA-Z0-9_-]/g, '')}`
  const open = await WebviewWindow.getByLabel(label)
  if (open) return void open.setFocus()
  new WebviewWindow(label, {
    url: `index.html?card=${encodeURIComponent(id)}`,
    title: title.trim() || 'Ideario',
    width: 760,
    height: 900,
    minWidth: 360,
    minHeight: 420,
  })
}

/** Fecha esta janela (a do card), depois de o card ter salvado. */
export async function closeThisWindow() {
  if (!isTauri()) return window.close()
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().close()
}
