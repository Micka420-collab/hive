// LES CAPTURES D'ÉCRAN — ce qui se décide sans navigateur, et la ruche de
// laboratoire, lancée pour de vrai.
//
// ─── CE QUE CE BANC GARDE, ET CE QU'IL NE GARDE PAS ──────────────────────────
//
// `npm run captures` ne tourne ni sous `npm test` ni en CI : il lui faut un
// Chromium que `npm ci` ne télécharge pas, et une garde en pixels rougirait à
// chaque changement de police. Ce banc garde donc ce qui peut casser SANS
// qu'une image le montre :
//
//   · l'effacement — le coureur efface ses captures précédentes ; pointé sur
//     `docs/images`, il ne doit toucher à RIEN d'autre ;
//   · la sortie — dans le dépôt, et ignorée par git par défaut ;
//   · l'isolement — ni les secrets ni les `HIVE_*` de la machine n'entrent
//     dans la ruche photographiée ;
//   · l'adresse — un port choisi par le système, que l'ouvrière doit apprendre
//     de la Reine, pas deviner ;
//   · la ruche elle-même — une vraie Reine et une vraie ouvrière, montées,
//     remplies par l'API et démontées comme le coureur le fait.
//
// En `.mjs`, comme les autres bancs de `scripts/*.mjs` : ces modules n'ont pas
// de déclarations de types (cf. `premier-quart-heure.test.mjs`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORMATS,
  MANIFESTE,
  SORTIE_PAR_DEFAUT,
  estNotreCapture,
  nomCapture,
  optionsDepuisArgv,
} from '../scripts/captures-ecran-sortie.mjs';
import {
  NOM_OUVRIERE,
  PLAN_DEMO,
  TACHE_RACONTEE,
  adresseAnnoncee,
  amorcerRuche,
  envIsole,
  lancerRucheIsolee,
} from '../scripts/captures-ecran-ruche.mjs';
import { lancerBorneTuyaute, reprendreTous } from './harnais-processus.ts';

const RACINE = fileURLToPath(new URL('..', import.meta.url));

describe('où vont les captures', () => {
  it('le coureur reconnaît CHACUN de ses fichiers, et son manifeste', () => {
    for (const f of FORMATS) {
      expect(estNotreCapture(nomCapture('ruche', f.nom)), f.nom).toBe(true);
      expect(estNotreCapture(nomCapture('chambre-en-vol', f.nom)), f.nom).toBe(true);
    }
    expect(estNotreCapture(MANIFESTE)).toBe(true);
  });

  it('IL N’EFFACE RIEN D’AUTRE — pointé sur docs/images, les images du README survivent', () => {
    // Les noms réels de `docs/images`, et les voisins d'un nom légitime : un
    // format inconnu, une copie de sauvegarde, une casse différente.
    for (const etranger of [
      'banniere-clair.png',
      'dashboard-ruche.png',
      'vitrine.png',
      'ruche.tablette.png',
      'ruche.bureau.png.orig',
      'Ruche.bureau.png',
      '.bureau.png',
      'ruche..bureau.png',
      'notes.md',
      'captures.json.bak',
    ]) {
      expect(estNotreCapture(etranger), etranger).toBe(false);
    }
  });

  it('par défaut : le français, dans captures-ecran/fr', () => {
    expect(optionsDepuisArgv([], RACINE)).toEqual({
      langue: 'fr',
      sortie: path.join(RACINE, SORTIE_PAR_DEFAUT, 'fr'),
    });
    expect(optionsDepuisArgv(['--langue', 'en'], RACINE)).toEqual({
      langue: 'en',
      sortie: path.join(RACINE, SORTIE_PAR_DEFAUT, 'en'),
    });
    expect(optionsDepuisArgv(['--sortie', 'docs/images/captures'], RACINE).sortie).toBe(
      path.join(RACINE, 'docs', 'images', 'captures'),
    );
  });

  it('LA SORTIE RESTE DANS LE DÉPÔT — ni au-dessus, ni ailleurs, ni la racine elle-même', () => {
    for (const hors of ['..', '../ailleurs', path.join(os.tmpdir(), 'captures'), '.']) {
      expect(optionsDepuisArgv(['--sortie', hors], RACINE).erreur, hors).toMatch(/DANS le dépôt/);
    }
  });

  it('une ligne de commande fautive est refusée, pas devinée', () => {
    expect(optionsDepuisArgv(['--langue', 'de'], RACINE).erreur).toMatch(/langue inconnue/);
    expect(optionsDepuisArgv(['--sortie'], RACINE).erreur).toMatch(/attend une valeur/);
    expect(optionsDepuisArgv(['--sortie', '--langue'], RACINE).erreur).toMatch(/attend une valeur/);
    expect(optionsDepuisArgv(['--plein-ecran'], RACINE).erreur).toMatch(/option inconnue/);
  });

  it('LA SORTIE PAR DÉFAUT EST IGNORÉE PAR GIT — une capture ne se verse pas par mégarde', () => {
    // Demandé à git lui-même, pas relu dans `.gitignore` : c'est sa règle qui
    // fait foi, négations et motifs compris.
    const r = spawnSync(
      'git',
      ['check-ignore', '--quiet', `${SORTIE_PAR_DEFAUT}/fr/${nomCapture('ruche', 'bureau')}`],
      { cwd: RACINE, shell: false },
    );
    expect(r.status, 'git ne l’ignore pas').toBe(0);
  });
});

describe('la ruche de laboratoire — ce qui y entre', () => {
  const dossier = path.join(os.tmpdir(), 'labo');
  const parent = {
    PATH: '/usr/bin',
    HOME: '/home/quelquun',
    SystemRoot: 'C:\\Windows',
    ANTHROPIC_API_KEY: 'sk-ant-secret',
    GITHUB_TOKEN: 'ghp_secret',
    MON_PROXY_TOKEN: 'secret-que-personne-n-a-prevu',
    HIVE_DB: '/ailleurs/hive.db',
    HIVE_URL: 'ws://localhost:7777/ws',
    HIVE_SIMULATION: '1',
    HIVE_PUBLIC_URL: 'https://ma-ruche.example',
  };
  const env = envIsole(parent, { dossier, jeton: 'jeton-du-banc', secret: 'secret-du-banc' });

  it('RIEN DE LA MACHINE, sauf de quoi faire tourner Node — sur liste blanche, casse Windows comprise', () => {
    const heritees = Object.keys(env).filter((k) => !k.startsWith('HIVE_') && k !== 'NO_COLOR');
    expect(heritees.sort()).toEqual(['HOME', 'PATH', 'SystemRoot']);
    for (const secret of ['sk-ant-secret', 'ghp_secret', 'secret-que-personne-n-a-prevu']) {
      expect(Object.values(env), secret).not.toContain(secret);
    }
  });

  it('les HIVE_* de l’opérateur ne passent pas — et la simulation ne relâche aucune garde', () => {
    expect(env.HIVE_DB).toBe(path.join(dossier, 'hive.db'));
    expect(env.HIVE_PUBLIC_URL).toBeUndefined();
    // `HIVE_SIMULATION=1` relâche trois gardes de la Reine (jeton, secret de
    // session, webhook) : la ruche photographiée doit tourner SANS.
    expect(env.HIVE_SIMULATION).toBeUndefined();
    // L'adresse de l'ouvrière vient de la Reine, jamais de la machine.
    expect(env.HIVE_URL).toBeUndefined();
    expect(env).toMatchObject({
      HIVE_PORT: '0',
      HIVE_HOST: '127.0.0.1',
      HIVE_TOKEN: 'jeton-du-banc',
      HIVE_JWT_SECRET: 'secret-du-banc',
      HIVE_AGENT: 'shell',
      HIVE_ISOLEMENT: 'off',
      HIVE_NODE_NAME: NOM_OUVRIERE,
    });
  });

  it('l’adresse annoncée par la Reine : les DEUX lignes, sur le même port', () => {
    const banniere = [
      '🐝 Hive — orchestrateur (Queen) en ligne',
      '   Dashboard : http://127.0.0.1:41873',
      '   WebSocket : ws://127.0.0.1:41873/ws',
      '   Base      : /tmp/hive-captures-x/hive.db',
    ].join('\n');
    expect(adresseAnnoncee(banniere)).toEqual({
      http: 'http://127.0.0.1:41873',
      ws: 'ws://127.0.0.1:41873/ws',
      port: 41873,
    });
    // La bannière encore en route : on attend, on ne devine pas.
    expect(adresseAnnoncee(banniere.split('\n').slice(0, 2).join('\n'))).toBeNull();
    expect(
      adresseAnnoncee('Dashboard : http://127.0.0.1:1111\nWebSocket : ws://127.0.0.1:2222/ws'),
    ).toBeNull();
    expect(
      adresseAnnoncee('Dashboard : http://127.0.0.1:0\nWebSocket : ws://127.0.0.1:0/ws'),
    ).toBeNull();
    expect(adresseAnnoncee(undefined)).toBeNull();
  });

  it('le plan de démonstration : UN échec simulé, sur une tâche dont rien ne dépend', () => {
    // Le marqueur voyage dans les souvenirs Hive Mind vers les tâches qui
    // suivent (cf. le commentaire de PLAN_DEMO) : posé ailleurs que sur une
    // feuille, il faisait échouer deux tâches au lieu d'une.
    const taches = PLAN_DEMO.flatMap((p) => p.tasks);
    const marquees = taches.filter((t) => t.prompt.includes('[flaky]'));
    expect(marquees.map((t) => t.title)).toEqual([TACHE_RACONTEE]);
    const dependances = taches.flatMap((t) => t.dependsOn ?? []);
    expect(dependances).not.toContain(marquees[0].id);
  });
});

describe('la ruche de laboratoire — lancée pour de vrai', () => {
  let dossier = '';
  let ruche = null;

  afterEach(async () => {
    await ruche?.arreter();
    ruche = null;
    // Le filet sans condition, AVANT l'effacement : un processus encore vivant
    // tiendrait ouverte la base qu'on efface (cf. harnais-processus.ts).
    reprendreTous();
    if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
    dossier = '';
  });

  it('LA REINE ANNONCE SON PORT, L’OUVRIÈRE LE REJOINT ; LA RUCHE SE REMPLIT PAR L’API ; TOUT S’ARRÊTE', async () => {
    dossier = mkdtempSync(path.join(os.tmpdir(), 'captures-banc-'));
    ruche = await lancerRucheIsolee({ racine: RACINE, dossier, lancer: lancerBorneTuyaute });

    // Un port choisi par le système, appris de la Reine.
    expect(ruche.port).toBeGreaterThan(0);
    const etat = await (await fetch(`${ruche.http}/api/state`, { headers: ruche.entetes })).json();
    const noeud = etat.nodes.find((n) => n.id === ruche.noeudId);
    expect(noeud).toMatchObject({ name: NOM_OUVRIERE, status: 'online', agentType: 'shell' });

    // Un plan réduit — celui des captures prend quinze secondes — qui garde
    // l'essentiel : une dépendance, et un échec simulé suivi d'une reprise.
    const { jwt, projets } = await amorcerRuche(ruche, [
      {
        name: 'Banc des captures',
        description: 'Deux tâches, une reprise.',
        tasks: [
          { id: 'banc-a', title: 'Banc A', prompt: 'Écrire A.' },
          { id: 'banc-b', title: 'Banc B', prompt: 'Écrire B. [flaky]', dependsOn: ['banc-a'] },
        ],
      },
    ]);
    expect(projets).toHaveLength(1);

    // La session rendue est celle d'un ADMINISTRATEUR : sans elle, les vues
    // d'administration manqueraient à la barre, donc aux captures.
    const moi = await fetch(`${ruche.http}/api/auth/me`, {
      headers: { ...ruche.entetes, authorization: `Bearer ${jwt}` },
    });
    expect(moi.status).toBe(200);
    expect((await moi.json()).role).toBe('admin');

    const fin = await (await fetch(`${ruche.http}/api/state`, { headers: ruche.entetes })).json();
    const parTitre = Object.fromEntries(fin.tasks.map((t) => [t.title, t]));
    expect(parTitre['Banc A']).toMatchObject({ status: 'done', attempts: 0 });
    expect(parTitre['Banc B']).toMatchObject({ status: 'done', attempts: 1 });

    // Et elle s'arrête : plus personne ne répond à cette adresse.
    await ruche.arreter();
    await expect(fetch(`${ruche.http}/api/pulse`)).rejects.toThrow();
  }, 120_000);
});
