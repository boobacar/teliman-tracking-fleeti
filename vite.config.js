import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Empreinte de build : affichée dans le menu latéral. Elle permet de répondre en une
// seconde à la question « est-ce que le navigateur me sert bien la dernière version ? »
// (un cache de service worker a déjà fait croire à un déploiement manquant le 23/09).
function shortCommit() {
  if (process.env.VITE_COMMIT) return process.env.VITE_COMMIT
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(process.env.npm_package_version || 'dev'),
    __APP_COMMIT__: JSON.stringify(shortCommit()),
    __APP_BUILD__: JSON.stringify(new Date().toISOString().slice(0, 16).replace('T', ' ')),
  },
  server: {
    host: '0.0.0.0',
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      '/uploads': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
    },
  },
  build: {
    target: 'es2020',
  },
})
