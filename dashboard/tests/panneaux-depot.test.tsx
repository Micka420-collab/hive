// @vitest-environment happy-dom
//
// LES DEUX PANNEAUX, RENDUS POUR DE VRAI.
//
// ─── LE TROU QUE CE FICHIER OUVRE ────────────────────────────────────────────
//
// Jusqu'ici, AUCUN test de ce dépôt ne rendait un composant React. Vingt-six
// lots de tableau de bord livrés, et tout ce qu'on savait vérifier, c'était le
// TEXTE des sources : « le composant est monté », « le fetcher vise la bonne
// route ». C'est du câblage, pas du comportement.
//
// La loupe l'a dit sans détour. Passée sur le lot précédent, elle a laissé sept
// mutations survivre, toutes dans le JSX, dont celle-ci :
//
//     disabled={enCours !== null}   →   disabled={enCours === null}
//
// Retournée, elle verrouille TOUS les boutons dès l'affichage : le panneau est
// livré, joli, et rigoureusement inutilisable. La suite restait verte.
//
// ─── CE QUE CES TESTS TIENNENT, QU'UNE LECTURE DE SOURCE NE PEUT PAS ─────────
//
// Une machine à états. `enCours` vaut `null`, puis le numéro de l'issue qu'on
// prend, puis `null` de nouveau. Les trois moments ont chacun un rendu, et le
// défaut vit dans le PASSAGE de l'un à l'autre. Aucune expression régulière sur
// le source n'atteint ça — il faut cliquer et regarder.
//
// D'où le réseau piloté plus bas : la réponse n'arrive que lorsqu'on la laisse
// arriver, ce qui rend l'instant « la ruche travaille » OBSERVABLE. Un test qui
// laisserait la promesse se résoudre toute seule ne verrait jamais cet instant,
// et la mutation ci-dessus lui survivrait exactement comme au reste.
//
// ─── CE QUE CE FICHIER NE PRÉTEND PAS ÊTRE ───────────────────────────────────
//
// Ni un test de style, ni un test d'accessibilité, ni un rendu fidèle : happy-
// dom n'a pas de moteur de mise en page. Ce qu'on lit ici, c'est la STRUCTURE
// produite et les états de la machine — le reste se vérifie dans un vrai
// navigateur, et cela reste hors de la suite.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { IssuesProjet, LivraisonsProjet } from '../src/views/Projets';
import { setLang } from '../src/i18n';
import type { IssueVue, LivraisonVue } from '../src/api';
import type { Project } from '../../src/shared/types';

// React exige qu'on déclare l'environnement de test, sinon chaque `act` gronde.
declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Le réseau, sous contrôle ───────────────────────────────────────────────
//
// Chaque appel se met en file d'attente au lieu de répondre. On décide QUAND
// il répond — c'est la seule façon d'observer le rendu « pendant que ça
// travaille », qui est précisément là où vivent les défauts qu'on cherche.

interface AppelEnAttente {
  url: string;
  methode: string;
  repondre: (corps: unknown) => Promise<void>;
  echouer: (statut: number, corps: unknown) => Promise<void>;
}

let appels: AppelEnAttente[] = [];

function poserLeReseau(): void {
  appels = [];
  globalThis.fetch = ((entree: unknown, init?: RequestInit) =>
    new Promise((resolve) => {
      const rendre = async (statut: number, corps: unknown): Promise<void> => {
        // `act` vide la file des micro-tâches : sans lui, le rendu déclenché par
        // la résolution arriverait APRÈS l'assertion, et le test lirait l'état
        // précédent en croyant lire le suivant.
        await act(async () => {
          resolve({
            ok: statut >= 200 && statut < 300,
            status: statut,
            json: async () => corps,
          } as Response);
          await Promise.resolve();
        });
      };
      appels.push({
        url: String(entree),
        methode: init?.method ?? 'GET',
        repondre: (corps) => rendre(200, corps),
        echouer: (statut, corps) => rendre(statut, corps),
      });
    })) as typeof fetch;
}

/** L'appel en attente, avec un message utile quand il n'y en a pas. */
function dernierAppel(): AppelEnAttente {
  const a = appels[appels.length - 1];
  expect(a, 'aucun appel réseau en attente — le clic n’a rien déclenché').toBeTruthy();
  return a as AppelEnAttente;
}

// ─── Montage ────────────────────────────────────────────────────────────────

let conteneur: HTMLElement;
let racine: Root;

async function monter(element: React.ReactElement): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => {
    racine.render(element);
  });
}

/** Clique un bouton par son texte exact — et refuse de deviner s'il manque. */
async function cliquer(texte: string): Promise<void> {
  const boutons = [...conteneur.querySelectorAll('button')];
  const cible = boutons.find((b) => b.textContent?.trim() === texte);
  expect(
    cible,
    `bouton « ${texte} » introuvable — présents : ${boutons.map((b) => b.textContent?.trim()).join(' | ')}`,
  ).toBeTruthy();
  await act(async () => {
    (cible as HTMLButtonElement).click();
  });
}

const boutons = (): HTMLButtonElement[] => [...conteneur.querySelectorAll('button')];
const texte = (): string => conteneur.textContent ?? '';
const compte = (selecteur: string): number => conteneur.querySelectorAll(selecteur).length;

// ─── Les données ────────────────────────────────────────────────────────────

const PROJET: Project = {
  id: 'p1',
  name: 'Ruche',
  repoUrl: 'https://github.com/micka/ruche.git',
  description: null,
  visibility: 'private',
  ownerId: 'u1',
  createdAt: 0,
};

const issue = (numero: number, etiquettes: string[]): IssueVue => ({
  numero,
  titre: `Le bouton ${numero} ne répond pas`,
  corps: 'Cliquer ne fait rien.',
  etat: 'open',
  auteur: 'demandeur',
  etiquettes,
  htmlUrl: `https://github.com/micka/ruche/issues/${numero}`,
  verrouillee: false,
  commentaires: 2,
  majA: 0,
});

const livraison = (taskId: string, pr: number, reste: Partial<LivraisonVue>): LivraisonVue => ({
  taskId,
  depot: 'micka/ruche',
  pr,
  branche: `hive/${taskId}`,
  titre: `travail ${taskId}`,
  ...reste,
});

beforeAll(() => {
  // L'interface suit la langue du NAVIGATEUR, et happy-dom démarre en anglais.
  // Sans cette bascule, chaque assertion sur un libellé français accuserait
  // l'écran d'avoir perdu ses boutons alors qu'ils sont là, traduits. Le piège
  // a déjà coûté une fausse alerte sur le site vitrine et une autre sur ces
  // deux panneaux, dans un vrai Chromium.
  setLang('fr');
});

beforeEach(() => {
  poserLeReseau();
});

afterEach(async () => {
  await act(async () => {
    racine.unmount();
  });
  conteneur.remove();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LE PANNEAU DES ISSUES — la machine à états que le source ne dit pas', () => {
  it('ne demande RIEN au montage : la lecture part d’un clic', async () => {
    // La règle du quota, tenue par le comportement et non plus par une absence
    // de `useEffect` dans le texte. Une lecture au montage multiplierait les
    // appels GitHub par le nombre de cartes de projet à l'écran.
    await monter(<IssuesProjet project={PROJET} />);
    expect(appels, 'le montage ne doit toucher à rien').toHaveLength(0);
    expect(texte()).toContain('voir les issues');
  });

  it('PENDANT QU’ON PREND UNE ISSUE, cette ligne-là seule dit « … »', async () => {
    // Le mutant tué ici : `enCours === i.numero` → `!==`, qui met le « … » sur
    // TOUTES les autres lignes et laisse « prendre » sur celle qui travaille.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({
      depot: 'micka/ruche',
      issues: [issue(3, ['bug']), issue(5, [])],
      tronque: false,
    });

    await cliquer('prendre'); // la première ligne, la #3
    const libelles = boutons().map((b) => b.textContent?.trim());
    expect(
      libelles.filter((l) => l === '…'),
      'une seule ligne travaille',
    ).toHaveLength(1);
    expect(
      libelles.filter((l) => l === 'prendre'),
      'l’autre ligne attend',
    ).toHaveLength(1);
  });

  it('PENDANT CE TEMPS, AUCUNE AUTRE ISSUE N’EST PRENABLE', async () => {
    // Le mutant qui compte : `disabled={enCours !== null}` → `=== null`.
    // Retourné, il verrouille tout dès l'affichage. La première assertion est
    // celle qui rougit alors : avant le moindre clic, rien n'est verrouillé.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({
      depot: 'micka/ruche',
      issues: [issue(3, []), issue(5, [])],
      tronque: false,
    });

    expect(
      boutons().filter((b) => b.disabled),
      'AU REPOS, TOUT DOIT ÊTRE CLIQUABLE',
    ).toHaveLength(0);

    await cliquer('prendre');
    const prenables = boutons().filter((b) => !b.disabled && b.textContent?.trim() === 'prendre');
    expect(prenables, 'découper deux briefs en parallèle par mégarde').toHaveLength(0);
  });

  it('…et tout redevient prenable quand la ruche a fini', async () => {
    // Un verrou qui ne se relâche pas est le même défaut, retardé d'une étape.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({
      depot: 'micka/ruche',
      issues: [issue(3, []), issue(5, [])],
      tronque: false,
    });
    await cliquer('prendre');
    await dernierAppel().repondre({ issue: issue(3, []), taches: [{ id: 't1', title: 'x' }] });

    expect(texte(), 'la ligne prise doit rendre compte').toContain('1 tâche(s) créée(s)');
    const restant = boutons().find((b) => b.textContent?.trim() === 'prendre');
    expect(restant?.disabled, 'le verrou doit s’être relâché').toBe(false);
  });

  it('un refus s’affiche, et NE VERROUILLE PAS l’écran pour autant', async () => {
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({ depot: 'micka/ruche', issues: [issue(3, [])], tronque: false });
    await cliquer('prendre');
    await dernierAppel().echouer(403, { error: 'quota épuisé' });

    expect(texte()).toContain('quota épuisé');
    expect(compte('.panel-error')).toBe(1);
    const reessai = boutons().find((b) => b.textContent?.trim() === 'prendre');
    expect(reessai?.disabled, 'un échec doit laisser réessayer').toBe(false);
  });
});

describe('LE PANNEAU DES ISSUES — ce qu’il affiche, et ce qu’il n’affiche pas', () => {
  it('LISTE VIDE ET LISTE PLEINE ne disent pas la même chose', async () => {
    // Mutant tué : `issues.length === 0` → `!== 0`, qui met « aucune issue »
    // au-dessus d'une liste pleine et laisse une liste vide sans un mot.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({ depot: 'micka/ruche', issues: [], tronque: false });
    expect(texte()).toContain('Aucune issue ouverte sur');
    expect(compte('.pj-iss-liste')).toBe(0);

    await cliquer('relire');
    await dernierAppel().repondre({ depot: 'micka/ruche', issues: [issue(3, [])], tronque: false });
    expect(texte(), 'une liste pleine ne se dit pas vide').not.toContain('Aucune issue ouverte');
    expect(compte('.pj-iss-liste li')).toBe(1);
  });

  it('SANS ÉTIQUETTES, aucune étiquette n’est peinte', async () => {
    // Mutant tué : `etiquettes.length > 0 &&` → `||`, qui rend un `<span>` vide
    // sur chaque issue non étiquetée. Invisible à l'œil, faux à la structure —
    // et c'est exactement le genre de détail qui se met à compter le jour où
    // quelqu'un stylise le conteneur.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({
      depot: 'micka/ruche',
      issues: [issue(3, []), issue(5, ['bug', 'ui'])],
      tronque: false,
    });
    expect(compte('.pj-iss-etiq'), 'une seule issue est étiquetée').toBe(1);
    expect(texte()).toContain('bug · ui');
  });

  it('LA TRONCATURE NE SE SIGNALE QUE SI ELLE A LIEU', async () => {
    // Mutant tué : `tronque &&` → `||`. Annoncer « liste tronquée » sur une
    // liste complète, c'est envoyer chercher sur GitHub des issues qui sont
    // déjà là — un mensonge dans le sens inquiétant.
    await monter(<IssuesProjet project={PROJET} />);
    await cliquer('voir les issues');
    await dernierAppel().repondre({ depot: 'micka/ruche', issues: [issue(3, [])], tronque: false });
    expect(texte()).not.toContain('Liste tronquée');

    await cliquer('relire');
    await dernierAppel().repondre({ depot: 'micka/ruche', issues: [issue(3, [])], tronque: true });
    expect(texte()).toContain('Liste tronquée');
  });

  it('SANS DÉPÔT, le panneau n’existe pas du tout', async () => {
    await monter(<IssuesProjet project={{ ...PROJET, repoUrl: null }} />);
    expect(conteneur.innerHTML, 'proposer un bouton qui ne peut que refuser').toBe('');
  });
});

describe('LE PANNEAU DES LIVRAISONS', () => {
  const DEUX = [
    livraison('t-rouge', 11, { etat: 'ci_rouge', dit: 'CI en échec', reprenable: true }),
    livraison('t-verte', 12, { etat: 'approuvee', dit: 'approuvée', reprenable: false }),
  ];

  it('REPRENDRE n’est offert que sur ce qui se reprend', async () => {
    await monter(<LivraisonsProjet project={PROJET} />);
    await cliquer('voir les livraisons');
    await dernierAppel().repondre({ livraisons: DEUX });

    expect(compte('.pj-liv-liste li')).toBe(2);
    expect(boutons().filter((b) => b.textContent?.trim() === 'reprendre')).toHaveLength(1);
  });

  it('PENDANT UNE REPRISE, l’essaim ne peut pas être lancé deux fois', async () => {
    // Même mutant que côté issues (`enCours !== null`), même conséquence en
    // pire : reprendre fait TRAVAILLER l'essaim, pas seulement lire.
    await monter(<LivraisonsProjet project={PROJET} />);
    await cliquer('voir les livraisons');
    await dernierAppel().repondre({
      livraisons: [
        DEUX[0] as LivraisonVue,
        livraison('t-conflit', 13, { etat: 'en_conflit', dit: 'en conflit', reprenable: true }),
      ],
    });

    expect(
      boutons().filter((b) => b.disabled),
      'au repos, rien n’est verrouillé',
    ).toHaveLength(0);

    await cliquer('reprendre');
    expect(
      boutons().filter((b) => b.textContent?.trim() === 'reprendre' && !b.disabled),
    ).toHaveLength(0);
    expect(
      boutons()
        .map((b) => b.textContent?.trim())
        .filter((l) => l === '…'),
      'seule la ligne reprise dit « … »',
    ).toHaveLength(1);
  });

  it('une reprise réussie RELIT la liste — l’état a changé sur GitHub', async () => {
    // `reprendre` rappelle `charger()` : sans ça, l'écran garderait « CI en
    // échec » sur une livraison qu'on vient de remettre au travail.
    await monter(<LivraisonsProjet project={PROJET} />);
    await cliquer('voir les livraisons');
    await dernierAppel().repondre({ livraisons: [DEUX[0] as LivraisonVue] });
    await cliquer('reprendre');

    const poste = dernierAppel();
    expect(poste.methode, 'reprendre est un geste, pas une lecture').toBe('POST');
    await poste.repondre({ tache: { id: 't-rouge-2', title: 'corriger la CI' } });

    const relecture = dernierAppel();
    expect(relecture.url, 'la liste doit être relue').toMatch(/\/livraisons$/);
    expect(relecture.methode).toBe('GET');
    await relecture.repondre({ livraisons: [DEUX[0] as LivraisonVue] });
    expect(texte()).toContain('corriger la CI');
  });

  it('AUCUNE LIVRAISON le dit — et une liste pleine ne le dit pas', async () => {
    await monter(<LivraisonsProjet project={PROJET} />);
    await cliquer('voir les livraisons');
    await dernierAppel().repondre({ livraisons: [] });
    expect(texte()).toContain('Aucune pull request ouverte par la ruche.');

    await cliquer('relire');
    await dernierAppel().repondre({ livraisons: DEUX });
    expect(texte()).not.toContain('Aucune pull request ouverte');
  });

  it('UNE PULL REQUEST ILLISIBLE LE DIT, au lieu de passer pour calme', async () => {
    // Une ligne muette laisserait croire qu'il ne se passe rien, alors qu'on
    // n'a pas pu regarder. C'est le pire des deux mensonges possibles.
    await monter(<LivraisonsProjet project={PROJET} />);
    await cliquer('voir les livraisons');
    await dernierAppel().repondre({
      livraisons: [livraison('t-noir', 14, { illisible: 'GitHub a répondu 502' })],
    });
    expect(texte()).toContain('⚠ GitHub a répondu 502');
    expect(boutons().filter((b) => b.textContent?.trim() === 'reprendre')).toHaveLength(0);
  });

  it('SANS DÉPÔT, le panneau n’existe pas du tout', async () => {
    await monter(<LivraisonsProjet project={{ ...PROJET, repoUrl: null }} />);
    expect(conteneur.innerHTML).toBe('');
  });
});
