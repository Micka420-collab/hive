// Le moteur de conteneurs : lequel, avec quelle image, et ce qu'il laisse derrière lui.
//
// ─── LES TROIS TROUS QUE CE FICHIER FERME ────────────────────────────────────
//
// 1. LE MOTEUR ÉTAIT « LE PREMIER QUI RÉPOND À --version ». `docker --version`
//    réussit démon arrêté ; un Podman présent n'a pas l'image que Docker a
//    construite. Le nœud retenait ce premier moteur, son preflight échouait, et
//    il retombait en sandbox de processus alors que le suivant l'aurait isolé.
//
// 2. L'IMAGE ABSENTE SE DISAIT « AGENT ABSENT ». Le preflight lançait
//    `run <image> <agent> --version` sous 30 s : un téléchargement y était
//    compris, et expirait au premier démarrage ; un démon arrêté donnait le
//    même message. `preparerImage` inspecte d'abord, et dit laquelle des trois
//    pannes c'est. L'image par défaut n'est jamais tirée d'un registre : le
//    motif donne la commande qui la construit.
//
// 3. UN NŒUD TUÉ LAISSAIT SON CONTENEUR TOURNER. `--rm` meurt avec le client
//    `docker run` ; le conteneur, non. Il porte désormais l'étiquette de son
//    nœud, et le nœud relancé supprime ce qui la porte.
//
// Les moteurs sont ici de FAUX binaires (un script qui consigne ses appels) :
// ce qui est éprouvé, c'est ce que Hive leur demande et ce qu'il fait de leurs
// réponses. Le vrai Docker et le vrai Podman sont exercés par
// `tests/isolement-runtime.integration.test.ts`, dans le job image de la CI.

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  optionBac,
  preparerBac,
  ramasserRestes,
  reprendreIdentite,
  type OutilsBac,
} from '../src/node-client/bac.js';
import { cheminVerrou, occuperIdentite } from '../src/node-client/identite-noeud.js';
import {
  COMMANDE_IMAGE,
  envDuLanceur,
  envelopper,
  envMoteur,
  envTelechargement,
  ETIQUETTE_NOEUD,
  fournisseurParNom,
  IMAGE_DEFAUT,
  imageDepuisEnv,
  moteurPret,
  preparerImage,
  ramasserConteneurs,
  sonderAgentDansBac,
  type Fournisseur,
  type ResultatPreflightAgent,
} from '../src/node-client/isolement.js';
import { CODE } from '../src/codes-sortie.js';
import type { AdapterContext } from '../src/adapters/index.js';
import { runCommand } from '../src/adapters/exec.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { createServer, type HiveServer } from '../src/orchestrator/server.js';

const PODMAN = fournisseurParNom('podman') as Fournisseur;
const DOCKER = fournisseurParNom('docker') as Fournisseur;
const BWRAP = fournisseurParNom('bubblewrap') as Fournisseur;

const OK: ResultatPreflightAgent = { executable: true, motif: 'agent « claude » exécutable' };

/**
 * Une machine où chaque moteur répond selon `images` (image prête ou motif de
 * refus) et `agents` (l'agent passe ou non) — et qui consigne ce qu'on lui a
 * demandé, dans l'ordre.
 */
function machine(
  moteurs: Fournisseur[],
  images: Partial<Record<string, ResultatPreflightAgent>>,
  agents: Partial<Record<string, boolean>> = {},
): { outils: OutilsBac; appels: string[] } {
  const appels: string[] = [];
  return {
    appels,
    outils: {
      moteurs: async () => moteurs,
      preparerImage: async (f, _image, tirer) => {
        appels.push(`${f.nom}:image${tirer ? ':tirer' : ''}`);
        return images[f.nom] ?? { executable: true, motif: `image présente dans ${f.nom}` };
      },
      sonderAgent: async (f, bin) => {
        appels.push(`${f.nom}:${bin}`);
        return agents[f.nom] === false
          ? { executable: false, motif: `agent « ${bin} » absent ou non exécutable dans le bac` }
          : OK;
      },
      plateforme: 'linux',
    },
  };
}

/** Un Claude Code authentifié par une clé nommée : le bac peut le servir. */
const CLE = { ANTHROPIC_API_KEY: 'sk-test' };

describe('LE MOTEUR EST CHOISI PAR SON PREFLIGHT, PAS PAR --version', () => {
  it('un Docker dont le démon est arrêté ne masque plus bubblewrap', async () => {
    const { outils, appels } = machine([DOCKER, BWRAP], {
      docker: { executable: false, motif: 'docker injoignable (« Cannot connect »)' },
    });
    const bac = await preparerBac(CLE, 'claude-code', outils);
    expect(bac.fournisseur?.nom).toBe('bubblewrap');
    expect(bac.decision).toMatchObject({ isole: true, niveau: 'conteneur', refuse: false });
    // Docker éprouvé d'abord (l'ordre de préférence tient), puis bubblewrap.
    expect(appels).toEqual(['docker:image', 'bubblewrap:claude', 'bubblewrap:node']);
    // Et l'humain apprend pourquoi ce n'est pas Docker.
    const texte = bac.lignes.join('\n');
    expect(texte).toMatch(/Écarté : docker : docker injoignable/);
  });

  it('Podman sans l’image que Docker a construite : Docker isole', async () => {
    const { outils } = machine([PODMAN, DOCKER], {
      podman: { executable: false, motif: `image absente de podman — ${COMMANDE_IMAGE}` },
    });
    const bac = await preparerBac(CLE, 'claude-code', outils);
    expect(bac.fournisseur?.nom).toBe('docker');
    expect(optionBac(bac, [])).toMatchObject({ bac: { fournisseur: { nom: 'docker' } } });
  });

  it('le premier qui passe est gardé : les suivants ne sont pas lancés', async () => {
    const { outils, appels } = machine([PODMAN, DOCKER, BWRAP], {});
    const bac = await preparerBac(CLE, 'claude-code', outils);
    expect(bac.fournisseur?.nom).toBe('podman');
    expect(appels).toEqual(['podman:image', 'podman:claude', 'podman:node']);
    expect(bac.lignes.join('\n')).not.toContain('Écarté');
  });

  it('aucun ne passe : « auto » se replie en disant CHAQUE motif', async () => {
    const { outils } = machine(
      [PODMAN, DOCKER],
      { podman: { executable: false, motif: 'image absente de podman' } },
      { docker: false },
    );
    const bac = await preparerBac(CLE, 'claude-code', outils);
    expect(bac.fournisseur).toBeNull();
    expect(bac.decision).toMatchObject({ isole: false, niveau: 'processus', refuse: false });
    expect(bac.decision.motif).toContain('podman : image absente de podman');
    expect(bac.decision.motif).toContain('docker : agent « claude » absent');
    expect(bac.decision.motif).toMatch(/repli explicite/);
  });

  it('aucun ne passe : « exige » refuse, avec son code', async () => {
    const { outils } = machine([DOCKER], { docker: { executable: false, motif: 'injoignable' } });
    const bac = await preparerBac({ ...CLE, HIVE_ISOLEMENT: 'exige' }, 'claude-code', outils);
    expect(bac.refuse).toBe(true);
    expect(bac.codeSortie).toBe(CODE.REFUS_SECURITE);
    expect(bac.decision.motif).toContain('injoignable');
  });

  it('une image NOMMÉE déjà dans Docker n’est pas téléchargée par le Podman qui la précède', async () => {
    const ABSENTE = {
      executable: false,
      motif: 'image x absente de podman',
      imageAbsente: true,
    } as const;
    const { outils, appels } = machine([PODMAN, DOCKER], { podman: ABSENTE });
    const bac = await preparerBac(
      { ...CLE, HIVE_ISOLEMENT_IMAGE: 'ghcr.io/x/agent:1' },
      'claude-code',
      outils,
    );
    expect(bac.fournisseur?.nom).toBe('docker');
    expect(appels).toEqual(['podman:image', 'docker:image', 'docker:claude', 'docker:node']);
    // Une absence n'est pas un refus : rien à dire de Podman.
    expect(bac.lignes.join('\n')).not.toContain('Écarté');
  });

  it('aucun moteur ne l’a : un seul téléchargement, dans le premier — et avant bubblewrap', async () => {
    const images: Partial<Record<string, ResultatPreflightAgent>> = {};
    const { outils, appels } = machine([PODMAN, DOCKER, BWRAP], images);
    const absente = { executable: false, motif: 'image absente', imageAbsente: true } as const;
    outils.preparerImage = async (f, _image, tirer) => {
      appels.push(`${f.nom}:image${tirer ? ':tirer' : ''}`);
      return tirer ? { executable: true, motif: `image téléchargée dans ${f.nom}` } : absente;
    };
    const bac = await preparerBac(
      { ...CLE, HIVE_ISOLEMENT_IMAGE: 'ghcr.io/x/agent:1' },
      'claude-code',
      outils,
    );
    expect(bac.fournisseur?.nom).toBe('podman');
    expect(appels).toEqual([
      'podman:image',
      'docker:image',
      'podman:image:tirer',
      'podman:claude',
      'podman:node',
    ]);
  });

  it('sans agent à éprouver (shell), un conteneur doit tout de même AVOIR son image', async () => {
    // Le shell réel, les commandes de test d'un merge et d'un chantier tournent
    // dans l'image : un bac annoncé sur une image absente ferait échouer
    // chacune d'elles.
    const { outils, appels } = machine([PODMAN, BWRAP], {
      podman: { executable: false, motif: 'image absente de podman' },
    });
    const bac = await preparerBac({}, 'shell', outils);
    expect(bac.fournisseur?.nom).toBe('bubblewrap');
    expect(appels).toEqual(['podman:image']);
  });
});

describe('moteurPret — la règle que le docteur et l’installeur partagent avec le nœud', () => {
  it('le premier qui A l’image, bubblewrap prêt d’office ; la première absence est retenue', async () => {
    const vus: string[] = [];
    const r = await moteurPret([PODMAN, DOCKER, BWRAP], IMAGE_DEFAUT, async (f) => {
      vus.push(f.nom);
      return f.nom === 'podman' ? { etat: 'absente' } : { etat: 'injoignable', motif: 'x' };
    });
    expect(r).toEqual({ pret: BWRAP, absente: PODMAN });
    // bubblewrap n'a pas d'image : rien à lui demander.
    expect(vus).toEqual(['podman', 'docker']);
  });

  it('aucun prêt : ni moteur, et l’absence qui dit où construire', async () => {
    const r = await moteurPret([DOCKER], IMAGE_DEFAUT, async () => ({ etat: 'absente' }));
    expect(r).toEqual({ pret: null, absente: DOCKER });
  });
});

// ─── LES FAUX MOTEURS ────────────────────────────────────────────────────────
//
// Un script `sh` qui consigne chacun de ses appels, et répond selon le scénario.
// Sous Windows, un `#!/bin/sh` n'est pas un exécutable : ces bancs y sont
// sautés — le preflight réel des moteurs n'y tourne pas non plus.

const surPosix = process.platform !== 'win32';
let dossier = '';

beforeEach(() => {
  dossier = mkdtempSync(path.join(os.tmpdir(), 'hive-faux-moteur-'));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dossier, { recursive: true, force: true });
  // Le verrou d'identité qu'un banc a pris vit hors du dossier : on l'efface.
  if (surPosix) rmSync(cheminVerrou(dossier), { force: true });
});

/** Un faux moteur `nom` : `corps` est le `case "$1 $2"` du script. */
function fauxMoteur(nom: string, corps: string): { moteur: Fournisseur; appels: () => string[] } {
  const journal = path.join(dossier, `${nom}.log`);
  const bin = path.join(dossier, nom);
  writeFileSync(
    bin,
    `#!/bin/sh\necho "$*" >> ${JSON.stringify(journal)}\ncase "$1 $2" in\n${corps}\nesac\nexit 0\n`,
    { mode: 0o755 },
  );
  const base = fournisseurParNom(nom) as Fournisseur;
  return {
    moteur: { ...base, bin },
    appels: () => {
      try {
        return readFileSync(journal, 'utf8').trim().split('\n');
      } catch {
        return [];
      }
    },
  };
}

describe.skipIf(!surPosix)('preparerImage — trois pannes, trois motifs', () => {
  it('une image présente passe, sans rien télécharger', async () => {
    const { moteur, appels } = fauxMoteur('docker', `'image inspect') echo sha256:abc ;;`);
    const r = await preparerImage(moteur, IMAGE_DEFAUT);
    expect(r.executable).toBe(true);
    expect(appels()).toEqual([`image inspect --format {{.Id}} ${IMAGE_DEFAUT}`]);
  });

  it('l’image PAR DÉFAUT absente n’est jamais tirée : le motif donne la commande qui la construit', async () => {
    const { moteur, appels } = fauxMoteur(
      'podman',
      `'image inspect') echo "Error: ${IMAGE_DEFAUT}: image not known" >&2; exit 125 ;;`,
    );
    const r = await preparerImage(moteur, IMAGE_DEFAUT);
    expect(r.executable).toBe(false);
    expect(r.motif).toContain('image absente de podman');
    expect(r.motif).toContain(COMMANDE_IMAGE);
    expect(appels().some((a) => a.startsWith('pull'))).toBe(false);
  });

  it('une image NOMMÉE absente est téléchargée sous son propre délai, annoncé avant', async () => {
    const { moteur, appels } = fauxMoteur(
      'docker',
      `'image inspect') echo "Error response from daemon: No such image: ghcr.io/x/agent:1" >&2; exit 1 ;;\n'pull ghcr.io/x/agent:1') exit 0 ;;`,
    );
    const dit: string[] = [];
    const r = await preparerImage(moteur, 'ghcr.io/x/agent:1', { informer: (l) => dit.push(l) });
    expect(r).toEqual({ executable: true, motif: 'image téléchargée dans docker' });
    expect(appels()).toContain('pull ghcr.io/x/agent:1');
    expect(dit.join('\n')).toMatch(/Téléchargement de l'image ghcr\.io\/x\/agent:1 via docker/);
  });

  it('un téléchargement trop long se dit « en cours », pas « agent absent »', async () => {
    const { moteur } = fauxMoteur(
      'docker',
      `'image inspect') echo "No such image" >&2; exit 1 ;;\n'pull ghcr.io/x/agent:1') sleep 5 ;;`,
    );
    const r = await preparerImage(moteur, 'ghcr.io/x/agent:1', {
      informer: () => {},
      telechargementMs: 200,
    });
    expect(r.executable).toBe(false);
    expect(r.motif).toMatch(/toujours en cours/);
    expect(r.motif).toContain('pull ghcr.io/x/agent:1');
  });

  it('Podman rootless prépare l’image à l’UID du nœud AVANT le preflight de l’agent, et le dit si ça dure', async () => {
    // Le premier `--userns=keep-id` copie les couches de l'image : mesuré en CI,
    // plus que les 30 s du preflight de l'agent, qui expirait.
    vi.spyOn(process, 'getuid').mockReturnValue(1001);
    const { moteur, appels } = fauxMoteur(
      'podman',
      `'image inspect') echo sha256:abc ;;\n'run --rm') sleep 4 ;;`,
    );
    const dit: string[] = [];
    const r = await preparerImage(moteur, IMAGE_DEFAUT, { informer: (l) => dit.push(l) });
    expect(r).toEqual({ executable: true, motif: 'image présente dans podman' });
    // Le moteur est interrogé d'abord ; muet, l'UID du nœud en décide.
    expect(appels()[1]).toBe('info --format {{.Host.Security.Rootless}}');
    // Le même bac que la tâche : l'image nommée ne tourne jamais sans ses murs.
    const preparation = appels()[2] ?? '';
    expect(preparation).toMatch(/^run --rm /);
    for (const mur of [
      '--userns=keep-id',
      '--pull=never',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--read-only',
    ]) {
      expect(preparation).toContain(mur);
    }
    expect(preparation).toMatch(new RegExp(`${IMAGE_DEFAUT} true$`));
    expect(dit.join('\n')).toMatch(/pour l'UID de ce nœud \(podman --userns=keep-id/);
  }, 15_000);

  it('une préparation keep-id qui n’aboutit pas se dit « en cours », pas « agent absent »', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(1001);
    const { moteur } = fauxMoteur(
      'podman',
      `'image inspect') echo sha256:abc ;;\n'run --rm') sleep 5 ;;`,
    );
    const r = await preparerImage(moteur, IMAGE_DEFAUT, {
      informer: () => {},
      telechargementMs: 200,
    });
    expect(r.executable).toBe(false);
    expect(r.motif).toMatch(/toujours en cours .*podman --userns=keep-id/);
  });

  it('un podman-remote ROOTFUL, sous un nœud non root : ni préparation ni `keep-id`, qu’il refuserait', async () => {
    // `keep-id` suivait l'UID de l'hôte : sur macOS (UID 501) vers une machine
    // `--rootful`, chaque preflight échouait « keep-id is only supported in
    // rootless mode », et le poste retombait en processus.
    vi.spyOn(process, 'getuid').mockReturnValue(501);
    const { moteur, appels } = fauxMoteur(
      'podman',
      `'image inspect') echo sha256:abc ;;\n'info --format') echo false ;;`,
    );
    const r = await preparerImage(moteur, IMAGE_DEFAUT);
    expect(r).toMatchObject({ executable: true, fournisseur: { nom: 'podman', rootless: false } });
    expect(appels().some((a) => a.startsWith('run'))).toBe(false);
    // Ce que le moteur a dit voyage avec lui jusqu'à la tâche.
    const tache = envelopper('claude', [], {
      fournisseur: r.fournisseur as Fournisseur,
      cwdHote: dossier,
      variables: [],
    });
    expect(tache.args).not.toContain('--userns=keep-id');
    const gid = process.getgid?.() ?? 0;
    expect(tache.args).toContain(`--user=501:${gid > 0 ? gid : 501}`);
  });

  it('un Podman qui se dit rootless garde `keep-id`, et le preflight retenu le porte', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(1001);
    const { moteur } = fauxMoteur(
      'podman',
      `'image inspect') echo sha256:abc ;;\n'info --format') echo true ;;`,
    );
    const { outils } = machine([moteur], {});
    const bac = await preparerBac(CLE, 'claude-code', {
      ...outils,
      preparerImage: (f, image) => preparerImage(f, image, { informer: () => {} }),
    });
    expect(bac.fournisseur).toMatchObject({ nom: 'podman', rootless: true });
    const tache = envelopper('claude', [], {
      fournisseur: bac.fournisseur as Fournisseur,
      cwdHote: dossier,
      variables: [],
    });
    expect(tache.args).toContain('--userns=keep-id');
  });

  it('Docker, lui, n’a rien à préparer', async () => {
    vi.spyOn(process, 'getuid').mockReturnValue(1001);
    const { moteur, appels } = fauxMoteur('docker', `'image inspect') echo sha256:abc ;;`);
    expect((await preparerImage(moteur, IMAGE_DEFAUT)).executable).toBe(true);
    expect(appels()).toHaveLength(1);
  });

  it('un contexte introuvable n’est PAS une image absente : ni reconstruction, ni téléchargement', async () => {
    // `not found` figurait dans le motif de l'absence : ce message renvoyait
    // reconstruire (ou tirer) une image, en taisant la vraie panne.
    const { moteur, appels } = fauxMoteur(
      'docker',
      `'image inspect') echo 'context "typo": context not found' >&2; exit 1 ;;`,
    );
    for (const image of [IMAGE_DEFAUT, 'ghcr.io/x/agent:1']) {
      const r = await preparerImage(moteur, image, { informer: () => {} });
      expect(r.motif).toBe('docker injoignable (« context "typo": context not found »)');
    }
    expect(appels().some((a) => a.startsWith('pull'))).toBe(false);
  });

  it('Docker ancien (« No such object ») : l’absence est reconnue', async () => {
    const { moteur } = fauxMoteur(
      'docker',
      `'image inspect') echo "Error: No such object: ${IMAGE_DEFAUT}" >&2; exit 1 ;;`,
    );
    const r = await preparerImage(moteur, IMAGE_DEFAUT);
    expect(r.motif).toContain(`${COMMANDE_IMAGE} -- --moteur docker`);
  });

  it('`tirer: false` : une image nommée absente se dit, sans téléchargement', async () => {
    const { moteur, appels } = fauxMoteur(
      'podman',
      `'image inspect') echo "Error: ghcr.io/x/agent:1: image not known" >&2; exit 125 ;;`,
    );
    const r = await preparerImage(moteur, 'ghcr.io/x/agent:1', { tirer: false });
    expect(r).toMatchObject({ executable: false, imageAbsente: true });
    expect(appels()).toHaveLength(1);
  });

  it('un démon arrêté se dit injoignable, en citant le moteur', async () => {
    const { moteur, appels } = fauxMoteur(
      'docker',
      `'image inspect') echo "Cannot connect to the Docker daemon at unix:///var/run/docker.sock. Is the docker daemon running?" >&2; exit 1 ;;`,
    );
    const r = await preparerImage(moteur, 'ghcr.io/x/agent:1');
    expect(r.executable).toBe(false);
    expect(r.motif).toMatch(/^docker injoignable \(« Cannot connect to the Docker daemon/);
    // Rien à télécharger d'un moteur qui ne répond pas.
    expect(appels().some((a) => a.startsWith('pull'))).toBe(false);
  });
});

describe.skipIf(!surPosix)('le preflight de l’agent dans un conteneur', () => {
  it('ne télécharge rien, et cite ce que le moteur dit quand le conteneur ne démarre pas', async () => {
    const { moteur, appels } = fauxMoteur(
      'podman',
      `'run --rm') echo "Error: container-init binary not found on the host" >&2; exit 125 ;;`,
    );
    const r = await sonderAgentDansBac(moteur, 'claude', IMAGE_DEFAUT, undefined, 5_000);
    expect(r.executable).toBe(false);
    expect(r.motif).toContain('« Error: container-init binary not found on the host »');
    expect(appels()[0]).toContain('--pull=never');
  });
});

describe.skipIf(!surPosix)('ramasserConteneurs — ce qu’un nœud tué a laissé', () => {
  it('supprime exactement les conteneurs à l’étiquette de CE nœud', async () => {
    const { moteur, appels } = fauxMoteur(
      'docker',
      `'ps --all') printf 'a1b2c3d4e5f6\\n0123456789ab\\n' ;;\n'rm --force') exit 0 ;;`,
    );
    const r = await ramasserConteneurs(moteur, 'node-42');
    expect(r).toEqual({ supprimes: ['a1b2c3d4e5f6', '0123456789ab'] });
    expect(appels()).toEqual([
      `ps --all --quiet --filter=label=${ETIQUETTE_NOEUD}=node-42`,
      'rm --force a1b2c3d4e5f6 0123456789ab',
    ]);
  });

  it('rien à ramasser : aucun `rm` lancé', async () => {
    const { moteur, appels } = fauxMoteur('podman', `'ps --all') ;;`);
    expect(await ramasserConteneurs(moteur, 'node-42')).toEqual({ supprimes: [] });
    expect(appels()).toHaveLength(1);
  });

  it('un moteur qui ne liste pas se DIT injoignable — jamais un « rien à ramasser » inventé', async () => {
    const { moteur } = fauxMoteur(
      'docker',
      `'ps --all') echo "Cannot connect to the Docker daemon" >&2; exit 1 ;;`,
    );
    const r = await ramasserConteneurs(moteur, 'node-42');
    expect(r).toEqual({
      injoignable: 'docker injoignable (« Cannot connect to the Docker daemon »)',
    });
  });
});

describe('ramasserRestes — au démarrage du nœud', () => {
  it('interroge chaque moteur, avec l’identité stable du nœud, et dit ce qu’il a supprimé', async () => {
    const vus: string[] = [];
    const lignes = await ramasserRestes([DOCKER], 'node-42', async (f, noeud) => {
      vus.push(`${f.nom}:${noeud}`);
      return { supprimes: ['a1b2c3d4e5f6'] };
    });
    expect(vus).toEqual(['docker:node-42']);
    expect(lignes.join('\n')).toMatch(/1 conteneur\(s\) laissé\(s\) par un lancement précédent/);
  });

  it('un échec du moteur n’empêche pas le démarrage, mais se dit', async () => {
    const lignes = await ramasserRestes([PODMAN], 'node-42', async () => ({
      motif: 'podman muet',
    }));
    expect(lignes.join('\n')).toMatch(/⚠ podman muet/);
  });

  it('un Docker arrêté se dit sobrement, sans l’alarme d’un agent qui tournerait encore', async () => {
    // Docker Desktop installé et éteint : il ne fait rien tourner qu'on
    // pourrait joindre, et le dire en rouge à chaque démarrage n'aide personne.
    const lignes = await ramasserRestes([DOCKER], 'node-42', async () => ({
      injoignable: 'docker injoignable (« Cannot connect »)',
    }));
    expect(lignes).toEqual([
      "   · docker injoignable (« Cannot connect ») — ses conteneurs n'ont pas été cherchés.",
    ]);
  });

  it('plusieurs moteurs : chacun est interrogé, bubblewrap (`--die-with-parent`) non', async () => {
    // Le Docker d'hier tué net, un Podman retenu aujourd'hui.
    const vus: string[] = [];
    const lignes = await ramasserRestes([PODMAN, DOCKER, BWRAP], 'node-42', async (f, noeud) => {
      vus.push(`${f.nom}:${noeud}`);
      return f.nom === 'docker' ? { supprimes: ['a1b2c3d4e5f6'] } : { supprimes: [] };
    });
    expect(vus).toEqual(['podman:node-42', 'docker:node-42']);
    expect(lignes.join('\n')).toMatch(/1 conteneur\(s\) .* supprimé\(s\) \(docker\)/);
  });
});

describe('reprendreIdentite — l’identité prise, les restes ramassés, AVANT le preflight', () => {
  it('ramasse même quand `exige` refusera ensuite : le ramassage ne dépend d’aucun preflight', async () => {
    // Le ramassage venait après `preparerBac` : un refus `exige` sortait avant,
    // et l'orphelin d'hier continuait d'écrire et de dépenser.
    const vus: string[] = [];
    const reprise = await reprendreIdentite({ HIVE_ISOLEMENT: 'exige' }, 'node-42', dossier, {
      trouver: async () => [DOCKER],
      ramasser: async (f, noeud) => {
        vus.push(`${f.nom}:${noeud}`);
        return { supprimes: ['a1b2c3d4e5f6'] };
      },
    });
    expect(vus).toEqual(['docker:node-42']);
    expect(reprise).toMatchObject({ occupee: false, moteurs: [DOCKER] });
    // Les moteurs sondés ici sont ceux que le preflight éprouvera : une sonde, pas deux.
    const bac = await preparerBac({ HIVE_ISOLEMENT: 'exige' }, undefined, {
      ...machine([], {}).outils,
      moteurs: async () => (reprise.occupee ? [] : reprise.moteurs),
    });
    expect(bac.fournisseur?.nom).toBe('docker');
  });

  it('en `off`, aucun moteur n’est sondé ni fouillé', async () => {
    let sonde = false;
    const reprise = await reprendreIdentite({ HIVE_ISOLEMENT: 'off' }, 'node-42', dossier, {
      trouver: async () => {
        sonde = true;
        return [DOCKER];
      },
    });
    expect(sonde).toBe(false);
    expect(reprise).toEqual({ occupee: false, moteurs: [], lignes: [] });
  });

  it('un AUTRE processus vivant tient l’identité : rien n’est supprimé, et ce nœud ne démarre pas', async () => {
    // `npm run node` lancé deux fois sous le même nom : le second tuait les
    // agents en cours du premier — et, laissé tourner, se serait fait tuer
    // les siens au prochain redémarrage du premier.
    const premier = await occuperIdentite(dossier);
    expect(premier.occupee).toBe(false);
    let appele = false;
    const reprise = await reprendreIdentite({}, 'node-42', dossier, {
      trouver: async () => [DOCKER],
      ramasser: async () => {
        appele = true;
        return { supprimes: [] };
      },
    });
    expect(appele).toBe(false);
    expect(reprise.occupee).toBe(true);
    if (reprise.occupee) expect(reprise.message).toMatch(/porte déjà l'identité de ce nœud/);
    if (!premier.occupee) premier.liberer();
  });
});

describe('occuperIdentite — un verrou que l’OS rend à la mort du processus', () => {
  it('tenu, il refuse un second occupant ; rendu, il se reprend', async () => {
    const premier = await occuperIdentite(dossier);
    expect(premier.occupee).toBe(false);
    expect((await occuperIdentite(dossier)).occupee).toBe(true);
    if (!premier.occupee) premier.liberer();
    const repris = await occuperIdentite(dossier);
    expect(repris.occupee).toBe(false);
    if (!repris.occupee) repris.liberer();
  });

  it.skipIf(!surPosix)(
    'un occupant tué net (kill -9) ne bloque rien, même si son pid est recyclé',
    async () => {
      // Le pid inscrit dans `node.pid` survivait à son processus : un
      // programme sans rapport qui en héritait faisait sauter chaque ramassage.
      // La socket, elle, n'écoute plus : une connexion est refusée.
      const chemin = cheminVerrou(dossier);
      const enfant = spawn(
        process.execPath,
        [
          '-e',
          `require('node:net').createServer().listen(${JSON.stringify(chemin)}, () => console.log('pret'))`,
        ],
        { stdio: ['ignore', 'pipe', 'ignore'] },
      );
      await new Promise<void>((resolve) => enfant.stdout.once('data', () => resolve()));
      expect((await occuperIdentite(dossier)).occupee).toBe(true);
      enfant.kill('SIGKILL');
      await new Promise((resolve) => enfant.once('exit', resolve));
      // La socket est restée sur le disque : elle est reprise.
      expect(existsSync(chemin)).toBe(true);
      const repris = await occuperIdentite(dossier);
      expect(repris.occupee).toBe(false);
      if (!repris.occupee) repris.liberer();
    },
    15_000,
  );

  it('le verrou vit HORS de l’atelier, propre à l’utilisateur, un par atelier', () => {
    // Posée dans l'atelier, la socket faisait échouer la copie du dossier de
    // la ruche (`fs.cpSync` s'arrête sur elle) — mesuré par l'essai d'entrée.
    const env = { XDG_RUNTIME_DIR: '/run/user/1001' };
    const chemin = cheminVerrou('ruche/.hive-work/claude', env, 'linux');
    expect(path.dirname(chemin)).toBe(path.join('/run/user/1001'));
    expect(path.basename(chemin)).toMatch(/^hive-noeud-[0-9a-f]{16}\.sock$/);
    expect(cheminVerrou(path.resolve('ruche/.hive-work/claude'), env, 'linux')).toBe(chemin);
    expect(cheminVerrou('ruche/.hive-work/codex', env, 'linux')).not.toBe(chemin);
    expect(path.dirname(cheminVerrou('x', {}, 'linux'))).toBe(os.tmpdir());
    const long = path.join(os.tmpdir(), 'x'.repeat(120));
    expect(cheminVerrou(long, {}, 'win32')).toMatch(/^\\\\\.\\pipe\\hive-noeud-[0-9a-f]{16}$/);
  });
});

describe('le client du moteur reçoit ce qu’il lit de l’hôte — l’agent, non', () => {
  // L'environnement épuré de la tâche (ni HOME ni session) partait tel quel au
  // CLIENT `podman run` : Podman rootless range ses images sous le HOME et sa
  // session sous XDG_RUNTIME_DIR. Le preflight (environnement du nœud) trouvait
  // l'image ; la tâche, non.
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('un conteneur : HOME et XDG_RUNTIME_DIR de l’hôte vont au client', () => {
    const env = envDuLanceur(
      PODMAN,
      { PATH: '/usr/bin' },
      {
        HOME: '/home/membre',
        XDG_RUNTIME_DIR: '/run/user/1001',
        DOCKER_HOST: 'unix:///run/user/1001/docker.sock',
        HIVE_TOKEN: 'secret-de-la-ruche',
      },
    );
    expect(env).toEqual({
      PATH: '/usr/bin',
      HOME: '/home/membre',
      XDG_RUNTIME_DIR: '/run/user/1001',
      DOCKER_HOST: 'unix:///run/user/1001/docker.sock',
    });
  });

  it('les épreuves du démarrage voient le MÊME environnement de moteur que la tâche', () => {
    // Le preflight partait avec presque tout l'hôte, la tâche avec une liste :
    // un réglage hors liste faisait passer l'un et échouer l'autre.
    const hote = {
      PATH: '/usr/bin',
      HOME: '/home/membre',
      DOCKER_HOST: 'tcp://moteur:2376',
      DOCKER_TLS_VERIFY: '1',
      DOCKER_CERT_PATH: '/home/membre/.docker/tls',
      APPDATA: 'C:\\Users\\m\\AppData\\Roaming',
      REGLAGE_INCONNU: 'x',
      HIVE_TOKEN: 'secret-de-la-ruche',
    };
    const epreuve = envMoteur(DOCKER, hote);
    expect(epreuve).toEqual(envDuLanceur(DOCKER, { PATH: '/usr/bin' }, hote));
    expect(epreuve).toMatchObject({ DOCKER_TLS_VERIFY: '1', APPDATA: hote.APPDATA });
    expect(epreuve).not.toHaveProperty('REGLAGE_INCONNU');
    expect(epreuve).not.toHaveProperty('HIVE_TOKEN');
  });

  it.skipIf(!surPosix)('le vrai `image inspect` part avec cet environnement', async () => {
    const trace = path.join(dossier, 'env.txt');
    const { moteur } = fauxMoteur(
      'docker',
      `'image inspect') echo "TLS=$DOCKER_TLS_VERIFY INCONNU=$REGLAGE_INCONNU" > ${JSON.stringify(trace)} ;;`,
    );
    vi.stubEnv('DOCKER_TLS_VERIFY', '1');
    vi.stubEnv('REGLAGE_INCONNU', 'x');
    expect((await preparerImage(moteur, IMAGE_DEFAUT)).executable).toBe(true);
    expect(readFileSync(trace, 'utf8').trim()).toBe('TLS=1 INCONNU=');
  });

  it('le `pull` seul voit le proxy, l’authentification du registre et les autorités — jamais la tâche', () => {
    // Podman rootless tire l'image dans son client : sans proxy, une image
    // nommée ne se téléchargeait plus derrière un proxy d'entreprise. Mais la
    // tâche ne tire rien, et Podman ferait traverser le proxy jusqu'à l'agent.
    const hote = {
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:3128',
      no_proxy: 'localhost',
      REGISTRY_AUTH_FILE: '/home/membre/auth.json',
      SSL_CERT_FILE: '/etc/ssl/entreprise.pem',
      HIVE_TOKEN: 'secret-de-la-ruche',
    };
    expect(envTelechargement(PODMAN, hote)).toEqual({
      PATH: '/usr/bin',
      HTTPS_PROXY: 'http://proxy:3128',
      no_proxy: 'localhost',
      REGISTRY_AUTH_FILE: '/home/membre/auth.json',
      SSL_CERT_FILE: '/etc/ssl/entreprise.pem',
    });
    expect(envMoteur(PODMAN, hote)).toEqual({ PATH: '/usr/bin' });
    expect(envDuLanceur(PODMAN, { PATH: '/usr/bin' }, hote)).toEqual({ PATH: '/usr/bin' });
  });

  it.skipIf(!surPosix)('le vrai `pull` part avec le proxy de l’hôte', async () => {
    const trace = path.join(dossier, 'env.txt');
    const { moteur } = fauxMoteur(
      'podman',
      `'image inspect') echo "image not known" >&2; exit 125 ;;\n'pull ghcr.io/x/agent:1') echo "PROXY=$HTTPS_PROXY" > ${JSON.stringify(trace)} ;;`,
    );
    vi.stubEnv('HTTPS_PROXY', 'http://proxy:3128');
    const r = await preparerImage(moteur, 'ghcr.io/x/agent:1', { informer: () => {} });
    expect(r.executable).toBe(true);
    expect(readFileSync(trace, 'utf8').trim()).toBe('PROXY=http://proxy:3128');
  });

  it('bubblewrap TRANSMET son environnement à l’agent : il ne reçoit rien de plus', () => {
    const tache = { PATH: '/usr/bin' };
    expect(envDuLanceur(BWRAP, tache, { HOME: '/home/membre' })).toBe(tache);
  });

  it.skipIf(!surPosix)(
    'le vrai `spawn` d’une tâche en bac passe cet environnement au moteur',
    async () => {
      const { moteur } = fauxMoteur(
        'podman',
        `'run --rm') echo "XDG=$XDG_RUNTIME_DIR HIVE=$HIVE_TOKEN" ;;`,
      );
      vi.stubEnv('XDG_RUNTIME_DIR', '/run/user/4242');
      vi.stubEnv('HIVE_TOKEN', 'jeton-qui-ne-doit-pas-passer');
      const r = await runCommand('claude', ['--version'], {
        cwd: dossier,
        env: { PATH: process.env.PATH },
        attempt: 1,
        signal: new AbortController().signal,
        onProgress: () => {},
        bac: { fournisseur: moteur, image: IMAGE_DEFAUT, variables: [] },
      });
      expect(r.logs.trim()).toBe('XDG=/run/user/4242 HIVE=');
    },
  );
});

describe('le nœud étiquette chaque exécution — de la Reine jusqu’à l’adaptateur', () => {
  let serveur: HiveServer | null = null;
  let client: HiveNodeClient | null = null;
  let racine = '';
  afterEach(async () => {
    client?.stop();
    client = null;
    await serveur?.stop();
    serveur = null;
    if (racine) rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
  });

  it('la tâche arrive avec l’identité STABLE du nœud et son propre id', async () => {
    // L'étiquette du nœud doit être celle que `main.ts` relira au redémarrage
    // (`identiteStable`) : un conteneur étiqueté autrement survivrait au
    // ramassage.
    const JETON = 'jeton-etiquettes-bac-assez-long';
    racine = mkdtempSync(path.join(os.tmpdir(), 'hive-etiquettes-'));
    serveur = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: JETON,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(racine, 'hive.db'),
      simulation: false,
      tickMs: 20,
    });
    const s = serveur;
    const recus: Array<AdapterContext['bac']> = [];
    client = new HiveNodeClient({
      url: `ws://127.0.0.1:${s.port}/ws`,
      token: JETON,
      name: 'poste-etiquete',
      ownerName: 'banc',
      agentType: 'custom',
      nodeId: 'noeud-etiquete',
      maxConcurrency: 1,
      workRoot: path.join(racine, 'travail'),
      quiet: true,
      bac: { fournisseur: PODMAN, image: IMAGE_DEFAUT, variables: [] },
      adapter: {
        name: 'banc',
        async run(_tache, ctx) {
          recus.push(ctx.bac);
          return { success: true, diff: '', logs: 'ok', subAgents: [] };
        },
      },
    });
    client.start();
    const attendre = async (condition: () => boolean, message: string): Promise<void> => {
      const fin = Date.now() + 15_000;
      while (Date.now() < fin) {
        if (condition()) return;
        await new Promise((r) => setTimeout(r, 25));
      }
      throw new Error(message);
    };
    await attendre(
      () => s.store.listNodes().some((n) => n.id === 'noeud-etiquete'),
      'le nœud ne rejoint pas la ruche',
    );
    const projet = s.store.createProject({ name: 'Étiquettes' });
    const tache = s.store.createTask({ projectId: projet.id, title: 't', prompt: 'p' });
    s.store.patchTask(tache.id, { status: 'ready' });
    await attendre(() => recus.length > 0, 'la tâche n’atteint pas l’adaptateur');
    expect(recus[0]).toEqual({
      fournisseur: PODMAN,
      image: IMAGE_DEFAUT,
      variables: [],
      noeud: 'noeud-etiquete',
      tache: tache.id,
    });
  });
});

describe('l’image par défaut', () => {
  it('porte les agents, et ne se confond avec aucune image d’un registre public', () => {
    // `node:20-slim` : Node en fin de vie, et aucune CLI d'agent — le niveau
    // conteneur était inatteignable par défaut. `localhost/` : Docker ne va
    // pas la chercher sur le Hub.
    expect(IMAGE_DEFAUT).toBe('localhost/hive-agent:local');
    expect(imageDepuisEnv({})).toBe(IMAGE_DEFAUT);
    expect(imageDepuisEnv({ HIVE_ISOLEMENT_IMAGE: '  ' })).toBe(IMAGE_DEFAUT);
    const paquet = JSON.parse(
      readFileSync(path.join(import.meta.dirname, '..', 'package.json'), 'utf8'),
    ) as { scripts: Record<string, string> };
    // La commande que les motifs donnent existe vraiment.
    const script = COMMANDE_IMAGE.replace(/^npm run /, '');
    expect(paquet.scripts[script]).toBe('node scripts/image-agents.mjs');
    // …et construit l'image sous le nom que le nœud cherche, sans quoi il la
    // dirait « absente » et renverrait ici en boucle.
    const construction = readFileSync(
      path.join(import.meta.dirname, '..', 'scripts', 'image-agents.mjs'),
      'utf8',
    );
    expect(construction).toContain(`const IMAGE = '${IMAGE_DEFAUT}';`);
  });
});
