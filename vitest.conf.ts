/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      'dist', '.idea', '.git', '.cache',
      '**/node_modules/**', 'examples/**'
    ],
    coverage: {
      reporter: ['lcov'],
      enabled: true,
      include: [
        'src/**'
      ],
      exclude: [
        '**/build/**',
        '**/__fixtures__/**',
        '**/*.test.ts',
        '**/__mocks__/**',
        '**/.wdio-vscode-service/**',
        '**/node_modules/**',
        '**/__generated__/**',
        '**/__generated-platform__/**',
        // ignore until we bring up coverage
        'src/client',
        // vendored code
        'src/extension/wasm',
        'src/client/components/aws/**',
        'src/client/components/gcp/**',
      ],
      thresholds: {
        statements: 43,
        branches: 79,
        functions: 32,
        lines: 43,
      }
    }
  }
})
