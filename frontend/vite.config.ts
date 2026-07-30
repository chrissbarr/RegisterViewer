/// <reference types="vitest/config" />
import { execSync } from 'child_process'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function git(cmd: string): string {
  try {
    return execSync(`git ${cmd}`, { encoding: 'utf8' }).trim()
  } catch {
    return 'unknown'
  }
}

export default defineConfig({
  base: process.env.BASE_PATH || '/',
  plugins: [react(), tailwindcss()],
  define: {
    __GIT_HASH__: JSON.stringify(git('rev-parse --short HEAD')),
    __GIT_TAG__: JSON.stringify(git('describe --tags --abbrev=0')),
    __BUILD_DATE__: JSON.stringify(new Date().toISOString().split('T')[0]),
    __PERF_PROFILING__: JSON.stringify(!!process.env.VITE_PERF_PROFILING),
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
    coverage: {
      provider: 'v8',
      include: ['src/utils/**', 'src/context/**', 'src/hooks/**', 'src/components/**'],
      thresholds: {
        statements: 60,
        branches: 52,
        functions: 54,
        lines: 60,
      },
    },
  },
})
