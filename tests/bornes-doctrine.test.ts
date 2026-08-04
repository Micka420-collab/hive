// LA DOCTRINE DES BORNES, TENUE PAR UNE GARDE PLUTÔT QUE PAR LA DISCIPLINE.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// `server.ts` porte la règle, écrite noir sur blanc au-dessus de sa boucle
// d'élagage :
//
//     doctrine, règle 3 : une table nouvelle arrive avec sa borne d'élagage,
//     et la borne est CÂBLÉE, pas seulement écrite.
//
// Elle est juste. Elle a aussi été violée DEUX FOIS, et de deux façons
// différentes — ce qui est précisément ce qu'on attend d'une règle que rien
// n'applique :
//
//   1. TROIS BORNES ÉCRITES, JAMAIS APPELÉES (lot 46). Le code existait, les
//      tests passaient, et la base grossissait quand même : personne
//      n'invoquait les élagueurs depuis la boucle du serveur.
//   2. UNE TABLE SANS AUCUNE BORNE. `tasks` — la table la plus écrite du
//      dépôt — n'avait pas d'élagueur du tout. Pire : deux bornes
//      référentielles voisines se justifiaient par « les tâches ont déjà leur
//      propre élagage », ce qui était faux, et mesuré comme tel : sur 2 000
//      tâches, elles supprimaient 0 ligne, pour toujours.
//
// Une garde qui ne vérifierait que le premier cas n'aurait pas vu le second, et
// réciproquement. Ce fichier vérifie les DEUX.
//
// ─── POURQUOI UNE LISTE D'EXCEPTIONS PLUTÔT QU'UNE RÈGLE ABSOLUE ─────────────
//
// Toutes les tables n'ont pas à être élaguées, et l'exiger rendrait la garde
// fausse — donc contournée. Ce qui distingue les deux familles n'est pas la
// taille mais la CAUSE de la croissance :
//
//   · une table qui grossit sous le geste d'un humain (les comptes, les
//     projets, les nœuds qu'on ajoute) est bornée par cet humain ;
//   · une table qui grossit sous la machine (les événements, les résultats,
//     les inspections) n'est bornée par rien, et un processus qui tourne des
//     mois finit par remplir le disque.
//
// L'exception se déclare donc AVEC SON MOTIF. Ce n'est pas une échappatoire :
// c'est ce qui force la personne qui ajoute une table à trancher la question au
// lieu de l'oublier. Une exception sans motif écrit fait rougir ce banc.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
/**
 * Retire commentaires de bloc et de ligne.
 *
 * ─── POURQUOI CETTE FONCTION EXISTE, ET CE QU'ELLE A COÛTÉ ───────────────────
 *
 * La première version de ce fichier cherchait `store.pruneX(` dans le texte BRUT
 * de `server.ts`. Au rejeu — on commente l'appel à `pruneTasks`, exactement le
 * geste du lot 46 — la garde est restée VERTE : le texte était toujours là,
 * simplement mort.
 *
 * Une garde de source qui ne retire pas les commentaires accepte donc une ligne
 * morte comme preuve de vie, et c'est le pire des cas de figure : elle rassure
 * précisément quand la borne vient d'être désactivée à la main, ce qui est le
 * geste le plus courant d'un débogage qu'on oublie de défaire.
 */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
    .join('\n');
}

const STORE = readFileSync(path.join(RACINE, 'src', 'orchestrator', 'store.ts'), 'utf8');
/** Le serveur SANS ses commentaires : un appel commenté n'appelle rien. */
const SERVEUR = sansCommentaires(
  readFileSync(path.join(RACINE, 'src', 'orchestrator', 'server.ts'), 'utf8'),
);

/**
 * Les tables dont la croissance est bornée par un HUMAIN, avec le motif.
 *
 * Le motif n'est pas décoratif : c'est lui qu'on relit le jour où l'on se
 * demande si la ligne est encore vraie. « Une ligne par projet » cesse d'être
 * rassurant le jour où la ruche crée des projets toute seule.
 */
const BORNÉES_PAR_L_HUMAIN: Record<string, string> = {
  users: 'une ligne par personne inscrite',
  user_roles: 'une ligne par rôle attribué à une personne',
  project_members: 'une ligne par personne rattachée à un projet',
  projects: 'une ligne par projet créé à la main',
  nodes: 'une ligne par machine qui rejoint la ruche',
  node_keys: 'une clé par machine — supprimée avec elle',
  machines_noeuds: 'une ligne par machine provisionnée',
  modeles_noeuds:
    'une liste de modèles par machine — clé primaire nodeId, écrasée à la ré-inscription',
  abonnements: 'une ligne par compte abonné',
  budgets: 'un plafond par projet',
  essaim: 'clé primaire `projectId` — une seule ligne par projet, par construction',
  garde_fous:
    'clé primaire `projectId` — un consentement humain (opt-in + bornes), une seule ligne par projet',
  balance_ledger_cache:
    'cache reconstructible, une ligne par projet AYANT DÉPENSÉ ; sa perte se rattrape',
};

/** Le corps de chaque méthode `prune*` du magasin, accolades suivies. */
function elagueurs(): Map<string, string> {
  const lignes = STORE.split('\n');
  const out = new Map<string, string>();
  let i = 0;
  while (i < lignes.length) {
    const m = /^ {2}(prune[A-Za-z]+)\(/.exec(lignes[i] ?? '');
    if (m?.[1]) {
      let prof = 0;
      const corps: string[] = [];
      let j = i;
      for (; j < lignes.length; j++) {
        const l = lignes[j] ?? '';
        corps.push(l);
        prof += (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);
        if (prof <= 0 && j > i) break;
      }
      out.set(m[1], corps.join('\n'));
      i = j;
    }
    i += 1;
  }
  return out;
}

/** Les tables qu'un élagueur ATTEINT — en supprimant, ou en allégeant. */
function tablesAtteintes(corps: string): Set<string> {
  const t = new Set<string>();
  // `pruneResults` n'efface pas ses lignes : il vide `diff` et `logs` et garde
  // le FAIT DATÉ. C'est une borne aussi — la table cesse de grossir en octets.
  for (const m of corps.matchAll(/DELETE FROM ([a-z_]+)/g)) if (m[1]) t.add(m[1]);
  for (const m of corps.matchAll(/UPDATE ([a-z_]+) SET/g)) if (m[1]) t.add(m[1]);
  return t;
}

function tablesCreees(): string[] {
  return [...STORE.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z_]+)/g)]
    .map((m) => m[1])
    .filter((x): x is string => x !== undefined);
}

describe('la doctrine des bornes — règle 3', () => {
  it('CHAQUE ÉLAGUEUR EST APPELÉ PAR LE SERVEUR — écrire une borne ne la câble pas', () => {
    // Le premier défaut historique, dans sa forme exacte : le code existait,
    // les tests passaient, et la base grossissait quand même.
    const jamaisAppeles = [...elagueurs().keys()].filter(
      (nom) => !SERVEUR.includes(`store.${nom}(`),
    );
    expect(
      jamaisAppeles,
      'élagueur(s) définis dans le magasin mais jamais invoqués par `server.ts` : ' +
        'la borne est écrite, pas câblée. Ajoutez l’appel dans la boucle d’élagage.',
    ).toEqual([]);
  });

  it('CHAQUE TABLE EST BORNÉE, OU DÉCLARÉE BORNÉE PAR L’HUMAIN — AVEC son motif', () => {
    // Le second défaut historique : une table sans aucune borne. Une garde qui
    // ne vérifierait que les élagueurs existants ne l'aurait jamais vue.
    const atteintes = new Set<string>();
    for (const corps of elagueurs().values()) {
      for (const t of tablesAtteintes(corps)) atteintes.add(t);
    }

    const sansBorne = tablesCreees().filter(
      (t) => !atteintes.has(t) && !(t in BORNÉES_PAR_L_HUMAIN),
    );
    expect(
      sansBorne,
      'table(s) sans borne d’élagage ET non déclarées bornées par l’humain. ' +
        'Deux issues : ajoutez un élagueur (et CÂBLEZ-le dans `server.ts`), ou ' +
        'inscrivez la table dans `BORNÉES_PAR_L_HUMAIN` avec le motif qui le justifie.',
    ).toEqual([]);
  });

  it('AUCUNE EXCEPTION NE SURVIT À SA TABLE — une liste qui ment est pire que rien', () => {
    // Une exception laissée derrière une table supprimée finit par couvrir une
    // table homonyme recréée plus tard, avec un motif qui ne la concerne pas.
    const creees = new Set(tablesCreees());
    const fantomes = Object.keys(BORNÉES_PAR_L_HUMAIN).filter((t) => !creees.has(t));
    expect(fantomes, 'exception(s) déclarée(s) pour une table qui n’existe plus').toEqual([]);
  });

  it('CHAQUE EXCEPTION PORTE UN MOTIF LISIBLE — pas un espace, pas un « TODO »', () => {
    // Sans cette exigence, la liste deviendrait une simple porte de sortie, et
    // la garde ne forcerait plus personne à trancher.
    for (const [table, motif] of Object.entries(BORNÉES_PAR_L_HUMAIN)) {
      expect(
        motif.trim().length,
        `« ${table} » : motif trop court pour être une raison`,
      ).toBeGreaterThan(15);
      expect(motif.toLowerCase(), `« ${table} » : un TODO n’est pas un motif`).not.toContain(
        'todo',
      );
    }
  });

  it('LA GARDE VOIT RÉELLEMENT LE DÉPÔT — sinon elle serait verte à vide', () => {
    // Le compte qui empêche cette garde de devenir muette : un chemin qui
    // change, un fichier déplacé, une écriture SQL différente, et tout ce qui
    // précède annoncerait « rien à signaler » en n'ayant rien regardé.
    expect(elagueurs().size, 'des élagueurs doivent être trouvés').toBeGreaterThanOrEqual(13);
    expect(tablesCreees().length, 'des tables doivent être trouvées').toBeGreaterThanOrEqual(25);
    expect(SERVEUR.length, '`server.ts` doit être lu').toBeGreaterThan(1000);
  });
});
