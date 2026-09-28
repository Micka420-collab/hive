// Le webhook générique — le corps signé qu'un récepteur peut vérifier, et un
// envoi qui journalise l'échec plutôt que de le taire.

import { describe, expect, it } from 'vitest';
import { verifierSignature } from '../src/orchestrator/abonnement.js';
import {
  ENTETE_SIGNATURE,
  chargeDepuisEvenement,
  construireRequeteWebhook,
} from '../src/connectors/webhook/charge.js';
import { envoyerWebhook, type FetchLike } from '../src/connectors/webhook/envoi.js';
import type { EvenementConnecteur } from '../src/connectors/contrat.js';

const EV: EvenementConnecteur = {
  kind: 'decision',
  projectId: 'projet-1',
  titre: 'Production approuvée',
  taskId: 'tache-1',
  etat: 'approved',
};

describe('la charge webhook', () => {
  it('sérialise les champs présents et l’horodatage', () => {
    const charge = chargeDepuisEvenement(EV, 1_000);
    expect(charge).toEqual({
      kind: 'decision',
      projectId: 'projet-1',
      titre: 'Production approuvée',
      taskId: 'tache-1',
      etat: 'approved',
      emisA: 1_000,
    });
  });

  it('signe les octets EXACTS du corps — le récepteur les vérifie', () => {
    const now = 2_000_000;
    const secret = 'secret-hmac-de-test-suffisant';
    const req = construireRequeteWebhook({
      url: 'https://exemple.test/hook',
      secret,
      evenement: EV,
      now,
    });
    // La signature vérifiable par verifierSignature d'abonnement.ts, sur le
    // corps reçu tel quel (aucune re-sérialisation).
    const verdict = verifierSignature({
      charge: req.corps,
      entete: req.entetes[ENTETE_SIGNATURE]!,
      secret,
      now,
    });
    expect(verdict.valide).toBe(true);
  });

  it('un mauvais secret invalide la signature', () => {
    const now = 2_000_000;
    const req = construireRequeteWebhook({
      url: 'https://exemple.test/hook',
      secret: 'le-bon-secret-de-test',
      evenement: EV,
      now,
    });
    const verdict = verifierSignature({
      charge: req.corps,
      entete: req.entetes[ENTETE_SIGNATURE]!,
      secret: 'un-autre-secret-different',
      now,
    });
    expect(verdict.valide).toBe(false);
  });
});

describe('envoyerWebhook', () => {
  it('poste le corps et les en-têtes attendus, et rend le statut', async () => {
    let vus: { url: string; body: string; sig: string | undefined } | null = null;
    const faux: FetchLike = async (url, init) => {
      vus = { url, body: init.body, sig: init.headers[ENTETE_SIGNATURE] };
      return { ok: true, status: 200 };
    };
    const req = construireRequeteWebhook({
      url: 'https://exemple.test/hook',
      secret: 's'.repeat(20),
      evenement: EV,
      now: 5,
    });
    const res = await envoyerWebhook(req, faux);
    expect(res.ok).toBe(true);
    expect(vus).not.toBeNull();
    expect(vus!.url).toBe('https://exemple.test/hook');
    expect(JSON.parse(vus!.body).taskId).toBe('tache-1');
    expect(vus!.sig).toMatch(/^t=\d+,v1=[0-9a-f]+$/);
  });

  it('un statut non-2xx est un échec NOMMÉ', async () => {
    const faux: FetchLike = async () => ({ ok: false, status: 500 });
    const req = construireRequeteWebhook({
      url: 'x',
      secret: 's'.repeat(20),
      evenement: EV,
      now: 1,
    });
    const res = await envoyerWebhook(req, faux);
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.motif).toContain('500');
  });

  it('une exception réseau est un échec de statut 0', async () => {
    const faux: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const req = construireRequeteWebhook({
      url: 'x',
      secret: 's'.repeat(20),
      evenement: EV,
      now: 1,
    });
    const res = await envoyerWebhook(req, faux);
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.status).toBe(0);
      expect(res.motif).toContain('ECONNREFUSED');
    }
  });
});
