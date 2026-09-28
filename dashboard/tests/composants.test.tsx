// @vitest-environment happy-dom
//
// LES PRIMITIVES DU DESIGN SYSTEM — rendues, puis maniées au clavier.
//
// Chaque primitive promet un CONTRAT d'accessibilité (voir l'en-tête de son
// fichier dans `dashboard/src/composants/`). Un contrat d'accessibilité ne se
// voit pas : un menu qui ne rend pas le focus à son bouton, un champ en faute
// qui ne dit pas sa faute au lecteur d'écran, un toast d'erreur qui s'efface
// avant d'être lu — tout cela a l'air parfait à l'écran. Ces tests jouent donc
// le geste (clavier, focus, minuterie) et lisent ce que l'arbre ANNONCE
// (rôles, `aria-*`), pas ce qu'il affiche.

import { act } from 'react';
import type { ReactElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import {
  Champ,
  EmptyState,
  ErrorState,
  Fieldset,
  Input,
  Menu,
  Select,
  Skeleton,
  Tabs,
  Textarea,
  ToastProvider,
  Tooltip,
  useToast,
} from '../src/composants';
import { setLang } from '../src/i18n';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let conteneur: HTMLElement | undefined;
let racine: Root | undefined;

async function monter(element: ReactElement): Promise<HTMLElement> {
  const c = document.createElement('div');
  document.body.appendChild(c);
  conteneur = c;
  const r = createRoot(c);
  racine = r;
  await act(async () => {
    r.render(element);
  });
  return c;
}

async function touche(el: Element, key: string): Promise<void> {
  await act(async () => {
    el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  });
}

async function clic(el: Element): Promise<void> {
  await act(async () => {
    (el as HTMLElement).click();
  });
}

const un = <T extends Element>(racineDom: ParentNode, selecteur: string): T => {
  const el = racineDom.querySelector<T>(selecteur);
  expect(el, `« ${selecteur} » introuvable`).not.toBeNull();
  return el as T;
};

beforeAll(() => setLang('fr'));

afterEach(async () => {
  vi.useRealTimers();
  const r = racine;
  const c = conteneur;
  racine = undefined;
  conteneur = undefined;
  if (r) {
    await act(async () => {
      r.unmount();
    });
  }
  c?.remove();
});

// ─── Champs ──────────────────────────────────────────────────────────────────

describe('les champs disent leur libellé, leur aide et leur faute', () => {
  it('le libellé vise le contrôle ; l’aide est décrite ; sans faute, rien d’invalide', async () => {
    const c = await monter(<Input libelle="Nom du projet" aide="Visible par l’équipe." />);
    const input = un<HTMLInputElement>(c, 'input');
    const label = un<HTMLLabelElement>(c, 'label');
    expect(label.htmlFor).toBe(input.id);
    expect(input.id).not.toBe('');
    const decrit = input.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(decrit)?.textContent).toBe('Visible par l’équipe.');
    expect(input.hasAttribute('aria-invalid')).toBe(false);
    // La zone d'erreur EXISTE déjà, vide et vivante : c'est elle qui annoncera.
    const zone = un<HTMLElement>(c, '.ds-champ-erreur');
    expect(zone.getAttribute('aria-live')).toBe('polite');
    expect(zone.textContent).toBe('');
  });

  it('une faute rend le champ invalide et s’ajoute À LA SUITE de l’aide', async () => {
    const c = await monter(
      <Textarea libelle="Consigne" aide="Une phrase." erreur="Trop courte." requis />,
    );
    const zone = un<HTMLTextAreaElement>(c, 'textarea');
    expect(zone.getAttribute('aria-invalid')).toBe('true');
    expect(zone.required).toBe(true);
    const ids = (zone.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Une phrase.',
      '⚠ Trop courte.',
    ]);
  });

  it('un Select est un <select> natif, relié, qui rend la valeur choisie', async () => {
    const choisi = vi.fn();
    const c = await monter(
      <Select
        libelle="Agent"
        erreur="Choisissez un agent."
        options={[
          { valeur: 'claude', libelle: 'Claude Code' },
          { valeur: 'codex', libelle: 'Codex' },
          { valeur: 'shell', libelle: 'Shell', desactive: true },
        ]}
        defaultValue="claude"
        onChange={(e) => choisi(e.target.value)}
      />,
    );
    const select = un<HTMLSelectElement>(c, 'select');
    expect(un<HTMLLabelElement>(c, 'label').htmlFor).toBe(select.id);
    expect([...select.options].map((o) => [o.value, o.disabled])).toEqual([
      ['claude', false],
      ['codex', false],
      ['shell', true],
    ]);
    expect(select.getAttribute('aria-invalid')).toBe('true');
    await act(async () => {
      select.value = 'codex';
      select.dispatchEvent(new Event('change', { bubbles: true }));
    });
    expect(choisi).toHaveBeenCalledWith('codex');
  });

  it('ce que l’appelant pose lui-même — description, invalidité, obligation — est GARDÉ', async () => {
    const c = await monter(
      <>
        <p id="note">Voir la charte.</p>
        <Input libelle="Clé" aide="Commence par hk_." aria-describedby="note" required />
      </>,
    );
    const input = un<HTMLInputElement>(c, 'input');
    const ids = (input.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Voir la charte.',
      'Commence par hk_.',
    ]);
    expect(input.required).toBe(true);
    // L'astérisque suit l'obligation, d'où qu'elle vienne.
    expect(c.querySelector('.ds-champ-requis')).not.toBeNull();
  });

  it('un Champ relie de la même façon un contrôle qui n’est pas natif', async () => {
    const c = await monter(
      <Champ libelle="Dossier" aide="Relatif au projet." erreur="Introuvable." requis>
        {(controle) => <input type="text" role="combobox" aria-expanded={false} {...controle} />}
      </Champ>,
    );
    const boite = un<HTMLInputElement>(c, '[role="combobox"]');
    expect(un<HTMLLabelElement>(c, 'label').htmlFor).toBe(boite.id);
    expect(boite.getAttribute('aria-invalid')).toBe('true');
    expect(boite.required).toBe(true);
    const ids = (boite.getAttribute('aria-describedby') ?? '').split(' ');
    expect(ids.map((id) => document.getElementById(id)?.textContent)).toEqual([
      'Relatif au projet.',
      '⚠ Introuvable.',
    ]);
  });

  it('un Fieldset nomme sa question par une <legend> et décrit sa faute', async () => {
    const c = await monter(
      <Fieldset legende="Mode" erreur="Choisissez un mode.">
        <label>
          <input type="radio" name="m" /> Local
        </label>
      </Fieldset>,
    );
    const groupe = un<HTMLFieldSetElement>(c, 'fieldset');
    expect(un<HTMLElement>(groupe, 'legend').textContent).toBe('Mode');
    const decrit = groupe.getAttribute('aria-describedby') ?? '';
    expect(document.getElementById(decrit)?.textContent).toBe('⚠ Choisissez un mode.');
  });
});

// ─── Onglets ─────────────────────────────────────────────────────────────────

describe('les onglets suivent le motif WAI-ARIA', () => {
  const ONGLETS = [
    { id: 'diff', libelle: 'Diff', contenu: <p>le diff</p> },
    { id: 'log', libelle: 'Journal', contenu: <p>le journal</p> },
    { id: 'off', libelle: 'Éteint', contenu: <p>rien</p>, desactive: true },
    { id: 'tests', libelle: 'Tests', contenu: <p>les tests</p> },
  ];

  it('un seul arrêt de tabulation, le panneau nommé par son onglet', async () => {
    const c = await monter(<Tabs libelle="Détails" onglets={ONGLETS} />);
    const liste = un<HTMLElement>(c, '[role="tablist"]');
    expect(liste.getAttribute('aria-label')).toBe('Détails');
    const tabs = [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
    expect(tabs.map((t) => t.tabIndex)).toEqual([0, -1, -1, -1]);
    expect(tabs[0]?.getAttribute('aria-selected')).toBe('true');
    const panneau = un<HTMLElement>(c, '[role="tabpanel"]');
    expect(panneau.getAttribute('aria-labelledby')).toBe(tabs[0]?.id);
    expect(tabs[0]?.getAttribute('aria-controls')).toBe(panneau.id);
    expect(panneau.textContent).toBe('le diff');
  });

  it('→ ← bouclent en sautant l’éteint ; Début / Fin vont aux bords ; le focus suit', async () => {
    const c = await monter(<Tabs libelle="Détails" onglets={ONGLETS} />);
    const tab = (i: number) => c.querySelectorAll<HTMLButtonElement>('[role="tab"]')[i]!;
    const liste = un<HTMLElement>(c, '[role="tablist"]');
    await touche(tab(0), 'ArrowRight');
    expect(document.activeElement).toBe(tab(1));
    await touche(tab(1), 'ArrowRight');
    // « Éteint » est sauté.
    expect(document.activeElement).toBe(tab(3));
    expect(un<HTMLElement>(c, '[role="tabpanel"]').textContent).toBe('les tests');
    await touche(tab(3), 'ArrowRight');
    expect(document.activeElement).toBe(tab(0));
    await touche(tab(0), 'ArrowLeft');
    expect(document.activeElement).toBe(tab(3));
    await touche(liste, 'Home');
    expect(document.activeElement).toBe(tab(0));
    await touche(tab(0), 'End');
    expect(document.activeElement).toBe(tab(3));
  });

  it('contrôlé : il DEMANDE le changement, le parent décide', async () => {
    const demande = vi.fn();
    const c = await monter(
      <Tabs libelle="Détails" onglets={ONGLETS} actif="log" onChange={demande} />,
    );
    await clic(c.querySelectorAll('[role="tab"]')[3]!);
    expect(demande).toHaveBeenCalledWith('tests');
    // Le parent n'a pas suivi : l'onglet ouvert reste le sien.
    expect(un<HTMLElement>(c, '[role="tabpanel"]').textContent).toBe('le journal');
  });

  it('un `actif` périmé ou éteint retombe sur le premier ouvrable — jamais une rangée injoignable', async () => {
    for (const actif of ['off', 'disparu']) {
      const c = await monter(<Tabs libelle="Détails" onglets={ONGLETS} actif={actif} />);
      const tabs = [...c.querySelectorAll<HTMLButtonElement>('[role="tab"]')];
      expect(
        tabs.map((t) => t.tabIndex),
        actif,
      ).toEqual([0, -1, -1, -1]);
      expect(un<HTMLElement>(c, '[role="tabpanel"]').textContent, actif).toBe('le diff');
      c.remove();
    }
  });
});

// ─── Info-bulle ──────────────────────────────────────────────────────────────

describe('l’info-bulle s’ouvre au clavier, se ferme à Échap, et est reliée', () => {
  it('focus → ouverte ; Échap → fermée ; le bouton est décrit par elle', async () => {
    const c = await monter(
      <Tooltip texte="Relance la tâche depuis zéro">
        <button type="button" aria-describedby="deja">
          Relancer
        </button>
      </Tooltip>,
    );
    const bouton = un<HTMLButtonElement>(c, 'button');
    const bulle = un<HTMLElement>(c, '[role="tooltip"]');
    // La description existante est GARDÉE, la bulle s'y ajoute.
    expect(bouton.getAttribute('aria-describedby')).toBe(`deja ${bulle.id}`);
    expect(bulle.hidden).toBe(true);
    await act(async () => {
      bouton.focus();
    });
    expect(bulle.hidden).toBe(false);
    await touche(bouton, 'Escape');
    expect(bulle.hidden).toBe(true);
    // Le focus n'a pas bougé : Échap ferme la bulle, pas le contexte.
    expect(document.activeElement).toBe(bouton);
  });

  it('Échap ferme la bulle SANS atteindre le dialogue autour ; bulle fermée, il passe', async () => {
    const dialogue = vi.fn();
    const c = await monter(
      <div role="dialog" onKeyDown={(e) => e.key === 'Escape' && dialogue()}>
        <Tooltip texte="Aide">
          <button type="button">?</button>
        </Tooltip>
      </div>,
    );
    const bouton = un<HTMLButtonElement>(c, 'button');
    await act(async () => {
      bouton.focus();
    });
    await touche(bouton, 'Escape');
    expect(un<HTMLElement>(c, '[role="tooltip"]').hidden).toBe(true);
    expect(dialogue).not.toHaveBeenCalled();
    await touche(bouton, 'Escape');
    expect(dialogue).toHaveBeenCalledTimes(1);
  });

  it('au survol, elle attend son délai — un passage de souris ne l’ouvre pas', async () => {
    vi.useFakeTimers();
    const c = await monter(
      <Tooltip texte="Aide">
        <button type="button">?</button>
      </Tooltip>,
    );
    const ancre = un<HTMLElement>(c, '.ds-infobulle-ancre');
    const bulle = un<HTMLElement>(c, '[role="tooltip"]');
    await act(async () => {
      ancre.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    await act(async () => {
      ancre.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(1_000);
    });
    expect(bulle.hidden).toBe(true);
    await act(async () => {
      ancre.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
    });
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    expect(bulle.hidden).toBe(false);
  });
});

// ─── Menu ────────────────────────────────────────────────────────────────────

describe('le menu déroulant rend toujours le focus à son bouton', () => {
  async function menuTheme() {
    const choix = vi.fn();
    const c = await monter(
      <Menu
        libelle="Thème"
        declencheur="◐"
        elements={[
          { id: 'systeme', libelle: 'Système', coche: false, onChoisir: () => choix('systeme') },
          { id: 'sombre', libelle: 'Sombre', coche: true, onChoisir: () => choix('sombre') },
          {
            id: 'off',
            libelle: 'Indispo',
            coche: false,
            desactive: true,
            onChoisir: () => choix('off'),
          },
          { id: 'clair', libelle: 'Clair', coche: false, onChoisir: () => choix('clair') },
        ]}
      />,
    );
    return { c, choix, bouton: un<HTMLButtonElement>(c, 'button') };
  }
  const items = (c: HTMLElement) => [...c.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];

  it('fermé : le bouton annonce un menu ; ouvert : le focus va au choix coché', async () => {
    const { c, bouton } = await menuTheme();
    expect(bouton.getAttribute('aria-haspopup')).toBe('menu');
    expect(bouton.getAttribute('aria-expanded')).toBe('false');
    expect(c.querySelector('[role="menu"]')).toBeNull();
    await clic(bouton);
    expect(bouton.getAttribute('aria-expanded')).toBe('true');
    const menu = un<HTMLElement>(c, '[role="menu"]');
    expect(bouton.getAttribute('aria-controls')).toBe(menu.id);
    expect(items(c).map((i) => i.getAttribute('aria-checked'))).toEqual([
      'false',
      'true',
      'false',
      'false',
    ]);
    expect(document.activeElement?.textContent).toContain('Sombre');
  });

  it('↓ ↑ bouclent et sautent l’élément éteint', async () => {
    const { c, bouton } = await menuTheme();
    await clic(bouton);
    const menu = un<HTMLElement>(c, '[role="menu"]');
    await touche(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Clair');
    await touche(menu, 'ArrowDown');
    expect(document.activeElement?.textContent).toContain('Système');
    await touche(menu, 'ArrowUp');
    expect(document.activeElement?.textContent).toContain('Clair');
    await touche(menu, 'Home');
    expect(document.activeElement?.textContent).toContain('Système');
    await touche(menu, 'End');
    expect(document.activeElement?.textContent).toContain('Clair');
  });

  it('Échap ferme SANS choisir, et rend le focus au bouton', async () => {
    const { c, choix, bouton } = await menuTheme();
    await clic(bouton);
    await touche(un(c, '[role="menu"]'), 'Escape');
    expect(c.querySelector('[role="menu"]')).toBeNull();
    expect(choix).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(bouton);
  });

  it('Entrée choisit, ferme, et rend le focus au bouton ; l’éteint ne choisit rien', async () => {
    const { c, choix, bouton } = await menuTheme();
    await clic(bouton);
    await clic(items(c)[2]!);
    expect(choix).not.toHaveBeenCalled();
    await touche(un(c, '[role="menu"]'), 'ArrowDown');
    await touche(document.activeElement!, 'Enter');
    expect(choix).toHaveBeenCalledWith('clair');
    expect(c.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(bouton);
  });

  it('↑ sur le bouton ouvre au DERNIER élément ; un clic dehors ferme', async () => {
    const { c, bouton } = await menuTheme();
    await touche(bouton, 'ArrowUp');
    expect(document.activeElement?.textContent).toContain('Clair');
    await act(async () => {
      document.body.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    });
    expect(c.querySelector('[role="menu"]')).toBeNull();
  });
});

// ─── Toasts ──────────────────────────────────────────────────────────────────

describe('les toasts : l’information s’efface, l’erreur reste', () => {
  function Declencheur({ ton }: { ton: 'info' | 'erreur' }) {
    const annoncer = useToast();
    return (
      <button type="button" onClick={() => annoncer({ message: `message ${ton}`, ton })}>
        annoncer {ton}
      </button>
    );
  }

  it('hors fournisseur, useToast LÈVE — un toast ne part pas dans le vide', async () => {
    const console = vi.spyOn(globalThis.console, 'error').mockImplementation(() => {});
    await expect(monter(<Declencheur ton="info" />)).rejects.toThrow(/ToastProvider/);
    console.mockRestore();
  });

  it('une information entre dans la file `status` et s’efface seule après 5 s', async () => {
    vi.useFakeTimers();
    const c = await monter(
      <ToastProvider>
        <Declencheur ton="info" />
      </ToastProvider>,
    );
    const region = un<HTMLElement>(c, '.ds-toasts');
    expect(region.getAttribute('aria-label')).toBe('Notifications');
    // Une seule région vivante par toast : la file, pas la région englobante
    // ni le toast (deux régions imbriquées = une phrase lue deux fois).
    expect(region.hasAttribute('aria-live')).toBe(false);
    const files = [...region.querySelectorAll<HTMLElement>('.ds-toasts-file')];
    expect(files.map((f) => f.getAttribute('role'))).toEqual(['status', 'alert']);
    await clic(un(c, 'button'));
    const toast = un<HTMLElement>(c, '.ds-toast');
    expect(toast.hasAttribute('role')).toBe(false);
    expect(toast.parentElement?.getAttribute('role')).toBe('status');
    expect(toast.textContent).toContain('Info');
    expect(toast.textContent).toContain('message info');
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    expect(c.querySelector('.ds-toast')).toBeNull();
  });

  it('une ERREUR entre dans la file `alert` et reste jusqu’à ce qu’on la ferme', async () => {
    vi.useFakeTimers();
    const c = await monter(
      <ToastProvider>
        <Declencheur ton="erreur" />
      </ToastProvider>,
    );
    await clic(un(c, 'button'));
    await act(async () => {
      vi.advanceTimersByTime(60_000);
    });
    const toast = un<HTMLElement>(c, '.ds-toast');
    expect(toast.hasAttribute('role')).toBe(false);
    expect(toast.parentElement?.getAttribute('role')).toBe('alert');
    expect(toast.textContent).toContain('Erreur');
    await clic(un(toast, 'button[aria-label="Fermer la notification"]'));
    expect(c.querySelector('.ds-toast')).toBeNull();
  });
});

// ─── Chargement, vide, panne ─────────────────────────────────────────────────

describe('les trois états d’une zone sans données', () => {
  it('le squelette s’annonce une fois, ses lignes sont muettes', async () => {
    const c = await monter(<Skeleton lignes={4} />);
    const s = un<HTMLElement>(c, '.ds-squelette');
    expect(s.getAttribute('role')).toBe('status');
    expect(s.getAttribute('aria-busy')).toBe('true');
    expect(s.textContent).toBe('Chargement…');
    const lignes = [...s.querySelectorAll('.ds-squelette-ligne')];
    expect(lignes).toHaveLength(4);
    expect(lignes.every((l) => l.getAttribute('aria-hidden') === 'true')).toBe(true);
  });

  it('l’état vide nomme l’absence et porte le geste qui la comble', async () => {
    const c = await monter(
      <EmptyState
        titre="Aucun projet"
        texte="Un projet regroupe les tâches d’un dépôt."
        action={<button type="button">Démarrer un projet</button>}
      />,
    );
    expect(un<HTMLElement>(c, '.ds-vide-titre').textContent).toBe('Aucun projet');
    expect(un<HTMLElement>(c, '.ds-vide-action button').textContent).toBe('Démarrer un projet');
  });

  it('l’état d’erreur s’annonce et relance ; pendant la relance, le bouton garde le focus', async () => {
    const relancer = vi.fn();
    const c = await monter(
      <ErrorState titre="Le relevé n’est pas revenu" detail="HTTP 503" onReessayer={relancer} />,
    );
    expect(un<HTMLElement>(c, '.ds-erreur').getAttribute('role')).toBe('alert');
    await clic(un(c, 'button'));
    expect(relancer).toHaveBeenCalledTimes(1);

    const r = racine!;
    await act(async () => {
      r.render(<ErrorState titre="Le relevé n’est pas revenu" onReessayer={relancer} enCours />);
    });
    const bouton = un<HTMLButtonElement>(c, 'button');
    // `aria-disabled`, pas `disabled` : un bouton `disabled` perd le focus.
    expect(bouton.disabled).toBe(false);
    expect(bouton.getAttribute('aria-disabled')).toBe('true');
    await clic(bouton);
    expect(relancer).toHaveBeenCalledTimes(1);
  });
});
