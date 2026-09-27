// CE QUE LE NAVIGATEUR TÉLÉCHARGE — et qu'il doit pouvoir EXÉCUTER.
//
// ─── LE DÉFAUT QUI A FAIT NAÎTRE CE BANC ─────────────────────────────────────
//
// Ouvrir la Chambre d'une ouvrière rendait le tableau de bord ENTIÈREMENT
// BLANC. Pas de message, pas de repli : l'écran disparaissait, barre comprise.
//
// La chaîne : `Chambre.tsx` importait `nomEnvDepuisLibelle` depuis
// `src/orchestrator/requisition-env.ts` — un module de la Reine, qui lit et
// écrit son `.env` —, lequel tire `installer.ts`, lequel tire
// `orchestrator/auth.ts`, qui tire un secret AU CHARGEMENT DU MODULE :
//
//     const SECRET_EPHEMERE = randomBytes(32).toString('base64url');
//
// Pour un navigateur, Vite remplace `node:crypto` par un module VIDE. Il le
// dit, en avertissement, à chaque construction — et une construction verte ne
// se lit pas. Le morceau de la Chambre levait donc `randomBytes is not a
// function` dès son chargement ; `React.lazy` propageait, et faute de frontière
// d'erreur, React démontait TOUT l'arbre.
//
// Les bancs de la Chambre passaient, et ne pouvaient que passer : ils tournent
// sous Node, où `node:crypto` existe. Seul un vrai navigateur voyait la panne.
// C'est `npm run captures` qui l'a photographiée — une page crème, vide, sur
// `chambre.bureau.png` comme sur `chambre.mobile.png`.
//
// ─── CE QUE CE BANC ÉPROUVE, ET POURQUOI À CET ENDROIT ───────────────────────
//
// Il construit l'écran avec SA configuration (celle de `npm run build` et de
// la CI), sans rien écrire sur le disque, et exige qu'aucun morceau ne
// contienne le substitut que Vite met à la place d'un module de Node. C'est la
// frontière exacte du défaut : ce qui part au navigateur. Un banc qui
// importerait la Chambre sous Node regarderait l'autre côté de la frontière.
//
// La règle vaut pour TOUT le tableau, pas pour la seule Chambre : un module de
// la Reine importé demain par une autre vue referait la même page blanche, et
// ce banc le dira en nommant le fichier fautif.

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import type { Rolldown } from 'vite';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const ECRAN = path.join(RACINE, 'dashboard');

describe('le paquet du navigateur', () => {
  it('NE CONTIENT AUCUN MODULE DE NODE — sinon une vue entière devient une page blanche', async () => {
    const sortie = await build({
      root: ECRAN,
      configFile: path.join(ECRAN, 'vite.config.ts'),
      logLevel: 'silent',
      build: { write: false },
    });

    const lots: Rolldown.RolldownOutput[] = Array.isArray(sortie)
      ? sortie
      : 'output' in sortie
        ? [sortie]
        : [];
    const morceaux = lots.flatMap((l) => l.output).filter((m) => m.type === 'chunk');
    // La mesure doit avoir MORDU : un tableau construit en moins de cent
    // modules, c'est une construction qui n'a pas lu ce qu'on croit.
    expect(
      morceaux.flatMap((m) => m.moduleIds).length,
      'aucun module lu : la mesure n’a rien mesuré',
    ).toBeGreaterThan(100);

    // Chaque morceau fautif, avec les modules de Node qu'il embarque : le nom
    // du morceau dit QUELLE vue tombe (`Chambre-….js`), et
    // `npm run build:dashboard` nomme dans ses avertissements l'import à défaire.
    const fautifs = morceaux
      .map((m) => ({
        morceau: m.fileName,
        node: m.moduleIds.filter((id) => id.includes('__vite-browser-external')),
      }))
      .filter((f) => f.node.length > 0);
    expect(fautifs, 'un module de Node est parti au navigateur').toEqual([]);
  }, 120_000);
});
