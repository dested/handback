import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Main build: the side panel (React) + the MV3 service worker.
 * The content script is built separately (see vite.content.config.ts) because it
 * must be a self-contained IIFE, not an ES module.
 */
export default defineConfig({
  plugins: [react()],
  // The transcription worker is loaded with {type:'module'} — make Vite emit it
  // as ES explicitly instead of leaning on the IIFE default happening to work.
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    rollupOptions: {
      input: {
        sidepanel: 'sidepanel.html',
        background: 'src/background/index.ts',
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
});
