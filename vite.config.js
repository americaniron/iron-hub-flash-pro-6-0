import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // Pages keeps hashed modules at the edge. The revision in the URL makes
    // a new deployment fetch the current application entry and lazy chunks.
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-hub-r2-[hash].js',
        chunkFileNames: 'assets/[name]-hub-r2-[hash].js'
      }
    }
  },
  // Relative assets let the exact same build run at the standalone root and
  // below IronSuite's authenticated /hub-proxy/ iframe path.
  base: './',
  server: {
    port: 3000,
    host: '0.0.0.0'
  },
  preview: {
    port: 3000,
    host: '0.0.0.0'
  }
})
