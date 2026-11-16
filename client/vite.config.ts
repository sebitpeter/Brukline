import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Ports 4100/5273 so Brukline can run next to Mobit (4000/5173) on the same computer.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5273,
    strictPort: true,
    proxy: { '/api': 'http://localhost:4100' },
  },
  preview: { port: 5273 },
})
