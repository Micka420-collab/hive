// LE PAS 7/7 — une tâche est confiée à la ruche, et la ruche PRODUIT.
//
//   node scripts/essai-travail.mjs --racine <ruche installée>
//
// ─── LE TROU QUE CE PAS FERME ────────────────────────────────────────────────
//
// Le parcours de seuil s'arrêtait à « un invité est dans la ruche ». Six
// affirmations, et pas une qui mène un travail jusqu'à un résultat — c'est-à-dire
// juste avant la SEULE chose que Hive promet. Un arrivant y est à sa troisième
// minute ; si ce chemin cassait dans une version publiée, rien en CI ne le
// verrait.
//
// C'est la forme exacte du trou qu'étaient les pas 4/5 et 6/6, et les deux ont
// trouvé un défaut réel à leur PREMIÈRE exécution — `install.ps1` qui ne
// construisait pas l'écran, puis le ménage Windows qui renversait un verdict
// gagné.
//
// ─── L'OUVRIÈRE EXISTE DÉJÀ, ET C'EST VOULU ──────────────────────────────────
//
// L'essai de seuil lance `npm run ruche` sans drapeau : la Reine, UNE OUVRIÈRE
// et l'écran. Ce pas n'a donc personne à recruter — il confie un travail à la
// ruche telle qu'un arrivant vient de l'installer, et regarde ce qui en sort.
//
// L'adaptateur par défaut est `shell (simulé)` : aucun processus lancé, un diff
// factice mais réaliste. C'est ce qu'un arrivant obtient sans clé d'API, et donc
// exactement ce que ce pas doit mesurer. Ce qu'il NE mesure pas, et qu'il faut
// dire : la qualité de ce que produit un VRAI agent. Ce pas prouve que la
// chaîne — création, assignation, exécution, rangement, relecture — est entière ;
// pas qu'un modèle écrit du bon code.
//
// ─── LES DÉCISIONS SONT AILLEURS ─────────────────────────────────────────────
//
// `scripts/travail-fait.mjs` porte les verdicts, et `tests/travail-fait.test.mjs`
// les tient (12 cas, six mutants rejoués). Ici il ne reste que l'impur : le
// réseau, l'attente, le journal.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { lireEnv } from './premier-quart-heure.mjs';
import {
  EN_COURS,
  creationAcceptee,
  defautDuTravail,
  doitAttendre,
  etatDeLaTache,
  gagnanteDe,
  identifiantCree,
  noeudsDe,
  racineDemandee,
  refusDeLEtat,
} from './travail-fait.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

/** Combien de temps on laisse à l'ouvrière. Le travail simulé prend ~2 s. */
const PATIENCE_S = 90;

// ─── UN ÉCHEC SE DIT, IL NE DÉROULE PAS UNE PILE ─────────────────────────────
//
// Même forme que ses deux jumeaux, et pour la raison mesurée là-bas : douze
// lignes de pile Node pour dire « la ruche ne répond plus » font soupçonner
// `fetch`, l'essai, le réseau du runner — tout sauf ce qui s'est passé.
//
// Et `process.exitCode` plutôt que `process.exit()` : sous Windows, couper la
// boucle d'événements avec une connexion `fetch` encore en vol fait abandonner
// libuv sur une assertion (§ 9 nonacenties).
class EssaiRate extends Error {}
const rate = (quoi) => {
  throw new EssaiRate(quoi);
};

const racine = racineDemandee(process.argv.slice(2));

let base = '';
let port = '';

async function demander(chemin, options = {}) {
  try {
    return await fetch(base + chemin, options);
  } catch (e) {
    const cause = e?.cause?.code ?? e?.message ?? String(e);
    rate(`la ruche ne répond plus sur :${port} (${chemin}) — ${cause}`);
  }
}

/** L'instantané que LIT LE TABLEAU — la même source, jamais la base en direct. */
async function instantane(entetes) {
  const r = await demander('/api/state', { headers: entetes });
  if (r.status !== 200) rate(`7/7 — l’instantané rend ${r.status}`);
  return r.json();
}

async function principal() {
  if (racine === null) {
    console.error('usage : node scripts/essai-travail.mjs --racine <dossier de la ruche>');
    return MAL_APPELE;
  }

  const env = lireEnv(readFileSync(path.join(racine, '.env'), 'utf8'));
  port = env.HIVE_PORT ?? '';
  const jeton = env.HIVE_TOKEN ?? '';
  if (!port || !jeton) rate('.env sans HIVE_PORT ou HIVE_TOKEN — l’essai ne peut rien conclure');

  base = `http://127.0.0.1:${port}`;
  const entetes = { 'x-hive-token': jeton };

  // ─── LE PROJET DU PAS 5/5 ──────────────────────────────────────────────────
  //
  // On réutilise celui que le parcours vient de créer plutôt que d'en faire un
  // autre : c'est le projet de l'arrivant, et confier le travail ailleurs
  // mesurerait un chemin que personne n'emprunte.
  const avant = await instantane(entetes);
  const projet = (avant.projects ?? [])[0];
  if (!projet?.id) rate('7/7 — aucun projet dans la ruche : le pas 5/5 aurait dû en laisser un');

  // ─── ET UNE OUVRIÈRE POUR LE PRENDRE ───────────────────────────────────────
  //
  // Vérifié AVANT de confier quoi que ce soit. Sans ouvrière, la tâche resterait
  // en file jusqu'à la patience entière, et le rouge dirait « rien n'a bougé » —
  // en accusant l'exécution alors que personne n'était là pour exécuter.
  if (noeudsDe(avant).size === 0) {
    rate('7/7 — aucune ouvrière dans la ruche : personne ne peut prendre le travail');
  }

  const creation = await demander(`/api/projects/${encodeURIComponent(projet.id)}/tasks`, {
    method: 'POST',
    headers: { ...entetes, 'content-type': 'application/json' },
    body: JSON.stringify({
      tasks: [
        {
          title: 'Le premier travail de la ruche',
          prompt: 'Remplacer la cire par du miel dans le fichier d’essai.',
        },
      ],
    }),
  });
  if (!creationAcceptee(creation.status)) {
    rate(`7/7 — la ruche refuse la tâche (${creation.status}) : ${await creation.text()}`);
  }
  // La route rend le TABLEAU des tâches créées, pas un objet qui les enveloppe
  // (`reply.code(201).send(created)`). Lu sur le contrat, pas deviné : une
  // enveloppe supposée aurait rendu `undefined` et fait échouer le pas sur sa
  // propre lecture, en accusant la ruche.
  const remis = await creation.json();
  const taskId = identifiantCree(remis);
  if (taskId === null) {
    rate(`7/7 — la ruche accepte la tâche sans rendre d’identifiant : ${JSON.stringify(remis)}`);
  }

  // ─── ON REGARDE, ON NE DORT PAS UN TEMPS FIXE ──────────────────────────────
  //
  // Une attente en dur est un pari sur la vitesse de la machine (§ 9
  // octoquadragies). On interroge la ruche jusqu'à ce que la tâche ait FINI —
  // d'une façon ou d'une autre.
  let etat = EN_COURS;
  let vu = null;
  for (let i = 0; i < PATIENCE_S && doitAttendre(etat); i++) {
    await attendre(1000);
    vu = await instantane(entetes);
    etat = etatDeLaTache(vu, taskId);
  }

  const refus = refusDeLEtat(etat, taskId, PATIENCE_S);
  if (refus !== null) rate(`7/7 — ${refus}`);

  // ─── « FAITE » NE SUFFIT PAS : ON DEMANDE LA PREUVE ────────────────────────
  //
  // Le statut est déclaratif. Ce qui prouve le travail, c'est le résultat rangé :
  // un succès, un diff non vide, et un nœud que la ruche connaît.
  const resultats = await demander(`/api/tasks/${encodeURIComponent(taskId)}/results`, {
    headers: entetes,
  });
  if (resultats.status !== 200) {
    rate(`7/7 — les résultats de la tâche rendent ${resultats.status}`);
  }
  const lignes = await resultats.json();
  const defaut = defautDuTravail(lignes, noeudsDe(vu));
  if (defaut !== null) rate(`7/7 — ${defaut}`);

  const gagnante = gagnanteDe(lignes);
  console.log(
    `✔ 7/7 — une tâche a été confiée, exécutée par ${gagnante.nodeId} ` +
      `et rendue avec ${gagnante.diff.length} signes de diff (${taskId.slice(0, 8)}…)`,
  );
  return OK;
}

try {
  process.exitCode = await principal();
} catch (e) {
  if (!(e instanceof EssaiRate)) throw e;
  console.error(`✘ ${e.message}`);
  process.exitCode = ECHEC;
}
