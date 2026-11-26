import { defineConfig } from 'vitest/config'

// Unit tests cover pure networking helpers; they don't need the React/Tailwind plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
})
