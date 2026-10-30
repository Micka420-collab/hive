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

import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

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
  'node-client/mesure-processus.ts':
    'lit la table des processus (`ps`) et interroge le MOTEUR (`docker/podman ' +
    'stats`) depuis l’hôte pour mesurer un agent qui tourne — l’arbre à mesurer ' +
    'et le conteneur à interroger ne se voient QUE de l’hôte ; argv en dur, ' +
    'jamais tiré de la tâche, rien du dépôt ne s’y exécute',
  'cli.ts':
    'vérifie la présence de cloudflared depuis la CLI de l’hôte, sur sa propre ' +
    'machine et à sa propre demande',
  // ─── CELLE-CI N'EST PAS COMME LES QUATRE AUTRES, ET IL FAUT LE DIRE ────────
  //
  // Les quatre ci-dessus partagent un trait : c'est le MEMBRE qui déclenche,
  // sur SA machine, à sa propre demande. Celle-ci non — la pose est déclenchée
  // depuis le tableau de bord, par quelqu'un d'autre. C'est la contrepartie
  // que le propriétaire a explicitement acceptée en choisissant que le bouton
  // LANCE au lieu d'afficher.
  //
  // Pourquoi elle ne s'enveloppe pas quand même : une installation GLOBALE
  // doit atteindre l'hôte. L'isoler produirait un outil posé dans un bac qui
  // disparaît à la fin — c'est-à-dire un bouton qui ment.
  //
  // Ce qui reste vrai, et qui borne : le binaire (`npm`) et le paquet viennent
  // du CATALOGUE du dépôt, jamais de la requête. Ce qui reste ouvert, et qui
  // n'est pas caché : `npm install` exécute les scripts `postinstall` du
  // paquet, donc du code du registre, sur la machine du membre.
  'node-client/pose-runner.ts':
    'pose un outil du catalogue sur la machine du membre — une installation ' +
    'globale doit atteindre l’hôte, l’envelopper la rendrait sans effet ; le ' +
    'binaire et le paquet viennent du catalogue, jamais de la requête',
  // ─── LA PRIMITIVE, PAS UN APPELANT ─────────────────────────────────────────
  //
  // `lancerArbre` est le `spawn` des agents, des merges, des chantiers, des
  // validations et des poses d'outils : il lance ce qu'on lui tend, DÉJÀ
  // enveloppé. La garde ne perd rien à l'inscrire ici, parce qu'elle juge
  // `lancerArbre(` comme `spawn(` chez chacun de ses appelants
  // (`fichiersQuiLancent`) : un appelant qui oublierait l'enveloppe rougit
  // comme avant.
  // ─── LE SUPERVISEUR DE LA RUCHE ────────────────────────────────────────────
  //
  // Il lance les PIÈCES de Hive elles-mêmes — la Reine, les ouvrières, l'écran
  // Vite —, pour `npm run ruche` comme pour l'application de bureau. C'est le
  // code que `scripts/ruche.mjs` portait (hors de `src/`, donc hors de cette
  // garde) ; il n'a pas changé de nature en changeant de dossier. Ce ne sont
  // pas des agents : chaque ouvrière enveloppe elle-même TOUT ce qu'elle lance.
  'ruche-superviseur.ts':
    'lance les pièces de Hive (Reine, ouvrières, écran) sur la machine de ' +
    'l’hôte, à sa demande — chaque ouvrière enveloppe elle-même les agents ' +
    'qu’elle lance ; envelopper la Reine la couperait de sa base',
  // ─── LE RELAIS DU RÉSEAU FILTRÉ ──────────────────────────────────────────────
  //
  // Le `spawn` de ce fichier n'est pas un appel : il vit dans `SOURCE_RELAIS`,
  // le texte du programme que le nœud ÉCRIT pour le bac, et qui s'exécute DANS
  // le bac, derrière l'enveloppe (`commandeDansBac`, isolement.ts). Rien ici ne
  // lance de processus sur l'hôte.
  'node-client/proxy-egress.ts':
    'le spawn est dans le texte du relais écrit pour le bac — il s’exécute DANS ' +
    'le bac, derrière envelopper(), jamais sur l’hôte',
  'shared/arbre-processus.ts':
    'la primitive qui lance un arbre de processus : elle exécute ce que ses ' +
    'appelants ont préparé et enveloppé — chacun d’eux est jugé ici sur son ' +
    'propre appel à lancerArbre(), comme sur un spawn()',
};

/**
 * Retire les commentaires — sinon un fichier qui se contente de PARLER de
 * `spawn` est accusé de le faire. `shell.ts` documente en tête la commande
 * qu'il délègue, et se retrouvait dénoncé pour une phrase.
 */
function sansCommentaires(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');
}

/**
 * Tous les `.ts` sous `src/`, à la main.
 *
 * `globSync` de `node:fs` n'existe qu'à partir de Node 22 ; le projet annonce
 * Node ≥ 24 et l'intégration continue y tourne. Un test qui ne s'exécute que
 * sur la machine de son auteur ne garde rien.
 */
function fichiersTs(dossier = '', acc: string[] = []): string[] {
  for (const entree of readdirSync(RACINE + dossier, { withFileTypes: true })) {
    const rel = dossier === '' ? entree.name : `${dossier}/${entree.name}`;
    if (entree.isDirectory()) fichiersTs(rel, acc);
    else if (rel.endsWith('.ts')) acc.push(rel);
  }
  return acc;
}

/**
 * Les fichiers du dépôt qui lancent réellement un processus : par `spawn`, ou
 * par `lancerArbre` (`shared/arbre-processus.ts`), qui est un `spawn` de plus
 * haut niveau. Sans la seconde forme, `exec.ts` et `merge-runner.ts` — les deux
 * lanceurs de code étranger — seraient sortis de la garde le jour où ils ont
 * cessé d'appeler `spawn` eux-mêmes.
 */
function fichiersQuiLancent(): { chemin: string; source: string }[] {
  return fichiersTs()
    .map((rel) => ({ chemin: rel, source: readFileSync(RACINE + rel, 'utf8') }))
    .filter(({ source }) => /\b(?:spawn|lancerArbre)\s*\(/.test(sansCommentaires(source)));
}

describe('la couverture du bac à sable', () => {
  it('méta-test : on trouve bien des spawn à juger', () => {
    expect(fichiersQuiLancent().length).toBeGreaterThan(3);
  });

  it('les deux lanceurs de code étranger sont jugés — par `lancerArbre`', () => {
    const juges = fichiersQuiLancent().map((f) => f.chemin);
    expect(juges).toContain('adapters/exec.ts');
    expect(juges).toContain('node-client/merge-runner.ts');
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
    expect(MERGE, 'le clone est le répertoire monté').toContain('optionsEnveloppe(bac, cwd)');
  });

  it('le client transmet SON bac au merge — sinon l’option ne sert à rien', () => {
    const CLIENT = readFileSync(
      fileURLToPath(new URL('../src/node-client/client.ts', import.meta.url)),
      'utf8',
    );
    const corps = CLIENT.slice(CLIENT.indexOf('runMerge({'));
    expect(corps.slice(0, 400)).toContain('this.optionBacTache()');
  });
});
