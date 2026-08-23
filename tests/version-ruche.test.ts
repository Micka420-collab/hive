// QUELLE VERSION LA RUCHE FAIT-ELLE TOURNER — et comment passer à la suite.
//
// ─── LE FAIT QUI MANQUAIT ────────────────────────────────────────────────────
//
// « mettre à jour Hive lui-même » supposait deux choses qui n'existaient pas :
// savoir ce qui tourne, et savoir ce qui est disponible. `package.json` annonce
// `0.2.0` et ne bouge jamais ; le dépôt n'a ni étiquette ni version publiée.
//
// Ces bancs tiennent la première moitié — celle dont TOUTES les formes du
// bouton auront besoin, quelle que soit celle qu'on retiendra.

import { describe, expect, it } from 'vitest';
import {
  commitCourt,
  conseilSansGit,
  direVersion,
  marcheASuivre,
  poseDepuis,
  type VersionRuche,
} from '../src/shared/version-ruche.js';

const GIT: VersionRuche = {
  commit: '82f045c9e1a4b7d3f608c2e5a9b1d4f7c0e3a6b9',
  branche: 'main',
  declaree: '0.2.0',
};
const SANS: VersionRuche = { commit: null, branche: null, declaree: '0.2.0' };

describe('le commit raccourci', () => {
  it('sept caractères, jamais moins', () => {
    expect(commitCourt(GIT.commit)).toBe('82f045c');
    expect(commitCourt('abcdef1')).toBe('abcdef1');
  });

  it('RIEN N’EST INVENTÉ quand ce n’est pas un commit', () => {
    // Un `.git/HEAD` illisible, une chaîne tronquée, un fichier édité à la
    // main : on rend `null` plutôt qu'un morceau de texte qui RESSEMBLE à un
    // commit. Une fausse version est pire qu'aucune.
    expect(commitCourt(null)).toBeNull();
    expect(commitCourt('')).toBeNull();
    expect(commitCourt('pas-un-commit')).toBeNull();
    expect(commitCourt('abc')).toBeNull(); // trop court
    expect(commitCourt('ref: refs/heads/main')).toBeNull();
  });

  it('les espaces autour ne trompent pas', () => {
    expect(commitCourt('  82f045c9e1a4  \n')).toBe('82f045c');
  });
});

describe('la pose : clone git, ou autre chose', () => {
  it('un commit lisible ⇒ clone git', () => {
    expect(poseDepuis(GIT)).toBe('git');
  });

  it('pas de commit ⇒ « inconnue », et ce n’est PAS un échec', () => {
    // Archive, image de conteneur : c'est une pose légitime, simplement sans
    // `.git`. Lui inventer un commit serait la faute.
    expect(poseDepuis(SANS)).toBe('inconnue');
  });
});

describe('ce que la ruche RÉPOND sur elle-même', () => {
  it('elle nomme le commit et la branche', () => {
    const fr = direVersion(GIT);
    expect(fr).toContain('82f045c');
    expect(fr).toContain('main');
    expect(fr).toContain('0.2.0');
  });

  it('QUAND ELLE NE SAIT PAS, ELLE LE DIT', () => {
    // Le piège que ce banc ferme : répondre « 0.2.0 » tout court. Ce numéro
    // n'a pas bougé depuis des mois et ne bougera pas au prochain `git pull` —
    // l'annoncer comme LA version serait une fausse certitude, plus nuisible
    // qu'un aveu.
    const fr = direVersion(SANS);
    expect(fr).toContain('ne sait pas');
    expect(fr).toContain('archive');
    const en = direVersion(SANS, 'en');
    expect(en).toContain('does not know');
    expect(en).not.toBe(fr);
  });

  it('sans branche lisible, elle n’en invente pas', () => {
    const sansBranche = direVersion({ ...GIT, branche: null });
    expect(sansBranche).toContain('82f045c');
    expect(sansBranche).not.toContain('sur ');
  });
});

describe('la marche à suivre', () => {
  it('QUATRE PAS, DANS CET ORDRE', () => {
    const pas = marcheASuivre('git');
    expect(pas.map((p) => p[0])).toEqual(['git', 'npm', 'node', 'npm']);
    expect(pas[0]).toEqual(['git', 'pull', '--ff-only']);
    expect(pas[1]).toEqual(['npm', 'ci']);
    expect(pas[3]).toEqual(['npm', 'run', 'build']);
  });

  it('LA SONDE DE `better-sqlite3` EST LÀ — c’est le pas qu’on oublie', () => {
    // Ce dépôt l'a payé : `better-sqlite3` est une dépendance OPTIONNELLE que
    // npm écarte en silence. Sans cette sonde, la mise à jour rend la main sur
    // une ruche qui démarrera MORTE, et personne ne saura pourquoi.
    const pas = marcheASuivre('git');
    const sonde = pas.find((p) => p.join(' ').includes('better-sqlite3'));
    expect(sonde, 'la sonde doit exister').toBeTruthy();
    // Et elle vient APRÈS l'installation, sinon elle sonde l'ancien état.
    const iInstall = pas.findIndex((p) => p.join(' ') === 'npm ci');
    const iSonde = pas.findIndex((p) => p.join(' ').includes('better-sqlite3'));
    expect(iSonde).toBeGreaterThan(iInstall);
    // …et AVANT le build, pour ne pas construire sur une base absente.
    const iBuild = pas.findIndex((p) => p.join(' ') === 'npm run build');
    expect(iSonde).toBeLessThan(iBuild);
  });

  it('`--ff-only` : on ne fabrique pas de fusion dans le dos de quelqu’un', () => {
    // Un `git pull` nu peut créer un commit de fusion sur un dépôt modifié en
    // local. `--ff-only` échoue franchement à la place, et l'humain décide.
    expect(marcheASuivre('git')[0]).toContain('--ff-only');
  });

  it('SANS CLONE GIT, AUCUNE COMMANDE N’EST PROPOSÉE', () => {
    // Lui proposer `git pull` l'enverrait vers une commande qui échoue, et il
    // chercherait pourquoi. On le renvoie à la porte par laquelle il est entré.
    expect(marcheASuivre('inconnue')).toEqual([]);
    expect(conseilSansGit()).toContain('porte d’entrée');
    expect(conseilSansGit('en')).toContain('door you came in');
    expect(conseilSansGit()).not.toContain('git pull');
  });

  it('aucun pas ne passe par un interpréteur — arguments séparés', () => {
    // Discipline du dépôt : `shell: false` partout. Une commande rendue en une
    // seule chaîne finirait tôt ou tard dans un shell.
    for (const pas of marcheASuivre('git')) {
      expect(Array.isArray(pas)).toBe(true);
      expect(pas.length).toBeGreaterThan(1);
      for (const a of pas) {
        expect(a, `« ${a} » ressemble à du shell`).not.toMatch(/[;&|><`$]/);
      }
    }
  });
});
