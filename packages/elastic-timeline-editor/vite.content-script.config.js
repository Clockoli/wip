import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    outDir: resolve(import.meta.dirname, '../../src/content'),
    emptyOutDir: false,
    lib: {
      entry: resolve(import.meta.dirname, 'src/timeline/index.js'),
      name: 'ElasticTimelineEditor',
      formats: ['iife'],
      fileName: 'elastic-timeline-editor',
    },
    rollupOptions: {
      output: { entryFileNames: 'elastic-timeline-editor.js' },
    },
    cssCodeSplit: false,
  },
})
