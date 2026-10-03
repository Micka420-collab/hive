// Politique d'actions compilée (G12) — classes d'irréversibilité × niveaux
// d'autonomie EXISTANTS. Module pur : décisions testées sans I/O.

import { describe, expect, it } from 'vitest';
import {
  ACTION_LIBELLE_MAX,
  CLASSES_ACTION,
  classerActionProposee,
  decisionActionParNiveau,
  estNiveauAutonomie,
  NIVEAUX,
  rangNiveau,
  type ClasseAction,
  type NiveauAutonomie,
  type SuiteAction,
} from '../src/shared/politique-actions.js';
import {
  NIVEAUX as NIVEAUX_ESSAIM,
  rangNiveau as rangNiveauEssaim,
} from '../src/orchestrator/essaim.js';

const CWD = '/travail/tache-1';
const bash = (command: string) => ({ toolName: 'Bash', input: { command } });

describe('les niveaux d’autonomie — un seul vocabulaire, aucun niveau inventé', () => {
  it('essaim.ts ré-exporte EXACTEMENT les niveaux partagés', () => {
    expect(NIVEAUX_ESSAIM).toBe(NIVEAUX);
    expect(rangNiveauEssaim).toBe(rangNiveau);
    expect([...NIVEAUX]).toEqual(['off', 'propose', 'gouverne', 'plein']);
  });

  it('estNiveauAutonomie est fermé', () => {
    for (const n of NIVEAUX) expect(estNiveauAutonomie(n)).toBe(true);
    expect(estNiveauAutonomie('total')).toBe(false);
    expect(estNiveauAutonomie(undefined)).toBe(false);
    expect(estNiveauAutonomie(2)).toBe(false);
  });
});

describe('classerActionProposee — la taxonomie toujours / parfois / jamais', () => {
  it.each([
    ['git push', 'git push origin main', 'jamais'],
    ['git push via enchaînement', 'cd sub && git push', 'jamais'],
    ['git push derrière une variable d’env', 'GIT_TRACE=1 git push --force', 'jamais'],
    ['publication npm', 'npm publish --access public', 'jamais'],
    ['publication pnpm', 'pnpm publish', 'jamais'],
    ['rm hors du cwd (absolu)', 'rm -rf /etc/passwd', 'jamais'],
    ['rm en remontée', 'rm -r ../autre-projet', 'jamais'],
    ['rm dans le HOME', 'rm ~/important.txt', 'jamais'],
    ['réseau non déclaré (curl)', 'curl https://exemple.invalid/post', 'jamais'],
    ['réseau non déclaré (ssh)', 'ssh hote distant', 'jamais'],
    ['rm DANS le clone jetable', 'rm -rf dist', 'parfois'],
    ['rm absolu SOUS le cwd', `rm -rf ${CWD}/node_modules`, 'parfois'],
    ['commande ordinaire', 'node scripts/outil.mjs', 'parfois'],
    ['git sans push', 'git status', 'parfois'],
  ] as Array<[string, string, ClasseAction]>)('%s → %s', (_nom, commande, attendue) => {
    expect(classerActionProposee(bash(commande), CWD).classe).toBe(attendue);
  });

  it('les outils de lecture sont toujours accordés ; un outil inconnu reste parfois', () => {
    expect(classerActionProposee({ toolName: 'Read', input: {} }, CWD).classe).toBe('toujours');
    expect(classerActionProposee({ toolName: 'Grep', input: {} }, CWD).classe).toBe('toujours');
    expect(classerActionProposee({ toolName: 'WebFetch', input: {} }, CWD).classe).toBe('parfois');
  });

  it('le libellé est borné et nomme la classe irréversible, jamais une commande sans fin', () => {
    const longue = `git push origin ${'x'.repeat(500)}`;
    const { libelle } = classerActionProposee(bash(longue), CWD);
    expect(libelle.length).toBeLessThanOrEqual(ACTION_LIBELLE_MAX);
    expect(libelle).toContain('git push');
  });
});

describe('decisionActionParNiveau — défauts calés sur les quatre niveaux', () => {
  // La table ENTIÈRE, pour que tout couple classe × niveau soit décidé — un
  // couple oublié serait un défaut silencieux, la pire classe de bug du dépôt.
  const attendu: Record<ClasseAction, Record<NiveauAutonomie, SuiteAction>> = {
    toujours: { off: 'autoriser', propose: 'autoriser', gouverne: 'autoriser', plein: 'autoriser' },
    parfois: {
      off: 'requisition',
      propose: 'requisition',
      gouverne: 'autoriser',
      plein: 'autoriser',
    },
    // L'irréversible reste gardé MÊME en plein — et une ruche `off` est
    // inerte : refus direct, pas de réquisition qu'aucun cycle ne surveille.
    jamais: {
      off: 'refuser',
      propose: 'requisition',
      gouverne: 'requisition',
      plein: 'requisition',
    },
  };

  it.each(CLASSES_ACTION.flatMap((classe) => NIVEAUX.map((niveau) => [classe, niveau] as const)))(
    '%s × %s',
    (classe, niveau) => {
      expect(decisionActionParNiveau(classe, niveau)).toBe(attendu[classe][niveau]);
    },
  );

  it('jamais d’auto-allow d’un git push, quel que soit le niveau', () => {
    for (const niveau of NIVEAUX) {
      expect(decisionActionParNiveau('jamais', niveau)).not.toBe('autoriser');
    }
  });
});
