// LES BORNES DE github.ts — sept gardes nues sous le chemin d'écriture.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Balayage élargi de `src/orchestrator/github.ts`, base épinglée `3f23478`
// (parent de `3135684`, création du fichier) : **32 mutations, 32 examinées,
// 25 défendues, 7 NUES**.
//
// Ce module est celui sur lequel `livraison.ts` s'appuie — `estFullName`,
// `expliquerStatut`, `ErreurGithub`, `entetes`. Le lot précédent a fermé six
// nues au-dessus ; celles-ci sont une couche en dessous, sur le même chemin.
//
// Les sept, et ce que chacune coûte :
//
//   · `texte(d.name, MAX_NOM) || fullName`  → `&&`
//     Le nom affiché d'un dépôt. Avec `&&`, un dépôt qui PORTE un nom se voit
//     affublé de son `full_name`, et un dépôt sans nom devient une ligne vide
//     dans la liste où l'humain choisit.
//
//   · `!Number.isInteger(numero) || numero <= 0`  → `&&`
//     Le refus n'a plus lieu que si les DEUX conditions tombent. `1.5` passe
//     la validation et part dans une URL d'API.
//
//   · `numero <= 0`  → `< 0`
//     Zéro passe. `/issues/0` n'est pas une issue.
//
//   · `lot.length < PAR_PAGE`  → `<=`
//     Une page PLEINE arrête la pagination. Un dépôt de plus de cent workflows
//     n'en montre que cent — et « ce dépôt n'a que ces workflows-là » est un
//     mensonge que rien ne signale, exactement le défaut que le commentaire
//     d'à côté met en garde contre pour la forme enveloppée.
//
//   · `o.limite ?? 20`  → `||`
//     `??` ne se déclenche que sur `null`/`undefined` ; `||` se déclenche aussi
//     sur `0`. Une limite explicite de zéro devient vingt.
//
//   · les `>` de deux CONSEILS (« un entier > 0 »)
//     Dans des chaînes, pas dans des comparaisons. La ruche demanderait un
//     entier « >= 0 » avant de refuser zéro. Ce sont des sorties, pas des
//     équivalents — même raisonnement qu'au lot `livraison.ts`.
//
// ─── LE FAUX FETCHEUR NOTE LES URL ───────────────────────────────────────────
//
// Deux des sept ne se voient QUE dans l'URL appelée (`per_page`), pas dans la
// valeur rendue. Le faux fetcheur garde donc ce qu'on lui demande.

import { describe, expect, it } from 'vitest';
import {
  ErreurGithub,
  lireDepot,
  lireRuns,
  lireUneIssue,
  listerWorkflows,
  PAR_PAGE,
} from '../src/orchestrator/github.js';
import type { Fetcheur } from '../src/orchestrator/github.js';

const DEPOT = 'Micka420-collab/hive';
const OPTS = { jeton: 'jeton-de-banc-assez-long-pour-passer', api: 'https://exemple.invalid' };

function reponse(corps: unknown, status = 200): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: () => null },
    json: async () => corps,
  } as unknown as Response;
}

/** Garde les URL demandées — deux nues ne se lisent que là. */
function fetcheurQuiNote(corps: (url: string) => unknown): { f: Fetcheur; urls: string[] } {
  const urls: string[] = [];
  const f: Fetcheur = async (url: string) => {
    urls.push(url);
    return reponse(corps(url));
  };
  return { f, urls };
}

describe('lireDepot — le nom affiché, et son repli', () => {
  const socle = {
    full_name: DEPOT,
    clone_url: 'https://github.com/Micka420-collab/hive.git',
  };

  // MUTANT : `||` → `&&`.
  it('garde le nom court quand le dépôt en porte un', () => {
    expect(lireDepot({ ...socle, name: 'hive' })?.nom).toBe('hive');
  });

  it('retombe sur le full_name quand le nom est absent', () => {
    expect(lireDepot(socle)?.nom).toBe(DEPOT);
  });
});

describe('lireUneIssue — ce qu’est un numéro d’issue', () => {
  const { f } = fetcheurQuiNote(() => ({ number: 1, title: 't' }));

  // MUTANT : `||` → `&&`. Avec `&&`, un non-entier POSITIF passe.
  it('refuse un numéro non entier', async () => {
    await expect(lireUneIssue({ ...OPTS, fetcheur: f }, DEPOT, 1.5)).rejects.toBeInstanceOf(
      ErreurGithub,
    );
  });

  // MUTANT : `<=` → `<`. Avec `<`, zéro passe.
  it('refuse zéro', async () => {
    await expect(lireUneIssue({ ...OPTS, fetcheur: f }, DEPOT, 0)).rejects.toBeInstanceOf(
      ErreurGithub,
    );
  });

  // MUTANT : le `>` de la chaîne de conseil.
  it('dit ce qu’est un numéro valide, au caractère près', async () => {
    await expect(lireUneIssue({ ...OPTS, fetcheur: f }, DEPOT, -1)).rejects.toMatchObject({
      statut: 400,
      conseil: 'Un numéro d’issue est un entier > 0.',
    });
  });
});

describe('listerWorkflows — une page PLEINE n’arrête pas la pagination', () => {
  // MUTANT : `<` → `<=`. À `lot.length === PAR_PAGE`, le mutant sort de la
  // boucle et la seconde page n'est jamais demandée.
  //
  // La mise en scène est asymétrique À DESSEIN : une première page PLEINE
  // (PAR_PAGE éléments) et une seconde page courte. Avec deux pages courtes,
  // les deux mondes rendraient le même total — du décor.
  function page(n: number, combien: number): unknown {
    return {
      total_count: combien,
      workflows: Array.from({ length: combien }, (_, i) => ({
        id: n * 1000 + i + 1,
        name: `p${n}-w${i}`,
        path: `.github/workflows/p${n}-w${i}.yml`,
        state: 'active',
        html_url: `https://github.com/${DEPOT}/actions/workflows/${n}-${i}.yml`,
      })),
    };
  }

  it('demande la page suivante et rend les deux', async () => {
    // ⚠ L'ANCRE PORTE L'ESPERLUETTE. `url.includes('page=1')` est VRAI pour
    // `per_page=100` — « per_**page=1**00 » — donc toutes les pages auraient
    // rendu la première. Le banc l'a dit tout de suite (300 au lieu de 103) ;
    // sans le bord asymétrique, il aurait passé en ne mesurant rien.
    const { f } = fetcheurQuiNote((url) =>
      url.endsWith('&page=1') ? page(1, PAR_PAGE) : page(2, 3),
    );
    const { workflows } = await listerWorkflows({ ...OPTS, fetcheur: f }, DEPOT);
    expect(workflows).toHaveLength(PAR_PAGE + 3);
    expect(workflows.some((w) => w.nom === 'p2-w0')).toBe(true);
  });

  it('s’arrête sur une page incomplète', async () => {
    const { f, urls } = fetcheurQuiNote(() => page(1, 2));
    const { workflows } = await listerWorkflows({ ...OPTS, fetcheur: f }, DEPOT);
    expect(workflows).toHaveLength(2);
    expect(urls).toHaveLength(1);
  });
});

describe('lireRuns — une limite de zéro est une limite', () => {
  const corps = () => ({ total_count: 0, workflow_runs: [] });

  // MUTANT : `??` → `||`. `||` avale le zéro et le remplace par vingt.
  it('borne à 1 quand la limite demandée est zéro', async () => {
    const { f, urls } = fetcheurQuiNote(corps);
    await lireRuns({ ...OPTS, fetcheur: f }, DEPOT, { limite: 0 });
    expect(urls[0]).toContain('per_page=1');
  });

  it('retombe sur vingt quand aucune limite n’est donnée', async () => {
    const { f, urls } = fetcheurQuiNote(corps);
    await lireRuns({ ...OPTS, fetcheur: f }, DEPOT);
    expect(urls[0]).toContain('per_page=20');
  });

  // MUTANT : le `>` de la chaîne de conseil du workflowId.
  it('dit ce qu’est un identifiant de workflow, au caractère près', async () => {
    const { f } = fetcheurQuiNote(corps);
    await expect(
      lireRuns({ ...OPTS, fetcheur: f }, DEPOT, { workflowId: 0 }),
    ).rejects.toMatchObject({
      statut: 400,
      conseil: 'Un identifiant de workflow est un entier > 0 — jamais un nom de fichier.',
    });
  });
});

// ─── LES DEUX NUES QUE LA LOUPE NE POUVAIT PAS VOIR ──────────────────────────
//
// Ce fichier a d'abord fermé sept nues d'un balayage à 32 candidates. La règle
// de mutation ignorait alors les opérateurs en FIN de ligne (§ 9
// septuagicenties) — or les deux gardes ci-dessous sont écrites sur plusieurs
// lignes, la forme que Prettier impose :
//
//     const lot =
//       typeof brut === 'object' &&
//       brut !== null &&
//       Array.isArray((brut as Record<string, unknown>).workflows)
//
// Règle corrigée, le même fichier rend **36 candidates** au lieu de 32, et
// deux des quatre nouvelles sont NUES. Ce sont exactement les deux occurrences
// que le recensement du § 9 octosexagicenties avait nommées « jamais mutées ».
//
// Ce qui casse, dans les deux cas : `typeof null === 'object'` rend VRAI, donc
// c'est le `&&` qui écarte `null`. Muté en `||`, la précédence fait tomber le
// garde-fou — `a || (b && c)` d'un côté, `(a && b) || c` de l'autre — et
// l'indexation de `null` LÈVE. Une réponse JSON valant littéralement `null`
// (un corps « null », que `rep.json()` rend tel quel) fait donc mourir la
// lecture au lieu de rendre une liste vide.
describe('une réponse JSON valant `null` ne doit pas faire LEVER la lecture', () => {
  function fetcheurNul(): Fetcheur {
    return async () => reponse(null);
  }

  it('listerWorkflows rend une liste vide plutôt que de lever', async () => {
    const { workflows, tronque } = await listerWorkflows(
      { ...OPTS, fetcheur: fetcheurNul() },
      DEPOT,
    );
    expect(workflows).toEqual([]);
    expect(tronque).toBe(false);
  });

  it('lireRuns rend une liste vide plutôt que de lever', async () => {
    const runs = await lireRuns({ ...OPTS, fetcheur: fetcheurNul() }, DEPOT);
    expect(runs).toEqual([]);
  });
});
