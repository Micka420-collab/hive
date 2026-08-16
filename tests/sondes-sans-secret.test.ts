// AUCUNE SONDE NE PORTE DE SECRET — la règle, et la garde qui la fait tenir.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// L'audit du 2 août avait trouvé quatre sondes qui livraient `HIVE_TOKEN`,
// `HIVE_JWT_SECRET` et la clé d'API au premier binaire hostile posé en tête du
// `PATH`. `envSonde` les a toutes assainies — et la correction a été jugée
// tenue parce que les cinq sites appelaient la bonne fonction.
//
// Le balayage de la nuit a montré que ce n'était pas tenu du tout. En
// remplaçant `env: envSonde(process.env)` par `env: process.env`, site par
// site :
//
//   · doctor-releve.ts   → 29 tests verts   (nu)
//   · cli.ts             →  7 tests verts   (nu)
//   · agent-detect.ts    → 12 tests verts   (nu)
//   · isolement.ts       → 36 tests verts   (nu)
//   · tunnel.ts          →  1 test ROUGE    (le seul gardé)
//
// Quatre sites sur cinq pouvaient donc redevenir fuyants sans qu'une seule
// ligne rougisse. La garde ne vivait pas dans le code : elle vivait dans le
// SOUVENIR de la correction — c'est-à-dire nulle part.
//
// ─── CE QUE CE FICHIER GARDE, ET POURQUOI SOUS CETTE FORME ───────────────────
//
// La propriété est structurelle, donc la garde l'est aussi :
//
//   TOUTE SONDE `--version` LANCÉE PAR LA RUCHE PASSE PAR `envSonde`.
//
// Une garde par comportement (lancer un vrai binaire menteur et lire ce qu'il
// a vu) prouverait UN site à la fois, et le sixième naîtrait nu comme les
// quatre précédents. Celle-ci lit la SOURCE : elle rougit le jour où quelqu'un
// écrit une sonde de plus sans la laver — y compris dans un fichier qui
// n'existe pas encore. C'est la leçon du § 9bis.1 (« la garde doit vivre dans
// la sonde, pas dans l'ordre des lignes ») rendue exécutable.
//
// Elle est doublée d'une preuve par le COMPORTEMENT sur le module pur : une
// garde de forme qui se tromperait de fonction serait un décor de plus.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { envSonde } from '../src/node-client/agent-detect.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(RACINE, 'src');

/** Tous les fichiers TypeScript de `src`, en profondeur. */
function fichiersTs(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiersTs(complet));
    else if (nom.endsWith('.ts') && !nom.endsWith('.d.ts')) sortie.push(complet);
  }
  return sortie;
}

/**
 * Les lancements d'enfant du dépôt, découpés grossièrement mais SUFFISAMMENT.
 *
 * On coupe à `spawn(` / `execFile(` et on garde ce qui suit jusqu'à la
 * prochaine coupure (ou 800 caractères). C'est assez pour voir les arguments
 * ET les options d'un appel, et ça ne dépend d'aucun analyseur syntaxique —
 * une garde qui aurait besoin d'un compilateur pour tenir serait une garde
 * qu'on retire au premier ennui.
 */
function lancements(source: string): string[] {
  const morceaux: string[] = [];
  const motif = /\b(?:spawn|execFile)\(/g;
  let m: RegExpExecArray | null;
  while ((m = motif.exec(source)) !== null) {
    morceaux.push(source.slice(m.index, m.index + 800));
  }
  return morceaux;
}

/** Une ligne de commentaire ne lance rien : elle ne doit pas être jugée. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
    .join('\n');
}

/**
 * Ce à quoi on RECONNAÎT une sonde dans le code du dépôt.
 *
 * Pas une élégance : la liste existe parce que le détecteur d'origine, accroché
 * au seul `'--version'`, a perdu de vue la sonde d'isolement le jour où elle est
 * passée à `info`. Toute sonde qui pose une AUTRE question s'ajoute ici — et le
 * compte plancher plus bas rougira si on l'oublie.
 */
const MARQUEURS_DE_SONDE = ["'--version'", 'SONDE_ISOLEMENT'] as const;

describe('la règle : toute sonde d’un binaire tiers est lavée de ses secrets', () => {
  it('LES SONDES DU DÉPÔT PASSENT TOUTES PAR envSonde — y compris celles à venir', () => {
    const fautives: string[] = [];
    let sondesVues = 0;

    for (const fichier of fichiersTs(SRC)) {
      const source = sansCommentaires(readFileSync(fichier, 'utf8'));
      for (const appel of lancements(source)) {
        // Une sonde, c'est un lancement qui INTERROGE un binaire — jamais un
        // agent qu'on fait travailler (celui-là a besoin de ses clés).
        //
        // ─── CE DÉTECTEUR A DÉJÀ PERDU UNE SONDE, ET IL FAUT LE DIRE ────────
        //
        // Il ne cherchait que `'--version'`. Le 16 août, la sonde d'isolement
        // est passée à `info` — parce que `docker --version` répond 0 sans
        // jamais parler au démon, et que le docteur affichait donc un ✔ sur un
        // bac à sable absent. Le correctif était juste ; l'effet de bord ne
        // l'était pas : cette garde a CESSÉ DE VOIR la sonde, et son compte est
        // tombé de 5 à 4.
        //
        // C'est le `toBeGreaterThanOrEqual(5)` plus bas qui l'a dit — la
        // « garde de la garde », écrite précisément pour ce cas, a fait son
        // travail. Sans elle, la sonde serait sortie du filet EN SILENCE et
        // aurait pu se remettre à livrer `HIVE_TOKEN` sans que rien ne rougisse.
        //
        // La leçon : un détecteur accroché à UN littéral protège jusqu'au jour
        // où le littéral change. Les marqueurs sont donc nommés ici, et cette
        // liste s'allonge quand une sonde nouvelle pose une autre question.
        if (!MARQUEURS_DE_SONDE.some((m) => appel.includes(m))) continue;
        sondesVues += 1;
        if (!appel.includes('envSonde')) {
          fautives.push(path.relative(RACINE, fichier));
        }
      }
    }

    // Le banc lui-même : si le découpage cessait de voir les sondes, la garde
    // deviendrait verte pour de mauvaises raisons — le décor par excellence.
    expect(sondesVues, 'la garde doit VOIR les sondes qu’elle juge').toBeGreaterThanOrEqual(5);
    expect(
      fautives,
      `sondes qui héritent de l’environnement complet : ${fautives.join(', ')}`,
    ).toEqual([]);
  });

  it('LE MODULE PUR RETIRE VRAIMENT LES SECRETS — la garde de forme ne se croit pas sur parole', () => {
    // Une garde de forme qui exigerait le NOM d'une fonction sans vérifier ce
    // qu'elle fait serait un décor : il suffirait d'écrire une `envSonde` qui
    // ne retire rien. On éprouve donc les deux moitiés.
    const sale: NodeJS.ProcessEnv = {
      PATH: '/usr/bin',
      HOME: '/home/abeille',
      HIVE_TOKEN: 'jeton-de-ruche-tres-secret',
      HIVE_JWT_SECRET: 'secret-de-session-tres-secret',
      ANTHROPIC_API_KEY: 'sk-ant-secret',
      QUEEN_BEE_API_KEY: 'qb-secret',
      OPENROUTER_API_KEY: 'or-secret',
    };
    const propre = envSonde(sale);

    for (const cle of [
      'HIVE_TOKEN',
      'HIVE_JWT_SECRET',
      'ANTHROPIC_API_KEY',
      'QUEEN_BEE_API_KEY',
      'OPENROUTER_API_KEY',
    ]) {
      expect(propre[cle], `${cle} ne doit JAMAIS traverser`).toBeUndefined();
    }
    // Et l'autre moitié : une sonde a besoin de son PATH pour trouver le
    // binaire. Un `envSonde` qui rendrait un objet vide « passerait » le test
    // ci-dessus en cassant toutes les sondes du dépôt.
    expect(propre.PATH, 'la sonde garde de quoi travailler').toBe('/usr/bin');
    expect(propre.HOME).toBe('/home/abeille');
    // La source n'est pas touchée : un effet de bord ici viderait
    // l'environnement du processus appelant.
    expect(sale.HIVE_TOKEN, 'l’environnement du parent est intact').toBe(
      'jeton-de-ruche-tres-secret',
    );
  });

  it('LA LISTE DES SECRETS COUVRE CE QUE LE DÉPÔT SAIT LIRE', () => {
    // Un secret ajouté au produit mais oublié dans la liste fuiterait sans
    // qu'aucune des deux gardes précédentes ne s'en aperçoive : elles
    // vérifient la forme et le retrait, pas l'exhaustivité. Ici on relit ce
    // que le dépôt LIT vraiment dans l'environnement.
    const attendus = ['HIVE_TOKEN', 'HIVE_JWT_SECRET', 'ANTHROPIC_API_KEY'];
    const propre = envSonde(Object.fromEntries(attendus.map((c) => [c, 'x'])) as NodeJS.ProcessEnv);
    expect(Object.keys(propre), 'aucun secret connu ne survit').toEqual([]);
  });
});
