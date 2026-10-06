// eslint.config.mjs — Voidcast linter setup (Phase 1: warnings-only).
//
// Every rule below is set to "warn" on purpose, so `npm run lint` can never
// block a build or a PR while the existing backlog is being cleared. Once a
// rule reports zero hits across the repo, promote it to "error" one at a time.
//
// Phase 2 (when the backlog is clean), replace the curated `rules` lists with
// the full presets and add type-aware rules that need your tsconfig:
//
//   import js from '@eslint/js'
//   ...js.configs.recommended,
//   ...tseslint.configs.recommended,
//   ...tseslint.configs.recommendedTypeChecked,  // needs parserOptions.projectService
//
// Type-aware rules worth adding first: @typescript-eslint/no-floating-promises,
// no-misused-promises (both very relevant to the async IPC + agent loop).

import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import prettier from 'eslint-config-prettier'
import globals from 'globals'

// Rules shared by plain JS and TS files.
const baseRules = {
  // Correctness — patterns that are almost always a bug.
  'no-unreachable': 'warn',
  'no-constant-condition': 'warn',
  'no-dupe-keys': 'warn',
  'no-dupe-args': 'warn',
  'no-duplicate-case': 'warn',
  'no-fallthrough': 'warn',
  'no-self-assign': 'warn',
  'no-self-compare': 'warn',
  'no-unsafe-negation': 'warn',
  'no-unsafe-optional-chaining': 'warn',
  'no-compare-neg-zero': 'warn',
  'use-isnan': 'warn',
  'valid-typeof': 'warn',
  'no-throw-literal': 'warn',

  // Hygiene.
  'no-debugger': 'warn',
  'no-console': 'warn',
  'no-var': 'warn',
  'prefer-const': 'warn',
  eqeqeq: ['warn', 'smart'],
}

// TypeScript-specific rules.
const tsRules = {
  ...baseRules,
  '@typescript-eslint/no-unused-vars': [
    'warn',
    {
      argsIgnorePattern: '^_',
      varsIgnorePattern: '^_',
      caughtErrorsIgnorePattern: '^_',
      ignoreRestSiblings: true,
    },
  ],
  '@typescript-eslint/no-explicit-any': 'warn',
  '@typescript-eslint/no-empty-function': 'warn',
  '@typescript-eslint/no-non-null-assertion': 'warn',
  '@typescript-eslint/ban-ts-comment': ['warn', { 'ts-ignore': 'allow-with-description' }],
}

export default [
  {
    ignores: [
      'dist/**',
      'dist-electron/**',
      'release/**',
      'coverage/**',
      'node_modules/**',
      '**/*.d.ts',
    ],
  },

  // Plain JS / config files.
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: baseRules,
  },

  // TypeScript (main process, renderer, tests).
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    plugins: {
      '@typescript-eslint': tseslint.plugin,
    },
    rules: tsRules,
  },

  // React hooks — renderer only.
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: {
      'react-hooks': reactHooks,
    },
    rules: {
      'react-hooks/rules-of-hooks': 'warn',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // Must stay last: disables any ESLint rule that would fight Prettier.
  prettier,
]
