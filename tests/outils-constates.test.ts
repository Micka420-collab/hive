// Ce qu'un nœud a le droit de dire de sa machine — et ce que le hub en fait.
//
// ─── LE PARTAGE, QUI EST UNE DÉCISION DE SÉCURITÉ ────────────────────────────
//
// Le nœud n'envoie que des CONSTATS : le binaire est-il là, la clé est-elle
// lisible. Pas de verdict. Le hub tire la conclusion avec son catalogue.
//
// Si le nœud envoyait « prêt », un nœud menteur ou simplement bogué imposerait
// sa conclusion à la Reine. En n'envoyant que des faits, il ne peut au pire que
// se tromper sur ce qu'il voit — et la règle qui décide reste la même pour tout
// le monde, du côté du hub.

import { describe, expect, it } from 'vitest';
import { estOutilsConstates, parseClientMessage } from '../src/shared/protocol.js';

const REGISTER = {
  type: 'register',
  token: 'un-jeton-de-banc',
  name: 'poste-a-micka',
  ownerName: 'micka',
  agentType: 'claude-code',
  maxConcurrency: 2,
};

const brut = (outils: unknown): string => JSON.stringify({ ...REGISTER, outils });

describe('estOutilsConstates — la forme acceptée', () => {
  it('une liste vide est valide — « j’ai regardé, il n’y a rien »', () => {
    expect(estOutilsConstates([])).toBe(true);
  });

  it('un constat complet passe', () => {
    expect(estOutilsConstates([{ agent: 'cline', binaire: true, cle: 'inconnue' }])).toBe(true);
  });

  it('les trois états de clé sont acceptés, et eux seuls', () => {
    for (const cle of ['presente', 'absente', 'inconnue']) {
      expect(estOutilsConstates([{ agent: 'x', binaire: false, cle }]), cle).toBe(true);
    }
    for (const cle of ['peut-etre', '', 'PRESENTE', true, null, 1]) {
      expect(estOutilsConstates([{ agent: 'x', binaire: false, cle }]), String(cle)).toBe(false);
    }
  });

  it('un champ manquant ou mal typé fait refuser TOUTE la liste', () => {
    const mauvais: unknown[] = [
      [{ binaire: true, cle: 'presente' }], // pas d'agent
      [{ agent: 'x', cle: 'presente' }], // pas de binaire
      [{ agent: 'x', binaire: true }], // pas de clé
      [{ agent: '', binaire: true, cle: 'presente' }], // agent vide
      [{ agent: 42, binaire: true, cle: 'presente' }],
      [{ agent: 'x', binaire: 'oui', cle: 'presente' }],
      [null],
      ['claude-code'],
      'claude-code',
      { agent: 'x', binaire: true, cle: 'presente' }, // pas un tableau
    ];
    for (const v of mauvais) expect(estOutilsConstates(v), JSON.stringify(v)).toBe(false);
  });

  it('un nom d’agent démesuré est refusé', () => {
    expect(estOutilsConstates([{ agent: 'a'.repeat(65), binaire: true, cle: 'presente' }])).toBe(
      false,
    );
  });

  it('une liste démesurée est refusée — la mémoire du hub n’est pas illimitée', () => {
    const trop = Array.from({ length: 33 }, (_, i) => ({
      agent: `a${i}`,
      binaire: false,
      cle: 'absente' as const,
    }));
    expect(estOutilsConstates(trop)).toBe(false);
    expect(estOutilsConstates(trop.slice(0, 32))).toBe(true);
  });
});

describe('à l’arrivée sur le hub', () => {
  it('une inscription SANS constats reste valide — le champ est facultatif', () => {
    const m = parseClientMessage(JSON.stringify(REGISTER));
    expect(m?.type).toBe('register');
    expect((m as { outils?: unknown }).outils).toBeUndefined();
  });

  it('des constats bien formés arrivent intacts', () => {
    const m = parseClientMessage(brut([{ agent: 'cline', binaire: true, cle: 'inconnue' }]));
    expect(m?.type).toBe('register');
    expect((m as { outils?: unknown[] }).outils).toEqual([
      { agent: 'cline', binaire: true, cle: 'inconnue' },
    ]);
  });

  it('LE MESSAGE ENTIER EST REFUSÉ si les constats sont mal formés', () => {
    // Pas rafistolé, pas ignoré : refusé. Un champ optionnel mal formé est un
    // client qui ment ou qui bogue, et les deux se disent. C'est la règle déjà
    // posée pour `plateforme` et `modeles` — la suivre ici évite qu'un jour
    // trois champs voisins aient trois politiques différentes.
    expect(parseClientMessage(brut([{ agent: 'x', binaire: 'oui', cle: 'presente' }]))).toBeNull();
    expect(parseClientMessage(brut('pas-une-liste'))).toBeNull();
  });

  it('un nœud ne peut pas envoyer de VERDICT — le champ n’existe pas', () => {
    // La décision de sécurité, éprouvée : même en glissant un `verdict` dans le
    // constat, il ne franchit pas la frontière. Le hub le calcule lui-même.
    const m = parseClientMessage(
      brut([{ agent: 'cline', binaire: true, cle: 'inconnue', verdict: 'pret' }]),
    );
    const outils = (m as { outils?: Record<string, unknown>[] }).outils!;
    expect(outils[0]).toEqual({ agent: 'cline', binaire: true, cle: 'inconnue' });
    expect(outils[0]!.verdict).toBeUndefined();
  });
});
