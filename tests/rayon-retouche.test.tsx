// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE RAYON — la retouche : ce qu'elle promet, et ce qu'elle refuse.
//
// ─── CE QUI ÉTAIT DÉJÀ GARDÉ ─────────────────────────────────────────────────
//
// Recensement sur les DEUX racines (§ 9 quattuortrigicenties). `vues-sentinelles`
// tient quatre cas du Rayon — le `repoUrl` lavé de ses identifiants, les enfants
// d'un dossier déplié, la classe `active` de l'entrée ouverte, et l'absence
// d'avertissement au repos. Non rejoués ici.
//
// Zéro cas, sur aucune racine, pour : `ry-geste`, « Proposer une retouche »,
// `ry-note`, `ry-propose`, `ry-invite`, `ry-cadre`.
//
// Crible : les six mutants posés ensemble, chacun vérifié posé, suite ENTIÈRE
// verte — 291 fichiers, 4 197 tests. Vert, un lot conclut pour tous d'un coup
// (§ 9 septentrigicenties) : les six étaient nus.
//
// ─── LE FICHIER ÉNONCE SA DOCTRINE EN TÊTE, ET RIEN NE LA JOUAIT ─────────────
//
//     « LA LECTURE EST LE DÉFAUT, ET L'ÉCRITURE N'EN EST PAS UNE. […] ce qu'on
//       voit est le MIROIR du dépôt — un clone jetable — et rien ne s'y écrit
//       jamais. »
//
//     « UN PORTEUR DE LIEN LIT, IL NE FABRIQUE PAS DE TRAVAIL pour l'essaim de
//       quelqu'un d'autre. Le serveur le refuse déjà — la retouche exige un
//       COMPTE — mais proposer un bouton voué au 401 est une promesse qu'on ne
//       tient pas. »
//
//     « Changer de fichier abandonne la retouche en cours : la garder
//       appliquerait le texte d'un fichier à un autre. »
//
// Le CINQUIÈME lot de suite où la garde nue est celle qu'un commentaire décrit
// mot pour mot (§ 9 sexvicicenties). Ce n'est plus une coïncidence : un auteur
// qui prend la peine d'écrire POURQUOI une ligne existe est un auteur qui a vu
// le danger — et s'est arrêté à la phrase.
//
// ─── CE QUI ÉTAIT NU ─────────────────────────────────────────────────────────
//
//     {parPartage ? null : …}            →  {!parPartage ? null : …}
//     setRetouche(null) dans `ouvrir`    →  retiré
//     editable={retouche !== null}       →  editable={true}
//     value={retouche ? … : contenu}     →  value={fichier.contenu}
//     setDossiers({}) au changement      →  retiré
//     avant: contenu / apres: texte      →  échangés

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { EntreeRayon, FichierRayon } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

/** Ce que la frappe simulée écrit dans l'éditeur. */
const FRAPPE = 'le miel RETOUCHÉ';

// L'éditeur est CodeMirror : il demande une vraie mise en page, que happy-dom
// n'a pas. On le remplace par un TÉMOIN qui rend ses propriétés et sait
// rappeler `onChange` — c'est exactement ce qu'on éprouve : ce que le Rayon lui
// passe, et ce qu'il fait de ce qui remonte.
vi.mock('../dashboard/src/CodeEditor', () => ({
  default: ({
    value,
    editable,
    onChange,
  }: {
    value: string;
    editable?: boolean;
    onChange?: (t: string) => void;
  }) => (
    <div data-editeur="1" data-editable={String(editable ?? false)}>
      <span data-valeur="1">{value}</span>
      <button data-frapper="1" onClick={() => onChange?.(FRAPPE)}>
        frapper
      </button>
    </div>
  ),
}));

// Les CINQ sondes de la vue sont bouchées, pas seulement celles qu'on met en
// scène : un bouchon partiel laisse partir au réseau tout ce qu'on n'a pas
// nommé (§ 9 duotrigicenties).
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getPartage: vi.fn(() => null),
  fetchRayon: vi.fn(() => Promise.resolve({ chemin: '', entrees: [] })),
  fetchFichierRayon: vi.fn(),
  fetchApercu: vi.fn(() => Promise.resolve(null)),
  proposerRetouche: vi.fn(),
}));

import {
  fetchApercu,
  fetchFichierRayon,
  fetchRayon,
  getPartage,
  proposerRetouche,
} from '../dashboard/src/api';
import Rayon from '../dashboard/src/views/Rayon';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const entree = (chemin: string, taille: number): EntreeRayon =>
  ({ chemin, nom: chemin.split('/').pop(), type: 'fichier', taille }) as never;

const dossier = (chemin: string): EntreeRayon =>
  ({ chemin, nom: chemin, type: 'dossier', taille: 0 }) as never;

/**
 * Deux dépôts distincts, et le MÊME nom de dossier dans les deux.
 *
 * Ce n'est pas une coquetterie : c'est ce qui rend la remise à zéro
 * observable. Voir le cas du changement de projet.
 */
const ARBRE: Record<string, Record<string, EntreeRayon[]>> = {
  'p-nord': {
    '': [dossier('alveoles'), entree('miel.txt', 12), entree('propolis.txt', 9)],
    alveoles: [entree('alveoles/couvain.ts', 5)],
  },
  'p-sud': {
    '': [dossier('alveoles'), entree('cire.txt', 8)],
    alveoles: [entree('alveoles/gelee.ts', 7)],
  },
};

/** Le contenu de chaque fichier, par chemin. */
const CONTENUS: Record<string, string> = {
  'miel.txt': 'le miel d’origine',
  'propolis.txt': 'la propolis d’origine',
  'cire.txt': 'la cire d’origine',
};

const fichier = (chemin: string): FichierRayon => ({
  chemin,
  contenu: CONTENUS[chemin] ?? '',
  langage: 'text',
  taille: 12,
  tronque: false,
});

beforeEach(() => {
  setLang('fr');
  vi.mocked(getPartage)
    .mockReset()
    .mockReturnValue(null as never);
  vi.mocked(fetchApercu)
    .mockReset()
    .mockResolvedValue(null as never);
  vi.mocked(proposerRetouche)
    .mockReset()
    .mockResolvedValue({ task: { id: 't-1', title: 'Retoucher miel.txt' } } as never);
  vi.mocked(fetchRayon)
    .mockReset()
    .mockImplementation(((projectId: string, chemin = '') =>
      Promise.resolve({ chemin, entrees: ARBRE[projectId]?.[chemin] ?? [] })) as never);
  vi.mocked(fetchFichierRayon)
    .mockReset()
    .mockImplementation(((_p: string, chemin: string) =>
      Promise.resolve(fichier(chemin))) as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

const projet = (id: string, name: string) =>
  ({ id, name, repoUrl: null, description: null, visibility: 'private' }) as never;

const PROJETS = [projet('p-nord', 'Rucher du nord'), projet('p-sud', 'Rucher du sud')];

function proprietes(selectedId: string): ViewProps {
  return {
    snapshot: {
      projects: PROJETS,
      nodes: [],
      tasks: [],
      tasksTotal: 0,
    } as unknown as StateSnapshot,
    events: [],
    agentsByTask: {},
    deferred: new Set(),
    selectedId,
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
  } as unknown as ViewProps;
}

async function monter(selectedId = 'p-nord'): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Rayon {...proprietes(selectedId)} />));
  await act(async () => {});
  return conteneur;
}

/** Rerend la MÊME vue sur un autre projet — ce que fait le sélecteur. */
async function changerDeProjet(selectedId: string): Promise<void> {
  await act(async () => racine?.render(<Rayon {...proprietes(selectedId)} />));
  await act(async () => {});
}

async function cliquer(el: HTMLElement): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Déplie un dossier de l'arbre — même geste, autre conséquence. */
const ouvrirDossier = (dom: HTMLElement, nom: string): Promise<void> => ouvrirFichier(dom, nom);

/** Clique l'entrée d'arbre portant ce nom. */
async function ouvrirFichier(dom: HTMLElement, nom: string): Promise<void> {
  const e = [...dom.querySelectorAll<HTMLElement>('.ry-entree')].find((b) =>
    (b.textContent ?? '').includes(nom),
  );
  if (!e) throw new Error(`l’entrée « ${nom} » est introuvable dans l’arbre`);
  await cliquer(e);
}

/** Le bouton dont le libellé contient ce texte. */
const bouton = (dom: HTMLElement, texte: string): HTMLElement | undefined =>
  [...dom.querySelectorAll<HTMLElement>('button')].find((b) =>
    (b.textContent ?? '').includes(texte),
  );

/**
 * Le bouton, ou un ÉCHEC LISIBLE s'il manque.
 *
 * Sans cette garde, un mutant qui fait disparaître le bouton tue les cas par
 * `TypeError: Cannot read properties of undefined` — un rouge qui ne prouve
 * que la capacité du banc à monter la vue (§ 9 quintrigicenties). Le verdict
 * doit nommer ce qui manque.
 */
function boutonSur(dom: HTMLElement, texte: string): HTMLElement {
  const b = bouton(dom, texte);
  if (!b) throw new Error(`le bouton « ${texte} » n’est pas à l’écran`);
  return b;
}

const editable = (dom: HTMLElement): string | null =>
  dom.querySelector('[data-editeur]')?.getAttribute('data-editable') ?? null;

const valeur = (dom: HTMLElement): string | null =>
  dom.querySelector('[data-valeur]')?.textContent ?? null;

/** Simule une frappe dans l'éditeur : c'est `onChange` qui remonte au Rayon. */
async function frapper(dom: HTMLElement): Promise<void> {
  const b = dom.querySelector<HTMLElement>('[data-frapper]');
  if (!b) throw new Error('l’éditeur témoin est introuvable');
  await cliquer(b);
}

/** Écrit dans le champ CONTRÔLÉ par React : le mutateur natif, jamais `.value`. */
function saisir(champ: HTMLInputElement, texte: string): void {
  const poser = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set as (
    v: string,
  ) => void;
  poser.call(champ, texte);
  champ.dispatchEvent(new Event('input', { bubbles: true }));
}

/** Ouvre un fichier et entre en retouche. */
async function retoucher(dom: HTMLElement, nom: string): Promise<void> {
  await ouvrirFichier(dom, nom);
  await cliquer(boutonSur(dom, 'Proposer une retouche'));
}

describe('le Rayon : la lecture est le défaut, l’écriture n’en est pas une', () => {
  it('UN FICHIER S’OUVRE EN LECTURE — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const dom = await monter();
    await ouvrirFichier(dom, 'miel.txt');

    expect(valeur(dom), 'le contenu du fichier n’est pas rendu').toBe('le miel d’origine');
    expect(editable(dom), 'l’éditeur s’ouvre modifiable — la lecture n’est plus le défaut').toBe(
      'false',
    );
    expect(bouton(dom, 'Proposer une retouche'), 'le geste de retouche est absent').toBeTruthy();
  });

  it('LA RETOUCHE OUVRE L’ÉDITEUR, ET CE QU’ON TAPE S’AFFICHE', async () => {
    // Les deux moitiés du même geste, et deux mutants distincts.
    //
    // · `editable={true}` ouvrirait un miroir modifiable en permanence : on
    //   taperait dans un clone jetable où rien ne s'écrit, sans l'avoir demandé.
    // · `value={fichier.contenu}` ferait pire — le champ ne montrerait pas ce
    //   qu'on tape. Un éditeur qui avale les frappes.
    const dom = await monter();
    await retoucher(dom, 'miel.txt');

    expect(editable(dom), 'le geste de retouche ne rend pas l’éditeur modifiable').toBe('true');
    expect(dom.textContent, 'le mode retouche ne se dit pas').toContain('retouche en cours');
    expect(bouton(dom, 'Proposer une retouche'), 'le geste reste offert deux fois').toBeFalsy();

    await frapper(dom);
    expect(valeur(dom), 'l’éditeur avale la frappe et réaffiche l’original').toBe(FRAPPE);
  });

  it('CHANGER DE FICHIER ABANDONNE LA RETOUCHE — pas le texte de l’un sur l’autre', async () => {
    // ─── LA GARDE QUE LE COMMENTAIRE DÉCRIT ────────────────────────────────
    //
    // « Changer de fichier abandonne la retouche en cours : la garder
    //   appliquerait le texte d'un fichier à un autre. »
    //
    // Sans elle, on retouche `miel.txt`, on clique `propolis.txt` par curiosité
    // — et la retouche du premier reste armée sur le second. Le geste suivant
    // propose le contenu de miel.txt COMME retouche de propolis.txt : un
    // écrasement complet, présenté comme un correctif.
    const dom = await monter();
    await retoucher(dom, 'miel.txt');
    await frapper(dom);
    expect(editable(dom), 'la retouche n’est pas armée avant le changement').toBe('true');

    await ouvrirFichier(dom, 'propolis.txt');

    expect(
      editable(dom),
      'la retouche survit au changement de fichier — le texte de l’un s’arme sur l’autre',
    ).toBe('false');
    expect(valeur(dom), 'le nouveau fichier n’affiche pas son propre contenu').toBe(
      'la propolis d’origine',
    );
    expect(
      bouton(dom, 'Proposer une retouche'),
      'le geste de retouche n’est pas rendu au nouveau fichier',
    ).toBeTruthy();
  });

  it('LE PORTEUR D’UN LIEN LIT — il ne fabrique pas de travail pour l’essaim', async () => {
    // Le serveur refuse déjà la retouche à qui n'a pas de compte. Mais offrir
    // un bouton voué au 401 est une promesse qu'on ne tient pas : la personne
    // tape sa retouche, appuie, et reçoit un refus après coup.
    //
    // Les DEUX mondes, dans deux montages : muté, ils s'échangent exactement,
    // et un banc qui n'en regarderait qu'un resterait vert.
    vi.mocked(getPartage).mockReturnValue('jeton-de-partage' as never);
    const partage = await monter();
    await ouvrirFichier(partage, 'miel.txt');

    expect(
      bouton(partage, 'Proposer une retouche'),
      'un porteur de lien se voit offrir un geste que le serveur lui refusera',
    ).toBeFalsy();
    expect(valeur(partage), 'le porteur de lien ne peut plus lire').toBe('le miel d’origine');

    act(() => racine?.unmount());
    conteneur?.remove();

    // Le contre-monde : un membre, lui, a le geste.
    vi.mocked(getPartage).mockReturnValue(null as never);
    const membre = await monter();
    await ouvrirFichier(membre, 'miel.txt');
    expect(
      bouton(membre, 'Proposer une retouche'),
      'un membre perd le geste de retouche',
    ).toBeTruthy();
  });

  it('CHANGER DE PROJET VIDE L’ARBRE — un SOUS-DOSSIER déplié ne survit pas au dépôt', async () => {
    // ─── LE SURVIVANT QUI A CORRIGÉ LE CAS (§ 2.16 ter) ────────────────────
    //
    // « Changer de projet remet tout à zéro : garder l'arbre du précédent
    // afficherait les fichiers d'un dépôt sous le nom d'un autre. »
    //
    // Premier cas écrit : monter le nord, basculer au sud, vérifier que
    // `miel.txt` a disparu. Le mutant a SURVÉCU — et il avait raison. Les deux
    // dépôts partagent la clé RACINE `''`, que le chargement du nouveau projet
    // ÉCRASE de toute façon : `miel.txt` s'en va tout seul, remise à zéro ou
    // pas. Le cas n'atteignait jamais la garde.
    //
    // Ce que la remise à zéro protège réellement, ce sont les clés que le
    // rechargement NE TOUCHE PAS : les sous-dossiers dépliés. D'où les deux
    // dépôts qui portent un dossier `alveoles` — même clé, contenus
    // différents. Sans le `setDossiers({})`, le sud affiche `couvain.ts`, un
    // fichier du nord, déjà déplié, sous le nom « Rucher du sud ».
    const dom = await monter('p-nord');
    await ouvrirDossier(dom, 'alveoles');
    expect(dom.textContent, 'le sous-dossier du nord n’est pas déplié').toContain('couvain.ts');

    await changerDeProjet('p-sud');

    expect(dom.textContent, 'la racine du sud n’est pas chargée').toContain('cire.txt');
    expect(
      dom.textContent,
      'un fichier du dépôt précédent survit dans un sous-dossier déplié, sous le nom d’un autre projet',
    ).not.toContain('couvain.ts');
    expect(dom.textContent, 'le sous-dossier reste déplié d’un dépôt à l’autre').not.toContain(
      'gelee.ts',
    );
  });

  it('LA TÂCHE PART DANS LE BON SENS — « avant » l’origine, « après » la retouche', async () => {
    // Échangés, la tâche décrit le mouvement INVERSE : l'ouvrière remplacerait
    // la retouche par le contenu d'origine. Le diff serait parfaitement bien
    // formé, appliqué sans erreur — et déferait exactement ce qu'on demandait.
    const dom = await monter();
    await retoucher(dom, 'miel.txt');
    await frapper(dom);

    const note = dom.querySelector<HTMLInputElement>('.ry-note');
    expect(note, 'le champ de note est introuvable').toBeTruthy();
    await act(async () => saisir(note!, '  parce que la cire a durci  '));

    await cliquer(boutonSur(dom, 'Envoyer à l’essaim'));

    const appel = vi.mocked(proposerRetouche).mock.calls[0];
    expect(appel, 'la retouche n’a pas été envoyée').toBeTruthy();
    expect(appel![0], 'la retouche part sur le mauvais projet').toBe('p-nord');
    expect(appel![1].chemin, 'le chemin du fichier manque').toBe('miel.txt');
    expect(
      appel![1].avant,
      '« avant » ne porte pas le contenu d’origine — le diff est inversé',
    ).toBe('le miel d’origine');
    expect(appel![1].apres, '« après » ne porte pas la retouche — le diff est inversé').toBe(
      FRAPPE,
    );
    expect(appel![1].note, 'la note n’est pas rognée de ses espaces').toBe(
      'parce que la cire a durci',
    );
    expect(dom.textContent, 'la tâche créée n’est pas annoncée').toContain('Retoucher miel.txt');
  });
});

// ─── L'APERÇU QUI REFUSE, ET CE QU'IL A LE DROIT DE RÉPÉTER ──────────────────
//
// Balayage de la loupe sur `Rayon.tsx`, base épinglée dans l'atelier
// (`LOUPE_BASE=f0fc005`) : 16 candidates, 8 examinées, UNE seule SANS TEST —
//
//     setApercuErreur(e instanceof Error ? e.message : String(e));
//
// Les trois points que les relances citent depuis des jours — `projets.find(…)
// ?? projets[0]`, `projets.length === 0`, `sandbox={apercu.sandbox}` — étaient
// dans la moitié LAISSÉE DE CÔTÉ. Mutés à la main contre la suite entière, ils
// sont TENUS (4 rouges, 11 rouges, 1 rouge). Mesuré, pas supposé.
//
// ─── POURQUOI CE TERNAIRE-CI SE TESTE, ALORS QUE CELUI DU PARTAGE S'EST RETIRÉ ─
//
// La même ligne, mot pour mot, existait dans `Partage.tsx` et a été SUPPRIMÉE
// plutôt que défendue. Ce n'est pas une incohérence, c'est la mesure qui diffère
// (§ 9 terquadragicenties) : là-bas la branche de refus rend un texte FIXE et la
// chaîne n'était affichée nulle part — calcul mort. Ici, `apercuErreur` est
// RENDU (`{apercuErreur && <p className="ry-erreur">⚠ {apercuErreur}</p>}`), donc
// le ternaire décide de ce qu'un lecteur voit, et il se départage.
describe('l’aperçu du Rayon quand il refuse', () => {
  it('LE MESSAGE D’UNE VRAIE ERREUR EST MONTRÉ — sinon le refus est muet', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ───────────────
    vi.mocked(fetchApercu).mockRejectedValue(new Error('aucun index.html à la racine'));
    const dom = await monter();

    await cliquer(boutonSur(dom, 'Aperçu'));

    expect(dom.textContent, 'le refus de l’aperçu ne dit rien').toContain(
      'aucun index.html à la racine',
    );
  });

  it('CE QUI N’EST PAS UNE ERREUR NE VOIT PAS SON « message » RECOPIÉ', async () => {
    // Le ternaire ne fait confiance à `.message` que sur un vrai `Error`. Mutée
    // en `instanceof Object`, la vue recopie le champ `message` de n'importe quel
    // objet jeté — y compris une réponse brute d'API, qui n'a aucune raison
    // d'être un texte destiné à l'utilisateur.
    //
    // Le marqueur est introuvable dans toute phrase légitime de l'écran
    // (§ 9 septquadragicenties) : le chercher dans le DOM ne peut accuser que la
    // recopie.
    vi.mocked(fetchApercu).mockRejectedValue({ message: 'FUITE-INTERNE-7f3a' });
    const dom = await monter();

    await cliquer(boutonSur(dom, 'Aperçu'));

    expect(
      dom.textContent,
      'le « message » d’un objet quelconque a été recopié à l’écran',
    ).not.toContain('FUITE-INTERNE-7f3a');
    // Et le refus reste DIT : se taire laisserait l'utilisateur devant un bouton
    // qui ne réagit pas.
    expect(dom.querySelector('.ry-erreur'), 'le refus n’est pas affiché du tout').not.toBeNull();
  });
});
