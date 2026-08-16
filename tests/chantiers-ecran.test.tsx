// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LES CHANTIERS, À L'ÉCRAN — ce que voit quelqu'un qui lance un travail déclaré.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Échantillon de la loupe sur `dashboard/src/views/Chantiers.tsx`, base épinglée
// dans l'atelier (`LOUPE_BASE=f0fc005`) : **21 candidates, 11 examinées, dont 5
// SANS TEST**. Une seule vue en parlait (`vues-sentinelles`), et elle regardait
// l'écran au repos — jamais un clic, jamais un envoi en cours.
//
// Ce banc ferme les cinq. Il ne prétend PAS mesurer le fichier : dix candidates
// sont restées de côté, la loupe échantillonne et le dit elle-même.
//
// ─── CE QUE CHAQUE SURVIVANTE COÛTAIT ────────────────────────────────────────
//
//   `ref.trim() || 'main'`      en `&&`, un champ vidé envoie une ref VIDE à
//                               GitHub au lieu de « main » — un workflow lancé
//                               sur rien du tout ;
//   `projets.length > 1`        en `>=`, un sélecteur de projet apparaît pour
//                               UN seul projet : un menu à un choix ;
//   `enCours === c.nom`         en `!==`, le bouton dit « Envoi… » AU REPOS et
//                               « Lancer » PENDANT l'envoi — exactement à
//                               l'envers, sur le seul retour que l'écran donne ;
//   `verdict.sortie !== ''`     en `||`, un `<pre>` vide s'affiche sous chaque
//                               verdict muet ;
//   `enCours === \`wf-…\``       le même envers, côté GitHub.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLang } from '../dashboard/src/i18n';
import type { Chantier, VerdictChantier, Workflow } from '../dashboard/src/api';
import type { ViewProps } from '../dashboard/src/views/shared';
import type { StateSnapshot } from '../src/shared/types';

// ─── LE BOUCHON EST COMPLET, ET C'EST OBLIGATOIRE ────────────────────────────
//
// § 9 duotrigicenties : un bouchon PARTIEL laisse passer tout ce qu'on n'a pas
// nommé, et les exports non remplacés partent pour de vrai — `ECONNREFUSED
// 127.0.0.1:3000` au milieu d'un banc de rendu. Les six fonctions que la vue
// appelle sont donc toutes ici.
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  fetchChantiers: vi.fn(),
  fetchVerdictChantier: vi.fn(),
  fetchWorkflows: vi.fn(),
  fetchRuns: vi.fn(),
  lancerChantier: vi.fn(),
  lancerWorkflowGithub: vi.fn(),
}));

import {
  fetchChantiers,
  fetchRuns,
  fetchVerdictChantier,
  fetchWorkflows,
  lancerChantier,
  lancerWorkflowGithub,
} from '../dashboard/src/api';
import Chantiers from '../dashboard/src/views/Chantiers';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

const CHANTIER: Chantier = {
  nom: 'test',
  nature: 'verification',
  commande: 'vitest run',
  automatisable: true,
};

const projet = (id: string, name: string) => ({
  id,
  name,
  description: '',
  repoUrl: null,
  visibility: 'private' as const,
  ownerId: null,
  createdAt: 0,
});

// `etat` est le mot du DOMAINE, pas celui de GitHub : la frontière traduit
// « active » en « actif » à l'entrée. Écrire ici la valeur brute de l'API — ce
// que faisait la première version — fabriquait un monde qui ne peut pas exister,
// et seul `typecheck:dashboard` l'a vu. Aucun cast : c'est le typage qui garde
// ce contrat, et un `as Workflow` le rendrait muet.
const WORKFLOW: Workflow = {
  id: 42,
  nom: 'CI',
  chemin: '.github/workflows/ci.yml',
  etat: 'actif',
  htmlUrl: 'https://example.invalid/wf',
};

function instantane(projets: ReturnType<typeof projet>[]): StateSnapshot {
  return { projects: projets, nodes: [], tasks: [], tasksTotal: 0 } as unknown as StateSnapshot;
}

/** Une promesse qu'on résout à la main — pour observer l'ENVOI EN COURS. */
function enSuspens(): { promesse: Promise<void>; resoudre: () => void } {
  let resoudre = (): void => {};
  const promesse = new Promise<void>((r) => {
    resoudre = () => r();
  });
  return { promesse, resoudre };
}

beforeEach(() => {
  setLang('fr');
  vi.mocked(fetchChantiers).mockResolvedValue({ chantiers: [CHANTIER] });
  vi.mocked(fetchVerdictChantier).mockResolvedValue({ resultat: null });
  vi.mocked(fetchWorkflows).mockResolvedValue({ workflows: [], tronque: false });
  vi.mocked(fetchRuns).mockResolvedValue({ runs: [] });
  vi.mocked(lancerChantier).mockResolvedValue(undefined as never);
  vi.mocked(lancerWorkflowGithub).mockResolvedValue(undefined as never);
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  vi.clearAllMocks();
});

async function monter(projets = [projet('p1', 'Rucher')]): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  const props = {
    snapshot: instantane(projets),
    selectedId: projets[0]?.id ?? null,
    onNavigate: vi.fn(),
  } as unknown as ViewProps;
  await act(async () => racine?.render(<Chantiers {...props} />));
  await act(async () => {});
  return conteneur;
}

/**
 * Le bouton dont le texte est exactement celui-ci, DANS la zone donnée.
 *
 * La zone n'est pas un ornement : les deux moitiés de l'écran portent un bouton
 * « Lancer », et chercher dans le document entier prend TOUJOURS celui des
 * chantiers locaux. Les trois premiers cas GitHub ont échoué comme ça — sur un
 * clic qui partait au bon endroit visuellement et au mauvais endroit
 * réellement. Le message d'erreur nomme les boutons trouvés, et c'est lui qui
 * l'a dit : « Lancer », « Lancer ».
 */
function bouton(zone: Element, texte: string): HTMLButtonElement {
  const tous = [...zone.querySelectorAll('button')];
  const cible = tous.find((b) => b.textContent?.trim() === texte);
  if (!cible) {
    throw new Error(
      `aucun bouton « ${texte} » — présents : ${tous.map((b) => `« ${b.textContent?.trim() ?? ''} »`).join(', ')}`,
    );
  }
  return cible as HTMLButtonElement;
}

/**
 * Écrire dans un champ CONTRÔLÉ par React, pour de vrai.
 *
 * ─── POURQUOI `champ.value = …` NE SUFFIT PAS, ET CE QUE ÇA A COÛTÉ ──────────
 *
 * React garde un « tracker » sur la propriété `value` de l'élément. Une
 * affectation directe le met à jour EN MÊME TEMPS que la valeur, donc l'événement
 * qui suit paraît ne rien changer et `onChange` n'est jamais appelé. L'état de la
 * vue reste à sa valeur initiale.
 *
 * Le piège est qu'il ne se voit pas quand la valeur attendue EST la valeur par
 * défaut. Le cas « un champ vidé retombe sur main » est passé du premier coup
 * alors que rien n'avait été saisi : `ref` valait encore « main », et le banc
 * confondait « le repli a fonctionné » avec « ma saisie n'est jamais arrivée ».
 * C'est le cas voisin, qui attendait « dev », qui l'a démasqué en rougissant.
 *
 * On passe donc par le setter natif du prototype, celui que le tracker ne voit
 * pas, avant de déclencher l'événement.
 */
function saisir(champ: HTMLInputElement, texte: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!setter) throw new Error('pas de setter natif sur HTMLInputElement.value');
  setter.call(champ, texte);
  champ.dispatchEvent(new Event('input', { bubbles: true }));
}

/** La section GitHub — celle qui porte le champ « Branche ou tag ». */
function zoneGithub(dom: HTMLElement): Element {
  const champ = dom.querySelector('.ch-ref');
  const section = champ?.closest('section.ch-bloc');
  if (!section) throw new Error('la section GitHub est introuvable : aucun champ « .ch-ref »');
  return section;
}

describe('l’écran des Chantiers', () => {
  it('MONTRE CE QUE LE DÉPÔT DÉCLARE, commande en clair et bouton pour le lancer', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ───────────────
    const dom = await monter();
    expect(dom.textContent, 'le chantier déclaré ne s’affiche pas').toContain('test');
    expect(dom.textContent, 'la commande n’est pas montrée avant d’être lancée').toContain(
      'vitest run',
    );
    expect(bouton(dom, 'Lancer').disabled, 'le bouton est grisé au repos').toBe(false);
  });

  it('PENDANT L’ENVOI, le bouton le DIT et ne se reclique pas', async () => {
    // `enCours === c.nom` : c'est le SEUL retour que l'écran donne entre le clic
    // et le verdict, qui arrive une seconde et demie plus tard. Inversé, il dit
    // « Envoi… » au repos et « Lancer » pendant l'envoi — un utilisateur
    // reclique sur ce qui est déjà parti.
    const { promesse, resoudre } = enSuspens();
    vi.mocked(lancerChantier).mockReturnValue(promesse as never);

    const dom = await monter();
    await act(async () => {
      bouton(dom, 'Lancer').click();
    });

    const envoi = bouton(dom, 'Envoi…');
    expect(envoi.disabled, 'le bouton reste cliquable pendant l’envoi').toBe(true);

    await act(async () => {
      resoudre();
      await promesse;
    });
    expect(bouton(dom, 'Lancer').disabled, 'le bouton reste bloqué après l’envoi').toBe(false);
  });

  // ─── LA BORNE DU SÉLECTEUR, VALEUR ÉGALE AU SEUIL ──────────────────────────
  //
  // `projets.length > 1`. Le cas qui compte est celui À la borne : EXACTEMENT
  // un projet. En `>=`, un menu déroulant à un seul choix apparaît — le genre
  // de détail qu'aucune relecture ne rattrape et que personne ne signale.
  it('AVEC UN SEUL PROJET (la borne), aucun sélecteur n’apparaît', async () => {
    const dom = await monter([projet('p1', 'Rucher')]);
    expect(dom.querySelector('select.ch-projet'), 'un menu à un seul choix est offert').toBeNull();
  });

  it('AVEC DEUX PROJETS, le sélecteur apparaît — l’autre côté de la borne', async () => {
    const dom = await monter([projet('p1', 'Rucher'), projet('p2', 'Verger')]);
    const select = dom.querySelector('select.ch-projet');
    expect(select, 'on ne peut pas changer de projet alors qu’il y en a deux').not.toBeNull();
    expect(select?.querySelectorAll('option')).toHaveLength(2);
  });

  it('LA SORTIE VIDE NE MET PAS DE BLOC VIDE, la sortie pleine le met', async () => {
    const muet: VerdictChantier = { nom: 'test', code: 0, sortie: '', ok: true };
    vi.mocked(fetchVerdictChantier).mockResolvedValue({ resultat: muet });
    const sansSortie = await monter();
    expect(
      sansSortie.querySelector('pre.ch-sortie'),
      'un bloc de sortie vide s’affiche sous un verdict muet',
    ).toBeNull();

    act(() => racine?.unmount());
    conteneur?.remove();

    const bavard: VerdictChantier = { nom: 'test', code: 1, sortie: '3 échecs', ok: false };
    vi.mocked(fetchVerdictChantier).mockResolvedValue({ resultat: bavard });
    const avecSortie = await monter();
    expect(
      avecSortie.querySelector('pre.ch-sortie')?.textContent,
      'la sortie du chantier ne s’affiche pas',
    ).toBe('3 échecs');
  });
});

describe('les workflows GitHub, depuis le même écran', () => {
  beforeEach(() => {
    vi.mocked(fetchWorkflows).mockResolvedValue({ workflows: [WORKFLOW], tronque: false });
  });

  it('UN CHAMP DE BRANCHE VIDÉ RETOMBE SUR « main », jamais sur rien', async () => {
    // `ref.trim() || 'main'`. En `&&`, un champ vidé envoie la chaîne VIDE :
    // GitHub reçoit un lancement sans ref. La valeur par défaut du champ est
    // déjà « main », donc seul un champ EFFACÉ À LA MAIN atteint cette branche —
    // c'est-à-dire le geste de quelqu'un qui hésite, puis renonce.
    const dom = await monter();
    const champ = dom.querySelector('.ch-ref input') as HTMLInputElement;
    await act(async () => {
      saisir(champ, '   ');
    });
    await act(async () => {
      bouton(zoneGithub(dom), 'Lancer').click();
    });

    expect(
      vi.mocked(lancerWorkflowGithub).mock.calls[0]?.[2],
      'la ref envoyée n’est pas main',
    ).toBe('main');
  });

  it('UNE BRANCHE SAISIE EST RESPECTÉE — on n’impose pas « main » par-dessus', async () => {
    // L'autre sens : en `&&`, `'dev' && 'main'` rend « main », et le lancement
    // partirait sur la branche par défaut malgré ce qui est écrit à l'écran.
    const dom = await monter();
    const champ = dom.querySelector('.ch-ref input') as HTMLInputElement;
    await act(async () => {
      saisir(champ, 'dev');
    });
    await act(async () => {
      bouton(zoneGithub(dom), 'Lancer').click();
    });

    expect(
      vi.mocked(lancerWorkflowGithub).mock.calls[0]?.[2],
      'la branche saisie a été remplacée',
    ).toBe('dev');
  });

  it('PENDANT L’ENVOI D’UN WORKFLOW, son bouton le DIT aussi', async () => {
    const { promesse, resoudre } = enSuspens();
    vi.mocked(lancerWorkflowGithub).mockReturnValue(promesse as never);

    const dom = await monter();
    await act(async () => {
      bouton(zoneGithub(dom), 'Lancer').click();
    });

    expect(
      bouton(zoneGithub(dom), 'Envoi…').disabled,
      'le bouton du workflow reste cliquable',
    ).toBe(true);

    await act(async () => {
      resoudre();
      await promesse;
    });
    expect(bouton(zoneGithub(dom), 'Lancer').disabled, 'le bouton reste bloqué après l’envoi').toBe(
      false,
    );
  });
});
