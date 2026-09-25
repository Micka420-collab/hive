// Où la Reine range les clés d'API posées depuis la Chambre — et comment elle
// les relit au démarrage.
//
// ─── LE DÉFAUT QUE CE MODULE RETIRE ──────────────────────────────────────────
//
// `POST /api/queen/cles` écrit la clé dans le `.env` du dossier courant. En
// conteneur, les deux compose montent la racine en LECTURE SEULE
// (`read_only: true`) : `/app/.env` n'est pas inscriptible, la route rendait
// 500 `ecriture_env`, et « accorder une clé depuis la Chambre » ne marchait
// dans aucune installation Docker. Seul `/app/data` — le volume — l'est.
//
// `HIVE_ENV_FILE` désigne donc le fichier de clés de la Reine. L'image le pose
// dans le volume : la clé survit au redémarrage du conteneur, et la Reine la
// relit en démarrant. Sans la variable, rien ne change : `.env` du dossier.

import { existsSync } from 'node:fs';
import path from 'node:path';

/** Le fichier où la Reine écrit (et relit) ses clés. */
export function cheminEnvQueen(env: NodeJS.ProcessEnv, dossier: string): string {
  const choisi = (env.HIVE_ENV_FILE ?? '').trim();
  return choisi === '' ? path.join(dossier, '.env') : path.resolve(dossier, choisi);
}

/**
 * Charge le `.env` du dossier, puis le fichier de clés s'il est ailleurs.
 *
 * `process.loadEnvFile` ne remplace pas une variable déjà présente : ce que
 * l'hôte a posé (compose, `docker run -e`, shell) garde le dernier mot. Un
 * fichier absent n'est pas une erreur — une ruche neuve n'a encore aucune clé.
 * Rend les fichiers réellement chargés.
 */
export function chargerEnvQueen(
  env: NodeJS.ProcessEnv,
  dossier: string,
  charger: (fichier: string) => void = (f) => process.loadEnvFile(f),
  existe: (fichier: string) => boolean = existsSync,
): string[] {
  const charges: string[] = [];
  const local = path.join(dossier, '.env');
  if (existe(local)) {
    charger(local);
    charges.push(local);
  }
  // Relu APRÈS le `.env` : c'est lui qui peut nommer le fichier de clés.
  const cles = cheminEnvQueen(env, dossier);
  if (cles !== local && existe(cles)) {
    charger(cles);
    charges.push(cles);
  }
  return charges;
}
