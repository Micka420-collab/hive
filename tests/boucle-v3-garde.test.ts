// LA PORTE DES CHANGEMENTS SENSIBLES — fermée par défaut, et elle-même gardée.
//
// Ce que ces bancs tiennent :
//   · chaque surface que la carte nomme (comptes, accès, gardes du serveur,
//     caviardage, git protégé, bac, workflows, installateurs, Docker,
//     dépendances, scripts) arrête la livraison ;
//   · la porte, la boucle et leurs bancs aussi — une production qui
//     assouplit la porte attend un humain comme toute autre ; et ce dont les
//     gardes DÉPENDENT (le parseur de la porte, les verdicts qui arrêtent une
//     livraison, la table des revues, le caviardage côté nœud) ;
//   · les ruses de forme ne passent pas : suppression, renommage pur, casse,
//     fichier sensible noyé parmi des fichiers anodins ;
//   · ce qui ne se lit pas est `illisible`, jamais `libre` ;
//   · une validation n'est lue qu'au journal, APRÈS la dernière production, et
//     un refus humain arrête tout — sensible ou non ; un journal élagué de la
//     production n'empêche pas une revue retenue de valoir ;
//   · une production que personne d'une autre famille n'a relue attend un
//     humain, même libre ;
//   · chaque surface désigne au moins un fichier réel du dépôt : une liste qui
//     ne vise plus rien ne protège plus rien.

import { execFileSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import {
  SURFACES_SENSIBLES,
  jugerDiff,
  porteDeLivraison,
  relectureCroisee,
  surfacesDe,
  validationHumaine,
} from '../src/boucle-v3/garde.js';
import type {
  EtatGarde,
  RelectureCroisee,
  ValidationHumaine,
  VerdictGarde,
} from '../src/boucle-v3/garde.js';

/** Un diff git complet qui modifie une ligne de `chemin`. */
const modification = (chemin: string): string =>
  [
    `diff --git a/${chemin} b/${chemin}`,
    'index 1111111..2222222 100644',
    `--- a/${chemin}`,
    `+++ b/${chemin}`,
    '@@ -1 +1 @@',
    '-avant',
    '+après',
    '',
  ].join('\n');

const creation = (chemin: string): string =>
  [
    `diff --git a/${chemin} b/${chemin}`,
    'new file mode 100644',
    '--- /dev/null',
    `+++ b/${chemin}`,
    '@@ -0,0 +1 @@',
    '+nouveau',
    '',
  ].join('\n');

const suppression = (chemin: string): string =>
  [
    `diff --git a/${chemin} b/${chemin}`,
    'deleted file mode 100644',
    `--- a/${chemin}`,
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-ancien',
    '',
  ].join('\n');

const etat = (diff: string): EtatGarde => jugerDiff(diff).etat;

describe('la porte des changements sensibles — ce qu’elle arrête', () => {
  // La liste que la carte exige, fichier par fichier, avec sa surface.
  it.each([
    ['src/orchestrator/comptes.ts', 'securite'],
    ['src/shared/acces.ts', 'securite'],
    ['src/shared/acces-projet.ts', 'securite'],
    ['src/orchestrator/server.ts', 'securite'],
    ['src/shared/caviardage.ts', 'securite'],
    ['src/shared/git-protege.ts', 'securite'],
    ['src/node-client/isolement.ts', 'securite'],
    ['src/node-client/bac.ts', 'securite'],
    ['tests/engagement-projet.test.ts', 'securite'],
    ['src/orchestrator/essaim.ts', 'permissions'],
    ['src/orchestrator/livraison.ts', 'permissions'],
    ['.env', 'secrets'],
    ['src/shared/env-queen.ts', 'secrets'],
    ['.github/workflows/ci.yml', 'deploiement'],
    ['install.sh', 'deploiement'],
    ['install.ps1', 'deploiement'],
    ['rejoindre.sh', 'deploiement'],
    ['Dockerfile', 'deploiement'],
    ['docker-compose.yml', 'deploiement'],
    ['docker-compose.cloud.yml', 'deploiement'],
    ['src/orchestrator/abonnement.ts', 'facturation'],
    ['src/orchestrator/nuage.ts', 'facturation'],
    ['package.json', 'auto-execution'],
    ['package-lock.json', 'auto-execution'],
    ['scripts/ruche.mjs', 'auto-execution'],
    ['scripts/preuve-v2-alpha.mjs', 'auto-execution'],
    ['src/adapters/claude-code.ts', 'auto-execution'],
    ['vitest.config.ts', 'auto-execution'],
    ['AGENTS.md', 'auto-execution'],
    ['.agents/skills/testing-hive-dashboard/SKILL.md', 'auto-execution'],
    // Ce dont les gardes dépendent : les affaiblir passerait sans toucher la garde.
    ['src/orchestrator/rustine.ts', 'porte'],
    ['src/node-client/client.ts', 'securite'],
    ['src/shared/protocol.ts', 'securite'],
    ['src/orchestrator/store.ts', 'securite'],
    ['src/orchestrator/miroir.ts', 'securite'],
    ['src/orchestrator/evaluator.ts', 'permissions'],
    ['src/orchestrator/gardiennes.ts', 'permissions'],
    ['src/orchestrator/ci-evidence.ts', 'permissions'],
    ['src/orchestrator/scheduler.ts', 'permissions'],
    ['src/shared/contre-expertise.ts', 'permissions'],
    ['src/orchestrator/github.ts', 'secrets'],
    ['src/node-client/tunnel.ts', 'deploiement'],
    ['src/node-client/cloudflare.ts', 'deploiement'],
    ['examples/deploiement-sans-ecran.sh', 'auto-execution'],
    ['docker/atelier/entrypoint.sh', 'auto-execution'],
    // Les gardes que le train 5 a ajoutées à la ruche (#499 #501 #502 #512
    // #516 #518) : les affaiblir passerait sans elles.
    ['src/node-client/configuration-inerte.ts', 'securite'],
    ['src/connectors/slack/definition.ts', 'securite'],
    ['src/orchestrator/connecteurs.ts', 'securite'],
    ['src/shared/graphe-experience.ts', 'securite'],
    ['src/orchestrator/missions.ts', 'permissions'],
    ['src/shared/mission-rejouable.ts', 'permissions'],
    ['src/orchestrator/shadow-bench.ts', 'permissions'],
    ['src/node-client/livraison-locale.ts', 'permissions'],
    ['src/shared/reglages.ts', 'permissions'],
  ])('%s → %s', (chemin, categorie) => {
    const verdict = jugerDiff(modification(chemin));
    expect(verdict.etat).toBe('sensible');
    expect(verdict.touches.map((t) => t.categorie)).toContain(categorie);
    expect(verdict.touches.every((t) => t.pourquoi.length > 0)).toBe(true);
  });

  it('LA PORTE ELLE-MÊME : la modifier, la contourner ou affaiblir ses bancs attend un humain', () => {
    for (const chemin of [
      'src/boucle-v3/garde.ts',
      'src/boucle-v3/boucle.ts',
      'src/boucle-v3/main.ts',
      'src/boucle-v3/rapport.ts',
      'tests/boucle-v3-garde.test.ts',
      'tests/boucle-v3.test.ts',
    ]) {
      const verdict = jugerDiff(modification(chemin));
      expect(verdict.etat, chemin).toBe('sensible');
      expect(
        verdict.touches.map((t) => t.categorie),
        chemin,
      ).toContain('porte');
    }
    // Une porte « de remplacement » ajoutée à côté, que package.json lancerait :
    // le script npm est lui-même sensible.
    const detour = creation('src/boucle-v3/garde-souple.ts') + modification('package.json');
    expect(jugerDiff(detour).touches.map((t) => t.categorie)).toEqual(
      expect.arrayContaining(['porte', 'auto-execution']),
    );
  });

  it('SUPPRIMER OU CRÉER une surface sensible compte autant que la modifier', () => {
    expect(etat(suppression('src/shared/caviardage.ts'))).toBe('sensible');
    expect(etat(creation('.github/workflows/exfiltre.yml'))).toBe('sensible');
    expect(etat(creation('src/shared/acces-bis.ts'))).toBe('sensible');
  });

  it('UN RENOMMAGE PUR se juge sur ses deux chemins — même sans hunk, que la livraison ignore', () => {
    const renommage = [
      'diff --git a/src/shared/caviardage.ts b/docs/ancien-caviardage.ts',
      'similarity index 100%',
      'rename from src/shared/caviardage.ts',
      'rename to docs/ancien-caviardage.ts',
      '',
    ].join('\n');
    // Seul, la livraison le refuserait (« aucun fichier ») : illisible.
    expect(etat(renommage)).toBe('illisible');
    // Accompagné d'un changement anodin, il passerait la livraison — pas la porte.
    const verdict = jugerDiff(modification('docs/ETAPES.md') + renommage);
    expect(verdict.etat).toBe('sensible');
    expect(verdict.fichiers).toContain('src/shared/caviardage.ts');
  });

  it('LA CASSE NE CACHE RIEN : un poste Windows ou macOS écrit le même fichier', () => {
    expect(etat(modification('SRC/Shared/Caviardage.ts'))).toBe('sensible');
    expect(etat(modification('.GitHub/Workflows/ci.yml'))).toBe('sensible');
    expect(etat(modification('Package.JSON'))).toBe('sensible');
  });

  it('UN FICHIER SENSIBLE NOYÉ PARMI DES ANODINS est trouvé, et seul nommé', () => {
    const diff = [
      modification('docs/ETAPES.md'),
      modification('src/orchestrator/planner.ts'),
      modification('src/node-client/isolement.ts'),
      creation('tests/planner-bis.test.ts'),
    ].join('');
    const verdict = jugerDiff(diff);
    expect(verdict.etat).toBe('sensible');
    expect(verdict.fichiers).toHaveLength(4);
    expect(verdict.touches.map((t) => t.chemin)).toEqual(['src/node-client/isolement.ts']);
  });
});

describe('la porte — ce qu’elle laisse passer, et ce qu’elle ne sait pas lire', () => {
  it('un changement anodin est libre', () => {
    const verdict = jugerDiff(
      modification('src/orchestrator/planner.ts') + creation('docs/boucle-v3/note.md'),
    );
    expect(verdict).toEqual<VerdictGarde>({
      etat: 'libre',
      fichiers: ['docs/boucle-v3/note.md', 'src/orchestrator/planner.ts'],
      touches: [],
    });
  });

  it.each([
    ['vide', ''],
    ['sans en-tête de fichier', 'ceci n’est pas un diff\n'],
    ['binaire', modification('docs/a.md') + 'GIT binary patch\nliteral 3\n'],
    ['chemin remontant', modification('../.ssh/authorized_keys')],
    [
      'chemin cité par git',
      [
        'diff --git "a/docs/caf\\303\\251.md" "b/docs/caf\\303\\251.md"',
        '--- "a/docs/caf\\303\\251.md"',
        '+++ "b/docs/caf\\303\\251.md"',
        '@@ -1 +1 @@',
        '-a',
        '+b',
        '',
      ].join('\n'),
    ],
    [
      'en-tête ambigu',
      modification('docs/a b/c.md').replace('diff --git a/docs/a b/c.md', 'diff --git a/x b/y b/z'),
    ],
  ])('%s → illisible, jamais libre', (_nom, diff) => {
    const verdict = jugerDiff(diff);
    expect(verdict.etat).toBe('illisible');
    expect(verdict.motif).toBeTruthy();
  });
});

describe('la décision : validation humaine au journal, refus sans appel', () => {
  const libre = jugerDiff(modification('docs/ETAPES.md'));
  const sensible = jugerDiff(modification('src/orchestrator/comptes.ts'));
  const illisible = jugerDiff('');

  it.each<[string, VerdictGarde, ValidationHumaine, RelectureCroisee, string]>([
    ['libre et relue, sans validation', libre, 'absente', 'rendue', 'livrer'],
    ['libre mais refusée', libre, 'refusee', 'rendue', 'refus_humain'],
    ['libre, SANS relecture croisée', libre, 'absente', 'absente', 'validation_requise'],
    ['libre sans relecture, validée', libre, 'approuvee', 'absente', 'livrer'],
    ['sensible sans validation', sensible, 'absente', 'rendue', 'validation_requise'],
    ['sensible validée', sensible, 'approuvee', 'rendue', 'livrer'],
    ['sensible refusée', sensible, 'refusee', 'rendue', 'refus_humain'],
    ['illisible sans validation', illisible, 'absente', 'rendue', 'validation_requise'],
    ['illisible validée', illisible, 'approuvee', 'absente', 'livrer'],
  ])('%s → %s', (_nom, verdict, validation, relecture, attendu) => {
    expect(porteDeLivraison(verdict, validation, relecture)).toBe(attendu);
  });

  it('une relecture croisée est d’une AUTRE famille, et d’un relecteur connu', () => {
    const r = (relecteur: string, producteur = 'claude-code') => ({ relecteur, producteur });
    expect(relectureCroisee([])).toBe('absente');
    expect(relectureCroisee([r('claude-code')])).toBe('absente');
    expect(relectureCroisee([r('inconnu')])).toBe('absente');
    expect(relectureCroisee([r('claude-code'), r('codex')])).toBe('rendue');
  });

  const T = 'v3-abcdef12-implementation';
  const done = (id: number, taskId = T) => ({ id, type: 'task_done', payload: { taskId } });
  const revue = (id: number, state: string | null, taskId = T) => ({
    id,
    type: 'task_reviewed',
    payload: { taskId, state },
  });

  it('APPROUVÉE : au journal après la dernière production, ET dans l’état rangé', () => {
    expect(validationHumaine(T, [done(1), revue(2, 'approved')], 'approved')).toBe('approuvee');
  });

  it('une approbation d’une production PRÉCÉDENTE ne couvre pas la suivante', () => {
    expect(validationHumaine(T, [done(1), revue(2, 'approved'), done(3)], 'approved')).toBe(
      'absente',
    );
  });

  it('UNE PRODUCTION ÉLAGUÉE DU JOURNAL n’empêche pas la revue retenue de valoir', () => {
    // L'élagage retire les plus anciens : sans `task_done` retenu, la
    // production précède la revue. Exiger les deux laissait l'humain approuver
    // en vain, arrêt après arrêt.
    expect(validationHumaine(T, [revue(4800, 'approved')], 'approved')).toBe('approuvee');
    expect(validationHumaine(T, [revue(4800, 'rejected')], 'missing')).toBe('refusee');
    // …mais l'état rangé doit toujours dire oui.
    expect(validationHumaine(T, [revue(4800, 'approved')], 'missing')).toBe('absente');
  });

  it('une approbation effacée ou absente du journal ne vaut rien', () => {
    // Rangée, mais le journal ne la montre pas (élagué) : on ne suppose pas.
    expect(validationHumaine(T, [done(1)], 'approved')).toBe('absente');
    // Au journal, mais l'état rangé a été effacé depuis (nouvelle tentative).
    expect(validationHumaine(T, [done(1), revue(2, 'approved')], 'missing')).toBe('absente');
    // Effacée par un humain (`state: null`).
    expect(validationHumaine(T, [done(1), revue(2, 'approved'), revue(3, null)], 'missing')).toBe(
      'absente',
    );
  });

  it('l’approbation d’une AUTRE tâche ne valide pas celle-ci', () => {
    expect(
      validationHumaine(T, [done(1), revue(2, 'approved', 'v3-autre-implementation')], 'approved'),
    ).toBe('absente');
  });

  it('UN REFUS, rangé ou au journal, est un refus', () => {
    expect(validationHumaine(T, [done(1)], 'rejected')).toBe('refusee');
    expect(validationHumaine(T, [done(1), revue(2, 'rejected')], 'missing')).toBe('refusee');
  });
});

describe('la liste des surfaces', () => {
  it('chaque surface vise au moins un fichier suivi du dépôt, et dit pourquoi', () => {
    const suivis = execFileSync('git', ['ls-files'], { encoding: 'utf8' }).split('\n');
    for (const surface of SURFACES_SENSIBLES) {
      expect(surface.pourquoi.length, surface.motif.source).toBeGreaterThan(10);
      expect(
        suivis.some((f) => surfacesDe(f).some((t) => t.pourquoi === surface.pourquoi)),
        `aucun fichier du dépôt ne correspond à ${surface.motif.source}`,
      ).toBe(true);
    }
  });
});
