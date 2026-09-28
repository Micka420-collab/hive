// Les préférences de la coquille — pas celles de la ruche, qui vivent dans
// son `.env`. Un petit fichier JSON dans le dossier de l'app : ce que l'app
// retient d'un lancement à l'autre sur ELLE-MÊME (fermeture, version vue,
// ruche ouverte hors de l'app).

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export interface Preferences {
  /** Linux : fermer la fenêtre garde la ruche en arrière-plan (défaut : fermer quitte). */
  readonly garderEnArrierePlan: boolean;
  /** La notification « Hive continue en arrière-plan » a déjà été montrée. */
  readonly fermetureDite: boolean;
  /** La version de l'app au dernier lancement — une différence déclenche la sauvegarde. */
  readonly derniereVersion: string | null;
  /** « Ouvrir cette ruche » : la ruche installée par git que l'app affiche sans la lancer. */
  readonly externe: string | null;
}

const DEFAUT: Preferences = {
  garderEnArrierePlan: false,
  fermetureDite: false,
  derniereVersion: null,
  externe: null,
};

let fichier = '';
let courantes: Preferences = DEFAUT;

export function chargerPreferences(dossier: string): Preferences {
  fichier = path.join(dossier, 'bureau.json');
  try {
    const brut = JSON.parse(readFileSync(fichier, 'utf8')) as Partial<Preferences>;
    courantes = { ...DEFAUT, ...brut };
  } catch {
    courantes = DEFAUT;
  }
  return courantes;
}

export function preferences(): Preferences {
  return courantes;
}

export function poserPreferences(partiel: Partial<Preferences>): void {
  courantes = { ...courantes, ...partiel };
  try {
    writeFileSync(fichier, `${JSON.stringify(courantes, null, 2)}\n`, { mode: 0o600 });
  } catch {
    // Une préférence non écrite se redemandera : rien ne casse.
  }
}
