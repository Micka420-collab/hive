// UN FAUX MOTEUR DE CONTENEURS, POUR LES BANCS DES VALIDATIONS DU BAC.
//
// Les validations du bac ne tournent QUE dans un bac : sans lui, elles
// exécuteraient sur l'hôte nu du code écrit par l'agent (`sans_bac`). Les
// bancs n'ont ni docker ni podman. Ce moteur-ci lit la grammaire
// d'`envelopper` — `run <options…> <image> <commande…>` — et lance la
// commande sur place : tout le reste (le plan, git, `npm run`, les codes de
// sortie, la borne de `runProc`) est réel. Le vrai conteneur est éprouvé par
// le job image de la CI, qui rejoue le scénario V2 Alpha dans `hive-agent:ci`.
//
// POSIX seulement : un script à shebang ne se lance pas sans shell sous
// Windows — même limite, et même raison, que `commande-test.test.ts`.

import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Fournisseur } from '../../src/node-client/isolement.js';

/** L'image que le faux moteur reconnaît comme fin des options de `run`. */
const IMAGE = 'hive-banc';

/**
 * Crée le moteur dans un dossier temporaire HORS du dépôt éprouvé (ni diff, ni
 * `git clean`), inscrit dans `dossiers` pour que le banc l'efface.
 */
export function fauxBac(dossiers: string[]): {
  fournisseur: Fournisseur;
  variables: string[];
  image: string;
} {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-moteur-'));
  dossiers.push(dir);
  const bin = path.join(dir, 'moteur');
  writeFileSync(
    bin,
    '#!/bin/sh\n' +
      // Chaque lancement laisse sa ligne de commande (`appelsDuFauxBac`).
      'printf \'%s\\n\' "$*" >> "$(dirname "$0")/appels"\n' +
      `while [ "$#" -gt 0 ] && [ "$1" != "${IMAGE}" ]; do shift; done\n` +
      'shift\n' +
      'exec "$@"\n',
  );
  chmodSync(bin, 0o755);
  return {
    fournisseur: { nom: 'banc', bin, niveau: 'conteneur', installation: '', garanties: [] },
    variables: [],
    image: IMAGE,
  };
}

/** Les lignes de commande reçues par le faux moteur, une par lancement. */
export function appelsDuFauxBac(bac: ReturnType<typeof fauxBac>): string[] {
  const journal = path.join(path.dirname(bac.fournisseur.bin), 'appels');
  return existsSync(journal) ? readFileSync(journal, 'utf8').split('\n').filter(Boolean) : [];
}
