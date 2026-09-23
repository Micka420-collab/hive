import { describe, expect, it } from 'vitest';
import type { Controle } from '../src/shared/retour.js';
import { validationsDepuisControles } from '../src/orchestrator/ci-evidence.js';

const controle = (nom: string, statut = 'completed', conclusion = 'success'): Controle => ({
  nom,
  statut,
  conclusion,
  url: 'https://github.test/check',
});

describe('preuves CI — classification bornée des check-runs', () => {
  it('déduit les quatre validations d’un contrôle composite réussi', () => {
    expect(validationsDepuisControles([controle('CI · Tests · Typecheck · Build · Lint')])).toEqual(
      { tests: 'passed', typecheck: 'passed', build: 'passed', lint: 'passed' },
    );
  });

  it('laisse une validation en cours explicitement manquante', () => {
    expect(
      validationsDepuisControles([
        controle('CI · Tests · Typecheck · Build · Lint', 'in_progress', ''),
      ]),
    ).toEqual({ tests: 'missing', typecheck: 'missing', build: 'missing', lint: 'missing' });
  });

  it('conserve l’échec d’un contrôle terminé', () => {
    expect(
      validationsDepuisControles([
        controle('Tests', 'completed', 'failure'),
        controle('Typecheck', 'completed'),
        controle('Build', 'completed'),
        controle('Lint', 'completed'),
      ]),
    ).toEqual({ tests: 'failed', typecheck: 'passed', build: 'passed', lint: 'passed' });
  });

  it('n’invente aucune preuve à partir d’un contrôle sans catégorie', () => {
    expect(validationsDepuisControles([controle('Documentation', 'completed')])).toEqual({
      tests: 'missing',
      typecheck: 'missing',
      build: 'missing',
      lint: 'missing',
    });
  });
});
