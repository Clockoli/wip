import { defineConfig } from 'vite'
import { resolve } from 'node:path'

export default defineConfig({
  build: {
    lib: {
      entry: resolve(import.meta.dirname, 'src/timeline/index.js'),
      name: 'ElasticTimelineEditor',
      formats: ['es'],
      fileName: 'elastic-timeline-editor',
    },
    cssCodeSplit: false,
  },
})
