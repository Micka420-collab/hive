// Les réglages que la ruche honore, et ceux que son hôte peut voir.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Le README dit : « créez `.env` depuis `.env.example` ». Ce fichier est donc,
// en pratique, la LISTE COMPLÈTE de ce qu'un hôte apprendra jamais sur sa
// propre ruche. Un réglage que le code honore mais qui n'y figure pas n'existe
// que pour qui lit les sources — c'est-à-dire pour personne.
//
// Ce n'est pas une coquetterie de documentation. Le trou du secret de session
// (`HIVE_JWT_SECRET`, signé avec une clé publique dans toutes les
// installations) était exactement de cette forme : le code lisait une variable
// que rien n'apprenait à poser. La même passe a trouvé onze autres réglages
// invisibles, dont l'interrupteur du bac à sable, celui de l'autonomie réelle,
// la porte d'entrée des inscriptions et le secret des webhooks de paiement.
//
// La garde ci-dessous ferme la CLASSE entière : ajouter une lecture
// d'environnement sans l'écrire dans `.env.example` rend ce test rouge.

import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

function fichiersTs(dossier: string): string[] {
  const trouves: string[] = [];
  for (const entree of readdirSync(dossier)) {
    const chemin = path.join(dossier, entree);
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersTs(chemin));
    else if (chemin.endsWith('.ts')) trouves.push(chemin);
  }
  return trouves;
}

/**
 * Variables fournies par le système d'exploitation, jamais par l'hôte.
 *
 * Les documenter dans `.env.example` serait inviter quelqu'un à définir son
 * `PATH` pour faire tourner une ruche.
 */
const DU_SYSTEME = new Set([
  'PATH',
  'HOME',
  'USERPROFILE',
  'APPDATA',
  'LOCALAPPDATA',
  'XDG_CONFIG_HOME',
  'SYSTEMDRIVE',
  'SYSTEMROOT',
  'TMPDIR',
  'NODE_ENV',
]);

/** Chaque réglage lu quelque part dans `src/`, et le fichier qui le lit. */
function reglagesLus(): Map<string, string> {
  const lus = new Map<string, string>();
  for (const fichier of fichiersTs(path.join(RACINE, 'src'))) {
    const source = readFileSync(fichier, 'utf8');
    const relatif = path.relative(RACINE, fichier);
    // `env.NOM` couvre les deux formes du dépôt : `process.env.NOM` et le
    // paramètre `env` injecté des fonctions pures (`loadConfigFromEnv(env)`).
    for (const m of source.matchAll(/\benv\.([A-Z][A-Z_0-9]+)/g)) {
      if (!DU_SYSTEME.has(m[1]!)) lus.set(m[1]!, relatif);
    }
    for (const m of source.matchAll(/\benv\[['"]([A-Z][A-Z_0-9]+)['"]\]/g)) {
      if (!DU_SYSTEME.has(m[1]!)) lus.set(m[1]!, relatif);
    }
  }
  return lus;
}

describe('les réglages sont visibles par l’hôte', () => {
  it('CHAQUE réglage lu par le code figure dans .env.example', () => {
    const exemple = readFileSync(path.join(RACINE, '.env.example'), 'utf8');
    const invisibles = [...reglagesLus()]
      .filter(([nom]) => !exemple.includes(nom))
      .map(([nom, fichier]) => `${nom} — lu par ${fichier}`);
    // Le message d'échec nomme le coupable ET son fichier : la garde doit être
    // réparable sans enquête.
    expect(invisibles).toEqual([]);
  });

  it('les réglages les plus lourds de conséquences y sont, nommément', () => {
    // Une liste explicite en plus de la garde générale : ces quatre-là
    // décident du bac à sable, de la dépense sans surveillance, de qui peut
    // se créer un compte et de la validité d'un encaissement. Les perdre dans
    // un refactor coûterait plus cher que le test ne coûte à écrire.
    const exemple = readFileSync(path.join(RACINE, '.env.example'), 'utf8');
    for (const nom of [
      'HIVE_ISOLEMENT',
      'HIVE_RUNNER',
      'HIVE_INSCRIPTION',
      'HIVE_WEBHOOK_SECRET',
    ]) {
      expect(exemple, `${nom} absent de .env.example`).toContain(nom);
    }
  });
});

describe('aucun contact personnel ne part avec le code', () => {
  it('AUCUNE ADRESSE PERSONNELLE EN VALEUR DE REPLI', () => {
    // `/api/openalex/search` envoyait `mailto:` une adresse Gmail écrite en
    // dur. Le dépôt étant public, cette boîte partait avec CHAQUE installation
    // du monde : la personne recevait l'attribution du trafic de parfaits
    // inconnus, et son adresse était publiée sans qu'elle l'ait demandé.
    //
    // Même mécanique que le secret de session : un défaut dans un dépôt public
    // n'est pas un défaut, c'est une valeur imposée à tout le monde.
    const fournisseurs =
      /[a-zA-Z0-9._%+-]+@(gmail|googlemail|hotmail|outlook|live|yahoo|ymail|proton|protonmail|icloud|me|aol|gmx|free|orange|wanadoo|laposte)\.[a-z.]{2,}/;
    const coupables = fichiersTs(path.join(RACINE, 'src'))
      .map((f) => [path.relative(RACINE, f), readFileSync(f, 'utf8')] as const)
      .filter(([, source]) => fournisseurs.test(source))
      .map(([nom]) => nom);
    expect(coupables).toEqual([]);
  });
});
