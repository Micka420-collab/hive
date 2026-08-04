// L'IDENTITÉ D'UN NŒUD ET SA CLÉ — le premier banc que ce code ait jamais eu.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// La re-mesure de couverture a désigné `src/node-client/join.ts` à 0 %. Pas
// « mal testé » : INTESTABLE. Le fichier finit par `await main()` sans garde,
// donc l'importer ouvrirait un WebSocket et poserait des gestionnaires de
// signal au moment du chargement (§ 2.8 du carnet). Aucun banc ne pouvait le
// toucher, et personne ne s'en apercevait — le compteur de tests montait.
//
// Ce qu'il portait n'est pourtant pas anodin : c'est le PREMIER code qu'un ami
// invité exécute sur SA machine. Trois décisions sortent donc dans
// `identite-noeud.ts`, et sont éprouvées ici sur de vrais fichiers, dans un
// dossier temporaire réel — pas un `fs` simulé, qui prouverait surtout que le
// simulacre fait ce qu'on lui a dit de faire.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  bornerConcurrence,
  cheminCle,
  cheminIdentite,
  CONCURRENCE_MAX,
  CONCURRENCE_MIN,
  CONCURRENCE_PAR_DEFAUT,
  identiteStable,
  lireCle,
  rangerCle,
} from '../src/node-client/identite-noeud.js';
import { ID_PATTERN } from '../src/shared/protocol.js';

let racine = '';

beforeEach(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-identite-'));
});
afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

describe('la concurrence d’un nœud invité', () => {
  it('SANS RIEN DE DEMANDÉ, DEUX TÂCHES DE FRONT', () => {
    expect(bornerConcurrence(undefined)).toBe(CONCURRENCE_PAR_DEFAUT);
  });

  it('LA BORNE BASSE TOMBE PILE — touchée des deux côtés', () => {
    // Zéro serait le pire des réglages : le nœud se connecte, annonce
    // « ✔ Nœud démarré », et n'accepte jamais rien. Une panne qui ressemble
    // à un fonctionnement.
    expect(bornerConcurrence('0'), 'zéro remonte à un').toBe(CONCURRENCE_MIN);
    expect(bornerConcurrence('-5'), 'un négatif aussi').toBe(CONCURRENCE_MIN);
    expect(bornerConcurrence('1'), 'un vaut un').toBe(1);
    expect(bornerConcurrence('2'), 'et deux vaut deux : la borne ne mord pas plus haut').toBe(2);
  });

  it('LA BORNE HAUTE TOMBE PILE — touchée des deux côtés', () => {
    expect(bornerConcurrence('15'), 'sous le plafond, on passe').toBe(15);
    expect(bornerConcurrence('16'), 'pile au plafond, on passe').toBe(CONCURRENCE_MAX);
    expect(bornerConcurrence('17'), 'au-dessus, on rabote').toBe(CONCURRENCE_MAX);
    expect(bornerConcurrence('9999'), 'la machine de l’invité n’est pas un serveur').toBe(
      CONCURRENCE_MAX,
    );
  });

  it('CE QUI N’EST PAS UN NOMBRE RETOMBE SUR LA VALEUR PAR DÉFAUT — jamais sur NaN', () => {
    // La valeur vient d'un humain qui tape dans un terminal. Un `NaN` propagé
    // jusqu'à la boucle de travail donnerait un nœud branché qui ne butine
    // jamais, sans un mot d'explication.
    for (const saisie of ['', '   ', 'beaucoup', 'deux', '#4']) {
      expect(bornerConcurrence(saisie), `« ${saisie} »`).toBe(CONCURRENCE_PAR_DEFAUT);
      expect(Number.isNaN(bornerConcurrence(saisie))).toBe(false);
    }
  });

  it('UN NOMBRE ÉCRIT AVEC DES DÉCIMALES EST LU, PAS REJETÉ', () => {
    // `parseInt` s'arrête au point : quelqu'un qui écrit « 3.9 » obtient 3.
    // Ce n'est pas la valeur par défaut — le réglage est respecté au mieux.
    expect(bornerConcurrence('3.9')).toBe(3);
  });
});

describe('l’identité d’un nœud, d’un redémarrage à l’autre', () => {
  it('LA PREMIÈRE FOIS, ELLE EST FABRIQUÉE ET ÉCRITE', () => {
    const id = identiteStable(racine);
    expect(id, 'elle commence par « node- »').toMatch(/^node-/);
    expect(ID_PATTERN.test(id), 'et le protocole doit l’accepter').toBe(true);
    expect(readFileSync(cheminIdentite(racine), 'utf8')).toBe(id);
  });

  it('LA SECONDE FOIS, C’EST LA MÊME — sinon la ruche accumule des fantômes', () => {
    // Un nœud qui change d'identité à chaque lancement laisse derrière lui une
    // file de nœuds morts que personne ne nettoie, et perd sa place dans la
    // ruche à chaque redémarrage.
    const premiere = identiteStable(racine);
    const seconde = identiteStable(racine);
    expect(seconde).toBe(premiere);
  });

  it('UNE IDENTITÉ QUE LE PROTOCOLE REFUSERAIT EST REMPLACÉE, PAS RECOPIÉE', () => {
    // Le fichier vit sur le disque de l'invité : tronqué par un disque plein,
    // édité à la main, rempli d'espaces. La croire sur parole ferait échouer
    // la connexion avec un message qui ne parlerait jamais du fichier fautif.
    for (const corrompue of ['ceci n’est pas un id', '', '   ', 'a'.repeat(65), 'id/avec/slash']) {
      mkdirSync(racine, { recursive: true });
      writeFileSync(cheminIdentite(racine), corrompue, 'utf8');
      const id = identiteStable(racine);
      expect(id, `« ${corrompue.slice(0, 20)} » ne doit pas être reprise`).not.toBe(corrompue);
      expect(ID_PATTERN.test(id), 'et la remplaçante est valide').toBe(true);
    }
  });

  it('UNE IDENTITÉ VALIDE ENTOURÉE D’ESPACES EST GARDÉE — on ne jette pas pour un retour à la ligne', () => {
    mkdirSync(racine, { recursive: true });
    writeFileSync(cheminIdentite(racine), '  node-abc123\n', 'utf8');
    expect(identiteStable(racine)).toBe('node-abc123');
  });

  it('UN CHEMIN OÙ L’ON NE PEUT RIEN ÉCRIRE NE TUE PAS LE NŒUD', () => {
    // C'est la machine de quelqu'un d'autre : on n'y meurt pas pour un
    // dossier impossible. L'identité vaut alors pour la session en cours.
    //
    // L'obstacle est un FICHIER là où il faudrait un dossier — et pas un
    // `chmod 0o500`, qui ne ferme rien quand la suite tourne en root (elle le
    // fait dans le conteneur de CI, et le banc serait alors vert sans jamais
    // avoir emprunté le chemin dégradé qu'il prétend éprouver).
    const id = identiteStable(cheminBouche());
    expect(ID_PATTERN.test(id), 'une identité utilisable malgré tout').toBe(true);
  });
});

/**
 * Un chemin de travail dans lequel rien ne peut être créé, root compris.
 *
 * `racine/obstacle` est un fichier ordinaire ; demander `racine/obstacle/x`
 * rend `ENOTDIR` sur tous les systèmes et pour tous les comptes.
 */
function cheminBouche(): string {
  const obstacle = path.join(racine, 'obstacle');
  writeFileSync(obstacle, 'je suis un fichier, pas un dossier', 'utf8');
  return path.join(obstacle, 'travail');
}

describe('la clé propre du nœud', () => {
  it('PAS DE FICHIER, PAS DE CLÉ — et ce n’est pas une panne', () => {
    expect(lireCle(racine)).toBeNull();
  });

  it('UN FICHIER VIDE N’EST PAS UNE CLÉ', () => {
    // Rendre `''` ferait présenter le nœud avec une clé vide : la ruche
    // refuserait, et le message parlerait d'authentification au lieu de
    // parler du fichier tronqué.
    mkdirSync(racine, { recursive: true });
    for (const rien of ['', '   ', '\n\n']) {
      writeFileSync(cheminCle(racine), rien, 'utf8');
      expect(lireCle(racine), `« ${JSON.stringify(rien)} »`).toBeNull();
    }
  });

  it('CE QU’ON RANGE, ON LE RELIT', () => {
    rangerCle(racine, 'cle-du-noeud-42');
    expect(lireCle(racine)).toBe('cle-du-noeud-42');
  });

  it('LA CLÉ EST ÉCRITE EN 0600 — une machine peut être partagée', () => {
    // Une clé lisible par tous les comptes de la machine vaut la même clé
    // pour personne : c'est une identité de nœud qu'un autre utilisateur
    // peut endosser sans rien voler d'apparent.
    if (process.platform === 'win32') return; // pas de bits POSIX sur Windows
    rangerCle(racine, 'secrete');
    expect(statSync(cheminCle(racine)).mode & 0o777).toBe(0o600);
  });

  it('UN CHEMIN OÙ L’ON NE PEUT RIEN ÉCRIRE NE TUE PAS LE NŒUD — il faudra un nouveau billet', () => {
    const bouche = cheminBouche();
    expect(() => rangerCle(bouche, 'x')).not.toThrow();
    // Et l'appelant peut le CONSTATER : c'est ainsi que `join.ts` sait qu'il
    // doit prévenir l'invité que sa clé n'a pas survécu au démarrage.
    expect(lireCle(bouche)).toBeNull();
  });

  it('LA CLÉ ET L’IDENTITÉ SONT DEUX FICHIERS DISTINCTS', () => {
    // Les confondre ferait présenter la clé comme identité — donc publier le
    // secret dans chaque message du protocole.
    expect(cheminCle(racine)).not.toBe(cheminIdentite(racine));
    rangerCle(racine, 'secrete');
    const id = identiteStable(racine);
    expect(id).not.toBe('secrete');
    expect(lireCle(racine)).toBe('secrete');
  });
});
