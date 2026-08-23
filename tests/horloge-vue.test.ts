// L'HORLOGE CÔTÉ ÉCRAN — le repli du journal, et le verdict qui rend l'annonce
// réfutable.
//
// Module pur : aucun DOM, aucun réseau. Ce qui est éprouvé ici est exactement
// ce que l'écran affichera, et ce qu'il REFUSERA d'afficher.

import { describe, expect, it } from 'vitest';
import type { HiveEvent } from '../src/shared/types.js';
import { annoncesDepuisEvenements, verdictAnnonce } from '../dashboard/src/horloge-vue.js';

let suivant = 1;
function ev(type: string, payload: Record<string, unknown>): HiveEvent {
  return { id: suivant++, ts: 1_700_000_000_000 + suivant * 1_000, type, payload };
}

function annonce(taskId: string, sur: Partial<Record<string, unknown>> = {}): HiveEvent {
  return ev('duree_annoncee', {
    taskId,
    nodeId: 'noeud-1',
    socle: 'caste',
    n: 12,
    p50Ms: 420_000,
    p80Ms: 1_500_000,
    ...sur,
  });
}

describe('le repli du journal en annonces', () => {
  it('rend l’annonce de la tâche, avec la taille de son socle', () => {
    const par = annoncesDepuisEvenements([annonce('t1')]);
    expect(par.get('t1')?.annonce).toEqual({
      socle: 'caste',
      n: 12,
      p50Ms: 420_000,
      p80Ms: 1_500_000,
    });
    expect(par.get('t1')?.horsDomaine).toBeUndefined();
  });

  it('IGNORE tout ce qui n’est pas de l’horloge', () => {
    const par = annoncesDepuisEvenements([
      ev('task_assigned', { taskId: 't1' }),
      ev('node_connected', { taskId: 't1' }),
    ]);
    expect(par.size).toBe(0);
  });

  it('LA DERNIÈRE ANNONCE GAGNE : une tâche re-livrée est ré-annoncée', () => {
    // ─── LA MOITIÉ QUI TUE « la première gagne » ────────────────────────────
    //
    // Le filet de re-livraison repasse une tâche muette à un autre nœud, et
    // `envoyerTache` ré-annonce avec l'historique du moment. Garder la première
    // afficherait, sur une tâche EN VOL, un intervalle qu'elle ne suit plus —
    // et l'écart entre l'affiché et le vécu passerait pour une erreur de
    // l'horloge alors qu'il n'est qu'une annonce périmée.
    const par = annoncesDepuisEvenements([
      annonce('t1', { p80Ms: 60_000, n: 5 }),
      annonce('t1', { p80Ms: 900_000, n: 40 }),
    ]);
    expect(par.get('t1')?.annonce?.p80Ms).toBe(900_000);
    expect(par.get('t1')?.annonce?.n).toBe(40);
  });

  it('L’ALERTE HORS DOMAINE TIENT SEULE, sans annonce dans la fenêtre', () => {
    // ─── POURQUOI LES DEUX MOITIÉS SONT INDÉPENDANTES ───────────────────────
    //
    // Le journal est élagué. Une tâche qui court depuis des heures est
    // précisément celle dont l'annonce a eu le plus de temps pour sortir de la
    // fenêtre — et c'est aussi la seule pour qui l'alerte compte. Exiger
    // l'annonce ferait taire le signal exactement là où il sert.
    const par = annoncesDepuisEvenements([
      ev('duree_hors_domaine', {
        taskId: 't9',
        nodeId: 'n1',
        ecouleMs: 7_200_000,
        recordMs: 3_600_000,
      }),
    ]);
    expect(par.get('t9')?.horsDomaine).toEqual({ ecouleMs: 7_200_000, recordMs: 3_600_000 });
    expect(par.get('t9')?.annonce).toBeUndefined();
  });

  it('UNE RÉ-ANNONCE N’EFFACE PAS L’ALERTE DÉJÀ REÇUE', () => {
    // La moitié qui tue la perte du `...avant` : sans lui, la seconde écriture
    // remplacerait l'entrée entière et l'avertissement disparaîtrait de l'écran
    // au moment même où la tâche est repartie pour un tour.
    const par = annoncesDepuisEvenements([
      ev('duree_hors_domaine', { taskId: 't1', ecouleMs: 7_200_000, recordMs: 3_600_000 }),
      annonce('t1'),
    ]);
    expect(par.get('t1')?.horsDomaine?.recordMs).toBe(3_600_000);
    expect(par.get('t1')?.annonce?.n).toBe(12);
  });

  it('ET RÉCIPROQUEMENT : l’alerte ne mange pas l’annonce', () => {
    const par = annoncesDepuisEvenements([
      annonce('t1'),
      ev('duree_hors_domaine', { taskId: 't1', ecouleMs: 7_200_000, recordMs: 3_600_000 }),
    ]);
    expect(par.get('t1')?.annonce?.p50Ms).toBe(420_000);
    expect(par.get('t1')?.horsDomaine?.ecouleMs).toBe(7_200_000);
  });

  it('UN PAYLOAD INCOMPLET NE CRÉE PAS DE DEMI-ANNONCE', () => {
    // Un champ manquant ferait afficher « undefined min ». On préfère le
    // silence : une annonce à moitié lue n'est pas une annonce.
    const par = annoncesDepuisEvenements([
      ev('duree_annoncee', { taskId: 't1', socle: 'caste', n: 12, p50Ms: 1 }),
    ]);
    expect(par.size).toBe(0);
  });

  it('UN NaN NE TRAVERSE PAS — `Number.isFinite`, pas `typeof number`', () => {
    // `NaN` est un `number`. Passé, il rendrait « NaN min » à l'écran.
    const par = annoncesDepuisEvenements([annonce('t1', { p80Ms: Number.NaN })]);
    expect(par.size).toBe(0);
  });

  it('UN SOCLE INCONNU EST REFUSÉ', () => {
    const par = annoncesDepuisEvenements([annonce('t1', { socle: 'devinette' })]);
    expect(par.size).toBe(0);
  });

  it('UNE TÂCHE SANS IDENTIFIANT — ou d’identifiant vide — est ignorée', () => {
    const par = annoncesDepuisEvenements([annonce(''), ev('duree_annoncee', { socle: 'caste' })]);
    expect(par.size).toBe(0);
  });
});

describe('le verdict — l’annonce confrontée au réel', () => {
  const A = { socle: 'caste', n: 12, p50Ms: 420_000, p80Ms: 1_500_000 } as const;

  it('sous le plafond : TENUE', () => {
    expect(verdictAnnonce(A, 900_000)).toBe('tenue');
  });

  it('PILE SUR LE PLAFOND : encore TENUE', () => {
    // La moitié qui tue `<=` → `<`. Les deux quantiles sont des entiers
    // (`Math.round`), donc l'égalité est ATTEIGNABLE : ce n'est pas une borne
    // théorique. « Au plus 25 min » tenu en exactement 25 min est tenu.
    expect(verdictAnnonce(A, 1_500_000)).toBe('tenue');
    expect(verdictAnnonce(A, 1_500_001)).toBe('debordee');
  });

  it('au-dessus : DÉBORDÉE', () => {
    expect(verdictAnnonce(A, 2_000_000)).toBe('debordee');
  });

  it('SANS ANNONCE : aucun verdict', () => {
    expect(verdictAnnonce(undefined, 900_000)).toBe('sans_objet');
  });

  it('SOCLE « AUCUN » : aucun verdict — refuser de chiffrer n’est pas se tromper', () => {
    // ─── LE PIÈGE QUE CE CAS FERME ──────────────────────────────────────────
    //
    // Sur socle « aucun », `p80Ms` vaut 0 : la ruche a dit « je ne sais pas
    // encore ». Sans cette garde, TOUTE durée réelle dépasse 0 et l'écran
    // afficherait « débordée » sur chacune de ces tâches. On noterait comme un
    // échec de prédiction le fait d'avoir refusé d'en faire une — l'incitation
    // exacte qui pousse à chiffrer n'importe quoi pour sauver la face.
    expect(verdictAnnonce({ socle: 'aucun', n: 2, p50Ms: 0, p80Ms: 0 }, 900_000)).toBe(
      'sans_objet',
    );
  });

  it('UNE DURÉE RÉELLE ABSURDE NE REND PAS DE VERDICT', () => {
    // Le tiroir passe `-1` quand la tâche n'a pas de résultat : sans cette
    // garde, `-1 <= p80` rendrait « tenue » sur une tâche qui n'a rien fini.
    expect(verdictAnnonce(A, -1)).toBe('sans_objet');
    expect(verdictAnnonce(A, Number.NaN)).toBe('sans_objet');
  });

  it('ZÉRO EST UNE DURÉE : elle tient', () => {
    // La borne d'à côté : `< 0` et non `<= 0`. Une tâche instantanée a bien
    // tenu son annonce — la refuser perdrait un verdict légitime.
    expect(verdictAnnonce(A, 0)).toBe('tenue');
  });
});
