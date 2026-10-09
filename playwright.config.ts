import { defineConfig, devices } from '@playwright/test'

// Testes de comportamento da UI contra os dados de exemplo (mock), no navegador.
export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  reporter: process.env.CI ? 'github' : 'list',
  use: {
    baseURL: 'http://localhost:4173',
    viewport: { width: 440, height: 900 },
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
    // Microfone e câmera falsos, para testar o gravador e a câmera sem hardware.
    launchOptions: { args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 440, height: 900 } } }],
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
})
