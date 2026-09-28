// Le contrat des connecteurs — l'ensemble fermé des portées, la compatibilité
// avec le mode, et le fait que chaque refus est une CHAÎNE (jamais un booléen),
// pour qu'il se journalise tel quel.

import { describe, expect, it } from 'vitest';
import {
  PORTEES,
  estPortee,
  validerPortee,
  validerPorteesDemandees,
  porteePourEvenement,
  type DefinitionConnecteur,
} from '../src/connectors/contrat.js';
import { DEF_WEBHOOK } from '../src/connectors/webhook/definition.js';
import { DEF_SLACK } from '../src/connectors/slack/definition.js';

const LECTURE_SEULE: DefinitionConnecteur = {
  id: 'ro',
  libelleFr: 'RO',
  libelleEn: 'RO',
  hintFr: '',
  hintEn: '',
  mode: 'lecture_seule',
  porteesPossibles: ['notification'],
  secrets: [],
};

describe('les portées sont un ensemble fermé', () => {
  it('reconnaît exactement les quatre mots, et rien d’autre', () => {
    expect([...PORTEES]).toEqual(['lecture', 'notification', 'approbation', 'action']);
    expect(estPortee('notification')).toBe(true);
    expect(estPortee('supprimer_tout')).toBe(false);
    expect(estPortee('')).toBe(false);
  });

  it('un mot inconnu est refusé, pas toléré', () => {
    const v = validerPortee(DEF_SLACK, 'root');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('portee_inconnue');
  });
});

describe('le mode borne les portées accordables', () => {
  it('un connecteur lecture_seule ne peut PAS porter approbation', () => {
    const v = validerPortee(LECTURE_SEULE, 'approbation');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('portee_hors_mode');
  });

  it('le webhook (lecture_seule) n’offre que la notification', () => {
    expect(validerPortee(DEF_WEBHOOK, 'notification').ok).toBe(true);
    const approb = validerPortee(DEF_WEBHOOK, 'approbation');
    expect(approb.ok).toBe(false);
    // Hors mode l'emporte sur non-offerte : c'est le refus le plus fondamental.
    if (!approb.ok) expect(approb.motif).toBe('portee_hors_mode');
  });

  it('Slack (action) peut porter approbation, mais pas une portée qu’il n’offre pas', () => {
    expect(validerPortee(DEF_SLACK, 'approbation').ok).toBe(true);
    const lecture = validerPortee(DEF_SLACK, 'lecture');
    expect(lecture.ok).toBe(false);
    if (!lecture.ok) expect(lecture.motif).toBe('portee_non_offerte');
  });
});

describe('validerPorteesDemandees replie et borne', () => {
  it('refuse une liste vide', () => {
    const v = validerPorteesDemandees(DEF_SLACK, []);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('aucune_portee');
  });

  it('replie les doublons sans erreur', () => {
    const v = validerPorteesDemandees(DEF_SLACK, ['notification', 'notification', 'approbation']);
    expect(v.ok).toBe(true);
    if (v.ok) expect(v.portees).toEqual(['notification', 'approbation']);
  });

  it('rejette dès la première portée invalide', () => {
    const v = validerPorteesDemandees(DEF_SLACK, ['notification', 'action']);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toBe('portee_non_offerte');
  });

  it('rejette une entrée non-chaîne', () => {
    const v = validerPorteesDemandees(DEF_SLACK, ['notification', 42]);
    expect(v.ok).toBe(false);
  });
});

describe('la portée exigée par un événement a un seul point de vérité', () => {
  it('chez un connecteur qui AGIT, une demande d’approbation exige approbation', () => {
    expect(porteePourEvenement('demande_approbation', DEF_SLACK.mode)).toBe('approbation');
    expect(porteePourEvenement('decision', DEF_SLACK.mode)).toBe('notification');
    expect(porteePourEvenement('blocage', DEF_SLACK.mode)).toBe('notification');
    expect(porteePourEvenement('resume_mission', DEF_SLACK.mode)).toBe('notification');
  });

  it('chez un connecteur en lecture seule, elle n’est qu’une notification — et reste accordable', () => {
    // Le webhook ne peut porter QUE `notification` : si la demande d'approbation
    // exigeait `approbation` chez lui aussi, elle ne partirait jamais.
    const requise = porteePourEvenement('demande_approbation', DEF_WEBHOOK.mode);
    expect(requise).toBe('notification');
    expect(validerPortee(DEF_WEBHOOK, requise).ok).toBe(true);
  });
});
