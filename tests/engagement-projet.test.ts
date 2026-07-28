// ADR 0007, TRANCHÉ — ce que le jeton de ruche peut encore ENGAGER.
//
// ─── LA DÉCISION QUE CE FICHIER DÉFEND ───────────────────────────────────────
//
// Le constat de l'ADR : `HIVE_TOKEN` se recopie sur CHAQUE machine membre, et
// ouvrait pourtant onze routes de l'espace projet sans aucune règle par projet.
// Toute abeille qui prête sa machine pouvait donc créer des tâches et lancer
// des merges sur le projet de quelqu'un d'autre — donc faire tourner du code
// sur les machines de l'essaim au nom d'un projet qui ne la regarde pas.
//
// La frontière retenue n'est pas « lire ou écrire », c'est **« ce projet vous
// regarde-t-il ? »** :
//
//   · un COMPTE qui a affaire au projet — propriétaire, membre, administrateur ;
//   · OU un projet SANS PROPRIÉTAIRE, qui n'appartient qu'à la ruche, et pour
//     lequel le jeton de ruche EST la ruche.
//
// ─── POURQUOI CE FICHIER EXISTE ALORS QUE RIEN N'AVAIT ROUGI ─────────────────
//
// Le resserrement n'a cassé AUCUN test de la suite. C'est exactement le genre de
// silence qui doit inquiéter : une garde qu'aucun test ne voit mordre est une
// garde qu'on retirera un jour sans s'en apercevoir. Les quatre routes
// concernées sont donc éprouvées ici, des DEUX côtés de la frontière.
//
// ─── ET LA MIGRATION ─────────────────────────────────────────────────────────
//
// Le dernier test est le plus important du fichier : ADOPTER un projet le
// SOUSTRAIT au jeton que tout l'essaim détient. C'est le chemin vers la voie
// (c) de l'ADR — séparer jeton d'opérateur et clé de nœud — parcouru projet par
// projet, par un geste qui existe déjà, sans couper personne du jour au
// lendemain.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

const TOKEN = 'jeton-de-ruche-suffisamment-long-42';

/**
 * Les quatre actes qui ENGAGENT un projet, tels que les routes les exposent.
 *
 * ⚠ LES CORPS DOIVENT ÊTRE VALIDES. Fastify valide le schéma AVANT d'entrer
 * dans le gestionnaire : un corps mal formé rend 400 sans jamais consulter la
 * garde, et un test qui l'ignore passe pour de mauvaises raisons — c'est
 * exactement ce qui est arrivé à la première version de ce fichier, où
 * `tasks` était éprouvé avec `{title, prompt}` au lieu de `{tasks: [...]}`.
 */
const ENGAGEMENTS = [
  {
    nom: 'tasks',
    chemin: 'tasks',
    corps: { tasks: [{ title: 'une tâche', prompt: 'faire quelque chose' }] },
  },
  { nom: 'brief', chemin: 'brief', corps: { brief: 'construire un site' } },
  { nom: 'conseil', chemin: 'conseil', corps: {} },
  { nom: 'merge/run', chemin: 'merge/run', corps: {} },
] as const;

describe('ADR 0007 — le jeton de ruche n’engage plus le projet d’autrui', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let jetonProprio = '';
  let jetonMembre = '';
  let jetonTiers = '';
  let idMembre = '';
  let orphelin = '';
  let possede = '';
  let publique = '';

  const inscrire = async (email: string): Promise<{ token: string; id: string }> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    const j = (await res.json()) as { token?: string };
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${j.token}` } })
    ).json()) as { id: string };
    return { token: j.token ?? '', id: moi.id };
  };

  /** Tente un engagement, avec les en-têtes donnés. */
  const engager = (
    projet: string,
    acte: (typeof ENGAGEMENTS)[number],
    entetes: Record<string, string>,
  ): Promise<Response> =>
    fetch(`${base}/api/projects/${projet}/${acte.chemin}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify(acte.corps),
    });

  const jeton = { 'x-hive-token': TOKEN };
  const compte = (t: string) => ({ authorization: `Bearer ${t}` });

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
    });
    base = `http://127.0.0.1:${server.port}`;

    // ⚠ LE PREMIER COMPTE EST ADMINISTRATEUR par amorçage. Si le « tiers »
    // était inscrit en premier, il passerait partout et ce fichier ne
    // prouverait rien. On brûle donc la place d'admin avec un compte neutre.
    await inscrire('la-reine@ruche.test');
    jetonProprio = (await inscrire('proprio@ruche.test')).token;
    const membre = await inscrire('ouvriere@ruche.test');
    jetonMembre = membre.token;
    idMembre = membre.id;
    jetonTiers = (await inscrire('curieux@ailleurs.test')).token;

    const moiProprio = (await (
      await fetch(`${base}/api/auth/me`, { headers: compte(jetonProprio) })
    ).json()) as { id: string };

    // La voie CLI / jeton : un projet que personne ne possède.
    orphelin = server.store.createProject({ name: 'Projet de la ruche', ownerId: null }).id;
    // La voie compte : un projet qui APPARTIENT à quelqu'un.
    possede = server.store.createProject({
      name: 'Projet de quelqu’un',
      visibility: 'private',
      ownerId: moiProprio.id,
    }).id;
    server.store.addMember(possede, moiProprio.id, 'owner');
    server.store.addMember(possede, idMembre);
    // Un projet PUBLIC, mais possédé : « on peut regarder » n'est pas « on peut
    // faire faire ».
    publique = server.store.createProject({
      name: 'Vitrine',
      visibility: 'public',
      ownerId: moiProprio.id,
    }).id;
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  it('LA VOIE DU JETON RESTE OUVERTE SUR UN PROJET ORPHELIN — la CLI n’est pas cassée', async () => {
    // C'est la moitié du choix : resserrer d'un bloc aurait cassé la CLI, qui
    // n'a que ce jeton, et le mode « tableau de bord sans compte ». Un projet
    // orphelin n'appartient qu'à la ruche — le jeton de ruche EST la ruche.
    //
    // POURQUOI « ni 401 ni 404 » PROUVE LE PASSAGE : ce sont les deux SEULES
    // réponses que la garde produise. Ce qui vient ensuite dépend du monde et
    // n'a pas à être figé ici — mesuré au moment d'écrire : tasks 201,
    // conseil 201, merge/run 400 (pas de dépôt), brief 500 (pas de clé API).
    // C'est le contraste avec le test suivant — MÊME corps, MÊMES en-têtes,
    // seule la propriété du projet change, et tout devient 404 — qui porte la
    // preuve.
    for (const acte of ENGAGEMENTS) {
      const r = await engager(orphelin, acte, jeton);
      expect(r.status, `${acte.nom} sur un projet orphelin`).not.toBe(401);
      expect(r.status, `${acte.nom} sur un projet orphelin`).not.toBe(404);
    }
  });

  it('LE JETON N’ENGAGE PLUS UN PROJET QUI APPARTIENT À QUELQU’UN', async () => {
    // Le fond du constat de l'ADR, refermé : l'abeille qui a reçu HIVE_TOKEN
    // parce qu'elle prête sa machine ne fait plus travailler l'essaim au nom
    // d'un projet qui ne la regarde pas.
    for (const acte of ENGAGEMENTS) {
      const r = await engager(possede, acte, jeton);
      expect(r.status, `${acte.nom} sur le projet d’autrui`).toBe(404);
    }
  });

  it('« PUBLIC » NE VEUT PAS DIRE « CHANTIER OUVERT »', async () => {
    // Un projet public se LIT par tout le monde — c'est ce que le mot veut
    // dire. Y ajouter du travail est un autre acte : sinon chaque projet
    // vitrine devient une file d'attente que n'importe qui remplit.
    for (const acte of ENGAGEMENTS) {
      expect(
        (await engager(publique, acte, jeton)).status,
        `${acte.nom} par le jeton sur un projet public`,
      ).toBe(404);
      expect(
        (await engager(publique, acte, compte(jetonTiers))).status,
        `${acte.nom} par un tiers sur un projet public`,
      ).toBe(404);
    }
  });

  it('LE PROPRIÉTAIRE ET LE MEMBRE ENGAGENT, AVEC LEUR SEUL COMPTE', async () => {
    // L'autre moitié du choix : la règle n'est pas « il faut le jeton », c'est
    // « il faut avoir affaire au projet ». Sans cela, on aurait fermé une porte
    // en laissant les ayants droit dehors.
    for (const acte of ENGAGEMENTS) {
      for (const [qui, t] of [
        ['le propriétaire', jetonProprio],
        ['un membre', jetonMembre],
      ] as const) {
        const r = await engager(possede, acte, compte(t));
        expect(r.status, `${acte.nom} par ${qui}`).not.toBe(401);
        expect(r.status, `${acte.nom} par ${qui}`).not.toBe(404);
      }
    }
  });

  it('UN COMPTE ÉTRANGER AU PROJET NE L’ENGAGE PAS', async () => {
    for (const acte of ENGAGEMENTS) {
      expect((await engager(possede, acte, compte(jetonTiers))).status, acte.nom).toBe(404);
    }
  });

  it('LE REFUS EST INDISTINGUABLE DE L’INEXISTENCE, À L’OCTET PRÈS', async () => {
    // Un « 403 » poli sur le projet d'autrui confirmerait qu'il existe, et
    // répété sur une liste d'identifiants il dessinerait la carte des projets
    // de la ruche. C'est la convention du dépôt (ADR 0005), tenue ici aussi.
    for (const acte of ENGAGEMENTS) {
      const refuse = await engager(possede, acte, compte(jetonTiers));
      const fantome = await engager('projet-qui-nexiste-pas', acte, compte(jetonTiers));
      expect(refuse.status, acte.nom).toBe(fantome.status);
      expect(await refuse.text(), acte.nom).toBe(await fantome.text());
    }
  });

  it('sans aucune identité valide, c’est 401 — et le projet reste hors sujet', async () => {
    // Le seul cas qui mérite « jeton invalide » : il ne dit rien du projet, il
    // dit que l'appelant n'est personne. Un 404 ici laisserait croire qu'un
    // jeton correct aurait suffi.
    for (const acte of ENGAGEMENTS) {
      expect((await engager(orphelin, acte, {})).status, acte.nom).toBe(401);
      expect((await engager('fantome', acte, {})).status, `${acte.nom} (inconnu)`).toBe(401);
    }
  });

  it('ADOPTER UN PROJET LE SOUSTRAIT AU JETON DE TOUT L’ESSAIM', async () => {
    // LE TEST QUI PORTE LA MIGRATION. La voie (c) de l'ADR — séparer le jeton
    // d'opérateur de la clé de nœud — demande de retirer au jeton partagé ce
    // qu'il n'aurait jamais dû avoir. Ce geste-là existe déjà et se fait projet
    // par projet : l'adoption.
    const aAdopter = server.store.createProject({ name: 'À protéger', ownerId: null }).id;
    for (const acte of ENGAGEMENTS) {
      expect((await engager(aAdopter, acte, jeton)).status, `avant : ${acte.nom}`).not.toBe(404);
    }

    // La Reine (premier compte, donc administratrice) l'adopte.
    const connexion = (await (
      await fetch(`${base}/api/auth/login`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          email: 'la-reine@ruche.test',
          password: 'motdepasse-assez-long-42',
        }),
      })
    ).json()) as { token?: string };
    const jetonReine = connexion.token ?? '';
    expect(jetonReine, 'la Reine doit pouvoir se connecter').not.toBe('');
    const adoption = await fetch(`${base}/api/projects/${aAdopter}/adopter`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...compte(jetonReine) },
    });
    expect(adoption.status, 'l’adoption doit réussir').toBe(200);

    for (const acte of ENGAGEMENTS) {
      expect((await engager(aAdopter, acte, jeton)).status, `après : ${acte.nom}`).toBe(404);
    }
  });
});
