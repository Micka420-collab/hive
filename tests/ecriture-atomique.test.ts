// ÉCRIRE UN SECRET — la seule bonne façon, et pourquoi l'autre était fausse.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// `src/installer-main.ts` était à 0 % de couverture, et pour une raison
// structurelle : il finit par `main().catch(…)`, donc l'importer LANCE
// l'installeur (§ 2.8 du carnet). Il portait DEUX écrivains du même fichier —
// le `.env`, celui qui contient `HIVE_TOKEN` et `HIVE_JWT_SECRET` :
//
//   · le chemin principal écrivait par temporaire + `rename` ;
//   · le chemin de l'ASSISTANT écrivait par un `writeFileSync` direct.
//
// Le second est le chemin INTERACTIF. C'est-à-dire celui où l'on appuie sur
// `^C`, et celui où le fichier existe DÉJÀ.
//
// ─── LE DÉFAUT QUE PERSONNE NE VOIT ──────────────────────────────────────────
//
// `writeFileSync(chemin, données, { mode })` n'honore `mode` qu'à la CRÉATION
// du fichier. Mesuré avant d'écrire une ligne de correctif :
//
//     fichier existant en 644, puis writeFileSync(… { mode: 0o600 })
//     → droits inchangés : 644
//     temporaire neuf en 0600, puis rename
//     → 600
//
// Un `.env` déjà présent en 644 — ce que produit exactement le
// `cp .env.example .env` que le docteur conseille — restait donc lisible par
// tous les comptes de la machine, avec les secrets dedans. Le correctif n'est
// pas « ajouter un chmod » : c'est faire passer les deux écrivains par la même
// voie, celle qui crée un fichier neuf et ne peut pas hériter de droits.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MODE_SECRET, ecrireAtomique } from '../src/ecriture-atomique.js';

const POSIX = process.platform !== 'win32';

let racine = '';
beforeEach(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-ecriture-'));
});
afterEach(() => {
  rmSync(racine, { recursive: true, force: true });
});

const droits = (f: string): string => (statSync(f).mode & 0o777).toString(8);

describe('écrire un fichier de secrets', () => {
  it('CE QU’ON ÉCRIT, ON LE RELIT', () => {
    const f = path.join(racine, '.env');
    ecrireAtomique(f, 'HIVE_TOKEN=abc\n');
    expect(readFileSync(f, 'utf8')).toBe('HIVE_TOKEN=abc\n');
  });

  it.runIf(POSIX)('UN FICHIER NEUF NAÎT EN 0600', () => {
    const f = path.join(racine, '.env');
    ecrireAtomique(f, 'HIVE_TOKEN=abc\n');
    expect(droits(f)).toBe('600');
  });

  it.runIf(POSIX)(
    'UN FICHIER DÉJÀ EN 644 EST RAMENÉ À 600 — le défaut que la voie directe laissait passer',
    () => {
      // LA garde de ce fichier. `writeFileSync(…, { mode })` sur un fichier
      // existant ne change RIEN aux droits : c'est mesuré, pas supposé. Un
      // `.env` né d'un `cp .env.example .env` reste donc lisible par tous les
      // comptes de la machine — avec le jeton et le secret de session dedans.
      //
      // La voie atomique crée un fichier NEUF, qui ne peut hériter de rien.
      const f = path.join(racine, '.env');
      writeFileSync(f, 'HIVE_TOKEN=ancien\n', { mode: 0o644 });
      expect(droits(f), 'la prémisse : le fichier est bien ouvert à tous').toBe('644');

      ecrireAtomique(f, 'HIVE_TOKEN=nouveau\n');

      expect(droits(f), 'après écriture, il est refermé').toBe('600');
      expect(readFileSync(f, 'utf8'), 'et le contenu est bien le neuf').toBe(
        'HIVE_TOKEN=nouveau\n',
      );
    },
  );

  it('AUCUN TEMPORAIRE NE RESTE DERRIÈRE — ni en succès…', () => {
    const f = path.join(racine, '.env');
    ecrireAtomique(f, 'X=1\n');
    expect(readdirSync(racine), 'le dossier ne contient que le fichier voulu').toEqual(['.env']);
  });

  it('…NI EN ÉCHEC — un `.tmp` orphelin est une énigme laissée à quelqu’un d’autre', () => {
    // L'obstacle est STRUCTUREL (un fichier là où il faudrait un dossier) et
    // non un `chmod` : la suite tourne en root, où les droits ne ferment rien
    // (§ 2 vicies du carnet).
    const obstacle = path.join(racine, 'obstacle');
    writeFileSync(obstacle, 'je suis un fichier, pas un dossier', 'utf8');
    const impossible = path.join(obstacle, 'sous', '.env');

    expect(() => ecrireAtomique(impossible, 'X=1\n'), 'l’échec doit REMONTER').toThrow();
    // Rien n'a été créé — et surtout, rien n'a été laissé à moitié.
    expect(readdirSync(racine), 'le dossier est intact').toEqual(['obstacle']);
    expect(readFileSync(obstacle, 'utf8')).toBe('je suis un fichier, pas un dossier');
  });

  it('L’ÉCHEC REMONTE — ici, se taire donnerait une ruche qu’on croit configurée', () => {
    // Contraste voulu avec la clé d'un nœud (`identite-noeud.ts`), qui avale
    // ses échecs : là-bas le nœud tourne quand même, ici la ruche ne démarrera
    // pas et l'utilisateur doit l'apprendre MAINTENANT.
    const obstacle = path.join(racine, 'obstacle');
    writeFileSync(obstacle, 'x', 'utf8');
    let leve: unknown = null;
    try {
      ecrireAtomique(path.join(obstacle, 'sous', '.env'), 'X=1\n');
    } catch (e) {
      leve = e;
    }
    expect(leve, 'une erreur, pas un silence').toBeInstanceOf(Error);
  });

  it('LE MODE PAR DÉFAUT EST CELUI DES SECRETS', () => {
    // Un appelant qui oublie le troisième argument ne doit pas écrire un
    // secret en clair pour tout le monde : le défaut le protège.
    expect(MODE_SECRET).toBe(0o600);
  });

  it.runIf(POSIX)(
    'UN MODE EXPLICITE EST RESPECTÉ — le module ne force pas au-delà de sa règle',
    () => {
      const f = path.join(racine, 'public.txt');
      ecrireAtomique(f, 'rien de secret\n', 0o644);
      expect(droits(f)).toBe('644');
    },
  );

  it('LE TEMPORAIRE PORTE LE PID — deux processus n’écrivent pas le même brouillon', () => {
    // Sans cette distinction, deux installeurs lancés en même temps se
    // marcheraient dessus AU MILIEU du geste, et le `rename` de l'un
    // publierait le brouillon de l'autre.
    const f = path.join(racine, '.env');
    ecrireAtomique(f, 'X=1\n');
    expect(existsSync(`${f}.${process.pid}.tmp`), 'et il est retiré après').toBe(false);
  });
});

// ─── LA GARDE STRUCTURELLE ───────────────────────────────────────────────────
//
// Le correctif vit dans `src/installer-main.ts`, qui s'exécute à l'import :
// AUCUN test ne peut l'appeler. Une correction qu'aucun banc ne peut atteindre
// n'est pas une correction tenue (§ 2 sexdecies du carnet) — le prochain
// écrivain du `.env` naîtrait au `writeFileSync` direct, exactement comme
// celui-ci, et personne ne le verrait.
//
// On juge donc la SOURCE : le fichier de secrets ne s'écrit que par la voie
// atomique, où qu'il soit écrit.

/** Retire commentaires de bloc et de ligne — le mot « writeFileSync » y figure. */
function sansCommentaires(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
    .join('\n');
}

function fichiersTs(dossier: string): string[] {
  const sortie: string[] = [];
  for (const nom of readdirSync(dossier)) {
    const complet = path.join(dossier, nom);
    if (statSync(complet).isDirectory()) sortie.push(...fichiersTs(complet));
    else if (nom.endsWith('.ts')) sortie.push(complet);
  }
  return sortie;
}

describe('LA GARDE : le fichier de secrets ne s’écrit que par la voie atomique', () => {
  it('AUCUN `writeFileSync` DIRECT NE VISE UN `.env` DANS `src/`', () => {
    const RACINE = fileURLToPath(new URL('..', import.meta.url));
    const SRC = path.join(RACINE, 'src');
    const fautifs: string[] = [];
    let ecrivainsVus = 0;

    for (const fichier of fichiersTs(SRC)) {
      // Le module de la voie atomique EST l'écrivain direct : c'est son rôle.
      if (fichier.endsWith(path.join('src', 'ecriture-atomique.ts'))) continue;
      const source = sansCommentaires(readFileSync(fichier, 'utf8'));
      for (const m of source.matchAll(/(?:writeFileSync|appendFileSync|createWriteStream)\(/g)) {
        ecrivainsVus += 1;
        const tranche = source.slice(m.index, m.index + 160);
        if (/CHEMIN_ENV|['"`][^'"`]*\.env\b/.test(tranche)) {
          fautifs.push(`${path.relative(RACINE, fichier)} → ${tranche.split('\n')[0]?.trim()}`);
        }
      }
    }

    expect(
      fautifs,
      'un `.env` s’écrit hors de la voie atomique. `writeFileSync(…, { mode })` ' +
        'n’applique le mode qu’à la CRÉATION : sur un fichier déjà en 644 — celui ' +
        'que produit `cp .env.example .env` — les secrets restent lisibles par ' +
        'tous les comptes. Passez par `ecrireAtomique` de `src/ecriture-atomique.ts`.',
    ).toEqual([]);

    // Sans ce compte, la garde deviendrait verte le jour où elle cesse de voir
    // les écrivains — un chemin d'accès qui change, une API renommée — et elle
    // annoncerait « rien à signaler » en n'ayant rien regardé.
    expect(ecrivainsVus, 'la garde doit VOIR des écrivains pour pouvoir en juger').toBeGreaterThan(
      3,
    );
  });

  it('L’INSTALLEUR PASSE BIEN PAR LA VOIE ATOMIQUE — la garde ci-dessus n’est pas vide', () => {
    const RACINE = fileURLToPath(new URL('..', import.meta.url));
    const source = readFileSync(path.join(RACINE, 'src', 'installer-main.ts'), 'utf8');
    expect(source, 'l’installeur importe la voie atomique').toContain(
      "from './ecriture-atomique.js'",
    );
    // Les DEUX écritures du `.env` — le chemin principal et celui de
    // l'assistant. C'est le second qui manquait.
    expect(
      sansCommentaires(source).match(/ecrireAtomique\(/g)?.length ?? 0,
      'les deux écrivains du `.env` doivent y passer',
    ).toBeGreaterThanOrEqual(2);
  });
});
