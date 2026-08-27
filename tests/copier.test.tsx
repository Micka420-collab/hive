// @vitest-environment happy-dom
//
/// <reference lib="dom" />
//
// LA COPIE, ET SON REPLI — le module que trois écrans partagent.
//
// ─── CE QUE CE FICHIER PROTÈGE ───────────────────────────────────────────────
//
// `navigator.clipboard` n'existe QUE dans un contexte sécurisé : https, ou
// localhost. Hive est LAN-first — on l'ouvre sur `http://192.168.x.x`, et là
// l'API n'est tout simplement pas là.
//
// Sans repli, le bouton « copier » échoue TOUJOURS chez les gens qui utilisent
// la ruche comme elle est faite pour l'être. C'est ce qui arrivait à l'écran
// des sauvegardes, dont la copie n'avait jamais eu le repli que son voisin
// `InvitePanel` portait depuis le début — deux réponses à une même question.
//
// Ces bancs tiennent les deux chemins, et le fait que le module ne LÈVE jamais.

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { copierTexte } from '../dashboard/src/copier';

/** Ce que `execCommand('copy')` doit rendre pour ce banc-ci. */
let replicOk = true;
/** Ce qui a été sélectionné avant la tentative de repli. */
let selectionne: string[] = [];

beforeEach(() => {
  replicOk = true;
  selectionne = [];
  // Le repli passe par une VRAIE zone de texte insérée dans le document —
  // happy-dom la crée pour de bon, mais n'implémente pas `execCommand`.
  (document as unknown as { execCommand: (c: string) => boolean }).execCommand = vi.fn(() => {
    const ta = document.querySelector('textarea');
    if (ta) selectionne.push((ta as HTMLTextAreaElement).value);
    return replicOk;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.querySelectorAll('textarea').forEach((n) => n.remove());
});

function contexte(secure: boolean, presseP?: { writeText: (t: string) => Promise<void> }): void {
  Object.defineProperty(window, 'isSecureContext', { value: secure, configurable: true });
  Object.defineProperty(navigator, 'clipboard', { value: presseP, configurable: true });
}

describe('copierTexte — le chemin sécurisé', () => {
  it('en https, l’API du presse-papiers reçoit le texte EXACT', async () => {
    const recus: string[] = [];
    contexte(true, { writeText: (t) => (recus.push(t), Promise.resolve()) });
    await expect(copierTexte('npm install -g @anthropic-ai/claude-code')).resolves.toBe(true);
    expect(recus).toEqual(['npm install -g @anthropic-ai/claude-code']);
    // Le repli n'a pas été touché : une seule copie, pas deux.
    expect(selectionne).toEqual([]);
  });
});

describe('copierTexte — le repli LAN, qui est le cas NORMAL du projet', () => {
  it('en http, sans API de presse-papiers, le repli prend le relais', async () => {
    contexte(false, undefined);
    await expect(copierTexte('hive rejoindre')).resolves.toBe(true);
    expect(selectionne, 'le texte passe par la zone de repli').toEqual(['hive rejoindre']);
  });

  it('en http AVEC une API présente, on passe QUAND MÊME par le repli', async () => {
    // LE CAS QUE LA GARDE `isSecureContext` EXISTE POUR ATTRAPER, et que ce
    // banc a d'abord raté. Ma première version n'éprouvait que « http SANS
    // API » — où la garde ne décide rien, l'API étant absente de toute façon.
    // Ôter `window.isSecureContext &&` ne faisait alors rougir personne.
    //
    // Or les navigateurs EXPOSENT `navigator.clipboard` en http : c'est à
    // l'appel qu'ils refusent. S'y fier ferait échouer la copie sur tout
    // déploiement LAN, en croyant l'avoir tentée.
    const recus: string[] = [];
    contexte(false, { writeText: (t) => (recus.push(t), Promise.resolve()) });
    await expect(copierTexte('hive rejoindre')).resolves.toBe(true);
    expect(recus, 'l’API ne doit PAS être appelée en contexte non sécurisé').toEqual([]);
    expect(selectionne, 'le repli, et lui seul').toEqual(['hive rejoindre']);
  });

  it('le repli NETTOIE derrière lui — pas de zone de texte oubliée dans la page', async () => {
    // Une zone laissée en place s'accumulerait à chaque clic, et un `querySelector`
    // d'un autre écran finirait par tomber dessus.
    contexte(false, undefined);
    await copierTexte('x');
    expect(document.querySelectorAll('textarea')).toHaveLength(0);
  });

  it('un repli qui échoue rend `false` — il ne prétend pas avoir copié', async () => {
    contexte(false, undefined);
    replicOk = false;
    await expect(copierTexte('x')).resolves.toBe(false);
  });

  it('une API qui REJETTE en contexte sécurisé retombe sur le repli', async () => {
    // Permission refusée, document sans focus : ça arrive, et le repli reste la
    // bonne conduite plutôt qu'un échec sec.
    contexte(true, { writeText: () => Promise.reject(new Error('refusé')) });
    await expect(copierTexte('y')).resolves.toBe(true);
    expect(selectionne).toEqual(['y']);
  });
});

describe('copierTexte — ce qu’il ne fait jamais', () => {
  it('NE LÈVE PAS, même quand tout échoue', async () => {
    // Un rejet oublié dans un composant devient un rejet non capté, et un rejet
    // non capté dans un banc de rendu retombe dans la fenêtre du banc suivant.
    contexte(true, {
      writeText: () => {
        throw new Error('boum');
      },
    });
    replicOk = false;
    await expect(copierTexte('z')).resolves.toBe(false);
  });

  it('N’ÉCRASE PAS le presse-papiers avec du VIDE', async () => {
    const recus: string[] = [];
    contexte(true, { writeText: (t) => (recus.push(t), Promise.resolve()) });
    await expect(copierTexte('')).resolves.toBe(false);
    expect(recus, 'rien ne doit partir').toEqual([]);
    expect(selectionne).toEqual([]);
  });
});
