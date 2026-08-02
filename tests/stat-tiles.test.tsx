// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA RANGÉE DE KPI, RENDUE — et la seule chose qu'elle ne doit jamais taire.
//
// ─── LE DÉFAUT QUE CE FICHIER EMPÊCHE ────────────────────────────────────────
//
// Depuis le lot 17, l'instantané ne transporte plus la table des tâches en
// entier : au-delà de 2 000, il n'en porte que les vivantes et les terminées les
// plus récentes. `tasksTotal` dit le compte réel.
//
// Une rangée de KPI qui afficherait « 1 200 / 2 000 » sur une ruche qui en a
// 20 000 serait fausse dans les deux sens à la fois — le numérateur ne voit
// qu'une fenêtre, et le dénominateur ferait croire qu'il n'y a rien d'autre.
// C'est le mode de panne que ce dépôt redoute le plus : un affichage tronqué
// qui a l'air complet, donc que personne ne va vérifier.
//
// La loupe a rendu `{tronque && (…)}` SANS TEST. Une condition qu'aucun test
// n'exerce est une condition qu'on peut inverser sans rien casser — et celle-ci
// décide si l'écran dit la vérité ou non.

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, describe, expect, it } from 'vitest';
import { StatTiles } from '../dashboard/src/StatTiles';
import { setLang } from '../dashboard/src/i18n';
import type { HiveNode, StateSnapshot, Task } from '../src/shared/types';

// ─── POURQUOI UN RENDU CLIENT, ET PAS `renderToStaticMarkup` ─────────────────
//
// Le rendu serveur a refusé net : « Missing getServerSnapshot ». `useLang`
// s'abonne à la langue par `useSyncExternalStore`, qui exige un troisième
// argument pour le rendu serveur — et l'ajouter aurait été modifier le code de
// l'application pour arranger un test.
//
// On rend donc comme le navigateur rend. C'est aussi ce qui exerce vraiment le
// hook, plutôt qu'un chemin que la ruche n'emprunte jamais.
// Le type est déjà déclaré par les types de React ; on ne fait que le poser.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Une tâche minimale, dans l'état voulu. */
function tache(id: string, status: Task['status']): Task {
  return {
    id,
    projectId: 'p1',
    title: `tâche ${id}`,
    prompt: '',
    status,
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
  };
}

const NOEUDS: HiveNode[] = [];

// La langue est un état de module, partagé entre les tests. Sans ce
// rétablissement, le premier test qui bascule en anglais fait mentir les
// suivants — et le rapport accuse le composant.
beforeEach(() => {
  setLang('fr');
});

function rendre(tasks: Task[], tasksTotal: number): string {
  const snapshot: StateSnapshot = { projects: [], nodes: NOEUDS, tasks, tasksTotal };
  const hote = document.createElement('div');
  document.body.appendChild(hote);
  const racine = createRoot(hote);
  act(() => {
    racine.render(<StatTiles snapshot={snapshot} throughput={0} />);
  });
  const html = hote.innerHTML;
  act(() => {
    racine.unmount();
  });
  hote.remove();
  return html;
}

describe('LA RANGÉE DE KPI DIT QUAND ELLE NE VOIT QU’UNE FENÊTRE', () => {
  it('la garde sait de quoi elle parle : le rendu produit bien quelque chose', () => {
    // Sans cette borne, une erreur de rendu rendrait '' et TOUTES les
    // assertions « ne contient pas » ci-dessous passeraient au vert.
    const html = rendre([tache('a', 'done')], 1);
    expect(html.length, 'le composant n’a rien rendu').toBeGreaterThan(200);
    expect(html, 'la tuile des tâches a disparu').toContain('Tâches terminées');
  });

  it('instantané COMPLET : aucune mention de fenêtre', () => {
    const html = rendre([tache('a', 'done'), tache('b', 'running')], 2);
    expect(html, 'une fenêtre est annoncée alors qu’il n’y en a pas').not.toContain('au total');
  });

  it('instantané TRONQUÉ : la fenêtre ET le total sont écrits', () => {
    const html = rendre([tache('a', 'done'), tache('b', 'running')], 20_000);
    expect(html, 'la troncature est passée sous silence').toContain('au total');
    expect(html, 'le total réel n’est pas affiché').toContain('20000');
    // La phrase se lit en entier plutôt qu'en fragments de balisage : elle
    // porte la taille de la fenêtre ET le total, et c'est le couple qui
    // informe. Une assertion sur `2</div>` dépendrait de la façon dont React
    // découpe ses nœuds de texte — une garde qui rougit sur un reformatage
    // finit désactivée.
    expect(html.replace(/<[^>]+>/g, ''), 'la phrase de fenêtre est incomplète').toContain(
      'sur les 2 plus récentes · 20000 au total',
    );
  });

  it('le cas limite — un seul de plus — est déjà une troncature', () => {
    // `>` et non `>=` : à égalité, rien n'est caché, et annoncer une fenêtre
    // inexistante userait l'avertissement jusqu'à ce qu'on ne le lise plus.
    expect(rendre([tache('a', 'done')], 1), 'égalité prise pour une troncature').not.toContain(
      'au total',
    );
    expect(rendre([tache('a', 'done')], 2), 'un écart de 1 n’est pas signalé').toContain(
      'au total',
    );
  });

  it('l’avis de fenêtre est TRADUIT — pas seulement présent en français', () => {
    // Une moitié des visiteurs lit l'anglais. Un avertissement qui n'existe que
    // dans une langue est un avertissement absent pour l'autre moitié.
    setLang('en');
    const html = rendre([tache('a', 'done')], 20_000);
    expect(html, 'l’avis n’apparaît pas en anglais').toContain('in total');
    expect(html, 'du français a fui dans la version anglaise').not.toContain('au total');
  });

  it('la fraction reste celle de la FENÊTRE, pas un mélange', () => {
    // On ne bricole pas `done / tasksTotal` : le numérateur ne voit que la
    // fenêtre. Une ruche à 20 000 tâches presque toutes finies afficherait
    // « 1 / 20000 » — un chiffre faux, et alarmant pour rien.
    const html = rendre([tache('a', 'done'), tache('b', 'running')], 20_000);
    expect(html, 'le dénominateur de la fraction a été remplacé par le total').toContain(
      '/2</span>',
    );
  });
});
