// Les abonnements.
//
// Le test qui compte : on ne s'offre PAS un abonnement en postant sur le
// webhook. C'est la vulnérabilité la plus banale de toute intégration de
// paiement, et elle est totale — pas d'escalade nécessaire, un POST bien formé
// suffit. Les tests de signature couvrent donc le contournement par secret
// absent, par rejeu, par signature tronquée et par en-tête bricolé.
//
// Le reste vérifie qu'aucun état ne donne de droits qu'il ne devrait pas, et
// que les webhooks arrivant DANS LE DÉSORDRE ne défont pas l'état courant.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  ETATS,
  EVENEMENTS,
  GRACE_JOURS,
  HEURE_MS,
  PLANS,
  TOLERANCE_MS,
  appliquerEvenement,
  aucunAbonnement,
  droits,
  lireCharge,
  planParCle,
  signer,
  verifierSignature,
} from '../src/orchestrator/abonnement.js';
import type { Abonnement, EvenementAbonnement } from '../src/orchestrator/abonnement.js';

const NOW = 1_800_000_000_000;
const JOUR = 86_400_000;
const SECRET = 'secret-de-webhook-bien-long-et-aleatoire';

function abo(p: Partial<Abonnement> = {}): Abonnement {
  return { ...aucunAbonnement('p1'), ...p };
}

describe('abonnements — les plans', () => {
  it('correspondent au document du modèle économique', () => {
    // Une grille tarifaire qui diverge de ce que la page publique annonce est
    // une promesse rompue, et elle se découvre au paiement.
    const doc = readFileSync(new URL('../docs/MODELE-ECONOMIQUE.md', import.meta.url), 'utf8');
    for (const p of PLANS) {
      if (p.prixCentimes === 0) continue;
      const euros = p.prixCentimes / 100;
      expect(doc, `${p.nom} à ${euros} € absent du document`).toContain(String(euros));
    }
  });

  it('les heures annoncées sont celles de la page de vente', () => {
    expect(planParCle('eclaireuse')?.heures).toBe(10);
    expect(planParCle('essaim')?.heures).toBe(50);
    expect(planParCle('colonie')?.heures).toBe(200);
  });

  it('un plan inconnu n’existe pas', () => {
    expect(planParCle('gratuit-pour-toujours')).toBeNull();
    expect(planParCle('')).toBeNull();
  });
});

describe('abonnements — les droits, fermés par défaut', () => {
  it('aucun abonnement ne donne rien', () => {
    const d = droits(abo(), NOW);
    expect(d.actif).toBe(false);
    expect(d.plafondMs).toBeNull();
  });

  it('un abonnement actif donne son plafond en millisecondes', () => {
    const d = droits(abo({ plan: 'essaim', etat: 'actif' }), NOW);
    expect(d.actif).toBe(true);
    expect(d.heures).toBe(50);
    expect(d.plafondMs).toBe(50 * HEURE_MS);
  });

  it('AUCUN état hors « actif » et « impayé en grâce » ne donne de droits', () => {
    // Balayage exhaustif : la garantie ne doit pas dépendre d'un état oublié.
    for (const etat of ETATS) {
      const attendu = etat === 'actif';
      const d = droits(abo({ plan: 'essaim', etat, impayeDepuis: null }), NOW);
      expect(d.actif, `état ${etat}`).toBe(attendu);
    }
  });

  it('une période échue coupe, même si l’état dit « actif »', () => {
    // Un webhook de renouvellement peut se perdre ; l'horloge ne ment pas.
    const a = abo({ plan: 'colonie', etat: 'actif', finPeriode: NOW - 1 });
    expect(droits(a, NOW).actif).toBe(false);
    expect(droits(a, NOW).motif).toMatch(/période échue/);
  });

  it('un impayé garde ses droits pendant le délai de grâce', () => {
    // Couper net un client dont la carte a expiré est un mauvais produit et un
    // mauvais geste.
    const a = abo({ plan: 'essaim', etat: 'impaye', impayeDepuis: NOW - 3 * JOUR });
    const d = droits(a, NOW);
    expect(d.actif).toBe(true);
    expect(d.motif).toMatch(/délai de grâce/);
  });

  it('…mais pas au-delà', () => {
    const a = abo({ plan: 'essaim', etat: 'impaye', impayeDepuis: NOW - (GRACE_JOURS + 1) * JOUR });
    expect(droits(a, NOW).actif).toBe(false);
  });

  it('un impayé sans date est refusé plutôt que deviné', () => {
    const a = abo({ plan: 'essaim', etat: 'impaye', impayeDepuis: null });
    expect(droits(a, NOW).actif).toBe(false);
    expect(droits(a, NOW).motif).toMatch(/incohérent/);
  });

  it('un plan sans heures ne donne pas d’heures', () => {
    // « Queen hébergée » est un service, pas du temps-ouvrière.
    expect(droits(abo({ plan: 'queen', etat: 'actif' }), NOW).actif).toBe(false);
  });

  it('un plan devenu inconnu ne donne rien', () => {
    expect(droits(abo({ plan: 'plan-supprime', etat: 'actif' }), NOW).actif).toBe(false);
  });
});

describe('abonnements — les transitions', () => {
  const ev = (p: Partial<EvenementAbonnement> = {}): EvenementAbonnement => ({
    type: 'abonnement.actif',
    projectId: 'p1',
    plan: 'essaim',
    refExterne: 'sub_123',
    finPeriode: NOW + 30 * JOUR,
    ts: NOW,
    ...p,
  });

  it('active un abonnement', () => {
    const a = appliquerEvenement(abo(), ev());
    expect(a?.etat).toBe('actif');
    expect(a?.plan).toBe('essaim');
    expect(a?.refExterne).toBe('sub_123');
  });

  it('un échec de paiement n’annule pas : il ouvre le délai de grâce', () => {
    const actif = abo({ plan: 'essaim', etat: 'actif', majA: NOW - JOUR });
    const a = appliquerEvenement(actif, ev({ type: 'abonnement.paiement_echoue' }));
    expect(a?.etat).toBe('impaye');
    expect(a?.impayeDepuis).toBe(NOW);
    expect(droits(a as Abonnement, NOW).actif, 'les droits sont maintenus').toBe(true);
  });

  it('un second échec ne redémarre pas le délai de grâce', () => {
    // Sinon un processeur qui retente tous les jours offrirait un sursis infini.
    const impaye = abo({ etat: 'impaye', impayeDepuis: NOW - 5 * JOUR, majA: NOW - 5 * JOUR });
    const a = appliquerEvenement(impaye, ev({ type: 'abonnement.paiement_echoue', ts: NOW }));
    expect(a?.impayeDepuis).toBe(NOW - 5 * JOUR);
  });

  it('un paiement réussi efface l’impayé', () => {
    const impaye = abo({ etat: 'impaye', impayeDepuis: NOW - JOUR, majA: NOW - JOUR });
    const a = appliquerEvenement(impaye, ev({ type: 'abonnement.paiement_reussi' }));
    expect(a?.etat).toBe('actif');
    expect(a?.impayeDepuis).toBeNull();
  });

  it('IGNORE un événement arrivé dans le désordre', () => {
    // Les webhooks n'arrivent pas dans l'ordre. Un « paiement_echoue »
    // retardataire ne doit pas défaire un « actif » plus récent.
    const actif = abo({ plan: 'essaim', etat: 'actif', majA: NOW });
    const vieux = appliquerEvenement(
      actif,
      ev({ type: 'abonnement.paiement_echoue', ts: NOW - 1 }),
    );
    expect(vieux).toBeNull();
  });

  it('refuse un plan inconnu plutôt que de l’inventer', () => {
    expect(appliquerEvenement(abo(), ev({ plan: 'illimite-gratuit' }))).toBeNull();
  });

  it('une annulation retire les droits', () => {
    const actif = abo({ plan: 'essaim', etat: 'actif', majA: NOW - JOUR });
    const a = appliquerEvenement(actif, ev({ type: 'abonnement.annule' }));
    expect(a?.etat).toBe('annule');
    expect(droits(a as Abonnement, NOW).actif).toBe(false);
  });
});

describe('abonnements — LA garde : on ne s’offre pas un abonnement', () => {
  const charge = JSON.stringify({ type: 'abonnement.actif', projectId: 'p1', plan: 'colonie' });

  it('accepte une signature authentique', () => {
    const entete = signer(charge, SECRET, NOW);
    expect(verifierSignature({ charge, entete, secret: SECRET, now: NOW }).valide).toBe(true);
  });

  it('refuse TOUT quand aucun secret n’est configuré', () => {
    // « Pas de secret donc on laisse passer » est la porte dérobée la plus
    // fréquente de toutes.
    const entete = signer(charge, SECRET, NOW);
    const v = verifierSignature({ charge, entete, secret: '', now: NOW });
    expect(v.valide).toBe(false);
    expect(v.motif).toMatch(/aucun secret/);
  });

  it('refuse une signature calculée avec un autre secret', () => {
    const entete = signer(charge, 'le-mauvais-secret', NOW);
    expect(verifierSignature({ charge, entete, secret: SECRET, now: NOW }).valide).toBe(false);
  });

  it('refuse une charge modifiée après signature', () => {
    // Le cœur du sujet : signer « eclaireuse » et livrer « colonie ».
    const entete = signer(charge, SECRET, NOW);
    const trafiquee = charge.replace('colonie', 'illimite');
    expect(verifierSignature({ charge: trafiquee, entete, secret: SECRET, now: NOW }).valide).toBe(
      false,
    );
  });

  it('refuse un REJEU au-delà de la fenêtre', () => {
    // Sans fenêtre, un appel capté une fois serait rejouable indéfiniment — et
    // rejouer « abonnement.actif » est exactement l'attaque visée.
    const entete = signer(charge, SECRET, NOW);
    const plusTard = NOW + TOLERANCE_MS + 1_000;
    const v = verifierSignature({ charge, entete, secret: SECRET, now: plusTard });
    expect(v.valide).toBe(false);
    expect(v.motif).toMatch(/hors fenêtre/);
  });

  it('refuse un horodatage dans le FUTUR au-delà de la fenêtre', () => {
    // La fenêtre est symétrique : une horloge trafiquée en avant ne doit pas
    // acheter du temps de rejeu.
    const entete = signer(charge, SECRET, NOW + TOLERANCE_MS + 1_000);
    expect(verifierSignature({ charge, entete, secret: SECRET, now: NOW }).valide).toBe(false);
  });

  it('accepte à la limite exacte de la fenêtre', () => {
    const entete = signer(charge, SECRET, NOW);
    expect(
      verifierSignature({ charge, entete, secret: SECRET, now: NOW + TOLERANCE_MS }).valide,
    ).toBe(true);
  });

  it('refuse un en-tête bricolé sous toutes ses formes', () => {
    for (const entete of [
      '',
      'v1=deadbeef',
      't=abc,v1=deadbeef',
      `t=${Math.floor(NOW / 1000)}`,
      `t=${Math.floor(NOW / 1000)},v1=`,
      'nimporte quoi',
    ]) {
      expect(
        verifierSignature({ charge, entete, secret: SECRET, now: NOW }).valide,
        JSON.stringify(entete),
      ).toBe(false);
    }
  });

  it('refuse une signature tronquée sans planter', () => {
    // `timingSafeEqual` lève sur des longueurs différentes : la comparaison de
    // longueur DOIT venir avant, et ne fuit rien (celle d'un HMAC est publique).
    const entete = signer(charge, SECRET, NOW);
    const tronquee = entete.slice(0, entete.length - 10);
    expect(() =>
      verifierSignature({ charge, entete: tronquee, secret: SECRET, now: NOW }),
    ).not.toThrow();
    expect(verifierSignature({ charge, entete: tronquee, secret: SECRET, now: NOW }).valide).toBe(
      false,
    );
  });

  it('ne révèle jamais la signature attendue dans le motif', () => {
    // Un message d'erreur bavard offrirait ce que la comparaison en temps
    // constant protège.
    const attendue = signer(charge, SECRET, NOW).split('v1=')[1] ?? '';
    const v = verifierSignature({ charge, entete: 't=1,v1=faux', secret: SECRET, now: 1_000 });
    expect(v.motif).not.toContain(attendue);
  });
});

describe('abonnements — lire une charge vérifiée', () => {
  // La signature dit que l'expéditeur détient le secret ; elle ne dit RIEN de
  // la forme de ce qu'il envoie. Les deux contrôles sont distincts.
  const bonne = {
    type: 'abonnement.actif',
    projectId: 'p1',
    plan: 'essaim',
    refExterne: 'sub_1',
    finPeriode: NOW,
    ts: NOW,
  };

  it('lit une charge bien formée', () => {
    expect(lireCharge(bonne)?.plan).toBe('essaim');
  });

  it('refuse un type hors de la liste blanche', () => {
    // Un processeur émet des dizaines de types ; en accepter un qu'on n'a pas
    // lu, c'est laisser un inconnu décider d'un état.
    expect(lireCharge({ ...bonne, type: 'abonnement.tout_gratuit' })).toBeNull();
    expect(lireCharge({ ...bonne, type: 'customer.subscription.deleted' })).toBeNull();
  });

  it('n’accepte que les types déclarés', () => {
    for (const type of EVENEMENTS) expect(lireCharge({ ...bonne, type })).not.toBeNull();
  });

  it('refuse ce qui manque', () => {
    expect(lireCharge({ ...bonne, projectId: '' })).toBeNull();
    expect(lireCharge({ ...bonne, plan: '' })).toBeNull();
    expect(lireCharge({ ...bonne, ts: 0 })).toBeNull();
    expect(lireCharge(null)).toBeNull();
    expect(lireCharge('une chaîne')).toBeNull();
  });

  it('borne ce qui sera rangé', () => {
    const c = lireCharge({ ...bonne, projectId: 'x'.repeat(9_000), refExterne: 'y'.repeat(9_000) });
    expect(c?.projectId.length).toBeLessThanOrEqual(200);
    expect(c?.refExterne.length).toBeLessThanOrEqual(200);
  });

  it('refuse une fin de période absurde plutôt que de la ranger', () => {
    expect(lireCharge({ ...bonne, finPeriode: -1 })?.finPeriode).toBeNull();
    expect(lireCharge({ ...bonne, finPeriode: 'demain' })?.finPeriode).toBeNull();
  });
});

describe('abonnements — ce qui ne doit jamais entrer', () => {
  it('aucun champ du modèle ne porte de donnée de paiement', () => {
    // Détenir une donnée de carte, c'est entrer dans le périmètre PCI-DSS —
    // qu'aucune ruche auto-hébergée par un particulier ne peut tenir.
    const source = readFileSync(
      new URL('../src/orchestrator/abonnement.ts', import.meta.url),
      'utf8',
    );
    // On scanne les NOMS de champs, pas la prose du commentaire d'en-tête.
    const champs = [...source.matchAll(/^\s{2}(\w+)\??:/gm)].map((m) => m[1]?.toLowerCase() ?? '');
    for (const interdit of ['card', 'carte', 'pan', 'cvv', 'cvc', 'iban', 'bic', 'ccnumber']) {
      expect(champs, `champ « ${interdit} » interdit`).not.toContain(interdit);
    }
  });

  it('la limite sur durationMs est écrite noir sur blanc', () => {
    // Le plafond est consommé par une donnée d'AGENT. Tant que les nœuds sont
    // ceux du client, il ne se vole que lui-même — mais cela DOIT être dit.
    const source = readFileSync(
      new URL('../src/orchestrator/abonnement.ts', import.meta.url),
      'utf8',
    );
    expect(source).toMatch(/durationMs/);
    expect(source).toMatch(/horloge de l’hébergeur|horloge de l'hébergeur/);
  });
});

describe('abonnements — l’amorçage', () => {
  it('un projet neuf accepte son PREMIER webhook', () => {
    // Trouvé par le test de bout en bout : un « aucun abonnement » daté à
    // « maintenant » paraissait plus récent que l'événement, qui était alors
    // écarté comme arrivé dans le désordre. Un projet neuf n'aurait JAMAIS pu
    // être activé — et le webhook aurait répondu 200 sans rien faire, donc
    // sans que personne s'en aperçoive.
    const vierge = aucunAbonnement('p1');
    expect(vierge.majA).toBe(0);
    const a = appliquerEvenement(vierge, {
      type: 'abonnement.actif',
      projectId: 'p1',
      plan: 'essaim',
      refExterne: 'sub_1',
      finPeriode: NOW + 30 * JOUR,
      // Un horodatage même très ancien doit passer sur un abonnement absent.
      ts: 1,
    });
    expect(a, 'le premier webhook a été écarté').not.toBeNull();
    expect(a?.etat).toBe('actif');
  });
});
