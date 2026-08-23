// L'HORLOGE EST-ELLE CÂBLÉE, OU SEULEMENT ÉCRITE ?
//
// ─── LE DÉFAUT QUE CE FICHIER EXISTE POUR EMPÊCHER ───────────────────────────
//
// Ce dépôt l'a déjà commis, et il l'a documenté : « TROIS BORNES ÉCRITES,
// JAMAIS APPELÉES » (lot 46). Le code existait, les bancs passaient, et la base
// grossissait quand même — personne n'invoquait les élagueurs.
//
// L'horloge du chantier présentait exactement la même surface : un module pur
// qui juge, des méthodes de magasin qui enregistrent, et RIEN qui les appelle.
// Une horloge que personne ne remonte donne l'heure d'hier.
//
// ─── POURQUOI ON RETIRE LES COMMENTAIRES ─────────────────────────────────────
//
// `tests/bornes-doctrine.test.ts` a payé cette leçon : une garde de source qui
// lit le texte BRUT accepte une ligne morte comme preuve de vie. Elle rassure
// précisément au moment où l'appel vient d'être commenté à la main — le geste
// le plus courant d'un débogage qu'on oublie de défaire.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

/** Le serveur SANS ses commentaires : un appel commenté n'appelle rien. */
const SERVEUR = readFileSync(new URL('../src/orchestrator/server.ts', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
  .join('\n');

describe('l’annonce est écrite au moment où elle est faite', () => {
  it('`enregistrerAnnonce` est APPELÉE, pas seulement définie', () => {
    expect(SERVEUR, 'une horloge que personne ne remonte donne l’heure d’hier').toContain(
      'store.enregistrerAnnonce(',
    );
  });

  it('l’estimation est calculée par le module, pas réinventée sur place', () => {
    expect(SERVEUR).toContain('estimerDuree(store.historiqueDurees()');
  });

  // ─── LA PORTE UNIQUE ──────────────────────────────────────────────────────
  //
  // `envoyerTache` porte déjà cette règle pour le cadre du polyéthisme et le
  // contexte du Cerveau : « deux portes, c'est une porte qu'on oublie de
  // garder ». L'annonce suit la même règle — un second site d'appel serait un
  // site qu'on oublie de mettre à jour.
  it('elle est posée dans la porte UNIQUE vers les ouvrières', () => {
    const porte = SERVEUR.indexOf('const envoyerTache =');
    expect(
      porte,
      '`envoyerTache` est introuvable — la garde ne sait plus où regarder',
    ).toBeGreaterThan(-1);
    const suivante = SERVEUR.indexOf('const scheduler = new Scheduler', porte);
    expect(suivante).toBeGreaterThan(porte);
    const corps = SERVEUR.slice(porte, suivante);
    expect(corps).toContain('store.enregistrerAnnonce(');
    // Et NULLE PART ailleurs : un second appel serait une seconde porte.
    const total = [...SERVEUR.matchAll(/store\.enregistrerAnnonce\(/g)].length;
    expect(total, 'un seul site d’appel, sinon la règle de la porte unique tombe').toBe(1);
  });

  it('la caste est figée à l’annonce — `casteDe` est appelée là, pas relue après', () => {
    const porte = SERVEUR.indexOf('const envoyerTache =');
    const corps = SERVEUR.slice(porte, SERVEUR.indexOf('const scheduler = new Scheduler', porte));
    expect(corps).toMatch(/store\.enregistrerAnnonce\(\s*task\.id,\s*nodeId,\s*casteDe\(nodeId\)/);
  });
});

describe('l’alerte hors-domaine est câblée dans le tick', () => {
  // Une tâche qui court depuis plus longtemps que TOUT ce que la ruche a
  // observé n'est pas « presque finie » : il n'existe plus une seule
  // observation comparable. C'est l'instant précis où un humain a besoin
  // d'être prévenu — et celui où un compte à rebours afficherait « bientôt ».
  it('`resteEstime` est APPELÉE, pas seulement importée', () => {
    expect(SERVEUR).toContain('resteEstime(histoire,');
    expect(SERVEUR).toContain("motif !== 'hors_domaine'");
  });

  it('elle émet un événement que la Chronique peut montrer', () => {
    expect(SERVEUR).toContain("emitEvent('duree_hors_domaine'");
  });

  // ─── UN SIGNAL RÉPÉTÉ CESSE D'ÊTRE UN SIGNAL ──────────────────────────────
  //
  // Le tick repasse toutes les quelques secondes. Sans mémoire, la même tâche
  // déclencherait le même avertissement des centaines de fois et noierait la
  // Chronique — l'exact opposé de ce qu'une alerte doit faire.
  it('elle ne se répète pas : la mémoire existe et garde l’avertissement', () => {
    expect(SERVEUR).toContain('const horsDomaineDits = new Set<string>()');
    expect(SERVEUR).toContain('if (horsDomaineDits.has(enVol.taskId)) continue;');
    expect(SERVEUR).toContain('horsDomaineDits.add(enVol.taskId);');
  });

  // ─── ET CETTE MÉMOIRE EST BORNÉE ──────────────────────────────────────────
  //
  // La ruche tourne des mois. Un `Set` qui ne se vide jamais est une fuite,
  // exactement comme une table sans élagueur — la doctrine des bornes vaut
  // aussi pour ce qui vit en mémoire. Ses voisines `contextesRelivres` et
  // `derniereRelivraison` portent déjà la même purge.
  it('la mémoire est PURGÉE des tâches qui ont atterri', () => {
    expect(SERVEUR).toContain('for (const id of horsDomaineDits) if (!encore.has(id))');
    expect(SERVEUR).toContain('horsDomaineDits.delete(id)');
  });
});

describe('la borne de la table neuve est câblée, pas seulement écrite', () => {
  // Même exigence que la doctrine des bornes, appliquée à `annonces_duree` :
  // elle grossit d'une ligne par tâche assignée, donc sous la MACHINE.
  it('`pruneAnnonces` est appelée dans le tick', () => {
    expect(SERVEUR).toContain('store.pruneAnnonces(');
  });

  it('elle reçoit une rétention nommée, pas un nombre posé là', () => {
    expect(SERVEUR).toMatch(/store\.pruneAnnonces\(ANNONCES_RETENTION_MS\)/);
    expect(SERVEUR).toMatch(/const ANNONCES_RETENTION_MS = /);
  });
});
