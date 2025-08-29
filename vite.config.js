import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    include: ['@0xzk/matching-engine']
  },
  build: {
    rollupOptions: {
      external: ['@0xzk/matching-engine']
    }
  }
})