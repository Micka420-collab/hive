#!/usr/bin/env node
// LE TAMIS DES ORDRES — la suite rejouée dans plusieurs ordres de tests.
//
// ─── CE QU'IL A TROUVÉ LE JOUR OÙ IL A ÉTÉ ÉCRIT ─────────────────────────────
//
// Dix-sept fichiers, une quarantaine de tests. Le motif était partout le même :
// un test posait un état, le suivant le lisait sans jamais le dire. Chacun
// était vert à sa place, et seulement à sa place.
//
// Ce n'est pas une question d'élégance. « NE TOUCHE PAS AUX LIENS VIVANTS » ne
// vérifiait la moitié de sa borne — que l'élagage emporte bien les liens morts
// — qu'un ordre sur deux, parce que le lien mort lui venait d'un test voisin.
// « REPRENDRE LA MÊME ISSUE NE COLLISIONNE PAS » n'éprouvait AUCUNE collision
// s'il passait en premier : le défaut qu'il existe pour attraper lui était
// invisible. Ces tests-là n'étaient pas de la couverture, c'était du décor.
//
// ─── POURQUOI DES GRAINES FIXES ──────────────────────────────────────────────
//
// Une graine tirée au hasard ferait rougir la CI sur un ordre que personne ne
// peut rejouer — et la première réaction serait de relancer le travail plutôt
// que de lire. Les graines ci-dessous sont écrites, donc reproductibles : un
// échec ici se rejoue à l'identique en une commande, affichée par ce script.
//
// Elles ne prouvent pas l'absence de couplage, elles l'ÉCHANTILLONNENT. La
// liste est faite pour s'allonger : le jour où un couplage passe entre les
// mailles, on ajoute la graine qui l'a montré, et il ne repassera plus.
//
// Usage :  node scripts/tamis-ordres.mjs [graine…]

import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** Les ordres rejoués par la CI. Ajouter une graine, c'est fermer une porte. */
export const GRAINES = [23757, 15838, 7919];

/**
 * Le code de sortie d'un fils, ramené à un entier.
 *
 * `close` rend `null` quand le processus a été TUÉ par un signal : il n'a pas
 * choisi de s'arrêter, donc on ne peut rien conclure de bon — c'est un échec.
 *
 * ─── POURQUOI `??` ET SURTOUT PAS `||` ───────────────────────────────────────
 *
 * `0` est le code du SUCCÈS, et `0` est *falsy*. Avec `||`, un ordre qui passe
 * serait rapporté comme rouge : la CI barrerait une suite verte, on apprendrait
 * à ne plus la croire, et le tamis se ferait désarmer par lassitude. C'est la
 * famille du § 9 quaterdecies — un code de sortie ne se manipule pas de tête.
 *
 * Cette décision vivait dans le rappel de `spawn`, donc hors d'atteinte du banc
 * (§ 2 quaterdecies) : l'éprouver aurait demandé de relancer la suite DEPUIS la
 * suite. Sortie ici, elle s'éprouve pour rien.
 */
export function codeDeSortie(code) {
  return code ?? 1;
}

/** Lance la suite sur une graine. Rend le code de sortie. */
function unOrdre(graine) {
  return new Promise((resolve) => {
    // `shell: false` — les arguments ne traversent aucun interpréteur (§5.1).
    const fils = spawn(
      process.execPath,
      [
        'node_modules/vitest/vitest.mjs',
        'run',
        '--sequence.shuffle',
        `--sequence.seed=${graine}`,
        '--reporter=dot',
      ],
      { stdio: 'inherit', shell: false },
    );
    fils.on('close', (code) => resolve(codeDeSortie(code)));
    fils.on('error', () => resolve(1));
  });
}

export async function principal(argv, lancer = unOrdre, ecrire = console.log) {
  const demandees = argv.map(Number).filter((n) => Number.isInteger(n) && n > 0);
  const graines = demandees.length > 0 ? demandees : GRAINES;
  const rouges = [];

  for (const graine of graines) {
    ecrire(`\n── ordre ${graine} ──`);
    const code = await lancer(graine);
    if (code !== 0) rouges.push(graine);
  }

  if (rouges.length === 0) {
    ecrire(`\n✓ la suite tient dans les ${graines.length} ordres essayés.`);
    return 0;
  }

  // Un échec qu'on ne sait pas rejouer se relance au lieu de se lire.
  ecrire(`\n✗ ${rouges.length} ordre(s) rouge(s) : ${rouges.join(', ')}`);
  ecrire('\nPour rejouer EXACTEMENT le premier :');
  ecrire(`    npx vitest run --sequence.shuffle --sequence.seed=${rouges[0]}`);
  ecrire('\nUn test rouge ici lit un état qu’un autre test a posé. Le geste est');
  ecrire('de lui faire poser sa propre prémisse, pas de figer l’ordre : voir');
  ecrire('tests/ordre-declare.test.ts pour la seule exemption admise, et');
  ecrire('docs/ERREURS.md § « le vert emprunté au voisin ».');
  return 1;
}

// Point d'entrée : seulement quand le fichier est LANCÉ, jamais à l'import —
// sans quoi le test qui importe `principal` lancerait la suite entière trois
// fois depuis l'intérieur de la suite.
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await principal(process.argv.slice(2));
}
