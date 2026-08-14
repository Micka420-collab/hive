// LA LOUPE, ÉPROUVÉE — parce qu'elle était elle-même un faux vert.
//
// ─── LE DÉFAUT ───────────────────────────────────────────────────────────────
//
// `suiteRougit()` enveloppait le lancement de vitest dans un `catch` qui
// attrapait TOUT et rendait « la suite a rougi ». Il ne distinguait pas
//
//     les tests ont mordu        ← un verdict
//     les tests n'ont pas tourné ← une panne
//
// Sous Windows, `npx` est `npx.cmd` et `spawn` sans interpréteur ne sait pas le
// lancer. Chaque mutant y partait en ENOENT — trois millisecondes — était compté
// « ✔ défendue », et la loupe imprimait « LA LOUPE NE VOIT RIEN DE NU » puis
// sortait en 0, **sans avoir exécuté un seul test**.
//
// C'est le pire endroit du dépôt où placer ce défaut : la loupe est l'outil dont
// le métier ENTIER est de débusquer les faux verts, et ses verdicts sont cités
// comme preuve dans une trentaine de commentaires — « la loupe l'a montré
// équivalent », « 17 mutants, 17 morts ». Sur une machine Windows, aucune de ces
// phrases n'avait de sens.
//
// ─── POURQUOI CE FICHIER EST EN JAVASCRIPT NU ────────────────────────────────
//
// Comme `amorce.test.mjs`, et pour une raison voisine : la loupe est un outil
// autonome en `.mjs`. L'éprouver depuis du TypeScript ajouterait une couche que
// l'outil lui-même n'a pas.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  cheminsDuBalayage,
  HORS_PORTEE,
  PORTEE_PAR_DEFAUT,
  verdictDeLErreur,
} from '../scripts/loupe.mjs';

const lire = (chemin) => readFileSync(new URL(chemin, import.meta.url), 'utf8');

describe('UN VERDICT N’EST RENDU QUE SI VITEST A VRAIMENT TOURNÉ', () => {
  it('rien de jeté : la suite est passée', () => {
    expect(verdictDeLErreur(null)).toEqual({ regarde: true, rouge: false });
    expect(verdictDeLErreur(undefined)).toEqual({ regarde: true, rouge: false });
  });

  it('un code de sortie NON NUL : le mutant a été tué', () => {
    // C'est le seul cas où « rouge » veut dire ce qu'on croit : vitest a
    // tourné, a compté, et a rendu un verdict.
    expect(verdictDeLErreur({ status: 1 })).toEqual({ regarde: true, rouge: true });
    expect(verdictDeLErreur({ status: 137 })).toEqual({ regarde: true, rouge: true });
  });

  it('un code de sortie NUL malgré une exception : la suite est passée', () => {
    expect(verdictDeLErreur({ status: 0 })).toEqual({ regarde: true, rouge: false });
  });

  it('ENOENT N’EST PAS UN ROUGE — c’est un « je n’ai pas pu regarder »', () => {
    // ─── L'ASSERTION QUI AURAIT SAUVÉ TOUTES LES AUTRES ────────────────────
    //
    // C'est exactement ce qui arrivait sur chaque machine Windows, à chaque
    // mutant, en trois millisecondes.
    const v = verdictDeLErreur({ code: 'ENOENT', path: 'npx' });
    expect(v.regarde, 'un binaire introuvable ne défend rien').toBe(false);
    expect(v.cause).toContain('npx');
  });

  it('un signal n’est pas un rouge non plus', () => {
    // Un `timeout` dépassé tue le processus par SIGTERM et ne pose AUCUN
    // `status`. Une machine chargée aurait donc vu ses mutants « défendus ».
    const v = verdictDeLErreur({ signal: 'SIGTERM' });
    expect(v.regarde).toBe(false);
    expect(v.cause).toContain('SIGTERM');
  });

  it('une erreur inconnue non plus — le doute ne se lit jamais comme un vert', () => {
    const v = verdictDeLErreur({ code: 'EACCES', message: 'permission refusée' });
    expect(v.regarde).toBe(false);
    expect(v.cause).toContain('EACCES');
  });
});

describe('LA LOUPE NE PASSE PLUS PAR UN SHIM', () => {
  const source = lire('../scripts/loupe.mjs');

  it('elle vise le script RÉEL de vitest, lancé par le Node courant', () => {
    // `scripts/ruche.mjs` et `src/shared/demarrage.ts` prennent déjà ce soin,
    // pour la raison exacte qui a cassé celle-ci (§ 6.2 du journal).
    expect(source).toContain("path.join('node_modules', 'vitest', 'vitest.mjs')");
    expect(source).toContain('execFileSync(process.execPath');
  });

  it('ELLE N’INVOQUE PLUS `npx`, NI AUCUN AUTRE SHIM', () => {
    // `npm`, `npx`, `tsx` : sous Windows, tous des `.cmd`. La garde vise la
    // FORME de l'appel, parce que c'est elle qui décide, pas l'intention.
    expect(source, 'un shim est revenu dans un execFileSync').not.toMatch(
      /execFileSync\(\s*['"](npx|npm|tsx)['"]/,
    );
  });

  it('L’IMPORTER NE DÉCLENCHE AUCUNE CAMPAGNE DE MUTATION', () => {
    // ─── CE FICHIER EN A FAIT LES FRAIS ────────────────────────────────────
    //
    // Sa première version importait la loupe pour éprouver une fonction pure de
    // vingt lignes. L'import a lancé une campagne complète : mutation de
    // sources, vitest, restauration. Je l'ai interrompue, et `src/tui/rendu.ts`
    // est resté MUTÉ dans l'arbre.
    //
    // C'est le § 2.8 du journal — un fichier qui s'exécute à l'import est un
    // angle mort — et le § 5.2 — une loupe interrompue laisse sa mutation —
    // dans le même geste. Le fait que ce test-ci s'exécute prouve déjà que le
    // corps ne tourne plus ; cette assertion nomme la garde pour qu'on ne la
    // retire pas par mégarde.
    expect(source, 'le corps doit être derrière une garde de point d’entrée').toContain(
      'if (MOI !== LANCE)',
    );
  });

  it('quand elle n’a pas pu regarder, elle SORT EN ERREUR', () => {
    // Le contraire — continuer en comptant « défendue » — est précisément le
    // défaut. Un outil qui n'a pas pu regarder ne dit pas « c'est défendu ».
    expect(source).toContain('LA LOUPE N’A PAS PU REGARDER');
    expect(source).toContain('process.exit(2)');
  });
});

// ─── LE PÉRIMÈTRE DU BALAYAGE ────────────────────────────────────────────────
//
// D'où vient ce bloc : un balayage élargi à 597 candidates est mort au bout de
// quatre heures en étant arrivé à `src/installer-assistant.ts`. Tout le cœur —
// `src/orchestrator`, `src/shared`, `src/tui` — n'avait jamais été atteint, et
// relancer à l'identique aurait repassé les mêmes heures sur le terrain déjà
// jugé. `LOUPE_CHEMINS` resserre le périmètre ; ses deux gardes sont éprouvées
// ici parce qu'elles coûtent cher en silence si elles sautent.

describe('cheminsDuBalayage — ce que la loupe a le droit de regarder', () => {
  it('SANS RÉGLAGE, c’est le périmètre complet — et surtout PAS le vide', () => {
    // Un pathspec vide ne veut pas dire « rien » pour git : il veut dire TOUT.
    // La loupe muterait alors les bancs eux-mêmes, et un banc muté qui fait
    // rougir la suite ne prouve rigoureusement rien.
    for (const rien of [undefined, '', '   ', ',', ' , , ']) {
      expect(cheminsDuBalayage(rien), JSON.stringify(rien)).toEqual([
        ...PORTEE_PAR_DEFAUT,
        HORS_PORTEE,
      ]);
    }
  });

  it('LE JUGE RESTE DEHORS, MÊME QUAND ON DEMANDE `scripts`', () => {
    // La demande la plus naturelle est aussi la plus dangereuse : elle
    // remettrait la loupe sous sa propre lame, et son verdict ne mesurerait
    // plus rien de connaissable.
    expect(cheminsDuBalayage('scripts')).toEqual(['scripts', HORS_PORTEE]);
    expect(cheminsDuBalayage('src,scripts,dashboard/src')).toEqual([
      'src',
      'scripts',
      'dashboard/src',
      HORS_PORTEE,
    ]);
  });

  it('UN PÉRIMÈTRE DEMANDÉ REMPLACE le défaut — sinon le réglage ne sert à rien', () => {
    const c = cheminsDuBalayage('src/orchestrator,src/shared,src/tui');
    expect(c).toEqual(['src/orchestrator', 'src/shared', 'src/tui', HORS_PORTEE]);
    expect(c, 'le défaut ne doit pas se rajouter par-dessus').not.toContain('dashboard/src');
  });

  it('LES ESPACES ET LES VIRGULES EN TROP SONT ABSORBÉS', () => {
    // Un réglage se tape à la main dans un terminal, à une heure tardive.
    expect(cheminsDuBalayage('  src/tui , , src/shared  ')).toEqual([
      'src/tui',
      'src/shared',
      HORS_PORTEE,
    ]);
  });

  it('L’EXCLUSION EST EN DERNIER — l’ordre du pathspec compte pour git', () => {
    expect(cheminsDuBalayage('src').at(-1)).toBe(HORS_PORTEE);
    expect(cheminsDuBalayage(undefined).at(-1)).toBe(HORS_PORTEE);
  });
});

describe('LE PÉRIMÈTRE PAR DÉFAUT COUVRE TOUT CE QUI EST LIVRÉ ET DÉCIDE', () => {
  // ─── LE TROU, EN TROIS TEMPS ───────────────────────────────────────────────
  //
  // 1. `.html` était exclu EN BLOC de la loupe : la vitrine ne pouvait rendre
  //    AUCUNE candidate. Fermé.
  // 2. Un balayage COMPLET, lancé à la main avec `LOUPE_CHEMINS=site`, a rendu
  //    43 candidates dont 33 SANS TEST — dont l'inversion du dictionnaire, qui
  //    sert l'anglais aux francophones. Fermées, cinq d'entre elles.
  // 3. Et pourtant `npm run loupe` — LA GARDE DE FUSION, celle qui tourne sans
  //    variable d'environnement — ne regardait toujours pas `site/`.
  //
  // Les deux premiers lots ont rendu la vitrine EXAMINABLE. Sans ce troisième,
  // elle ne serait jamais EXAMINÉE : la prochaine décision ajoutée à la page
  // passerait la garde avec « rien à conclure », exactement comme avant.
  //
  // Une garde qu'on rend capable et qu'on ne branche pas est une garde qu'on a
  // écrite pour soi.

  it('la VITRINE est dans le périmètre par défaut', () => {
    expect(PORTEE_PAR_DEFAUT, 'site/ hors de la garde de fusion').toContain('site');
    expect(cheminsDuBalayage(undefined)).toContain('site');
  });

  it('AUCUN chemin du périmètre n’est mort — chacun porte du mutable', async () => {
    // ─── LA GARDE QUI EMPÊCHE LA LISTE DE POURRIR ───────────────────────────
    //
    // Un dossier renommé laisserait une entrée qui ne désigne plus rien, et la
    // loupe rendrait « rien à conclure » sans que personne s'en aperçoive — le
    // silence, encore. On exige donc que chaque entrée ramène au moins un
    // fichier que la loupe accepterait de muter.
    const { readdirSync } = await import('node:fs');
    const { langageMutable } = await import('../scripts/loupe.mjs');
    const morts = [];
    for (const dossier of PORTEE_PAR_DEFAUT) {
      let vivant = false;
      const marcher = (d) => {
        if (vivant) return;
        for (const e of readdirSync(new URL(`../${d}/`, import.meta.url), {
          withFileTypes: true,
        })) {
          if (vivant) return;
          if (e.isDirectory()) marcher(`${d}/${e.name}`);
          else if (langageMutable(e.name)) vivant = true;
        }
      };
      try {
        marcher(dossier);
      } catch {
        /* dossier absent : mort, et c'est ce qu'on veut dire */
      }
      if (!vivant) morts.push(dossier);
    }
    expect(morts, 'chemin(s) du périmètre qui ne désignent plus rien de mutable').toEqual([]);
  });
});
