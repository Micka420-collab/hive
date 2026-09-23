// Classifie les contrôles CI vivants en preuves bornées pour l'Evaluator.
// Ce module ne lit ni la base ni le réseau : GitHub fournit les contrôles, puis
// cette fonction pure décide uniquement ce que chaque nom de contrôle prouve.

import type { Controle } from '../shared/retour.js';
import type { ValidationEvidence, ValidationState, ValidationProvenance } from './evaluator.js';

export const VALIDATION_KEYS = ['tests', 'typecheck', 'build', 'lint'] as const;
export type ValidationKey = (typeof VALIDATION_KEYS)[number];

export interface CiValidationRecord extends ValidationProvenance {
  validation: ValidationEvidence;
}

const motifs: Record<ValidationKey, readonly RegExp[]> = {
  tests: [/\btest(?:s|ing)?\b/, /\bvitest\b/, /\bjest\b/, /\be2e\b/, /\bspec(?:s)?\b/],
  typecheck: [/\btype\s*check(?:ing)?\b/, /\btypecheck\b/, /\btsc\b/, /\btypescript\b/],
  build: [/\bbuild(?:ing)?\b/, /\bdocker\b/, /\bimage\b/, /\bcompile(?:d|r)?\b/],
  lint: [/\blint(?:ing)?\b/, /\beslint\b/, /\bprettier\b/, /\bformat(?:ting)?\b/],
};

function nomNormalise(nom: string): string {
  return nom
    .slice(0, 400)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLocaleLowerCase('en-US');
}

function concerne(nom: string, cle: ValidationKey): boolean {
  return motifs[cle].some((motif) => motif.test(nom));
}

function etat(controles: readonly Controle[], cle: ValidationKey): ValidationState {
  const concernes = controles.filter((controle) => concerne(nomNormalise(controle.nom), cle));
  if (concernes.length === 0) return 'missing';
  if (concernes.some((controle) => controle.statut !== 'completed')) return 'missing';
  return concernes.every((controle) => controle.conclusion === 'success') ? 'passed' : 'failed';
}

/** Convertit les check-runs nommés en états explicites, sans inférer les absents. */
export function validationsDepuisControles(controles: readonly Controle[]): ValidationEvidence {
  return {
    tests: etat(controles, 'tests'),
    typecheck: etat(controles, 'typecheck'),
    build: etat(controles, 'build'),
    lint: etat(controles, 'lint'),
  };
}
