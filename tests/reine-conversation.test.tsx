// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA REINE : LE DIALOGUE AVEC LA RUCHE, ET CE QUI LE TIENT.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage COMPLET de la loupe sur `dashboard/src/views/Reine.tsx`, base
// épinglée dans l'atelier (`LOUPE_BASE=4b9c082`, 371 ajoutées / 0 retirée) :
//
//     24 mutation(s) possible(s), 24 examinée(s) — 7 défendues, 17 SANS TEST
//
// **Le pire ratio du terrain : 71 %.** Les vues balayées avant celle-ci rendaient
// entre 0 et 44 % de nues ; la Reine en rend plus des deux tiers. Elle n'avait
// aucun banc à elle — `vues-sentinelles` la monte au repos, ce qui n'éprouve ni
// l'envoi, ni la réponse, ni l'échec.
//
// Les 24 candidates ont été jouées EN ENTIER malgré les 24 > 16 du seuil que je
// m'étais donné, parce que § 9 quinquinquagicenties a mesuré ce qu'un échantillon
// coûte : la moitié de la Ruche regardée n'avait rendu qu'un tiers de ses nues.
//
// ─── LES SIX FAMILLES ────────────────────────────────────────────────────────
//
// A. LES SUGGESTIONS. `suggestions.length > 0 ? … : defaultSuggestions(t)` muté
//    en `>=` : la barre de suggestions devient VIDE au premier écran. Un arrivant
//    qui ne sait pas quoi demander à la Reine n'a plus rien à cliquer.
//
// B. LE PROJET. `askQueen(text, projectId || undefined)` muté en `&&` : le projet
//    choisi n'est PLUS envoyé. La Reine répond sur toute la ruche alors qu'on lui
//    a désigné un projet — et rien ne le dit à l'écran.
//
// C. LES SUGGESTIONS RENDUES. `res.suggestions && res.suggestions.length > 0`
//    muté : une réponse sans suggestion ÉCRASE celles qu'on avait.
//
// D. LE TRIAGE D'ERREUR. `e instanceof ChatHttpError && (e.status === 404 ||
//    e.status === 501)` porte TROIS mutants, et chacun ment autrement : une
//    panne serveur passe pour « pas encore déployé », un 404 passe pour une
//    panne, ou n'importe quel objet portant `status: 404` déclenche l'accueil
//    dégradé. Le quatrième, `e instanceof Error ? e.message : String(e)`, prête
//    le `message` d'un objet quelconque à l'écran.
//
// E. LE FIL. Six mutants sur l'affichage : le bouton « Effacer » au repos, l'état
//    vide, la couleur de bulle, la couronne, la bulle « la Reine réfléchit ».
//
// F. LE BOUTON D'ENVOI. `disabled={pending || draft.trim() === ''}` muté :
//    l'envoi devient cliquable à vide, ou mort alors qu'on a écrit.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reine from '../dashboard/src/views/Reine';
import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  setLang('fr');
  sessionStorage.clear();
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.unstubAllGlobals();
});

/**
 * Le canal `/api/chat` répond. `askQueen` parle au `fetch` GLOBAL — c'est lui
 * qu'on bouchonne, et pas `dashboard/src/api`, parce que la vue le dit en toutes
 * lettres : « ne pas toucher api.ts, endpoint en cours d'écriture ».
 */
function repond(corps: unknown, statut = 200): ReturnType<typeof vi.fn> {
  const faux = vi.fn(() =>
    Promise.resolve({
      ok: statut >= 200 && statut < 300,
      status: statut,
      json: () => Promise.resolve(corps),
    } as Response),
  );
  vi.stubGlobal('fetch', faux);
  return faux;
}

/** Le canal rejette — panne réseau, ou objet quelconque jeté par une frontière. */
function rejette(quoi: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.reject(quoi)),
  );
}

const INSTANTANE = {
  projects: [
    { id: 'p-rucher', name: 'Rucher' },
    { id: 'p-verger', name: 'Verger' },
  ],
  nodes: [],
  tasks: [],
  tasksTotal: 0,
} as unknown as StateSnapshot;

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: INSTANTANE,
    events: [],
    agentsByTask: {},
    deferred: new Set<string>(),
    onOpenTask: () => {},
    onNavigate: () => {},
    refreshTick: 0,
    user: null,
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Reine {...props} />));
  return conteneur;
}

/** Écrit dans la zone CONTRÔLÉE par React : le mutateur natif, jamais `.value`. */
function ecrire(dom: HTMLElement, texte: string): void {
  const zone = dom.querySelector<HTMLTextAreaElement>('textarea.rn-input');
  if (!zone) throw new Error('la zone de saisie est introuvable');
  const poser = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set as (
    v: string,
  ) => void;
  act(() => {
    poser.call(zone, texte);
    zone.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

const envoyer = (dom: HTMLElement): HTMLButtonElement => {
  const b = dom.querySelector<HTMLButtonElement>('button.rn-send');
  if (!b) throw new Error('le bouton d’envoi est introuvable');
  return b;
};

async function cliquer(el: Element): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
  await act(async () => {});
}

/** Les pastilles de suggestion — cadrées sur leur classe, jamais sur leur texte. */
const chips = (dom: HTMLElement): string[] =>
  [...dom.querySelectorAll('.rn-chip')].map((c) => c.textContent ?? '');

/** Les bulles du fil, dans l'ordre. */
const bulles = (dom: HTMLElement): HTMLElement[] => [
  ...dom.querySelectorAll<HTMLElement>('.rn-thread .rn-msg'),
];

/** Le texte du fil seul — l'en-tête et le composeur ont leurs propres phrases. */
const fil = (dom: HTMLElement): string => dom.querySelector('.rn-thread')?.textContent ?? '';

describe('A. les suggestions : la barre n’est jamais vide', () => {
  it('SANS SUGGESTION MÉMORISÉE, LES DÉFAUTS S’AFFICHENT', async () => {
    // ─── LA BORNE : EXACTEMENT ZÉRO SUGGESTION EN MÉMOIRE ──────────────────
    //
    // `length > 0` muté en `>= 0` est TOUJOURS vrai : la vue prendrait alors le
    // tableau vide, et l'arrivant n'aurait plus rien à cliquer. C'est le seul
    // état qui distingue les deux versions.
    const dom = await monter();
    expect(chips(dom).length, 'aucune suggestion proposée sur un premier écran').toBe(5);
    expect(chips(dom)[0], 'les suggestions par défaut ne sont pas dans la langue').toContain(
      'Où en est le projet',
    );
  });
});

describe('B. le projet choisi part avec la question', () => {
  it('UN PROJET DÉSIGNÉ EST ENVOYÉ — sinon la Reine répond à côté', async () => {
    // ─── LE CAS NOMINAL ────────────────────────────────────────────────────
    //
    // `projectId || undefined` muté en `&&` rend `undefined` dès qu'un projet
    // est choisi : le corps de la requête perd le projet, la Reine répond sur
    // toute la ruche, et rien à l'écran ne le signale.
    const faux = repond({ reply: 'tout va bien', source: 'live' });
    const dom = await monter();

    const select = dom.querySelector<HTMLSelectElement>('.rn-project select');
    if (!select) throw new Error('le sélecteur de projet est introuvable');
    const poser = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')?.set as (
      v: string,
    ) => void;
    act(() => {
      poser.call(select, 'p-verger');
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });

    ecrire(dom, 'où en est le verger ?');
    await cliquer(envoyer(dom));

    const corps = JSON.parse(String(faux.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(corps.projectId, 'le projet choisi n’est pas parti avec la question').toBe('p-verger');
  });

  it('SANS PROJET, LE CORPS N’EN PORTE AUCUN — l’autre côté', async () => {
    const faux = repond({ reply: 'tout va bien', source: 'live' });
    const dom = await monter();
    ecrire(dom, 'et la ruche entière ?');
    await cliquer(envoyer(dom));

    const corps = JSON.parse(String(faux.mock.calls[0]?.[1]?.body)) as Record<string, unknown>;
    expect(corps, 'un projet vide est envoyé quand même').not.toHaveProperty('projectId');
  });
});

describe('C. une réponse sans suggestion n’efface pas les précédentes', () => {
  it('DES SUGGESTIONS REÇUES REMPLACENT LES DÉFAUTS, PUIS SURVIVENT À UNE RÉPONSE VIDE', async () => {
    // ─── LA BORNE : UN TABLEAU DE SUGGESTIONS EXACTEMENT VIDE ──────────────
    //
    // Les deux mutants de cette ligne (`&& → ||` et `> → >=`) font passer le
    // tableau VIDE pour une vraie liste : les suggestions de la Reine sont
    // écrasées, et l'écran retombe sur les défauts au milieu d'une conversation.
    repond({ reply: 'premier mot', source: 'live', suggestions: ['Et le rucher ?', 'Et après ?'] });
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(chips(dom), 'les suggestions de la Reine ne remplacent pas les défauts').toEqual([
      'Et le rucher ?',
      'Et après ?',
    ]);

    // Seconde réponse, SANS suggestion : les précédentes doivent rester.
    repond({ reply: 'second mot', source: 'live', suggestions: [] });
    ecrire(dom, 'encore');
    await cliquer(envoyer(dom));

    expect(chips(dom), 'une réponse sans suggestion a écrasé les précédentes').toEqual([
      'Et le rucher ?',
      'Et après ?',
    ]);
  });
});

describe('D. le triage d’erreur dit la bonne panne', () => {
  it('UN 404 DONNE L’ACCUEIL DÉGRADÉ — le canal n’est pas encore ouvert', async () => {
    // ─── LE CAS NOMINAL DE LA BRANCHE « ABSENT » ───────────────────────────
    repond({ error: 'not found' }, 404);
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(fil(dom), 'un canal absent ne donne pas l’accueil dégradé').toContain(
      'pas encore réveillée',
    );
  });

  it('UN 500 N’EST PAS « PAS ENCORE DÉPLOYÉ » — c’est une panne, et elle se dit', async () => {
    // `&& → ||` muté : n'importe quelle erreur devient « absent », et une ruche
    // en panne serveur affiche un message d'accueil rassurant. L'hôte attendrait
    // une ouverture qui a déjà eu lieu.
    repond({ message: 'la ruche a trébuché' }, 500);
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(fil(dom), 'une panne 500 passe pour un canal non déployé').not.toContain(
      'pas encore réveillée',
    );
    expect(fil(dom), 'la panne ne dit pas ce qui a échoué').toContain('la ruche a trébuché');
  });

  it('UN 501 AUSSI DONNE L’ACCUEIL DÉGRADÉ — l’autre moitié du OU', async () => {
    // `|| → &&` muté : plus aucun statut ne satisfait les deux à la fois, et le
    // canal non déployé s'annonce comme une panne.
    repond({ error: 'not implemented' }, 501);
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(fil(dom), 'un 501 ne donne pas l’accueil dégradé').toContain('pas encore réveillée');
  });

  it('UN OBJET QUELCONQUE PORTANT `status: 404` N’EST PAS UN CANAL ABSENT', async () => {
    // `instanceof ChatHttpError → instanceof Object` : n'importe quoi portant un
    // `status` déclencherait l'accueil dégradé. Seule l'erreur FABRIQUÉE par
    // `askQueen` sait de quoi elle parle.
    rejette({ status: 404, message: 'trace-interne-9f2b' });
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(fil(dom), 'un objet quelconque déclenche l’accueil dégradé').not.toContain(
      'pas encore réveillée',
    );
  });

  it('UN REJET QUI N’EST PAS UNE ERREUR NE PRÊTE PAS SON `message`', async () => {
    // `instanceof Error → instanceof Object` : le champ `message` d'un objet
    // quelconque serait lu et rendu — un champ que personne n'a écrit pour être
    // lu par un humain.
    rejette({ status: 500, message: 'trace-interne-9f2b' });
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(fil(dom), 'le `message` d’un objet quelconque est rendu à l’écran').not.toContain(
      'trace-interne-9f2b',
    );
    expect(fil(dom), 'l’échec ne se dit pas du tout').toContain('n’a pas pu répondre');
  });
});

describe('E. le fil montre qui parle, et dans quel état', () => {
  it('AU REPOS : l’état vide, aucun « Effacer », aucune bulle', async () => {
    // ─── LA BORNE : EXACTEMENT ZÉRO MESSAGE ────────────────────────────────
    //
    // Trois mutants vivent ici. `messages.length > 0 &&` muté en `>=` ou en `||`
    // pose un bouton « Effacer » sur une conversation qui n'existe pas ;
    // `messages.length === 0` muté en `!==` retire l'invitation au moment précis
    // où elle sert.
    const dom = await monter();

    expect(fil(dom), 'l’invitation du premier écran ne se rend pas').toContain('la Reine écoute');
    expect(dom.querySelector('.rn-clear'), 'un « Effacer » sur une page vierge').toBeNull();
    expect(bulles(dom).length, 'des bulles sans conversation').toBe(0);
  });

  it('APRÈS UN ÉCHANGE : « Effacer » apparaît, l’invitation s’efface', async () => {
    repond({ reply: 'je vous écoute', source: 'llm' });
    const dom = await monter();
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(
      dom.querySelector('.rn-clear'),
      'pas de « Effacer » sur une conversation',
    ).not.toBeNull();
    expect(fil(dom), 'l’invitation reste alors qu’on a parlé').not.toContain('la Reine écoute');
  });

  it('LA BULLE DE L’HÔTE ET CELLE DE LA REINE NE SE RESSEMBLENT PAS', async () => {
    // `m.role === 'user' ? 'rn-user' : 'rn-queen'` muté : les deux voix
    // échangent leur habit. On ne saurait plus qui a dit quoi — sur un écran
    // dont c'est l'unique fonction.
    repond({ reply: 'bonjour à vous', source: 'live' });
    const dom = await monter();
    ecrire(dom, 'ma question');
    await cliquer(envoyer(dom));

    const [premiere, seconde] = bulles(dom);
    expect(premiere?.className, 'la question de l’hôte ne porte pas son habit').toContain(
      'rn-user',
    );
    expect(seconde?.className, 'la réponse de la Reine ne porte pas le sien').toContain('rn-queen');
  });

  it('SEULE LA REINE PORTE LA COURONNE', async () => {
    // `m.role === 'queen' &&` porte deux mutants (`&&→||`, `===→!==`) : la
    // couronne passerait sur les messages de l'hôte, ou quitterait ceux de la
    // Reine.
    repond({ reply: 'bonjour à vous', source: 'live' });
    const dom = await monter();
    ecrire(dom, 'ma question');
    await cliquer(envoyer(dom));

    const [premiere, seconde] = bulles(dom);
    expect(premiere?.querySelector('.rn-avatar'), 'l’hôte porte la couronne').toBeNull();
    expect(
      seconde?.querySelector('.rn-avatar'),
      'la Reine ne porte pas la couronne',
    ).not.toBeNull();
  });

  it('LA BULLE « LA REINE RÉFLÉCHIT » N’EXISTE QUE PENDANT L’ATTENTE', async () => {
    // `{pending && (` muté en `||` : la bulle de réflexion serait là EN
    // PERMANENCE, y compris sur une page vierge. Un écran qui réfléchit toujours
    // ne dit plus jamais qu'il réfléchit.
    const dom = await monter();
    expect(dom.querySelector('.rn-thinking'), 'la Reine réfléchit au repos').toBeNull();

    // On tient la réponse en suspens pour observer l'attente elle-même.
    let libere: (v: unknown) => void = () => {};
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise((r) => (libere = r))),
    );
    ecrire(dom, 'bonjour');
    await cliquer(envoyer(dom));

    expect(dom.querySelector('.rn-thinking'), 'aucune bulle pendant l’attente').not.toBeNull();

    await act(async () => {
      libere({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ reply: 'là', source: 'live' }),
      });
    });
    await act(async () => {});
    expect(dom.querySelector('.rn-thinking'), 'la bulle reste après la réponse').toBeNull();
  });
});

describe('F. le bouton d’envoi suit ce qu’on a écrit', () => {
  it('À VIDE IL EST MORT, ÉCRIT IL EST VIF', async () => {
    // ─── LA BORNE : UNE SAISIE EXACTEMENT VIDE ─────────────────────────────
    //
    // `pending || draft.trim() === ''` porte deux mutants : `|| → &&` rend le
    // bouton cliquable sur du vide (une question vide part à la Reine), et
    // `=== → !==` le tue dès qu'on a écrit quelque chose.
    const dom = await monter();
    expect(envoyer(dom).disabled, 'le bouton est vif sur une saisie vide').toBe(true);

    ecrire(dom, '   ');
    expect(envoyer(dom).disabled, 'trois espaces suffisent à réveiller le bouton').toBe(true);

    ecrire(dom, 'une vraie question');
    expect(envoyer(dom).disabled, 'le bouton reste mort alors qu’on a écrit').toBe(false);
  });
});
