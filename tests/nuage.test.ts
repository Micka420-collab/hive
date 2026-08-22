import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  cheminBaseLocataire,
  evenementDepuisStripe,
  jugerSlug,
} from '../src/orchestrator/nuage.js';

describe('locataires cloud — le slug n’est pas un chemin', () => {
  it('accepte un identifiant banal', () => {
    expect(jugerSlug('acme').ok).toBe(true);
    expect(jugerSlug('atelier-12').ok).toBe(true);
  });

  it('refuse ce qui ressemble à une évasion', () => {
    for (const s of [
      '',
      '../etc',
      'a/b',
      'a\\b',
      '-x',
      'x-',
      'x--y',
      'Acme',
      '1acme',
      'a'.repeat(40),
    ]) {
      expect(jugerSlug(s).ok, s).toBe(false);
    }
  });

  it('le chemin de base reste SOUS la racine', () => {
    const racine = path.resolve('/var/hive');
    expect(cheminBaseLocataire(racine, 'acme')).toBe(
      path.resolve(racine, 'tenants', 'acme', 'hive.db'),
    );
    expect(cheminBaseLocataire(racine, '../etc')).toBeNull();
  });
});

describe('Stripe → événements Hive', () => {
  const base = {
    created: 1_800_000_000,
    data: {
      object: {
        id: 'sub_1',
        current_period_end: 1_800_086_400,
        metadata: { projectId: 'p1', plan: 'queen' },
      },
    },
  };

  it('traduit un abonnement créé', () => {
    const e = evenementDepuisStripe({ ...base, type: 'customer.subscription.created' });
    expect(e?.type).toBe('abonnement.actif');
    expect(e?.plan).toBe('queen');
    expect(e?.ts).toBe(1_800_000_000_000);
    expect(e?.finPeriode).toBe(1_800_086_400_000);
  });

  it('refuse un type hors liste blanche', () => {
    expect(evenementDepuisStripe({ ...base, type: 'charge.succeeded' })).toBeNull();
  });

  it('refuse un plan inconnu plutôt que de l’inventer', () => {
    const brut = {
      ...base,
      type: 'invoice.paid',
      data: { object: { ...base.data.object, metadata: { projectId: 'p1', plan: 'illimite' } } },
    };
    expect(evenementDepuisStripe(brut)).toBeNull();
  });

  it('refuse une charge sans projet cible', () => {
    const brut = {
      ...base,
      type: 'invoice.paid',
      data: { object: { ...base.data.object, metadata: { plan: 'essaim' } } },
    };
    expect(evenementDepuisStripe(brut)).toBeNull();
  });
});

describe('isolement des bases', () => {
  let dir: string | null = null;
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
  });

  it('deux slugs ne partagent pas le même fichier', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-nuage-'));
    const a = cheminBaseLocataire(dir, 'alpha');
    const b = cheminBaseLocataire(dir, 'beta');
    expect(a).not.toBe(b);
    expect(a?.startsWith(path.resolve(dir))).toBe(true);
  });
});

// ─── UNE CHARGE STRIPE SANS `metadata` NE DOIT PAS FAIRE LEVER ───────────────
//
// Sonde ciblée du motif `typeof x === 'object' && x !== null` (§ 9
// octosexagicenties) : dix occurrences restantes, CINQ nues. Celle-ci est la
// seule des cinq qui ne soit pas rattrapée par un `catch` englobant —
// `nuage.ts` n'en a aucun.
//
//     function meta(obj) {
//       const m = obj.metadata;
//       return typeof m === 'object' && m !== null ? m : {};
//     }
//
// `typeof null === 'object'` rend VRAI : c'est donc le `&&` qui écarte
// `null`, et lui seul. Mué en `||` :
//
//   · `metadata: null`   → `true || false`  → rend `null`
//   · pas de `metadata`  → `false || true`  → rend `undefined`
//
// Dans les deux cas la ligne suivante (`m.projectId`) LÈVE un TypeError. Le
// traducteur d'événements Stripe meurt au lieu de refuser proprement une
// charge qu'il ne sait pas lire — et il est appelé sur un webhook, donc sur
// une entrée que la ruche ne choisit pas.
describe('le traducteur Stripe survit à une charge sans metadata', () => {
  const socle = {
    type: 'customer.subscription.created',
    created: 1_700_000_000,
    data: { object: { id: 'sub_1', current_period_end: 1_800_000_000 } },
  };

  it('REFUSE proprement quand `metadata` est absent', () => {
    expect(evenementDepuisStripe(socle)).toBeNull();
  });

  it('REFUSE proprement quand `metadata` vaut null', () => {
    expect(
      evenementDepuisStripe({
        ...socle,
        data: { object: { ...socle.data.object, metadata: null } },
      }),
    ).toBeNull();
  });

  // Le bord positif : sans lui, un `meta()` qui rendrait TOUJOURS `{}`
  // passerait les deux cas ci-dessus sans rien mesurer.
  it('LIT l’événement quand `metadata` porte projet et plan', () => {
    const e = evenementDepuisStripe({
      ...socle,
      data: {
        object: { ...socle.data.object, metadata: { projectId: 'p-1', plan: 'essaim' } },
      },
    });
    expect(e, 'une charge complète devrait être lue').not.toBeNull();
    expect(e?.projectId).toBe('p-1');
  });
});
