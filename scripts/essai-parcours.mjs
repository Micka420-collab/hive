// LE PARCOURS DE L'ARRIVANT — « j'ouvre le tableau, je crée mon premier projet ».
//
//     node scripts/essai-parcours.mjs --racine /chemin/vers/la/ruche/installee
//
// ─── CE QU'IL PROLONGE ───────────────────────────────────────────────────────
//
// Les trois essais d'installation (`essai-installation.sh` et `.ps1`) mènent la
// commande du README jusqu'à une ruche qui répond sur `/api/pulse`. Ils
// s'arrêtent là — et le point de sortie du 15 août le dit sans arrondir :
//
//     « Je n'ai PAS de mesure bout-en-bout j'installe → j'ouvre le tableau →
//       je crée mon premier projet. Des morceaux sont éprouvés, le PARCOURS ne
//       l'est pas. Tant qu'il ne l'est pas, je ne peux pas dire qu'il marche. »
//
// Ce script est les deux pas manquants. Il tourne juste après le troisième, sur
// la ruche que l'installation vient réellement de démarrer, dans les TROIS
// jambes de seuil.
//
// ─── EN NODE, ET PAS DEUX FOIS DANS DEUX LANGAGES ────────────────────────────
//
// Les deux essais sont jumeaux — l'un en `sh`, l'autre en PowerShell — et
// `tests/installeurs-jumeaux.test.ts` existe parce qu'ils avaient déjà divergé
// en silence. Réécrire ces deux pas dans les deux langages, avec du JSON à
// analyser des deux côtés, aurait fabriqué la même divergence en plus cher.
//
// Node est là de toute façon : c'est ce qu'on vient d'installer. Une seule
// implémentation, appelée par les deux — et ses décisions sont éprouvées à part,
// dans `tests/premier-quart-heure.test.mjs`, où elles peuvent être mutées.
//
// ─── LE JETON NE PASSE JAMAIS EN ARGUMENT ────────────────────────────────────
//
// On reçoit la RACINE, jamais le secret. Le jeton est lu dans le `.env` que
// l'installeur vient d'écrire, et voyage dans un EN-TÊTE. Un secret en argument
// de commande se retrouve dans la table des processus et dans les journaux
// de la CI, où il reste consultable longtemps après.

import { readFileSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import {
  RAISON_ECRAN,
  lireEnv,
  projetDansInstantane,
  verdictEcran,
} from './premier-quart-heure.mjs';

/** Ce que le script rend, et ce que chaque code veut dire pour qui lit la CI. */
const OK = 0;
const ECHEC = 1;
const MAL_APPELE = 64;

function arguments_(argv) {
  let racine = null;
  // ─── ÉQUIVALENCE CONSIGNÉE (§ 2.16 ter) ────────────────────────────────────
  //
  // `<` → `<=` ne peut être distingué par AUCUNE entrée. Au tour de trop,
  // `argv[i]` vaut `undefined` : la seule comparaison de la boucle
  // (`=== '--racine'`) échoue, donc rien n'est lu ni écrit, et `racine` sort
  // inchangé. Le mutant ne coûte qu'un tour vide.
  //
  // Mesuré, pas supposé : mutant posé, rejeu sur les deux bancs qui exercent ce
  // fichier — `24 passed (24)`. Il SURVIT, ce qui est ce qu'on attend d'une
  // équivalence établie, et non ce qu'on espère d'une garde.
  //
  // La borne reste : elle est la condition d'arrêt de la marche.
  // loupe : équivalent — < → <=
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--racine') {
      racine = argv[i + 1] ?? null;
      i++;
    }
  }
  return racine;
}

const racine = arguments_(process.argv.slice(2));
if (racine === null) {
  console.error('usage : node scripts/essai-parcours.mjs --racine <dossier de la ruche>');
  process.exit(MAL_APPELE);
}

const env = lireEnv(readFileSync(path.join(racine, '.env'), 'utf8'));
const port = env.HIVE_PORT;
const jeton = env.HIVE_TOKEN;
if (!port || !jeton) {
  console.error('✘ .env sans HIVE_PORT ou HIVE_TOKEN — l’essai ne peut rien conclure');
  process.exit(ECHEC);
}

const base = `http://127.0.0.1:${port}`;
// Le jeton vit dans un en-tête, jamais dans une URL : une URL se journalise.
const entetes = { 'x-hive-token': jeton };

function rate(quoi) {
  console.error(`✘ ${quoi}`);
  process.exit(ECHEC);
}

// ─── UNE RUCHE QUI MEURT DOIT LE DIRE, PAS DÉROULER UNE PILE ─────────────────
//
// Défaut MESURÉ sur ce script même, en l'éprouvant contre une ruche éteinte :
//
//     [TypeError: fetch failed] {
//       [cause]: Error: connect ECONNREFUSED 127.0.0.1:7911
//         at TCPConnectWrap.afterConnect [as oncomplete] (node:net:1864:16)
//
// Douze lignes de pile Node pour dire « la ruche ne répond plus ». Celui qui
// lit ce journal en CI commence par soupçonner `fetch`, l'essai, le réseau du
// runner — tout sauf ce qui s'est réellement passé : le pas 3/3 avait démarré
// une ruche qui est morte avant le pas 4/5.
//
// C'est exactement le reproche que le banc de `projetDansInstantane` fait à une
// exception : « une exception donne une trace de pile ; un verdict donne la
// phrase qu'on a écrite ». Le reproche valait pour ce fichier-ci.
async function demander(chemin, options = {}) {
  try {
    return await fetch(base + chemin, options);
  } catch (e) {
    const cause = e?.cause?.code ?? e?.message ?? String(e);
    rate(`la ruche ne répond plus sur :${port} (${chemin}) — ${cause}`);
  }
}

// ─── 4/5. J'OUVRE LE TABLEAU ─────────────────────────────────────────────────
//
// Pas « la racine rend 200 » : les quatre pages possibles rendent 200, et trois
// sont des écrans blancs. C'est `verdictEcran` qui tranche, et c'est elle qui
// est mutée dans le banc.
//
// ⚠ CE QU'ON A MESURÉ EN PASSANT, ET QU'IL FAUT DIRE : ce pas passe AVEC UN
// JETON FAUX. `GET /` est servi par `fastifyStatic`, hors de la porte du jeton
// — vérifié en pointant cet essai sur un `.env` au jeton mutilé : 4/5 vert,
// 5/5 en 401. La COQUILLE du tableau est donc lisible par quiconque atteint le
// port ; les DONNÉES, elles, restent derrière le jeton.
//
// Sur une ruche locale c'est sans conséquence. Sur une ruche exposée, cela dit
// « Hive tourne ici » à un visiteur non authentifié. Ce n'est pas le sujet de ce
// lot et on ne le corrige pas ici — mais on ne le laisse pas non plus passer
// sans l'écrire.
const racineHttp = await demander('/', { headers: entetes });
if (racineHttp.status !== 200) rate(`la racine de la ruche rend ${racineHttp.status}`);

const verdict = verdictEcran(await racineHttp.text());
if (verdict !== 'construit') rate(`4/5 — ${RAISON_ECRAN[verdict] ?? verdict}`);
console.log('✔ 4/5 — le tableau est servi et charge son paquet');

// ─── 5/5. JE CRÉE MON PREMIER PROJET ─────────────────────────────────────────
//
// Le nom porte la date de l'essai plutôt qu'un mot fixe : sur une ruche qu'on
// relancerait sans l'effacer, deux essais laisseraient deux projets homonymes,
// et chercher par nom se mettrait à mentir. On cherche par ID, mais le nom aide
// celui qui ouvrira la base après un rouge.
const nom = `Mon premier rucher (essai ${new Date().toISOString()})`;
const creation = await demander('/api/projects', {
  method: 'POST',
  headers: { ...entetes, 'content-type': 'application/json' },
  body: JSON.stringify({ name: nom }),
});
if (creation.status !== 201) {
  rate(`5/5 — la création du premier projet rend ${creation.status} : ${await creation.text()}`);
}
const projet = await creation.json();
if (!projet?.id) rate('5/5 — le projet créé revient SANS identifiant');

// ─── ET ON LE RELIT LÀ OÙ LE TABLEAU LE LIT ──────────────────────────────────
//
// Se contenter de la réponse de création mesurerait que la route répond, pas que
// le projet EXISTE : une création qui n'atteindrait pas le magasin rendrait
// exactement le même corps. Le tableau, lui, lit `/api/state`.
const etat = await demander('/api/state', { headers: entetes });
if (etat.status !== 200) rate(`5/5 — l’instantané que lit le tableau rend ${etat.status}`);
if (!projetDansInstantane(await etat.json(), projet.id)) {
  rate(`5/5 — le projet ${projet.id} a été créé et n’est PAS dans l’instantané du tableau`);
}

console.log(`✔ 5/5 — premier projet créé (${projet.id}) et visible par le tableau`);
process.exit(OK);
