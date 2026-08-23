// LA BUTINEUSE — le seul chemin par lequel un octet d'Internet entre.
//
// ─── POURQUOI CE FICHIER PEUT ÉPROUVER DES GARDES DE SÉCURITÉ ────────────────
//
// `fetch` est INJECTÉ. Sans cette injection, aucune des gardes qui comptent ne
// serait éprouvable : on ne peut pas demander à un vrai serveur de mentir sur
// sa taille, de rediriger vers le service de métadonnées, ou de servir un
// fichier au condensat faux. Une garde de sécurité qu'aucun banc ne peut mettre
// en défaut est une garde dont personne ne sait si elle marche.
//
// Chaque cas ci-dessous vérifie DEUX choses : le refus est rendu, ET rien n'a
// été écrit. Un refus qui laisse un fichier derrière lui est un demi-refus —
// quelqu'un finira par trouver ce fichier et le croire bon.

import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { butiner } from '../src/orchestrator/butineuse.js';

const URL_OK =
  'https://codeload.github.com/anthropics/hive/tar.gz/0123456789abcdef0123456789abcdef01234567';

let quarantaine: string;

beforeEach(() => {
  quarantaine = mkdtempSync(path.join(os.tmpdir(), 'hive-butin-'));
});
afterEach(() => rmSync(quarantaine, { recursive: true, force: true }));

/** Ce que la quarantaine contient — la moitié « rien n'a été écrit ». */
function contenuQuarantaine(): string[] {
  try {
    return readdirSync(quarantaine);
  } catch {
    return [];
  }
}

function sha(octets: Uint8Array): string {
  return createHash('sha256').update(octets).digest('hex');
}

/** Une réponse simulée : un corps en flux, des en-têtes qu'on choisit. */
function reponse(
  corps: readonly Uint8Array[],
  init: { statut?: number; type?: string | null; taille?: string | null } = {},
): Response {
  const flux = new ReadableStream<Uint8Array>({
    start(c) {
      for (const m of corps) c.enqueue(m);
      c.close();
    },
  });
  const entetes = new Headers();
  if (init.type !== null) entetes.set('content-type', init.type ?? 'application/gzip');
  if (init.taille !== null && init.taille !== undefined) {
    entetes.set('content-length', init.taille);
  }
  return new Response(flux, { status: init.statut ?? 200, headers: entetes });
}

const PETIT = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);

describe('la butineuse rapporte — et seulement ce qui a passé les trois portes', () => {
  it('CHEMIN HEUREUX : le fichier est écrit, sous un nom que le serveur n’a pas choisi', async () => {
    const fetchSimule = vi.fn(async () => reponse([PETIT]));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok, r.ok === false ? r.detail : '').toBe(true);
    if (!r.ok) return;
    expect(r.octets).toBe(PETIT.byteLength);
    expect(r.condensat).toBe(sha(PETIT));
    // Le nom est dérivé de l'URL, pas du chemin distant : « hive » et
    // « tar.gz » ne doivent PAS s'y retrouver.
    expect(path.basename(r.chemin)).toMatch(/^butin-[0-9a-f]{32}\.bin$/);
    expect(path.basename(r.chemin)).not.toContain('hive');
    expect(contenuQuarantaine()).toHaveLength(1);
    expect(statSync(r.chemin).size).toBe(PETIT.byteLength);
  });

  it('UNE ADRESSE HORS LISTE BLANCHE : la requête n’est même PAS partie', async () => {
    // La moitié qui compte : refuser après avoir appelé le serveur aurait déjà
    // révélé à un hôte tiers qu'une ruche l'a visé.
    const fetchSimule = vi.fn(async () => reponse([PETIT]));
    const r = await butiner(
      { url: 'https://exemple.invalide/paquet.tgz', condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(false);
    expect(fetchSimule, 'la porte 1 doit trancher AVANT le réseau').not.toHaveBeenCalled();
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('SANS CONDENSAT ATTENDU : refus AVANT la requête', async () => {
    // Partir chercher un fichier qu'on ne saura pas reconnaître, c'est dépenser
    // du réseau pour un refus certain — et ouvrir la porte au « on verra bien ».
    const fetchSimule = vi.fn(async () => reponse([PETIT]));
    const r = await butiner(
      { url: URL_OK, condensat: undefined, quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('condensat_absent');
    expect(fetchSimule).not.toHaveBeenCalled();
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('LA REQUÊTE NE SUIT AUCUNE REDIRECTION, et ne porte aucun identifiant', async () => {
    // ─── CE QU'ON VÉRIFIE ICI EST L'APPEL LUI-MÊME ──────────────────────────
    //
    // `redirect: 'error'` est la garde qui tient toute la liste blanche : sans
    // elle, un hôte permis renvoie vers n'importe quoi. Et `credentials:
    // 'omit'` empêche qu'un butinage parte authentifié vers un tiers.
    // Le simulacre porte la SIGNATURE de `fetch`, sinon `mock.calls[0][1]` est
    // un tuple vide au typage : on ne pourrait pas relire l'`init`, donc pas
    // éprouver les trois réglages qui font toute la sûreté de cet appel.
    const fetchSimule = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
      reponse([PETIT]),
    );
    await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(fetchSimule).toHaveBeenCalledTimes(1);
    const init = fetchSimule.mock.calls[0]?.[1];
    expect(init?.redirect, 'une redirection doit être une PANNE, pas une étape').toBe('error');
    expect(init?.credentials).toBe('omit');
    expect(init?.referrerPolicy).toBe('no-referrer');
    expect(init?.signal, 'sans délai, un filet d’octets tient une ouvrière').toBeDefined();
  });

  it('UNE REDIRECTION REÇUE EST REFUSÉE SOUS SON PROPRE NOM', async () => {
    const fetchSimule = vi.fn(async () => reponse([], { statut: 302 }));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('redirection');
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('LE SERVEUR MENT SUR LA TAILLE : le compteur du flux le rattrape', async () => {
    // ─── LE BANC LE PLUS IMPORTANT DE CE FICHIER ────────────────────────────
    //
    // `Content-Length` est une DÉCLARATION. Ici le serveur annonce huit octets
    // — franchement sous le plafond, donc la porte 2 le laisse passer — puis en
    // sert quarante mégaoctets. Un plafond qui ne garde que l'annonce donnerait
    // l'impression que la question est traitée, et ne traiterait rien.
    //
    // C'est aussi le cas de la bombe de décompression : `fetch` décompresse
    // seul, donc ces octets sont ceux d'APRÈS gzip.
    const gros = Array.from({ length: 41 }, () => new Uint8Array(1024 * 1024));
    const fetchSimule = vi.fn(async () => reponse(gros, { taille: '8' }));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('trop_gros');
    expect(contenuQuarantaine(), 'rien n’a touché le disque').toHaveLength(0);
  });

  it('UNE ANNONCE FRANCHE AU-DESSUS DU PLAFOND : refusée sur l’ANNONCE, pas sur le flux', async () => {
    // ─── CE QUE CE BANC AFFIRME, ET LA SONDE QU'IL A FALLU JETER ────────────
    //
    // Première version : un drapeau posé dans `pull()` pour prouver que le
    // corps n'était pas lu. Elle a rougi — et c'est le BANC qui avait tort.
    // `pull` se déclenche dès la CONSTRUCTION du `ReadableStream` (file interne
    // sous le seuil), sans le moindre lecteur. La sonde mesurait la mécanique
    // du flux, pas la butineuse : elle ne pouvait pas distinguer les deux.
    //
    // Ce qui distingue vraiment, et qui est observable : le MOTIF. Le corps
    // servi passe largement sous le plafond, donc si la garde de l'annonce
    // sautait, la lecture réussirait et le résultat serait `ok`. Rendre
    // `annonce_trop_grosse` prouve que la décision a été prise sur l'en-tête.
    const fetchSimule = vi.fn(async () => reponse([PETIT], { taille: String(99 * 1024 * 1024) }));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('annonce_trop_grosse');
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('CONDENSAT FAUX : refus, et RIEN sur le disque', async () => {
    // ─── L'ORDRE DES GESTES ─────────────────────────────────────────────────
    //
    // L'écriture est le dernier geste, après la vérification. Écrire puis
    // effacer laisserait une fenêtre où un fichier non vérifié existe — et
    // un effacement qui échoue laisserait ce fichier pour de bon.
    const autre = new Uint8Array([9, 9, 9]);
    const fetchSimule = vi.fn(async () => reponse([autre]));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('condensat_faux');
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('UN TYPE HTML LÀ OÙ ON ATTEND UNE ARCHIVE : refus', async () => {
    const fetchSimule = vi.fn(async () => reponse([PETIT], { type: 'text/html' }));
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('type_refuse');
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('LE TRANSPORT QUI CASSE EST DIT, jamais avalé', async () => {
    const fetchSimule = vi.fn(async () => {
      throw new Error('socket coupé');
    });
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('transport_casse');
    expect(r.ok === false && r.detail).toContain('socket coupé');
  });

  it('CE QUI EST JETÉ SANS ÊTRE UNE ERREUR EST QUAND MÊME LISIBLE', async () => {
    // ─── LA MOITIÉ QUI TUE `instanceof Error` → `instanceof Object` ──────────
    //
    // JavaScript laisse jeter n'importe quoi. Un objet nu passe `instanceof
    // Object` sans avoir de `message` : le mutant écrirait « Le transport a
    // échoué : undefined » — un détail qui ne dit RIEN à qui enquête, dans le
    // seul message dont c'est le métier.
    //
    // Ce n'est pas théorique : une bibliothèque qui jette un littéral, un
    // rejet de promesse porté par un objet de réponse, une valeur venue d'un
    // simulacre — trois façons ordinaires d'arriver ici sans être une `Error`.
    const fetchSimule = vi.fn(async () => {
      throw { code: 'BIZARRE' };
    });
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('transport_casse');
    expect(
      r.ok === false && r.detail,
      'un objet nu se dit, il ne rend pas « undefined »',
    ).toContain('[object Object]');
    expect(r.ok === false && r.detail).not.toContain('undefined');
  });

  it('MÊME CHOSE PENDANT LA LECTURE DU CORPS', async () => {
    // Le second site du même ternaire. Le balayage les a rendus nus tous les
    // deux, et fermer l'un sans l'autre laisserait la moitié du chemin muette
    // — c'est justement pendant la lecture qu'un flux casse le plus souvent.
    const flux = new ReadableStream<Uint8Array>({
      pull() {
        throw { raison: 'flux coupé' };
      },
    });
    const fetchSimule = vi.fn(
      async () =>
        new Response(flux, { status: 200, headers: { 'content-type': 'application/gzip' } }),
    );
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('transport_casse');
    expect(r.ok === false && r.detail).toContain('Lecture interrompue');
    expect(r.ok === false && r.detail).not.toContain('undefined');
    expect(contenuQuarantaine()).toHaveLength(0);
  });

  it('LE DÉLAI DÉPASSÉ A SON PROPRE MOTIF', async () => {
    // Un `AbortError` confondu avec « transport cassé » ferait chercher une
    // panne réseau là où le serveur fait simplement traîner — deux enquêtes
    // différentes.
    const fetchSimule = vi.fn(async () => {
      const e = new Error('trop long');
      e.name = 'TimeoutError';
      throw e;
    });
    const r = await butiner(
      { url: URL_OK, condensat: sha(PETIT), quarantaine },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok === false && r.motif).toBe('delai_depasse');
  });

  it('UNE RÉFÉRENCE MOUVANTE EST REFUSÉE PAR LA PORTE 1', async () => {
    // `…/tar.gz/main` : la même adresse rendra autre chose demain. Le condensat
    // seul ne suffirait pas — il faudrait le changer à chaque publication.
    const fetchSimule = vi.fn(async () => reponse([PETIT]));
    const r = await butiner(
      {
        url: 'https://codeload.github.com/anthropics/hive/tar.gz/main',
        condensat: sha(PETIT),
        quarantaine,
      },
      { fetch: fetchSimule as unknown as typeof globalThis.fetch },
    );
    expect(r.ok).toBe(false);
    expect(fetchSimule).not.toHaveBeenCalled();
  });
});
