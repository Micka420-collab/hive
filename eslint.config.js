// Configuration ESLint (flat config) — TypeScript strict + Prettier.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  { ignores: ['node_modules', 'dist', 'dashboard/dist', 'data', '.hive-work', 'coverage'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  prettier,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Les outils de `scripts/` tournent dans Node, en JavaScript nu. Sans cette
    // déclaration, `no-undef` — que typescript-eslint désactive pour les .ts —
    // accuse `process` et `console` d'être inventés.
    files: ['scripts/**/*.mjs'],
    languageOptions: {
      globals: { console: 'readonly', process: 'readonly', URL: 'readonly' },
    },
  },
);
