import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // En desarrollo con VITE_STORAGE=api, las llamadas /api van al backend local
    proxy: { '/api': 'http://localhost:3000' },
  },
})
