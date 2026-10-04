// Configuration ESLint (flat config) — TypeScript strict + Prettier.
import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      'node_modules',
      'dist',
      'dashboard/dist',
      'data',
      '.hive-work',
      'coverage',
      // L'application de bureau : sa sortie compilée, la marque copiée, la
      // ruche préparée et les paquets — tout se reconstruit.
      'desktop/node_modules',
      'desktop/dist',
      'desktop/marque',
      'desktop/build/hive',
      'desktop/release',
    ],
  },
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
      // `AbortController`, natif lui aussi : `captures-ecran-ruche.mjs` s'en sert
      // pour interrompre un démarrage qu'on arrête en route.
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortController: 'readonly',
      },
    },
  },
  {
    // L'application de bureau (ADR 0013) : ses outils `.mjs`/`.cjs` tournent
    // dans Node ou dans Electron (le générateur de la marque, le banc de
    // fumée, la configuration d'electron-builder, l'amorce des pièces). Les
    // `.cjs` sont du CommonJS VOULU — l'amorce doit tourner sans chargeur, le
    // préchargement sandboxé ne peut pas être un module ES —, d'où `require`.
    files: ['desktop/**/*.mjs', 'desktop/**/*.cjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
  },
  {
    files: ['desktop/**/*.cjs'],
    languageOptions: {
      sourceType: 'commonjs',
      globals: { require: 'readonly', module: 'writable', __dirname: 'readonly' },
    },
    rules: { '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // Ce qui s'exécute dans une PAGE : le préchargement et l'accueil.
    files: ['desktop/app/preload.cjs', 'desktop/accueil/**/*.js'],
    languageOptions: {
      globals: {
        window: 'readonly',
        document: 'readonly',
        location: 'readonly',
        localStorage: 'readonly',
      },
    },
  },
);
