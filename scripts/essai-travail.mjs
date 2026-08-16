// LE PAS 7/7 — une tâche est confiée à la ruche, et la ruche PRODUIT.
//
//   node scripts/essai-travail.mjs --racine <ruche installée>
//
// ─── CE QU'IL RESTE ICI, ET RIEN D'AUTRE ─────────────────────────────────────
//
// Lire le `.env`, fabriquer la vraie ruche au-dessus de `fetch`, imprimer. La
// SÉQUENCE est dans `pas-travail.mjs`, les DÉCISIONS dans `travail-fait.mjs`,
// et les deux sont éprouvées sans installer quoi que ce soit.
//
// Ce fichier a déjà déclaré deux fois n'avoir gardé que l'impur, et la loupe l'a
// démenti les deux fois — six décisions, puis quatre lignes de câblage. La
// troisième affirmation ne vaudra pas mieux que la mesure qui la suit.
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

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as attendre } from 'node:timers/promises';
import { lireEnv } from './premier-quart-heure.mjs';
import { racineDemandee } from './travail-fait.mjs';
import { PATIENCE_S, menerLePas } from './pas-travail.mjs';

const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

const racine = racineDemandee(process.argv.slice(2));

/**
 * La vraie ruche, au-dessus de `fetch`.
 *
 * Une panne de transport est rendue comme un STATUT hors 200 plutôt que jetée :
 * la séquence sait déjà refuser un statut, et douze lignes de pile Node pour
 * dire « la ruche ne répond plus » font soupçonner `fetch`, l'essai, le réseau
 * du runner — tout sauf ce qui s'est passé.
 */
function rucheReelle(base, entetes) {
  const demander = async (chemin, options = {}) => {
    try {
      const r = await fetch(base + chemin, options);
      const texte = await r.text();
      let corps = null;
      try {
        corps = JSON.parse(texte);
      } catch {
        corps = null;
      }
      return { status: r.status, corps, texte };
    } catch (e) {
      const cause = e?.cause?.code ?? e?.message ?? String(e);
      return { status: 0, corps: null, texte: `la ruche ne répond plus (${chemin}) — ${cause}` };
    }
  };
  return {
    instantane: () => demander('/api/state', { headers: entetes }),
    creerTache: (projetId, travail) =>
      demander(`/api/projects/${encodeURIComponent(projetId)}/tasks`, {
        method: 'POST',
        headers: { ...entetes, 'content-type': 'application/json' },
        body: JSON.stringify({ tasks: [travail] }),
      }),
    resultats: (taskId) =>
      demander(`/api/tasks/${encodeURIComponent(taskId)}/results`, { headers: entetes }),
    patienter: (ms) => attendre(ms),
  };
}

async function principal() {
  if (racine === null) {
    console.error('usage : node scripts/essai-travail.mjs --racine <dossier de la ruche>');
    return MAL_APPELE;
  }

  const env = lireEnv(readFileSync(path.join(racine, '.env'), 'utf8'));
  const port = env.HIVE_PORT ?? '';
  const jeton = env.HIVE_TOKEN ?? '';
  if (!port || !jeton) {
    console.error('✘ 7/7 — .env sans HIVE_PORT ou HIVE_TOKEN : l’essai ne peut rien conclure');
    return ECHEC;
  }

  const ruche = rucheReelle(`http://127.0.0.1:${port}`, { 'x-hive-token': jeton });
  const verdict = await menerLePas(ruche, PATIENCE_S);

  // ─── `process.exitCode`, JAMAIS `process.exit()` ───────────────────────────
  //
  // Sous Windows, couper la boucle d'événements avec une connexion `fetch`
  // encore en vol fait abandonner libuv sur une assertion (§ 9 nonacenties).
  // Le verdict était bon, la sortie non.
  if (!verdict.ok) {
    console.error(`✘ 7/7 — ${verdict.raison}`);
    return ECHEC;
  }
  console.log(`✔ 7/7 — ${verdict.message}`);
  return OK;
}

process.exitCode = await principal();
