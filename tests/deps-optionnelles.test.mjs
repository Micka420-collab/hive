// LE RELEVÉ DES DÉPENDANCES OPTIONNELLES — un avertissement qui ne crie pas
// pour rien.
//
// ─── D'OÙ VIENT CE BANC ──────────────────────────────────────────────────────
//
// `scripts/deps-optionnelles.mjs` n'exportait rien : tout vivait au niveau du
// module, donc rien n'était éprouvable. Un balayage loupe sur `scripts/`
// (46 candidates, 46 examinées, base épinglée `46a789c`) a rendu :
//
//     🔴 SANS TEST · scripts/deps-optionnelles.mjs · > → >=
//                if (absentes.length > 0) {
//
// Ce mutant compte. Avec `>=`, une installation SAINE affiche « ⚠ Ces paquets
// manquent » et conseille de relancer `npm ci --foreground-scripts`. Un
// diagnostic qui crie sur une machine en bon état apprend à ne plus être lu, et
// le jour où il dit vrai plus personne n'écoute.
//
// Ce script existe précisément parce qu'un `npm ci` vert cachait 68 fichiers de
// test morts à l'import sous Windows. Le rendre bruyant à tort serait défaire
// ce pour quoi il a été écrit.

import { describe, expect, it } from 'vitest';
import {
  OPTIONNELLES,
  lignesAbsences,
  premiereLigne,
  releve,
} from '../scripts/deps-optionnelles.mjs';

/** Un résolveur qui ne trouve que ce qu'on lui autorise. */
const resolveurQuiConnait = (presents) => (nom) => {
  if (!presents.includes(nom)) {
    const e = new Error(`Cannot find module '${nom}'\nRequire stack:\n- /x/y.js`);
    e.code = 'MODULE_NOT_FOUND';
    throw e;
  }
  return `/node_modules/${nom}`;
};

describe('la borne de l’avertissement — la ligne que la loupe a trouvée nue', () => {
  it('AUCUNE ABSENCE ⇒ AUCUN AVERTISSEMENT. C’est le mutant `>=` qui meurt ici', () => {
    expect(lignesAbsences([]), 'une liste vide ne doit produire AUCUNE ligne').toEqual([]);
  });

  it('une seule absence suffit à déclencher l’avertissement', () => {
    const lignes = lignesAbsences(['better-sqlite3']);
    expect(lignes.length).toBeGreaterThan(0);
    expect(lignes.join('\n')).toContain('npm ci --foreground-scripts');
  });
});

describe('le relevé complet — ce qu’un membre lit après son installation', () => {
  it('TOUT PRÉSENT : quatre coches, et pas un mot d’alarme', () => {
    const { lignes, absentes } = releve(OPTIONNELLES, resolveurQuiConnait(OPTIONNELLES));
    expect(absentes).toEqual([]);
    expect(lignes.filter((l) => l.includes('✔'))).toHaveLength(4);
    expect(lignes.join('\n'), 'rien ne doit alarmer une installation saine').not.toContain('⚠');
  });

  it('LE CAS DE LA CI WINDOWS : le module natif manque, et on le DIT', () => {
    // Le scénario réel — `npm ci` vert, `better-sqlite3` absent, 68 fichiers
    // morts à l'import sans que rien n'explique pourquoi.
    const presents = OPTIONNELLES.filter((n) => n !== 'better-sqlite3');
    const { lignes, absentes } = releve(OPTIONNELLES, resolveurQuiConnait(presents));
    expect(absentes).toEqual(['better-sqlite3']);
    const texte = lignes.join('\n');
    expect(texte).toContain('✘ better-sqlite3');
    expect(texte).toContain('Cannot find module');
    expect(texte).toContain('⚠');
  });

  it('l’ORDRE est celui de la liste — un relevé se lit de haut en bas', () => {
    const { lignes } = releve(['a', 'b'], resolveurQuiConnait(['b']));
    expect(lignes[1]).toContain('✘ a');
    expect(lignes[2]).toContain('✔ b');
  });
});

describe('premiereLigne — le message reste lisible quoi qu’on lui donne', () => {
  it('une Error rend sa PREMIÈRE ligne, pas la pile de résolution', () => {
    const e = new Error("Cannot find module 'x'\nRequire stack:\n- /a/b.js");
    expect(premiereLigne(e)).toBe("Cannot find module 'x'");
  });

  it('CE QUI N’EST PAS UNE ERREUR RESSORT TEL QUEL — jamais `undefined`', () => {
    // C'est la seule entrée qui distingue `instanceof Error` de son mutant
    // `instanceof Object` : sur un objet nu, le mutant lit `.message`, qui
    // n'existe pas, et affiche `undefined` là où il y avait une information.
    expect(premiereLigne({ code: 'ENOENT' })).toBe('[object Object]');
    expect(premiereLigne('panne brute')).toBe('panne brute');
    expect(premiereLigne(null)).toBe('null');
  });
});
