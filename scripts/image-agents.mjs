// Construit, sur CE nœud, l'image par défaut du bac à sable des agents.
//
//     npm run bac:image                      # podman s'il répond, sinon docker
//     npm run bac:image -- --moteur docker   # le moteur que le nœud retiendra
//
// ─── POURQUOI UNE CONSTRUCTION LOCALE, ET PAS UNE IMAGE PUBLIÉE ──────────────
//
// L'image par défaut était `node:20-slim` : aucune CLI d'agent dedans, donc un
// niveau conteneur inatteignable pour un vrai agent. Hive nomme désormais par
// défaut l'image que `docker/agents/Dockerfile` décrit (Node 24, Claude Code,
// Codex, Cline, arbre épinglé par un lockfile). La publier signée sur un
// registre engagerait un compte et une clé de signature que le dépôt n'a pas ;
// la construire ici ne fait entrer AUCUN registre tiers dans la chaîne de
// confiance, au prix d'une construction par machine.
//
// ─── LE MÊME NOM QUE `IMAGE_DEFAUT` (src/node-client/isolement.ts) ───────────
//
// Un test relit ce fichier et exige le même nom : une image construite sous un
// autre tag serait « absente » pour le nœud, qui renverrait ici en boucle.
//
// Chaque moteur a son PROPRE magasin d'images : l'image construite par Docker
// n'existe pas pour Podman. Le nœud éprouve les moteurs dans l'ordre et garde
// le premier qui a l'image — construire dans l'un suffit.
//
// ─── L'EMPREINTE, POSÉE ICI ET RELUE PAR LE NŒUD ─────────────────────────────
//
// L'image porte l'étiquette `hive.empreinte` : l'empreinte du Dockerfile et de
// ce qu'il copie, calculée par le module que le nœud et `hive doctor` utilisent
// pour la vérifier (`src/node-client/empreinte-image.ts`, chargé sans tsx). Une
// image construite AVANT une mise à jour de Hive qui change ces entrées se dit
// alors « périmée », avec cette commande — au lieu de servir en silence.

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ENTREES_IMAGE,
  ETIQUETTE_EMPREINTE,
  empreinteImage,
} from '../src/node-client/empreinte-image.ts';

const IMAGE = 'localhost/hive-agent:local';
const MOTEURS = ['podman', 'docker'];
const racine = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Le moteur demandé (`--moteur x`), ou le premier dont le service répond. */
function choisirMoteur(argv) {
  const i = argv.indexOf('--moteur');
  if (i >= 0) {
    const nom = argv[i + 1];
    if (!MOTEURS.includes(nom ?? '')) {
      console.error(`✘ --moteur attend ${MOTEURS.join(' ou ')}, pas « ${nom ?? ''} ».`);
      process.exit(2);
    }
    return nom;
  }
  // `info`, pas `--version` : un Docker installé démon arrêté répond à
  // `--version` et échouerait au premier `build`.
  return MOTEURS.find(
    (m) => spawnSync(m, ['info'], { shell: false, stdio: 'ignore', timeout: 15_000 }).status === 0,
  );
}

const moteur = choisirMoteur(process.argv.slice(2));
if (!moteur) {
  console.error(
    '✘ Aucun moteur de conteneurs ne répond (podman info, docker info).\n' +
      '  Installez podman (https://podman.io/docs/installation) ou démarrez Docker, puis relancez.',
  );
  process.exit(1);
}

const empreinte = empreinteImage(racine);
if (!empreinte) {
  console.error(
    `✘ Les entrées de l'image sont illisibles (${ENTREES_IMAGE.join(', ')}).\n` +
      '  Lancez cette commande depuis un clone complet du dépôt.',
  );
  process.exit(1);
}

console.log(`\n🛠  Construction de ${IMAGE} avec ${moteur} (docker/agents/Dockerfile)…\n`);
const construction = spawnSync(
  moteur,
  [
    'build',
    '--file',
    'docker/agents/Dockerfile',
    // Une étiquette posée à la construction, pas un `LABEL` du Dockerfile :
    // elle ne touche aucune couche, le cache de `npm ci` reste valable, et une
    // construction à la main (sans elle) se dira « sans empreinte ».
    '--label',
    `${ETIQUETTE_EMPREINTE}=${empreinte}`,
    '--tag',
    IMAGE,
    '.',
  ],
  { cwd: racine, shell: false, stdio: 'inherit' },
);
if (construction.status !== 0) {
  console.error(`\n✘ La construction a échoué (${moteur} build, code ${construction.status}).`);
  process.exit(construction.status ?? 1);
}
console.log(
  `\n✔ ${IMAGE} est prête dans ${moteur} (${ETIQUETTE_EMPREINTE}=${empreinte}).\n` +
    "  Relancez le nœud : son preflight y éprouvera l'agent.\n" +
    '  HIVE_ISOLEMENT_IMAGE n’a pas à être posée : c’est l’image par défaut.\n',
);
