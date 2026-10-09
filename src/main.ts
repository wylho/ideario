import './app.css'
import { mount } from 'svelte'
import App from './App.svelte'
import { applySystemFonts } from './lib/system-fonts'
import './lib/theme.svelte'

applySystemFonts()

export default mount(App, { target: document.getElementById('app')! })
