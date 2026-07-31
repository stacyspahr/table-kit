import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // The queue touches localStorage, document, and navigator.onLine.
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
  },
})
