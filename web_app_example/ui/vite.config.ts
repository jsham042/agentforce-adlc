import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

const frontendPort = parseInt(process.env.FRONTEND_PORT || '3001')
const backendPort = parseInt(process.env.PORT || '8001')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: resolve(__dirname, '../harness/static'),
    emptyOutDir: true,
  },
  optimizeDeps: {
    include: ['react-markdown', 'remark-gfm'],
  },
  server: {
    port: frontendPort,
    proxy: {
      '/api': {
        target: `http://localhost:${backendPort}`,
        changeOrigin: true,
      },
      '/ws': {
        target: `ws://localhost:${backendPort}`,
        ws: true,
      },
    },
  },
})
