// `npm run ruche` — le lanceur, et ses deux promesses de vie et de mort.
//
// ─── CE QUE `demarrage.ts` NE POUVAIT PAS PROUVER ────────────────────────────
//
// La composition (quelles pièces, quels chemins) est pure et éprouvée. Ce que
// personne n'avait jamais lancé, ce sont les deux promesses IMPURES de
// `scripts/ruche.mjs`, celles qui font la différence entre un outil et un
// piège :
//
//   1. « ^C arrête tout » — sans elle, un hub reste accroché à son port et le
//      démarrage suivant échoue sur « port occupé », une panne qu'on met dix
//      minutes à relier à sa cause ;
//   2. « la mort d'un seul emporte les autres » — sans elle, une ruche au hub
//      mort laisse une ouvrière reconnecter dans le vide et croire que ça
//      tourne.
//
// On lance donc LE VRAI FICHIER, en Node nu — c'est son mode d'emploi — sur la
// Reine seule (`--sans-ecran --sans-noeud`) : la promesse ne dépend pas du
// nombre d'enfants, et Vite coûterait dix secondes par test pour ne rien
// prouver de plus.
//
// POSIX seulement : les deux tests parlent en signaux, et sous Windows
// `kill('SIGINT')` termine sans passer par les gestionnaires — on y mesurerait
// notre coup de grâce, pas l'arrêt du lanceur (même raison que
// `reine-demarrage.test.ts`).

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { HiveStore } from '../src/orchestrator/store.js';
import { occuperIdentite } from '../src/node-client/identite-noeud.js';
import { lancerBorne, lancerBorneTuyaute, reprendreTous, tuerGroupe } from './harnais-processus.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const LANCEUR = path.join(RACINE, 'scripts', 'ruche.mjs');
const POSIX = process.platform !== 'win32';
/** `/proc/<pid>/environ` : la seule façon exacte de reconnaître l'ouvrière d'une famille. */
const LINUX = process.platform === 'linux';

const aNettoyer: string[] = [];
afterEach(() => {
  // Le filet AVANT le ménage des dossiers : un processus encore vivant tient
  // ouverte la base qu'on s'apprête à effacer. Et il est posé sans condition —
  // c'est quand un test échoue ou laisse une promesse pendante que des
  // processus restent, donc exactement quand un nettoyage conditionnel saute.
  reprendreTous();
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

interface Issue {
  code: number | null;
  sortie: string;
}

/** Un temps du scénario : attendre ce marqueur, puis faire ce geste. */
interface Etape {
  readonly marqueur: string;
  /** `sortie` : tout ce que la ruche a imprimé jusque-là (une URL à y lire). */
  readonly geste: (pid: number, sortie: string) => void;
}

/** Lance la ruche, attend UN marqueur, exécute `alors`, recueille la fin. */
function lancerRuche(
  args: string[],
  env: NodeJS.ProcessEnv,
  marqueur: string,
  alors: (pid: number) => void,
): Promise<Issue> {
  return jouerRuche(args, env, [{ marqueur, geste: alors }]);
}

/**
 * Lance la ruche et joue les étapes dans l'ordre, puis recueille la fin.
 *
 * Tout est borné : chaque marqueur sous 45 s, la fin sous 15 s après le
 * dernier geste — un lanceur qui ne meurt pas est précisément la panne qu'on
 * cherche. Un marqueur se lit sur TOUTE la sortie reçue : deux processus qui
 * s'annoncent dans le désordre ne font pas manquer l'étape.
 */
function jouerRuche(
  args: string[],
  env: NodeJS.ProcessEnv,
  etapes: readonly Etape[],
): Promise<Issue> {
  return new Promise((resoudre, rejeter) => {
    // `lancerBorne`, jamais `spawn` nu : le lanceur démarre lui-même un hub,
    // un nœud et un `vite`. On l'abat en SIGKILL — le signal qui ne lui laisse
    // aucune chance de reprendre sa descendance. Sans groupe adressable, ses
    // trois enfants survivaient au banc (§ 2 duovicies du carnet).
    const proc = lancerBorneTuyaute(process.execPath, [LANCEUR, ...args], { cwd: RACINE, env });
    let sortie = '';
    let fini = false;
    let rang = 0;
    const finir = (v: Issue | null, e?: Error): void => {
      if (fini) return;
      fini = true;
      if (e) rejeter(e);
      else resoudre(v as Issue);
    };
    // 45 s, pas 30 : ce boucher existe pour qu'un hub qui ne démarre JAMAIS
    // rende une erreur NOMMÉE au lieu d'un dépassement anonyme de vitest — il
    // doit donc tirer avant les 60 s du banc, et le plus tard possible avant.
    // À 30 s il tirait à mi-course en laissant la moitié du budget inutilisée,
    // et un simple ralentissement de la machine suffisait à le déclencher :
    // vu ici à 30 017 ms sur un conteneur chargé, alors que l'enfant allait
    // parfaitement bien. Un boucher qui tire sur la lenteur ne distingue plus
    // « en panne » de « occupé » — et c'est un test qui ment une fois sur N.
    const armerMarqueur = (marqueur: string): NodeJS.Timeout => {
      const boucher = setTimeout(() => {
        tuerGroupe(proc);
        finir(null, new Error(`marqueur « ${marqueur} » jamais vu :\n${sortie}`));
      }, 45_000);
      boucher.unref?.();
      return boucher;
    };
    let boucherMarqueur = etapes[0] ? armerMarqueur(etapes[0].marqueur) : undefined;
    const lire = (m: Buffer): void => {
      sortie += m.toString('utf8');
      for (
        let etape = etapes[rang];
        etape && sortie.includes(etape.marqueur);
        etape = etapes[rang]
      ) {
        clearTimeout(boucherMarqueur);
        rang += 1;
        etape.geste(proc.pid as number, sortie);
        const suivante = etapes[rang];
        if (suivante) {
          boucherMarqueur = armerMarqueur(suivante.marqueur);
          continue;
        }
        const boucherFin = setTimeout(() => {
          tuerGroupe(proc);
          finir(null, new Error(`le lanceur ne meurt pas après le geste :\n${sortie}`));
        }, 15_000);
        boucherFin.unref?.();
      }
    };
    proc.stdout.on('data', lire);
    proc.stderr.on('data', lire);
    proc.on('error', (e) => finir(null, e));
    proc.on('close', (code) => finir({ code, sortie }));
  });
}

function envRuche(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, NO_COLOR: '1' };
  for (const cle of Object.keys(env)) if (cle.startsWith('HIVE_')) delete env[cle];
  const donnees = mkdtempSync(path.join(tmpdir(), 'ruche-lanceur-'));
  aNettoyer.push(donnees);
  return {
    ...env,
    HIVE_PORT: '0',
    HIVE_DB: path.join(donnees, 'ruche.db'),
    HIVE_TOKEN: 'jeton-du-lanceur-suffisamment-long-pour-le-test',
    HIVE_JWT_SECRET: 'secret-du-lanceur-suffisamment-long-pour-le-test',
    ...extra,
  };
}

/** Un port libre, rendu aussitôt : une adresse où personne n'écoute. */
async function portLibre(): Promise<number> {
  const s = createServer();
  await new Promise<void>((resoudre, rejeter) => {
    s.once('error', rejeter);
    s.listen(0, '127.0.0.1', resoudre);
  });
  const port = (s.address() as { port: number }).port;
  await new Promise((resoudre) => s.close(resoudre));
  return port;
}

/**
 * Le processus de l'ouvrière d'une famille, parmi les enfants du lanceur.
 *
 * Les trois enfants sont des `node scripts/lancer.mjs …` : seul leur
 * environnement les distingue, et c'est justement ce que le banc éprouve.
 */
function pidOuvriere(lanceur: number, agent: string): number {
  const enfants = execFileSync('pgrep', ['-P', String(lanceur)], { encoding: 'utf8' })
    .trim()
    .split('\n')
    .map(Number);
  const pid = enfants.find((p) =>
    readFileSync(`/proc/${p}/environ`, 'utf8').split('\0').includes(`HIVE_AGENT=${agent}`),
  );
  if (pid === undefined) throw new Error(`aucune ouvrière ${agent} parmi ${enfants.join(', ')}`);
  return pid;
}

describe('le lanceur de la ruche — vie et mort', () => {
  it.runIf(POSIX)(
    '^C ARRÊTE TOUT — bannière, Reine en ligne, arrêt dit, code 0',
    async () => {
      // Le marqueur est la bannière du HUB, préfixée par le lanceur : elle
      // prouve à la fois que l'enfant a démarré ET que le préfixage par ligne
      // fonctionne (un flux recollé au mauvais endroit couperait la phrase).
      const r = await lancerRuche(['--sans-ecran', '--sans-noeud'], envRuche(), 'en ligne', (pid) =>
        process.kill(pid, 'SIGINT'),
      );
      expect(r.sortie).toContain('La ruche démarre');
      expect(r.sortie, 'l’arrêt doit se dire').toContain('Arrêt de la ruche…');
      expect(r.code, `un ^C n’est pas un échec :\n${r.sortie}`).toBe(0);
    },
    60_000,
  );

  it.runIf(POSIX)(
    'LA MORT DU HUB EMPORTE LA RUCHE — dite, et en code non nul',
    async () => {
      // On occupe un port et on l'impose au hub : il meurt à l'allumage. Le
      // lanceur doit LE DIRE (« la ruche s'arrête »), mourir lui-même — le
      // boucher de 15 s ferait échouer un lanceur qui survivrait à son hub —
      // et rendre un code non nul : pour un superviseur, une ruche amputée
      // n'est pas un succès.
      const bouchon: Server = createServer();
      await new Promise<void>((resoudre, rejeter) => {
        bouchon.once('error', rejeter);
        bouchon.listen(0, '127.0.0.1', resoudre);
      });
      const porte = (bouchon.address() as { port: number }).port;
      try {
        const r = await lancerRuche(
          ['--sans-ecran', '--sans-noeud'],
          envRuche({ HIVE_PORT: String(porte) }),
          // Apostrophe DROITE : c'est celle que ruche.mjs imprime. La première
          // version portait la courbe — un marqueur qui ne pouvait pas matcher,
          // et le test ne se résolvait que par la mort du lanceur (le boucher
          // de 30 s aurait masqué un lanceur qui ne meurt pas en panne vague).
          "la ruche s'arrête",
          () => {
            /* rien : la mort du hub EST le geste */
          },
        );
        // ─── ET LA BANNIÈRE ANNONCE CE PORT-LÀ ──────────────────────────────
        //
        // C'est la garde de CÂBLAGE, et elle vit ici parce que ce cas est le
        // seul qui impose un port CONNU au vrai lanceur. `demarrage.ts` sait
        // composer la bonne ligne ; ce qu'il ne peut pas prouver, c'est que
        // `ruche.mjs` la lui demande. Le port était écrit en dur, et un module
        // juste appelé sans son argument reste une bannière fausse (§ 9
        // tercenties : un vert ne prouve pas que la mesure a mordu).
        //
        // Le port vient d'un `listen(0)` : jamais 7777, donc l'égalité
        // départage sans ambiguïté. Sur le code d'avant, cette ligne annonçait
        // 7777 quoi qu'il arrive.
        //
        // POSIX seulement, comme tout ce fichier — c'est dit, pas oublié : le
        // câblage est mesuré sur deux systèmes sur trois, et la composition,
        // elle, l'est partout par `demarrage.test.ts`.
        expect(r.sortie, 'la bannière n’annonce pas le port imposé').toContain(
          `http://127.0.0.1:${porte}`,
        );
        expect(r.sortie).toContain('arrêté');
        expect(r.code, `une ruche amputée n’est pas un succès :\n${r.sortie}`).not.toBe(0);
      } finally {
        await new Promise((resoudre) => bouchon.close(resoudre));
      }
    },
    60_000,
  );

  it.runIf(POSIX)(
    'UNE REINE QUI SORT EN 0 N’EST PAS UN SUCCÈS DE RUCHE — le lanceur rend non nul',
    async () => {
      // La survivante du balayage loupe du 3 août : `arreter(code === 0 ? 1 :
      // (code ?? 1))` mutée en `!==`. Le test voisin (port occupé) ne la voit
      // pas : son hub meurt en 1, et `1 → 1` des deux côtés du miroir. La
      // branche qui distingue est celle du hub qui sort PROPREMENT (code 0)
      // sans qu'on ait demandé l'arrêt de la ruche : pour un superviseur, une
      // ruche qui perd sa Reine — même poliment — n'est pas un succès. Mutée,
      // le lanceur rendrait 0 et rien ne redémarrerait jamais.
      const r = await lancerRuche(
        ['--sans-ecran', '--sans-noeud'],
        envRuche(),
        'en ligne',
        (pid) => {
          // SIGINT à L'ENFANT seul, pas au lanceur : `pkill -P` vise les enfants
          // directs, et la Reine est le seul ici. Son gestionnaire SIGINT sort
          // en `process.exit(0)` — c'est précisément la prémisse qu'on veut.
          lancerBorne('pkill', ['-INT', '-P', String(pid)]);
        },
      );
      // La prémisse est VÉRIFIÉE, pas supposée : mort par code 0, pas par
      // signal — tuée par signal, `code` serait null et `null ?? 1` rendrait 1
      // des deux côtés de la mutation : un test vert pour la mauvaise porte.
      expect(r.sortie, 'la Reine doit être sortie en 0 (prémisse)').toContain('arrêté (code 0)');
      expect(r.sortie).toContain("la ruche s'arrête");
      expect(r.code, `une ruche sans Reine n’est pas un succès :\n${r.sortie}`).not.toBe(0);
    },
    60_000,
  );
  it.runIf(POSIX)(
    'L’ÉCRAN RELAIE VERS SA REINE — `/api` joint le port qu’elle a ouvert, pas :7777',
    async () => {
      // ─── LA MOITIÉ ÉCRAN DU CÂBLAGE ─────────────────────────────────────────
      //
      // `demarrage.test.ts` prouve que `envDePiece` pose `HIVE_HTTP`, et que
      // `vite.config.ts` le lit. Ce qu'il ne voit pas, c'est que `ruche.mjs`
      // lance l'écran PAR cette file d'annonce, avec cet environnement : un
      // écran démarré hors de la file, ou sur un `process.env` nu, relayait
      // vers :7777 — une page qui s'affiche et dont chaque appel échoue.
      //
      // La preuve est ce que l'opérateur verrait : un `GET /api/health` à
      // travers le proxy de Vite, rendu par NOTRE Reine, sur un port libre
      // qui n'est jamais 7777. Sous Linux, en plus, l'environnement exact de
      // l'écran (`/proc/<pid>/environ`) — un vert qui ne dépend pas de ce qui
      // écoute, ou non, sur 7777 ce jour-là.
      //
      // Vite coûte ici quelques secondes : c'est lui, précisément, le sujet.
      const port = await portLibre();
      let sante: unknown;
      let echec: unknown;
      let environ: string[] = [];
      const r = await jouerRuche(['--sans-noeud'], envRuche({ HIVE_PORT: String(port) }), [
        {
          marqueur: 'Local:',
          geste: (pid, sortie) => {
            if (LINUX) {
              const enfants = execFileSync('pgrep', ['-P', String(pid)], { encoding: 'utf8' })
                .trim()
                .split('\n');
              const ecran = enfants.find((p) =>
                readFileSync(`/proc/${p}/cmdline`, 'utf8').includes('vite'),
              );
              if (ecran) environ = readFileSync(`/proc/${ecran}/environ`, 'utf8').split('\0');
            }
            const vite = /Local:\s+(http:\/\/\S+?)\/?\s/.exec(sortie)?.[1];
            void fetch(`${vite ?? 'http://localhost:5173'}/api/health`)
              .then(async (reponse) => {
                sante = { statut: reponse.status, corps: await reponse.text() };
              })
              .catch((e: unknown) => {
                echec = e;
              })
              .finally(() => {
                process.kill(pid, 'SIGINT');
              });
          },
        },
      ]);

      expect(echec, r.sortie).toBeUndefined();
      expect(sante, `l’écran ne relaie pas vers sa Reine :\n${r.sortie}`).toEqual({
        statut: 200,
        corps: JSON.stringify({ ok: true }),
      });
      if (LINUX) expect(environ).toContain(`HIVE_HTTP=http://127.0.0.1:${port}`);
      expect(r.code, r.sortie).toBe(0);
    },
    90_000,
  );

  it.runIf(POSIX)(
    'DEUX AGENTS INSTALLÉS, DEUX OUVRIÈRES — chacune SON agent, SON identité, une tâche, SA Reine ; l’ajoutée tombe seule',
    async () => {
      // ─── CE QUE `demarrage.test.ts` NE PEUT PAS PROUVER ────────────────────
      //
      // Le plan est pur et éprouvé là-bas. Ce qu'il ne peut pas voir, c'est le
      // CÂBLAGE : que le lanceur sonde vraiment, que chaque ouvrière reçoive
      // SON environnement, et qu'une ajoutée qui meurt n'emporte pas la ruche.
      // Un `env: process.env` resté en place dans le `spawn` donnait deux
      // ouvrières du même agent, sous le même nom — et le plan, lui, restait
      // parfaitement juste.
      //
      // Deux faux agents : des binaires qui répondent à `--version`, rien de
      // plus — la détection n'en demande pas davantage, et aucun crédit ne peut
      // partir d'ici. Le PATH ne contient QU'EUX : un vrai Cursor installé sur
      // la machine du banc ne doit pas s'inviter dans la ruche.
      //
      // POSIX, comme tout ce fichier — sauf UN geste : abattre l'ouvrière
      // Codex. C'est `/proc/<pid>/environ` qui la désigne, sans deviner, parmi
      // trois `node` au même argv, et `/proc` n'existe que sous Linux. Ailleurs
      // le banc s'arrête au ^C, après l'inscription : le câblage (chaque
      // ouvrière reçoit SON environnement) est ce qui risque de différer d'un
      // système à l'autre, et il est éprouvé sur les deux.
      //
      // ─── ET CHACUNE TROUVE SA REINE, SUR LE PORT QU'ELLE A OUVERT ──────────
      //
      // Ce banc posait lui-même `HIVE_URL` au port de la Reine — et masquait
      // ainsi le défaut qu'il aurait dû voir : le lanceur n'en passait aucun,
      // et ses ouvrières visaient `ws://localhost:7777/ws` quel que soit
      // `HIVE_PORT`. Mesuré sur un port libre : Reine en ligne, ouvrière en
      // « connexion perdue — nouvel essai » sans fin.
      //
      // Désormais `HIVE_PORT=0` (celui d'`envRuche`) : le système tire le port,
      // et seule la Reine le connaît. Aucune ouvrière ne peut s'inscrire sans
      // qu'elle l'ait annoncé au lanceur et qu'il le leur ait passé. Et le
      // `HIVE_URL` hérité pointe là où PERSONNE n'écoute — la forme du `.env`
      // copié de `.env.example`, figé sur 7777 : il ne doit pas l'emporter
      // sur l'adresse que la Reine a annoncée.
      const faux = mkdtempSync(path.join(tmpdir(), 'ruche-agents-'));
      aNettoyer.push(faux);
      for (const bin of ['claude', 'codex']) {
        writeFileSync(path.join(faux, bin), '#!/bin/sh\necho "faux 1.0"\n', { mode: 0o755 });
      }
      const personne = await portLibre();
      const env = envRuche({
        PATH: faux,
        // Les chemins natifs (`~/.local/bin`) ne doivent rien trouver non plus.
        HOME: faux,
        HIVE_URL: `ws://127.0.0.1:${personne}/ws`,
        HIVE_NODE_NAME: 'banc',
        HIVE_WORKDIR: path.join(faux, 'travail'),
        // Aucun moteur de conteneurs à sonder : le bac n'est pas le sujet.
        HIVE_ISOLEMENT: 'off',
        // Un `.env` du poste qui épinglerait un agent ne doit pas fausser le
        // banc : une variable POSÉE, même vide, n'est jamais écrasée par lui.
        HIVE_AGENT: '',
        HIVE_AGENT_CMD: '',
      });

      const arreter = (pid: number): void => {
        process.kill(pid, 'SIGINT');
      };
      const r = await jouerRuche(
        ['--sans-ecran'],
        env,
        LINUX
          ? [
              { marqueur: '[banc] enregistré', geste: () => undefined },
              {
                marqueur: '[banc-codex] enregistré',
                geste: (pid) => process.kill(pidOuvriere(pid, 'codex'), 'SIGKILL'),
              },
              { marqueur: 'la ruche continue sans elle', geste: arreter },
            ]
          : [
              { marqueur: '[banc] enregistré', geste: () => undefined },
              { marqueur: '[banc-codex] enregistré', geste: arreter },
            ],
      );

      expect(r.sortie).toContain('Une ouvrière par agent détecté (Claude Code, Codex)');
      // Chacune fait tourner SA famille : la preuve que `HIVE_AGENT` lui parvient.
      expect(r.sortie).toMatch(/ouvrière claude-code\s*│\s+Agent utilisé\s*: Claude Code/);
      expect(r.sortie).toMatch(/ouvrière codex\s*│\s+Agent utilisé\s*: Codex/);
      // L'ajoutée est tombée, la ruche a continué, et le ^C final est un arrêt
      // propre — pas une ruche amputée.
      expect(r.sortie).not.toContain("la ruche s'arrête");
      expect(r.code, r.sortie).toBe(0);

      // Ce que la Reine a CONSIGNÉ — la vérité qui compte, pas ce que les
      // processus ont imprimé : deux nœuds, deux familles, une tâche chacun.
      const store = new HiveStore(env.HIVE_DB ?? '');
      try {
        const noeuds = store
          .listNodes()
          .map((n) => ({ nom: n.name, agent: n.agentType, concurrence: n.maxConcurrency }))
          .sort((a, b) => a.nom.localeCompare(b.nom));
        expect(noeuds).toEqual([
          { nom: 'banc', agent: 'claude-code', concurrence: 1 },
          { nom: 'banc-codex', agent: 'codex', concurrence: 1 },
        ]);
      } finally {
        store.close();
      }
      // Deux identités sur le disque : la première dans le dossier d'hier,
      // l'ajoutée DEDANS, sous le nom de sa famille.
      const identite = (...dossier: string[]): string =>
        readFileSync(path.join(faux, ...dossier, 'node-id.txt'), 'utf8').trim();
      expect(identite('travail')).not.toBe(identite('travail', 'codex'));
    },
    90_000,
  );

  /**
   * Deux faux agents (Claude Code, Codex) et une ruche prête à les lancer —
   * le décor du banc précédent, sans ses gestes.
   */
  function rucheDeDeux(): { env: NodeJS.ProcessEnv; travail: string } {
    const faux = mkdtempSync(path.join(tmpdir(), 'ruche-refus-'));
    aNettoyer.push(faux);
    for (const bin of ['claude', 'codex']) {
      writeFileSync(path.join(faux, bin), '#!/bin/sh\necho "faux 1.0"\n', { mode: 0o755 });
    }
    const travail = path.join(faux, 'travail');
    return {
      travail,
      env: envRuche({
        PATH: faux,
        HOME: faux,
        HIVE_NODE_NAME: 'banc',
        HIVE_WORKDIR: travail,
        HIVE_ISOLEMENT: 'off',
        HIVE_AGENT: '',
        HIVE_AGENT_CMD: '',
      }),
    };
  }

  /**
   * Fait REFUSER une ouvrière au démarrage, pour de vrai : son identité est
   * déjà tenue par un processus vivant (ce banc), et le nœud dit alors
   * « ✘ Ce nœud ne démarre pas : un autre processus vivant porte déjà
   * l'identité de ce nœud » avant de sortir — le même chemin qu'un refus
   * `exige`, sans dépendre du moteur de conteneurs de la machine du banc.
   */
  async function tenirIdentite(dossier: string): Promise<() => void> {
    mkdirSync(dossier, { recursive: true });
    const o = await occuperIdentite(dossier);
    if (o.occupee) throw new Error(`identité déjà tenue : ${dossier}`);
    return o.liberer;
  }

  it.runIf(POSIX)(
    'LA PREMIÈRE OUVRIÈRE REFUSE : la Reine et l’autre ouvrière TOURNENT, la raison est citée, ^C rend 0',
    async () => {
      // Le cas de la preuve V2 Alpha : l'ouvrière Claude Code refusait (code 5
      // sous `exige`), et le lanceur arrêtait la Reine et les ouvrières Codex
      // et Cursor qui venaient de s'inscrire. Sur le code d'avant, ce banc
      // lisait « la ruche s'arrête » et un code 1.
      const { env, travail } = rucheDeDeux();
      const liberer = await tenirIdentite(travail);
      try {
        const r = await jouerRuche(['--sans-ecran'], env, [
          { marqueur: 'la ruche continue sans elle', geste: () => undefined },
          // L'autre ouvrière travaille APRÈS le refus : elle s'inscrit.
          {
            marqueur: '[banc-codex] enregistré',
            geste: (pid) => process.kill(pid, 'SIGINT'),
          },
        ]);
        expect(r.sortie).not.toContain("la ruche s'arrête");
        // La raison, citée sur la ligne du lanceur — pas seulement noyée plus
        // haut parmi les lignes des autres.
        expect(r.sortie).toMatch(
          /ouvrière claude-code\s*│ ✘ arrêtée \(code 1\) — « ✘ Ce nœud ne démarre pas : un autre processus vivant porte déjà l'identité/,
        );
        expect(r.sortie).toContain('1 ouvrière(s) en place');
        expect(r.code, r.sortie).toBe(0);
      } finally {
        liberer();
      }
    },
    90_000,
  );

  it.runIf(POSIX)(
    'TOUTES LES OUVRIÈRES REFUSENT : plus aucune — la ruche s’arrête, en code non nul',
    async () => {
      const { env, travail } = rucheDeDeux();
      const liberations = [
        await tenirIdentite(travail),
        await tenirIdentite(path.join(travail, 'codex')),
      ];
      try {
        const r = await lancerRuche(['--sans-ecran'], env, "la ruche s'arrête", () => undefined);
        expect(r.sortie).toContain('la ruche continue sans elle');
        expect(r.sortie).toContain('plus aucune ouvrière');
        expect(r.code, `une ruche sans ouvrière n’est pas un succès :\n${r.sortie}`).not.toBe(0);
      } finally {
        for (const l of liberations) l();
      }
    },
    90_000,
  );
});
