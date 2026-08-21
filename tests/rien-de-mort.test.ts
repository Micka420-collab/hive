// RIEN DE MORT NE DOIT PASSER POUR VIVANT.
//
// ─── LA RÈGLE, ET POURQUOI ELLE PORTE SUR LA RÈGLE ET PAS SUR SES ENDROITS ───
//
// Ce dépôt s'est déjà fait avoir plusieurs fois par la même forme :
//
//   · `voir_avancement`, déclaré des mois avant qu'une route le consulte ;
//   · `POST /api/projects/user`, écrit pour attribuer un projet à son créateur,
//     et que PERSONNE n'appelait — tout projet naissait donc orphelin ;
//   · `GET /api/projects/public` + `POST /api/projects/:id/join`, avec une
//     garde soignée et bien testée, sans aucun écran pour frapper à la porte.
//
// Le commentaire de `repourl-affichage.test.ts` dit ce qu'il faut en conclure :
// « aucun test ne portait sur la RÈGLE, seulement sur chacun de ses endroits ».
//
// La règle est ici :
//
//     UN COMPOSANT QUE RIEN NE MONTE N'A PAS ÉTÉ LIVRÉ.
//
// Il compile, il est joli, il passe la relecture — et il ne s'affiche nulle
// part. C'est PIRE que du code absent : on le maintient, on le lit, on croit la
// fonctionnalité présente, et on ne la réécrit donc jamais.
//
// ─── CE QUE CETTE GARDE A TROUVÉ EN NAISSANT ─────────────────────────────────
//
// `HiveMindPanel` et `TaskTable` : deux composants complets, 179 lignes à eux
// deux, montés NULLE PART. Ils datent d'avant le passage aux dix vues ; la vue
// Mémoire fait exactement ce que faisait le premier, et les vues listent les
// tâches elles-mêmes. Supprimés dans le même lot que ce fichier.
//
// ─── CE QU'ELLE NE COUVRE PAS, ET IL FAUT LE DIRE ────────────────────────────
//
// · Elle regarde les EXPORTS NOMMÉS commençant par une majuscule — la
//   convention React. Les vues, elles, s'exportent par défaut et sont atteintes
//   par CHEMIN (`React.lazy(() => import('./views/Ruche'))`) : leur nom
//   n'apparaît nulle part, et les inclure ne produirait que du bruit.
//
//   CETTE LACUNE-LÀ EST COMBLÉE, PLUS BAS, PAR UNE SECONDE GARDE. Elle a été
//   écrite le jour où une vue entière — Les Chantiers — a failli être livrée
//   sans être montée : le fichier compile, la feuille de style est jolie, et
//   `#/chantiers` renvoie sur la Ruche. Exactement la panne que ce fichier
//   décrit, sur l'objet que ce fichier avait décidé de ne pas regarder.
// · Elle lit du texte, pas un graphe de modules. Un composant cité seulement
//   dans un commentaire lui semblerait vivant. Une garde imparfaite qui rougit
//   sur le geste réel vaut mieux qu'une garde parfaite qu'on n'écrit pas —
//   c'est le même parti pris que `repourl-affichage.test.ts`.
// · Elle ne dit RIEN de `src/` : un module d'orchestrateur expose légitimement
//   des fonctions que seul un test appelle, et la frontière n'y est pas nette.

import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Les fichiers d'un dossier, en profondeur (`globSync` est Node 22+). */
function fichiers(dossier: string, acc: string[] = []): string[] {
  for (const e of readdirSync(RACINE + dossier, { withFileTypes: true })) {
    const rel = `${dossier}/${e.name}`;
    if (e.isDirectory()) fichiers(rel, acc);
    else if (/\.tsx?$/.test(e.name)) acc.push(rel);
  }
  return acc;
}

/**
 * Les composants qu'on accepte de ne voir cités nulle part, AVEC la raison.
 *
 * Cette liste n'est pas une échappatoire : elle oblige à écrire pourquoi. Un
 * nom qu'on ajoute ici sans phrase se remarque à la relecture.
 */
const TOLERES: Record<string, string> = {
  // (vide — et c'est le but)
};

describe('LA RÈGLE : un composant que rien ne monte n’a pas été livré', () => {
  const tous = [...fichiers('dashboard/src'), ...fichiers('dashboard/tests'), ...fichiers('src')];
  const sources = tous.map((f) => ({ f, texte: readFileSync(RACINE + f, 'utf8') }));

  it('AUCUN COMPOSANT DU TABLEAU DE BORD N’EST ORPHELIN', () => {
    const orphelins: string[] = [];

    for (const { f, texte } of sources) {
      if (!f.startsWith('dashboard/src')) continue;
      for (const m of texte.matchAll(/^export function ([A-Z]\w*)/gm)) {
        const nom = m[1] as string;
        if (nom in TOLERES) continue;
        const cite = sources.some(
          (autre) => autre.f !== f && new RegExp(`\\b${nom}\\b`).test(autre.texte),
        );
        if (!cite) orphelins.push(`${f} — ${nom}()`);
      }
    }

    expect(
      orphelins,
      'Composant(s) monté(s) NULLE PART. Deux issues, et il faut choisir : ' +
        'le monter — ou le supprimer, parce qu’un composant que rien n’affiche ' +
        'n’a pas été livré, et coûte plus cher que du code absent.',
    ).toEqual([]);
  });

  it('la garde sait rougir — vérifié sur un orphelin fabriqué', () => {
    // Une garde qu'on ne voit jamais mordre est du décor. On rejoue ici sa
    // logique EXACTE sur un corpus inventé : un composant présent une seule
    // fois, dans son propre fichier.
    const faux = [
      // Monté par main : vivant.
      { f: 'dashboard/src/main.tsx', texte: 'render(<App />);' },
      { f: 'dashboard/src/App.tsx', texte: 'export function App() { return <Reelle />; }' },
      // Monté par App : vivant.
      { f: 'dashboard/src/Reelle.tsx', texte: 'export function Reelle() { return null; }' },
      // Défini, exporté, et cité NULLE PART : c'est celui-là qu'on cherche.
      { f: 'dashboard/src/Fantome.tsx', texte: 'export function Fantome() { return null; }' },
    ];
    const orphelins = faux.flatMap(({ f, texte }) =>
      [...texte.matchAll(/^export function ([A-Z]\w*)/gm)]
        .map((m) => m[1] as string)
        .filter((nom) => !faux.some((a) => a.f !== f && new RegExp(`\\b${nom}\\b`).test(a.texte)))
        .map((nom) => `${f} — ${nom}()`),
    );
    expect(orphelins).toEqual(['dashboard/src/Fantome.tsx — Fantome()']);
  });

  it('LES DEUX ORPHELINS CONNUS SONT BIEN PARTIS, fichiers compris', () => {
    // Supprimer l'export sans supprimer le fichier laisserait 179 lignes de
    // code mort qui compile encore — la garde redeviendrait verte sans que le
    // problème ait bougé.
    const restants = tous.filter((f) => /HiveMindPanel|TaskTable/.test(f));
    expect(restants, 'ces deux-là étaient montés nulle part').toEqual([]);
  });
});

describe('LA MÊME RÈGLE, APPLIQUÉE AUX VUES', () => {
  // ─── POURQUOI UNE SECONDE GARDE, ET PAS UN ÉLARGISSEMENT DE LA PREMIÈRE ────
  //
  // Les vues ne s'exportent pas par leur nom : `App.tsx` les atteint par chemin,
  // `lazy(() => import('./views/Ruche'))`. Leur identifiant n'existe donc dans
  // aucun autre fichier, et la garde ci-dessus ne peut structurellement pas les
  // voir. Elle le dit d'ailleurs elle-même, en en-tête.
  //
  // Or une vue non montée est le PIRE cas de la règle : c'est un écran entier —
  // composant, feuille de style, appels réseau, traductions — que personne ne
  // peut atteindre. `#/chantiers` renvoie silencieusement sur la Ruche, et rien
  // ne distingue « la vue n'existe pas » de « la vue est vide ».
  //
  // Trois choses doivent tenir ENSEMBLE pour qu'une vue existe, et les trois
  // sont vérifiées : le `lazy(import)`, l'entrée de navigation, et le rendu
  // conditionnel. Il en manque une, et la vue est inatteignable — ou pire,
  // atteignable par l'URL mais invisible dans la barre.

  // LES DEUX MONTEURS, et pas seulement `App`. `main.tsx` monte `Partage`
  // — l'écran du porteur de lien, qui n'a ni compte ni barre de navigation.
  // Ne lire que `App.tsx` l'aurait déclaré orphelin, et la garde aurait été
  // désactivée le jour même pour cause de faux positif.
  const APP =
    readFileSync(`${RACINE}dashboard/src/App.tsx`, 'utf8') +
    readFileSync(`${RACINE}dashboard/src/main.tsx`, 'utf8');

  /**
   * Les VUES présentes sur le disque.
   *
   * ─── CE QUI DISTINGUE UNE VUE D'UN MODULE DE COMPOSANTS ───────────────────
   *
   * L'`export default`, et rien d'autre. `views/` contient les deux :
   * `Balance.tsx` y vit avec 922 lignes et n'est PAS une vue — il exporte
   * `BalanceProjet`, `CarteBalance` et `CarteDevis`, que `Projets` et `Santé`
   * montent chez eux. La première garde de ce fichier le couvre déjà, par ses
   * exports nommés.
   *
   * Ce critère m'a été enseigné par une fausse accusation : la première
   * version listait tous les `.tsx` à majuscule et a déclaré la Balance
   * orpheline. J'ai failli l'écrire dans une liste de tolérance, avec une
   * phrase soignée sur les 922 lignes que personne ne peut ouvrir. C'était
   * faux, et ça aurait figé un mensonge dans le dépôt sous couvert de rigueur.
   * **Une garde qui accuse doit d'abord savoir de quoi elle parle.**
   */
  const vues = readdirSync(`${RACINE}dashboard/src/views`)
    .filter((f) => /^[A-Z]\w*\.tsx$/.test(f))
    .filter((f) =>
      /^export default function/m.test(readFileSync(`${RACINE}dashboard/src/views/${f}`, 'utf8')),
    )
    .map((f) => f.replace(/\.tsx$/, ''));

  it('il y a bien des vues à surveiller', () => {
    // Sans ce garde-fou, un `views/` renommé rendrait les trois tests suivants
    // vides — donc verts — et la garde s'éteindrait sans un mot.
    expect(vues.length).toBeGreaterThan(8);
  });

  it('CHAQUE VUE EST IMPORTÉE', () => {
    // DEUX FORMES D'IMPORT, et la seconde n'est pas un détail : la Ruche est
    // importée STATIQUEMENT parce qu'elle est la première peinture, et la
    // découper en chunk paresseux ajouterait un aller-retour réseau devant le
    // tout premier écran. N'accepter que `lazy` l'aurait déclarée orpheline.
    const manquantes = vues.filter(
      (v) => !APP.includes(`import('./views/${v}')`) && !APP.includes(`from './views/${v}'`),
    );
    expect(
      manquantes,
      'Vue(s) présente(s) sur le disque et jamais importée(s) : un écran entier ' +
        'que personne ne peut atteindre.',
    ).toEqual([]);
  });

  it('CHAQUE VUE EST RENDUE PAR UNE ROUTE', () => {
    // Importer ne suffit pas : sans la ligne `route.view === '…' && <Vue …>`,
    // le chunk est chargé et jamais affiché.
    const manquantes = vues.filter((v) => !new RegExp(`<${v}\\s`).test(APP));
    expect(manquantes, 'Vue(s) importée(s) mais jamais rendue(s).').toEqual([]);
  });

  it('CHAQUE VUE A SA CASE DANS LA BARRE — sinon elle n’existe que pour qui connaît l’URL', () => {
    // `Partage` est la seule exception historique : lien de partage, pas de barre.
    // `Chambre` (ADR 0010) : entrée depuis la fiche nœud « Ouvrir la Chambre »,
    // pas une 14ᵉ case nav — le poste d’une ouvrière n’est pas une destination
    // de barre globale.
    const SANS_CASE = new Set([
      // Le porteur de lien n'a ni compte ni barre : cet écran s'ouvre par une
      // URL de partage, et c'est tout son objet.
      'Partage',
      // Poste ouvrière : fiche nœud → `#/chambre/<nodeId>` (ADR 0010).
      'Chambre',
    ]);
    const bloc = APP.slice(APP.indexOf('const NAV: NavItem[] = ['), APP.indexOf('\n];'));
    const manquantes = vues.filter(
      (v) => !SANS_CASE.has(v) && !bloc.includes(`'${v.toLowerCase()}'`),
    );
    expect(
      manquantes,
      'Vue(s) rendue(s) mais absente(s) de la barre de navigation : atteignable ' +
        'seulement par quelqu’un qui devine l’URL.',
    ).toEqual([]);
  });
});
