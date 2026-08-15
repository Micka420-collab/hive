// LE PREMIER QUART D'HEURE — les décisions de l'essai de parcours.
//
// ─── CE QUE CE BANC GARDE, ET CE QU'IL NE GARDE PAS ──────────────────────────
//
// Il garde les DÉCISIONS : « qu'est-ce que la ruche vient de me servir ? »,
// « le projet est-il dans l'instantané ? », « que dit ce `.env` ? ». Il ne
// garde pas le réseau — c'est `scripts/essai-parcours.mjs` qui l'exerce, dans
// les trois jambes de seuil, contre une ruche RÉELLEMENT installée.
//
// Le partage est délibéré. Le réseau ne se joue qu'en CI, une fois par PR et
// par système ; les décisions se jouent ici en quelques millisecondes, et
// peuvent donc être MUTÉES une à une. Une décision qu'on ne peut éprouver qu'à
// travers un `npm install` de deux minutes n'est éprouvée qu'en apparence.
//
// ─── EN `.mjs`, ET C'EST LA CONVENTION DU DÉPÔT ──────────────────────────────
//
// Un banc qui importe un `scripts/*.mjs` doit être `.mjs` : ces modules n'ont
// pas de déclarations de types, et TypeScript refuse l'import (TS7016). Voir
// `loupe-verdict`, `tamis-ordres`, `vitest-forks`, `deps-optionnelles`.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  RAISON_ECRAN,
  lireEnv,
  projetDansInstantane,
  verdictEcran,
} from '../scripts/premier-quart-heure.mjs';

// Les quatre pages que la racine peut réellement servir. Elles sont écrites ici
// telles quelles — pas construites par une fonction — pour qu'on VOIE ce qui
// distingue un écran blanc d'un tableau.
const TABLEAU = `<!doctype html><html lang="fr"><head><meta charset="UTF-8" />
<title>Hive — Swarm View</title>
<script type="module" crossorigin src="/assets/index--vml5R0R.js"></script>
<link rel="stylesheet" crossorigin href="/assets/index-DbVh7Tzw.css">
</head><body><div id="root"></div></body></html>`;

const GABARIT = `<!doctype html><html lang="fr"><head><meta charset="UTF-8" />
<title>Hive — Swarm View</title></head>
<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`;

const REPLI = `<!doctype html><html lang="fr"><head>
<title>Hive — l'écran n'est pas construit</title></head>
<body><main><h1>La ruche tourne. L'écran, lui, n'est pas construit.</h1>
<code>npm run build:dashboard</code></main></body></html>`;

const COQUILLE = `<!doctype html><html lang="fr"><head><title>Hive</title></head>
<body><div id="root"></div></body></html>`;

describe('ce que la ruche sert à la racine', () => {
  it('LES QUATRE PAGES SE DISTINGUENT — elles rendent toutes HTTP 200', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Trois de ces quatre pages sont des PANNES, et les quatre rendent 200. Un
    // essai qui regarde le code de statut les déclare identiques — c'est
    // précisément l'erreur qu'on veut rendre impossible ici.
    expect(verdictEcran(TABLEAU), 'un tableau construit n’est pas reconnu').toBe('construit');
    expect(verdictEcran(GABARIT), 'le gabarit de développement passe pour un tableau').toBe(
      'source',
    );
    expect(verdictEcran(REPLI), 'la page de repli passe pour un tableau').toBe('repli');
    expect(verdictEcran(COQUILLE), 'une page sans script passe pour un tableau').toBe('coquille');
  });

  it('LE GABARIT EST LE PIÈGE — il a tout du tableau sauf ce qui compte', () => {
    // ─── POURQUOI CE CAS A SON PROPRE BANC ─────────────────────────────────
    //
    // Le gabarit `dashboard/index.html` et le tableau construit ont le MÊME
    // titre, le MÊME `<div id="root">`, et tous deux portent un `<script
    // type="module">`. La seule différence est ce que ce script demande :
    //
    //     construit  →  /assets/index--vml5R0R.js   (un paquet, il existe)
    //     gabarit    →  /src/main.tsx               (Vite seul sait le lire)
    //
    // Servi en production, le second donne un ÉCRAN BLANC — pas d'erreur, pas
    // de message, juste rien. C'est la panne la plus coûteuse à diagnostiquer
    // pour un arrivant, parce qu'elle ressemble à une page qui charge.
    expect(
      GABARIT.includes('id="root"') && GABARIT.includes('<script'),
      'le cas ne mesure rien : le gabarit devrait ressembler au tableau',
    ).toBe(true);
    expect(verdictEcran(GABARIT)).not.toBe('construit');

    // Et ce n'est pas l'extension seule qui décide : un chemin `/src/` sans
    // extension est le même piège.
    const sansExtension = GABARIT.replace('/src/main.tsx', '/src/main');
    expect(verdictEcran(sansExtension), 'un chemin /src sans extension passe').toBe('source');
  });

  it('une page vraiment étrangère ne se fait pas passer pour un tableau', () => {
    // Un proxy d'entreprise, un portail captif, une page d'erreur d'un serveur
    // qu'on n'attendait pas : tout cela rend 200 et n'est pas Hive. `inconnu`
    // existe pour que ce cas ait un nom, au lieu de tomber dans `coquille`.
    expect(verdictEcran('<html><body><h1>Portail</h1></body></html>')).toBe('inconnu');
    expect(verdictEcran(''), 'une réponse VIDE serait le plus trompeur des cas').toBe('inconnu');
  });

  it('chaque verdict a une raison écrite — un rouge doit se lire sans le code', () => {
    // Une garde sur la PORTÉE de la table (§ 9 quinoctogies) : le jour où l'on
    // ajoute un cinquième verdict, il ne doit pas pouvoir arriver muet. Un essai
    // qui échoue en disant « verdict: undefined » oblige à rouvrir le source.
    for (const v of ['construit', 'repli', 'source', 'coquille', 'inconnu']) {
      expect(RAISON_ECRAN[v], `le verdict « ${v} » n’a pas de raison écrite`).toBeTruthy();
    }
  });
});

describe('le .env que l’installeur vient d’écrire', () => {
  it('le port et le jeton se lisent, les commentaires ne comptent pas', () => {
    const env = lireEnv(['# la ruche', 'HIVE_PORT=7777', '', 'HIVE_TOKEN=abc123', '  '].join('\n'));
    expect(env.HIVE_PORT).toBe('7777');
    expect(env.HIVE_TOKEN).toBe('abc123');
    expect(Object.keys(env).sort()).toEqual(['HIVE_PORT', 'HIVE_TOKEN']);
  });

  it('UN JETON N’EST PAS MUTILÉ — il peut contenir n’importe quoi', () => {
    // ─── LE CAS QUI DÉPARTAGE ──────────────────────────────────────────────
    //
    // La tentation, en écrivant ce genre de lecteur, est de « nettoyer » la
    // valeur : retirer les guillemets, couper au premier `=`, trancher aux
    // espaces. Chacune de ces politesses casse un secret le jour où il en
    // contient un.
    //
    // Un jeton mutilé donne un 401 sur une ruche parfaitement saine — et l'essai
    // accuserait l'installation d'un défaut qui serait le sien.
    const env = lireEnv('HIVE_TOKEN="a=b=c"\nHIVE_SECRET=fin#pas-un-commentaire');
    expect(env.HIVE_TOKEN, 'un jeton à guillemets ou à « = » est mutilé').toBe('"a=b=c"');
    expect(env.HIVE_SECRET, 'un « # » au milieu d’une valeur la tronque').toBe(
      'fin#pas-un-commentaire',
    );
  });

  it('une ligne sans « = », ou qui commence par « = », est ignorée', () => {
    expect(Object.keys(lireEnv('juste du texte\n=sans-nom\nA=1'))).toEqual(['A']);
  });

  it('UN RÉGLAGE COMMENTÉ reste commenté, même s’il porte un « = »', () => {
    // ─── LA SURVIVANTE QUE LA LOUPE A TROUVÉE ──────────────────────────────
    //
    //     if (nu === '' || nu.startsWith('#')) continue;   mutée en `&&`
    //
    // Le premier banc ne la départageait pas, et la raison est instructive :
    // son commentaire était `# la ruche`, sans `=`. Mutée, la ligne n'était
    // plus écartée par CE test-là — mais la garde suivante (`coupe <= 0`) la
    // rattrapait, puisqu'elle ne contient pas de `=`. Deux mondes, un seul
    // résultat : rien à mesurer.
    //
    // L'entrée qui DÉPARTAGE est un réglage COMMENTÉ — la chose la plus
    // naturelle du monde dans un `.env`, où l'on désactive une ligne en la
    // préfixant plutôt qu'en l'effaçant. Mutée, `lireEnv` en fait une clé
    // « # HIVE_PORT », et le fichier se met à contenir des réglages fantômes
    // que personne n'a écrits.
    const env = lireEnv('# HIVE_PORT=7777\nHIVE_PORT=8888');
    expect(Object.keys(env), 'un réglage COMMENTÉ devient une clé fantôme').toEqual(['HIVE_PORT']);
    expect(env.HIVE_PORT, 'la ligne vive doit gagner').toBe('8888');
  });
});

describe('l’instrument refuse de conclure sur un .env incomplet', () => {
  // ─── POURQUOI CELUI-CI LANCE VRAIMENT LE SCRIPT ────────────────────────────
  //
  // La survivante trouvée par la loupe est dans `essai-parcours.mjs`, hors des
  // fonctions pures :
  //
  //     if (!port || !jeton) { … }        mutée en `&&`
  //
  // Elle ne peut se départager qu'en EXÉCUTANT le script : mutée, un `.env`
  // sans jeton passe la garde, et l'essai part interroger la ruche avec un
  // en-tête `x-hive-token: undefined`. Il rougirait quand même — en 401, au pas
  // 5, en accusant la RUCHE d'un défaut qui est celui du fichier de réglages.
  //
  // Un essai qui accuse le mauvais coupable est pire qu'un essai qui échoue :
  // il envoie chercher la panne là où elle n'est pas.
  const dossiers = [];
  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  const INSTRUMENT = fileURLToPath(new URL('../scripts/essai-parcours.mjs', import.meta.url));

  function courir(env) {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'banc-parcours-'));
    dossiers.push(dossier);
    writeFileSync(path.join(dossier, '.env'), env);
    // Aucun port n'est ouvert : si le script allait jusqu'au réseau, il
    // échouerait AILLEURS et avec un autre message. C'est ce qui départage.
    const v = spawnSync(process.execPath, [INSTRUMENT, '--racine', dossier], {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });
    return { code: v.status ?? -1, sortie: `${v.stdout}${v.stderr}` };
  }

  it('UN .env SANS JETON est refusé AVANT d’aller accuser la ruche', () => {
    const { code, sortie } = courir('HIVE_PORT=7777\n');
    expect(sortie, 'le refus ne nomme pas le bon coupable').toContain('.env sans HIVE_PORT');
    expect(sortie, 'l’essai est allé interroger la ruche malgré un .env incomplet').not.toContain(
      '4/5',
    );
    expect(code).toBe(1);
  });

  it('UN .env SANS PORT est refusé de la même façon', () => {
    const { code, sortie } = courir('HIVE_TOKEN=un-jeton-de-banc\n');
    expect(sortie).toContain('.env sans HIVE_PORT');
    expect(sortie).not.toContain('4/5');
    expect(code).toBe(1);
  });

  it('UNE PANNE IMPRÉVUE GARDE SA PILE — elle ne se déguise pas en verdict', () => {
    // ─── LA SURVIVANTE QUE LA LOUPE A TROUVÉE, DANS CE LOT MÊME ────────────
    //
    //     if (!(e instanceof EssaiRate)) throw e;   mutée en `instanceof Object`
    //
    // Le point de sortie unique attrape ce que `rate()` a levé, l'affiche en
    // « ✘ … », et pose le code. Tout le reste doit REPARTIR : une panne qu'on
    // n'a pas prévue n'est pas un verdict d'essai.
    //
    // Mutée, `EssaiRate` s'élargit à `Object` — et TOUTE erreur en est un. Un
    // `ENOENT`, un `TypeError` dans mon propre code, une réponse mal formée :
    // tout se met à sortir habillé en verdict, avec le ✘ et le code 1 d'un
    // essai qui a mesuré. Celui qui lit le journal de la CI part alors chercher
    // le défaut DANS LE PRODUIT, alors qu'il est dans l'instrument.
    //
    // ─── CE QUI DÉPARTAGE : PAS LE CODE, LA FORME ──────────────────────────
    //
    // Les deux mondes sortent en 1. Mesuré, avec un dossier sans `.env` :
    //
    //     sain   node:fs:484 … Error: ENOENT … at readFileSync (node:fs:484:20)
    //     muté   ✘ ENOENT: no such file or directory, open '…/.env'
    //
    // C'est donc la PRÉSENTATION qu'il faut assurer, pas le code de sortie —
    // et c'est exactement ce qui compte pour qui lit un journal.
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'banc-parcours-nu-'));
    dossiers.push(dossier);
    // Aucun `.env` : `readFileSync` lève un ENOENT, qui n'est PAS un EssaiRate.
    const v = spawnSync(process.execPath, [INSTRUMENT, '--racine', dossier], {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });
    const sortie = `${v.stdout}${v.stderr}`;

    expect(sortie, 'le cas ne mesure rien : la panne attendue n’a pas eu lieu').toContain('ENOENT');
    expect(
      sortie,
      'une panne imprévue est présentée comme un verdict d’essai (« ✘ »)',
    ).not.toContain('✘');
    expect(sortie, 'la pile a disparu — on ne saura pas d’où vient la panne').toMatch(/\n\s+at /);
  });

  it('SANS --racine, l’instrument dit son usage et sort en 64', () => {
    // 64 = « on m'a mal appelé », distinct de 1 = « la mesure a échoué ».
    // Les confondre ferait passer une erreur d'invocation pour un défaut du
    // produit — exactement ce que le code 78 évite de l'autre côté.
    const v = spawnSync(process.execPath, [INSTRUMENT], {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });
    expect(`${v.stdout}${v.stderr}`).toContain('usage :');
    expect(v.status).toBe(64);
  });
});

describe('le premier projet est vraiment dans la ruche', () => {
  const instantane = (projects) => ({ projects, nodes: [], tasks: [] });

  it('LE PROJET SE CHERCHE PAR SON ID, PAS PAR SON NOM', () => {
    // ─── POURQUOI L'ID ─────────────────────────────────────────────────────
    //
    // Deux projets peuvent porter le même nom — rien ne l'interdit. Chercher
    // par nom rendrait l'essai vert sur un projet qui n'est pas le sien, ce qui
    // est exactement la panne qu'on veut voir : « la création a répondu 201 et
    // n'a rien rangé ».
    expect(projetDansInstantane(instantane([{ id: 'p-1', name: 'Rucher' }]), 'p-1')).toBe(true);
    expect(
      projetDansInstantane(instantane([{ id: 'p-autre', name: 'Rucher' }]), 'p-1'),
      'un HOMONYME suffit à faire passer l’essai',
    ).toBe(false);
  });

  it('un instantané SANS projets ne fait pas exploser l’essai — il le fait échouer', () => {
    // La nuance compte pour le journal de la CI. Une exception donne une trace
    // de pile ; un `false` donne la phrase qu'on a écrite pour l'arrivant.
    expect(projetDansInstantane(instantane([]), 'p-1')).toBe(false);
    expect(projetDansInstantane({}, 'p-1')).toBe(false);
    expect(projetDansInstantane(null, 'p-1')).toBe(false);
    expect(projetDansInstantane(instantane([null, { id: 'p-1' }]), 'p-1')).toBe(true);
  });
});
