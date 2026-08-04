// LA LÉGENDE DES CODES DE SORTIE — une seule vérité, affichée partout pareil.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Les codes de sortie sont une INTERFACE PUBLIQUE : `codes-sortie.ts` le dit
// lui-même, « les changer casse les scripts de quelqu'un ». La légende qui les
// explique dans `--help` est donc la partie de cette interface qu'un humain
// lit — et elle était écrite À LA MAIN, mot pour mot, dans DEUX fichiers.
//
// Elles avaient déjà dérivé, toutes les deux du même côté : six codes annoncés
// sur sept. `ERREUR` (1) manquait, c'est-à-dire le fourre-tout, celui qu'un
// script rencontre le plus souvent après `0`. Quelqu'un dont l'installation
// rendait `1` lisait `--help` et n'y trouvait rien — ni le sens du code, ni
// même son existence.
//
// La table `SENS` était là, dans le même fichier, et disait la vérité pour les
// sept. Personne ne s'en servait.
//
// ─── CE QUE CE BANC TIENT, ET CE QU'IL NE TIENT PAS ──────────────────────────
//
// Il ne vérifie pas que la légende est JOLIE. Il vérifie qu'elle est COMPLÈTE
// et qu'elle est la MÊME partout : c'est exactement ce qui s'est perdu, et
// c'est ce qu'aucune relecture ne rattrape, parce qu'une légende à six entrées
// sur sept a l'air complète.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CODE, SENS, legendeCodes, type CodeSortie } from '../src/codes-sortie.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

/** Les deux aides qui affichent la légende. Si une troisième naît, elle vient ici. */
const AIDES = ['src/installer.ts', 'src/installer-main.ts'] as const;

describe('la légende des codes de sortie', () => {
  it('ANNONCE LES SEPT CODES — c’est le « 1 » manquant qui a motivé ce banc', () => {
    // La garde principale, écrite par PARCOURS de `CODE` et non par une liste
    // recopiée : une liste recopiée ici aurait exactement le défaut qu'on
    // corrige, et vieillirait au premier code ajouté.
    const legende = legendeCodes();
    for (const [nom, code] of Object.entries(CODE)) {
      expect(legende, `le code ${nom} (${String(code)}) manque à la légende`).toContain(
        String(code),
      );
    }
  });

  it('DONNE LE SENS DE CHAQUE CODE, pas seulement son numéro', () => {
    // Un numéro sans explication ne sert à rien : « 4 » ne dit pas « port
    // occupé ». C'est l'explication qu'on vient chercher dans `--help`.
    const legende = legendeCodes();
    for (const code of Object.values(CODE) as CodeSortie[]) {
      expect(legende, `le sens du code ${String(code)} manque`).toContain(SENS[code]);
    }
  });

  it('NE SE RÉPÈTE PLUS À LA MAIN — aucune aide ne réécrit la liste', () => {
    // LA garde structurelle. Sans elle, rien n'empêche quelqu'un de recopier la
    // légende dans une troisième aide « juste cette fois », et la dérive
    // recommence exactement où elle s'était arrêtée.
    for (const rel of AIDES) {
      const source = readFileSync(path.join(RACINE, rel), 'utf8');
      expect(source, `${rel} doit APPELER la légende, pas la réécrire`).toContain('legendeCodes()');
      expect(
        source,
        `${rel} réécrit « Codes de sortie : » à la main au lieu d’appeler legendeCodes()`,
      ).not.toMatch(/`\s*Codes de sortie\s*:/);
    }
  });

  it('EST LA MÊME PARTOUT — deux aides, une seule vérité', () => {
    // La conséquence observable de tout ce qui précède : appeler deux fois rend
    // deux fois la même chose, donc les deux aides ne peuvent plus diverger.
    expect(legendeCodes()).toBe(legendeCodes());
    expect(legendeCodes().length, 'une légende vide passerait tout le reste').toBeGreaterThan(60);
  });

  it('LE BANC VOIT RÉELLEMENT LES DEUX AIDES — sinon il serait vert à vide', () => {
    // Le compteur qui empêche ce fichier de devenir muet : un chemin qui
    // change, un fichier renommé, et tout ce qui précède annoncerait « rien à
    // signaler » en n'ayant rien lu.
    expect(AIDES).toHaveLength(2);
    for (const rel of AIDES) {
      expect(
        readFileSync(path.join(RACINE, rel), 'utf8').length,
        `${rel} doit être lu`,
      ).toBeGreaterThan(1000);
    }
    expect(Object.keys(CODE).length, 'les sept codes doivent être trouvés').toBe(7);
  });
});
