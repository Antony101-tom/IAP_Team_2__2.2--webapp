import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // In dev, forward /api/* to the Express server so the frontend never has to
    // hard-code a backend address (and there are no CORS problems).
    proxy: {
      '/api': 'http://localhost:5000',
    },
  },
})
