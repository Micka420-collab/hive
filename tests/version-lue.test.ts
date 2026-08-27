// LIRE LE COMMIT DEPUIS `.git`, SANS LANCER `git`.
//
// Le hub ne lance `git` nulle part ; lui donner cette capacité pour répondre à
// « quelle version fais-tu tourner ? » serait cher payé. Les deux fichiers lus
// ici sont du texte, et la réponse y est écrite.
//
// Ces bancs montent de VRAIS dossiers `.git` sur disque — pas des bouchons de
// `fs`. Un bouchon dirait ce que je crois de git ; un dossier réel dit ce que
// git écrit vraiment.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lireVersionRuche } from '../src/orchestrator/version-lue.js';

const SHA = '82f045c9e1a4b7d3f608c2e5a9b1d4f7c0e3a6b9';
const AUTRE = 'aa11bb22cc33dd44ee55ff66aa77bb88cc99dd00';

let racine: string;

beforeEach(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-version-'));
});
afterEach(() => {
  rmSync(racine, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Écrit un fichier sous `.git`, en créant les dossiers manquants. */
function git(relatif: string, contenu: string): void {
  const cible = path.join(racine, '.git', ...relatif.split('/'));
  mkdirSync(path.dirname(cible), { recursive: true });
  writeFileSync(cible, contenu);
}

describe('un clone git ordinaire', () => {
  it('LE COMMIT ET LA BRANCHE SONT LUS', () => {
    git('HEAD', 'ref: refs/heads/main\n');
    git('refs/heads/main', `${SHA}\n`);
    expect(lireVersionRuche(racine, '0.2.0')).toEqual({
      commit: SHA,
      branche: 'main',
      declaree: '0.2.0',
    });
  });

  it('une branche au nom composé passe aussi', () => {
    git('HEAD', 'ref: refs/heads/claude/hive-site-launch\n');
    git('refs/heads/claude/hive-site-launch', `${SHA}\n`);
    const v = lireVersionRuche(racine, '0.2.0');
    expect(v.branche).toBe('claude/hive-site-launch');
    expect(v.commit).toBe(SHA);
  });
});

describe('après un `git gc` — la référence part dans `packed-refs`', () => {
  it('LE REPLI TROUVE CE QUE LE FICHIER LÂCHE NE PORTE PLUS', () => {
    // Sans ce repli, une ruche parfaitement saine répondrait « je ne sais
    // pas » du jour où git a fait son ménage — sans que personne n'ait rien
    // changé. C'est le genre de panne qu'on cherche longtemps.
    git('HEAD', 'ref: refs/heads/main\n');
    git(
      'packed-refs',
      `# pack-refs with: peeled fully-peeled sorted\n${AUTRE} refs/remotes/origin/main\n${SHA} refs/heads/main\n`,
    );
    expect(lireVersionRuche(racine, '0.2.0')).toEqual({
      commit: SHA,
      branche: 'main',
      declaree: '0.2.0',
    });
  });

  it('les commentaires et les lignes PELÉES ne troublent pas la lecture', () => {
    // Ce que ce banc tient VRAIMENT : la ligne pelée `^<sha>` n'a pas
    // d'espace, donc la garde « pas d'espace ⇒ on passe » l'écarte. J'avais
    // d'abord écrit un filtre `startsWith('^')` en plus, et l'avoir ôté ne
    // faisait rougir personne — il était mort. Le banc dit désormais le
    // MÉCANISME qui protège, pas celui que je croyais avoir écrit.
    git('HEAD', 'ref: refs/heads/main\n');
    git('packed-refs', `# commentaire\n${AUTRE} refs/tags/v1\n^${SHA}\n${SHA} refs/heads/main\n`);
    expect(lireVersionRuche(racine, '0.2.0').commit).toBe(SHA);
  });

  it('LA COMPARAISON EST EXACTE — « main » n’attrape pas « main-old »', () => {
    // Une comparaison par PRÉFIXE rendrait le sha de la première branche dont
    // le nom commence pareil. Mesuré : sans ce banc, remplacer l'égalité par
    // un `startsWith` ne faisait rougir personne — et une ruche aurait
    // annoncé le commit d'une branche qu'elle ne fait pas tourner.
    git('HEAD', 'ref: refs/heads/main\n');
    git('packed-refs', `${AUTRE} refs/heads/main-old\n${SHA} refs/heads/main\n`);
    expect(lireVersionRuche(racine, '0.2.0').commit).toBe(SHA);
  });

  it('UNE LIGNE MALFORMÉE NE PRÉEMPTE PAS LA BONNE', () => {
    // Trouvé par la loupe : `espace < 0` laissait passer `espace === 0`.
    //
    // Une ligne qui COMMENCE par un espace n'a pas de sha devant : découpée à
    // l'index 0, sa partie gauche est vide et sa partie droite ressemble à la
    // référence cherchée. La boucle croyait donc l'avoir trouvée, rendait
    // `sha('')` — c'est-à-dire `null` — et s'ARRÊTAIT LÀ. La bonne ligne, deux
    // lignes plus bas, n'était jamais lue.
    //
    // Le résultat était le pire des deux : une ruche parfaitement saine
    // répondant « je ne sais pas quel commit je fais tourner », pour un
    // catalogue à peine de travers. C'est exactement la panne que ce repli
    // existe pour éviter.
    git('HEAD', 'ref: refs/heads/main\n');
    git('packed-refs', ` refs/heads/main\n${SHA} refs/heads/main\n`);
    expect(lireVersionRuche(racine, '0.2.0').commit).toBe(SHA);
  });

  it('une référence ABSENTE du catalogue ne rend rien d’inventé', () => {
    git('HEAD', 'ref: refs/heads/absente\n');
    git('packed-refs', `${SHA} refs/heads/main\n`);
    const v = lireVersionRuche(racine, '0.2.0');
    expect(v.commit).toBeNull();
    // …et la branche non plus : annoncer « sur absente » sans commit serait
    // une demi-vérité qui se lirait comme une version.
    expect(v.branche).toBeNull();
  });
});

describe('la tête détachée — un déploiement épinglé', () => {
  it('LE SHA EST DANS `HEAD`, ET IL N’Y A PAS DE BRANCHE', () => {
    git('HEAD', `${SHA}\n`);
    const v = lireVersionRuche(racine, '0.2.0');
    expect(v.commit).toBe(SHA);
    expect(v.branche, 'ne pas inventer un nom de branche').toBeNull();
  });
});

describe('tout ce qui peut échouer, et qui rend « je ne sais pas »', () => {
  it('AUCUN `.git` — archive ou image de conteneur', () => {
    expect(lireVersionRuche(racine, '0.2.0')).toEqual({
      commit: null,
      branche: null,
      declaree: '0.2.0',
    });
  });

  it('`HEAD` illisible ou farfelu', () => {
    git('HEAD', 'ceci n’est pas une tête\n');
    expect(lireVersionRuche(racine, '0.2.0').commit).toBeNull();
  });

  it('une référence dont le contenu N’EST PAS un sha', () => {
    // Un fichier édité à la main, un `.git` tronqué. On vérifie la FORME
    // plutôt que de faire confiance : un texte quelconque affiché comme
    // commit serait une fausse version.
    git('HEAD', 'ref: refs/heads/main\n');
    git('refs/heads/main', 'bonjour\n');
    expect(lireVersionRuche(racine, '0.2.0').commit).toBeNull();
  });

  it('un sha TRONQUÉ n’est pas accepté', () => {
    git('HEAD', 'ref: refs/heads/main\n');
    git('refs/heads/main', '82f045c\n');
    expect(lireVersionRuche(racine, '0.2.0').commit).toBeNull();
  });

  it('RIEN NE LÈVE — la route qui appelle ne doit jamais tomber', () => {
    // `.git` en DOSSIER là où `HEAD` est attendu en fichier : `readFileSync`
    // lève un EISDIR. La lecture doit l'absorber comme le reste.
    mkdirSync(path.join(racine, '.git', 'HEAD'), { recursive: true });
    expect(() => lireVersionRuche(racine, '0.2.0')).not.toThrow();
    expect(lireVersionRuche(racine, '0.2.0').commit).toBeNull();
  });

  it('la version déclarée est TOUJOURS rendue, même quand tout échoue', () => {
    expect(lireVersionRuche(racine, '9.9.9').declaree).toBe('9.9.9');
  });
});
