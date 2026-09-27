// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE FOCUS GARDÉ DANS UN DIALOGUE — et un seul dialogue qui écoute à la fois.
//
// ─── CE QUE `useDialog` NE FAISAIT PAS ───────────────────────────────────────
//
// Il faisait entrer le focus, fermait sur Échap et rendait le focus au
// déclencheur (`tests/modales-focus.test.tsx`). Mais la touche Tab, arrivée au
// dernier bouton, SORTAIT du dialogue : elle repartait dans la barre de
// navigation cachée sous le voile, alors que `aria-modal="true"` venait
// d'annoncer au lecteur d'écran que la page était hors d'atteinte.
//
// Et deux dialogues empilés posaient chacun leur écouteur sur `window` : un
// Échap les fermait TOUS LES DEUX.
//
// ─── CE QUE CE BANC NE PEUT PAS FAIRE ────────────────────────────────────────
//
// happy-dom ne déplace pas le focus sur une touche Tab SIMULÉE : un Tab que le
// crochet laisse passer ne bouge donc rien ici, là où un navigateur avancerait
// d'un élément. On juge ce que le crochet DÉCIDE — reboucler ou laisser faire
// (`defaultPrevented`) — et où il pose le focus quand il reboucle.

import { act, useState } from 'react';
import type { ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchInvite: vi.fn(),
}));

import { fetchInvite } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';
import { InvitePanel } from '../dashboard/src/InvitePanel';
import { useDialog } from '../dashboard/src/ui';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => setLang('fr'));

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

function monter(ui: ReactNode): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine?.render(ui));
  return conteneur;
}

function Dialogue({
  nom,
  onClose,
  children,
}: {
  nom: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useDialog<HTMLDivElement>(onClose);
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={nom} tabIndex={-1}>
      {children}
    </div>
  );
}

/** Une touche, tapée là où est le focus ; rend `true` si le crochet l'a prise. */
function taper(touche: 'Tab' | 'Escape', maj = false): boolean {
  const cible = document.activeElement ?? document.body;
  const ev = new KeyboardEvent('keydown', {
    key: touche,
    shiftKey: maj,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    cible.dispatchEvent(ev);
  });
  return ev.defaultPrevented;
}

const par = (dom: ParentNode, libelle: string): HTMLElement => {
  const el = [...dom.querySelectorAll<HTMLElement>('button, summary')].find(
    (b) => b.textContent === libelle,
  );
  expect(el, `« ${libelle} » introuvable`).toBeTruthy();
  return el as HTMLElement;
};

const focaliser = (el: HTMLElement): void => act(() => el.focus());

describe('Tab reste dans le dialogue', () => {
  const page = () => (
    <>
      <button>derrière le voile</button>
      <Dialogue nom="fiche" onClose={() => {}}>
        <button>premier</button>
        <button>milieu</button>
        <button>dernier</button>
      </Dialogue>
    </>
  );

  it('TAB DEPUIS LE DERNIER REVIENT AU PREMIER', () => {
    const dom = monter(page());
    focaliser(par(dom, 'dernier'));
    expect(taper('Tab'), 'le Tab du bord n’est pas repris').toBe(true);
    expect(document.activeElement?.textContent).toBe('premier');
  });

  it('MAJ+TAB DEPUIS LE PREMIER REPART DU DERNIER', () => {
    const dom = monter(page());
    focaliser(par(dom, 'premier'));
    expect(taper('Tab', true)).toBe(true);
    expect(document.activeElement?.textContent).toBe('dernier');
  });

  it('AU MILIEU, LE NAVIGATEUR AVANCE TOUT SEUL — le crochet ne s’en mêle pas', () => {
    const dom = monter(page());
    focaliser(par(dom, 'milieu'));
    expect(taper('Tab'), 'un Tab ordinaire est détourné').toBe(false);
    expect(taper('Tab', true)).toBe(false);
  });

  it('UN FOCUS QUI S’EST ÉCHAPPÉ EST RAMENÉ DEDANS', () => {
    const dom = monter(page());
    focaliser(par(dom, 'derrière le voile'));
    expect(taper('Tab')).toBe(true);
    expect(document.activeElement?.textContent).toBe('premier');
  });

  it('LE BORD EST CE QUE TAB ATTEINT — pas un bouton éteint, caché ou replié', () => {
    // Après « visible » : un bouton éteint, un caché, un inerte, et un
    // `<details>` FERMÉ dont seul le `<summary>` se tabule. Le dernier arrêt
    // réel est donc « plus d'options » : c'est de lui que Tab doit reboucler.
    const dom = monter(
      <Dialogue nom="fiche" onClose={() => {}}>
        <button>visible</button>
        <button disabled>éteint</button>
        <button hidden>caché</button>
        <div inert>
          <button>inerte</button>
        </div>
        <details>
          <summary>plus d’options</summary>
          <button>replié</button>
        </details>
      </Dialogue>,
    );
    focaliser(par(dom, 'plus d’options'));
    expect(taper('Tab'), 'Tab sortirait du dialogue depuis le résumé').toBe(true);
    expect(document.activeElement?.textContent).toBe('visible');

    focaliser(par(dom, 'visible'));
    expect(taper('Tab', true)).toBe(true);
    expect(document.activeElement?.textContent, 'Maj+Tab vise un élément que Tab saute').toBe(
      'plus d’options',
    );
  });

  it('UN TAB DÉJÀ PRIS PAR L’ÉLÉMENT (un éditeur qui indente) N’EST PAS DÉTOURNÉ', () => {
    const dom = monter(
      <Dialogue nom="éditeur" onClose={() => {}}>
        <button>premier</button>
        <button
          onKeyDown={(e) => {
            if (e.key === 'Tab') e.preventDefault();
          }}
        >
          éditeur
        </button>
      </Dialogue>,
    );
    focaliser(par(dom, 'éditeur'));
    taper('Tab');
    expect(document.activeElement?.textContent, 'le Tab de l’éditeur a été volé').toBe('éditeur');
  });
});

describe('deux dialogues empilés : seul celui du dessus écoute', () => {
  function Pile({ fermer1, fermer2 }: { fermer1: () => void; fermer2: () => void }) {
    const [second, setSecond] = useState(false);
    return (
      <Dialogue nom="dessous" onClose={fermer1}>
        <button onClick={() => setSecond(true)}>ouvrir le second</button>
        <button>dessous-fin</button>
        {second && (
          <Dialogue
            nom="dessus"
            onClose={() => {
              fermer2();
              setSecond(false);
            }}
          >
            <button>dessus-début</button>
            <button>dessus-fin</button>
          </Dialogue>
        )}
      </Dialogue>
    );
  }

  it('TAB BOUCLE DANS LE DESSUS, ÉCHAP NE FERME QUE LUI', () => {
    const fermer1 = vi.fn();
    const fermer2 = vi.fn();
    const dom = monter(<Pile fermer1={fermer1} fermer2={fermer2} />);
    act(() => par(dom, 'ouvrir le second').click());

    focaliser(par(dom, 'dessus-fin'));
    expect(taper('Tab')).toBe(true);
    expect(document.activeElement?.textContent, 'le dialogue du dessous a repris le focus').toBe(
      'dessus-début',
    );

    taper('Escape');
    expect(fermer2).toHaveBeenCalledTimes(1);
    expect(fermer1, 'Échap a fermé les DEUX dialogues').not.toHaveBeenCalled();

    // Le dessus refermé, le dessous reprend la main — clavier compris.
    taper('Escape');
    expect(fermer1).toHaveBeenCalledTimes(1);
  });
});

describe('la pile ne donne le clavier qu’à un dialogue À L’ÉCRAN', () => {
  // Un crochet appelé au niveau d'une vue toujours montée (la Chambre le
  // faisait) entre dans la pile sans dialogue ouvert. Au sommet, il gardait
  // le clavier pour un conteneur absent : le dialogue réellement ouvert
  // dessous ne fermait plus sur Échap et ne gardait plus Tab.
  function SansDialogue({ onClose }: { onClose: () => void }) {
    useDialog<HTMLDivElement>(onClose);
    return <p>une vue, pas de dialogue ouvert</p>;
  }

  it('UN CROCHET SANS CONTENEUR MONTÉ AU-DESSUS NE VOLE NI ÉCHAP NI TAB', () => {
    const fermer = vi.fn();
    const fantome = vi.fn();
    function Page() {
      const [vue, setVue] = useState(false);
      return (
        <>
          <Dialogue nom="tiroir" onClose={fermer}>
            <button onClick={() => setVue(true)}>tiroir-début</button>
            <button>tiroir-fin</button>
          </Dialogue>
          {vue && <SansDialogue onClose={fantome} />}
        </>
      );
    }
    const dom = monter(<Page />);
    // La vue monte APRÈS le tiroir : son crochet se pose au-dessus de lui.
    act(() => par(dom, 'tiroir-début').click());

    focaliser(par(dom, 'tiroir-fin'));
    expect(taper('Tab'), 'Tab sort du tiroir').toBe(true);
    expect(document.activeElement?.textContent).toBe('tiroir-début');

    taper('Escape');
    expect(fermer, 'le tiroir ouvert ne ferme plus sur Échap').toHaveBeenCalledTimes(1);
    expect(fantome, 'Échap est allé à un dialogue qui n’est pas à l’écran').not.toHaveBeenCalled();
  });
});

describe('« Inviter » est un dialogue comme les autres', () => {
  // Il fermait sur Échap avec son propre écouteur, sans rien faire du focus.
  beforeEach(() => {
    vi.mocked(fetchInvite).mockResolvedValue({
      invite: 'hive2_abc',
      url: 'ws://192.168.1.20:7777/ws',
      label: 'Le poste de Camille',
      joinCommand: 'npm run join -- hive2_abc',
      entree: { posix: 'curl … | sh', windows: 'irm …' },
      note: 'Billet à usage UNIQUE.',
    } as never);
  });

  it('LE FOCUS ENTRE, RESTE, PUIS REVIENT AU BOUTON', async () => {
    const dom = monter(<InvitePanel />);
    const inviter = par(dom, 'Inviter');
    focaliser(inviter);
    await act(async () => inviter.click());

    const dialogue = document.querySelector<HTMLElement>('[role="dialog"]');
    expect(dialogue, 'la modale ne s’est pas ouverte').not.toBeNull();
    expect(dialogue?.contains(document.activeElement), 'le focus est resté derrière le voile').toBe(
      true,
    );

    // Le dernier arrêt réel est le RÉSUMÉ des réglages avancés : son
    // `<details>` est fermé, le champ et le bouton qu'il range sont sautés.
    const resume = dialogue?.querySelector<HTMLElement>('details:not([open]) > summary');
    expect(
      resume,
      'les réglages avancés ne sont plus repliés — le cas ne mesure rien',
    ).toBeTruthy();
    focaliser(resume as HTMLElement);
    expect(taper('Tab'), 'Tab sort de l’invitation').toBe(true);
    expect(document.activeElement, 'Tab ne revient pas au premier bouton').toBe(
      dialogue?.querySelector('button'),
    );

    taper('Escape');
    expect(document.querySelector('[role="dialog"]'), 'Échap ne ferme plus').toBeNull();
    expect(document.activeElement, 'le focus n’est pas revenu au bouton « Inviter »').toBe(inviter);
  });
});
