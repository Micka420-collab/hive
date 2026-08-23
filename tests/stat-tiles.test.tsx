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
import type { NoteVue } from '../dashboard/src/horloge-vue';

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

function rendre(tasks: Task[], tasksTotal: number, calibration?: NoteVue): string {
  const snapshot: StateSnapshot = { projects: [], nodes: NOEUDS, tasks, tasksTotal };
  const hote = document.createElement('div');
  document.body.appendChild(hote);
  const racine = createRoot(hote);
  act(() => {
    racine.render(<StatTiles snapshot={snapshot} throughput={0} calibration={calibration} />);
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

describe('LA TUILE DE L’HORLOGE — une horloge qui affiche sa propre erreur', () => {
  // ─── CE QUE CETTE TUILE CHANGE ─────────────────────────────────────────────
  //
  // Une horloge qui affiche son erreur est utilisable ; une horloge faussement
  // précise ne l'est pas. Tant que la note reste dans le journal sans jamais
  // atteindre un écran, personne ne la regarde — et l'intervalle redevient un
  // chiffre qu'on croit sur parole.

  const TACHE = [tache('a', 'done')];

  it('SANS NOTE : aucune tuile — et surtout pas une tuile vide', () => {
    // La moitié qui tue la garde `calibration &&`. Une tuile « Horloge tenue »
    // affichant « — » se lirait « la ruche ne se note pas », alors que la
    // vérité est « le journal ne s'en souvient plus ».
    const html = rendre(TACHE, 1);
    expect(html).not.toContain('Horloge tenue');
  });

  // ─── L'ANCRE, ET POURQUOI ELLE A DÛ ÊTRE RESSERRÉE ─────────────────────────
  //
  // Le balayage a laissé TROIS survivantes sur la ligne de valeur de cette
  // tuile. Cause : mes assertions portaient sur le texte ENTIER du rendu, où
  // « 81 » et « % » apparaissent aussi dans le sous-titre (« 81 % tenues,
  // visée 80 % »). Une valeur mutée en « — » restait donc verte, le sous-titre
  // fournissant à lui seul de quoi satisfaire la garde.
  //
  // C'est la cécité de § 9 septemseptuagicenties sous une troisième forme :
  // affirmer sur un texte qui contient DEUX sources, c'est ne rien affirmer sur
  // aucune des deux. La classe `tile-value-mot` n'appartient qu'à cette tuile.
  const valeur = (html: string): string => {
    const m = /<div class="tile-value tile-value-mot">([\s\S]*?)<\/div>/.exec(html);
    // `m?.[1]` et non `m[1]` : le groupe capturant est typé optionnel, et lui
    // opposer un `!` échangerait une vérification contre une promesse — le banc
    // rendrait alors « undefined » au lieu d'échouer là où il doit.
    const dedans = m?.[1];
    if (dedans === undefined) throw new Error('la valeur de la tuile d’horloge est introuvable');
    return dedans.replace(/<[^>]+>/g, '');
  };

  it('AVEC NOTE : la VALEUR porte le pourcentage, et la phrase porte la visée', () => {
    const html = rendre(TACHE, 1, { verdict: 'honnete', n: 42, partTenue: 0.81, ecart: 0.01 });
    expect(html).toContain('Horloge tenue');
    // La valeur, et rien qu'elle : « 81 » et « % » ensemble, sans tiret.
    expect(valeur(html)).toContain('81');
    expect(valeur(html), 'l’unité manque à la valeur').toContain('%');
    expect(valeur(html), 'une note chiffrée ne se rend pas en tiret').not.toContain('—');
    const texte = html.replace(/<[^>]+>/g, '');
    expect(texte).toContain('honnête');
    expect(texte).toContain('42 obs.');
  });

  it('OPTIMISTE est la SEULE peinte en alerte, et l’asymétrie est voulue', () => {
    // ─── POURQUOI PAS PESSIMISTE AUSSI ──────────────────────────────────────
    //
    // `optimiste` veut dire que l'horloge promet PLUS COURT que la réalité :
    // tout ce qui se planifie dessus déborde. `pessimiste` coûte de l'attente ;
    // `optimiste` coûte des promesses tenues par personne. Peindre les deux
    // pareil effacerait la seule chose que le verdict sert à dire.
    const opt = rendre(TACHE, 1, { verdict: 'optimiste', n: 20, partTenue: 0.4, ecart: -0.4 });
    const pes = rendre(TACHE, 1, { verdict: 'pessimiste', n: 20, partTenue: 0.99, ecart: 0.19 });
    const hon = rendre(TACHE, 1, { verdict: 'honnete', n: 20, partTenue: 0.79, ecart: -0.01 });
    // Le décor est choisi pour que « danger » ne puisse venir que d'ici : la
    // seule autre tuile qui le porte est celle des ÉCHECS, et ce décor n'en a
    // aucun (une tâche, terminée). Sans cette précaution, l'assertion serait
    // vraie pour la mauvaise raison.
    expect(rendre(TACHE, 1), 'le décor porte déjà un danger').not.toContain('danger');
    expect(opt, 'l’optimisme doit se voir').toContain('danger');
    expect(pes, 'le pessimisme n’est pas une panne').not.toContain('danger');
    expect(hon, 'une horloge honnête n’alerte pas').not.toContain('danger');
  });

  it('TROP PEU : un tiret, et AUCUNE unité — jamais « 0 % »', () => {
    // « 0 % tenues » ferait passer un manque de données pour un échec — la même
    // faute que noter comme raté un refus de chiffrer.
    //
    // Les deux assertions sur la VALEUR sont les moitiés qui tuent les deux
    // mutants de l'unité : `&&` → `||` la rendrait ici, `!==` → `===` la
    // retirerait de la note chiffrée. Sans elles, « — % » et « 0 » passaient.
    const html = rendre(TACHE, 1, { verdict: 'trop_peu', n: 3, partTenue: 0, ecart: 0 });
    expect(valeur(html), 'un manque de données se dit en tiret').toContain('—');
    expect(valeur(html), 'une unité sans chiffre ne veut rien dire').not.toContain('%');
    expect(valeur(html), 'zéro n’est pas la note d’une ruche muette').not.toContain('0');
    const texte = html.replace(/<[^>]+>/g, '');
    expect(texte).toContain('Horloge tenue');
    expect(texte).toContain('pas assez');
  });
});
