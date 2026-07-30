import { defineConfig } from 'vite';

/**
 * Content script build. Must be a single classic script (IIFE) with everything
 * inlined — MV3 content scripts can't use ESM imports at runtime.
 * Runs after the main build with emptyOutDir: false so it lands in the same dist/.
 */
export default defineConfig({
  build: {
    outDir: 'dist',
    emptyOutDir: false,
    target: 'chrome120',
    cssCodeSplit: false,
    lib: {
      entry: 'src/content/index.ts',
      name: 'HandbackContent',
      formats: ['iife'],
      fileName: () => 'content.js',
    },
  },
});
