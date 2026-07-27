// Le bac à sable, sur LES DEUX chemins de démarrage.
//
// ─── LE TROU QUE CE FICHIER FERME ────────────────────────────────────────────
//
// `main.ts` décidait l'isolement, l'annonçait, refusait de démarrer en
// « exige » sans moteur, et passait un bac au client. `join.ts` ne faisait
// RIEN de tout cela — aucun import de `isolement.js`, aucune option `bac`.
//
// Un nœud lancé par `npm run join` tournait donc TOUJOURS en sandbox de
// processus, jamais en conteneur, et `HIVE_ISOLEMENT=exige` y était sans le
// moindre effet. Or c'est exactement le réglage qu'on pose quand on prête sa
// machine à des inconnus — et `join` est le chemin des AMIS, c'est-à-dire des
// machines de gens qui n'ont pas lu `.env.example` et qui font confiance à
// celui qui leur a envoyé le billet.
//
// Le duplicata était le vrai problème : deux chemins de démarrage, deux codes,
// donc une dérive garantie. La garde ci-dessous relit les DEUX sources et
// exige qu'ils passent par le même module. Réintroduire un chemin qui décide
// tout seul rend ce fichier rouge.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { annonce, optionBac, type Bac } from '../src/node-client/bac.js';
import { decider, type Fournisseur } from '../src/node-client/isolement.js';

const source = (chemin: string): string =>
  readFileSync(fileURLToPath(new URL(`../src/node-client/${chemin}`, import.meta.url)), 'utf8');

const PODMAN: Fournisseur = {
  nom: 'podman',
  bin: 'podman',
  niveau: 'conteneur',
  installation: 'https://podman.io/docs/installation',
  garanties: ['seul le répertoire de la tâche est visible'],
};

function bacDe(mode: 'off' | 'auto' | 'exige', fournisseur: Fournisseur | null): Bac {
  const decision = decider(mode, fournisseur);
  return { decision, fournisseur, lignes: annonce(decision, fournisseur), refuse: decision.refuse };
}

describe('LES DEUX CHEMINS DE DÉMARRAGE PASSENT PAR LE MÊME BAC', () => {
  // Garde de source, dans l'esprit de `tests/security-invariants.test.ts` :
  // elle ne teste pas un comportement, elle empêche une régression de forme.
  for (const fichier of ['main.ts', 'join.ts']) {
    it(`${fichier} prépare, annonce, refuse et transmet le bac`, () => {
      const s = source(fichier);
      expect(s, 'ne prépare pas le bac').toMatch(/preparerBac\s*\(/);
      expect(s, 'ne transmet pas le bac au client').toMatch(/optionBac\s*\(/);
      expect(s, 'ne refuse pas de démarrer quand le bac le demande').toMatch(/\.refuse\b/);
      expect(s, 'n’annonce pas la décision à l’humain').toMatch(/bac\.lignes/);
    });
  }

  it('aucun des deux ne redécide l’isolement dans son coin', () => {
    // C'est la dérive qui a créé le trou : `main.ts` avait sa copie, `join.ts`
    // n'en avait aucune. Un seul endroit décide, désormais.
    for (const fichier of ['main.ts', 'join.ts']) {
      expect(source(fichier), `${fichier} rappelle decider() lui-même`).not.toMatch(
        /\bdecider\s*\(/,
      );
    }
  });
});

describe('l’annonce (fonction pure)', () => {
  it('« PASSE QUAND MÊME » EST TOUJOURS DIT, MÊME AU MEILLEUR NIVEAU', () => {
    // Une interface qui dirait « isolé ✓ » sans dire ce qui traverse encore
    // ferait prendre un risque à quelqu'un qui croit ne pas en prendre. Le
    // réseau traverse toujours : un agent de codage doit joindre l'API de son
    // modèle.
    for (const bac of [bacDe('auto', PODMAN), bacDe('auto', null), bacDe('off', null)]) {
      expect(bac.lignes.join('\n'), bac.decision.motif).toContain('Passe quand même');
    }
  });

  it('elle nomme le moteur quand il y en a un, et le dit quand il n’y en a pas', () => {
    expect(bacDe('auto', PODMAN).lignes.join('\n')).toContain('podman');
    expect(bacDe('auto', null).lignes.join('\n')).toMatch(/aucun moteur/i);
  });

  it('au meilleur niveau, elle dit AUSSI ce qui est protégé', () => {
    expect(bacDe('auto', PODMAN).lignes.join('\n')).toContain('Protégé');
  });
});

describe('le refus, et ce qui part au client', () => {
  it('« EXIGE » SANS MOTEUR REFUSE DE DÉMARRER — sur les deux chemins', () => {
    const bac = bacDe('exige', null);
    expect(bac.refuse).toBe(true);
    expect(bac.lignes.join('\n')).toContain('HIVE_ISOLEMENT=exige');
  });

  it('« exige » AVEC moteur démarre normalement', () => {
    const bac = bacDe('exige', PODMAN);
    expect(bac.refuse).toBe(false);
    expect(bac.decision.isole).toBe(true);
  });

  it('sans moteur, aucune option `bac` n’est transmise', () => {
    expect(optionBac(bacDe('auto', null), ['HOME'])).toEqual({});
    expect(optionBac(bacDe('off', null), ['HOME'])).toEqual({});
  });

  it('LE BAC REÇOIT EXACTEMENT LES MÊMES VARIABLES QUE LA SANDBOX', () => {
    // Ni en ajouter — ce serait une fuite — ni en retirer : un agent non
    // authentifié échoue en boucle, ce qui ressemble à une panne
    // d'infrastructure et se diagnostique très mal.
    const variables = ['HOME', 'ANTHROPIC_API_KEY'];
    const option = optionBac(bacDe('auto', PODMAN), variables) as {
      bac: { fournisseur: Fournisseur; variables: string[] };
    };
    expect(option.bac.fournisseur.nom).toBe('podman');
    expect(option.bac.variables).toEqual(variables);
  });

  it('la liste transmise est une COPIE, pas la liste de l’appelant', () => {
    // Sinon une mutation ultérieure du `keepEnv` changerait, à distance et
    // sans le dire, ce que le conteneur laisse entrer.
    const variables = ['HOME'];
    const option = optionBac(bacDe('auto', PODMAN), variables) as {
      bac: { variables: string[] };
    };
    variables.push('SECRET_AJOUTE_APRES_COUP');
    expect(option.bac.variables).toEqual(['HOME']);
  });
});
