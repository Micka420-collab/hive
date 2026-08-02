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

describe('AUCUNE DOCSTRING NE PROMET UN ÉLAGAGE QUI N’EXISTE PAS', () => {
  // ─── LA PHRASE QUI A FAIT ACCEPTER UNE CONCEPTION ──────────────────────────
  //
  // `pruneTachesIssue` et `pruneContreExpertises` sont des bornes RÉFÉRENTIELLES
  // — elles suppriment les liens dont la tâche a disparu — et leurs deux
  // docstrings justifiaient ce choix par la même phrase : « les tâches ont déjà
  // leur propre élagage ».
  //
  // C'est faux. `tasks` est la seule table du dépôt sans élagueur. Mesuré sur
  // 2 000 tâches : les deux bornes suppriment 0 ligne, et il reste 2 000 tâches.
  // Aucune tâche ne disparaissant jamais, aucun lien n'est jamais orphelin.
  //
  // Une phrase fausse dans un commentaire coûte plus qu'une absence de
  // commentaire : elle fait CROIRE la table bornée, et c'est elle qu'on relit
  // pour décider de ne rien ajouter.

  it('la table `tasks` n’a toujours pas d’élagueur — la garde tombe le jour où elle en aura un', () => {
    // Cette assertion est écrite pour DEVENIR fausse. Le jour où `pruneTasks`
    // arrivera, elle rougira, et celui qui l'écrira ira relire les deux
    // docstrings — qui redeviendront vraies et devront être remises à jour.
    const store = sansCommentaires('src/orchestrator/store.ts');
    expect(
      /^ {2}pruneTasks\(/m.test(store),
      'si `pruneTasks` existe, les deux docstrings référentielles doivent redevenir affirmatives',
    ).toBe(false);
  });

  it('TANT QU’IL N’Y EN A PAS, aucune docstring ne prétend le contraire', () => {
    // ─── AFFIRMER N'EST PAS CITER ──────────────────────────────────────────
    //
    // La première version de cette garde cherchait la phrase, point. Elle a
    // rougi sur la docstring CORRIGÉE — celle qui cite la phrase fausse entre
    // guillemets pour expliquer pourquoi elle l'était.
    //
    // C'est le même piège que la garde `process.env` deux heures plus tôt : une
    // garde qui rougit sur sa propre explication fait supprimer l'explication,
    // et on perd exactement ce qui empêchait la rechute.
    //
    // On refuse donc la phrase AFFIRMÉE, pas la phrase citée : un guillemet
    // ouvrant juste avant la disculpe.
    // ─── ET LA PHRASE EST COUPÉE PAR LE RETOUR À LA LIGNE ──────────────────
    //
    // Deuxième défaut de cette même garde, trouvé en la vérifiant : la phrase
    // fautive s'étalait sur DEUX lignes de commentaire dans les deux
    // docstrings, et une régulière qui la cherche d'un seul tenant ne la voyait
    // NULLE PART. Elle est restée verte quand j'ai remis l'affirmation.
    //
    // Une garde de texte qui ne normalise pas les blancs cherche la mise en
    // forme autant que le propos. On aplatit d'abord les préfixes de commentaire
    // et les espaces, ensuite on cherche.
    const src = readFileSync(new URL('../src/orchestrator/store.ts', import.meta.url), 'utf8')
      .replace(/\n\s*\*/g, ' ')
      .replace(/\s+/g, ' ');
    const affirmations = [...src.matchAll(/(.{2})les tâches ont déjà leur propre élagage/g)]
      .map((m) => m[1] ?? '')
      .filter((avant) => !avant.includes('«'));
    expect(
      affirmations,
      'une docstring justifie encore sa conception par un élagage des tâches qui n’existe pas',
    ).toEqual([]);
  });
});

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

  it('LA BORNE DE RÉTENTION EST CÂBLÉE, comme sa sœur `aArreter`', () => {
    // ─── LA QUATRIÈME BORNE, QUI MANQUAIT AU COMPTE ─────────────────────────
    //
    // La règle ci-dessus ne couvre que les `prune*` du STORE. `aSupprimer` vit
    // dans `serveurs.ts`, elle est pure, elle est testée — et elle n'avait
    // aucun appelant. Sa sœur `aArreter`, écrite juste au-dessus dans le même
    // fichier, était câblée depuis toujours.
    //
    // Conséquence : `pruneServeurs` élaguait un état — `supprime` — que rien
    // n'atteignait jamais, sauf le geste manuel d'un administrateur. Le tableau
    // de bord annonçait au client « ⏳ N j avant effacement », puis à zéro « la
    // machine va être effacée aujourd'hui, avec tout ce qu'elle contient », et
    // l'effacement n'arrivait pas. Les données de quelqu'un qui est parti
    // restaient, après le lui avoir promis par écrit avec un décompte.
    const server = sansCommentaires('src/orchestrator/server.ts');
    for (const borne of ['aArreter', 'aSupprimer'] as const) {
      expect(server, `${borne}( doit être appelée en production`).toMatch(
        new RegExp(`\\b${borne}\\(`),
      );
    }

    // ─── ET SURTOUT : LA FONCTION QUI L'APPELLE DOIT ÊTRE ATTEINTE ──────────
    //
    // La première version de cette garde s'arrêtait à la boucle ci-dessus. J'ai
    // retiré l'appel du tick pour la vérifier : ELLE EST RESTÉE VERTE, parce
    // que `aSupprimer(` vivait toujours dans le corps de `balayerRetention` —
    // une fonction que plus personne n'appelait.
    //
    // C'est mot pour mot le défaut qu'elle prétend fermer, reproduit dans sa
    // propre écriture. Prouver qu'un nom apparaît ne prouve pas qu'un chemin
    // s'exécute. On compte donc les appels HORS DÉFINITION.
    const appels = [...server.matchAll(/(?<!const )\bbalayerRetention\(/g)];
    expect(
      appels.length,
      '`balayerRetention` est définie mais jamais appelée : la rétention ne s’applique pas',
    ).toBeGreaterThan(0);
  });

  it('et l’ordre des deux gestes est le bon : le fournisseur AVANT la base', () => {
    // Ranger d'abord perdrait la seule trace de ce qu'on paie encore : si le
    // fournisseur échoue, la ligne doit RESTER en `arrete` pour repasser au
    // tour suivant. Le `continue` après l'échec est ce qui le garantit.
    const server = sansCommentaires('src/orchestrator/server.ts');
    const bloc = /const balayerRetention[\s\S]*?\n {2}\};/.exec(server);
    expect(bloc, 'balayerRetention introuvable').toBeTruthy();
    const corps = (bloc as RegExpExecArray)[0];
    expect(corps.indexOf('fournisseurServeurs.supprimer')).toBeLessThan(
      corps.indexOf("transiter(s, 'supprime'"),
    );
    expect(corps, 'un échec du fournisseur ne doit PAS ranger la ligne').toContain('continue;');
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
