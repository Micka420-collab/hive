// LA SÉQUENCE DU PAS 7/7 — pilotée par une ruche de laboratoire.
//
// ─── CE QUE CE BANC FERME ────────────────────────────────────────────────────
//
// `essai-travail.mjs` a déclaré DEUX FOIS ne garder que l'impur, et la loupe l'a
// démenti les deux fois : six DÉCISIONS d'abord, puis quatre lignes de CÂBLAGE
// — celles qui relient une décision à un refus.
//
//     if (r.status !== 200) rate(…)          l'instantané refusé
//     if (noeudsDe(avant).size === 0)        aucune ouvrière
//     for (… && doitAttendre(etat); i++)     la patience
//     if (defaut !== null) rate(…)           LE VERDICT IGNORÉ
//
// Elles étaient soudées à `fetch` : les jouer demandait une ruche installée, un
// port libre et 90 s. La séquence reçoit maintenant sa ruche, et ce banc lui en
// donne une qui refuse, qui n'a pas d'ouvrière, qui ne finit jamais, ou qui rend
// un travail sans preuve.
//
// Crible : cinq mutants posés ensemble, chacun vérifié posé, suite ENTIÈRE verte
// — 294 fichiers, 4 231 tests.
//
// ─── LA PIRE DES QUATRE ──────────────────────────────────────────────────────
//
//     if (defaut !== null) return rate(defaut);
//
// Inversée, la séquence CONSTATE le défaut et annonce quand même le succès. Un
// instrument de seuil qui ment est pire que pas d'instrument — c'est le défaut
// contre lequel ce pas a été écrit, et il était dans le pas lui-même.

import { describe, expect, it } from 'vitest';
import { TRAVAIL, menerLePas } from '../scripts/pas-travail.mjs';

/** Un diff crédible : la preuve que la ruche a produit. */
const DIFF = '--- a/miel.txt\n+++ b/miel.txt\n@@ -1 +1 @@\n-cire\n+miel\n';

const INSTANTANE = {
  projects: [{ id: 'p-1', name: 'Rucher' }],
  nodes: [{ id: 'n-ouvriere', name: 'ruche-nord' }],
  tasks: [{ id: 't-abcdef01', status: 'done' }],
  tasksTotal: 1,
};

/**
 * Une ruche de laboratoire.
 *
 * Chaque réponse est réglable, et `vues` retient ce qu'on lui a demandé — un
 * refus obtenu en ne demandant rien serait vert pour la mauvaise raison.
 */
function ruche(over = {}) {
  const vues = { instantanes: 0, creations: [], resultats: [], attentes: 0 };
  const base = {
    instantane: () => {
      vues.instantanes += 1;
      return Promise.resolve({ status: 200, corps: INSTANTANE });
    },
    creerTache: (projetId, travail) => {
      vues.creations.push({ projetId, travail });
      return Promise.resolve({ status: 201, corps: [{ id: 't-abcdef01' }], texte: '' });
    },
    resultats: (taskId) => {
      vues.resultats.push(taskId);
      return Promise.resolve({
        status: 200,
        corps: [{ nodeId: 'n-ouvriere', success: true, diff: DIFF }],
      });
    },
    // Aucune attente RÉELLE : un banc qui dort mesure la patience de qui
    // l'exécute, pas la garde qu'il prétend éprouver.
    patienter: () => {
      vues.attentes += 1;
      return Promise.resolve();
    },
  };
  return { ruche: { ...base, ...over }, vues };
}

describe('la séquence du pas 7/7 : ce qu’elle exige avant d’annoncer un succès', () => {
  it('UNE RUCHE QUI TRAVAILLE REND UN SUCCÈS — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const { ruche: r, vues } = ruche();
    const v = await menerLePas(r, 5);

    expect(v.ok, `la séquence refuse une ruche saine : ${v.raison ?? ''}`).toBe(true);
    expect(v.message, 'le nœud qui a travaillé n’est pas nommé').toContain('n-ouvriere');
    expect(v.message, 'la taille du diff n’est pas dite').toContain(String(DIFF.length));
    expect(vues.creations[0]?.projetId, 'le travail part sur un autre projet').toBe('p-1');
    expect(vues.creations[0]?.travail, 'le travail confié n’est pas celui qu’on nomme').toEqual(
      TRAVAIL,
    );
  });

  it('UN INSTANTANÉ REFUSÉ ARRÊTE LE PAS — on ne juge pas sur un corps nul', async () => {
    const { ruche: r, vues } = ruche({
      instantane: () => Promise.resolve({ status: 503, corps: null }),
    });
    const v = await menerLePas(r, 5);

    expect(v.ok, 'un instantané refusé laisse la séquence continuer').toBe(false);
    expect(v.raison, 'le statut refusé n’est pas dit').toContain('503');
    expect(vues.creations, 'une tâche est confiée malgré l’instantané refusé').toHaveLength(0);
  });

  it('AUCUNE OUVRIÈRE : ON NE CONFIE RIEN À PERSONNE', async () => {
    // Sans ce refus, la tâche resterait en file jusqu'à la patience entière, et
    // le verdict dirait « rien n'a bougé » — en accusant l'exécution alors que
    // personne n'était là pour exécuter.
    const { ruche: r, vues } = ruche({
      instantane: () => Promise.resolve({ status: 200, corps: { ...INSTANTANE, nodes: [] } }),
    });
    const v = await menerLePas(r, 5);

    expect(v.ok, 'une ruche sans ouvrière passe').toBe(false);
    expect(v.raison, 'l’absence d’ouvrière n’est pas nommée').toContain('aucune ouvrière');
    expect(vues.creations, 'un travail est confié à une ruche vide').toHaveLength(0);
  });

  it('LA PATIENCE BORNE VRAIMENT — et sa BORNE est le nombre de tours', async () => {
    // ─── LA BORNE (§ 9 tertrigicenties) ────────────────────────────────────
    //
    // `i < patienceS` contre `i <= patienceS` ne se départage que sur le COMPTE
    // exact des tours. Une tâche qui ne finit jamais en fait exactement
    // `patienceS`, pas un de plus — sinon la borne annoncée dans le refus
    // (« après N s ») ment sur ce qui a été attendu.
    const jamais = { ...INSTANTANE, tasks: [{ id: 't-abcdef01', status: 'running' }] };
    const { ruche: r, vues } = ruche({
      instantane: () => Promise.resolve({ status: 200, corps: jamais }),
    });
    const v = await menerLePas(r, 4);

    expect(v.ok, 'une tâche qui ne finit jamais passe').toBe(false);
    expect(v.raison, 'la lenteur n’est pas nommée').toContain('court encore');
    expect(vues.attentes, 'la patience n’est pas tenue au tour près').toBe(4);
  });

  it('DES RÉSULTATS REFUSÉS ARRÊTENT LE PAS', async () => {
    const { ruche: r } = ruche({ resultats: () => Promise.resolve({ status: 404, corps: null }) });
    const v = await menerLePas(r, 5);

    expect(v.ok, 'des résultats introuvables passent').toBe(false);
    expect(v.raison, 'le statut des résultats n’est pas dit').toContain('404');
  });

  it('LE VERDICT NE S’IGNORE PAS — un travail sans preuve n’est pas un succès', async () => {
    // ─── LA PIRE DES QUATRE ────────────────────────────────────────────────
    //
    // `if (defaut !== null) return rate(defaut)` inversé fait CONSTATER le
    // défaut puis annoncer le succès. La séquence saurait, et se tairait.
    //
    // Trois preuves manquantes, trois refus — chacune est un chemin distinct
    // de `defautDuTravail`, et le pas doit s'arrêter sur les trois.
    for (const [corps, quoi] of [
      [[], 'aucun résultat rangé'],
      [[{ nodeId: 'n-ouvriere', success: true, diff: '' }], 'un diff vide'],
      [[{ nodeId: 'n-fantome', success: true, diff: DIFF }], 'un nœud fantôme'],
    ]) {
      const { ruche: r } = ruche({ resultats: () => Promise.resolve({ status: 200, corps }) });
      const v = await menerLePas(r, 5);
      expect(v.ok, `${quoi} : le pas annonce quand même un succès`).toBe(false);
      expect(v.raison, `${quoi} : le refus ne dit rien`).toBeTruthy();
    }
  });

  it('UNE RUCHE SANS PROJET LE DIT — le pas 5/5 aurait dû en laisser un', async () => {
    const { ruche: r } = ruche({
      instantane: () => Promise.resolve({ status: 200, corps: { ...INSTANTANE, projects: [] } }),
    });
    const v = await menerLePas(r, 5);

    expect(v.ok, 'une ruche sans projet passe').toBe(false);
    expect(v.raison, 'le pas 5/5 n’est pas mis en cause').toContain('5/5');
  });

  it('UNE TÂCHE REFUSÉE, OU SANS IDENTIFIANT, ARRÊTE LE PAS', async () => {
    const refus = ruche({
      creerTache: () => Promise.resolve({ status: 500, corps: null, texte: 'la base est pleine' }),
    });
    const vRefus = await menerLePas(refus.ruche, 5);
    expect(vRefus.ok, 'un 500 passe pour une création réussie').toBe(false);
    expect(vRefus.raison, 'le texte du refus est perdu').toContain('la base est pleine');

    const muet = ruche({
      creerTache: () => Promise.resolve({ status: 201, corps: [], texte: '' }),
    });
    const vMuet = await menerLePas(muet.ruche, 5);
    expect(vMuet.ok, 'une création sans identifiant passe').toBe(false);
    expect(vMuet.raison, 'l’identifiant manquant n’est pas nommé').toContain('identifiant');
  });
});

// ─── LA DERNIÈRE LIGNE DU COUREUR ────────────────────────────────────────────
//
// La loupe a nommé sept nus dans `essai-travail.mjs`, puis quatre, puis UN : la
// garde d'usage. Elle ne descend pas dans un module — c'est la porte du script,
// et son sujet est un CODE DE SORTIE. On l'éprouve donc là où elle vit, en
// lançant vraiment le script.
//
// Précédent exact du dépôt : `premier-quart-heure.test.mjs`, même forme, même
// code 64, même `shell: false`.

import { spawnSync } from 'node:child_process';
import path from 'node:path';

// `process.cwd()` plutôt que `fileURLToPath(import.meta.url)` : sous happy-dom
// le second jette. Ce banc-ci n'est pas en happy-dom, mais la règle du dépôt se
// tient partout — un déplacement de fichier ne doit pas la réveiller.
const COUREUR = path.join(process.cwd(), 'scripts', 'essai-travail.mjs');

describe('la porte du coureur', () => {
  it('SANS --racine, l’instrument dit son usage et sort en 64', () => {
    // 64 = « on m'a mal appelé », distinct de 1 = « la mesure a échoué ». Les
    // confondre ferait passer une erreur d'invocation pour un défaut du produit
    // — et un pas de seuil qui accuse la ruche à tort est un instrument qui ment.
    //
    // Inversée, la garde laisse le pas continuer SANS racine : il irait lire un
    // `.env` sous `null` et rendrait une pile Node là où il faut une phrase.
    const v = spawnSync(process.execPath, [COUREUR], {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });

    expect(`${v.stdout}${v.stderr}`, 'l’usage n’est pas dit').toContain('usage :');
    expect(v.status, 'le code de sortie ne distingue pas le mauvais appel').toBe(64);
  });

  it('AVEC UNE RACINE QUI N’EXISTE PAS, CE N’EST PLUS 64 — le mauvais appel est passé', () => {
    // Le contre-monde, et il porte la moitié du sens : sans lui, une garde
    // toujours vraie rendrait 64 pour tout et le cas ci-dessus resterait vert.
    const v = spawnSync(process.execPath, [COUREUR, '--racine', '/nulle/part/du/tout'], {
      encoding: 'utf8',
      shell: false,
      timeout: 30_000,
    });

    expect(v.status, 'un appel BIEN formé est traité comme un mauvais appel').not.toBe(64);
  });
});
