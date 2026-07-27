// Les serveurs : provisionner à l'achat, arrêter à la fin.
//
// Ce module décide de DÉMARRER DES MACHINES QUI COÛTENT DE L'ARGENT. Deux
// erreurs, symétriques, et les tests visent les deux :
//
//   · en provisionner trop — un webhook rejoué démarre une machine de plus à
//     chaque livraison, le client en paie une et on en facture dix ;
//   · ne pas les arrêter — une facture qui court pour un client parti.
//
// La troisième erreur, plus grave que les deux autres : supprimer trop tôt.
// Une machine arrêtée garde le travail de quelqu'un.

import { describe, expect, it } from 'vitest';
import {
  ETATS,
  FOURNISSEUR_MANUEL,
  RETENTION_JOURS,
  SERVEURS_MAX,
  aArreter,
  aSupprimer,
  coute,
  decider,
  fournisseurParNom,
  joursAvantSuppression,
  replierServeurs,
  transiter,
  transitionPermise,
} from '../src/orchestrator/serveurs.js';
import type { EtatServeur, Serveur } from '../src/orchestrator/serveurs.js';

const NOW = 1_800_000_000_000;
const JOUR = 86_400_000;

function serveur(p: Partial<Serveur> = {}): Serveur {
  return {
    id: 's1',
    projectId: 'p1',
    refAbonnement: 'sub_1',
    etat: 'pret',
    fournisseur: 'manuel',
    refMachine: '',
    gabarit: '2 vCPU / 4 Go',
    motif: '',
    creeA: NOW,
    majA: NOW,
    arreteA: 0,
    ...p,
  };
}

const demande = {
  projectId: 'p1',
  refAbonnement: 'sub_1',
  serveursInclus: 1,
  gabarit: '2 vCPU / 4 Go',
};

describe('serveurs — LE piège : le webhook rejoué', () => {
  it('un achat démarre un serveur', () => {
    const v = decider(demande, []);
    expect(v.action).toBe('provisionner');
    expect(v.action === 'provisionner' && v.combien).toBe(1);
  });

  it('REJOUER le même webhook ne démarre RIEN de plus', () => {
    // Sans ça, chaque re-livraison ajoute une machine : le client en paie une,
    // on en facture dix, et personne ne le voit avant la facture.
    const existant = [serveur()];
    for (let i = 0; i < 10; i++) {
      expect(decider(demande, existant).action, `rejeu ${i}`).toBe('rien');
    }
  });

  it('la clé est l’ABONNEMENT, pas l’événement', () => {
    // « actif » puis « paiement_reussi » sont deux événements distincts qui
    // portent le même abonnement : un seul serveur doit en sortir.
    expect(decider(demande, [serveur({ refAbonnement: 'sub_1' })]).action).toBe('rien');
    // Un autre abonnement, en revanche, a droit au sien.
    expect(decider({ ...demande, refAbonnement: 'sub_2' }, [serveur()]).action).toBe(
      'provisionner',
    );
  });

  it('un serveur en cours de provisionnement compte déjà', () => {
    // Sinon un second webhook arrivant pendant le démarrage en lancerait un
    // deuxième — la fenêtre exacte où le rejeu est le plus probable.
    expect(decider(demande, [serveur({ etat: 'provisionnement' })]).action).toBe('rien');
    expect(decider(demande, [serveur({ etat: 'demande' })]).action).toBe('rien');
  });

  it('un serveur ARRÊTÉ compte : on le rallume, on n’en empile pas un neuf', () => {
    // Empiler laisserait les données de l'utilisateur dans une machine éteinte
    // qu'il ne retrouverait jamais.
    expect(decider(demande, [serveur({ etat: 'arrete', arreteA: NOW })]).action).toBe('rien');
  });

  it('un serveur ÉCHOUÉ ne compte pas : on réessaie', () => {
    // Un client qui a payé et dont le provisionnement a raté doit finir par
    // avoir sa machine.
    expect(decider(demande, [serveur({ etat: 'echoue' })]).action).toBe('provisionner');
  });

  it('un serveur SUPPRIMÉ ne compte pas non plus', () => {
    expect(decider(demande, [serveur({ etat: 'supprime' })]).action).toBe('provisionner');
  });

  it('complète la différence, ni plus ni moins', () => {
    const v = decider({ ...demande, serveursInclus: 3 }, [serveur()]);
    expect(v.action === 'provisionner' && v.combien).toBe(2);
  });
});

describe('serveurs — les bornes', () => {
  it('un plan sans serveur n’en provisionne aucun', () => {
    expect(decider({ ...demande, serveursInclus: 0 }, []).action).toBe('rien');
    expect(decider({ ...demande, serveursInclus: -5 }, []).action).toBe('rien');
  });

  it('la borne dure tient MÊME si le plan demande l’absurde', () => {
    // Elle n'est pas là pour vendre moins : elle est là pour qu'un bogue dans
    // la logique de plan ne puisse pas provisionner mille machines.
    const v = decider({ ...demande, serveursInclus: 100_000 }, []);
    expect(v.action === 'provisionner' && v.combien).toBe(SERVEURS_MAX);
  });
});

describe('serveurs — arrêter, puis supprimer', () => {
  it('seules les machines qui coûtent sont arrêtées', () => {
    const tous = ETATS.map((etat) => serveur({ id: etat, etat }));
    const arret = aArreter(tous).map((s) => s.id);
    expect(arret.sort()).toEqual(['pret', 'provisionnement']);
  });

  it('« coûte » ne dit vrai que pour les machines allumées', () => {
    expect(coute('pret')).toBe(true);
    expect(coute('provisionnement')).toBe(true);
    for (const e of ['demande', 'arrete', 'supprime', 'echoue'] as const) {
      expect(coute(e), e).toBe(false);
    }
  });

  it('une machine arrêtée n’est PAS supprimée tout de suite', () => {
    // Elle garde le travail de quelqu'un. C'est l'erreur la plus grave des
    // trois : elle est irréversible.
    const s = serveur({ etat: 'arrete', arreteA: NOW });
    expect(aSupprimer([s], NOW)).toEqual([]);
    expect(aSupprimer([s], NOW + (RETENTION_JOURS - 1) * JOUR)).toEqual([]);
  });

  it('…mais elle l’est après la rétention', () => {
    const s = serveur({ etat: 'arrete', arreteA: NOW });
    expect(aSupprimer([s], NOW + RETENTION_JOURS * JOUR)).toHaveLength(1);
  });

  it('une machine allumée n’est jamais supprimée par ce chemin', () => {
    const s = serveur({ etat: 'pret' });
    expect(aSupprimer([s], NOW + 10 * RETENTION_JOURS * JOUR)).toEqual([]);
  });

  it('le compte à rebours est lisible par l’utilisateur', () => {
    // Le délai doit être affiché au moment de l'arrêt, pas découvert le jour
    // où quelqu'un revient chercher son travail.
    const s = serveur({ etat: 'arrete', arreteA: NOW });
    expect(joursAvantSuppression(s, NOW)).toBe(RETENTION_JOURS);
    expect(joursAvantSuppression(s, NOW + 25 * JOUR)).toBe(5);
    expect(joursAvantSuppression(s, NOW + 60 * JOUR)).toBe(0);
    expect(joursAvantSuppression(serveur({ etat: 'pret' }), NOW)).toBe(-1);
  });
});

describe('serveurs — les transitions', () => {
  it('« supprimé » est TERMINAL', () => {
    // Ressusciter donnerait un serveur au même identifiant SANS les données
    // qu'il avait — pire que de refuser.
    for (const vers of ETATS) expect(transitionPermise('supprime', vers), vers).toBe(false);
  });

  it('on ne saute pas de « demande » à « prêt »', () => {
    // Une machine ne devient prête qu'après avoir été provisionnée : sauter
    // l'étape masquerait un provisionnement qui n'a jamais eu lieu.
    expect(transitionPermise('demande', 'pret')).toBe(false);
    expect(transitionPermise('demande', 'provisionnement')).toBe(true);
    expect(transitionPermise('provisionnement', 'pret')).toBe(true);
  });

  it('un échec peut être réessayé', () => {
    expect(transitionPermise('echoue', 'provisionnement')).toBe(true);
  });

  it('redemander l’état COURANT est idempotent, pas une erreur', () => {
    // C'est un webhook rejoué, ou un bouton cliqué deux fois.
    const s = serveur({ etat: 'pret' });
    const r = transiter(s, 'pret', 'peu importe', NOW + 1);
    expect(r.applique).toBe(false);
    expect(r.refus).toBe('');
    expect(r.serveur).toBe(s);
  });

  it('une transition interdite est REFUSÉE avec son motif', () => {
    const r = transiter(serveur({ etat: 'supprime' }), 'pret', 'hop', NOW);
    expect(r.applique).toBe(false);
    expect(r.refus).toMatch(/transition refusée : supprime → pret/);
  });

  it('l’arrêt horodate, pour que la rétention puisse commencer', () => {
    const r = transiter(serveur({ etat: 'pret' }), 'arrete', 'abonnement terminé', NOW);
    expect(r.applique).toBe(true);
    expect(r.serveur.arreteA).toBe(NOW);
    expect(r.serveur.motif).toBe('abonnement terminé');
  });

  it('est PURE : le serveur passé n’est jamais muté', () => {
    const s = serveur({ etat: 'pret' });
    const copie = { ...s };
    transiter(s, 'arrete', 'x', NOW);
    expect(s).toEqual(copie);
  });
});

describe('serveurs — le fournisseur manuel', () => {
  it('rend des instructions qui marchent aujourd’hui', async () => {
    // Une intégration de cloud exige un compte, une clé, une facturation et une
    // région — quatre choses qu'on ne peut pas inventer à la place de
    // l'utilisateur. Le chemin manuel, lui, fonctionne sans rien.
    const m = await FOURNISSEUR_MANUEL.demarrer({
      gabarit: '2 vCPU / 4 Go',
      billet: 'hive2_abc',
      urlRuche: 'wss://ruche.exemple.fr/ws',
    });
    const texte = m.instructions.join('\n');
    expect(texte).toContain('npm run setup');
    expect(texte).toContain('npm run join hive2_abc');
    expect(texte).toContain('wss://ruche.exemple.fr/ws');
    expect(texte, 'le bac à sable doit être mentionné').toMatch(/podman/);
  });

  it('ne prétend pas avoir démarré une machine', () => {
    // `ref` vide : le serveur reste en provisionnement jusqu'à ce qu'une vraie
    // machine se connecte.
    return FOURNISSEUR_MANUEL.demarrer({
      gabarit: 'x',
      billet: 'b',
      urlRuche: 'wss://x/ws',
    }).then((m) => expect(m.ref).toBe(''));
  });

  it('est trouvable par son nom', () => {
    expect(fournisseurParNom('manuel')?.nom).toBe('manuel');
    expect(fournisseurParNom('aws')).toBeNull();
  });
});

describe('serveurs — ce que voit l’administrateur', () => {
  it('compte d’abord ce qui COÛTE', () => {
    // C'est le chiffre qu'on ne veut jamais découvrir en retard.
    const vue = replierServeurs(
      [
        serveur({ id: 'a', etat: 'pret' }),
        serveur({ id: 'b', etat: 'provisionnement' }),
        serveur({ id: 'c', etat: 'arrete', arreteA: NOW }),
        serveur({ id: 'd', etat: 'supprime' }),
      ],
      NOW,
    );
    expect(vue.total).toBe(4);
    expect(vue.facturables).toBe(2);
    expect(vue.parEtat.pret).toBe(1);
    expect(vue.parEtat.supprime).toBe(1);
  });

  it('signale ce qui va être effacé dans la semaine', () => {
    const vue = replierServeurs(
      [
        serveur({ id: 'bientot', etat: 'arrete', arreteA: NOW - (RETENTION_JOURS - 3) * JOUR }),
        serveur({ id: 'plus tard', etat: 'arrete', arreteA: NOW }),
      ],
      NOW,
    );
    expect(vue.bientotSupprimes).toHaveLength(1);
    expect(vue.bientotSupprimes[0]?.id).toBe('bientot');
    expect(vue.bientotSupprimes[0]?.jours).toBe(3);
  });

  it('l’ordre est TOTAL', () => {
    const a = serveur({ id: 'a', etat: 'arrete', arreteA: NOW - (RETENTION_JOURS - 2) * JOUR });
    const b = serveur({ id: 'b', etat: 'arrete', arreteA: NOW - (RETENTION_JOURS - 2) * JOUR });
    expect(replierServeurs([b, a], NOW).bientotSupprimes.map((x) => x.id)).toEqual(['a', 'b']);
  });

  it('une ruche sans serveur ne rend pas de trous', () => {
    const vue = replierServeurs([], NOW);
    expect(vue.total).toBe(0);
    expect(vue.facturables).toBe(0);
    for (const e of ETATS) expect(vue.parEtat[e as EtatServeur]).toBe(0);
  });
});
