// TOUT CE QUI EXÉCUTE DU CODE ÉTRANGER PASSE PAR LE BAC À SABLE — sans exception
// non écrite.
//
// ─── L'OUBLI QUE CE FICHIER REND IMPOSSIBLE ──────────────────────────────────
//
// `exec.ts` portait ce commentaire : « c'est le SEUL endroit où un agent est
// lancé, donc le seul endroit où l'oubli serait total ». Il était faux.
// `merge-runner.ts` lançait la commande de test d'un merge avec son propre
// `spawn`, sans enveloppe. Cette commande exécute du code fourni par le dépôt,
// exactement comme un agent.
//
// Conséquence concrète : `HIVE_ISOLEMENT=exige` — le réglage qu'on pose
// précisément quand on prête sa machine à des inconnus — empêchait bien un
// agent de sortir de son bac, pendant que les tests d'un merge tournaient à
// côté, sur l'hôte nu, avec le `HOME` du membre.
//
// Un commentaire ne pouvait pas empêcher ça, et n'a pas empêché ça. Ce test le
// peut : il énumère les `spawn` du dépôt et exige, pour chacun, soit une
// enveloppe, soit une inscription NOMMÉE ci-dessous avec sa raison.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { globSync } from 'node:fs';

const RACINE = fileURLToPath(new URL('../src/', import.meta.url));

/**
 * Les `spawn` qui n'ont PAS à être enveloppés, et pourquoi.
 *
 * La règle qui sépare les deux listes : est-ce que le binaire lancé, ou ce
 * qu'il exécute, peut être choisi par quelqu'un d'autre que le membre ? Si
 * oui, ça s'enveloppe. Sinon, ça s'inscrit ici — avec la raison, parce qu'une
 * dérogation sans motif finit par en couvrir d'autres.
 */
const DEROGATIONS: Readonly<Record<string, string>> = {
  'node-client/agent-detect.ts':
    'lance « <agent> --version » pour savoir ce qui est installé sur la machine ' +
    'du membre — la liste des binaires est en dur, et l’envelopper masquerait ' +
    'précisément ce qu’on cherche à voir : l’hôte',
  'node-client/isolement.ts':
    'sonde « docker/podman/bwrap --version » pour CHOISIR le bac à sable — ' +
    's’envelopper soi-même pour se détecter n’aurait aucun sens',
  'node-client/tunnel.ts':
    'lance cloudflared, choisi et installé par le membre, pour exposer SA ruche ' +
    '— l’isoler du réseau le rendrait inopérant par construction',
  'cli.ts':
    'vérifie la présence de cloudflared depuis la CLI de l’hôte, sur sa propre ' +
    'machine et à sa propre demande',
};

/**
 * Retire les commentaires — sinon un fichier qui se contente de PARLER de
 * `spawn` est accusé de le faire. `shell.ts` documente en tête la commande
 * qu'il délègue, et se retrouvait dénoncé pour une phrase.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
}

/** Les fichiers du dépôt qui appellent réellement `spawn`. */
function fichiersQuiLancent(): { chemin: string; source: string }[] {
  return globSync('**/*.ts', { cwd: RACINE })
    .map((rel) => ({ chemin: rel.replace(/\\/g, '/'), source: readFileSync(RACINE + rel, 'utf8') }))
    .filter(({ source }) => /\bspawn\s*\(/.test(sansCommentaires(source)));
}

describe('la couverture du bac à sable', () => {
  it('méta-test : on trouve bien des spawn à juger', () => {
    expect(fichiersQuiLancent().length).toBeGreaterThan(3);
  });

  it('CHAQUE `spawn` EST SOIT ENVELOPPÉ, SOIT INSCRIT AVEC SA RAISON', () => {
    for (const { chemin, source } of fichiersQuiLancent()) {
      if (chemin in DEROGATIONS) continue;
      expect(
        source.includes('envelopper('),
        `${chemin} lance un processus sans passer par envelopper(). Si c'est ` +
          "volontaire, inscrivez-le dans DEROGATIONS avec la raison — et relisez d'abord " +
          "l'en-tête de ce fichier, parce que c'est exactement l'oubli qui s'y raconte.",
      ).toBe(true);
    }
  });

  it('aucune dérogation ne survit à la disparition de son fichier', () => {
    // Une dérogation orpheline est une porte laissée ouverte pour un mur qui
    // n'existe plus : le jour où le fichier revient, elle s'applique en silence.
    const presents = new Set(fichiersQuiLancent().map((f) => f.chemin));
    for (const chemin of Object.keys(DEROGATIONS)) {
      expect(presents.has(chemin), `${chemin} ne lance plus rien : retirez sa dérogation`).toBe(
        true,
      );
    }
  });

  it('aucune dérogation sans motif écrit', () => {
    for (const [chemin, raison] of Object.entries(DEROGATIONS)) {
      expect(raison.length, chemin).toBeGreaterThan(40);
    }
  });
});

describe('le merge, nommément', () => {
  const MERGE = readFileSync(
    fileURLToPath(new URL('../src/node-client/merge-runner.ts', import.meta.url)),
    'utf8',
  );

  it('la commande de test d’un merge est enveloppée quand le nœud a un bac', () => {
    expect(MERGE).toContain('envelopper(');
    expect(MERGE, 'le clone est le répertoire monté').toContain('cwdHote: cwd');
  });

  it('le client transmet SON bac au merge — sinon l’option ne sert à rien', () => {
    const CLIENT = readFileSync(
      fileURLToPath(new URL('../src/node-client/client.ts', import.meta.url)),
      'utf8',
    );
    const corps = CLIENT.slice(CLIENT.indexOf('runMerge({'));
    expect(corps.slice(0, 400)).toContain('this.opts.bac');
  });
});
