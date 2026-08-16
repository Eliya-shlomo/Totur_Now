import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    // `.claude/**` holds agent worktrees — full checkouts of this repo at some
    // older commit. Without it, `npm run lint` reports every file twice and the
    // second copy's errors are against code that is not on this branch.
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/build/**',
      '**/.husky/**',
      'docs/**',
      '.claude/**',
    ],
  },

  js.configs.recommended,

  // ── client ──────────────────────────────────────────────────────────────
  {
    files: ['client/**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.browser,
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off', // not needed with the modern JSX transform
      'react/prop-types': 'off', // plain JS project — prop shapes live in shared/api.d.ts
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },

  // ── server ──────────────────────────────────────────────────────────────
  {
    files: ['server/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      'no-console': 'off', // logger lands in PR 0.3; until then console is the logger
    },
  },

  // ── shared + tooling ────────────────────────────────────────────────────
  {
    files: ['shared/**/*.js', '*.config.js', 'prisma/**/*.js'],
    languageOptions: {
      ecmaVersion: 2024,
      sourceType: 'module',
      globals: globals.node,
    },
  },

  // Must stay last: turns off every rule Prettier already handles.
  prettier,
];
