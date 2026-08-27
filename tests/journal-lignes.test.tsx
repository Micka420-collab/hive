// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LE JOURNAL : CE QUE CHAQUE LIGNE DIT, DANS LES DEUX LANGUES.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// § 9 sexquinquagicenties, mesuré sur la Mémoire : une décision écrite DANS une
// chaîne traduite est autant de gardes qu'il y a de langues. Le recensement côté
// source avait nommé cinq appels `t(fr, en)` portant une décision ; deux sont
// fermés (Memoire). Deux des trois restants vivent ici.
//
// Mesuré AVANT d'écrire une ligne de banc — les six membres, un mutant à la
// fois, contre la suite entière :
//
//     NU · J1-FR  conflit  : String(p.severity ?? '')  →  String(p.severity)
//     NU · J1-EN  conflict : String(p.severity ?? '')  →  String(p.severity)
//     NU · J2-FR  course   : Array.isArray(p.drones)   →  !Array.isArray(…)
//     NU · J2-EN  race     : Array.isArray(p.drones)   →  !Array.isArray(…)
//
// Quatre sur quatre nues. Le Journal n'avait AUCUN banc à lui : il est monté
// par `vues-sentinelles` et `modales-echap`, qui regardent la coquille et pas le
// TEXTE des lignes.
//
// ─── CE QUE CHAQUE MUTATION COÛTE ────────────────────────────────────────────
//
// · `String(p.severity ?? '')` — sans le repli, un conflit dont la gravité n'est
//   pas remontée affiche « conflit undefined : … ». Le mot anglais du défaut
//   JavaScript, en plein milieu d'une phrase française, sur la ligne qui doit
//   avertir d'un conflit de fichiers.
//
// · `Array.isArray(p.drones) ? p.drones.length : p.factor` — le journal compte
//   les drones RÉELLEMENT enrôlés quand la liste est là, et retombe sur le
//   nombre DEMANDÉ quand elle ne l'est pas. Inversé, une course de trois drones
//   annoncerait le facteur brut : on lit un chiffre qui n'est pas ce qui vole.

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Journal } from '../dashboard/src/Journal';
import { setLang } from '../dashboard/src/i18n';
import type { HiveEvent } from '../src/shared/types';
import { couperLeReseau } from './aide/sans-reseau';

let racine: Root | null = null;
let conteneur: HTMLElement | null = null;

beforeEach(() => {
  // Coupe le réseau : ce banc ouvrait de VRAIES connexions vers
  // 127.0.0.1:3000 (voir tests/aide/sans-reseau.ts).
  couperLeReseau();
  setLang('fr');
});

afterEach(() => {
  act(() => racine?.unmount());
  conteneur?.remove();
  racine = null;
  conteneur = null;
});

/**
 * Un événement du journal, dans la forme RÉELLE de `HiveEvent`.
 *
 * L'annotation est la garde : un décor non typé peut décrire un monde que le
 * code ne produit jamais, et le banc meurt alors sur son décor au lieu de
 * rougir sur ce qu'il vise (§ 9 terquinquagicenties).
 */
const evenement = (type: string, payload: Record<string, unknown>): HiveEvent => ({
  id: 1,
  ts: 1_700_000_000_000,
  type,
  payload,
});

/** Le TEXTE de la ligne, pas le texte du panneau : l'icône et l'heure sont à côté. */
function ligne(dom: HTMLElement): string {
  const t = dom.querySelector('.journal .jrow .jtext');
  if (!t) throw new Error('aucune ligne de journal rendue');
  return t.textContent ?? '';
}

async function monter(ev: HiveEvent): Promise<HTMLElement> {
  conteneur = document.createElement('div');
  document.body.appendChild(conteneur);
  racine = createRoot(conteneur);
  await act(async () => racine?.render(<Journal events={[ev]} />));
  return conteneur;
}

describe('la ligne de conflit nomme sa gravité — et se tait quand elle l’ignore', () => {
  it('UNE GRAVITÉ CONNUE EST DITE', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER ──────────────────────────────────
    //
    // Sans lui, le cas suivant serait vert sur un journal qui n'affiche rien.
    // Les chemins sont tronqués à 8 signes par `short` : on les choisit donc
    // distincts DANS ces huit signes, sinon la ligne dirait deux fois la même
    // chose et l'assertion passerait sur une confusion.
    const dom = await monter(
      evenement('conflict_detected', { severity: 'haute', a: 'ruche.ts', b: 'rayon.ts' }),
    );
    expect(ligne(dom), 'la gravité n’est pas dite').toContain('conflit haute');
    expect(ligne(dom), 'le premier chemin en conflit n’est pas nommé').toContain('ruche.ts');
    expect(ligne(dom), 'le second chemin en conflit n’est pas nommé').toContain('rayon.ts');
  });

  it('UNE GRAVITÉ ABSENTE NE DEVIENT PAS « undefined »', async () => {
    // ─── LA BORNE DU REPLI : la clé MANQUE, ce qui est le seul cas ──────────
    //
    // `?? ''` ne se distingue de son absence QUE là. Avec une gravité présente,
    // les deux versions rendent le même texte et le cas ne prouverait rien.
    const dom = await monter(evenement('conflict_detected', { a: 'ruche.ts', b: 'rayon.ts' }));
    expect(ligne(dom), 'le défaut JavaScript s’affiche à l’hôte').not.toContain('undefined');
    expect(ligne(dom), 'la ligne de conflit ne se rend plus du tout').toContain('conflit');
  });

  it('EN ANGLAIS AUSSI : « conflict », sans « undefined »', async () => {
    // ─── L'AUTRE SITE DE LA MÊME DÉCISION ──────────────────────────────────
    //
    // Le repli est écrit DEUX FOIS, une par langue. Défendre le membre français
    // ne dit rien de l'anglais : ce sont deux gardes, sur la même ligne.
    setLang('en');
    const dom = await monter(evenement('conflict_detected', { a: 'ruche.ts', b: 'rayon.ts' }));
    expect(ligne(dom), 'le défaut JavaScript s’affiche en anglais').not.toContain('undefined');
    expect(ligne(dom), 'la ligne anglaise ne se rend plus').toContain('conflict');
  });
});

describe('la course annonce les drones QUI VOLENT, pas le facteur demandé', () => {
  it('TROIS DRONES ENRÔLÉS, FACTEUR SEPT : la ligne dit trois', async () => {
    // ─── LE CAS QUI DÉPARTAGE SANS RIEN CASSER ─────────────────────────────
    //
    // Les deux nombres sont DIFFÉRENTS exprès : muté, la ligne dirait « 7 ». Un
    // décor où la liste manque ferait planter le mutant plutôt que le faire
    // mentir — et un mutant qui plante ne prouve pas la distinction
    // (§ 9 quintrigicenties). C'est donc CE cas qui porte la garde.
    const dom = await monter(
      evenement('drone_race_started', {
        drones: ['n-1', 'n-2', 'n-3'],
        factor: 7,
        taskId: 'tache-critique',
      }),
    );
    expect(ligne(dom), 'la ligne n’annonce pas les drones enrôlés').toContain('3 drone(s)');
    expect(ligne(dom), 'la ligne annonce le facteur au lieu des drones').not.toContain(
      '7 drone(s)',
    );
  });

  it('SANS LISTE, LE FACTEUR SERT DE REPLI — l’autre branche', async () => {
    // Une course d'avant l'enrôlement n'a pas encore sa liste : le journal dit
    // alors ce qui a été DEMANDÉ, plutôt que de ne rien dire.
    const dom = await monter(
      evenement('drone_race_started', { factor: 2, taskId: 'tache-critique' }),
    );
    expect(ligne(dom), 'le repli sur le facteur ne se fait pas').toContain('2 drone(s)');
  });

  it('EN ANGLAIS AUSSI : « 3 drone(s) », pas le facteur', async () => {
    setLang('en');
    const dom = await monter(
      evenement('drone_race_started', {
        drones: ['n-1', 'n-2', 'n-3'],
        factor: 7,
        taskId: 'tache-critique',
      }),
    );
    expect(ligne(dom), 'la ligne anglaise n’annonce pas les drones enrôlés').toContain(
      '3 drone(s)',
    );
    expect(ligne(dom), 'la ligne anglaise annonce le facteur').not.toContain('7 drone(s)');
  });
});
