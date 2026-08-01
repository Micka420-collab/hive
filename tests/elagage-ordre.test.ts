// L'ÉLAGAGE DU CONSEIL, QUAND TROIS SESSIONS PARTAGENT LA MILLISECONDE.
//
// ─── LE ROUGE QUI A SURVÉCU À SA PROPRE CORRECTION ───────────────────────────
//
// `tests/conseil-runner.test.ts` vérifie déjà que `pruneConseils` « garde les
// plus récentes ». Il ouvre trois conseils d'affilée et lit l'horloge à chaque
// fois. Sous Linux et Windows, les trois `createdAt` diffèrent ; sous macOS, sur
// un runner rapide, LES TROIS SONT ÉGAUX — et la CI a rougi :
//
//     AssertionError: expected { …(11) } to be null
//     ❯ tests/conseil-runner.test.ts:322  expect(store.getSession(ids[0]!)).toBeNull()
//     createdAt: 1785410908238, closedAt: 1785410908238
//
// Le remède écrit alors — trier par `createdAt DESC, id DESC` — a RECOPIÉ LA
// FORME DU DÉPARTAGE SANS SA PROPRIÉTÉ. Dans `results` et `memories`, d'où il
// venait, `id` est un `INTEGER PRIMARY KEY AUTOINCREMENT` : croissant avec le
// temps. Dans `conseil_sessions`, c'est `conseil-<randomUUID>`. L'ordre est
// devenu TOTAL — plus rien d'indéfini — et toujours SANS AUCUN RAPPORT avec
// l'ancienneté. La borne jetait proprement n'importe laquelle.
//
// ─── POURQUOI CE FICHIER PLUTÔT QU'UN CORRECTIF SILENCIEUX ───────────────────
//
// Le test d'origine ne peut PAS attraper ça : il dépend d'une horloge, donc de
// la machine. Il rougissait une fois sur vingt, sur un seul des trois systèmes.
//
// Ici on FORCE la collision — même `createdAt`, et des identifiants dont l'ordre
// alphabétique CONTREDIT l'ordre d'insertion. Sur l'ancien code, la borne
// supprime la session la plus RÉCENTE ; ce fichier rougit à tous les coups, sur
// les trois systèmes, sans rien attendre de l'horloge.

import { beforeEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';

const MEME_INSTANT = 1_785_410_908_238;

/**
 * Trois identifiants dont l'ordre ALPHABÉTIQUE est l'inverse de l'ordre
 * d'insertion. C'est tout le piège : un tri qui s'appuie sur eux rend l'ordre
 * exactement à l'envers, et un `randomUUID` le fait au hasard une fois sur six.
 */
const PREMIERE = 'conseil-zzz-la-plus-ancienne';
const DEUXIEME = 'conseil-mmm';
const TROISIEME = 'conseil-aaa-la-plus-recente';

describe('la borne d’élagage du conseil départage sur l’ORDRE D’INSERTION', () => {
  let store: HiveStore;

  beforeEach(() => {
    store = new HiveStore(':memory:');
    for (const id of [PREMIERE, DEUXIEME, TROISIEME]) {
      store.creerSession({ id, question: 'q', projectId: 'p-1', version: 1, now: MEME_INSTANT });
      // Seules les sessions CLOSES sont élaguées : une session en cours laisserait
      // des tâches d'éclaireuses orphelines derrière elle.
      store.majSession(id, { etat: 'clos', closedAt: MEME_INSTANT });
    }
  });

  it('LES TROIS PARTAGENT BIEN LA MILLISECONDE — sinon ce fichier ne prouve rien', () => {
    // Sans cette vérification, une future retouche de `creerSession` qui
    // ajouterait un compteur ferait passer le test pour de mauvaises raisons.
    const vus = [PREMIERE, DEUXIEME, TROISIEME].map((id) => store.getSession(id)?.createdAt);
    expect(new Set(vus).size, 'la collision doit être réelle').toBe(1);
  });

  it('JETTE LA PLUS ANCIENNE, pas celle dont l’identifiant est le plus petit', () => {
    expect(store.pruneConseils(2)).toBe(1);
    expect(store.getSession(PREMIERE), 'la première insérée doit partir').toBeNull();
    expect(store.getSession(DEUXIEME)).not.toBeNull();
    expect(store.getSession(TROISIEME), 'la dernière insérée doit rester').not.toBeNull();
  });

  it('et jusqu’au bout : deux de trop partent dans le bon ordre', () => {
    expect(store.pruneConseils(1)).toBe(2);
    expect(store.getSession(PREMIERE)).toBeNull();
    expect(store.getSession(DEUXIEME)).toBeNull();
    expect(store.getSession(TROISIEME)).not.toBeNull();
  });

  it('L’HORODATAGE RESTE LE CRITÈRE PRINCIPAL, le départage ne fait que trancher', () => {
    // Le défaut symétrique : un départage qui gouverne au lieu de départager
    // trierait sur l'insertion et ignorerait une date explicite.
    const s = new HiveStore(':memory:');
    // Insérée EN PREMIER, mais datée du futur : elle doit survivre.
    s.creerSession({ id: 'c-recente', question: 'q', version: 1, now: MEME_INSTANT + 10_000 });
    s.creerSession({ id: 'c-vieille', question: 'q', version: 1, now: MEME_INSTANT });
    for (const id of ['c-recente', 'c-vieille']) s.majSession(id, { etat: 'clos' });

    expect(s.pruneConseils(1)).toBe(1);
    expect(s.getSession('c-vieille'), 'la plus vieille par la DATE').toBeNull();
    expect(s.getSession('c-recente')).not.toBeNull();
  });

  it('la liste rendue au tableau de bord est ELLE AUSSI d’ordre total', () => {
    // Trois lignes de même milliseconde dans un `ORDER BY createdAt DESC` nu :
    // SQLite est libre de les rendre dans n'importe quel ordre, et deux appels
    // successifs peuvent différer. Un journal qui se réordonne tout seul se lit
    // comme un bogue de la ruche.
    const a = store.listSessions().map((s) => s.id);
    const b = store.listSessions().map((s) => s.id);
    expect(a).toEqual(b);
    expect(a, 'la plus récemment insérée en tête').toEqual([TROISIEME, DEUXIEME, PREMIERE]);
  });
});
