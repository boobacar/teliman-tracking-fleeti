import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const sourceFiles = ['src/**/*.{js,jsx}']
const nodeFiles = [
  'server.js',
  'vite.config.js',
  'eslint.config.js',
  'migrate-fuel-proofs.js',
  'scripts/**/*.js',
  'tests/**/*.js',
]

export default defineConfig([
  globalIgnores(['dist', 'node_modules', 'coverage']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 'latest',
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['error', {
        varsIgnorePattern: '^[A-Z_]',
        argsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
    },
  },
  {
    files: sourceFiles,
    extends: [
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
    rules: {
      // Les synchronisations contrôlées de composants existants reposent sur des effets.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  {
    files: ['src/components/ConfirmDialog.jsx', 'src/components/Layout.jsx'],
    rules: {
      // Ces modules exportent volontairement une primitive React et sa configuration associée.
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: nodeFiles,
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ['public/sw.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
])
