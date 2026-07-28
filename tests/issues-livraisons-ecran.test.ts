// L'ÉCRAN DES ISSUES ET DES LIVRAISONS — ce qu'aucun test d'API ne verrouille.
//
// Les deux API existaient depuis les lots précédents et RIEN ne les montrait.
// Une fonctionnalité que l'écran n'expose pas n'a pas été livrée, du point de
// vue de qui regarde. Ce fichier tient le câblage.
//
// ─── MAIS SURTOUT, IL TIENT UNE RÈGLE QUI SE PERDRA ──────────────────────────
//
// **Ces deux panneaux ne se rafraîchissent pas tout seuls, et c'est une
// décision.** Chaque lecture consomme le QUOTA GITHUB DE L'HÔTE. Un
// `useApiPoll` posé là — le geste le plus naturel du monde, tout le reste du
// tableau de bord en utilise — multiplierait les appels par le nombre de cartes
// de projet à l'écran et par la fréquence du sondage.
//
// La conséquence n'est pas une lenteur : c'est que la ruche PERD SA CAPACITÉ À
// LIVRER quand le quota est épuisé, pour avoir affiché une liste que personne
// ne regardait. Le jour où quelqu'un « améliorera l'UX » en ajoutant un
// sondage, ce test doit rougir.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/** Le code, commentaires retirés : sinon une garde accuse sa propre doc. */
const sansCommentaires = (chemin: string): string =>
  readFileSync(new URL(chemin, import.meta.url), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*(?:\/\/|\*).*$/gm, '');

const VUE = sansCommentaires('../dashboard/src/views/Projets.tsx');
const API = sansCommentaires('../dashboard/src/api.ts');

/** Le corps d'un composant, du `function X(` jusqu'au prochain `\nfunction `. */
function composant(nom: string): string {
  const debut = VUE.indexOf(`function ${nom}(`);
  expect(debut, `composant ${nom} introuvable`).toBeGreaterThan(-1);
  const fin = VUE.indexOf('\nfunction ', debut + 1);
  return VUE.slice(debut, fin === -1 ? undefined : fin);
}

describe('les deux API sont enfin à l’écran', () => {
  it('les panneaux existent et sont MONTÉS dans la carte de projet', () => {
    // Un composant défini et jamais monté est du code mort qui passe pour une
    // fonctionnalité — c'est arrivé à `voir_avancement`, déclaré des mois avant
    // qu'une route le consulte.
    for (const nom of ['IssuesProjet', 'LivraisonsProjet']) {
      expect(VUE, `${nom} n’est pas défini`).toContain(`function ${nom}(`);
      expect(VUE, `${nom} n’est pas monté`).toMatch(new RegExp(`<${nom}\\s`));
    }
    const carte = composant('ProjectCard');
    expect(carte).toMatch(/<IssuesProjet\s/);
    expect(carte).toMatch(/<LivraisonsProjet\s/);
  });

  it('chaque fetcher vise la route que le serveur déclare', () => {
    expect(API).toMatch(/fetchIssues[\s\S]{0,200}\/issues`/);
    expect(API).toMatch(/prendreIssue[\s\S]{0,300}\/issues\/\$\{numero\}`/);
    expect(API).toMatch(/fetchLivraisons[\s\S]{0,200}\/livraisons`/);
    expect(API).toMatch(/reprendreLivraison[\s\S]{0,400}\/reprendre`/);
  });

  it('PRENDRE et REPRENDRE sont des POST — ce sont des gestes, pas des lectures', () => {
    // Les deux dépensent : l'un fait découper un brief par un modèle, l'autre
    // fait travailler l'essaim. Un GET qui déclencherait ça serait rejoué par
    // n'importe quel préchargement de navigateur.
    for (const fn of ['prendreIssue', 'reprendreLivraison']) {
      const i = API.indexOf(`export function ${fn}(`);
      expect(i, fn).toBeGreaterThan(-1);
      expect(API.slice(i, i + 500), `${fn} doit être un POST`).toMatch(/method: 'POST'/);
    }
  });
});

describe('LE QUOTA DE L’HÔTE — la règle qui se perdra', () => {
  it('AUCUN DES DEUX PANNEAUX NE SONDE EN BOUCLE', () => {
    // La règle du fichier. Voir l'en-tête : un sondage ici épuise le quota
    // GitHub de l'hôte, et la ruche perd sa capacité à LIVRER.
    for (const nom of ['IssuesProjet', 'LivraisonsProjet']) {
      const corps = composant(nom);
      expect(corps, `${nom} ne doit pas sonder`).not.toMatch(/useApiPoll/);
      expect(corps, `${nom} ne doit pas poser d’intervalle`).not.toMatch(/setInterval/);
    }
  });

  it('…et la lecture part d’un CLIC, pas d’un montage', () => {
    // Un `useEffect` qui charge au montage rendrait le sondage inutile : il
    // suffirait d'ouvrir la vue Projets pour lire N dépôts d'un coup.
    for (const nom of ['IssuesProjet', 'LivraisonsProjet']) {
      const corps = composant(nom);
      expect(corps, `${nom} ne doit pas charger au montage`).not.toMatch(/useEffect/);
      expect(corps, `${nom} doit charger sur un clic`).toMatch(/onClick=\{charger\}/);
    }
  });
});

describe('ce que l’écran refuse de promettre', () => {
  it('sans dépôt, les deux panneaux se taisent', () => {
    // Proposer « voir les issues » sur un projet sans dépôt offrirait un bouton
    // qui ne peut que refuser — et le refus viendrait du serveur, après un
    // aller-retour, sous forme d'erreur rouge.
    for (const nom of ['IssuesProjet', 'LivraisonsProjet']) {
      expect(composant(nom), `${nom} doit se taire sans dépôt`).toMatch(
        /if \(!project\.repoUrl\) return null;/,
      );
    }
  });

  it('UNE PULL REQUEST ILLISIBLE LE DIT, au lieu de passer pour calme', () => {
    // Le serveur rend `illisible` quand il n'a pas pu lire la PR. Une ligne
    // muette laisserait croire qu'il ne se passe rien, alors qu'on n'a pas pu
    // regarder — c'est le pire des deux mensonges possibles.
    expect(composant('LivraisonsProjet')).toMatch(/l\.illisible/);
  });

  it('REPRENDRE n’est proposé que si l’état l’appelle', () => {
    // `reprenable` vient du serveur, qui seul connaît la règle. L'écran ne la
    // redevine pas : deux copies d'une même règle finissent par diverger.
    const corps = composant('LivraisonsProjet');
    expect(corps).toMatch(/l\.reprenable && \(/);
    expect(corps, 'l’écran ne doit pas recalculer la règle').not.toMatch(/ci_rouge/);
  });
});
