// LES BORNES DE LA LIVRAISON — six gardes nues sur le chemin qui ouvre une PR.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Premier balayage élargi de `src/orchestrator/livraison.ts`, base épinglée
// `05ad40f` (parent de la création du fichier) : **38 mutations, 38 examinées,
// 32 défendues, 6 NUES**. Le module balayé n'est pas une vue : c'est celui qui
// transforme la production d'une ouvrière en branche, en poussée et en pull
// request SUR LE DÉPÔT DE L'UTILISATEUR. Une garde nue y ment à un humain qui
// s'apprête à fusionner.
//
// Les six, et ce que chacune coûte si elle tombe :
//
//   · `merged === true || merged_at !== ''`  → `&&`
//     Une PR fusionnée qui ne porte qu'UN des deux signaux est lue « non
//     fusionnée ». La ruche relivre alors une tâche déjà livrée — c'est le
//     martèlement de § 9 (filet `staleAssignedTasks`) rejoué par le haut.
//
//   · `typeof fusionnableBrut === 'boolean'`  → `!==`
//     `mergeable` est le champ qui décide si la fusion est seulement tentée.
//     Inversé, il rend `null` quand GitHub a répondu, et la valeur brute quand
//     il ne l'a pas fait. L'écran affiche « on ne sait pas » sur un fait connu.
//
//   · `typeof o === 'object' && o !== null`  → `||`
//     `typeof null === 'object'` rend VRAI. Avec `||`, `null` traverse le
//     garde-fou et l'indexation LÈVE. La lecture des faits d'une PR meurt sur
//     une charge utile incomplète au lieu de rendre un champ vide. C'est très
//     exactement la nue trouvée dans le Concierge, dans un autre module.
//
//   · `ref.length > 200`  → `>=`
//     Un nom de branche de 200 caractères EXACTEMENT devient invalide. La
//     borne acceptée n'était traversée que par le bas.
//
//   · `fichiers.length > 50`  → `>=`
//     À cinquante fichiers pile, le corps de la PR annonce « … et 0 de plus ».
//
//   · le `>` de « Attendu : un entier > 0. »
//     Dans une CHAÎNE, pas dans une comparaison : le conseil rendu à l'humain.
//     Muté, la ruche demande un entier « >= 0 » puis refuse zéro. Ce n'est PAS
//     un équivalent — le texte part à l'écran — et c'est la seule des six qui
//     ne change aucun calcul. Elle se ferme quand même : le conseil est ce
//     qu'un humain lit pour se corriger.
//
// ─── POURQUOI UN FAUX FETCHEUR, ET PAS UN SERVEUR ────────────────────────────
//
// `OptionsLivraison` accepte un `fetcheur`. Les faits d'une PR se lisent par
// trois GET ; aucun n'a besoin d'une socket. Un serveur HTTP simulé (façon
// `livraison-inspection`) est nécessaire quand c'est le CORPS ENVOYÉ qui est
// en jeu ; ici c'est la RÉPONSE REÇUE, et le faux fetcheur la rend directement.
// Moins de pièces mobiles, aucune attente d'horloge.

import { describe, expect, it } from 'vitest';
import { corpsPr, lireFaitsPr, refValide } from '../src/orchestrator/livraison.js';
import { ErreurGithub } from '../src/orchestrator/github.js';
import type { Fetcheur } from '../src/orchestrator/github.js';

const DEPOT = 'Micka420-collab/hive';
const OPTS_BASE = { jeton: 'jeton-de-banc-assez-long-pour-passer', api: 'https://exemple.invalid' };

/** Réponse JSON minimale — `lireOuNull` ne lit que `status`, `ok` et `json()`. */
function reponse(corps: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => corps,
  } as unknown as Response;
}

/**
 * Un GitHub réduit à ce que `lireFaitsPr` lui demande.
 *
 * Les check-runs et les revues rendent des listes vides par défaut : ce banc
 * porte sur les TROIS champs dérivés de la charge utile de la PR, pas sur
 * l'agrégation des contrôles, déjà éprouvée ailleurs.
 */
function fetcheurPr(pr: unknown): Fetcheur {
  return async (url: string) => {
    if (url.includes('/check-runs')) return reponse({ check_runs: [] });
    if (url.includes('/reviews')) return reponse([]);
    return reponse(pr);
  };
}

describe('lireFaitsPr — les deux signaux de fusion', () => {
  // MUTANT : `||` → `&&`. Une seule des deux marques suffit à dire « fusionnée ».
  it('lit fusionnée quand SEUL merged_at est présent', async () => {
    const faits = await lireFaitsPr(
      {
        ...OPTS_BASE,
        fetcheur: fetcheurPr({ state: 'closed', merged_at: '2026-08-22T10:00:00Z' }),
      },
      DEPOT,
      7,
    );
    expect(faits.fusionnee).toBe(true);
  });

  it('lit fusionnée quand SEUL merged vaut true', async () => {
    const faits = await lireFaitsPr(
      { ...OPTS_BASE, fetcheur: fetcheurPr({ state: 'closed', merged: true }) },
      DEPOT,
      7,
    );
    expect(faits.fusionnee).toBe(true);
  });

  // Le bord négatif : sans ce cas, `fusionnee: true` en dur passerait le banc.
  it('ne lit PAS fusionnée quand aucune des deux marques n’est là', async () => {
    const faits = await lireFaitsPr(
      { ...OPTS_BASE, fetcheur: fetcheurPr({ state: 'open' }) },
      DEPOT,
      7,
    );
    expect(faits.fusionnee).toBe(false);
  });
});

describe('lireFaitsPr — mergeable, connu ou inconnu', () => {
  // MUTANT : `===` → `!==` sur le `typeof`. Les deux bords s'échangent.
  it('rend le booléen quand GitHub a tranché', async () => {
    const faits = await lireFaitsPr(
      { ...OPTS_BASE, fetcheur: fetcheurPr({ state: 'open', mergeable: false }) },
      DEPOT,
      7,
    );
    expect(faits.fusionnable).toBe(false);
  });

  it('rend null quand GitHub calcule encore', async () => {
    const faits = await lireFaitsPr(
      { ...OPTS_BASE, fetcheur: fetcheurPr({ state: 'open', mergeable: null }) },
      DEPOT,
      7,
    );
    expect(faits.fusionnable).toBeNull();
  });
});

describe('lireFaitsPr — une charge utile incomplète ne doit pas LEVER', () => {
  // MUTANT : `&&` → `||` dans `champ`. `typeof null === 'object'` étant vrai,
  // `||` laisse passer null/undefined et l'indexation lève un TypeError.
  //
  // Le chemin le plus court jusqu'à `champ(undefined, …)` : une PR sans `head`.
  // `chaine(champ(pr, 'head'), 'sha')` appelle alors `champ(undefined, 'sha')`.
  it('rend des faits utilisables quand la PR n’a pas de head', async () => {
    const faits = await lireFaitsPr(
      { ...OPTS_BASE, fetcheur: fetcheurPr({ state: 'open' }) },
      DEPOT,
      7,
    );
    expect(faits.numero).toBe(7);
    expect(faits.ouverte).toBe(true);
    expect(faits.controles).toEqual([]);
  });

  it('rend des faits utilisables quand la PR elle-même est nulle', async () => {
    const fetcheur: Fetcheur = async (url: string) => {
      if (url.includes('/check-runs')) return reponse({ check_runs: [] });
      if (url.includes('/reviews')) return reponse([]);
      return reponse({ toujours: null });
    };
    const faits = await lireFaitsPr({ ...OPTS_BASE, fetcheur }, DEPOT, 7);
    expect(faits.ouverte).toBe(false);
    expect(faits.fusionnee).toBe(false);
  });
});

describe('lireFaitsPr — le conseil rendu sur un numéro invalide', () => {
  // MUTANT : le `>` de la chaîne « Attendu : un entier > 0. ».
  it('dit à l’humain ce qui est attendu, au caractère près', async () => {
    await expect(
      lireFaitsPr({ ...OPTS_BASE, fetcheur: fetcheurPr({}) }, DEPOT, 0),
    ).rejects.toMatchObject({
      statut: 400,
      conseil: 'Attendu : un entier > 0.',
    });
  });

  it('refuse aussi un numéro négatif et un non-entier', async () => {
    for (const mauvais of [-3, 1.5]) {
      const leve = await lireFaitsPr(
        { ...OPTS_BASE, fetcheur: fetcheurPr({}) },
        DEPOT,
        mauvais,
      ).catch((e: unknown) => e);
      expect(leve).toBeInstanceOf(ErreurGithub);
    }
  });
});

describe('refValide — la borne haute est ACCEPTÉE', () => {
  // MUTANT : `> 200` → `>= 200`. Le bord n'était traversé que par le bas.
  it('accepte une référence de 200 caractères exactement', () => {
    expect(refValide('a'.repeat(200))).toBe(true);
  });

  it('refuse une référence de 201 caractères', () => {
    expect(refValide('a'.repeat(201))).toBe(false);
  });
});

describe('corpsPr — la borne des cinquante fichiers', () => {
  const base = {
    tache: 'une tâche',
    nodeName: 'ouvriere-1',
    fichiers: [] as readonly string[],
  };

  // MUTANT : `> 50` → `>= 50`. À cinquante pile, « … et 0 de plus ».
  it('n’ajoute aucune ligne de reste à cinquante fichiers exactement', () => {
    const corps = corpsPr({ ...base, fichiers: Array.from({ length: 50 }, (_, i) => `f${i}.ts`) });
    expect(corps).not.toContain('de plus');
  });

  it('annonce le reste au-delà de cinquante', () => {
    const corps = corpsPr({ ...base, fichiers: Array.from({ length: 53 }, (_, i) => `f${i}.ts`) });
    expect(corps).toContain('… et 3 de plus');
  });
});
