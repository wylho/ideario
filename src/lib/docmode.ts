// Notas usadas como documento: abrem já em página inteira (a escolha fica no aparelho).
const KEY = 'ideario.docNotes'

function read(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []
  } catch {
    return []
  }
}

export const isDocNote = (id: string) => read().includes(id)

export function setDocNote(id: string, on: boolean) {
  const ids = read().filter((x) => x !== id)
  if (on) ids.push(id)
  try {
    // só as 500 mais recentes
    localStorage.setItem(KEY, JSON.stringify(ids.slice(-500)))
  } catch {
    // sem armazenamento: vale só agora
  }
}
