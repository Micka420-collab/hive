// Rejoindre un projet, et voir qui y travaille — deux portes qui n'étaient pas
// fermées.
//
// `POST /api/projects/:id/join` ne vérifiait qu'une chose : que l'appelant soit
// authentifié. N'importe quel compte pouvait donc s'ajouter à N'IMPORTE QUEL
// projet, privé compris. `GET /api/projects/:id/members` avait le même trou :
// la liste nominative des membres d'un projet privé était lisible par tout
// titulaire d'un compte — créer un compte suffisait à énumérer qui travaille
// sur quoi.
//
// La colonne `visibility` existait depuis le début, et `ownerId` aussi. Aucun
// des deux n'était consulté ici.
//
// ─── LE TEST QUI COMPTE ──────────────────────────────────────────────────────
//
// Ce n'est pas « le refus arrive » : c'est que le refus soit INDISTINGUABLE de
// l'inexistence, à l'octet près. Un « 403 interdit » confirmerait que le projet
// existe, et répété sur une liste d'identifiants il dessinerait la carte des
// projets de la ruche. Les identifiants voyagent — une URL collée dans un
// salon, un journal, un signet.

import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  peutAdmettre,
  peutLireCode,
  peutRejoindre,
  peutVoirMembres,
} from '../src/shared/acces-projet.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('la décision, seule', () => {
  const publique = { visibility: 'public' as const, ownerId: 'proprio' };
  const privee = { visibility: 'private' as const, ownerId: 'proprio' };
  /** Un membre ordinaire : il ne voit que ce qui le regarde. */
  const qui = (userId: string) => ({ userId, voitTout: false });
  /** Un administrateur : la matrice lui accorde `voir_tous_les_projets`. */
  const admin = (userId = 'la-reine') => ({ userId, voitTout: true });

  it('un projet PUBLIC est ouvert — c’est ce que le mot veut dire', () => {
    expect(peutRejoindre(publique, qui('inconnu'), false)).toBe(true);
    expect(peutVoirMembres(publique, qui('inconnu'), false)).toBe(true);
    expect(peutLireCode(publique, qui('inconnu'), false)).toBe(true);
  });

  it('UN PROJET PRIVÉ NE S’OUVRE PAS TOUT SEUL', () => {
    expect(peutRejoindre(privee, qui('inconnu'), false)).toBe(false);
    expect(peutVoirMembres(privee, qui('inconnu'), false)).toBe(false);
    expect(peutLireCode(privee, qui('inconnu'), false)).toBe(false);
  });

  it('le propriétaire et les membres passent', () => {
    expect(peutRejoindre(privee, qui('proprio'), false)).toBe(true);
    expect(peutRejoindre(privee, qui('membre'), true)).toBe(true);
    expect(peutVoirMembres(privee, qui('proprio'), false)).toBe(true);
    expect(peutVoirMembres(privee, qui('membre'), true)).toBe(true);
  });

  it('un projet SANS propriétaire n’appartient pas au premier venu', () => {
    // `ownerId` est nullable en base : un projet sans propriétaire n'appartient
    // à personne, pas à tout le monde. Comparer sans garde ferait de quiconque
    // a un `userId` vide le propriétaire de tous les projets orphelins.
    const orphelin = { visibility: 'private' as const, ownerId: null };
    expect(peutRejoindre(orphelin, qui('quelquun'), false)).toBe(false);
    expect(peutVoirMembres(orphelin, qui('quelquun'), false)).toBe(false);
    expect(peutLireCode(orphelin, { userId: '', voitTout: false }, false)).toBe(false);
  });

  describe('L’ADMINISTRATEUR VOIT TOUT — la matrice le disait déjà', () => {
    // Ce bloc existe à cause d'un trou trouvé en éprouvant le connecteur
    // GitHub de bout en bout : un projet IMPORTÉ est privé et sans
    // propriétaire (la route d'import s'authentifie par le jeton de ruche,
    // pas par un compte), donc il n'était lisible par PERSONNE — pas même par
    // l'administrateur de la ruche.
    it('il lit un projet privé dont il n’est ni propriétaire ni membre', () => {
      expect(peutLireCode(privee, admin(), false)).toBe(true);
      expect(peutVoirMembres(privee, admin(), false)).toBe(true);
      expect(peutRejoindre(privee, admin(), false)).toBe(true);
    });

    it('IL LIT UN PROJET ORPHELIN — le cas exact du dépôt importé', () => {
      const importe = { visibility: 'private' as const, ownerId: null };
      expect(peutLireCode(importe, admin(), false)).toBe(true);
      expect(peutRejoindre(importe, admin(), false)).toBe(true);
    });

    it('…et un membre ordinaire, non', () => {
      // Le droit vient du RÔLE, pas de l'absence de propriétaire : sinon tout
      // projet orphelin serait public de fait.
      const importe = { visibility: 'private' as const, ownerId: null };
      expect(peutLireCode(importe, qui('un-membre'), false)).toBe(false);
    });
  });

  describe('ADMETTRE — un droit de propriétaire, que « public » ne dilue pas', () => {
    // Trouvé en MUTANT : élargir `peutAdmettre` aux projets PUBLICS ne
    // rougissait aucun test. Ceux qui existent suivent tous le scénario de
    // l'adoption — donc un projet PRIVÉ — et la moitié publique de la table
    // n'était vérifiée nulle part.
    //
    // La règle y est pourtant la même, et c'est contre-intuitif : sur un
    // projet public, n'importe qui peut DÉJÀ se joindre lui-même. Ce
    // qu'« admettre » ajoute, c'est inscrire QUELQU'UN D'AUTRE — un acte qui
    // engage un tiers, et que le propriétaire seul doit pouvoir faire. Sans
    // cela, la liste des membres d'un projet ouvert devient un mur où chacun
    // écrit le nom de son voisin.
    for (const projet of [publique, privee]) {
      it(`sur un projet ${projet.visibility}, seuls le propriétaire et l’administrateur admettent`, () => {
        expect(peutAdmettre(projet, qui('proprio'))).toBe(true);
        expect(peutAdmettre(projet, admin())).toBe(true);
        expect(peutAdmettre(projet, qui('un-inconnu'))).toBe(false);
        // « Déjà membre » n'entre même pas dans la signature, et c'est le
        // fond de la règle : un invité n'invite pas à son tour, sinon
        // « privé » ne veut plus rien dire au bout de trois personnes.
        expect(peutAdmettre(projet, qui('un-membre'))).toBe(false);
      });
    }

    it('un projet ORPHELIN ne s’admet pas — il s’adopte d’abord', () => {
      const orphelin = { visibility: 'private' as const, ownerId: null };
      expect(peutAdmettre(orphelin, qui('quelquun'))).toBe(false);
      expect(peutAdmettre(orphelin, admin())).toBe(true);
    });
  });

  it('UN LECTEUR SANS IDENTIFIANT N’EST PROPRIÉTAIRE DE RIEN', () => {
    // `lecteurDe` (server.ts) rend `userId: ''` pour une requête NON
    // authentifiée — c'est son `?? ''`. La garde de `estProprietaire` ne
    // regardait que `ownerId !== null` : un projet dont le propriétaire serait
    // la chaîne vide aurait donc appartenu à tout visiteur anonyme, alors même
    // que le commentaire du module annonçait le contraire.
    //
    // Aucune route n'écrit aujourd'hui un `ownerId` vide — les deux voies par
    // compte imposent l'identifiant du JWT, et le schéma de la voie « jeton de
    // ruche » refuse le champ. C'est donc de la défense en profondeur, pas un
    // trou ouvert : ce test fige la règle avant qu'une troisième voie
    // d'écriture ne la découvre à nos dépens.
    const vide = { visibility: 'private' as const, ownerId: '' };
    const anonyme = { userId: '', voitTout: false };
    expect(peutLireCode(vide, anonyme, false)).toBe(false);
    expect(peutVoirMembres(vide, anonyme, false)).toBe(false);
    expect(peutRejoindre(vide, anonyme, false)).toBe(false);
    expect(peutAdmettre(vide, anonyme)).toBe(false);
  });
});

describe('sur le vrai serveur', () => {
  let server: HiveServer;
  let dir: string;
  let base: string;
  let prive: string;
  let publicId: string;
  let jetonIntrus: string;
  const TOKEN = 'jeton-acces-projet-suffisamment-long';

  const inscrire = async (email: string): Promise<string> => {
    const res = await fetch(`${base}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: 'Intrus' }),
    });
    const corps = (await res.json()) as { token?: string };
    return corps.token ?? '';
  };

  beforeAll(async () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-acc-'));
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
    prive = server.store.createProject({
      name: 'Projet privé',
      visibility: 'private',
      ownerId: 'un-autre-compte',
    }).id;
    publicId = server.store.createProject({ name: 'Projet public', visibility: 'public' }).id;
    // LE PREMIER COMPTE D'UNE RUCHE EST ADMINISTRATEUR — c'est l'amorçage
    // voulu, et c'est un piège pour ce fichier : l'« intrus » d'origine était
    // administrateur sans que personne s'en aperçoive, et ne prouvait donc
    // rien du tout sur le contrôle d'accès. On en inscrit un premier, qui
    // occupe la place d'admin, et l'intrus n'est que le second.
    const premier = await inscrire('la-reine@exemple.test');
    expect(premier, "l'inscription doit rendre un jeton").not.toBe('');
    jetonIntrus = await inscrire('intrus@exemple.test');
    expect(jetonIntrus, "l'inscription doit rendre un jeton").not.toBe('');
    const moi = (await (
      await fetch(`${base}/api/auth/me`, { headers: { authorization: `Bearer ${jetonIntrus}` } })
    ).json()) as { role?: string };
    expect(moi.role, "l'intrus ne doit surtout pas être administrateur").not.toBe('admin');
  });

  afterAll(async () => {
    await server.stop();
    rmSync(dir, { recursive: true, force: true });
  });

  const joindre = (id: string) =>
    fetch(`${base}/api/projects/${id}/join`, {
      method: 'POST',
      headers: { authorization: `Bearer ${jetonIntrus}` },
    });
  const membres = (id: string) =>
    fetch(`${base}/api/projects/${id}/members`, {
      headers: { authorization: `Bearer ${jetonIntrus}` },
    });

  it('UN INCONNU NE S’AJOUTE PLUS À UN PROJET PRIVÉ', async () => {
    const res = await joindre(prive);
    expect(res.status).toBe(404);
    // …et il n'est pas devenu membre malgré tout.
    expect(server.store.listMembers(prive)).toHaveLength(0);
  });

  it('LE REFUS EST INDISTINGUABLE DE L’INEXISTENCE, À L’OCTET PRÈS', async () => {
    // C'est ce test-là qui ferme l'énumération. Sans lui, un « 403 » poli
    // suffirait à cartographier les projets de la ruche.
    const refuse = await joindre(prive);
    const inexistant = await joindre('projet-qui-nexiste-pas');
    expect(refuse.status).toBe(inexistant.status);
    expect(await refuse.text()).toBe(await inexistant.text());
  });

  it('la liste nominative des membres d’un projet privé est fermée', async () => {
    const refuse = await membres(prive);
    const inexistant = await membres('projet-qui-nexiste-pas');
    expect(refuse.status).toBe(404);
    expect(await refuse.text()).toBe(await inexistant.text());
  });

  it('un projet PUBLIC reste ouvert — la garde ne casse pas la ruche communautaire', async () => {
    const res = await joindre(publicId);
    expect(res.status).toBe(200);
    expect(server.store.estMembre(publicId, server.store.listMembers(publicId)[0]!.userId)).toBe(
      true,
    );
    expect((await membres(publicId)).status).toBe(200);
  });

  it('rejoindre deux fois reste sans effet, pas une erreur', async () => {
    expect((await joindre(publicId)).status).toBe(200);
    expect(server.store.listMembers(publicId)).toHaveLength(1);
  });
});
