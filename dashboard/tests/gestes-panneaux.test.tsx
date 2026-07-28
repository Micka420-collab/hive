// @vitest-environment happy-dom
//
// LES TROIS PANNEAUX QUI PORTENT UN GESTE IRRÉVERSIBLE.
//
// `geste-irreversible.test.tsx` prouve que la GARDE tient. Ce fichier-ci prouve
// qu'elle est posée au bon endroit, sur la bonne ligne, et que les conditions
// qui décident de son apparition sont justes.
//
// ─── LES TROIS DÉFAUTS QUE LA LOUPE A DÉSIGNÉS ───────────────────────────────
//
// Passée sur le lot précédent, elle a laissé survivre exactement trois
// mutations. Aucune n'est équivalente ; les trois cassent quelque chose de réel.
//
//     disabled={busy !== null}          → === : LE BOUTON EST MORT AU REPOS.
//                                         Aucune clé n'est plus révocable, et
//                                         rien ne le dit — l'écran a l'air
//                                         normal.
//
//     m.role !== 'owner'                → === : le « ✕ » quitte les membres et
//                                         se pose sur LE PROPRIÉTAIRE. On ne
//                                         peut plus retirer personne, et le
//                                         seul geste offert est celui que le
//                                         serveur refusera.
//
//     l.vivant && (                     → ||  : le « ✕ » apparaît sur les liens
//                                         DÉJÀ éteints. Le geste ne peut plus
//                                         qu'échouer, sur la ligne où il n'y a
//                                         rien à faire.
//
// Ces trois conditions étaient là AVANT ce lot. Elles n'ont jamais été tenues :
// aucun test de ce dépôt ne rendait un composant React. La loupe les a mises
// sous les yeux parce que le diff les touchait — c'est exactement ce qu'on lui
// demande.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { EquipeProjet, PartagesProjet } from '../src/views/Projets';
import { SectionCles } from '../src/views/Intendance';
import { setLang } from '../src/i18n';
import type { AuthUser, ClesRuche, LienPartage, MembreProjet } from '../src/api';
import type { Project } from '../../src/shared/types';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Le réseau ──────────────────────────────────────────────────────────────
//
// Ces panneaux lisent au MONTAGE (`useApiPoll`) : contrairement aux panneaux du
// dépôt, ils ne peuvent pas attendre un clic. Le réseau répond donc tout de
// suite — sauf ce qu'on décide explicitement de RETENIR, pour observer l'écran
// pendant qu'un geste voyage. C'est là que vit `disabled`.

let reponses: { motif: string; corps: unknown }[] = [];
let aRetenir: string | null = null;
let relacher: (() => void) | null = null;
let vus: string[] = [];

function poserLeReseau(): void {
  reponses = [];
  aRetenir = null;
  relacher = null;
  vus = [];
  globalThis.fetch = ((entree: unknown, init?: RequestInit) => {
    const url = String(entree);
    vus.push(`${init?.method ?? 'GET'} ${url}`);
    const trouve = reponses.find((r) => url.includes(r.motif));
    const rendre = () =>
      ({ ok: true, status: 200, json: async () => trouve?.corps ?? {} }) as Response;
    if (aRetenir !== null && url.includes(aRetenir)) {
      return new Promise<Response>((resolve) => {
        relacher = () => resolve(rendre());
      });
    }
    return Promise.resolve(rendre());
  }) as typeof fetch;
}

/** Laisse partir la réponse retenue, et laisse React redessiner. */
async function relacherLAppel(): Promise<void> {
  expect(relacher, 'rien n’était retenu — le geste n’a pas appelé').toBeTruthy();
  await act(async () => {
    (relacher as () => void)();
    await Promise.resolve();
  });
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
  // `useApiPoll` part dans un effet : une passe de plus pour que la réponse
  // déjà résolue soit peinte avant la première assertion.
  await act(async () => {
    await Promise.resolve();
  });
}

const boutons = (): HTMLButtonElement[] => [...conteneur.querySelectorAll('button')];
const texte = (): string => conteneur.textContent ?? '';

async function cliquer(libelle: string): Promise<void> {
  const cible = boutons().find((b) => b.textContent?.trim() === libelle);
  expect(
    cible,
    `bouton « ${libelle} » introuvable — présents : ${boutons()
      .map((b) => b.textContent?.trim())
      .join(' | ')}`,
  ).toBeTruthy();
  await act(async () => {
    (cible as HTMLButtonElement).click();
  });
}

/** La ligne de liste qui contient ce texte — pour dire SUR QUELLE ligne on est. */
function ligne(fragment: string): HTMLElement {
  const trouvee = [...conteneur.querySelectorAll('li')].find((li) =>
    (li.textContent ?? '').includes(fragment),
  );
  expect(trouvee, `aucune ligne ne contient « ${fragment} »`).toBeTruthy();
  return trouvee as HTMLElement;
}

// ─── Les données ────────────────────────────────────────────────────────────

const PROJET: Project = {
  id: 'p1',
  name: 'Ruche',
  repoUrl: 'https://github.com/micka/ruche.git',
  description: null,
  visibility: 'private',
  ownerId: 'u-proprio',
  createdAt: 0,
};

const PROPRIO: AuthUser = {
  id: 'u-proprio',
  email: 'proprio@ruche.test',
  displayName: 'Camille',
};

const EQUIPE: MembreProjet[] = [
  { projectId: 'p1', userId: 'u-proprio', role: 'owner', joinedAt: 0, displayName: 'Camille' },
  { projectId: 'p1', userId: 'u-lea', role: 'member', joinedAt: 0, displayName: 'Léa' },
];

const LIENS: LienPartage[] = [
  { id: 'l-vif', label: 'lien vivant', creeA: 0, expireA: 0, revoqueA: null, vuA: 1, vivant: true },
  {
    id: 'l-mort',
    label: 'lien éteint',
    creeA: 0,
    expireA: 0,
    revoqueA: 1,
    vuA: null,
    vivant: false,
  },
];

const CLES: ClesRuche = {
  noeuds: [
    { nodeId: 'n-portable', label: 'le portable', createdAt: 0, lastSeenAt: 1, revoque: false },
    { nodeId: 'n-mort', label: 'la tour', createdAt: 0, lastSeenAt: 1, revoque: true },
  ],
  billets: [
    {
      id: 'b1',
      label: 'billet du soir',
      createdAt: 0,
      expiresAt: 0,
      usesLeft: 2,
      usesTotal: 3,
      etat: 'vivant',
    },
  ],
};

beforeAll(() => {
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

describe('L’ÉQUIPE — le « ✕ » n’est pas offert sur n’importe qui', () => {
  beforeEach(() => {
    reponses.push({ motif: '/members', corps: EQUIPE });
  });

  it('LE PROPRIÉTAIRE NE SE RETIRE PAS, les autres oui', async () => {
    // Le mutant visé : `m.role !== 'owner'` → `===`. Retourné, le seul geste
    // offert devient celui que le serveur refusera, et plus personne n'est
    // retirable. Les DEUX assertions sont nécessaires : compter un seul « ✕ »
    // ne dirait pas sur quelle ligne il se trouve.
    await monter(<EquipeProjet project={PROJET} user={PROPRIO} refreshTick={0} />);

    expect(texte()).toContain('Camille');
    expect(texte()).toContain('Léa');
    expect(ligne('Léa').querySelectorAll('button'), 'Léa doit être retirable').toHaveLength(1);
    expect(
      ligne('Camille').querySelectorAll('button'),
      'LE PROPRIÉTAIRE NE DOIT PAS PORTER DE ✕',
    ).toHaveLength(0);
  });

  it('qui n’a le droit de rien n’a de bouton pour rien', async () => {
    // `jePeuxAdmettre` est cosmétique — le serveur retranche de toute façon —
    // mais proposer un geste voué au 403 est une promesse qu'on ne tient pas.
    const passant: AuthUser = { id: 'u-passant', email: 'x@y.z', displayName: 'Passant' };
    await monter(<EquipeProjet project={PROJET} user={passant} refreshTick={0} />);
    expect(ligne('Léa').querySelectorAll('button')).toHaveLength(0);
  });

  it('LE RETRAIT PASSE PAR LA GARDE, et nomme la personne', async () => {
    await monter(<EquipeProjet project={PROJET} user={PROPRIO} refreshTick={0} />);
    aRetenir = '/members/u-lea';

    await cliquer('✕');
    expect(
      vus.filter((v) => v.includes('DELETE')),
      'LE PREMIER CLIC A RETIRÉ',
    ).toHaveLength(0);
    expect(texte()).toContain('Retirer Léa du projet ?');

    await cliquer('Retirer');
    expect(vus.some((v) => v.startsWith('DELETE') && v.includes('u-lea'))).toBe(true);
  });
});

describe('LES LIENS DE PARTAGE — on n’éteint que ce qui brûle', () => {
  beforeEach(() => {
    reponses.push({ motif: '/partages', corps: LIENS });
  });

  it('UN LIEN DÉJÀ ÉTEINT NE PROPOSE PAS DE L’ÉTEINDRE', async () => {
    // Le mutant visé : `l.vivant &&` → `||`. Retourné, le « ✕ » se pose aussi
    // sur les liens morts : un geste qui ne peut plus qu'échouer, sur la ligne
    // où il n'y a rien à faire.
    await monter(<PartagesProjet project={PROJET} user={PROPRIO} refreshTick={0} />);

    expect(ligne('lien vivant').querySelectorAll('button'), 'le vivant s’éteint').toHaveLength(1);
    expect(
      ligne('lien éteint').querySelectorAll('button'),
      'UN LIEN MORT NE SE RÉÉTEINT PAS',
    ).toHaveLength(0);
  });

  it('éteindre passe par la garde, et dit que ça ne se rallume pas', async () => {
    await monter(<PartagesProjet project={PROJET} user={PROPRIO} refreshTick={0} />);
    aRetenir = '/partages/l-vif';

    await cliquer('✕');
    expect(vus.filter((v) => v.includes('DELETE'))).toHaveLength(0);
    expect(texte()).toContain('Éteindre « lien vivant » ?');
    expect(texte(), 'la question doit dire ce qui se perd').toContain('ne se rallume pas');

    await cliquer('Éteindre');
    expect(vus.some((v) => v.startsWith('DELETE') && v.includes('l-vif'))).toBe(true);
  });
});

describe('LES CLÉS — le bouton qui coupe une machine', () => {
  beforeEach(() => {
    reponses.push({ motif: '/api/membres', corps: CLES });
  });

  it('AU REPOS, RÉVOQUER EST CLIQUABLE', async () => {
    // Le mutant visé : `disabled={busy !== null}` → `=== null`. Retourné, plus
    // aucune clé n'est révocable — et rien ne le dit, l'écran a l'air normal.
    // C'est le pire des deux : une panne qui ne se voit pas.
    await monter(<SectionCles refreshTick={0} />);

    const revoquer = boutons().filter((b) => b.textContent?.trim() === 'Révoquer');
    expect(revoquer.length, 'une machine vivante + un billet vivant').toBe(2);
    for (const b of revoquer) expect(b.disabled, 'AU REPOS, TOUT DOIT ÊTRE CLIQUABLE').toBe(false);
  });

  it('une clé DÉJÀ révoquée le dit, et n’offre rien', async () => {
    await monter(<SectionCles refreshTick={0} />);
    expect(ligne('la tour').textContent).toContain('révoquée');
    expect(ligne('la tour').querySelectorAll('button')).toHaveLength(0);
  });

  it('PENDANT QU’UNE RÉVOCATION VOYAGE, plus rien ne part', async () => {
    // Deuxième moitié du même mutant : `disabled` doit MORDRE quand ça
    // travaille. Sans ça, on couperait deux machines en croyant en couper une.
    await monter(<SectionCles refreshTick={0} />);
    aRetenir = '/api/membres/n-portable';

    await cliquer('Révoquer');
    expect(
      vus.filter((v) => v.includes('DELETE')),
      'LE PREMIER CLIC A COUPÉ',
    ).toHaveLength(0);
    expect(texte()).toContain('Déconnecter le portable maintenant ?');
    expect(texte(), 'la question doit dire ce qui se perd').toContain('ne vaudra plus rien');

    await cliquer('Déconnecter');
    expect(
      boutons().every((b) => b.disabled),
      'tout doit se figer pendant l’appel',
    ).toBe(true);

    await relacherLAppel();
    expect(vus.some((v) => v.startsWith('DELETE') && v.includes('n-portable'))).toBe(true);
  });

  it('LE BILLET RESTE NU — décision, pas oubli', async () => {
    // Le panneau l'écrit : révoquer un billet « ne déconnecte personne ». Une
    // garde ici apprendrait à cliquer à travers les gardes, et celle d'à côté —
    // qui coupe une machine — se ferait traverser aussi.
    await monter(<SectionCles refreshTick={0} />);
    aRetenir = '/api/billets/b1';

    const billet = ligne('billet du soir').querySelector('button');
    await act(async () => {
      (billet as HTMLButtonElement).click();
    });

    expect(texte(), 'aucune question ne doit s’ouvrir').not.toContain('?');
    expect(vus.some((v) => v.startsWith('DELETE') && v.includes('b1'))).toBe(true);
  });
});
