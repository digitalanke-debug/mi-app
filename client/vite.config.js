import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// Identificador de cada compilación: el navegador lo compara con el del servidor para avisar que hay una versión nueva
const BUILD_ID = Date.now().toString(36)
const versionFile = () => ({ name: 'crm-version', generateBundle() { this.emitFile({ type: 'asset', fileName: 'version.json', source: JSON.stringify({ build: BUILD_ID }) }) } })

export default defineConfig({
  plugins: [react(), versionFile()],
  define: { __BUILD_ID__: JSON.stringify(BUILD_ID) },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4000',
      '/socket.io': { target: 'http://localhost:4000', ws: true },
    },
  },
})
