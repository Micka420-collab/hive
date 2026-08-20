// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA TOUCHE ENTRÉE DE LA REINE — quatre conditions, aucune défendue.
//
// ─── CE QUE CE BANC GARDE, ET POURQUOI ÇA COMPTE ─────────────────────────────
//
// `Reine.tsx` n'était vu que par une sentinelle de badges : elle vérifie qu'une
// réponse calculée ne se pare pas du plumage du modèle. Tout le reste de la vue
// — c'est-à-dire tout ce qu'on y FAIT — était nu.
//
// La garde la plus chargée est celle-ci :
//
//     e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing &&
//     e.nativeEvent.keyCode !== 229
//
// Quatre conditions sur une ligne, et deux d'entre elles ne protègent PERSONNE
// dans l'équipe qui les a écrites : `isComposing` et le `keyCode 229` existent
// pour les langues à composition — japonais, chinois, coréen. Quand on y tape,
// la touche Entrée sert d'abord à VALIDER le caractère qu'on est en train de
// composer. Mutée, cette Entrée-là envoie le message : la Reine reçoit une
// phrase à moitié écrite, et l'utilisateur voit partir ce qu'il n'a pas fini.
//
// Un défaut de cette famille ne se voit jamais chez celui qui l'introduit. Il ne
// se voit que chez quelqu'un dont on ne lit pas la langue.
//
// ─── CE QU'ON MESURE : LE MESSAGE QUI PART ───────────────────────────────────
//
// Pas l'état interne, pas le nombre de rendus : ce qui atteint `/api/chat`. Une
// garde de clavier ne se juge qu'à ça — le reste est de la décoration autour du
// seul fait qui compte.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { setLang } from '../dashboard/src/i18n';
import type { ViewProps } from '../dashboard/src/views/shared';
import Reine from '../dashboard/src/views/Reine';

/** Ce qui est réellement parti vers la Reine, dans l'ordre. */
let envois: string[] = [];
let conteneur: HTMLDivElement | null = null;
let racine: Root | null = null;
const vraiFetch = globalThis.fetch;

/** Laisse la réponse en suspens tant qu'on ne la résout pas — l'état « pending ». */
let relacher: ((v: unknown) => void) | null = null;

beforeEach(() => {
  // Le panneau rend en anglais par défaut sous vitest ; la langue est POSÉE,
  // sinon un banc qui cherche « Envoyer » y trouverait « Send » (mesuré une
  // fois, sur le panneau d'invitation).
  setLang('fr');
  envois = [];
  relacher = null;
  sessionStorage.clear();
  // `askQueen` est LOCAL à la vue et parle par `fetch` : on bouchonne donc le
  // réseau, pas un module. C'est aussi ce qui rend la mesure honnête — on
  // observe ce qui PART, pas ce que la vue croit avoir envoyé.
  //
  // ─── L'ATELIER MONTE AVEC LA REINE ────────────────────────────────────────
  //
  // `AtelierRecette` appelle `/api/atelier` au montage. Si on comptait TOUS les
  // fetch, son GET sans corps s'enregistrerait comme un envoi vide (`''`) et
  // ferait rougir chaque cas — mesuré sous les trois graines du tamis après
  // l'ajout de l'Atelier dans la vue. On ne compte donc que `/api/chat`.
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    const cible = typeof url === 'string' ? url : url instanceof URL ? url.href : url.url;
    if (!cible.includes('/api/chat')) {
      return Promise.resolve(
        new Response(JSON.stringify({ mode: 'off', actif: false }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );
    }
    const corps = JSON.parse(String(init?.body ?? '{}')) as { message?: string };
    envois.push(corps.message ?? '');
    return new Promise((resoudre) => {
      relacher = () =>
        resoudre(
          new Response(JSON.stringify({ reply: 'Tout va bien.', source: 'live' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
        );
    });
  }) as typeof fetch;
});

afterEach(() => {
  if (racine) act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  globalThis.fetch = vraiFetch;
  sessionStorage.clear();
});

async function monter(): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = { snapshot: { projects: [], nodes: [], tasks: [] } } as unknown as ViewProps;
  await act(async () => racine?.render(<Reine {...props} />));
  await act(async () => {});
  return document.body;
}

const zone = (dom: HTMLElement): HTMLTextAreaElement => {
  const ta = dom.querySelector<HTMLTextAreaElement>('textarea.rn-input');
  if (!ta) throw new Error('la zone de saisie de la Reine est introuvable');
  return ta;
};

// ─── POSER `.value` NE SUFFIT PAS, ET C'EST MESURÉ ───────────────────────────
//
// Le champ est CONTRÔLÉ par React. Écrire `ta.value = …` puis émettre un
// `input` ne déclenche pas `onChange` : React garde un traqueur de valeur sur
// le nœud, voit que sa dernière valeur connue est déjà celle-là, et conclut
// qu'il ne s'est rien passé.
//
// Mesuré sur la première version de ce banc : le cas NOMINAL rougissait —
// « une Entrée simple n'envoie rien » — et les trois cas négatifs passaient
// pour la mauvaise raison, puisque rien ne partait jamais. C'est exactement
// pourquoi le cas nominal est écrit en premier dans ce fichier.
//
// On passe donc par le mutateur natif du prototype, que le traqueur de React
// ne surveille pas : la valeur change VRAIMENT, et l'`input` qui suit est cru.
const poserValeur = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')
  ?.set as (v: string) => void;

/** Tape un brouillon comme le ferait un humain — par l'événement, pas par l'état. */
async function saisir(ta: HTMLTextAreaElement, texte: string): Promise<void> {
  await act(async () => {
    poserValeur.call(ta, texte);
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

/** Une frappe, avec exactement les attributs que la garde interroge. */
async function frapper(
  ta: HTMLTextAreaElement,
  init: KeyboardEventInit & { keyCode?: number } = {},
): Promise<void> {
  await act(async () => {
    ta.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
        ...init,
      } as KeyboardEventInit),
    );
  });
  await act(async () => {});
}

describe('la touche Entrée de la Reine', () => {
  it('ENTRÉE ENVOIE — sinon tout le reste de ce fichier ne mesure rien', async () => {
    // Une garde qui refuserait le cas normal serait retirée le lendemain. On
    // éprouve donc d'abord que le chemin nominal marche.
    const dom = await monter();
    const ta = zone(dom);
    await saisir(ta, 'Où en est le projet ?');
    await frapper(ta);

    expect(envois, 'une Entrée simple n’envoie rien').toEqual(['Où en est le projet ?']);
  });

  it('MAJ+ENTRÉE N’ENVOIE PAS — c’est une nouvelle ligne', async () => {
    // Mutée, écrire un message de deux lignes devient impossible : la première
    // moitié part dès qu'on veut passer à la ligne.
    const dom = await monter();
    const ta = zone(dom);
    await saisir(ta, 'Première ligne');
    await frapper(ta, { shiftKey: true });

    expect(envois, 'Maj+Entrée a envoyé le message').toEqual([]);
  });

  it('UNE ENTRÉE DE COMPOSITION N’ENVOIE PAS — la Reine est mondiale', async () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // En japonais, chinois ou coréen, la touche Entrée sert d'abord à VALIDER
    // le caractère en cours de composition. Mutée, cette Entrée-là envoie : la
    // Reine reçoit une phrase à moitié écrite, et l'utilisateur voit partir ce
    // qu'il n'avait pas fini d'écrire.
    //
    // Les DEUX formes sont éprouvées, parce que les navigateurs ne sont pas
    // d'accord : `isComposing` est la propriété normalisée, et `keyCode === 229`
    // est le repli — c'est ainsi que Safari signale une composition, et le
    // commentaire de la vue le dit déjà. Une garde qui n'aurait que l'une des
    // deux laisserait la moitié du monde derrière.
    const dom = await monter();
    const ta = zone(dom);

    await saisir(ta, 'にほんご');
    await frapper(ta, { isComposing: true });
    expect(envois, 'une validation IME a été prise pour un envoi').toEqual([]);

    await frapper(ta, { keyCode: 229 });
    expect(envois, 'le repli Safari (keyCode 229) a été pris pour un envoi').toEqual([]);

    // Et la composition TERMINÉE, elle, envoie : la garde protège, elle ne
    // bloque pas. Sans ce dernier geste, une garde qui refuserait TOUJOURS
    // passerait ce cas — et laisserait le japonais sans Reine du tout.
    await frapper(ta);
    expect(envois, 'la composition finie n’envoie plus rien du tout').toEqual(['にほんご']);
  });

  it('UNE AUTRE TOUCHE N’ENVOIE PAS', async () => {
    const dom = await monter();
    const ta = zone(dom);
    await saisir(ta, 'Bonjour');
    await frapper(ta, { key: 'a' });

    expect(envois, 'une touche ordinaire envoie le message').toEqual([]);
  });
});

describe('la garde d’envoi — `if (!text || pending) return`', () => {
  it('UN BROUILLON VIDE N’ENVOIE RIEN, MÊME AVEC DES ESPACES', async () => {
    // Mutée en `&&`, un brouillon vide part : la Reine reçoit une question
    // vide, et l'utilisateur une réponse à rien.
    const dom = await monter();
    const ta = zone(dom);
    await saisir(ta, '   ');
    await frapper(ta);

    expect(envois, 'un brouillon d’espaces a été envoyé').toEqual([]);
  });

  it('ON N’ENVOIE PAS DEUX FOIS PENDANT QUE LA REINE RÉPOND', async () => {
    // ─── LE MUTANT QUE CE CAS TUE ──────────────────────────────────────────
    //
    //     if (!text || pending) return;      mutée en `&&`
    //
    // Mutée, une deuxième Entrée pendant que la Reine réfléchit part QUAND
    // MÊME : deux questions, deux réponses, et un fil de discussion où l'ordre
    // n'a plus de sens. C'est le geste le plus banal de l'impatience.
    //
    // Le monde « la Reine réfléchit encore » se fabrique sans horloge : la
    // réponse reste en suspens tant qu'on ne la relâche pas.
    const dom = await monter();
    const ta = zone(dom);

    await saisir(ta, 'Première question');
    await frapper(ta);
    expect(envois).toEqual(['Première question']);

    // La réponse n'est pas revenue. On retape et on renvoie.
    await saisir(ta, 'Deuxième question');
    await frapper(ta);
    expect(envois, 'une deuxième question est partie pendant la première').toEqual([
      'Première question',
    ]);

    // La Reine répond enfin — et l'écran redevient disponible.
    await act(async () => {
      relacher?.(null);
      await Promise.resolve();
    });
    await act(async () => {});

    await saisir(ta, 'Troisième question');
    await frapper(ta);
    expect(envois, 'l’écran reste bloqué après la réponse').toEqual([
      'Première question',
      'Troisième question',
    ]);
  });
});
