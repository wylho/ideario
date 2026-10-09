import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { applySystemFonts } from './lib/system-fonts'
import './lib/theme.svelte'
import './lib/background.svelte'

applySystemFonts()

// Um app, não um site: sem o menu do navegador (Voltar, Recarregar, Inspecionar).
// Campos de texto e o editor mantêm o menu nativo (copiar, colar, corretor ortográfico).
// Os menus do Ideario tratam o evento antes, no próprio elemento.
document.addEventListener('contextmenu', (e) => {
  if ((e.target as Element).closest?.('input, textarea, [contenteditable="true"]')) return
  e.preventDefault()
})

export default mount(App, { target: document.getElementById('app')! })
