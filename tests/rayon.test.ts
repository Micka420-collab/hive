// Le Rayon — et la seule chose qui décide si on peut le publier.
//
// Servir des fichiers depuis un chemin fourni par le client est LA faille
// classique du web. Une seule erreur, et `?chemin=../../.env` sort le secret de
// la ruche par la même route que le code du projet. Ce tableau de bord se
// partage en lecture par un tunnel PUBLIC : l'appelant est hostile par
// hypothèse, pas par pessimisme.
//
// Ce fichier teste les sept contournements nommés dans l'en-tête du module,
// plus ceux qu'on trouve en essayant vraiment de passer. Le plus important
// n'est pas `..` — que tout le monde ferme — mais le BUG DE PRÉFIXE, qu'on
// introduit précisément en croyant refermer la faille.

import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  DOSSIERS_INTERDITS,
  FICHIERS_INTERDITS,
  LONGUEUR_MAX_CHEMIN,
  cheminDemande,
  dansLeRayon,
  estBinaire,
  estInterdit,
  langageDe,
  trierEntrees,
  type Entree,
} from '../src/shared/rayon.js';

const refusDe = (brut: string): string => {
  const v = cheminDemande(brut);
  return v.ok ? 'ACCEPTÉ' : v.refus;
};

describe('la traversée de répertoire, sous toutes ses formes', () => {
  it('`..` EST REFUSÉ, y compris mêlé à des segments valides', () => {
    for (const tentative of [
      '..',
      '../',
      '../etc/passwd',
      '../../../../etc/passwd',
      'src/../../etc/passwd',
      'a/b/../../../c',
      './../../x',
      'src/./../../x',
    ]) {
      expect(refusDe(tentative), tentative).toBe('traversee');
    }
  });

  it('les séparateurs Windows ne sont pas une échappatoire', () => {
    // Un dépôt cloné sous Windows n'a pas d'autres chemins, seulement une autre
    // façon de les écrire — mais un attaquant, lui, essaiera les deux.
    for (const tentative of ['..\\etc', 'src\\..\\..\\x', '..\\..\\.env']) {
      expect(refusDe(tentative), tentative).toBe('traversee');
    }
  });

  it('LES CHEMINS ABSOLUS SONT REFUSÉS — POSIX, Windows et UNC', () => {
    for (const tentative of [
      '/etc/passwd',
      '/',
      'C:\\Windows\\System32',
      'c:/windows',
      '\\\\serveur\\partage\\x',
      '//serveur/partage/x',
    ]) {
      expect(refusDe(tentative), tentative).toBe('absolu');
    }
  });

  it('L’OCTET NUL EST REFUSÉ AVANT TOUT LE RESTE', () => {
    // `fichier.txt\0.png` passe les vérifications d'extension côté JavaScript,
    // puis les couches C tronquent à `\0` : ce qui est OUVERT n'est pas ce qui
    // a été VÉRIFIÉ. Il n'existe aucun usage légitime.
    expect(refusDe('src/index.ts\0.png')).toBe('octet_nul');
    expect(refusDe('\0')).toBe('octet_nul');
    // …et avant même la traversée, pour que le motif ne masque pas la cause.
    expect(refusDe('../x\0')).toBe('octet_nul');
  });

  it('un chemin démesuré est une tentative, pas un chemin', () => {
    expect(refusDe('a/'.repeat(LONGUEUR_MAX_CHEMIN))).toBe('trop_long');
  });

  it('le vide et le bruit ne deviennent pas la racine', () => {
    for (const rien of ['', '   ', '.', './', './.']) {
      expect(refusDe(rien), JSON.stringify(rien)).toBe('vide');
    }
  });
});

describe('ce qu’on ne sert jamais', () => {
  it('`.git` EST FERMÉ — il contient l’URL distante, identifiants compris', () => {
    // C'est le refus le plus important du fichier : `.git/config` porte
    // `https://user:ghp_…@github.com/…` quand le dépôt est privé.
    for (const tentative of ['.git', '.git/config', 'src/.git/config', '.GIT/config']) {
      expect(refusDe(tentative), tentative).toBe('interdit');
    }
  });

  it('les fichiers de secrets sont fermés, dans tout le dépôt', () => {
    for (const tentative of [
      '.env',
      'app/.env',
      '.env.production',
      '.env.n-importe-quoi',
      'cle.pem',
      'certs/serveur.key',
      'deploy/id_rsa',
      '.npmrc',
    ]) {
      expect(refusDe(tentative), tentative).toBe('interdit');
    }
  });

  it('`node_modules` est fermé — inutile et énorme', () => {
    expect(refusDe('node_modules/react/index.js')).toBe('interdit');
  });

  it('LE VOISINAGE LÉGITIME N’EST PAS FERMÉ POUR AUTANT', () => {
    // Une garde qui refuse `environnement.ts` ou `gitignore.md` rend le rayon
    // inutilisable, et c'est aussi grave qu'une garde trop laxiste : on ne
    // consulte pas un lecteur de code qui cache des fichiers au hasard.
    for (const legitime of [
      'src/environnement.ts',
      'docs/gitignore.md',
      '.gitignore',
      '.github/workflows/ci.yml',
      'src/keyboard.ts',
      'src/monkey.ts',
      'README.md',
      'src/orchestrator/server.ts',
    ]) {
      const v = cheminDemande(legitime);
      expect(v.ok, `${legitime} devrait passer`).toBe(true);
    }
  });

  it('les listes sont écrites en minuscules — sinon elles ne matchent jamais', () => {
    for (const d of DOSSIERS_INTERDITS) expect(d).toBe(d.toLowerCase());
    for (const f of FICHIERS_INTERDITS) expect(f).toBe(f.toLowerCase());
  });

  it('estInterdit est insensible à la casse', () => {
    expect(estInterdit('.ENV')).toBe(true);
    expect(estInterdit('Node_Modules')).toBe(true);
    expect(estInterdit('CLE.PEM')).toBe(true);
  });
});

describe('le chemin rendu est normalisé, et relatif', () => {
  it('les segments vides et `.` disparaissent', () => {
    const v = cheminDemande('src//orchestrator/./server.ts');
    expect(v.ok && v.relatif).toBe('src/orchestrator/server.ts');
  });

  it('les séparateurs Windows sont ramenés à `/`', () => {
    const v = cheminDemande('src\\shared\\rayon.ts');
    expect(v.ok && v.relatif).toBe('src/shared/rayon.ts');
  });

  it('IL N’EST JAMAIS ABSOLU — pour forcer la seconde vérification', () => {
    // Rendre un absolu inviterait à s'en servir tel quel, sans repasser par
    // `dansLeRayon` une fois les liens résolus — et c'est cette seconde
    // vérification qui attrape les liens symboliques.
    const v = cheminDemande('src/index.ts');
    expect(v.ok && path.isAbsolute(v.relatif)).toBe(false);
  });
});

describe('LE BUG DE PRÉFIXE — l’erreur qu’on introduit en corrigeant la faille', () => {
  const racine = path.resolve('/srv/rayon');

  it('`/srv/rayon-mechant` N’EST PAS dans `/srv/rayon`', () => {
    // `'/srv/rayon-mechant'.startsWith('/srv/rayon')` est VRAI. Sans exiger le
    // séparateur, tout un répertoire voisin sort par la même route.
    expect(dansLeRayon(racine, path.resolve('/srv/rayon-mechant/secret'))).toBe(false);
    expect(dansLeRayon(racine, path.resolve('/srv/rayon2'))).toBe(false);
    expect(dansLeRayon(racine, path.resolve('/srv/rayonnage/x'))).toBe(false);
  });

  it('ce qui est dedans est bien dedans, la racine comprise', () => {
    expect(dansLeRayon(racine, racine)).toBe(true);
    expect(dansLeRayon(racine, path.resolve('/srv/rayon/src/index.ts'))).toBe(true);
    expect(dansLeRayon(racine, path.resolve('/srv/rayon/a/b/c/d.ts'))).toBe(true);
  });

  it('un chemin qui remonte hors du rayon est vu, même déjà résolu', () => {
    // C'est le cas d'un LIEN SYMBOLIQUE : `realpath` a déjà rendu la cible
    // réelle, et c'est elle qu'on compare.
    expect(dansLeRayon(racine, path.resolve('/etc/passwd'))).toBe(false);
    expect(dansLeRayon(racine, path.resolve('/srv'))).toBe(false);
  });

  it('une racine avec séparateur final se compare pareil', () => {
    expect(dansLeRayon(`${racine}${path.sep}`, path.resolve('/srv/rayon/x'))).toBe(true);
    expect(dansLeRayon(`${racine}${path.sep}`, path.resolve('/srv/rayon-mechant'))).toBe(false);
  });
});

describe('afficher ce qu’on a lu', () => {
  it('reconnaît les langages courants, et retombe sur du texte', () => {
    expect(langageDe('src/a.ts')).toBe('typescript');
    expect(langageDe('src/a.TSX')).toBe('typescript');
    expect(langageDe('page.html')).toBe('html');
    expect(langageDe('LICENSE')).toBe('texte');
    expect(langageDe('Makefile')).toBe('texte');
  });

  it('LE BINAIRE EST RECONNU — on ne déverse pas une image dans un éditeur', () => {
    expect(estBinaire(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x0d]))).toBe(true);
    expect(estBinaire(new TextEncoder().encode('const a = 1;\n'))).toBe(false);
    expect(estBinaire(new Uint8Array())).toBe(false);
  });

  it('du texte accentué n’est pas pris pour du binaire', () => {
    // L'UTF-8 des accents n'a rien d'un octet nul : le confondre rendrait
    // illisible la moitié d'un dépôt francophone.
    expect(estBinaire(new TextEncoder().encode('les abeilles butinent — déjà'))).toBe(false);
  });

  it('les dossiers d’abord, puis l’ordre d’un humain francophone', () => {
    const e = (nom: string, type: Entree['type']): Entree => ({
      chemin: nom,
      nom,
      type,
      taille: 0,
    });
    const trie = trierEntrees([
      e('Zèbre.ts', 'fichier'),
      e('abeille.ts', 'fichier'),
      e('src', 'dossier'),
      e('Élan.ts', 'fichier'),
      e('docs', 'dossier'),
    ]);
    expect(trie.map((x) => x.nom)).toEqual(['docs', 'src', 'abeille.ts', 'Élan.ts', 'Zèbre.ts']);
  });

  it('le tri ne modifie pas la liste reçue', () => {
    const liste: Entree[] = [
      { chemin: 'b', nom: 'b', type: 'fichier', taille: 0 },
      { chemin: 'a', nom: 'a', type: 'fichier', taille: 0 },
    ];
    trierEntrees(liste);
    expect(liste.map((x) => x.nom)).toEqual(['b', 'a']);
  });
});
