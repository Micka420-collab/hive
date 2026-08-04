// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE PANNEAU DE COMPTE, RENDU ET MANIPULÉ — la porte `canSubmit`.
//
// ─── POURQUOI CE COMPOSANT PASSE EN PREMIER ──────────────────────────────────
//
// Le balayage loupe du 3 août a échantillonné le dépôt entier : ses TROIS
// premières survivantes vivent ici — le `&&` et les deux `===` de la porte
// `canSubmit`. C'est la logique qui décide si le formulaire promet ce que le
// serveur acceptera : une porte trop stricte enferme dehors un compte
// légitime, une porte trop lâche fait cliquer pour recevoir un 400.
//
// Deux règles y sont DÉLIBÉRÉES et documentées dans le composant :
//
//   · à la CONNEXION, aucune longueur minimale — un compte créé avant la
//     règle des 12 caractères doit pouvoir entrer ;
//   · à l'INSCRIPTION, 12 minimum (accordé au serveur PAR LE TYPE — un
//     désaccord casse `typecheck:dashboard`, pas l'utilisateur).
//
// On rend comme le navigateur rend (même choix que `stat-tiles.test.tsx`),
// et on tape dans les champs comme l'utilisateur tape : setter natif puis
// évènement `input` — React écoute le flux d'évènements, pas la propriété.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AccountPanel } from '../dashboard/src/AccountPanel';
import type { AuthUser } from '../dashboard/src/api';
import { setLang } from '../dashboard/src/i18n';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// La langue par défaut du composant est l'anglais : la première version de ce
// fichier cherchait « Déconnexion » dans un DOM qui disait « Sign out » — les
// quatre tests morts avant la première assertion utile. Comme
// `stat-tiles.test.tsx` : on FIXE la langue, on ne la suppose pas.
beforeEach(() => setLang('fr'));

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
  localStorage.clear();
});

function monter(ui: React.ReactElement): HTMLElement {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  act(() => racine?.render(ui));
  return conteneur;
}

/** Tape dans un champ contrôlé comme un humain : la valeur PUIS l'évènement. */
function saisir(champ: HTMLInputElement, valeur: string): void {
  act(() => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    setter?.call(champ, valeur);
    champ.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

function cliquer(el: Element): void {
  act(() => {
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function boutonParTexte(racineDom: HTMLElement, texte: string): HTMLButtonElement {
  const b = [...racineDom.querySelectorAll('button')].find((x) =>
    (x.textContent ?? '').includes(texte),
  );
  if (!b) throw new Error(`aucun bouton « ${texte} » dans :\n${racineDom.innerHTML}`);
  return b;
}

const ABEILLE: AuthUser = { id: 'u1', email: 'abeille@ruche.fr', displayName: 'Abeille' };

/** Monte le panneau déconnecté et ouvre la modale. */
function ouvrirModale(onUser: (u: AuthUser | null) => void = () => {}): {
  dom: HTMLElement;
  champs: () => { email: HTMLInputElement; mdp: HTMLInputElement; nom: HTMLInputElement | null };
  soumission: () => HTMLButtonElement;
} {
  const dom = monter(<AccountPanel user={null} onUser={onUser} />);
  cliquer(boutonParTexte(dom, 'Se connecter'));
  const modale = (): HTMLElement => {
    const m = dom.querySelector('[role="dialog"]');
    if (!m) throw new Error('la modale ne s’est pas ouverte');
    return m as HTMLElement;
  };
  return {
    dom,
    champs: () => ({
      email: modale().querySelector('input[type="email"]') as HTMLInputElement,
      mdp: modale().querySelector('input[type="password"]') as HTMLInputElement,
      nom: modale().querySelector('input[type="text"]'),
    }),
    // Par la CLASSE, pas par le texte : « Se connecter » désigne AUSSI le
    // bouton déclencheur de la barre — le repère textuel n'était pas unique,
    // et la première version jugeait l'état d'un bouton qui n'est jamais
    // désactivé (sixième occurrence du § 2 duodecies dans la journée).
    soumission: () => {
      const b = modale().querySelector('button.btn.primary');
      if (!b) throw new Error(`aucune soumission dans :\n${modale().innerHTML}`);
      return b as HTMLButtonElement;
    },
  };
}

describe('le panneau de compte — connecté', () => {
  it('LE NOM S’AFFICHE, ET LA DÉCONNEXION EFFACE LE JETON LOCAL', () => {
    localStorage.setItem('hive.jwt', 'jeton-a-effacer');
    const recus: (AuthUser | null)[] = [];
    const dom = monter(<AccountPanel user={ABEILLE} onUser={(u) => recus.push(u)} />);
    expect(dom.textContent).toContain('Abeille');

    cliquer(boutonParTexte(dom, 'Déconnexion'));
    expect(recus, 'onUser(null) doit remonter — sinon l’écran garde un fantôme').toEqual([null]);
    expect(
      localStorage.getItem('hive.jwt'),
      'le jeton doit partir avec la session — un JWT qui traîne se rejoue',
    ).toBeNull();
  });
});

describe('la porte canSubmit — les trois survivantes de la loupe', () => {
  it('CONNEXION : « @ » exigé, AUCUNE longueur minimale — un vieux compte entre', () => {
    // La règle documentée dans le composant : bloquer un mot de passe court à
    // la connexion dirait « trop court » sans issue à un compte d'avant la
    // règle. UN caractère suffit donc — c'est la frontière exacte.
    const m = ouvrirModale();
    const bouton = m.soumission;

    saisir(m.champs().email, 'sans-arobase.fr');
    saisir(m.champs().mdp, 'x');
    expect(bouton().disabled, 'un courriel sans @ ne doit pas partir').toBe(true);

    saisir(m.champs().email, 'abeille@ruche.fr');
    expect(bouton().disabled, 'un mot de passe d’UN caractère doit suffire à la CONNEXION').toBe(
      false,
    );

    saisir(m.champs().mdp, '');
    expect(bouton().disabled, 'un mot de passe vide ne part jamais').toBe(true);
  });

  it('INSCRIPTION : 12 caractères PILE passent, 11 non — la frontière au caractère près', () => {
    const m = ouvrirModale();
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    const bouton = m.soumission;

    saisir(m.champs().email, 'abeille@ruche.fr');
    const nom = m.champs().nom;
    expect(nom, 'le champ « nom affiché » doit exister en inscription').not.toBeNull();
    saisir(nom as HTMLInputElement, 'Ab');

    saisir(m.champs().mdp, 'x'.repeat(11));
    expect(bouton().disabled, '11 caractères doivent être refusés').toBe(true);

    saisir(m.champs().mdp, 'x'.repeat(12));
    expect(bouton().disabled, '12 caractères PILE doivent passer — `>=`, pas `>`').toBe(false);

    saisir(nom as HTMLInputElement, 'A');
    expect(bouton().disabled, 'un nom d’un seul caractère ne passe pas').toBe(true);
  });

  it('l’indice « 12 caractères minimum » n’apparaît qu’à l’INSCRIPTION', () => {
    // À la connexion, l'indice serait un mensonge : aucune longueur n'y est
    // exigée. Sa présence au mauvais endroit ferait renoncer un vieux compte.
    const m = ouvrirModale();
    expect(m.dom.textContent).not.toContain('12 caractères minimum');
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    expect(m.dom.textContent).toContain('12 caractères minimum');
  });

  it('LE BOUTON DIT CE QU’IL VA FAIRE — « Se connecter » ou « Créer le compte »', () => {
    // Survivante du balayage de nuit : `mode === 'login'` mutée en `!==` —
    // le bouton de soumission promettrait « Créer le compte » à quelqu'un qui
    // se connecte, et « Se connecter » à quelqu'un qui s'inscrit. Les deux
    // gestes ne sont pas réversibles de la même façon : créer un compte avec
    // une adresse déjà prise échoue, et se croire en train de créer alors
    // qu'on se connecte fait taper un mot de passe qu'on n'a pas encore.
    //
    // L'indice de longueur (test ci-dessus) bascule bien, lui — c'est une
    // AUTRE ligne. Une famille de bascules ne se garde pas par un seul de ses
    // membres.
    const m = ouvrirModale();
    expect(m.soumission().textContent, 'à la connexion, il propose de se connecter').toContain(
      'Se connecter',
    );
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    expect(m.soumission().textContent, 'à l’inscription, il propose de créer').toContain(
      'Créer le compte',
    );
    expect(m.soumission().textContent, 'et il ne dit plus l’autre').not.toContain('Se connecter');
  });
});
