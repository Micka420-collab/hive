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
    //
    // `tests/**/*.mjs` est de la même famille et pour la même raison : le test de
    // l'amorce est écrit en JavaScript nu, parce que le module qu'il éprouve doit
    // tourner là où `tsx` n'existe pas — l'écrire en TypeScript demanderait
    // justement la dépendance dont il constate l'absence.
    files: ['scripts/**/*.mjs', 'tests/**/*.mjs'],
    languageOptions: {
      // `fetch` est natif depuis Node 18 et le dépôt exige Node 24 — le déclarer
      // ici est un constat, pas une permission. `scripts/essai-parcours.mjs` s'en
      // sert pour interroger la ruche que l'installation vient de démarrer.
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
      },
    },
  },
);
