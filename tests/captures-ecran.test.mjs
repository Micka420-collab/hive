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
//     `docs/images`, il ne doit toucher à RIEN d'autre, et tout ce qu'il nomme,
//     il sait l'effacer ;
//   · la sortie — dans le dépôt, et ignorée par git par défaut ; la sélection
//     `--vues` qui refait la série publiée ;
//   · l'écran — servi depuis le dossier jetable, sans jamais en sortir ;
//   · l'isolement — ni les secrets ni les `HIVE_*` de la machine n'entrent
//     dans la ruche photographiée ;
//   · l'adresse — un port choisi par le système, que l'ouvrière doit apprendre
//     de la Reine, pas deviner ;
//   · la ruche elle-même — une vraie Reine et une vraie ouvrière, montées,
//     remplies par l'API et démontées comme le coureur le fait ;
//   · l'arrêt en plein démarrage — le ^C qui tombe pendant que la Reine ou
//     l'ouvrière démarre ne laisse personne derrière lui.
//
// En `.mjs`, comme les autres bancs de `scripts/*.mjs` : ces modules n'ont pas
// de déclarations de types (cf. `premier-quart-heure.test.mjs`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import {
  FORMATS,
  MANIFESTE,
  SORTIE_PAR_DEFAUT,
  estNotreCapture,
  fichierDeLEcran,
  nomCapture,
  optionsDepuisArgv,
  vueRetenue,
} from '../scripts/captures-ecran-sortie.mjs';
import {
  NOM_OUVRIERE,
  NOM_RELECTRICE,
  PLAN_DEMO,
  TACHE_RACONTEE,
  adresseAnnoncee,
  amorcerRuche,
  envIsole,
  envRelectrice,
  lancerRucheIsolee,
} from '../scripts/captures-ecran-ruche.mjs';
import { VERDICTS_DEMO, reponseRelectrice } from '../scripts/captures-relectrice.mjs';
import {
  agreger,
  consigneDeCritique,
  lireAvis as lireVerdict,
} from '../src/shared/contre-expertise.ts';
import { LENTILLES } from '../src/orchestrator/conseil.ts';
import {
  lireAvis as lireAvisConseil,
  lireProposition,
  promptExploration,
  promptVerification,
} from '../src/orchestrator/eclaireuse.ts';
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

  it('CE QU’IL NOMME, IL SAIT L’EFFACER — un nom de vue hors motif n’est jamais écrit', () => {
    // Le nom vient de la page. Accepté par `nomCapture` et inconnu
    // d'`estNotreCapture`, il ferait une image que plus aucune exécution
    // n'efface : la capture périmée que l'effacement existe pour empêcher.
    for (const vue of ['war_room', 'Ruche', 'mémoire', 'ruche/x', 'ruche?x=1', '']) {
      expect(() => nomCapture(vue, 'bureau'), vue).toThrow(/hors motif/);
    }
    for (const vue of ['ruche', 'chambre-en-vol', 'monespace', 'v2']) {
      for (const f of FORMATS) expect(estNotreCapture(nomCapture(vue, f.nom)), vue).toBe(true);
    }
  });

  it('par défaut : le français, dans captures-ecran/fr, toutes les vues', () => {
    expect(optionsDepuisArgv([], RACINE)).toEqual({
      langue: 'fr',
      theme: 'clair',
      sortie: path.join(RACINE, SORTIE_PAR_DEFAUT, 'fr'),
      vues: null,
    });
    expect(optionsDepuisArgv(['--langue', 'en'], RACINE)).toEqual({
      langue: 'en',
      theme: 'clair',
      sortie: path.join(RACINE, SORTIE_PAR_DEFAUT, 'en'),
      vues: null,
    });
    expect(optionsDepuisArgv(['--sortie', 'docs/images/captures'], RACINE).sortie).toBe(
      path.join(RACINE, 'docs', 'images', 'captures'),
    );
  });

  it('LE THÈME SOMBRE A SON PROPRE DOSSIER — deux séries ne s’effacent pas l’une l’autre', () => {
    // Mêmes noms d'images dans les deux thèmes : un dossier commun ferait
    // effacer la série claire par la sombre (`estNotreCapture`).
    expect(optionsDepuisArgv(['--theme', 'sombre', '--langue', 'en'], RACINE)).toEqual({
      langue: 'en',
      theme: 'sombre',
      sortie: path.join(RACINE, SORTIE_PAR_DEFAUT, 'en-sombre'),
      vues: null,
    });
    expect(optionsDepuisArgv(['--theme', 'noir'], RACINE).erreur).toMatch(/thème inconnu/);
    expect(optionsDepuisArgv(['--theme'], RACINE).erreur).toMatch(/attend une valeur/);
  });

  it('LA SORTIE RESTE DANS LE DÉPÔT — ni au-dessus, ni ailleurs, ni la racine elle-même', () => {
    for (const hors of ['..', '../ailleurs', path.join(os.tmpdir(), 'captures'), '.']) {
      expect(optionsDepuisArgv(['--sortie', hors], RACINE).erreur, hors).toMatch(/DANS le dépôt/);
    }
  });

  it('--vues RETIENT une vue (tous formats) ou une image (un format) — et rien d’autre', () => {
    const { vues } = optionsDepuisArgv(['--vues', 'ruche.bureau, essaim'], RACINE);
    expect(vues).toEqual(['ruche.bureau', 'essaim']);
    expect(vueRetenue(vues, 'ruche', 'bureau')).toBe(true);
    expect(vueRetenue(vues, 'ruche', 'mobile')).toBe(false);
    expect(vueRetenue(vues, 'essaim', 'mobile')).toBe(true);
    expect(vueRetenue(vues, 'miellerie', 'bureau')).toBe(false);
    expect(vueRetenue(null, 'miellerie', 'bureau'), 'sans --vues : tout').toBe(true);
    for (const fautive of ['ruche.tablette', 'war_room', 'ruche,', 'Ruche.bureau']) {
      expect(optionsDepuisArgv(['--vues', fautive], RACINE).erreur, fautive).toMatch(/--vues/);
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

  it('L’ÉCRAN SERVI RESTE DANS LE DOSSIER JETABLE — `/` est index.html, `..` ne remonte pas', () => {
    const ecran = path.join(os.tmpdir(), 'hive-captures-x', 'ecran');
    expect(fichierDeLEcran(ecran, 'http://127.0.0.1:41873/')).toBe(path.join(ecran, 'index.html'));
    expect(fichierDeLEcran(ecran, 'http://127.0.0.1:41873/assets/Chambre-a1.js')).toBe(
      path.join(ecran, 'assets', 'Chambre-a1.js'),
    );
    for (const hors of ['/..%2F..%2Fetc%2Fpasswd', '/assets/..%2F..%2F..%2Fsecret', '/%E0%A4%A']) {
      expect(fichierDeLEcran(ecran, `http://127.0.0.1:41873${hors}`), hors).toBeNull();
    }
  });
});

describe('ce que le coureur attend, l’écran le rend', () => {
  // Le coureur attend que l'attente d'une vue DISPARAISSE avant de la
  // photographier. Une classe que le tableau de bord ne rend plus n'attend
  // rien : `.mc-view-loading` avait cédé la place au squelette
  // `.mc-avant-etat` (#524), et chaque capture partait sans attendre — sur un
  // squelette quand le morceau paresseux de la vue tardait.
  const coureur = readFileSync(path.join(RACINE, 'scripts', 'captures-ecran.mjs'), 'utf8');
  const sources = (dossier) =>
    readdirSync(dossier, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory()
        ? sources(path.join(dossier, e.name))
        : e.name.endsWith('.tsx')
          ? [readFileSync(path.join(dossier, e.name), 'utf8')]
          : [],
    );
  const ecran = sources(path.join(RACINE, 'dashboard', 'src')).join('\n');

  it('CHAQUE CLASSE DONT IL ATTEND LA DISPARITION EST UNE CLASSE QUE L’ÉCRAN POSE', () => {
    const attendues = [
      ...coureur.matchAll(/locator\('\.([\w-]+)'\)\.waitFor\(\{ state: 'detached'/g),
    ].map((m) => m[1]);
    expect(attendues.length, 'aucune attente lue : la garde serait creuse').toBeGreaterThan(0);
    for (const classe of attendues) {
      expect(ecran, `.${classe} n’est posée par aucun composant`).toMatch(
        new RegExp(`className="[^"]*\\b${classe}\\b`),
      );
    }
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

describe('la relectrice de démonstration — elle parle le VRAI protocole', () => {
  // Ses réponses sont lues par les parseurs de la Reine eux-mêmes : une
  // réponse qu'ils ne comprendraient pas donnerait une War Room vide, et la
  // capture photographierait une panne de la démonstration, pas le débat.
  const relire = (titre) =>
    reponseRelectrice(
      consigneDeCritique({
        taskId: 't',
        titre,
        nodeId: 'n',
        agentType: 'shell',
        diff: 'diff --git a/a.ts b/a.ts\n+export const x = 1;',
        logs: '[sim] ok',
      }),
    );

  it('ELLE CONTESTE, SE TAIT OU VALIDE — selon le titre exact de la production relue', () => {
    const [contestee, muette] = Object.keys(VERDICTS_DEMO);
    // Lu comme la Reine le lit : l'avis, puis son agrégation — une objection
    // sous « valide » suffirait à contester.
    const verdict = (titre) => agreger([lireVerdict('n', 'custom', relire(titre))]);
    expect(verdict(contestee)).toMatchObject({ conteste: true });
    expect(verdict(contestee).objections).toHaveLength(2);
    // Muette : aucune réponse finale — la Reine clôt la relecture sans avis.
    expect(relire(muette)).toBe('');
    expect(verdict('Export CSV des paiements')).toMatchObject({ conteste: false, objections: [] });
  });

  it('ELLE RÉPOND À LA CONSIGNE, PAS AUX SOUVENIRS QUI LA PRÉCÈDENT', () => {
    // Le nœud fait précéder le prompt du contexte de la ruche, souvenirs Hive
    // Mind compris : une consigne de relecture PASSÉE y figure en toutes
    // lettres. Lue au premier marqueur, la relecture d'« Export CSV » se
    // taisait comme celle d'« Arrondi des taxes » — mesuré au premier essai.
    const [contestee, muette] = Object.keys(VERDICTS_DEMO);
    const consigne = (titre) =>
      consigneDeCritique({
        taskId: 't',
        titre,
        nodeId: 'n',
        agentType: 'shell',
        diff: '+x',
        logs: '[sim] ok',
      });
    const verification = promptVerification({
      question: 'Q ?',
      proposition: { titre: 'Retirer tout', corps: 'c', qualite: 5, sources: [] },
    });
    const souvenirs = `SOUVENIRS\n${consigne(muette)}\n${verification}`;
    expect(reponseRelectrice(`${souvenirs}\n\n${consigne('Export CSV des paiements')}`)).toMatch(
      /^valide/,
    );
    expect(reponseRelectrice(`${souvenirs}\n\n${consigne(contestee)}`)).toMatch(/^conteste/);
  });

  it('AU CONSEIL : une piste par lentille, et un signal d’arrêt contre ce qu’on veut retirer', () => {
    const pistes = LENTILLES.map((l, i) =>
      lireProposition(
        reponseRelectrice(promptExploration({ question: 'Q ?', lentille: l.cle, tour: 1 })),
        { id: `p${i}`, eclaireuse: 'n', famille: 'custom', tour: 1 },
      ),
    );
    expect(pistes.every((p) => p !== null && p.titre !== '')).toBe(true);
    const avis = pistes.map((p) =>
      lireAvisConseil(reponseRelectrice(promptVerification({ question: 'Q ?', proposition: p })), {
        propositionId: p.id,
        eclaireuse: 'm',
        famille: 'custom',
        tour: 1,
      }),
    );
    expect(avis.map((a) => a?.type).sort()).toEqual([
      'arret',
      'soutien',
      'soutien',
      'soutien',
      'soutien',
    ]);
  });

  it('BRANCHÉE COMME UNE IA EN CLI — et refusée, dite, sur un chemin qui se couperait', () => {
    const env = envRelectrice(
      { HIVE_TOKEN: 'jeton-du-banc' },
      { racine: '/depot', ws: 'ws://127.0.0.1:4242/ws', node: '/usr/bin/node' },
    );
    expect(env).toMatchObject({
      HIVE_TOKEN: 'jeton-du-banc',
      HIVE_URL: 'ws://127.0.0.1:4242/ws',
      HIVE_AGENT: 'custom',
      HIVE_NODE_NAME: NOM_RELECTRICE,
      HIVE_AGENT_CMD: `/usr/bin/node ${path.join('/depot', 'scripts', 'captures-relectrice.mjs')} {prompt}`,
    });
    expect(() =>
      envRelectrice({}, { racine: '/mon depot', ws: 'ws://x/ws', node: '/usr/bin/node' }),
    ).toThrow(/sans espace/);
  });
});

describe('la ruche de laboratoire — arrêtée en plein démarrage', () => {
  let dossier = '';

  afterEach(() => {
    reprendreTous();
    if (dossier) rmSync(dossier, { recursive: true, force: true, maxRetries: 3 });
    dossier = '';
  });

  // Le ^C du coureur arrive par `enregistrer` — c'est ce que le coureur range
  // parmi ce qu'il rend. Rangé au RETOUR de `lancerRucheIsolee`, il manquait
  // pendant tout le démarrage : mesuré en revue, une Reine orpheline, à
  // l'écoute, dans un dossier effacé. Joué ici aux deux étapes : la Reine qui
  // démarre, puis l'ouvrière qui rejoint.
  it.each([
    ['pendant que la Reine démarre', 1],
    ['pendant que l’ouvrière rejoint', 2],
  ])(
    'ARRÊTÉE %s : le démarrage échoue en le disant, et AUCUN processus ne survit',
    async (_etape, rang) => {
      dossier = mkdtempSync(path.join(os.tmpdir(), 'captures-arret-'));
      const lances = [];
      let arreter = null;
      let atteindre = () => {};
      const atteint = new Promise((resoudre) => (atteindre = resoudre));
      const lancer = (bin, argv, options) => {
        const proc = lancerBorneTuyaute(bin, argv, options);
        lances.push(proc);
        if (lances.length === rang) atteindre();
        return proc;
      };

      const issue = lancerRucheIsolee({
        racine: RACINE,
        dossier,
        lancer,
        enregistrer: (a) => (arreter = a),
      }).then(
        () => null,
        (e) => e,
      );
      await atteint;
      expect(arreter, 'l’arrêt est remis AVANT le premier processus').toBeTypeOf('function');
      await arreter();

      const erreur = await issue;
      expect(erreur, 'le démarrage interrompu échoue').toBeInstanceOf(Error);
      expect(erreur.message).toMatch(/arrêtée pendant son démarrage/);
      expect(lances, 'rien n’est lancé après l’arrêt').toHaveLength(rang);
      for (const p of lances) {
        expect(p.exitCode !== null || p.signalCode !== null, `pid ${p.pid} encore vivant`).toBe(
          true,
        );
        // Le GROUPE entier, pas seulement sa tête (POSIX : `kill(-pid, 0)` le
        // sonde sans le frapper).
        if (process.platform !== 'win32') expect(() => process.kill(-p.pid, 0)).toThrow();
      }
    },
    120_000,
  );
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
