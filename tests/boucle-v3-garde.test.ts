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
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  SURFACES_SENSIBLES,
  jugerDiff,
  porteDeLivraison,
  relectureCroisee,
  surfacesDe,
  validationHumaine,
} from '../src/boucle-v3/garde.js';
import { createServer } from '../src/orchestrator/server.js';
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
    // Les gardes que le train 5 a ajoutées à la ruche (#499 #501 #502 #505
    // #512 #516 #518) : les affaiblir passerait sans elles.
    ['src/node-client/configuration-inerte.ts', 'securite'],
    ['src/connectors/slack/definition.ts', 'securite'],
    ['src/orchestrator/connecteurs.ts', 'securite'],
    ['src/shared/graphe-experience.ts', 'securite'],
    ['src/orchestrator/missions.ts', 'permissions'],
    ['src/shared/mission-rejouable.ts', 'permissions'],
    ['src/orchestrator/shadow-bench.ts', 'permissions'],
    ['src/node-client/livraison-locale.ts', 'permissions'],
    ['src/shared/reglages.ts', 'permissions'],
    // La découverte du réseau local (#505).
    ['src/shared/decouverte.ts', 'securite'],
    ['src/shared/mdns.ts', 'securite'],
    ['src/shared/mdns-reseau.ts', 'securite'],
    ['src/shared/empreinte-ruche.ts', 'securite'],
    ['src/node-client/decouverte-noeud.ts', 'securite'],
    ['src/orchestrator/decouverte-reseau.ts', 'securite'],
    ['src/node-client/identite-noeud.ts', 'secrets'],
    // Ce que la revue du train 5 a relevé : des gardes et leurs bancs hors liste.
    ['src/shared/livraison-locale.ts', 'permissions'],
    ['src/node-client/join.ts', 'securite'],
    ['src/shared/retention-journal.ts', 'permissions'],
    ['tsconfig.json', 'auto-execution'],
    ['tsconfig.build.json', 'auto-execution'],
    ['dashboard/tsconfig.json', 'auto-execution'],
    ['tests/missions-rejouables-parcours.test.ts', 'securite'],
    ['tests/missions-rejouables-store.test.ts', 'securite'],
    ['tests/mission-rejouable.test.ts', 'securite'],
    ['tests/suppression-projet.test.ts', 'securite'],
    ['tests/connecteurs-slack-serveur.test.ts', 'securite'],
    ['tests/connecteurs-hub.test.ts', 'securite'],
    ['tests/shadow-bench.test.ts', 'securite'],
    ['tests/banc-ombre-ruche.test.ts', 'securite'],
    ['tests/configuration-inerte.test.ts', 'securite'],
    ['tests/join-porte.test.ts', 'securite'],
    ['tests/retention-journal.test.ts', 'securite'],
    ['tests/livraison-locale.test.ts', 'securite'],
    // Les gardes de la vague 7 (train 6) : réseau sortant (#545), politique
    // d'actions (#548), garde de PR (#546), revue en ligne (#547), routines
    // (#544) — et le budget dans la boucle (#550) : son prédicat d'arrêt, que
    // lisent les leçons de l'essaim, et les bornes de la délégation qu'il tient.
    ['src/node-client/proxy-egress.ts', 'securite'],
    ['src/node-client/politique-reseau.ts', 'securite'],
    ['src/node-client/reseau-tache.ts', 'securite'],
    ['src/shared/reseau.ts', 'securite'],
    ['src/shared/politique-actions.ts', 'permissions'],
    ['src/orchestrator/garde-pr.ts', 'permissions'],
    ['src/shared/commentaire-revue.ts', 'permissions'],
    ['src/orchestrator/routines.ts', 'auto-execution'],
    ['src/orchestrator/cron.ts', 'auto-execution'],
    ['src/shared/arret-budgetaire.ts', 'permissions'],
    ['src/orchestrator/delegation.ts', 'permissions'],
    ['src/shared/limites-delegation.ts', 'permissions'],
    ['tests/proxy-egress.test.ts', 'securite'],
    ['tests/requisition-action.test.ts', 'securite'],
    ['tests/garde-pr-boucle.test.ts', 'securite'],
    ['tests/routines-api.test.ts', 'securite'],
    ['tests/revue-ligne.test.ts', 'securite'],
    ['tests/reseau-projet.test.ts', 'securite'],
    ['tests/budget-boucle.test.ts', 'securite'],
    ['tests/budget-essaim.test.ts', 'securite'],
    // La suite de G12 : le clone d'une tâche ne porte aucun identifiant de
    // push — son banc, et la porte git qui l'assure (déjà nommée plus haut).
    ['tests/clone-sans-identifiants.test.ts', 'securite'],
    // L'effacement de ce que git a rempli, sorti de workspace.ts pour servir
    // aussi le miroir de la Reine : il garde la catégorie de l'atelier.
    ['src/node-client/workspace.ts', 'auto-execution'],
    ['src/shared/effacement.ts', 'auto-execution'],
    // La porte de sécurité (G10) et ses bancs : l'affaiblir laisserait partir
    // une clé, ou compterait verte une porte qu'aucun outil n'a passée.
    ['src/shared/porte-securite.ts', 'securite'],
    ['src/node-client/porte-securite.ts', 'securite'],
    ['src/shared/porte-securite-dependances.ts', 'securite'],
    ['tests/porte-securite.test.ts', 'securite'],
    ['tests/porte-securite-noeud.test.ts', 'securite'],
    ['tests/porte-securite-bout-en-bout.test.ts', 'securite'],
    ['tests/porte-securite-dependances.test.ts', 'securite'],
    // Les faux outils et les lockfiles mesurés : un faux complaisant ferait
    // passer les bancs ci-dessus pour de mauvaises raisons.
    ['tests/fixtures/faux-outils-porte.ts', 'securite'],
    ['tests/fixtures/verrous-porte.ts', 'securite'],
    // Les verdicts test par test (G11b) : le lecteur qui excuse un échec déjà
    // rouge à la base, ses bancs et les sorties réelles qu'ils rejouent.
    ['src/shared/lecture-tests.ts', 'permissions'],
    ['tests/lecture-tests.test.ts', 'permissions'],
    ['tests/verdicts-par-test-noeud.test.ts', 'permissions'],
    ['tests/verdicts-par-test-bout-en-bout.test.ts', 'permissions'],
    ['tests/fixtures/sorties-de-tests/vitest-defaut.txt', 'permissions'],
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
  const revue = (
    id: number,
    state: string | null,
    taskId = T,
    provenance: Record<string, unknown> = { parUserId: 'proprietaire-1' },
  ) => ({
    id,
    type: 'task_reviewed',
    payload: { taskId, state, ...provenance },
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

  it('UNE APPROBATION AU JETON DE RUCHE, ou depuis Slack, n’est pas la validation d’un compte', () => {
    // La boucle travaille au jeton : son projet est orphelin, donc ouvert au
    // jeton que chaque machine porte. Seul un compte qui répond du projet
    // (`parUserId`, écrit par la Reine) valide.
    for (const provenance of [
      { parUserId: null },
      {},
      { parUserId: '' },
      { source: 'slack', par: 'slack:U123', parUserId: null },
    ]) {
      expect(
        validationHumaine(T, [done(1), revue(2, 'approved', T, provenance)], 'approved'),
        JSON.stringify(provenance),
      ).toBe('absente');
    }
    // Un REFUS, lui, vaut d'où qu'il vienne.
    expect(
      validationHumaine(T, [done(1), revue(2, 'rejected', T, { parUserId: null })], 'missing'),
    ).toBe('refusee');
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

describe('la Reine écrit QUI a validé — ce que la porte lit', () => {
  it('`parUserId` ne nomme qu’un compte qui répond du projet ; le jeton, ou un inconnu qui le porte, écrit null', async () => {
    const JETON = 'jeton-garde-revue-assez-long-42';
    const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-garde-revue-'));
    const srv = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
    try {
      const base = `http://127.0.0.1:${srv.port}`;
      const hive = { 'content-type': 'application/json', 'x-hive-token': JETON };
      const inscrire = async (email: string, avecJeton: boolean): Promise<string> => {
        const r = await fetch(`${base}/api/auth/register`, {
          method: 'POST',
          headers: avecJeton ? hive : { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
        });
        return ((await r.json()) as { token: string }).token;
      };
      const admin = await inscrire('reine@ruche.test', true);
      const inconnu = await inscrire('inconnu@ruche.test', false);
      // Le projet de la boucle : créé au jeton, donc orphelin.
      const p = srv.store.createProject({ name: 'Hive' }).id;
      const revue = async (headers: Record<string, string>): Promise<unknown> => {
        const t = srv.store.createTask({ projectId: p, title: 'x', prompt: 'x' });
        srv.store.patchTask(t.id, { status: 'done' });
        const r = await fetch(`${base}/api/tasks/${t.id}/review`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ state: 'approved' }),
        });
        expect(r.status, await r.clone().text()).toBe(200);
        return srv.store.lastEventFor('task_reviewed', t.id)?.payload.parUserId;
      };
      expect(await revue(hive)).toBeNull();
      expect(await revue({ ...hive, authorization: `Bearer ${inconnu}` })).toBeNull();
      const parAdmin = await revue({
        'content-type': 'application/json',
        authorization: `Bearer ${admin}`,
      });
      expect(typeof parAdmin === 'string' && parAdmin !== '').toBe(true);
    } finally {
      await srv.stop();
      rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
