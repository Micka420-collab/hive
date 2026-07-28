// La détection d'agent — et la branche Windows que rien n'exerçait.
//
// ─── POURQUOI CE FICHIER N'EXISTAIT PAS, ET POURQUOI C'EST LE PROBLÈME ───────
//
// `agent-detect.ts` est le module qui décide si le membre a un vrai agent de
// codage ou s'il faut retomber sur l'adaptateur `shell`, qui est SIMULÉ. Se
// tromper là, c'est envoyer du vrai travail à un binaire qui produit des diffs
// vides — ou refuser un agent parfaitement installé.
//
// Il n'avait aucun test. Aucun. Et sa fonction `candidates()` lisait
// `process.platform` directement, donc sa branche Windows n'était vérifiable
// que sur une machine Windows — c'est-à-dire nulle part, jusqu'à ce que la CI
// y tourne.
//
// C'est comme ça qu'une variante impossible a survécu : la liste commençait par
// `bin.cmd`, alors que `spawn(..., { shell: false })` ne PEUT PAS lancer un
// `.cmd` sous Windows. La ligne avait l'air de couvrir un cas ; elle échouait à
// tous les coups.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { candidates, detectBestAgent } from '../src/node-client/agent-detect.js';

describe('LES VARIANTES DE BINAIRE, PAR PLATEFORME', () => {
  it('sur un système POSIX, le nom est pris tel quel', () => {
    for (const p of ['linux', 'darwin', 'freebsd']) {
      expect(candidates('claude', p), p).toEqual(['claude']);
    }
  });

  it('SOUS WINDOWS, `.exe` D’ABORD — la seule que `spawn` sait lancer', () => {
    expect(candidates('claude', 'win32')).toEqual(['claude.exe', 'claude']);
  });

  it('ET `.cmd` N’Y EST PLUS : il ne pouvait pas aboutir', () => {
    // La garde qui compte. Node refuse d'exécuter un `.cmd` sans interpréteur
    // de commandes — documenté, et durci depuis la CVE-2024-27980. Le remettre
    // rendrait la liste plus longue et pas plus capable : une couverture
    // apparente, qui échoue à tous les coups.
    //
    // Si quelqu'un le rajoute un jour, que ce soit en sachant pourquoi.
    expect(candidates('claude', 'win32')).not.toContain('claude.cmd');
    expect(candidates('codex', 'win32')).not.toContain('codex.cmd');
  });

  it('la plateforme est un PARAMÈTRE, pas une lecture cachée', () => {
    // Sans ce paramètre, tout ce fichier serait impossible : la branche win32
    // ne serait vérifiable que sur Windows. C'est précisément ce qui a laissé
    // la variante `.cmd` en place sans que personne la mette en doute.
    expect(candidates('x', 'win32')).not.toEqual(candidates('x', 'linux'));
  });
});

describe('LE CHOIX DE L’AGENT', () => {
  it('HIVE_AGENT_CMD PRIME SUR TOUT — c’est un choix explicite du membre', async () => {
    const vu = await detectBestAgent({ HIVE_AGENT_CMD: 'mon-ia --run' });
    expect(vu.agent).toBe('custom');
  });

  it('une commande faite d’espaces ne compte pas pour un choix', async () => {
    // `''.trim()` est vide, `'   '.trim()` aussi : une variable posée par
    // accident ne doit pas détourner la détection vers une commande vide.
    const vu = await detectBestAgent({ HIVE_AGENT_CMD: '   ' });
    expect(vu.agent).not.toBe('custom');
  });

  it('LE REPLI `shell` DIT QU’IL EST SIMULÉ — garde sur la source, faute de couture', () => {
    // Ce libellé n'est pas décoratif : `hive doctor` s'en sert pour ne PAS
    // compter `shell` comme un agent détecté. Quelqu'un qui n'a rien installé
    // doit l'entendre, sinon son nœud produit des diffs vides sans que personne
    // comprenne pourquoi.
    //
    // ─── POURQUOI CE TEST LIT LA SOURCE AU LIEU D'APPELER LA FONCTION ─────────
    //
    // Ma première version passait `{ PATH: '' }` à `detectBestAgent` en croyant
    // forcer le repli. Elle a échoué, et l'échec est instructif : `env` ne sert
    // QU'À lire `HIVE_AGENT_CMD`. La sonde, elle, fait `spawn(bin, …)` sur le
    // PATH RÉEL du processus, qu'aucun paramètre ne détourne. Sur cette machine
    // `claude` est installé, donc la détection le trouve — et c'est correct.
    //
    // Il manque donc une couture, exactement celle qu'il a fallu ajouter à
    // `relever()` dans `doctor-releve.ts` pour la même raison. Tant qu'elle
    // n'existe pas, le chemin de repli n'est pas atteignable depuis un test, et
    // le prétendre serait pire que de s'en passer. On garde donc la RÈGLE sur
    // la source — commentaires retirés, sinon la prose ci-dessus la ferait
    // passer toute seule.
    const nue = readFileSync(
      new URL('../src/node-client/agent-detect.js', import.meta.url).pathname.replace(
        /\.js$/,
        '.ts',
      ),
      'utf8',
    )
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    expect(nue).toMatch(/agent:\s*'shell'[\s\S]{0,60}simulé/);
  });
});
