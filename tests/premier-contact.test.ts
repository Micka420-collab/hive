// LE PREMIER CONTACT — ce que vit quelqu'un qui découvre la ruche.
//
// ─── CE QUE CE FICHIER EXISTE POUR EMPÊCHER ──────────────────────────────────
//
// Le docteur et l'installeur sont deux modules justes, chacun testé chez lui.
// Le défaut n'était dans ni l'un ni l'autre : il était ENTRE EUX.
//
// Sur un clone vierge (Node 24, mesuré), le docteur disait :
//
//     ✘ env_present    aucun fichier .env
//          → cp .env.example .env
//
// Ce geste plante `HIVE_TOKEN=change-me` et `HIVE_JWT_SECRET=change-me`, les
// valeurs publiées avec le code. Or l'installeur ne COMPLÈTE que les clés
// ABSENTES — sa prudence est juste, il ne peut pas distinguer une valeur
// choisie d'une valeur recopiée. Lancé ensuite, il répondait donc :
//
//     [OK] .env complété — vos valeurs sont intactes
//
// et laissait les deux marque-places en place. **Le premier remède du docteur
// était le geste qui désarmait l'outil fait pour réparer.** Restaient deux
// modifications à la main dans un fichier de quatre cents lignes.
//
// ─── LA PROPRIÉTÉ TENUE ICI ──────────────────────────────────────────────────
//
// Ce que l'installeur ÉCRIT sur une ruche neuve satisfait ce que le docteur
// EXIGE. Deux constantes qui divergeraient — un `MIN_TOKEN_LENGTH` relevé sans
// toucher à `LONGUEUR_JETON` — rendraient ce fichier rouge le jour même,
// plutôt qu'au premier clone de quelqu'un d'autre.

import { describe, expect, it } from 'vitest';
import { composerReglages } from '../src/installer.js';
import { diagnostiquer, type Diagnostic, type Releve } from '../src/shared/doctor.js';
import { SECRET_JWT_INTERDIT } from '../src/orchestrator/auth.js';
import { DEFAULT_TOKEN } from '../src/shared/types.js';

/** Un relevé de machine saine ; seuls les secrets viennent de l'installeur. */
function releveAvec(reglages: { cle: string; valeur: string }[]): Releve {
  const val = (cle: string): string => reglages.find((r) => r.cle === cle)?.valeur ?? '';
  const jeton = val('HIVE_TOKEN');
  const secret = val('HIVE_JWT_SECRET');
  return {
    nodeMajeur: 24,
    fichierEnv: { present: true, lisible: true, permissions: 0o600 },
    secretSession: {
      // On applique la règle du serveur, pas une règle approchante : c'est
      // exactement ce que `createServer` refuse.
      utilisable: secret.length >= 24 && secret !== SECRET_JWT_INTERDIT && secret !== DEFAULT_TOKEN,
      longueur: secret.length,
      publie: secret === SECRET_JWT_INTERDIT,
      simulation: false,
    },
    jeton: { present: jeton !== '', longueur: jeton.length, trivial: jeton === DEFAULT_TOKEN },
    port: { numero: 7777, libre: true, parNous: null },
    moteur: { manquants: [], raison: null },
    base: { presente: true, integre: true, inscriptible: true },
    dashboardConstruit: true,
    agent: 'claude-code',
    isolement: 'podman',
    wsJoignable: true,
    reglages: { runner: 'off', bindPublic: false, gardiennes: 'strict', corsOuvert: false },
    espace: { octetsLibres: 40 * 1024 * 1024 * 1024, inscriptible: true },
  };
}

const bloquants = (d: Diagnostic[]): Diagnostic[] => d.filter((x) => x.gravite === 'bloquant');

describe('le premier contact : l’installeur écrit ce que le docteur exige', () => {
  it('SUR UNE RUCHE NEUVE, PLUS AUCUN ✘ — c’est tout le contrat', () => {
    // `new Map()` = aucun `.env` préexistant, le cas du clone vierge.
    const diagnostics = diagnostiquer(releveAvec(composerReglages(new Map())));
    expect(
      bloquants(diagnostics).map((d) => `${d.cle} : ${d.constat}`),
      'l’installeur laisse la ruche dans un état que le docteur refuse',
    ).toEqual([]);
  });

  it('LE JETON ENGENDRÉ PASSE LA MESURE DU DOCTEUR, avec de la marge', () => {
    const jeton = composerReglages(new Map()).find((r) => r.cle === 'HIVE_TOKEN')?.valeur ?? '';
    const d = diagnostiquer(releveAvec([{ cle: 'HIVE_TOKEN', valeur: jeton }]));
    expect(d.find((x) => x.cle === 'jeton')?.gravite).toBe('ok');
    expect(jeton).not.toBe(DEFAULT_TOKEN);
  });

  it('LE SECRET DE SESSION AUSSI — c’est la garde qui tue la Reine au démarrage', () => {
    const secret =
      composerReglages(new Map()).find((r) => r.cle === 'HIVE_JWT_SECRET')?.valeur ?? '';
    const d = diagnostiquer(releveAvec([{ cle: 'HIVE_JWT_SECRET', valeur: secret }]));
    expect(d.find((x) => x.cle === 'secret_session')?.gravite).toBe('ok');
    expect(secret).not.toBe(SECRET_JWT_INTERDIT);
    expect(secret).not.toBe(DEFAULT_TOKEN);
  });

  it('DEUX RUCHES NEUVES N’ONT PAS LES MÊMES SECRETS', () => {
    // Un secret déterministe serait aussi public que celui du dépôt.
    const a = composerReglages(new Map());
    const b = composerReglages(new Map());
    for (const cle of ['HIVE_TOKEN', 'HIVE_JWT_SECRET']) {
      const va = a.find((r) => r.cle === cle)?.valeur;
      const vb = b.find((r) => r.cle === cle)?.valeur;
      expect(va, cle).not.toBe(vb);
    }
  });

  it('LE REMÈDE DU DOCTEUR NOMME L’INSTALLEUR, PAS UNE COPIE DU MODÈLE', () => {
    // C'est le maillon qui manquait. Un `cp` du modèle plante les valeurs
    // publiées, et l'installeur ne les remplacera jamais : conseiller ce
    // geste-là, c'est fermer la porte de secours avant d'en avoir besoin.
    const sansEnv = releveAvec(composerReglages(new Map()));
    sansEnv.fichierEnv = { present: false, lisible: false, permissions: null };
    const remede = diagnostiquer(sansEnv).find((d) => d.cle === 'env_present')?.reparation ?? '';
    expect(remede).toContain('install:hive');
    expect(remede, 'le `cp` du modèle est précisément le geste à ne plus conseiller').not.toMatch(
      /^\s*cp\b/,
    );
  });

  it('LE PIÈGE LUI-MÊME, TENU PAR UN TEST : `change-me` survit à l’installeur', () => {
    // Ce test ne décrit pas un bug à corriger — il fixe le COMPORTEMENT que
    // l'installeur a choisi (« on ne touche pas à la valeur de quelqu'un ») et
    // qui rend le remède du docteur décisif. Si un jour l'installeur se met à
    // remplacer les valeurs publiées, ce test rougira, et le remède ci-dessus
    // pourra redevenir un `cp` — mais ce sera une DÉCISION, pas une dérive.
    const deja = new Map([
      ['HIVE_TOKEN', DEFAULT_TOKEN],
      ['HIVE_JWT_SECRET', DEFAULT_TOKEN],
    ]);
    const apres = composerReglages(deja);
    expect(apres.find((r) => r.cle === 'HIVE_TOKEN')?.valeur).toBe(DEFAULT_TOKEN);
    expect(apres.find((r) => r.cle === 'HIVE_JWT_SECRET')?.valeur).toBe(DEFAULT_TOKEN);
  });
});
