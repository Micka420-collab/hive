// @vitest-environment happy-dom
//
// LA PORTE QUI N'AVAIT PAS DE POIGNÉE.
//
// `GET /api/projects/public` et `POST /api/projects/:id/join` existaient, avec
// une garde soignée et bien testée. Aucun écran ne les appelait. Sur une
// plateforme d'orchestration COMMUNAUTAIRE, « découvrir un projet ouvert et le
// rejoindre » est le parcours qui donne son sens à tous les autres.
//
// ─── LA RÈGLE QUE CE FICHIER TIENT, ET QUI SE PERDRA ─────────────────────────
//
// **Un refus arrive en 404, indistinguable d'un projet qui n'existe pas.**
// C'est délibéré côté serveur : un « 403 interdit » confirmerait l'existence, et
// répété sur une liste d'identifiants il dessinerait la carte des projets
// privés de la ruche.
//
// L'écran ne doit donc JAMAIS retraduire ce 404 en « vous n'avez pas le droit ».
// Ce serait reconstruire dans le navigateur l'information que le serveur a tue,
// et rendre le refus à nouveau lisible pour qui balaie des identifiants. Le
// geste le plus naturel du monde — « rendons le message plus utile » — est
// exactement celui qui rouvre la fuite.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { ProjetsOuverts } from '../src/views/Projets';
import { setLang } from '../src/i18n';
import type { AuthUser, ProjetPublicVue } from '../src/api';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ─── Le réseau ──────────────────────────────────────────────────────────────

interface Reponse {
  statut: number;
  corps: unknown;
}
let plan: { motif: string; methode?: string; reponses: Reponse[] }[] = [];
let vus: string[] = [];

function poserLeReseau(): void {
  plan = [];
  vus = [];
  globalThis.fetch = ((entree: unknown, init?: RequestInit) => {
    const url = String(entree);
    const methode = init?.method ?? 'GET';
    vus.push(`${methode} ${url}`);
    const regle = plan.find(
      (r) => url.includes(r.motif) && (r.methode ?? 'GET') === methode && r.reponses.length > 0,
    );
    // Une réponse par appel : c'est ce qui permet de vérifier qu'un échec
    // DÉCLENCHE une relecture, et que la relecture voit autre chose.
    const rep = regle?.reponses.shift() ?? { statut: 200, corps: [] };
    return Promise.resolve({
      ok: rep.statut >= 200 && rep.statut < 300,
      status: rep.statut,
      json: async () => rep.corps,
    } as Response);
  }) as typeof fetch;
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

const boutons = (): HTMLButtonElement[] => [...conteneur.querySelectorAll('button')];
const texte = (): string => (conteneur.textContent ?? '').replace(/\s+/g, ' ');

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
    await Promise.resolve();
  });
}

// ─── Les données ────────────────────────────────────────────────────────────

const LEA: AuthUser = { id: 'u-lea', email: 'lea@ruche.test', displayName: 'Léa' };

const ouvert = (id: string, name: string): ProjetPublicVue => ({
  id,
  name,
  description: `le projet ${name}`,
  repoUrl: `https://github.com/micka/${id}.git`,
  createdAt: 0,
});

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

describe('LE CATALOGUE', () => {
  it('ne demande RIEN au montage : la lecture part d’un clic', async () => {
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    expect(vus, 'le montage ne doit toucher à rien').toHaveLength(0);
    expect(texte()).toContain('voir les projets ouverts');
  });

  it('SANS COMPTE, le panneau se tait', async () => {
    // Rejoindre exige un compte : le jeton de ruche ne dit pas qui vous êtes.
    // Offrir le bouton donnerait un geste qui ne peut que refuser.
    await monter(<ProjetsOuverts user={null} dejaVus={new Set()} onRejoint={() => undefined} />);
    expect(conteneur.innerHTML).toBe('');
  });

  it('ON NE PROPOSE PAS DE REJOINDRE CE QU’ON A DÉJÀ', async () => {
    plan.push({
      motif: '/projects/public',
      reponses: [{ statut: 200, corps: [ouvert('p1', 'Alpha'), ouvert('p2', 'Beta')] }],
    });
    await monter(
      <ProjetsOuverts user={LEA} dejaVus={new Set(['p1'])} onRejoint={() => undefined} />,
    );
    await cliquer('voir les projets ouverts');

    expect(texte()).toContain('Beta');
    expect(texte(), 'Alpha est déjà à moi').not.toContain('Alpha');
    expect(boutons().filter((b) => b.textContent?.trim() === 'Rejoindre')).toHaveLength(1);
  });

  it('SANS DESCRIPTION, aucune ligne de description n’est peinte', async () => {
    // Mutant désigné par la loupe : `p.description &&` → `||` rend un `<span>`
    // vide sur chaque projet qui n'en a pas. Invisible à l'œil, faux à la
    // structure — et exactement le genre de détail qui se met à compter le jour
    // où quelqu'un stylise le conteneur ou compte ses enfants.
    plan.push({
      motif: '/projects/public',
      reponses: [
        {
          statut: 200,
          corps: [{ ...ouvert('p2', 'Beta'), description: null }, ouvert('p3', 'Gamma')],
        },
      ],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');

    // COMPTER NE SUFFIT PAS, et c'est la loupe qui l'a montré. Avec `||`, Beta
    // gagne un span vide PENDANT que Gamma perd le sien — l'opérateur rend la
    // chaîne au lieu de l'élément. Le total reste 1, et la première version de
    // ce test, qui comptait, passait pour de bonnes raisons apparentes.
    //
    // Il faut dire SUR QUELLE LIGNE le span se trouve.
    const ligne = (nom: string): HTMLElement => {
      const li = [...conteneur.querySelectorAll('li')].find((e) =>
        (e.textContent ?? '').includes(nom),
      );
      expect(li, `aucune ligne pour ${nom}`).toBeTruthy();
      return li as HTMLElement;
    };
    expect(ligne('Gamma').querySelectorAll('.pj-ouv-desc'), 'Gamma est décrit').toHaveLength(1);
    expect(
      ligne('Beta').querySelectorAll('.pj-ouv-desc'),
      'Beta n’a pas de description : PAS DE SPAN VIDE',
    ).toHaveLength(0);
    expect(texte()).toContain('le projet Gamma');
  });

  it('UN `repoUrl` PORTEUR DE JETON EST LAVÉ À L’AFFICHAGE', async () => {
    // La source lave déjà (`vuePublique`). On lave QUAND MÊME, parce que « la
    // source s'en charge » est exactement le raisonnement qui a laissé passer
    // la même fuite trois fois — voir `tests/repourl-affichage.test.ts`.
    //
    // Ce test-ci est plus fort que la garde de source : il regarde ce qui est
    // RENDU, pas ce qui est écrit. Un jour où le serveur renverrait l'URL
    // brute — régression, orchestrateur plus ancien, dépôt monté à la main —
    // la garde de source resterait verte et celui-ci rougirait.
    plan.push({
      motif: '/projects/public',
      reponses: [
        {
          statut: 200,
          corps: [
            {
              ...ouvert('p2', 'Beta'),
              repoUrl: 'https://user:ghp_le_jeton_du_proprio@github.com/micka/p2.git',
            },
          ],
        },
      ],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');

    expect(conteneur.innerHTML, 'UN JETON A FUI À L’ÉCRAN').not.toContain(
      'ghp_le_jeton_du_proprio',
    );
    expect(conteneur.innerHTML, 'ni le nom d’utilisateur qui l’accompagne').not.toContain('user:');
    expect(texte(), 'mais le dépôt reste lisible').toContain('github.com/micka/p2.git');
  });

  it('« tout rejoint » et « rien d’ouvert » ne disent pas la même chose', async () => {
    // Deux vides très différents : l'un dit que la ruche n'a rien à offrir,
    // l'autre que vous y êtes déjà partout. Les confondre laisserait croire à
    // une ruche déserte.
    plan.push({
      motif: '/projects/public',
      reponses: [
        { statut: 200, corps: [ouvert('p1', 'Alpha')] },
        { statut: 200, corps: [] },
      ],
    });
    await monter(
      <ProjetsOuverts user={LEA} dejaVus={new Set(['p1'])} onRejoint={() => undefined} />,
    );
    await cliquer('voir les projets ouverts');
    expect(texte()).toContain('déjà dans tous les projets ouverts');

    await cliquer('relire');
    expect(texte()).toContain('Aucun projet ouvert');
    expect(texte()).not.toContain('déjà dans tous');
  });
});

describe('REJOINDRE', () => {
  const avecUnProjet = (): void => {
    plan.push({
      motif: '/projects/public',
      reponses: [
        { statut: 200, corps: [ouvert('p2', 'Beta')] },
        { statut: 200, corps: [] },
      ],
    });
  };

  it('c’est un POST, et il prévient la vue quand il réussit', async () => {
    // Un GET serait rejoué par n'importe quel préchargement de navigateur, et
    // inscrirait quelqu'un sans qu'il ait rien demandé.
    let prevenu = 0;
    avecUnProjet();
    plan.push({
      motif: '/p2/join',
      methode: 'POST',
      reponses: [{ statut: 200, corps: { joined: true } }],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => prevenu++} />);
    await cliquer('voir les projets ouverts');
    await cliquer('Rejoindre');

    expect(vus.some((v) => v === 'POST /api/projects/p2/join')).toBe(true);
    expect(prevenu, 'la vue doit relire ses projets').toBe(1);
  });

  it('UN REFUS 404 NE DEVIENT JAMAIS « VOUS N’AVEZ PAS LE DROIT »', async () => {
    // LA RÈGLE DU FICHIER. Voir l'en-tête : traduire le 404 en interdiction
    // reconstruirait dans le navigateur l'information que le serveur a tue.
    avecUnProjet();
    plan.push({
      motif: '/p2/join',
      methode: 'POST',
      reponses: [{ statut: 404, corps: { error: 'projet inconnu' } }],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');
    await cliquer('Rejoindre');

    const dit = texte();
    expect(dit).toContain('n’est plus disponible');
    for (const mot of ['droit', 'interdit', 'privé', 'permission', 'refusé']) {
      expect(dit, `« ${mot} » rouvre la fuite que le 404 ferme`).not.toContain(mot);
    }
  });

  it('…et un refus RELIT la liste, qui est la réponse honnête', async () => {
    // Si le projet a disparu ou s'est refermé, la liste le dira. Laisser la
    // ligne morte à l'écran invite à recliquer sur ce qui ne peut plus marcher.
    avecUnProjet();
    plan.push({
      motif: '/p2/join',
      methode: 'POST',
      reponses: [{ statut: 404, corps: { error: 'projet inconnu' } }],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');
    await cliquer('Rejoindre');

    expect(
      vus.filter((v) => v === 'GET /api/projects/public'),
      'la liste doit être relue',
    ).toHaveLength(2);
    expect(texte(), 'la ligne morte doit avoir disparu').not.toContain('Beta');
  });

  it('une erreur QUI N’EST PAS un refus se dit telle quelle', async () => {
    // Un 500 n'est pas un refus : le retraduire en « plus disponible » ferait
    // croire à une décision là où il n'y a qu'une panne.
    avecUnProjet();
    plan.push({
      motif: '/p2/join',
      methode: 'POST',
      reponses: [{ statut: 500, corps: { error: 'base indisponible' } }],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');
    await cliquer('Rejoindre');

    expect(texte()).toContain('base indisponible');
    expect(texte()).not.toContain('n’est plus disponible');
  });

  it('PENDANT QU’UNE ADHÉSION VOYAGE, on n’en lance pas une seconde', async () => {
    plan.push({
      motif: '/projects/public',
      reponses: [{ statut: 200, corps: [ouvert('p2', 'Beta'), ouvert('p3', 'Gamma')] }],
    });
    await monter(<ProjetsOuverts user={LEA} dejaVus={new Set()} onRejoint={() => undefined} />);
    await cliquer('voir les projets ouverts');

    expect(
      boutons().filter((b) => b.disabled),
      'au repos, tout est cliquable',
    ).toHaveLength(0);
    expect(boutons().filter((b) => b.textContent?.trim() === 'Rejoindre')).toHaveLength(2);
  });
});
