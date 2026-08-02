// @vitest-environment happy-dom
//
// LE GESTE QUI COUPE.
//
// ─── POURQUOI CE FICHIER NE PEUT PAS ÊTRE UN TEST DE SOURCE ──────────────────
//
// Une garde de confirmation ne se vérifie pas en lisant du texte. La question à
// laquelle il faut répondre n'est pas « y a-t-il une confirmation ? » mais :
//
//     LE PREMIER CLIC NE DÉCLENCHE-T-IL VRAIMENT RIEN ?
//
// Une confirmation qui agit quand même, ou qui agit sur la mauvaise ligne, est
// PIRE que pas de confirmation du tout : elle donne le calme sans la sûreté, et
// on cesse de faire attention. C'est le mode d'échec qu'on vise ici.
//
// ─── LA LIGNE QUI BOUGE ──────────────────────────────────────────────────────
//
// Les listes concernées se relisent toutes seules (`useApiPoll`, 60 à 120 s).
// La ligne visée peut donc changer de place entre l'œil et le doigt. Une
// question qui dirait « êtes-vous sûr ? » confirmerait la mauvaise ligne aussi
// volontiers que la bonne — d'où l'exigence, testée plus bas, que la question
// NOMME sa cible, et que ce nom SUIVE la ligne quand la liste se réordonne.

import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { GesteIrreversible } from '../src/ui';
import { setLang } from '../src/i18n';

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// `undefined` tant que le test courant n'a rien monté : le dernier bloc de ce
// fichier lit du SOURCE, il ne rend aucun composant.
let conteneur: HTMLElement | undefined;
let racine: Root | undefined;

async function monter(element: React.ReactElement): Promise<void> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  const neuve = createRoot(conteneur);
  racine = neuve;
  await act(async () => {
    neuve.render(element);
  });
}

async function rendre(element: React.ReactElement): Promise<void> {
  const cible = racine;
  expect(cible, 'rendre() sans monter() : rien à re-rendre').toBeDefined();
  await act(async () => {
    cible!.render(element);
  });
}

const vue = (): HTMLElement => {
  expect(conteneur, 'aucun composant monté : le test doit appeler monter()').toBeDefined();
  return conteneur!;
};
const boutons = (): HTMLButtonElement[] => [...vue().querySelectorAll('button')];
const texte = (): string => vue().textContent ?? '';

/** Clique un bouton par son texte exact — et refuse de deviner s'il manque. */
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

beforeAll(() => {
  // happy-dom démarre en anglais, comme Chromium.
  setLang('fr');
});

// LE DÉMONTAGE NE SUPPOSE PLUS QU'ON A MONTÉ.
//
// Il appelait `racine.unmount()` sans condition. Les trois tests du dernier
// bloc ne montent rien — ils lisent le source des appelants — et ne devaient
// leur survie qu'à la racine laissée en place par le test précédent : ils
// démontaient l'arbre du voisin. Joué en premier, l'un d'eux trouvait
// `racine` indéfini et le fichier tombait sur « Cannot read properties of
// undefined ».
//
// Remettre les deux à `undefined` après coup est l'autre moitié : sans ça,
// deux tests sans rendu à la suite démonteraient deux fois la même racine.
afterEach(async () => {
  const aDemonter = racine;
  const aRetirer = conteneur;
  racine = undefined;
  conteneur = undefined;
  if (!aDemonter) return;
  await act(async () => {
    aDemonter.unmount();
  });
  aRetirer?.remove();
});

// ─────────────────────────────────────────────────────────────────────────────

describe('LE PREMIER CLIC NE FAIT RIEN', () => {
  it('armer n’agit pas — c’est tout l’objet du composant', async () => {
    let coups = 0;
    await monter(
      <GesteIrreversible
        libelle="✕"
        ariaLabel="Retirer du projet"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => coups++}
      />,
    );

    await cliquer('✕');
    expect(coups, 'LE PREMIER CLIC A AGI — la garde ne garde rien').toBe(0);
    expect(texte(), 'la question doit s’afficher').toContain('Retirer Léa du projet ?');
  });

  it('…et le second, sur le bon bouton, agit UNE fois', async () => {
    let coups = 0;
    await monter(
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => coups++}
      />,
    );
    await cliquer('✕');
    await cliquer('Retirer');
    expect(coups).toBe(1);
  });

  it('ANNULER ne laisse aucune trace : rien ne s’est produit, et on peut recommencer', async () => {
    let coups = 0;
    await monter(
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => coups++}
      />,
    );
    await cliquer('✕');
    await cliquer('Annuler');

    expect(coups, 'annuler ne doit RIEN déclencher').toBe(0);
    expect(texte(), 'la question doit disparaître').not.toContain('Retirer Léa');
    expect(boutons()).toHaveLength(1);

    // Désarmer ne doit pas non plus condamner le geste : on doit pouvoir
    // reprendre. Un composant qui reste bloqué au repos serait une régression
    // silencieuse — le bouton est là, il ne sert plus à rien.
    await cliquer('✕');
    await cliquer('Retirer');
    expect(coups).toBe(1);
  });

  it('confirmer DÉSARME : deux passages ne comptent pas double', async () => {
    // Si l'état armé survivait à la confirmation, un clic de plus au même
    // endroit rejouerait le geste. Sur « retirer un membre » c'est sans effet ;
    // sur un geste qui compte, ce serait une deuxième exécution non voulue.
    let coups = 0;
    await monter(
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => coups++}
      />,
    );
    await cliquer('✕');
    await cliquer('Retirer');
    expect(
      boutons().map((b) => b.textContent?.trim()),
      'on doit être revenu au repos',
    ).toEqual(['✕']);
    expect(coups).toBe(1);
  });
});

describe('CE QUI RESTE PRÈS DU POINT DE DÉPART NE FAIT RIEN', () => {
  it('la confirmation n’est PAS le premier élément de la rangée armée', async () => {
    // L'armement remplace le bouton à la même place : un double-clic retombe à
    // quelques pixels du premier. La question, puis « Annuler », éloignent la
    // confirmation de cet endroit-là. Si l'ordre s'inversait un jour, la garde
    // deviendrait franchissable d'un double-clic — sans qu'aucun test ne bouge,
    // sauf celui-ci.
    await monter(
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => undefined}
      />,
    );
    await cliquer('✕');

    const libelles = boutons().map((b) => b.textContent?.trim());
    expect(libelles, 'Annuler doit précéder la confirmation').toEqual(['Annuler', 'Retirer']);

    const rangee = vue().querySelector('.geste-irr');
    expect(rangee?.firstElementChild?.className, 'la question vient en tête').toContain(
      'geste-irr-q',
    );
  });

  it('un double-clic sur le bouton d’armement ne confirme rien', async () => {
    // La simulation la plus proche du geste réel : deux clics au même endroit,
    // sans laisser React redessiner entre les deux.
    let coups = 0;
    await monter(
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => coups++}
      />,
    );
    const armer = boutons()[0] as HTMLButtonElement;
    await act(async () => {
      armer.click();
      armer.click();
    });
    expect(coups, 'un double-clic ne doit pas franchir la garde').toBe(0);
  });
});

describe('LA QUESTION NOMME SA CIBLE', () => {
  it('quand la liste se réordonne, la question armée SUIT sa ligne', async () => {
    // Le cœur du sujet. `useApiPoll` relit ces listes toutes les 60 à 120 s.
    // Si l'état armé était rangé par POSITION plutôt que par identité, la
    // question afficherait « Léa » et le clic couperait Marc.
    //
    // Vérifié en mutant : keyer cette liste-ci par index au lieu de `g.id`
    // fait rougir le test. Il mesure donc bien ce qu'il prétend.
    //
    // CE QU'IL NE COUVRE PAS, ET IL FAUT LE DIRE : il rend sa PROPRE liste. Il
    // établit que l'état armé suit l'identité, il ne surveille pas les clés des
    // trois listes réelles (`m.userId`, `l.id`, `n.nodeId`). Un `key={i}` posé
    // là-bas casserait la garde sans faire bouger ce fichier — mais il
    // casserait aussi le rendu des listes en général, bien au-delà d'ici. Une
    // expression régulière qui tenterait de surveiller ces clés à distance
    // serait fragile, et une garde fragile finit par être désactivée.
    const gens = [
      { id: 'u-lea', nom: 'Léa' },
      { id: 'u-marc', nom: 'Marc' },
    ];
    const coupes: string[] = [];
    const liste = (ordre: typeof gens) => (
      <ul>
        {ordre.map((g) => (
          <li key={g.id}>
            <GesteIrreversible
              libelle="✕"
              question={`Retirer ${g.nom} du projet ?`}
              confirmer="Retirer"
              onConfirmer={() => coupes.push(g.id)}
            />
          </li>
        ))}
      </ul>
    );

    await monter(liste(gens));
    await cliquer('✕'); // on arme la PREMIÈRE ligne : Léa
    expect(texte()).toContain('Retirer Léa du projet ?');

    // Le sondage revient, l'ordre a changé.
    await rendre(liste([gens[1] as (typeof gens)[0], gens[0] as (typeof gens)[0]]));

    expect(texte(), 'la question doit encore parler de Léa').toContain('Retirer Léa du projet ?');
    expect(texte(), 'et surtout pas de Marc').not.toContain('Retirer Marc du projet ?');

    await cliquer('Retirer');
    expect(coupes, 'LA MAUVAISE PERSONNE A ÉTÉ COUPÉE').toEqual(['u-lea']);
  });

  it('le repos porte la question en infobulle, et l’icône a un nom lisible', async () => {
    // « ✕ » ne se lit pas : sans `aria-label`, un lecteur d'écran annonce un
    // bouton anonyme qui coupe l'accès de quelqu'un.
    await monter(
      <GesteIrreversible
        libelle="✕"
        ariaLabel="Retirer du projet"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        onConfirmer={() => undefined}
      />,
    );
    const armer = boutons()[0] as HTMLButtonElement;
    expect(armer.getAttribute('aria-label')).toBe('Retirer du projet');
    expect(armer.getAttribute('title')).toBe('Retirer Léa du projet ?');
  });
});

describe('CE QUE LA GARDE FAIT PENDANT QUE ÇA TRAVAILLE', () => {
  it('occupé, NI armer NI confirmer ne répondent', async () => {
    // `disabled` vient du parent, qui sait qu'un appel est en vol. Sans cette
    // propagation dans l'état armé, on confirmerait une seconde révocation
    // pendant que la première voyage.
    let coups = 0;
    const vue = (occupe: boolean) => (
      <GesteIrreversible
        libelle="✕"
        question="Retirer Léa du projet ?"
        confirmer="Retirer"
        disabled={occupe}
        onConfirmer={() => coups++}
      />
    );

    await monter(vue(true));
    expect((boutons()[0] as HTMLButtonElement).disabled, 'au repos, occupé = inerte').toBe(true);

    await rendre(vue(false));
    await cliquer('✕');
    await rendre(vue(true));

    for (const b of boutons()) {
      expect(b.disabled, `« ${b.textContent} » doit être inerte pendant le travail`).toBe(true);
      await act(async () => {
        b.click();
      });
    }
    expect(coups, 'un bouton inerte ne doit rien déclencher').toBe(0);
  });
});

describe('LES APPELANTS — ce que le composant ne peut pas garantir seul', () => {
  // Ces trois-là sont des gardes de SOURCE, et elles le sont à dessein : le
  // composant est juste, mais rien ne force un appelant à s'en servir. Le jour
  // où quelqu'un rebranche un `onClick` direct sur `retirerMembre`, la garde
  // disparaît sans qu'aucun test de rendu ne bouge.

  const sansCommentaires = (chemin: string): string =>
    readFileSync(new URL(chemin, import.meta.url), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*(?:\/\/|\*).*$/gm, '');

  it('les trois gestes irréversibles passent TOUS par la garde', async () => {
    const PROJETS = sansCommentaires('../src/views/Projets.tsx');
    const INTENDANCE = sansCommentaires('../src/views/Intendance.tsx');

    for (const [source, appel, ou] of [
      [PROJETS, 'retirerMembre(', 'Projets'],
      [PROJETS, 'revoquer(l.id)', 'Projets'],
      [INTENDANCE, 'revoquerNoeud(', 'Intendance'],
    ] as const) {
      const i = source.indexOf(appel);
      expect(i, `${appel} introuvable dans ${ou}`).toBeGreaterThan(-1);
      // L'appel doit être dans un `onConfirmer`, pas dans un `onClick`.
      const avant = source.slice(Math.max(0, i - 400), i);
      expect(avant, `${appel} (${ou}) doit partir d’une confirmation`).toMatch(/onConfirmer=\{/);
    }
  });

  it('RÉVOQUER UN BILLET RESTE NU — et c’est la décision, pas un oubli', () => {
    // Le panneau l'écrit : « Le révoquer ne déconnecte personne. » Mettre une
    // garde ici apprendrait à cliquer à travers les gardes, et celle d'à côté —
    // qui coupe une machine — se ferait traverser aussi.
    const INTENDANCE = sansCommentaires('../src/views/Intendance.tsx');
    const i = INTENDANCE.indexOf('revoquerBillet(b.id)');
    expect(i).toBeGreaterThan(-1);
    expect(INTENDANCE.slice(Math.max(0, i - 400), i)).toMatch(/onClick=\{/);
  });

  it('la question de chaque appelant NOMME sa cible', () => {
    // Une question figée (« Êtes-vous sûr ? ») ne rattraperait pas une ligne
    // qui a glissé sous le curseur — c'est précisément ce contre quoi tout ce
    // fichier existe.
    const gestes = ['../src/views/Projets.tsx', '../src/views/Intendance.tsx'].flatMap((f) => [
      ...sansCommentaires(f).matchAll(/<GesteIrreversible[\s\S]{0,800}?\/>/g),
    ]);
    expect(gestes.length, 'trois gestes gardés attendus').toBe(3);
    for (const g of gestes) {
      expect(g[0], 'chaque geste doit poser une question').toMatch(/question=\{/);
      expect(g[0], 'la question doit interpoler le nom de sa cible').toMatch(/\$\{nom\}/);
      expect(g[0], 'la confirmation doit porter un verbe, jamais « OK »').toMatch(
        /confirmer=\{t\(/,
      );
    }
  });
});
