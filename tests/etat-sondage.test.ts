// LA DÉGRADATION PROPRE DU TABLEAU DE BORD — une carte absente ne crie pas,
// mais une carte qui disparaît à tort ne dit rien non plus.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// Le même test revenait CINQ fois, dans deux vues, chacune avec son propre
// commentaire expliquant la même chose. Un balayage échantillonné de
// `dashboard/src/views` (base épinglée `f0fc005`) en a rendu trois nus d'un
// coup — ce n'est pas une coïncidence : une idée réécrite à chaque usage n'est
// éprouvée à aucun.
//
// Les deux mutants échouent dans le même sens : ils ENLÈVENT à l'humain une
// carte qu'il devrait voir, sans rien dire.

import { describe, expect, it } from 'vitest';
import { jamaisRienRecu } from '../dashboard/src/views/etat-sondage.js';

describe('jamaisRienRecu — masquer une route absente, jamais une route lente', () => {
  it('LE CAS QUI TRANCHE : le PREMIER CHARGEMENT ne masque rien', () => {
    // `error !== null` muté en `===` masque la carte quand il n'y a PAS
    // d'erreur — c'est-à-dire pendant le tout premier sondage, avant la
    // première réponse. La carte clignote, ou ne revient jamais si c'est lent.
    expect(jamaisRienRecu({ data: null, error: null }), 'on attend encore').toBe(false);
  });

  it('LE SECOND CAS QUI TRANCHE : une panne APRÈS des relevés ne masque rien', () => {
    // `&&` muté en `||` masque dès qu'une erreur survient, même après des
    // heures de relevés corrects. La panne passagère effacerait l'historique à
    // l'écran au lieu de le figer — or la vue sait annoter « relevé figé ».
    expect(jamaisRienRecu({ data: { valeur: 42 }, error: 'réseau coupé' })).toBe(false);
  });

  it('LE CAS QUI MASQUE : demandé, échoué, jamais rien reçu', () => {
    // Une ruche auto-hébergée d'avant cette route : la carte n'existe pas, et
    // c'est normal. Pas d'erreur criarde pour une fonctionnalité absente.
    expect(jamaisRienRecu({ data: null, error: 'HTTP 404' })).toBe(true);
  });

  it('des données sans erreur : la carte a toute sa place', () => {
    expect(jamaisRienRecu({ data: { valeur: 0 }, error: null })).toBe(false);
  });

  it('des DONNÉES VIDES ne sont pas une absence de données', () => {
    // `[]` et `{}` sont des relevés légitimes — la route a répondu. Seul `null`
    // veut dire « jamais rien reçu ».
    expect(jamaisRienRecu({ data: [], error: 'panne récente' })).toBe(false);
    expect(jamaisRienRecu({ data: {}, error: 'panne récente' })).toBe(false);
  });

  it('une erreur VIDE reste une erreur — c’est `null` qui dit « aucune »', () => {
    // Un message vide est un message : la route a bien échoué.
    expect(jamaisRienRecu({ data: null, error: '' })).toBe(true);
  });
});
