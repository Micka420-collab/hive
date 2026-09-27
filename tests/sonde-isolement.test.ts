// LA SONDE D'ISOLEMENT — le client répond, le service est mort.
//
// ─── LE FAUX VERT QUE CE BANC FERME ──────────────────────────────────────────
//
// `hive doctor` affichait, sur une machine sans démon Docker :
//
//     ✔ isolement      bac à sable disponible : docker
//
// La sonde lançait `docker --version`, qui répond 0 EN LISANT UNE CONSTANTE,
// sans jamais ouvrir la socket du démon. Mesuré dans le conteneur où le défaut
// a été trouvé, sans tube (§ « CODE=$? sans tube ») :
//
//     docker --version  → code=0   Docker version 29.3.1, build c2be9cc
//     docker info       → code=1   failed to connect to the docker API at
//                                  unix:///var/run/docker.sock
//
// Ce que l'arrivant vivait juste après : sa première tâche ratée TROIS FOIS,
// zéro diff à chaque tentative, et le message brut du démon rangé dans les
// journaux. Le docteur — dont c'est la raison d'être — lui avait dit que tout
// allait bien.
//
// ─── COMMENT CE DÉFAUT A ÉTÉ TROUVÉ ──────────────────────────────────────────
//
// Par le pas 7/7 (`scripts/essai-travail.mjs`), écrit le même jour parce que le
// parcours de seuil s'arrêtait à « un invité est dans la ruche » et ne menait
// jamais un travail jusqu'à un résultat. À sa PREMIÈRE exécution contre une
// ruche réellement installée :
//
//     ✘ 7/7 — la ruche a pris le travail et l'a raté (334d09b5…)
//
// Comme les pas 4/5 et 6/6 avant lui, il a trouvé un défaut réel du premier
// coup. C'est ce que vaut un pas qui joue vraiment le geste.
//
// ─── CE QUI ÉTAIT NU, ET CE QUE LA MESURE A DIT ──────────────────────────────
//
// Deux mutants, chacun vérifié posé. Le premier remet le faux vert, le second
// rend un fournisseur sans rien lancer du tout.
//
// LA MESURE DE NUDITÉ A ÉTÉ REFAITE : le premier crible avait TROIS fichiers au
// rouge, et aucun ne venait des mutants — une ruche laissée tourner sur le port
// 7777 par l'épreuve manuelle polluait les bancs d'installeur. Un crible se lit
// sur une suite verte, sinon il attribue à la garde ce qui vient du décor
// (§ 9 quincenties, ici payé sur ma propre pollution).

//
// ─── ET LE DÉFAUT INVERSE, TROUVÉ PAR LA PREUVE V2 ALPHA ─────────────────────
//
// `info` posé à TOUS les moteurs : bubblewrap n'a pas de sous-commande, il
// prend `info` pour le programme à lancer (`bwrap: execvp info: No such file
// or directory`). Sur un Ubuntu où le nœud isolait très bien ses tâches par
// bubblewrap 0.11.1, le docteur disait « aucun bac à sable ne répond » et
// envoyait installer Docker. La question est désormais celle du nœud
// (`questionAuMoteur`) : `info` pour un moteur de conteneurs, un bac VIDE pour
// bubblewrap — le bac même que le preflight ouvre (`bacVideRefuse`).

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { imageDuBac, relever } from '../src/doctor-releve.js';
import { diagnostiquer } from '../src/shared/doctor.js';
import {
  FOURNISSEURS,
  fournisseurParNom,
  IMAGE_DEFAUT,
  moteursJoignables,
  SONDE_ISOLEMENT,
} from '../src/node-client/isolement.js';
import type { Enveloppe, Fournisseur } from '../src/node-client/isolement.js';

/** Ce que chaque fournisseur s'est vu demander. */
type Demande = { bin: string; args: readonly string[] };

/** Bubblewrap a-t-il reçu la question du nœud : ouvrir un bac vide et y lancer `true` ? */
const bacVide = (d: Demande): boolean =>
  d.bin === 'bwrap' && d.args.at(-1) === 'true' && d.args.at(-2) === '--';

/**
 * Un lanceur de laboratoire.
 *
 * `repond` décide, à partir de la question, si le binaire rend 0 — c'est
 * exactement la distinction qu'on éprouve : le client parle, le service non.
 */
function lanceur(repond: (d: Demande) => boolean) {
  const vues: Demande[] = [];
  const lancer = (lance: Enveloppe): Promise<boolean> => {
    const d = { bin: lance.bin, args: lance.args };
    vues.push(d);
    return Promise.resolve(repond(d));
  };
  return { lancer, vues };
}

const noms = (fs: readonly Fournisseur[]): string[] => fs.map((f) => f.nom);

describe('la sonde d’isolement interroge le SERVICE, pas le client', () => {
  it('UN FOURNISSEUR JOIGNABLE EST RENDU — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const { lancer } = lanceur(() => true);
    expect(noms(await moteursJoignables(lancer))[0]).toBe(FOURNISSEURS[0]!.nom);
  });

  it('LE CLIENT RÉPOND, LE DÉMON EST MORT : AUCUN BAC À SABLE', async () => {
    // ─── L'ENTRÉE QUI SÉPARE LES DEUX SONDES ───────────────────────────────
    //
    // C'est la SEULE machine qui les départage. Là où le démon tourne, les deux
    // versions rendent « docker » ; là où rien n'est installé, les deux rendent
    // rien. Le poste d'un arrivant qui a le client sans le service — un
    // Docker Desktop pas démarré, un démon arrêté, un conteneur sans socket —
    // est exactement le cas où le docteur mentait.
    const { lancer, vues } = lanceur((d) => d.args[0] === '--version');

    expect(
      await moteursJoignables(lancer),
      'un client sans démon passe pour un bac à sable disponible',
    ).toEqual([]);

    // Et l'on vérifie ce qui a été DEMANDÉ, pas seulement ce qui est rendu :
    // un vide obtenu en ne lançant rien du tout serait vert pour la mauvaise
    // raison.
    expect(
      vues.map((v) => v.bin),
      'les fournisseurs ne sont pas tous sondés',
    ).toEqual(FOURNISSEURS.map((f: Fournisseur) => f.bin));
    for (const v of vues.filter((d) => d.bin !== 'bwrap')) {
      expect(v.args, `« ${v.bin} » n’est pas interrogé sur son service`).toEqual([SONDE_ISOLEMENT]);
    }
  });

  it('BUBBLEWRAP EST ÉPROUVÉ COMME LE NŒUD L’ÉPROUVE — un bac vide, jamais `bwrap info`', async () => {
    // Le lanceur joue ce que fait le vrai bubblewrap : `info` le fait échouer
    // (il cherche un programme de ce nom), un bac vide réussit. Sur le code
    // d'avant, la même machine rendait « aucun bac à sable ».
    const { lancer, vues } = lanceur(bacVide);
    expect(noms(await moteursJoignables(lancer))).toEqual(['bubblewrap']);
    const bwrap = vues.find((d) => d.bin === 'bwrap');
    expect(bwrap?.args, 'bubblewrap reçoit encore une sous-commande').not.toContain(
      SONDE_ISOLEMENT,
    );
    // Le bac vide monte le système en LECTURE SEULE, comme celui des tâches.
    expect(bwrap?.args.slice(0, 3)).toEqual(['--ro-bind', '/usr', '/usr']);
  });

  it('AUCUN BINAIRE : AUCUN BAC À SABLE — et tous ont été essayés', async () => {
    const { lancer, vues } = lanceur(() => false);
    expect(await moteursJoignables(lancer)).toEqual([]);
    expect(vues, 'un fournisseur a été écarté sans être essayé').toHaveLength(FOURNISSEURS.length);
  });

  it('LE PRÉFÉRÉ EST RENDU, MÊME QUAND LES SUIVANTS RÉPONDENT AUSSI', async () => {
    // L'ordre de `FOURNISSEURS` est une préférence (podman d'abord : sans démon,
    // sans root) : le premier rendu est le PRÉFÉRÉ, pas le dernier essayé.
    //
    // La recherche ne s'arrête pas au premier : chaque moteur a son propre
    // magasin d'images, et le docteur cherche l'image du bac dans chacun de
    // ceux qui répondent (`imageDuBac`), comme le nœud.
    const { lancer, vues } = lanceur(() => true);

    expect(noms(await moteursJoignables(lancer))).toEqual(noms(FOURNISSEURS));
    expect(vues.map((v) => v.bin)).toEqual(FOURNISSEURS.map((f: Fournisseur) => f.bin));
  });

  it('LA QUESTION POSÉE TOUCHE LE DÉMON — « --version » ne le fait pas', () => {
    // La constante est nommée pour qu'on puisse la lire ici. Ce cas n'est pas un
    // doublon du deuxième : celui-là éprouve le COMPORTEMENT, celui-ci ancre la
    // RAISON, pour que le prochain lecteur ne « simplifie » pas `info` en
    // `--version` en croyant alléger la sonde.
    expect(SONDE_ISOLEMENT, 'la sonde est retombée sur une lecture de constante').not.toBe(
      '--version',
    );
    expect(SONDE_ISOLEMENT, 'la sonde n’interroge plus le service').toBe('info');
  });
});

/**
 * Le vrai bubblewrap de cette machine ouvre-t-il un bac ? Mesuré ICI, à la
 * main et sans le code éprouvé : un Ubuntu 24.04 d'origine le refuse
 * (`kernel.apparmor_restrict_unprivileged_userns=1`), une machine sans
 * bubblewrap ne l'a pas — le banc réel ne vaut que là où il peut conclure.
 */
function bubblewrapOuvreUnBac(): boolean {
  if (process.platform !== 'linux') return false;
  const r = spawnSync(
    'bwrap',
    ['--ro-bind', '/usr', '/usr', '--ro-bind', '/bin', '/bin', '--ro-bind', '/lib', '/lib'].concat([
      '--ro-bind-try',
      '/lib64',
      '/lib64',
      '--proc',
      '/proc',
      '--dev',
      '/dev',
      'true',
    ]),
    { stdio: 'ignore', timeout: 10_000 },
  );
  return r.status === 0;
}

describe('le vrai bubblewrap, là où il ouvre un bac', () => {
  it.runIf(bubblewrapOuvreUnBac())(
    'LE DOCTEUR LE VOIT — « bac à sable disponible », et non « installez Docker »',
    async () => {
      // Le cas de la preuve V2 Alpha, rejoué sur la machine même : bubblewrap
      // ouvre un bac, le nœud l'utiliserait. Le relevé RÉEL (aucun lanceur
      // injecté) doit le trouver, et le verdict ne plus envoyer installer un
      // moteur de conteneurs.
      const racine = mkdtempSync(path.join(tmpdir(), 'hive-doc-bwrap-'));
      try {
        const r = await relever(racine, { HIVE_PORT: '0' }, 'linux');
        expect(r.isolement, 'le docteur ne voit aucun bac à sable').not.toBeNull();
        const verdict = diagnostiquer(r).find((d) => d.cle === 'isolement');
        expect(verdict?.gravite, verdict?.constat).toBe('ok');
      } finally {
        rmSync(racine, { recursive: true, force: true });
      }
      expect(noms(await moteursJoignables())).toContain('bubblewrap');
    },
    30_000,
  );
});

describe('l’image du bac : le docteur suit la règle du nœud', () => {
  const PODMAN = fournisseurParNom('podman') as Fournisseur;
  const DOCKER = fournisseurParNom('docker') as Fournisseur;

  it('l’image par défaut absente partout : la commande qui la construit, pour le PREMIER moteur', async () => {
    const r = await imageDuBac({}, [DOCKER], async () => ({ etat: 'absente' }));
    expect(r).toEqual({
      image: IMAGE_DEFAUT,
      dans: null,
      absenteDe: 'docker',
      construire: 'npm run bac:image -- --moteur docker',
    });
  });

  it('Podman sans l’image, Docker avec : c’est Docker qui est prêt', async () => {
    const vus: string[] = [];
    const r = await imageDuBac({}, [PODMAN, DOCKER], async (f) => {
      vus.push(f.nom);
      return f.nom === 'docker' ? { etat: 'presente' } : { etat: 'absente' };
    });
    expect(r).toMatchObject({ dans: 'docker', construire: null });
    expect(vus).toEqual(['podman', 'docker']);
  });

  it('l’image que le nœud utiliserait : HIVE_ISOLEMENT_IMAGE, et rien à construire', async () => {
    const r = await imageDuBac(
      { HIVE_ISOLEMENT_IMAGE: 'ghcr.io/x/agent:1' },
      [PODMAN],
      async () => ({
        etat: 'absente',
      }),
    );
    expect(r).toEqual({
      image: 'ghcr.io/x/agent:1',
      dans: null,
      absenteDe: 'podman',
      construire: null,
    });
  });

  it('un moteur injoignable ne se lit ni présent ni absent', async () => {
    const r = await imageDuBac({}, [PODMAN], async () => ({ etat: 'injoignable', motif: 'x' }));
    expect(r).toMatchObject({ dans: null, absenteDe: null, construire: null });
  });

  it('aucun moteur joignable : rien à dire de l’image', async () => {
    expect(await imageDuBac({}, [], async () => ({ etat: 'presente' }))).toBeNull();
  });
});
