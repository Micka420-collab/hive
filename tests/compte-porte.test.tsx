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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─── CE QU'ON SIMULE, ET CE QU'ON LAISSE VRAI ────────────────────────────────
//
// SEULS les quatre appels réseau de l'envoi sont simulés. `clearJwt` reste le
// VRAI : le banc de déconnexion, plus haut, vérifie qu'il vide réellement
// `localStorage`, et le simuler rendrait cette assertion creuse — elle
// passerait sur un `clearJwt` qui ne ferait plus rien.
vi.mock('../dashboard/src/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  authLogin: vi.fn(() => Promise.resolve({ token: 'jeton-de-connexion' })),
  authRegister: vi.fn(() => Promise.resolve({ token: 'jeton-d-inscription' })),
  authMe: vi.fn(() =>
    Promise.resolve({ id: 'u1', email: 'abeille@ruche.fr', displayName: 'Abeille' }),
  ),
  saveJwt: vi.fn(),
}));

import { AccountPanel } from '../dashboard/src/AccountPanel';
import { authLogin, authRegister } from '../dashboard/src/api';
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

// ─── L'ENVOI : QUELLE OPÉRATION PART RÉELLEMENT ──────────────────────────────
//
// Tout ce qui précède éprouve ce que la modale MONTRE — le libellé du bouton,
// l'indice de longueur, l'état de la porte. Rien n'éprouvait ce qu'elle FAIT.
//
// Le fichier le dit lui-même quelques lignes plus haut : « une famille de
// bascules ne se garde pas par un seul de ses membres ». `mode === 'login'`
// apparaît plusieurs fois dans le composant, et celle de `submit()` — la seule
// qui choisisse l'appel réseau — n'était éprouvée nulle part. Nudité vérifiée
// contre la suite ENTIÈRE avant d'écrire : 3 330 tests verts avec `!==` en
// place (§ 2 septdecies).
//
// Mutée, elle ne change pas un affichage, elle change L'OPÉRATION D'IDENTIFIANTS
// envoyée au serveur :
//
//   · si l'adresse existe déjà, quelqu'un qui se connecte lit « email déjà
//     utilisé », sans raison de soupçonner l'écran plutôt que sa mémoire ;
//   · si l'adresse est libre — une faute de frappe suffit — un compte NEUF est
//     créé en silence et la session s'ouvre dessus. La personne se croit chez
//     elle et ne voit AUCUN de ses projets, tandis que son vrai compte n'a pas
//     bougé. C'est le pire des deux : rien ne casse, tout répond.
//
// Le libellé du bouton, lui, resterait juste — il vient d'une AUTRE ligne. Un
// écran parfaitement cohérent enverrait donc la mauvaise requête.

describe('l’envoi — quelle opération part réellement', () => {
  beforeEach(() => {
    vi.mocked(authLogin).mockClear();
    vi.mocked(authRegister).mockClear();
  });

  it('CONNEXION : c’est `authLogin` qui part, JAMAIS `authRegister`', async () => {
    // LA garde. Mutée, cette assertion tombe : « Se connecter » créerait un compte.
    const m = ouvrirModale();
    saisir(m.champs().email, 'abeille@ruche.fr');
    saisir(m.champs().mdp, 'un-mot-de-passe');
    await act(async () => m.soumission().click());

    expect(vi.mocked(authLogin), 'se connecter, c’est se connecter').toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(authRegister),
      'créer un compte n’a PAS été demandé — le faire ouvrirait un compte fantôme',
    ).not.toHaveBeenCalled();
  });

  it('INSCRIPTION : c’est `authRegister` qui part, JAMAIS `authLogin`', async () => {
    // L'autre moitié du contraste. Les deux ensemble rendent l'échange
    // impossible : aucune mutation ne peut les satisfaire toutes les deux.
    const m = ouvrirModale();
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    saisir(m.champs().email, 'abeille@ruche.fr');
    saisir(m.champs().nom as HTMLInputElement, 'Abeille');
    saisir(m.champs().mdp, 'x'.repeat(12));
    await act(async () => m.soumission().click());

    expect(vi.mocked(authRegister), 's’inscrire, c’est s’inscrire').toHaveBeenCalledTimes(1);
    expect(vi.mocked(authLogin), 'la connexion n’a PAS été tentée').not.toHaveBeenCalled();
  });

  it('L’INSCRIPTION PORTE LE NOM AFFICHÉ — la signature aussi diffère', async () => {
    // Les deux appels n'ont pas la même forme : un `authRegister` sans nom
    // créerait un compte anonyme si le serveur était plus permissif. Éprouver
    // les ARGUMENTS, pas seulement le nom de la fonction appelée.
    const m = ouvrirModale();
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    saisir(m.champs().email, 'abeille@ruche.fr');
    saisir(m.champs().nom as HTMLInputElement, 'Abeille');
    saisir(m.champs().mdp, 'x'.repeat(12));
    await act(async () => m.soumission().click());

    expect(vi.mocked(authRegister)).toHaveBeenCalledWith(
      'abeille@ruche.fr',
      'x'.repeat(12),
      'Abeille',
    );
  });

  it('LES DEUX MODES N’APPELLENT JAMAIS LA MÊME CHOSE — dit explicitement', async () => {
    // La propriété nommée pour elle-même, afin qu'elle survive à une réécriture
    // séparée des deux bancs ci-dessus.
    const m = ouvrirModale();
    saisir(m.champs().email, 'abeille@ruche.fr');
    saisir(m.champs().mdp, 'un-mot-de-passe');
    await act(async () => m.soumission().click());
    const apresConnexion = [
      vi.mocked(authLogin).mock.calls.length,
      vi.mocked(authRegister).mock.calls.length,
    ];

    // LA MODALE S'EST REFERMÉE — `submit()` appelle `onClose()` quand l'appel
    // réussit. C'est le comportement voulu, et il fallait le constater plutôt
    // que le supposer : la première version de ce banc cherchait l'onglet
    // « Inscription » dans un panneau qui n'affichait plus qu'un bouton.
    cliquer(boutonParTexte(m.dom, 'Se connecter'));
    cliquer(boutonParTexte(m.dom, 'Inscription'));
    saisir(m.champs().email, 'abeille@ruche.fr');
    saisir(m.champs().nom as HTMLInputElement, 'Abeille');
    saisir(m.champs().mdp, 'x'.repeat(12));
    await act(async () => m.soumission().click());
    const apresInscription = [
      vi.mocked(authLogin).mock.calls.length,
      vi.mocked(authRegister).mock.calls.length,
    ];

    expect(apresConnexion, 'la connexion n’appelle QUE login').toEqual([1, 0]);
    expect(apresInscription, 'l’inscription n’ajoute QUE register').toEqual([1, 1]);
  });
});

// ─── LES DEUX DERNIÈRES BASCULES, TROUVÉES EN MUTANT LES VOISINES ────────────
//
// En rejouant la survivante de l'envoi, j'ai muté les six autres `mode ===
// 'login'` du composant pour vérifier que le banc neuf ne les confondait pas
// avec la sienne. Deux ont SURVÉCU. Les mesurer et les laisser nues aurait été
// pire que ne pas les avoir regardées : le silence se relit comme « couvert ».

describe('les bascules que la mutation des voisines a débusquées', () => {
  it('LE TITRE DE LA MODALE SUIT LE MODE — pas seulement l’onglet et le bouton', () => {
    // Muté, l'écran se contredit lui-même : l'onglet dit « Connexion », le
    // bouton dit « Se connecter », et le titre annonce « Créer un compte ».
    // On vise le titre PAR SON ID : « Connexion » est aussi le texte de
    // l'onglet, et un repère non unique jugerait le mauvais élément — le
    // § 2 duodecies, déjà payé plus haut dans ce fichier.
    const m = ouvrirModale();
    const titre = (): string => m.dom.querySelector('#account-title')?.textContent ?? '';

    expect(titre(), 'à l’ouverture, on se connecte').toContain('Connexion');
    expect(titre(), 'et on ne propose pas l’inverse').not.toContain('Créer un compte');

    cliquer(boutonParTexte(m.dom, 'Inscription'));
    expect(titre(), 'après bascule, on crée un compte').toContain('Créer un compte');
  });

  it('LE CHAMP MOT DE PASSE DIT AU GESTIONNAIRE CE QU’IL DOIT FAIRE', () => {
    // `autocomplete` est invisible à l'œil, donc personne ne remarque jamais
    // qu'il ment — et il ment dans les deux sens :
    //
    //   · `new-password` à la CONNEXION : le gestionnaire propose de GÉNÉRER un
    //     mot de passe au lieu de remplir celui qui est enregistré ;
    //   · `current-password` à l'INSCRIPTION : il remplit un mot de passe
    //     EXISTANT dans un compte neuf, et la réutilisation se fait toute seule.
    //
    // C'est exactement le genre de défaut qui reste en place des années : rien
    // ne casse, rien ne s'affiche, et seul un gestionnaire de mots de passe s'en
    // aperçoit — sans pouvoir le dire.
    const m = ouvrirModale();
    expect(m.champs().mdp.getAttribute('autocomplete'), 'connexion : remplir l’existant').toBe(
      'current-password',
    );

    cliquer(boutonParTexte(m.dom, 'Inscription'));
    expect(m.champs().mdp.getAttribute('autocomplete'), 'inscription : en proposer un neuf').toBe(
      'new-password',
    );
  });
});
