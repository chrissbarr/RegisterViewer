import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist', 'coverage', '.vite']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        destructuredArrayIgnorePattern: '^_',
      }],
      // React Compiler readiness rules, newly added to react-hooks'
      // recommended config in v7.1. They flag deliberate, documented
      // patterns in this codebase (render-time ref syncing, etc.) and were
      // not active prior to the ESLint 10 upgrade. Deferred — adopting them
      // is tracked as separate work; disabling here keeps lint behavior
      // unchanged across the upgrade.
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/context/**/*.{ts,tsx}', 'src/components/common/announcer.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
])
