// Gravador de voz e câmera, para a nota. Só aparecem onde o aparelho tem microfone ou câmera.
import { app } from './app.svelte'

export const canRecord = () => typeof MediaRecorder !== 'undefined' && !!navigator.mediaDevices?.getUserMedia

/** Há câmera? (sem pedir permissão: a lista de dispositivos diz o tipo mesmo sem os nomes). */
export async function hasCamera() {
  try {
    return (await navigator.mediaDevices?.enumerateDevices())?.some((d) => d.kind === 'videoinput') ?? false
  } catch {
    return false
  }
}

const ext = (mime: string) => (mime.includes('mp4') ? 'm4a' : mime.includes('ogg') ? 'ogg' : 'webm')
const stamp = () => {
  const d = new Date()
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getDate())}-${p(d.getMonth() + 1)} ${p(d.getHours())}h${p(d.getMinutes())}`
}

export class Recorder {
  recording = $state(false)
  seconds = $state(0)
  private rec: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private timer: ReturnType<typeof setInterval> | undefined

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch {
      app.say('Sem acesso ao microfone')
      return false
    }
    this.chunks = []
    this.rec = new MediaRecorder(this.stream)
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data)
    this.rec.start(250)
    const started = Date.now()
    this.seconds = 0
    this.timer = setInterval(() => (this.seconds = Math.floor((Date.now() - started) / 1000)), 250)
    this.recording = true
    return true
  }

  /** Para e devolve o áudio, com um nome como "Gravação 09-10 15h42.webm". */
  stop(): Promise<{ blob: Blob; name: string } | null> {
    const rec = this.rec
    if (!rec) return Promise.resolve(null)
    return new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || 'audio/webm'
        this.cleanup()
        resolve({ blob: new Blob(this.chunks, { type }), name: `Gravação ${stamp()}.${ext(type)}` })
      }
      rec.stop()
    })
  }

  cancel() {
    if (this.rec) {
      this.rec.onstop = () => this.cleanup()
      this.rec.stop()
    }
  }

  private cleanup() {
    clearInterval(this.timer)
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    this.rec = null
    this.recording = false
  }
}

export const fmtSeconds = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
export const photoName = () => `Foto ${stamp()}.jpg`
