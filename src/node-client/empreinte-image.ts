// L'EMPREINTE DE L'IMAGE DES AGENTS — de quoi `localhost/hive-agent:local` a
// été construite, réduit à une valeur que l'image porte et que le nœud relit.
//
// ─── UNE IMAGE PÉRIMÉE, ET RIEN NE LE DISAIT ─────────────────────────────────
//
// L'image par défaut du bac se construit SUR LE NŒUD (`COMMANDE_IMAGE`). Quand
// `docker/agents/Dockerfile` ou l'arbre épinglé des CLI change — l'environnement
// des validations corrigé, un CLI monté de version —, un nœud déjà installé
// GARDE l'image d'avant : `git pull` ne touche pas au magasin d'images du
// moteur, et le preflight y passe toujours (`claude --version` y répond). Le
// correctif n'atteignait donc jamais les membres existants, et rien ne le
// disait.
//
// La construction pose sur l'image l'empreinte de ses entrées
// (`ETIQUETTE_EMPREINTE`) ; le nœud au démarrage et `hive doctor` la relisent
// (`inspecterImage`) et la comparent à celle des entrées de la version
// installée (`fraicheurImage`, dans `isolement.ts`).
//
// ─── UN SEUL CALCUL, POUR LA CONSTRUCTION ET POUR LA VÉRIFICATION ───────────
//
// `scripts/image-agents.mjs` importe CE fichier, sans tsx : Node (24.18 au
// plancher du dépôt) efface lui-même les types d'un module TypeScript. D'où
// deux contraintes, tenues par un banc qui lance le vrai script
// (`tests/empreinte-image.test.ts`) : rien d'autre que des modules `node:`, et
// aucune syntaxe qui ne s'efface pas (enum, namespace, propriétés de
// constructeur).
//
// ─── CE QUE L'EMPREINTE NE DIT PAS ───────────────────────────────────────────
//
// De quelles entrées du DÉPÔT l'image a été construite — pas que la base
// `node:24-bookworm-slim`, étiquette flottante, n'a pas bougé depuis. Et elle ne
// distingue pas un changement qui casse d'un commentaire retouché : c'est
// pourquoi une image périmée se DIT, et ne se refuse pas (`bac.ts`).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Ce qui construit l'image par défaut du bac depuis un clone du dépôt, et y pose l'empreinte. */
export const COMMANDE_IMAGE = 'npm run bac:image';

/** La commande qui construit l'image dans CE moteur (`podman`, `docker`) : chacun a son magasin. */
export function commandeImage(moteur: string): string {
  return `${COMMANDE_IMAGE}${moteur === 'docker' ? ' -- --moteur docker' : ''}`;
}

/** L'étiquette d'image que la construction pose, et que le nœud relit. */
export const ETIQUETTE_EMPREINTE = 'hive.empreinte';

/**
 * Les entrées de la construction, depuis la racine du dépôt : le Dockerfile et
 * tout ce qu'il copie. Un banc confronte cette liste aux `COPY` du Dockerfile :
 * un fichier copié et non compté laisserait une image construite d'autres
 * entrées passer pour à jour.
 */
export const ENTREES_IMAGE: readonly string[] = [
  'docker/agents/Dockerfile',
  'docker/agents/package.json',
  'docker/agents/package-lock.json',
];

/**
 * L'empreinte des entrées sous `racine` (« sha256:… »), ou `null` si l'une est
 * illisible : une installation sans `docker/agents` (paquet npm, application de
 * bureau) ne sait pas ce qu'elle attendrait.
 *
 * Les fins de ligne CRLF sont ramenées à LF : un clone Windows
 * (`core.autocrlf`) construit la même image qu'un clone Linux, et doit porter
 * la même empreinte.
 */
export function empreinteImage(racine: string): string | null {
  const somme = createHash('sha256');
  for (const entree of ENTREES_IMAGE) {
    let contenu: string;
    try {
      contenu = readFileSync(path.join(racine, entree), 'utf8');
    } catch {
      return null;
    }
    // Le chemin, puis la somme du contenu : déplacer des octets d'une entrée à
    // l'autre change l'empreinte.
    const sommeEntree = createHash('sha256').update(contenu.replaceAll('\r\n', '\n')).digest('hex');
    somme.update(`${entree}\n${sommeEntree}\n`);
  }
  return `sha256:${somme.digest('hex')}`;
}

/** La racine de l'installation qui exécute ce code : `src/node-client/` comme `dist/node-client/`. */
const RACINE_INSTALLEE = fileURLToPath(new URL('../..', import.meta.url));

/** L'empreinte que la version installée attend de son image (`empreinteImage`). */
export function empreinteAttendue(): string | null {
  return empreinteImage(RACINE_INSTALLEE);
}

/**
 * Ce que l'étiquette d'une image PRÉSENTE dit d'elle, rapporté à la version de
 * Hive installée (`fraicheurImage`).
 */
export type FraicheurImage =
  /** Construite par `COMMANDE_IMAGE` depuis les entrées de cette version. */
  | { etat: 'a_jour' }
  /** L'image par défaut, construite d'autres entrées ; `lue` vaut `null` sans étiquette. */
  | { etat: 'perimee'; lue: string | null; attendue: string }
  /** Une image nommée par l'opérateur (`HIVE_ISOLEMENT_IMAGE`) : Hive n'en attend rien. */
  | { etat: 'non_geree' }
  /** Cette installation n'a pas les entrées de l'image : rien à quoi comparer. */
  | { etat: 'inconnue' };

/** Le début d'une empreinte, assez pour en distinguer deux à l'œil. */
function courte(empreinte: string): string {
  return `${empreinte.slice(0, 'sha256:'.length + 12)}…`;
}

/** Pourquoi l'image est périmée — la même raison au démarrage du nœud et dans `hive doctor`. */
export function raisonPeremption(p: { lue: string | null; attendue: string }): string {
  return p.lue === null
    ? 'sans empreinte : construite par une version antérieure de Hive'
    : `empreinte ${courte(p.lue)} au lieu de ${courte(p.attendue)} : ` +
        'construite depuis d’autres entrées que celles de cette version';
}
