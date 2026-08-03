// LA PHYSIQUE DU CERVEAU — ce que le canevas cachait au banc.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Le balayage par mutation a rendu SANS TEST la ligne `p.id ===
// attrape.current.id` — « le doigt gagne » — de la boucle de simulation du
// graphe. Elle était hors d'atteinte pour une raison simple et honnête :
// `canvas.getContext('2d')` rend `null` sous happy-dom, et la boucle entière
// s'arrête avant même de commencer. Aucune mise en scène n'aurait pu la faire
// rougir LÀ OÙ ELLE ÉTAIT.
//
// On aurait pu l'écrire au carnet comme « hors d'atteinte » — c'est le repli
// quand rien d'autre n'est possible. Ce n'était pas le cas : la force ne
// dépend d'aucun contexte de dessin. Sortie dans `cerveau-physique.ts`, elle
// s'éprouve directement, et la règle qu'elle porte se dit en une phrase :
//
//   LE CORPS QUE L'HUMAIN TIENT NE BOUGE PAS TOUT SEUL, ET LES AUTRES SI.
//
// Les deux moitiés comptent. Sans la première, la note qu'on déplace se
// remettrait à dériver sous les doigts. Sans la seconde, tout le graphe se
// figerait dès qu'on touche une note.

import { describe, expect, it } from 'vitest';
import { rappelerAuCentre } from '../dashboard/src/views/cerveau-physique.js';
import type { CorpsMobile } from '../dashboard/src/views/cerveau-physique.js';

const CADRE = { L: 1000, H: 600, dt: 16 };

function corps(id: string, x: number, y: number): CorpsMobile {
  return { id, x, y, vx: 0, vy: 0 };
}

describe('le rappel au centre — et le doigt qui gagne', () => {
  it('LE CORPS TENU NE BOUGE PAS D’UN POINT — position ET vitesse intactes', () => {
    // La moitié qui tue `===` → `!==` : mutée, la note qu'on déplace serait
    // rappelée au centre pendant qu'on la tient, et elle glisserait sous les
    // doigts. On la pose LOIN du centre exprès : si la force s'appliquait,
    // le rappel serait maximal et le décalage impossible à manquer.
    const tenu = corps('note-tenue', 20, 40);
    rappelerAuCentre([tenu], { ...CADRE, attrapeId: 'note-tenue' });
    expect(tenu.x, 'le doigt gagne : la position ne bouge pas').toBe(20);
    expect(tenu.y).toBe(40);
    expect(tenu.vx, 'aucune vitesse ne lui est donnée').toBe(0);
    expect(tenu.vy).toBe(0);
  });

  it('…ET LES AUTRES SONT BIEN RAPPELÉES — sinon le graphe se figerait', () => {
    // L'autre moitié : sans elle, un test qui n'exigerait que l'immobilité
    // serait satisfait par une fonction qui ne fait RIEN. Le corps libre,
    // posé à gauche du centre, doit se déplacer VERS la droite.
    const libre = corps('note-libre', 20, 40);
    rappelerAuCentre([libre], { ...CADRE, attrapeId: 'une-autre' });
    expect(libre.x, 'le corps libre approche du centre').toBeGreaterThan(20);
    expect(libre.y, 'sur les deux axes').toBeGreaterThan(40);
    expect(libre.vx, 'et il a reçu une vitesse').toBeGreaterThan(0);
  });

  it('DANS LA MÊME SCÈNE : l’un est tenu, l’autre non', () => {
    // Le banc ASYMÉTRIQUE — deux corps aux MÊMES coordonnées, un seul tenu :
    // seule la garde d'identité peut les départager. Un banc à un corps
    // laisserait passer une garde qui répondrait toujours pareil.
    const tenu = corps('tenue', 100, 100);
    const libre = corps('libre', 100, 100);
    rappelerAuCentre([tenu, libre], { ...CADRE, attrapeId: 'tenue' });
    expect(tenu.x, 'la tenue reste').toBe(100);
    expect(libre.x, 'la libre part').not.toBe(100);
  });

  it('PERSONNE NE TIENT RIEN : tout le monde est rappelé', () => {
    // `attrapeId: null` est l'état normal — au repos, aucune note n'est
    // exemptée. Une garde qui comparerait mal exempterait tout le monde.
    const a = corps('a', 10, 10);
    const b = corps('b', 900, 500);
    rappelerAuCentre([a, b], { ...CADRE, attrapeId: null });
    expect(a.x, 'a monte vers le centre').toBeGreaterThan(10);
    expect(b.x, 'b redescend vers le centre').toBeLessThan(900);
  });

  it('LE PAS DE TEMPS COMMANDE LA DISTANCE — une image longue déplace plus', () => {
    // `dt / 16` : sur une machine qui rame, le graphe doit avancer d'autant
    // plus, sinon la simulation ralentit avec l'écran au lieu de suivre le
    // temps réel.
    const rapide = corps('p', 100, 100);
    const lent = corps('p', 100, 100);
    rappelerAuCentre([rapide], { ...CADRE, dt: 16, attrapeId: null });
    rappelerAuCentre([lent], { ...CADRE, dt: 48, attrapeId: null });
    expect(lent.x - 100, 'trois fois le pas, trois fois le chemin').toBeCloseTo(
      (rapide.x - 100) * 3,
      6,
    );
  });

  it('LE MOUVEMENT S’ÉTEINT : un corps lâché finit par se poser', () => {
    // L'amortissement, éprouvé par son EFFET plutôt que par sa constante :
    // sans lui, le graphe oscillerait autour du centre sans jamais s'arrêter,
    // et la page brûlerait la batterie pour toujours.
    // Les seuils sont MESURÉS, pas devinés : à 400 tours le corps est encore
    // à 46 points du centre, à 1 000 tours à 1,5, à 2 000 tours à 0,005. On
    // s'arrête à 2 000 — un chiffre écrit avant d'être mesuré serait la
    // récidive du § 9 nonies.
    const p = corps('p', 900, 500);
    const depart = Math.hypot(p.x - 500, p.y - 300);
    for (let i = 0; i < 2_000; i++) rappelerAuCentre([p], { ...CADRE, attrapeId: null });
    expect(depart, 'le banc lui-même : il part de loin').toBeGreaterThan(400);
    expect(Math.hypot(p.x - 500, p.y - 300), 'il s’est posé au centre').toBeLessThan(0.05);
    expect(Math.hypot(p.vx, p.vy), 'et il ne bouge plus').toBeLessThan(0.001);
  });
});
