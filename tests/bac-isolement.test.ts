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
import { annonce, codeDuBac, optionBac, preparerBac, type Bac } from '../src/node-client/bac.js';
import { decider, type Fournisseur } from '../src/node-client/isolement.js';
import { CODE } from '../src/codes-sortie.js';

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
  return {
    decision,
    fournisseur,
    lignes: annonce(decision, fournisseur),
    refuse: decision.refuse,
    // La VRAIE règle, pas une copie : c'est tout l'objet de `codeDuBac`.
    codeSortie: codeDuBac(decision.refuse),
  };
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

  // ─── LES DEUX MOITIÉS DU DERNIER VERROU ────────────────────────────────────
  //
  // `optionBac` est la DERNIÈRE porte avant que l'option de bac n'atteigne le
  // client. Sa garde a deux moitiés, et un balayage élargi (base épinglée sur
  // le commit d'origine, `LOUPE_CHEMINS=src/node-client`) a montré qu'on
  // pouvait la muter en `&&` sans qu'une seule assertion bouge.
  //
  // Rien ne l'exerçait parce que TOUS les cas passaient par `bacDe`, qui
  // construit un `Bac` COHÉRENT via `decider` : là, `isole` est vrai si et
  // seulement si un fournisseur existe. Les deux moitiés étaient donc toujours
  // d'accord, et leur désaccord — le seul cas où la garde sert — n'était jamais
  // joué.
  //
  // Le type, lui, autorise le désaccord : `Bac.fournisseur` est
  // `Fournisseur | null`, et `optionBac` est exporté. Ce n'est pas un état
  // théorique qu'on invente pour tuer un mutant : c'est ce que la signature
  // promet de supporter, sur la frontière que ce module existe pour tenir
  // (« mieux vaut un nœud qui ne prend aucune tâche qu'un nœud qui en prend une
  // sans bac à sable en croyant le contraire »).
  it('UN BAC INCOHÉRENT NE PASSE PAS — les deux moitiés de la garde, séparément', () => {
    // Moitié 1 — isolé, mais sans moteur. Muté en `&&`, on transmettrait
    // `fournisseur: null` au client : une option de bac qui ne borne rien,
    // sous un nom qui promet le contraire.
    const sansMoteur: Bac = { ...bacDe('auto', PODMAN), fournisseur: null };
    expect(sansMoteur.decision.isole, 'la prémisse : la décision dit ISOLÉ').toBe(true);
    expect(optionBac(sansMoteur, ['HOME']), 'un moteur absent ne se transmet pas').toEqual({});

    // Moitié 2 — un moteur est là, mais la décision dit NON isolé. Muté en
    // `&&`, on mettrait le travail en conteneur alors que la décision — donc
    // l'humain, par `HIVE_ISOLEMENT=off` — a dit non.
    const nonIsole: Bac = { ...bacDe('off', null), fournisseur: PODMAN };
    expect(nonIsole.decision.isole, 'la prémisse : la décision dit NON isolé').toBe(false);
    expect(
      optionBac(nonIsole, ['HOME']),
      'une décision négative prime sur un moteur présent',
    ).toEqual({});
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

describe('LE REFUS DE BAC À SABLE A SON PROPRE CODE DE SORTIE', () => {
  // ─── TROUVAILLE DE L'AUDIT #62, PROUVÉE EN EXÉCUTANT ───────────────────────
  //
  // Un nœud lancé avec `HIVE_ISOLEMENT=exige` sur une machine sans moteur de
  // conteneurs refuse bien de démarrer — mesuré, `PATH` vidé de podman et de
  // docker :
  //
  //     🛡  Isolement : HIVE_ISOLEMENT=exige et aucun moteur trouvé…
  //     ✘ Ce nœud ne démarre pas.
  //     CODE=1
  //
  // Or `codes-sortie.ts` décrit ce `1` comme « le fourre-tout, à n'utiliser
  // qu'en DERNIER RECOURS », et définit `REFUS_SECURITE` juste en dessous pour
  // ce cas exact. Le même fichier dit ce que la confusion coûte : un
  // superviseur ne peut plus distinguer « refusé pour raison de sécurité » de
  // n'importe quelle autre panne, et « la seule réponse possible devient
  // relancer et espérer ».
  //
  // Concrètement : `Restart=on-failure` voit 1, relance, le nœud refuse,
  // relance — sur une machine qui ne pourra JAMAIS travailler faute de moteur
  // de conteneurs. Un code dédié laisse le superviseur s'arrêter et prévenir
  // l'humain, seul capable d'installer podman.

  it('UN REFUS REND `REFUS_SECURITE`, PAS LE FOURRE-TOUT', () => {
    const bac = bacDe('exige', null);
    expect(bac.refuse, 'la prémisse : ce bac refuse bien').toBe(true);
    expect(bac.codeSortie, 'un refus de sécurité a son propre code').toBe(CODE.REFUS_SECURITE);
    expect(bac.codeSortie, 'et surtout pas le fourre-tout').not.toBe(CODE.ERREUR);
  });

  it('LA RÈGLE ELLE-MÊME, PRISE À LA SOURCE — pas la copie d’un banc', () => {
    // Ce test existe parce que le précédent, seul, laissait passer DEUX
    // mutations : le montage de banc fabriquait son `Bac` à la main, donc
    // recopiait la règle et jugeait sa propre copie. Mesuré, pas supposé.
    expect(codeDuBac(true), 'refus').toBe(CODE.REFUS_SECURITE);
    expect(codeDuBac(false), 'pas de refus').toBe(CODE.SUCCES);
    expect(codeDuBac(true), 'jamais le fourre-tout').not.toBe(CODE.ERREUR);
    expect(codeDuBac(true), 'et le code DÉPEND du refus').not.toBe(codeDuBac(false));
  });

  it('UN DÉMARRAGE NORMAL REND LE SUCCÈS — le code ne parle que du refus', () => {
    for (const [mode, f] of [
      ['exige', PODMAN],
      ['auto', PODMAN],
      ['auto', null],
      ['off', null],
    ] as const) {
      const bac = bacDe(mode, f);
      expect(bac.refuse, `${mode} + ${f ? f.nom : 'rien'} : ne refuse pas`).toBe(false);
      expect(bac.codeSortie, `${mode} + ${f ? f.nom : 'rien'}`).toBe(CODE.SUCCES);
    }
  });

  it('`preparerBac` APPLIQUE la règle — sans quoi elle serait juste et inutilisée', async () => {
    // Le chemin `off` ne sonde AUCUN moteur (`mode === 'off' ? null : …`) :
    // c'est le seul état de `preparerBac` qu'un banc puisse atteindre sans
    // dépendre de la machine qui l'exécute. Il suffit à prouver que le champ
    // est bien alimenté par la règle, et pas par une constante.
    const bac = await preparerBac({ HIVE_ISOLEMENT: 'off' });
    expect(bac.refuse, 'off ne refuse jamais').toBe(false);
    expect(bac.codeSortie, 'et rend le succès').toBe(CODE.SUCCES);
  });

  it('LE CÂBLAGE DE LA RÈGLE EST JUGÉ À LA SOURCE — le refus ne s’atteint pas sous banc', () => {
    // Dit franchement : l'état REFUSANT de `preparerBac` exige une machine SANS
    // moteur de conteneurs. Le banc ne peut pas le fabriquer sans sonder le
    // système, et un simulacre de sonde ne prouverait que le simulacre.
    //
    // Mesuré : remplacer `codeDuBac(decision.refuse)` par `codeDuBac(false)`
    // laissait tout le reste du fichier vert. C'est ce trou-là que cette garde
    // ferme — la seule chose qu'on puisse honnêtement vérifier ici, c'est que
    // l'argument passé est bien la décision.
    const s = source('bac.ts');
    expect(s, 'le code du bac doit venir de la règle').toContain('codeDuBac(decision.refuse)');
  });

  it('AUCUN CHEMIN DE DÉMARRAGE N’ÉCRIT SON CODE À LA MAIN', () => {
    // Le trou d'origine de ce fichier était un DUPLICATA : deux chemins, deux
    // copies, une dérive garantie — `join.ts` n'avait alors aucun bac du tout.
    // Le code de sortie vient donc de la décision, et cette garde empêche le
    // troisième chemin de naître avec un `1` recopié.
    for (const fichier of ['main.ts', 'join.ts']) {
      const s = source(fichier);
      const refus = /\.refuse\b[\s\S]{0,400}?process\.exit\(([^)]+)\)/.exec(s);
      expect(refus, `${fichier} : refus sans sortie ?`).not.toBeNull();
      expect(refus?.[1], `${fichier} : le code du refus doit venir du bac`).toContain(
        'bac.codeSortie',
      );
    }
  });
});
