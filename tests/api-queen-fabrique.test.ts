// @vitest-environment happy-dom
//
// LES HUIT PORTES QUE CE LOT OUVRE — clés de la Reine, motifs personnels,
// fabriques. Elles sont arrivées sans un seul banc, et le cliquet de couverture
// l'a dit : fonctions à 78,42 % sous un seuil de 78,8 %.
//
// ─── CE QUE CES BANCS JUGENT, ET CE QU'ILS NE JUGENT PAS ─────────────────────
//
// Ils ne jugent pas le serveur — d'autres fichiers s'en chargent. Ils jugent la
// FORME de l'appel, qui est tout ce que ces fonctions décident : le chemin, la
// méthode, le corps, l'en-tête de jeton. Trois choses s'y cachent qu'on ne voit
// qu'en les éprouvant :
//
//   1. `encodeURIComponent` sur CHAQUE segment variable. Un identifiant de
//      projet qui porte `/` ou `#` change sinon la route appelée — au mieux un
//      404, au pire une autre ressource.
//   2. Le SECRET de la clé Reine voyage dans le CORPS, jamais dans l'URL. Une
//      URL se journalise, se met en cache, part dans un `Referer` ; un corps de
//      POST, non. C'est la même règle que « aucun secret en argument de
//      commande », appliquée au transport.
//   3. Le jeton de la ruche est posé sur chaque appel — sans lui, tout répond
//      401 et l'écran reste muet sur la raison.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  appliquerMotifPerso,
  creerMotifPerso,
  fetchMotifsPerso,
  fetchQueenCles,
  jugerFabriqueChantier,
  ouvrirFabrique,
  poserQueenCle,
  poserStatutFabrique,
  saveToken,
} from '../dashboard/src/api';

/** Ce que le module a réellement demandé au réseau. */
interface Appel {
  url: string;
  methode: string;
  corps: string;
  entetes: Record<string, string>;
}

let appels: Appel[] = [];
let reponse: { ok: boolean; status: number; corps: unknown } = {
  ok: true,
  status: 200,
  corps: { ok: true },
};

beforeEach(() => {
  appels = [];
  reponse = { ok: true, status: 200, corps: { ok: true } };
  localStorage.clear();
  saveToken('jeton-de-banc');
  vi.stubGlobal('fetch', (url: string, init?: RequestInit) => {
    appels.push({
      url,
      methode: (init?.method ?? 'GET').toUpperCase(),
      corps: typeof init?.body === 'string' ? init.body : '',
      entetes: (init?.headers ?? {}) as Record<string, string>,
    });
    return Promise.resolve({
      ok: reponse.ok,
      status: reponse.status,
      json: () => Promise.resolve(reponse.corps),
    } as Response);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seul(): Appel {
  expect(appels, 'un seul appel réseau attendu').toHaveLength(1);
  return appels[0]!;
}

describe('les clés de la Reine', () => {
  it('la lecture est un GET sur la porte des clés', async () => {
    reponse.corps = { fournisseurs: [], presence: [] };
    await fetchQueenCles();
    expect(seul().url).toBe('/api/queen/cles');
    expect(seul().methode).toBe('GET');
  });

  it('le jeton de la ruche accompagne l’appel', async () => {
    reponse.corps = { fournisseurs: [], presence: [] };
    await fetchQueenCles();
    expect(seul().entetes['x-hive-token']).toBe('jeton-de-banc');
  });

  it('LE SECRET VOYAGE DANS LE CORPS, JAMAIS DANS L’URL', async () => {
    reponse.corps = { ok: true, envVar: 'SEEDANCE_API_KEY' };
    await poserQueenCle({ secret: 'sk-de-banc-jamais-reelle', envVar: 'SEEDANCE_API_KEY' });
    const a = seul();
    expect(a.methode).toBe('POST');
    // Une URL se journalise, se met en cache, part dans un `Referer`. Un corps
    // de POST, non. Si cette assertion tombe, c'est une fuite, pas un détail.
    expect(a.url).not.toContain('sk-de-banc');
    expect(a.url).toBe('/api/queen/cles');
    expect(JSON.parse(a.corps)).toMatchObject({
      secret: 'sk-de-banc-jamais-reelle',
      envVar: 'SEEDANCE_API_KEY',
    });
  });
});

describe('les motifs personnels', () => {
  it('l’identifiant de projet est ENCODÉ dans le chemin', async () => {
    reponse.corps = { motifs: [] };
    await fetchMotifsPerso('projet/étrange#1');
    expect(seul().url).toBe('/api/projects/projet%2F%C3%A9trange%231/motifs/perso');
  });

  it('créer un motif est un POST qui porte libellé et étapes', async () => {
    reponse.corps = { ok: true, id: 'm1', libelle: 'Rituel', etapes: ['a'] };
    await creerMotifPerso('p1', { libelle: 'Rituel', etapes: ['a', 'b'] });
    const a = seul();
    expect(a.url).toBe('/api/projects/p1/motifs/perso');
    expect(a.methode).toBe('POST');
    expect(JSON.parse(a.corps)).toEqual({ libelle: 'Rituel', etapes: ['a', 'b'] });
  });

  it('appliquer encode LES DEUX segments — projet et motif', async () => {
    reponse.corps = { ok: true, motifId: 'm/1', taskIds: [], titres: [] };
    await appliquerMotifPerso('p/1', 'm/1');
    const a = seul();
    expect(a.url).toBe('/api/projects/p%2F1/motifs/perso/m%2F1/appliquer');
    expect(a.methode).toBe('POST');
    expect(a.corps).toBe('{}');
  });
});

describe('les fabriques', () => {
  it('ouvrir une fabrique porte le genre et le libellé', async () => {
    reponse.corps = { ok: true, id: 'f1' };
    await ouvrirFabrique('p1', { genre: 'script_npm', libelle: 'Compiler' });
    const a = seul();
    expect(a.url).toBe('/api/projects/p1/fabriques');
    expect(a.methode).toBe('POST');
    expect(JSON.parse(a.corps)).toEqual({ genre: 'script_npm', libelle: 'Compiler' });
  });

  it('poser un statut encode le projet ET la fabrique', async () => {
    reponse.corps = { ok: true, statut: 'mergee' };
    await poserStatutFabrique('p/1', 'f#2', 'mergee');
    const a = seul();
    expect(a.url).toBe('/api/projects/p%2F1/fabriques/f%232/statut');
    expect(JSON.parse(a.corps)).toEqual({ statut: 'mergee' });
  });

  it('juger un chantier porte le nom du script', async () => {
    reponse.corps = { ok: true };
    await jugerFabriqueChantier('p1', 'build');
    const a = seul();
    expect(a.url).toBe('/api/projects/p1/fabriques/juger-chantier');
    expect(JSON.parse(a.corps)).toEqual({ nomScript: 'build' });
  });
});

describe('quand le serveur refuse', () => {
  it('un refus devient une ApiError qui PORTE le statut', async () => {
    reponse = { ok: false, status: 403, corps: { error: 'interdit' } };
    await expect(fetchQueenCles()).rejects.toBeInstanceOf(ApiError);
    reponse = { ok: false, status: 403, corps: { error: 'interdit' } };
    await fetchQueenCles().catch((e: unknown) => {
      expect((e as ApiError).status).toBe(403);
      expect((e as ApiError).message).toContain('interdit');
    });
  });

  it('un refus sur la pose de clé ne recrache jamais le secret dans le message', async () => {
    reponse = { ok: false, status: 400, corps: { error: 'clé invalide' } };
    await poserQueenCle({ secret: 'sk-de-banc-jamais-reelle', envVar: 'X_API_KEY' }).catch(
      (e: unknown) => {
        expect((e as ApiError).message).not.toContain('sk-de-banc');
      },
    );
  });
});
