// ADR 0007, TRANCHÉ — ce que le jeton de ruche peut encore ENGAGER, et ce
// qu'un compte peut RÉGLER.
//
// ─── LA DÉCISION QUE CE FICHIER DÉFEND ───────────────────────────────────────
//
// Le constat de l'ADR : `HIVE_TOKEN` se recopie sur CHAQUE machine membre, et
// ouvrait pourtant l'espace projet sans aucune règle par projet. Toute abeille
// qui prête sa machine pouvait donc créer des tâches, livrer et fusionner sur
// le projet de quelqu'un d'autre — faire tourner du code sur les machines de
// l'essaim, et pousser sur son dépôt, au nom d'un projet qui ne la regarde pas.
//
// La frontière retenue n'est pas « lire ou écrire », c'est **« ce projet vous
// regarde-t-il ? »** :
//
//   · un COMPTE qui a affaire au projet — propriétaire, membre, administrateur ;
//   · OU un projet SANS PROPRIÉTAIRE, qui n'appartient qu'à la ruche, et pour
//     lequel le jeton de ruche EST la ruche.
//
// Et RÉGLER n'est pas ENGAGER : autonomie, Garde-Fous, plafond de dépense et
// horizon décident de ce que le projet s'autorise ensuite. Ils sont réservés à
// qui en répond — le propriétaire ou un administrateur, ou le jeton sur un
// projet orphelin. Un membre reçoit 403 : il sait déjà que le projet existe.
//
// DÉCIDER n'est pas engager non plus : la revue humaine, l'annulation, la
// livraison et la fusion disent ce que devient un travail déjà fait. Même
// porte que les réglages — parce qu'être membre ne prouve pas qu'on a été
// admis : un projet PUBLIC se rejoint tout seul, en un clic.
//
// ─── POURQUOI CE FICHIER ÉNUMÈRE TOUT ────────────────────────────────────────
//
// Le premier resserrement tenait sur quatre routes, et un relevé complet en a
// trouvé dix-sept autres qui s'ouvraient encore au seul jeton. Aucun test ne
// l'avait vu : une garde qu'aucun test ne voit mordre est une garde qu'on
// oublie de poser. Chaque route est donc éprouvée ici des DEUX côtés de la
// frontière, et le dernier bloc refuse toute route d'écriture de l'espace
// projet que ces tables ne connaissent pas.

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-de-ruche-suffisamment-long-42';

/** Ce qu'un projet porte pour que chaque route ait une cible réelle. */
interface Cible {
  projet: string;
  tache: string;
  fabrique: string;
  motifPerso: string;
  sauvegarde: string;
}

interface Acte {
  nom: string;
  methode: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Le chemin de la route, tel que server.ts le déclare. */
  route: string;
  url: (c: Cible) => string;
  corps?: (c: Cible) => unknown;
  /** Le refus de la garde : un projet ou une tâche « inconnus ». */
  refus: 'projet' | 'tache';
  /** Faux : la route exige un COMPTE, le jeton seul n'y ouvre jamais rien. */
  jeton?: false;
}

const p = (suite: string) => (c: Cible) => `/api/projects/${c.projet}/${suite}`;

/**
 * Les actes qui ENGAGENT un projet.
 *
 * ⚠ LES CORPS DOIVENT ÊTRE VALIDES. Fastify valide le schéma AVANT d'entrer
 * dans le gestionnaire : un corps mal formé rend 400 sans jamais consulter la
 * garde, et un test qui l'ignore passe pour de mauvaises raisons — c'est
 * exactement ce qui est arrivé à la première version de ce fichier.
 */
const ENGAGEMENTS: readonly Acte[] = [
  {
    nom: 'tasks',
    methode: 'POST',
    route: '/api/projects/:projectId/tasks',
    url: p('tasks'),
    corps: () => ({ tasks: [{ title: 'une tâche', prompt: 'faire quelque chose' }] }),
    refus: 'projet',
  },
  {
    nom: 'brief',
    methode: 'POST',
    route: '/api/projects/:projectId/brief',
    url: p('brief'),
    corps: () => ({ brief: 'construire un site' }),
    refus: 'projet',
  },
  {
    nom: 'conseil',
    methode: 'POST',
    route: '/api/projects/:projectId/conseil',
    url: p('conseil'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'merge/run',
    methode: 'POST',
    route: '/api/projects/:projectId/merge/run',
    url: p('merge/run'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'chantiers/:nom/run',
    methode: 'POST',
    route: '/api/projects/:projectId/chantiers/:nom/run',
    url: p('chantiers/test/run'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'workflows/:workflowId/run',
    methode: 'POST',
    route: '/api/projects/:projectId/workflows/:workflowId/run',
    url: p('workflows/ci.yml/run'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'issues (lecture chez GitHub avec le jeton de l’hôte)',
    methode: 'GET',
    route: '/api/projects/:projectId/issues',
    url: p('issues'),
    refus: 'projet',
  },
  {
    nom: 'issues/:numero',
    methode: 'POST',
    route: '/api/projects/:projectId/issues/:numero',
    url: p('issues/7'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'livraisons (lecture chez GitHub avec le jeton de l’hôte)',
    methode: 'GET',
    route: '/api/projects/:projectId/livraisons',
    url: p('livraisons'),
    refus: 'projet',
  },
  {
    nom: 'livraisons/:taskId/reprendre',
    methode: 'POST',
    route: '/api/projects/:projectId/livraisons/:taskId/reprendre',
    url: (c) => `/api/projects/${c.projet}/livraisons/${c.tache}/reprendre`,
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'fabriques',
    methode: 'POST',
    route: '/api/projects/:projectId/fabriques',
    url: p('fabriques'),
    corps: () => ({ genre: 'script_npm', libelle: 'Outillage', creerTache: false }),
    refus: 'projet',
  },
  {
    nom: 'fabriques/:id/statut',
    methode: 'POST',
    route: '/api/projects/:projectId/fabriques/:id/statut',
    url: (c) => `/api/projects/${c.projet}/fabriques/${c.fabrique}/statut`,
    corps: () => ({ statut: 'en_revue' }),
    refus: 'projet',
  },
  {
    nom: 'motifs/:motifId/appliquer',
    methode: 'POST',
    route: '/api/projects/:projectId/motifs/:motifId/appliquer',
    url: p('motifs/jeu-3d/appliquer'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'motifs/perso',
    methode: 'POST',
    route: '/api/projects/:projectId/motifs/perso',
    url: p('motifs/perso'),
    corps: () => ({ libelle: 'Ma procédure', etapes: ['une étape'] }),
    refus: 'projet',
  },
  {
    nom: 'motifs/perso/:motifId/appliquer',
    methode: 'POST',
    route: '/api/projects/:projectId/motifs/perso/:motifId/appliquer',
    url: (c) => `/api/projects/${c.projet}/motifs/perso/${c.motifPerso}/appliquer`,
    refus: 'projet',
  },
  {
    nom: 'sauvegardes',
    methode: 'POST',
    route: '/api/projects/:projectId/sauvegardes',
    url: p('sauvegardes'),
    corps: () => ({ label: 'Avant la suite', patch: 'diff --git a/x b/x\n+y' }),
    refus: 'projet',
  },
  {
    nom: 'sauvegardes/:sauvegardeId/restaurer',
    methode: 'POST',
    route: '/api/projects/:projectId/sauvegardes/:sauvegardeId/restaurer',
    url: (c) => `/api/projects/${c.projet}/sauvegardes/${c.sauvegarde}/restaurer`,
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'rayon/retouche',
    methode: 'POST',
    route: '/api/projects/:projectId/rayon/retouche',
    url: p('rayon/retouche'),
    corps: () => ({ chemin: 'src/a.ts', avant: 'const a = 1;\n', apres: 'const a = 2;\n' }),
    refus: 'projet',
    jeton: false,
  },
  {
    nom: 'tasks/:taskId/evaluation/ci',
    methode: 'POST',
    route: '/api/tasks/:taskId/evaluation/ci',
    url: (c) => `/api/tasks/${c.tache}/evaluation/ci`,
    corps: () => ({ resultId: 1 }),
    refus: 'tache',
  },
  {
    nom: 'tasks/:taskId/evaluation/retry',
    methode: 'POST',
    route: '/api/tasks/:taskId/evaluation/retry',
    url: (c) => `/api/tasks/${c.tache}/evaluation/retry`,
    corps: () => ({ resultId: 1 }),
    refus: 'tache',
  },
  {
    nom: 'tasks/:taskId/race',
    methode: 'POST',
    route: '/api/tasks/:taskId/race',
    url: (c) => `/api/tasks/${c.tache}/race`,
    corps: () => ({}),
    refus: 'tache',
  },
];

/**
 * Les actes qui DÉCIDENT du sort d'un travail : propriétaire ou administrateur.
 *
 * La revue approuvée ouvre la livraison autonome ; la livraison et la fusion
 * écrivent sur le dépôt avec la clé GitHub de l'hôte ; l'annulation éteint le
 * travail en cours. Aucun n'ajoute de travail — tous disent ce qu'il devient.
 */
const DECISIONS: readonly Acte[] = [
  {
    nom: 'livraison',
    methode: 'POST',
    route: '/api/livraison',
    url: () => '/api/livraison',
    corps: (c) => ({ taskId: c.tache }),
    refus: 'tache',
  },
  {
    nom: 'livraison/fusion',
    methode: 'POST',
    route: '/api/livraison/fusion',
    url: () => '/api/livraison/fusion',
    corps: (c) => ({ projectId: c.projet, pr: 1 }),
    refus: 'projet',
  },
  {
    // #476 : la mission commitée sur `hive/mission-<projet>-<n>`, sans GitHub.
    // Livrer décide du sort du travail, pousser ou non : la même porte que la
    // livraison GitHub (`proprieteProjetPermise`).
    nom: 'livraison-locale',
    methode: 'POST',
    route: '/api/projects/:projectId/livraison-locale',
    url: p('livraison-locale'),
    corps: () => ({}),
    refus: 'projet',
  },
  {
    nom: 'tasks/:taskId/review',
    methode: 'POST',
    route: '/api/tasks/:taskId/review',
    url: (c) => `/api/tasks/${c.tache}/review`,
    corps: () => ({ state: null }),
    refus: 'tache',
  },
  {
    nom: 'tasks/:taskId/cancel',
    methode: 'POST',
    route: '/api/tasks/:taskId/cancel',
    url: (c) => `/api/tasks/${c.tache}/cancel`,
    refus: 'tache',
  },
];

/** Les actes qui RÈGLENT un projet : propriétaire ou administrateur. */
const REGLAGES: readonly Acte[] = [
  {
    nom: 'essaim (niveau d’autonomie)',
    methode: 'POST',
    route: '/api/projects/:projectId/essaim',
    url: p('essaim'),
    corps: () => ({ niveau: 'off' }),
    refus: 'projet',
  },
  {
    nom: 'garde-fou',
    methode: 'POST',
    route: '/api/projects/:projectId/garde-fou',
    url: p('garde-fou'),
    corps: () => ({ actif: false, borneMin: 'leger', borneMax: 'strict' }),
    refus: 'projet',
  },
  {
    nom: 'balance (plafond de dépense)',
    methode: 'PUT',
    route: '/api/projects/:projectId/balance',
    url: p('balance'),
    corps: () => ({ plafondMs: null }),
    refus: 'projet',
  },
  {
    nom: 'horizon',
    methode: 'POST',
    route: '/api/projects/:projectId/horizon',
    url: p('horizon'),
    corps: () => ({ kind: 'fait', texte: 'le site est en ligne' }),
    refus: 'projet',
  },
];

/**
 * SUPPRIMER le projet : la même porte que les réglages (`proprieteProjetPermise`
 * — propriétaire ou administrateur, le jeton sur un orphelin seulement), mais un
 * acte qui DÉTRUIT sa cible. Chaque essai qui passe consomme donc un projet
 * neuf : il ne peut pas partager les cibles des autres tables, qu'il effacerait
 * sous leurs pieds (bloc « la SUPPRESSION »).
 */
const SUPPRESSIONS: readonly Acte[] = [
  {
    nom: 'supprimer le projet',
    methode: 'DELETE',
    route: '/api/projects/:projectId',
    url: (c) => `/api/projects/${c.projet}`,
    refus: 'projet',
  },
];

/**
 * Les écritures de l'espace projet qui ne sont NI un engagement NI un réglage,
 * chacune avec sa raison. Une route qui n'est nulle part fait rougir le dernier
 * bloc : il faut la classer, sciemment.
 */
const HORS_ENGAGEMENT: Readonly<Record<string, string>> = {
  'POST /api/projects/:projectId/fabriques/juger-chantier':
    'un jugement calculé depuis le corps, rien n’est écrit : la porte des lectures',
  'POST /api/projects/:projectId/join': 'rejoindre soi-même : `peutRejoindre`, compte exigé',
  'POST /api/projects/:projectId/adopter': 'adopter un orphelin : `peutAdopter`, admin seul',
  'POST /api/projects/:projectId/membres': 'admettre : `peutAdmettre`, propriétaire ou admin',
  'DELETE /api/projects/:projectId/membres/:userId': 'retirer : propriétaire ou admin',
  'POST /api/projects/:projectId/partages':
    'un lien de LECTURE, par un compte qui a affaire au projet (`peutEngager`)',
  'DELETE /api/projects/:projectId/partages/:partageId':
    'révoquer : le créateur du lien, ou qui répond du projet (`peutRegler`)',
};

describe('ADR 0007 — le jeton de ruche n’engage plus le projet d’autrui', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonReine = '';
  let jetonProprio = '';
  let jetonMembre = '';
  let jetonTiers = '';
  let idProprio = '';
  let idMembre = '';
  let orphelin: Cible;
  let possede: Cible;
  let publique: Cible;
  const fantome: Cible = {
    projet: 'projet-qui-nexiste-pas',
    tache: 'tache-qui-nexiste-pas',
    fabrique: 'fabrique-qui-nexiste-pas',
    motifPerso: 'motif-qui-nexiste-pas',
    sauvegarde: 'sauvegarde-qui-nexiste-pas',
  };

  const inscrire = async (
    email: string,
    entetes: Record<string, string> = {},
  ): Promise<{ token: string; id: string }> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    const j = (await res.json()) as { token?: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${j.token}` } })
    ).json()) as { id: string };
    return { token: j.token ?? '', id: moi.id };
  };

  /**
   * Tente un acte, avec les en-têtes donnés.
   *
   * Chaque tentative vient d'une adresse distincte (la Reine croit le proxy de
   * la boucle locale) : ce banc éprouve la garde, pas le limiteur de débit —
   * 400 requêtes / 10 s par IP, qu'il dépasserait sinon et qui répondrait 429 à
   * la place de la garde.
   */
  let tentatives = 0;
  const tenter = (c: Cible, acte: Acte, entetes: Record<string, string>): Promise<Response> => {
    const corps = acte.corps?.(c);
    tentatives += 1;
    return fetch(`${base}${acte.url(c)}`, {
      method: acte.methode,
      headers: {
        ...(corps === undefined ? {} : { 'content-type': 'application/json' }),
        'x-forwarded-for': `10.7.${tentatives >> 8}.${tentatives & 255}`,
        ...entetes,
      },
      ...(corps === undefined ? {} : { body: JSON.stringify(corps) }),
    });
  };

  /** Les octets EXACTS du refus de la garde — ceux de l'inexistence. */
  const REFUS = {
    projet: JSON.stringify({ error: 'projet inconnu' }),
    tache: JSON.stringify({ error: 'tâche inconnue' }),
  } as const;

  /**
   * La garde a-t-elle laissé passer ? Ni 401, ni SON 404 à l'octet près. Ce qui
   * vient ensuite dépend du monde (pas de dépôt, pas de GitHub, pas de nœud) et
   * n'a pas à être figé ici.
   */
  const passe = async (res: Response, acte: Acte): Promise<boolean> => {
    if (res.status === 401) return false;
    if (res.status !== 404) return true;
    return (await res.text()) !== REFUS[acte.refus];
  };

  const jeton = { 'x-hive-token': TOKEN };
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });

  /** Un projet, et une cible réelle pour chaque route qui vise un de ses objets. */
  const garnir = (projet: string): Cible => {
    const s = server.store;
    const tache = s.createTask({ projectId: projet, title: 'Une tâche', prompt: 'p' }).id;
    const fabrique = s.ouvrirFabrique(projet, 'script_npm', 'Outillage');
    const motif = s.creerMotifProjet(projet, 'Procédure', ['une étape']);
    const sauvegarde = s.creerSauvegarde({
      projectId: projet,
      label: 'Filet',
      kind: 'manuel',
      patch: 'diff --git a/x b/x\n+y',
    }).id;
    if (!fabrique.ok || !motif.ok) throw new Error('garniture du projet impossible');
    return { projet, tache, fabrique: fabrique.id, motifPerso: motif.id, sauvegarde };
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-engage-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      trustProxy: 'loopback',
    });
    base = `http://127.0.0.1:${server.port}`;

    // ⚠ LE PREMIER COMPTE EST ADMINISTRATEUR par amorçage (et exige le jeton).
    // Si le « tiers » était inscrit en premier, il passerait partout et ce
    // fichier ne prouverait rien.
    jetonReine = (await inscrire('la-reine@ruche.test', jeton)).token;
    const proprio = await inscrire('proprio@ruche.test');
    jetonProprio = proprio.token;
    idProprio = proprio.id;
    const membre = await inscrire('ouvriere@ruche.test');
    jetonMembre = membre.token;
    idMembre = membre.id;
    jetonTiers = (await inscrire('curieux@ailleurs.test')).token;

    // La voie CLI / jeton : un projet que personne ne possède.
    orphelin = garnir(server.store.createProject({ name: 'Projet de la ruche', ownerId: null }).id);
    // La voie compte : un projet qui APPARTIENT à quelqu'un.
    const idPossede = server.store.createProject({
      name: 'Projet de quelqu’un',
      visibility: 'private',
      ownerId: proprio.id,
    }).id;
    server.store.addMember(idPossede, proprio.id, 'owner');
    server.store.addMember(idPossede, membre.id);
    possede = garnir(idPossede);
    // Un projet PUBLIC, mais possédé : « on peut regarder » n'est pas « on peut
    // faire faire ».
    publique = garnir(
      server.store.createProject({ name: 'Vitrine', visibility: 'public', ownerId: proprio.id }).id,
    );
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  describe('les ENGAGEMENTS', () => {
    it('LA VOIE DU JETON RESTE OUVERTE SUR UN PROJET ORPHELIN — la CLI n’est pas cassée', async () => {
      // C'est la moitié du choix : resserrer d'un bloc aurait cassé la CLI, qui
      // n'a que ce jeton, et le mode « tableau de bord sans compte ». Le
      // contraste avec le test suivant — MÊMES corps, MÊMES en-têtes, seule la
      // propriété change — porte la preuve.
      for (const acte of ENGAGEMENTS.filter((a) => a.jeton !== false)) {
        const r = await tenter(orphelin, acte, jeton);
        expect(await passe(r, acte), `${acte.nom} sur un projet orphelin (${r.status})`).toBe(true);
      }
    });

    it('LE JETON N’ENGAGE PLUS UN PROJET QUI APPARTIENT À QUELQU’UN', async () => {
      for (const acte of ENGAGEMENTS.filter((a) => a.jeton !== false)) {
        const r = await tenter(possede, acte, jeton);
        expect(r.status, `${acte.nom} sur le projet d’autrui`).toBe(404);
        expect(await r.text(), acte.nom).toBe(REFUS[acte.refus]);
      }
    });

    it('« PUBLIC » NE VEUT PAS DIRE « CHANTIER OUVERT »', async () => {
      // Un projet public se LIT par tout le monde. Y ajouter du travail — y
      // compris par une sauvegarde restaurée ou une retouche du Rayon, qui se
      // gardaient par la LECTURE — est un autre acte.
      for (const acte of ENGAGEMENTS) {
        if (acte.jeton !== false) {
          const r = await tenter(publique, acte, jeton);
          expect(r.status, `${acte.nom} par le jeton sur un projet public`).toBe(404);
        }
        const t = await tenter(publique, acte, compte(jetonTiers));
        expect(t.status, `${acte.nom} par un tiers sur un projet public`).toBe(404);
      }
    });

    it('LE PROPRIÉTAIRE, LE MEMBRE ET L’ADMINISTRATRICE ENGAGENT, AVEC LEUR SEUL COMPTE', async () => {
      // L'autre moitié du choix : la règle n'est pas « il faut le jeton », c'est
      // « il faut avoir affaire au projet ».
      for (const acte of ENGAGEMENTS) {
        for (const [qui, t] of [
          ['le propriétaire', jetonProprio],
          ['un membre', jetonMembre],
          ['l’administratrice', jetonReine],
        ] as const) {
          const r = await tenter(possede, acte, compte(t));
          expect(await passe(r, acte), `${acte.nom} par ${qui} (${r.status})`).toBe(true);
        }
      }
    });

    it('UN COMPTE ÉTRANGER AU PROJET NE L’ENGAGE PAS — même en ajoutant le jeton', async () => {
      for (const acte of ENGAGEMENTS) {
        expect((await tenter(possede, acte, compte(jetonTiers))).status, acte.nom).toBe(404);
        const avecJeton = await tenter(possede, acte, { ...compte(jetonTiers), ...jeton });
        expect(avecJeton.status, `${acte.nom} (compte étranger + jeton)`).toBe(404);
      }
    });

    it('LE REFUS EST INDISTINGUABLE DE L’INEXISTENCE, À L’OCTET PRÈS', async () => {
      // Un « 403 » poli sur le projet d'autrui confirmerait qu'il existe, et
      // répété sur une liste d'identifiants il dessinerait la carte des projets
      // de la ruche. C'est la convention du dépôt (ADR 0005).
      for (const acte of ENGAGEMENTS) {
        const refuse = await tenter(possede, acte, compte(jetonTiers));
        const absent = await tenter(fantome, acte, compte(jetonTiers));
        expect(refuse.status, acte.nom).toBe(absent.status);
        expect(await refuse.text(), acte.nom).toBe(await absent.text());
      }
    });

    it('sans aucune identité valide, c’est 401 — et le projet reste hors sujet', async () => {
      for (const acte of ENGAGEMENTS) {
        expect((await tenter(orphelin, acte, {})).status, acte.nom).toBe(401);
        expect((await tenter(fantome, acte, {})).status, `${acte.nom} (inconnu)`).toBe(401);
      }
    });

    it('LA FABRIQUE D’UN AUTRE PROJET NE SE CLÔT PAS PAR CELUI-CI', async () => {
      // La garde juge le projet de l'URL ; la fabrique visée doit en être. Sans
      // cela, un droit sur l'orphelin suffisait à clore la fabrique d'autrui.
      const r = await fetch(
        `${base}/api/projects/${orphelin.projet}/fabriques/${possede.fabrique}/statut`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...jeton },
          body: JSON.stringify({ statut: 'refusee' }),
        },
      );
      expect(r.status).toBe(404);
      const statut = server.store
        .listerFabriques(possede.projet)
        .find((f) => f.id === possede.fabrique)?.statut;
      expect(statut, 'la fabrique d’autrui a changé d’état').not.toBe('refusee');
    });
  });

  describe('les RÉGLAGES', () => {
    it('le propriétaire et l’administratrice règlent ; le jeton règle un orphelin', async () => {
      for (const acte of REGLAGES) {
        for (const [qui, t] of [
          ['le propriétaire', jetonProprio],
          ['l’administratrice', jetonReine],
        ] as const) {
          const r = await tenter(possede, acte, compte(t));
          expect(r.status, `${acte.nom} par ${qui}`).toBe(200);
        }
        expect((await tenter(orphelin, acte, jeton)).status, `${acte.nom} (orphelin)`).toBe(200);
      }
    });

    it('UN MEMBRE ENGAGE, MAIS NE RÈGLE PAS — et le refus dit à qui s’adresser', async () => {
      // Il ajoute des tâches ; il ne lève pas le plafond que le propriétaire a
      // posé, ni ne rend la ruche libre de fusionner sur son dépôt. Il sait que
      // le projet existe : un 404 le ferait chercher une panne inexistante.
      for (const acte of REGLAGES) {
        const r = await tenter(possede, acte, compte(jetonMembre));
        expect(r.status, `${acte.nom} par un membre`).toBe(403);
        expect(((await r.json()) as { error: string }).error).toMatch(/propriétaire/);
        // Le jeton ne rachète pas le membre sur un projet qui a un propriétaire.
        const avecJeton = await tenter(possede, acte, { ...compte(jetonMembre), ...jeton });
        expect(avecJeton.status, `${acte.nom} par un membre + jeton`).toBe(403);
      }
    });

    it('LE JETON NE RÈGLE PAS LE PROJET D’AUTRUI — ni `plein`, ni le plafond, ni le reste', async () => {
      for (const acte of REGLAGES) {
        const r = await tenter(possede, acte, jeton);
        expect(r.status, `${acte.nom} par le jeton`).toBe(404);
        expect(await r.text()).toBe(REFUS.projet);
        expect((await tenter(possede, acte, compte(jetonTiers))).status, acte.nom).toBe(404);
        expect((await tenter(possede, acte, {})).status, `${acte.nom} anonyme`).toBe(401);
      }
      const plein = await fetch(`${base}/api/projects/${possede.projet}/essaim`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...jeton },
        body: JSON.stringify({ niveau: 'plein', depotInscrit: true }),
      });
      expect(plein.status).toBe(404);
      expect(server.store.getEssaim(possede.projet)?.niveau ?? 'off').not.toBe('plein');
    });
  });

  describe('les DÉCISIONS', () => {
    it('le propriétaire et l’administratrice décident ; le jeton décide sur un orphelin', async () => {
      for (const acte of DECISIONS) {
        for (const [qui, t] of [
          ['le propriétaire', jetonProprio],
          ['l’administratrice', jetonReine],
        ] as const) {
          const r = await tenter(possede, acte, compte(t));
          expect(await passe(r, acte), `${acte.nom} par ${qui} (${r.status})`).toBe(true);
          expect(r.status, `${acte.nom} par ${qui}`).not.toBe(403);
        }
        const r = await tenter(orphelin, acte, jeton);
        expect(await passe(r, acte), `${acte.nom} (orphelin, ${r.status})`).toBe(true);
        expect(r.status, `${acte.nom} (orphelin)`).not.toBe(403);
      }
    });

    it('UN MEMBRE ENGAGE, MAIS NE DÉCIDE PAS — même en ajoutant le jeton', async () => {
      for (const acte of DECISIONS) {
        const r = await tenter(possede, acte, compte(jetonMembre));
        expect(r.status, `${acte.nom} par un membre`).toBe(403);
        expect(((await r.json()) as { error: string }).error).toMatch(/propriétaire/);
        const avecJeton = await tenter(possede, acte, { ...compte(jetonMembre), ...jeton });
        expect(avecJeton.status, `${acte.nom} par un membre + jeton`).toBe(403);
      }
    });

    it('ni le jeton sur le projet d’autrui, ni un tiers, ni l’anonyme', async () => {
      for (const acte of DECISIONS) {
        const r = await tenter(possede, acte, jeton);
        expect(r.status, `${acte.nom} par le jeton`).toBe(404);
        expect(await r.text(), acte.nom).toBe(REFUS[acte.refus]);
        expect((await tenter(possede, acte, compte(jetonTiers))).status, acte.nom).toBe(404);
        const tiersEtJeton = await tenter(possede, acte, { ...compte(jetonTiers), ...jeton });
        expect(tiersEtJeton.status, `${acte.nom} (tiers + jeton)`).toBe(404);
        expect((await tenter(possede, acte, {})).status, `${acte.nom} anonyme`).toBe(401);
      }
    });

    it('S’INSCRIRE SUR UNE VITRINE N’Y DONNE PAS LE DROIT DE DÉCIDER', async () => {
      // LE TROU QUE CE TEST FERME. `peutRejoindre` ouvre tout projet public au
      // premier compte venu, et un membre ENGAGE : un inconnu inscrit à
      // l'instant, sans le jeton de ruche, rejoignait la vitrine d'un clic, puis
      // livrait et fusionnait avec la clé GitHub de l'hôte, et approuvait sa
      // propre revue — que la ruche en `gouverne` livrait ensuite d'elle-même.
      //
      // Ce qu'un membre inscrit tout seul peut ENGAGER (des tâches) reste la
      // règle de l'ADR 0007 tant que l'hôte n'a pas tranché ; ce qu'il ne peut
      // pas, c'est DÉCIDER. Projet et inconnu neufs : rejoindre change l'état,
      // et `tamis-ordres` rejoue ce fichier dans tous les ordres.
      const passant = await inscrire(`passant-${Date.now()}@ailleurs.test`);
      const vitrine = garnir(
        server.store.createProject({
          name: 'Vitrine ouverte',
          visibility: 'public',
          ownerId: server.store.getProject(possede.projet)!.ownerId,
        }).id,
      );
      const rejoint = await fetch(`${base}/api/projects/${vitrine.projet}/join`, {
        method: 'POST',
        headers: { ...compte(passant.token), 'x-forwarded-for': '10.9.9.9' },
      });
      expect(rejoint.status, 'le banc : la vitrine se rejoint d’un clic').toBe(200);
      for (const acte of DECISIONS) {
        const r = await tenter(vitrine, acte, compte(passant.token));
        expect(r.status, `${acte.nom} par un membre inscrit tout seul`).toBe(403);
      }
      expect(server.store.getTaskReview(vitrine.tache), 'une revue a été rendue').toBeFalsy();
      expect(server.store.getTask(vitrine.tache)?.status, 'la tâche a été annulée').toBe('pending');
    });
  });

  describe('la SUPPRESSION', () => {
    const [supprimer] = SUPPRESSIONS as [Acte];
    /** Un projet NEUF qui appartient au propriétaire, le membre admis — la cible d'un seul essai. */
    const possedeNeuf = (): Cible => {
      const id = server.store.createProject({
        name: 'À supprimer',
        visibility: 'private',
        ownerId: idProprio,
      }).id;
      server.store.addMember(id, idProprio, 'owner');
      server.store.addMember(id, idMembre);
      return garnir(id);
    };
    const orphelinNeuf = (): Cible =>
      garnir(server.store.createProject({ name: 'Orphelin à supprimer', ownerId: null }).id);

    it('le propriétaire et l’administratrice suppriment ; le jeton supprime un orphelin', async () => {
      for (const [qui, cible, entetes] of [
        ['le propriétaire', possedeNeuf(), compte(jetonProprio)],
        ['l’administratrice', possedeNeuf(), compte(jetonReine)],
        ['le jeton de ruche, sur un orphelin', orphelinNeuf(), jeton],
      ] as const) {
        const r = await tenter(cible, supprimer, entetes);
        expect(r.status, `${qui} (${await r.text()})`).toBe(200);
        expect(
          server.store.getProject(cible.projet),
          `${qui} : le projet est resté`,
        ).toBeUndefined();
      }
    });

    it('UN MEMBRE NE SUPPRIME PAS — 403, même avec le jeton, et rien ne part', async () => {
      const cible = possedeNeuf();
      for (const entetes of [compte(jetonMembre), { ...compte(jetonMembre), ...jeton }]) {
        const r = await tenter(cible, supprimer, entetes);
        expect(r.status).toBe(403);
        expect(((await r.json()) as { error: string }).error).toMatch(/propriétaire/);
      }
      expect(server.store.getProject(cible.projet)).toBeDefined();
      expect(server.store.getTask(cible.tache), 'une tâche est partie').toBeDefined();
    });

    it('ni le jeton sur le projet d’autrui, ni un tiers, ni l’anonyme — refus de l’inexistence', async () => {
      const cible = possedeNeuf();
      const parJeton = await tenter(cible, supprimer, jeton);
      expect(parJeton.status).toBe(404);
      expect(await parJeton.text()).toBe(REFUS.projet);
      for (const entetes of [compte(jetonTiers), { ...compte(jetonTiers), ...jeton }]) {
        const r = await tenter(cible, supprimer, entetes);
        const absent = await tenter(fantome, supprimer, entetes);
        expect(r.status).toBe(404);
        expect(await r.text(), 'le refus trahit l’existence du projet').toBe(await absent.text());
      }
      expect((await tenter(cible, supprimer, {})).status).toBe(401);
      expect((await tenter(fantome, supprimer, {})).status).toBe(401);
      expect(server.store.getProject(cible.projet)).toBeDefined();
    });

    it('UNE VITRINE N’EST PAS À QUI S’Y INSCRIT', async () => {
      // `peutRejoindre` ouvre tout projet public au premier compte venu : s'y
      // inscrire d'un clic ne donne pas le droit de l'effacer.
      const passant = await inscrire(`passant-suppr-${Date.now()}@ailleurs.test`);
      const vitrine = garnir(
        server.store.createProject({ name: 'Vitrine', visibility: 'public', ownerId: idProprio })
          .id,
      );
      const rejoint = await fetch(`${base}/api/projects/${vitrine.projet}/join`, {
        method: 'POST',
        headers: { ...compte(passant.token), 'x-forwarded-for': '10.9.9.10' },
      });
      expect(rejoint.status, 'le banc : la vitrine se rejoint d’un clic').toBe(200);
      expect((await tenter(vitrine, supprimer, compte(passant.token))).status).toBe(403);
      expect(server.store.getProject(vitrine.projet)).toBeDefined();
    });
  });

  describe('les LIENS DE PARTAGE', () => {
    /** Un lien créé par `t` sur `projet` ; rend son identifiant. */
    const partager = async (projet: string, t: string): Promise<string> => {
      const r = await fetch(`${base}/api/projects/${projet}/partages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...compte(t) },
        body: JSON.stringify({ label: 'pour un invité' }),
      });
      expect(r.status, 'le banc : créer un lien').toBe(200);
      return ((await r.json()) as { id: string }).id;
    };
    const lister = (projet: string, t: string) =>
      fetch(`${base}/api/projects/${projet}/partages`, { headers: compte(t) });
    const revoquer = (projet: string, id: string, t: string) =>
      fetch(`${base}/api/projects/${projet}/partages/${id}`, {
        method: 'DELETE',
        headers: compte(t),
      });

    it('UN INCONNU NE VOIT NI NE RÉVOQUE LES LIENS D’UNE VITRINE', async () => {
      // `peutLireCode` gardait ces routes : vrai pour tout inscrit sur un projet
      // public. Un inconnu listait les liens du propriétaire et les révoquait,
      // coupant la vue qu'il avait donnée à ses invités.
      const id = await partager(publique.projet, jetonProprio);
      expect((await lister(publique.projet, jetonTiers)).status).toBe(404);
      expect((await revoquer(publique.projet, id, jetonTiers)).status).toBe(404);
      const creer = await fetch(`${base}/api/projects/${publique.projet}/partages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...compte(jetonTiers) },
        body: '{}',
      });
      expect(creer.status, 'un inconnu crée un lien sur la vitrine d’autrui').toBe(404);
      expect(server.store.getPartage(id)?.revoqueA, 'le lien a été révoqué').toBe(0);
    });

    it('UN MEMBRE GÈRE SES LIENS, PAS CEUX DU PROPRIÉTAIRE', async () => {
      const duProprio = await partager(possede.projet, jetonProprio);
      const duMembre = await partager(possede.projet, jetonMembre);
      const vus = (await (await lister(possede.projet, jetonMembre)).json()) as { id: string }[];
      expect(vus.map((l) => l.id)).toContain(duMembre);
      expect(
        vus.map((l) => l.id),
        'le membre voit le lien du propriétaire',
      ).not.toContain(duProprio);
      const r = await revoquer(possede.projet, duProprio, jetonMembre);
      expect(r.status).toBe(404);
      expect(await r.text()).toBe(JSON.stringify({ error: 'lien inconnu' }));
      expect(server.store.getPartage(duProprio)?.revoqueA).toBe(0);
      expect((await revoquer(possede.projet, duMembre, jetonMembre)).status).toBe(200);
      // Le propriétaire, lui, voit et révoque tout.
      const tous = (await (await lister(possede.projet, jetonProprio)).json()) as { id: string }[];
      expect(tous.map((l) => l.id)).toEqual(expect.arrayContaining([duProprio, duMembre]));
      expect((await revoquer(possede.projet, duProprio, jetonProprio)).status).toBe(200);
    });
  });

  it('ADOPTER UN PROJET LE SOUSTRAIT AU JETON DE TOUT L’ESSAIM', async () => {
    // LE TEST QUI PORTE LA MIGRATION. La voie (c) de l'ADR — séparer le jeton
    // d'opérateur de la clé de nœud — demande de retirer au jeton partagé ce
    // qu'il n'aurait jamais dû avoir. Ce geste-là existe déjà et se fait projet
    // par projet : l'adoption.
    const aAdopter = garnir(server.store.createProject({ name: 'À protéger', ownerId: null }).id);
    const parLeJeton = [...ENGAGEMENTS, ...REGLAGES, ...DECISIONS].filter((a) => a.jeton !== false);
    for (const acte of parLeJeton) {
      const r = await tenter(aAdopter, acte, jeton);
      expect(await passe(r, acte), `avant : ${acte.nom}`).toBe(true);
    }

    const adoption = await fetch(`${base}/api/projects/${aAdopter.projet}/adopter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...compte(jetonReine) },
    });
    expect(adoption.status, 'l’adoption doit réussir').toBe(200);

    for (const acte of parLeJeton) {
      expect((await tenter(aAdopter, acte, jeton)).status, `après : ${acte.nom}`).toBe(404);
    }
  });

  it('AUCUNE ROUTE D’ÉCRITURE DE L’ESPACE PROJET N’ÉCHAPPE À CES TABLES', () => {
    // Les tables ci-dessus ne valent que si elles sont complètes : ce sont des
    // routes ajoutées sans garde qui ont ouvert dix-sept portes. Toute écriture
    // qui vise un projet, une tâche ou une livraison doit donc être un
    // engagement, un réglage, ou figurer — avec sa raison — dans
    // `HORS_ENGAGEMENT`.
    const serveur = readFileSync(
      path.join(path.dirname(fileURLToPath(import.meta.url)), '../src/orchestrator/server.ts'),
      'utf8',
    );
    const ecritures = [
      ...serveur.matchAll(/app\.(post|put|patch|delete)\b[\s\S]{0,400}?'(\/api\/[^']+)'/g),
    ].map((m) => `${m[1]!.toUpperCase()} ${m[2]!}`);
    // Chaque écriture déclarée doit avoir livré son chemin : un relevé qui en
    // perdrait une la laisserait passer sans qu'aucune assertion ne la voie.
    expect(ecritures.length, 'une écriture du serveur a échappé au relevé').toBe(
      [...serveur.matchAll(/app\.(post|put|patch|delete)\b/g)].length,
    );
    // `projects/:projectId` SANS suite compte aussi : c'est le projet lui-même
    // (sa suppression), l'écriture la plus lourde de l'espace projet.
    const declarees = ecritures.filter((r) =>
      /^\S+ \/api\/(projects\/:projectId(\/|$)|tasks\/:taskId\/|livraison)/.test(r),
    );
    const connues = new Set([
      ...[...ENGAGEMENTS, ...REGLAGES, ...DECISIONS, ...SUPPRESSIONS].map(
        (a) => `${a.methode} ${a.route}`,
      ),
      ...Object.keys(HORS_ENGAGEMENT),
    ]);
    expect(declarees.length, 'le relevé des routes a échoué').toBeGreaterThan(30);
    for (const route of declarees) {
      expect(connues.has(route), `${route} n’est classée nulle part`).toBe(true);
    }
    // L'inverse aussi : une ligne qui ne désigne plus aucune route est une
    // exemption qui survit à ce qu'elle exemptait.
    for (const route of [...connues].filter((r) => !r.startsWith('GET '))) {
      expect(declarees, `${route} ne désigne plus aucune route`).toContain(route);
    }
  });
});
