// LES BORNES D'ÉLAGAGE SONT-ELLES CÂBLÉES, OU SEULEMENT ÉCRITES ?
//
// ─── LA DOCTRINE, ET CE QU'ELLE DISAIT DÉJÀ ──────────────────────────────────
//
// Règle 3 du dépôt : « une table nouvelle arrive avec sa borne d'élagage, dans
// le même commit ». Le tick de l'orchestrateur va même plus loin, noir sur
// blanc : « la borne est CÂBLÉE, pas seulement écrite ».
//
// Elle ne l'était pas. `pruneAcces` et `prunePartages` n'étaient appelés que
// par des tests ; `pruneServeurs` par PERSONNE. Trois tables grandissaient donc
// sans borne — `invite_tickets`, `partages`, `serveurs` — et deux d'entre elles
// gardaient des IDENTIFIANTS MORTS sur le disque pour toujours : billets
// révoqués, liens de partage éteints.
//
// La règle avait été suivie à l'écriture et jamais au branchement. C'est la
// même forme que les composants montés nulle part et les routes que rien
// n'appelle : le défaut n'est dans aucun fichier, il est dans ce que rien ne
// fait. D'où une garde sur la RÈGLE, pas sur ses trois endroits.
//
// ─── L'AUTRE MOITIÉ DU LOT : ÉLAGUER NE DOIT PAS ROUVRIR ─────────────────────
//
// Câbler un élagage qui touche des lignes d'ACCÈS demande une preuve, pas une
// intuition. Si un billet révoqué disparaissait et que « billet inconnu » était
// traité plus favorablement que « billet révoqué », l'élagage rouvrirait
// périodiquement des portes fermées à la main. C'est le seul point où ces
// bornes pourraient nuire, et il se vérifie.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const TOKEN = 'jeton-de-test-suffisamment-long-42';

/** Le code, commentaires retirés : une borne citée dans sa doc n'est pas câblée. */
const sansCommentaires = (chemin: string): string =>
  readFileSync(RACINE + chemin, 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\*).*$/gm, '');

describe('LE PLAFOND N’A QU’UN SEUL CHEMIN D’ÉCRITURE', () => {
  // ─── LE DÉFAUT QUE CETTE GARDE FERME ───────────────────────────────────────
  //
  // `scheduler.setPlafond` écrit le budget ET invalide le cache mémoïsé que la
  // porte consulte. Sa docstring dit depuis toujours « C'est le SEUL chemin
  // d'écriture de `budgets` ». Le webhook d'abonnement, lui, appelait
  // `store.setBudget` directement.
  //
  // Résultat sur une rétrogradation Colonie 200 h → Éclaireuse 10 h : webhook
  // accepté, abonnement à jour, et 190 heures NON PAYÉES qui passent encore la
  // porte — jusqu'au redémarrage du processus. Symétrique à la montée : un
  // client qui paie plus reste bloqué à son ancien quota.
  //
  // Une phrase de docstring n'est pas une garde. Celle-ci en est une.

  const SOURCES = ['../src/orchestrator/server.ts', '../src/orchestrator/scheduler.ts'] as const;

  it('`store.setBudget` n’est appelé QUE depuis `setPlafond`', () => {
    for (const f of SOURCES) {
      const src = readFileSync(new URL(f, import.meta.url), 'utf8');
      const appels = [...src.matchAll(/^.*\bstore\.setBudget\(/gm)].map((m) => m[0].trim());
      for (const appel of appels) {
        expect(
          appel,
          `${f} : « ${appel} » écrit le budget sans invalider le cache de la porte`,
        ).toMatch(/this\.store\.setBudget\(/);
      }
    }
  });

  it('et le scheduler, lui, l’appelle bien — sinon la garde ne garde rien', () => {
    // Sans cette borne, supprimer `setPlafond` rendrait la garde ci-dessus
    // vraie pour cause de vide.
    const sched = readFileSync(
      new URL('../src/orchestrator/scheduler.ts', import.meta.url),
      'utf8',
    );
    expect(sched).toContain('this.store.setBudget(');
    expect(sched, 'le cache doit être invalidé dans le même geste').toMatch(
      /this\.store\.setBudget\([\s\S]{0,200}this\.budgets = null/,
    );
  });
});

describe('LA RÈGLE : toute borne d’élagage est CÂBLÉE, pas seulement écrite', () => {
  it('CHAQUE `prune*` DU STORE EST APPELÉ PAR DU CODE DE PRODUCTION', () => {
    // Un test qui appelle `pruneX` ne compte pas : il prouve que la fonction
    // marche, jamais qu'elle tourne. C'est précisément la distinction qui a
    // laissé trois tables grandir sans borne.
    const store = sansCommentaires('src/orchestrator/store.ts');
    const bornes = [...store.matchAll(/^ {2}(prune[A-Za-z]+)\(/gm)].map((m) => m[1] as string);
    expect(bornes.length, 'le store doit avoir des bornes').toBeGreaterThan(5);

    // La production, c'est `src/` MOINS le store lui-même (qui les définit).
    const production = ['src/orchestrator/server.ts', 'src/orchestrator/scheduler.ts']
      .map((f) => {
        try {
          return sansCommentaires(f);
        } catch {
          return '';
        }
      })
      .join('\n');

    const orphelines = bornes.filter((b) => !new RegExp(`\\.${b}\\(`).test(production));
    expect(
      orphelines,
      'Borne(s) d’élagage écrite(s) et jamais appelée(s) en production. ' +
        'La table qu’elles bornent grandit donc sans fin. Deux issues, et il ' +
        'faut choisir : la câbler dans le tick — ou retirer la fonction, parce ' +
        'qu’une borne que rien n’appelle donne l’illusion d’une table bornée.',
    ).toEqual([]);
  });

  it('les trois bornes retrouvées sont bien dans le tick, avec une constante nommée', () => {
    // Un nombre écrit en dur à l'appel se relit mal et se règle au hasard. Les
    // autres bornes ont toutes leur constante documentée ; celles-ci aussi.
    const server = sansCommentaires('src/orchestrator/server.ts');
    for (const [borne, constante] of [
      ['pruneAcces', 'ACCES_GRACE_MS'],
      ['prunePartages', 'PARTAGES_GRACE_MS'],
      ['pruneServeurs', 'SERVEURS_SUPPRIMES_CONSERVES'],
    ] as const) {
      expect(server, `${borne} doit être appelée`).toMatch(
        new RegExp(`store\\.${borne}\\(${constante}\\)`),
      );
      expect(server, `${constante} doit être définie`).toMatch(new RegExp(`const ${constante} =`));
    }
  });

  it('LES DEUX GRÂCES SONT NON NULLES — sinon elles ne servent à rien', () => {
    // Mettre une grâce à zéro efface un billet révoqué la seconde d'après.
    // Rien ne se rouvre — un mort reste mort — mais l'hôte perd la réponse
    // « révoqué le 3 » et lit un trou, ce qui ressemble à une faute de frappe.
    // C'est TOUTE la raison d'être du paramètre : à zéro, autant ne pas
    // l'avoir.
    //
    // On pose un plancher, pas la valeur exacte : recopier la constante ferait
    // un test qui ne peut que se répéter lui-même.
    const server = sansCommentaires('src/orchestrator/server.ts');
    for (const nom of ['ACCES_GRACE_MS', 'PARTAGES_GRACE_MS']) {
      const m = new RegExp(`const ${nom} = ([^;]+);`).exec(server);
      expect(m, `${nom} introuvable`).toBeTruthy();
      const valeur = Number(
        new Function(`return ${(m as RegExpExecArray)[1]}`)() as unknown as number,
      );
      expect(
        valeur,
        `${nom} doit laisser au moins une semaine pour répondre`,
      ).toBeGreaterThanOrEqual(7 * 24 * 60 * 60 * 1_000);
    }
  });

  it('la garde sait rougir — vérifiée sur un store fabriqué', () => {
    // Une garde qu'on ne voit jamais mordre est du décor.
    const faux = '  pruneVivante(n: number) {}\n  pruneMorte(n: number) {}\n';
    const production = 'store.pruneVivante(10);';
    const bornes = [...faux.matchAll(/^ {2}(prune[A-Za-z]+)\(/gm)].map((m) => m[1] as string);
    const orphelines = bornes.filter((b) => !new RegExp(`\\.${b}\\(`).test(production));
    expect(orphelines).toEqual(['pruneMorte']);
  });
});

describe('ÉLAGUER NE DOIT PAS ROUVRIR CE QUI A ÉTÉ FERMÉ', () => {
  let server: Awaited<ReturnType<typeof createServer>>;
  let dir: string;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-bornes-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
    });
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('UN BILLET RÉVOQUÉ RESTE REFUSÉ APRÈS AVOIR ÉTÉ EFFACÉ', () => {
    // LE POINT QUI RENDRAIT CE CÂBLAGE DANGEREUX S'IL ÉTAIT FAUX. Si « billet
    // inconnu » était traité plus favorablement que « billet révoqué »,
    // l'élagage rouvrirait périodiquement des portes fermées à la main — une
    // faille qui n'apparaîtrait qu'un mois après la révocation, et que personne
    // ne relierait jamais à une purge.
    const vieux = Date.now() - 90 * 24 * 60 * 60 * 1_000;
    server.store.creerBillet({
      id: 'b-revoque',
      secretHash: 'a'.repeat(64),
      expiresAt: Date.now() + 86_400_000,
      uses: 3,
      now: vieux,
    });
    expect(server.store.revoquerBillet('b-revoque'), 'révocation').toBe(true);
    expect(server.store.consommerBillet('b-revoque'), 'révoqué ⇒ refusé').toBe(false);

    // L'élagage passe.
    expect(server.store.pruneAcces(30 * 24 * 60 * 60 * 1_000), 'le mort part').toBe(1);
    expect(server.store.getBillet('b-revoque'), 'la ligne a disparu').toBeNull();

    // ET LE REFUS TIENT ENCORE. C'est toute la question.
    expect(
      server.store.consommerBillet('b-revoque'),
      'ABSENT DOIT ÊTRE AUSSI FERMÉ QUE RÉVOQUÉ',
    ).toBe(false);
  });

  it('un billet mort mais RÉCENT survit à la grâce', () => {
    // La grâce ne sert pas à la sûreté — un mort ne rouvre rien — elle sert à
    // RÉPONDRE : l'hôte qui liste ses billets voit « révoqué le 3 » plutôt
    // qu'un trou. L'effacer tout de suite priverait de cette réponse.
    server.store.creerBillet({
      id: 'b-frais',
      secretHash: 'b'.repeat(64),
      expiresAt: Date.now() + 86_400_000,
      uses: 1,
      now: Date.now(),
    });
    server.store.revoquerBillet('b-frais');
    expect(server.store.pruneAcces(30 * 24 * 60 * 60 * 1_000)).toBe(0);
    expect(server.store.getBillet('b-frais'), 'encore là, pour pouvoir répondre').not.toBeNull();
  });

  it('L’ÉLAGAGE NE TOUCHE JAMAIS UN BILLET VIVANT', () => {
    // L'autre moitié de la sûreté : un billet encore valide qui disparaîtrait
    // rendrait une invitation en circulation silencieusement inutilisable — le
    // pire mode d'échec pour une fonctionnalité dont tout l'intérêt est qu'on
    // puisse compter dessus.
    //
    // On affirme la PRÉSENCE du vivant, pas un nombre de suppressions : ce
    // nombre dépend de ce que les tests voisins ont laissé derrière eux, et une
    // assertion qui dépend de ses voisines finit par mentir dans un sens ou
    // dans l'autre.
    server.store.creerBillet({
      id: 'b-vivant',
      secretHash: 'c'.repeat(64),
      expiresAt: Date.now() + 86_400_000,
      uses: 2,
      now: Date.now() - 90 * 24 * 60 * 60 * 1_000, // vieux, mais VIVANT
    });

    server.store.pruneAcces(0, Date.now() + 1_000); // la purge la plus agressive
    expect(server.store.getBillet('b-vivant'), 'UN BILLET VIVANT A ÉTÉ EFFACÉ').not.toBeNull();
    expect(server.store.consommerBillet('b-vivant'), 'et il sert encore').toBe(true);
  });

  it('L’ÉLAGAGE NE TOUCHE JAMAIS UN LIEN DE PARTAGE VIVANT', () => {
    const projet = server.store.createProject({ name: 'Ruche', repoUrl: null, ownerId: null });
    server.store.creerPartage({
      id: 'p-vivant',
      projectId: projet.id,
      secretHash: 'x'.repeat(64),
      label: 'lien vivant',
      creePar: 'u1',
      expireA: Date.now() + 86_400_000,
    });
    expect(
      server.store.prunePartages(0, Date.now() + 1_000),
      'un lien vivant ne s’efface pas',
    ).toBe(0);
  });

  it('UNE MACHINE ALLUMÉE NE S’ÉLAGUE PAS — on perdrait ce qu’on paie', () => {
    // Élaguer une machine encore allumée perdrait la seule trace de ce qu'on
    // PAIE, et plus personne ne saurait l'éteindre. La facture continuerait de
    // courir sur une machine dont la ruche a oublié l'existence.
    //
    // La première version de ce test lisait le SQL et cherchait
    // `etat = 'supprime'` — et elle passait encore quand on retirait la
    // condition du DELETE, parce que la sous-requête la contient aussi. Un test
    // de texte peut se satisfaire d'une occurrence qui ne gouverne rien ; celui
    // qui suit fait tourner la purge.
    const projet = server.store.createProject({ name: 'Facture', repoUrl: null, ownerId: null });
    const machine = (id: string, etat: string, majA: number) =>
      server.store.setServeur({
        id,
        projectId: projet.id,
        refAbonnement: 'ab-1',
        etat,
        fournisseur: 'test',
        refMachine: id,
        gabarit: 's',
        motif: '',
        creeA: 0,
        majA,
        arreteA: 0,
      });

    machine('srv-allumee', 'pret', 10);
    machine('srv-morte-1', 'supprime', 1);
    machine('srv-morte-2', 'supprime', 2);
    machine('srv-morte-3', 'supprime', 3);

    // On ne garde qu'UNE machine supprimée : les deux plus anciennes partent.
    expect(server.store.pruneServeurs(1), 'deux mortes en trop').toBe(2);

    const restants = server.store.listServeurs().map((s) => s.id);
    expect(restants, 'LA MACHINE ALLUMÉE A ÉTÉ EFFACÉE').toContain('srv-allumee');
    expect(restants, 'la plus récente des mortes est gardée').toContain('srv-morte-3');
    expect(restants, 'les vieilles mortes sont parties').not.toContain('srv-morte-1');
  });
});
