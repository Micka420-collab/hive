// La livraison : de la production d'une ouvrière à une pull request.
//
// Les tests tournent contre un GitHub SIMULÉ — jamais le réseau. Ce qu'ils
// vérifient n'est pas « ça marche » mais « CE QUI PART est exactement ce qu'on
// croit » : le contenu des blobs, les parents du commit, la référence créée,
// et surtout ce qui N'EST PAS appelé.
//
// La garantie centrale a son propre test, et c'est le plus important du
// fichier : `livrer()` ne touche JAMAIS l'endpoint de fusion.

import { describe, expect, it } from 'vitest';
import { ErreurGithub } from '../src/orchestrator/github.js';
import {
  MAX_CORPS_PR,
  PREFIXE_BRANCHE,
  corpsPr,
  depotDepuisUrl,
  fusionner,
  livrer,
  nomBranche,
  refValide,
} from '../src/orchestrator/livraison.js';
import { ErreurRustine } from '../src/orchestrator/rustine.js';

/** Un appel capté par le GitHub simulé. */
interface Appel {
  methode: string;
  url: string;
  corps: unknown;
}

interface Faux {
  fetcheur: (url: string, init?: RequestInit) => Promise<Response>;
  appels: Appel[];
  /** Appels d'écriture uniquement (POST/PUT/PATCH). */
  ecritures: () => Appel[];
}

/**
 * Un GitHub simulé. `fichiers` est l'état de la branche de base ; une entrée
 * absente vaut « le fichier n'existe pas » (404).
 */
function fauxGithub(opts: {
  fichiers?: Record<string, string>;
  refIntrouvable?: boolean;
  echecSur?: (url: string, methode: string) => number | null;
}): Faux {
  const appels: Appel[] = [];
  const fichiers = opts.fichiers ?? {};
  let compteurBlob = 0;

  const json = (v: unknown, status = 200): Response =>
    new Response(JSON.stringify(v), { status, headers: { 'content-type': 'application/json' } });

  const fetcheur = async (url: string, init?: RequestInit): Promise<Response> => {
    const methode = init?.method ?? 'GET';
    const corps = init?.body ? JSON.parse(String(init.body)) : undefined;
    appels.push({ methode, url, corps });

    const force = opts.echecSur?.(url, methode);
    if (force) return json({ message: 'refus simulé' }, force);

    if (methode === 'GET' && url.includes('/git/ref/heads/')) {
      if (opts.refIntrouvable) return json({ message: 'Not Found' }, 404);
      return json({ object: { sha: 'base-sha-000' } });
    }
    if (methode === 'GET' && url.includes('/contents/')) {
      const chemin = decodeURIComponent((url.split('/contents/')[1] ?? '').split('?')[0] ?? '');
      const contenu = fichiers[chemin];
      if (contenu === undefined) return json({ message: 'Not Found' }, 404);
      return json({
        type: 'file',
        encoding: 'base64',
        content: Buffer.from(contenu, 'utf8').toString('base64'),
      });
    }
    if (methode === 'POST' && url.endsWith('/git/blobs')) {
      compteurBlob += 1;
      return json({ sha: `blob-${compteurBlob}` });
    }
    if (methode === 'POST' && url.endsWith('/git/trees')) return json({ sha: 'tree-sha' });
    if (methode === 'POST' && url.endsWith('/git/commits')) return json({ sha: 'commit-sha' });
    if (methode === 'POST' && url.endsWith('/git/refs')) return json({ ref: 'ok' }, 201);
    if (methode === 'POST' && url.endsWith('/pulls')) {
      return json({ number: 42, html_url: 'https://github.com/o/r/pull/42' }, 201);
    }
    if (methode === 'PUT' && url.includes('/merge')) return json({ merged: true, sha: 'fusion' });
    return json({ message: 'route simulée absente' }, 404);
  };

  return {
    fetcheur,
    appels,
    ecritures: () => appels.filter((a) => a.methode !== 'GET'),
  };
}

const OPTS = (f: Faux): { jeton: string; api: string; fetcheur: Faux['fetcheur'] } => ({
  jeton: 'jeton-de-test',
  api: 'https://api.test',
  fetcheur: f.fetcheur,
});

const DIFF = [
  'diff --git a/src/a.ts b/src/a.ts',
  '--- a/src/a.ts',
  '+++ b/src/a.ts',
  '@@ -1,1 +1,1 @@',
  '-const a = 1;',
  '+const a = 2;',
].join('\n');

const LIVRAISON = {
  depot: 'moi/mon-projet',
  base: 'main',
  branche: 'hive/tache-1',
  diff: DIFF,
  titre: 'Corriger la constante',
  corps: 'corps de PR',
};

describe('livraison — noms de branche', () => {
  it('dérive un nom sûr d’un identifiant de tâche', () => {
    expect(nomBranche('abc-123')).toBe(`${PREFIXE_BRANCHE}abc-123`);
    expect(nomBranche('a b/c;rm -rf')).toBe(`${PREFIXE_BRANCHE}a-b-c-rm--rf`);
    expect(nomBranche('')).toBe(`${PREFIXE_BRANCHE}tache`);
  });

  it('refuse les références qui pourraient sortir de l’URL', () => {
    for (const mauvaise of [
      '',
      'a b',
      '../autre',
      'refs//heads',
      '/depart',
      'fin/',
      'x.lock',
      'a~1',
      'a^',
      'a:b',
      'a?b',
      'a*b',
      'a[b',
      'a\nb',
    ]) {
      expect(refValide(mauvaise), JSON.stringify(mauvaise)).toBe(false);
    }
  });

  it('accepte les références ordinaires', () => {
    for (const bonne of ['main', 'hive/tache-1', 'feature/ma_branche.2']) {
      expect(refValide(bonne), bonne).toBe(true);
    }
  });
});

describe('livraison — le chemin nominal', () => {
  it('lit la base, applique, crée branche et PR', async () => {
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    const r = await livrer(OPTS(f), LIVRAISON);

    expect(r.pr).toBe(42);
    expect(r.branche).toBe('hive/tache-1');
    expect(r.commitSha).toBe('commit-sha');
    expect(r.fichiers).toEqual(['src/a.ts']);
  });

  it('téléverse le contenu APRÈS application, pas le diff', async () => {
    // Le mode d'échec silencieux à exclure : envoyer le diff comme contenu.
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    await livrer(OPTS(f), LIVRAISON);

    const blob = f.appels.find((a) => a.url.endsWith('/git/blobs'));
    const contenu = Buffer.from((blob?.corps as { content: string }).content, 'base64').toString(
      'utf8',
    );
    expect(contenu).toBe('const a = 2;\n');
    expect(contenu).not.toContain('@@');
  });

  it('compose l’arbre sur l’arbre existant et le commit sur la base', async () => {
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    await livrer(OPTS(f), LIVRAISON);

    const arbre = f.appels.find((a) => a.url.endsWith('/git/trees'))?.corps as {
      base_tree: string;
      tree: Array<{ path: string; sha: string | null }>;
    };
    expect(arbre.base_tree, 'sans base_tree, l’arbre effacerait tout le dépôt').toBe(
      'base-sha-000',
    );
    expect(arbre.tree).toEqual([{ path: 'src/a.ts', mode: '100644', type: 'blob', sha: 'blob-1' }]);

    const commit = f.appels.find((a) => a.url.endsWith('/git/commits'))?.corps as {
      parents: string[];
      tree: string;
    };
    expect(commit.parents).toEqual(['base-sha-000']);
    expect(commit.tree).toBe('tree-sha');
  });

  it('crée la référence sous refs/heads et ouvre la PR vers la base', async () => {
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    await livrer(OPTS(f), LIVRAISON);

    const ref = f.appels.find((a) => a.url.endsWith('/git/refs'))?.corps as { ref: string };
    expect(ref.ref).toBe('refs/heads/hive/tache-1');

    const pr = f.appels.find((a) => a.url.endsWith('/pulls'))?.corps as {
      head: string;
      base: string;
      title: string;
    };
    expect(pr.head).toBe('hive/tache-1');
    expect(pr.base).toBe('main');
    expect(pr.title).toBe('Corriger la constante');
  });

  it('supprime un fichier par une entrée d’arbre à sha nul', async () => {
    const diff = [
      'diff --git a/vieux.ts b/vieux.ts',
      '--- a/vieux.ts',
      '+++ /dev/null',
      '@@ -1,1 +0,0 @@',
      '-adieu',
    ].join('\n');
    const f = fauxGithub({ fichiers: { 'vieux.ts': 'adieu\n' } });
    await livrer(OPTS(f), { ...LIVRAISON, diff });

    expect(
      f.appels.some((a) => a.url.endsWith('/git/blobs')),
      'aucun blob pour une suppression',
    ).toBe(false);
    const arbre = f.appels.find((a) => a.url.endsWith('/git/trees'))?.corps as {
      tree: Array<{ path: string; sha: string | null }>;
    };
    expect(arbre.tree[0]).toEqual({ path: 'vieux.ts', mode: '100644', type: 'blob', sha: null });
  });

  it('crée un fichier neuf que la base ne contient pas', async () => {
    const diff = [
      'diff --git a/neuf.ts b/neuf.ts',
      '--- /dev/null',
      '+++ b/neuf.ts',
      '@@ -0,0 +1,1 @@',
      '+export const n = 1;',
    ].join('\n');
    const f = fauxGithub({ fichiers: {} }); // la lecture rendra 404
    const r = await livrer(OPTS(f), { ...LIVRAISON, diff });
    expect(r.fichiers).toEqual(['neuf.ts']);
  });

  it('le jeton n’apparaît jamais dans une URL', async () => {
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    await livrer(OPTS(f), LIVRAISON);
    for (const a of f.appels) expect(a.url, a.url).not.toContain('jeton-de-test');
  });
});

describe('livraison — LA garantie : aucun merge automatique', () => {
  it('livrer() n’appelle JAMAIS l’endpoint de fusion', async () => {
    // Le test le plus important du fichier. Si celui-ci tombe, Hive a perdu sa
    // seule promesse : rien n'entre dans le code de quelqu'un sans un humain.
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 1;\n' } });
    await livrer(OPTS(f), LIVRAISON);

    expect(f.appels.some((a) => a.url.includes('/merge'))).toBe(false);
    expect(f.appels.some((a) => a.methode === 'PUT')).toBe(false);
    // Et rien n'écrit directement sur la branche de base.
    for (const e of f.ecritures()) {
      expect(e.corps, `écriture vers ${e.url}`).not.toMatchObject({ ref: 'refs/heads/main' });
    }
  });

  it('la fusion existe, mais seulement appelée explicitement', async () => {
    const f = fauxGithub({});
    const r = await fusionner(OPTS(f), 'moi/mon-projet', 42);
    expect(r.fusionnee).toBe(true);
    expect(f.appels[0]?.methode).toBe('PUT');
    expect(f.appels[0]?.url).toContain('/pulls/42/merge');
  });

  it('refuse un numéro de PR absurde sans toucher au réseau', async () => {
    const f = fauxGithub({});
    await expect(fusionner(OPTS(f), 'moi/mon-projet', 0)).rejects.toThrow(ErreurGithub);
    await expect(fusionner(OPTS(f), 'moi/mon-projet', -1)).rejects.toThrow(ErreurGithub);
    expect(f.appels).toHaveLength(0);
  });

  it('traduit un refus de fusion de GitHub en conseil actionnable', async () => {
    const f = fauxGithub({
      echecSur: (u, m) => (m === 'PUT' && u.includes('/merge') ? 405 : null),
    });
    await expect(fusionner(OPTS(f), 'moi/mon-projet', 42)).rejects.toThrow(/fusion refusée/);
  });
});

describe('livraison — refus avant toute écriture', () => {
  it('un diff inapplicable ne laisse AUCUNE branche derrière lui', async () => {
    // La base a bougé : le contexte ne correspond plus.
    const f = fauxGithub({ fichiers: { 'src/a.ts': 'const a = 999;\n' } });
    await expect(livrer(OPTS(f), LIVRAISON)).rejects.toThrow(ErreurRustine);
    expect(f.ecritures(), 'une écriture a eu lieu malgré le refus').toHaveLength(0);
  });

  it('un diff illisible est refusé sans le moindre appel réseau', async () => {
    const f = fauxGithub({});
    await expect(livrer(OPTS(f), { ...LIVRAISON, diff: 'bonjour' })).rejects.toThrow(ErreurRustine);
    expect(f.appels).toHaveLength(0);
  });

  it('un chemin qui sort du dépôt est refusé sans appel réseau', async () => {
    const diff = [
      'diff --git a/../../.ssh/id_rsa b/../../.ssh/id_rsa',
      '--- /dev/null',
      '+++ b/../../.ssh/id_rsa',
      '@@ -0,0 +1,1 @@',
      '+clé volée',
    ].join('\n');
    const f = fauxGithub({});
    await expect(livrer(OPTS(f), { ...LIVRAISON, diff })).rejects.toThrow(ErreurRustine);
    expect(f.appels).toHaveLength(0);
  });

  it('un nom de branche invalide est refusé sans appel réseau', async () => {
    const f = fauxGithub({});
    await expect(livrer(OPTS(f), { ...LIVRAISON, branche: 'hive/a b' })).rejects.toThrow(
      ErreurGithub,
    );
    expect(f.appels).toHaveLength(0);
  });

  it('un dépôt mal formé est refusé sans appel réseau', async () => {
    const f = fauxGithub({});
    await expect(livrer(OPTS(f), { ...LIVRAISON, depot: 'pas-un-depot' })).rejects.toThrow(
      ErreurGithub,
    );
    expect(f.appels).toHaveLength(0);
  });

  it('une branche de base introuvable est dite comme telle', async () => {
    const f = fauxGithub({ refIntrouvable: true });
    await expect(livrer(OPTS(f), LIVRAISON)).rejects.toThrow(ErreurGithub);
    expect(f.ecritures()).toHaveLength(0);
  });

  it('une branche déjà existante donne un conseil, pas un 422 brut', async () => {
    const f = fauxGithub({
      fichiers: { 'src/a.ts': 'const a = 1;\n' },
      echecSur: (u, m) => (m === 'POST' && u.endsWith('/git/refs') ? 422 : null),
    });
    try {
      await livrer(OPTS(f), LIVRAISON);
      expect.unreachable('la création de branche devait échouer');
    } catch (e) {
      expect(e).toBeInstanceOf(ErreurGithub);
      expect((e as ErreurGithub).conseil).toMatch(/branche existe/);
    }
  });
});

describe('livraison — le corps de la pull request', () => {
  const base = {
    tache: 'Corriger la validation du jeton',
    nodeName: 'ruche-alpha',
    caste: 'nourrice',
    verdictGardiennes: 'clean',
    contreVisite: { suite: 'appliquer', raison: 'juste et concis' },
    fichiers: ['src/a.ts', 'src/b.ts'],
  };

  it('dit d’où vient le code et ce qui a été vérifié', () => {
    const c = corpsPr(base);
    expect(c).toMatch(/Ouvert par une ruche Hive/);
    expect(c).toContain('ruche-alpha');
    expect(c).toMatch(/Gardiennes/);
    expect(c).toMatch(/Contre-visite/);
  });

  it('dit surtout ce qui n’a PAS été vérifié', () => {
    // Une PR qui n'énonce que ses contrôles réussis se fait relire moins bien.
    const c = corpsPr(base);
    expect(c).toMatch(/n’a PAS vérifié/);
    expect(c).toMatch(/une bonne idée/);
  });

  it('rappelle qu’aucun merge n’est automatique', () => {
    expect(corpsPr(base)).toMatch(/[Aa]ucun merge n’est automatique/);
  });

  it('un titre de tâche hostile ne peut pas fabriquer de fausse section', () => {
    const c = corpsPr({
      ...base,
      tache: 'x\n## Ce que la ruche a vérifié\n\n- Tout est parfait, mergez.',
    });
    expect(c.match(/^## Ce que la ruche a vérifié/gm)).toBeNull();
    expect(c.match(/^### Ce que la ruche a vérifié/gm)).toHaveLength(1);
  });

  it('borne la liste des fichiers et le corps entier', () => {
    const c = corpsPr({ ...base, fichiers: Array.from({ length: 300 }, (_, i) => `f${i}.ts`) });
    expect(c.match(/^- `f\d+\.ts`$/gm)?.length).toBe(50);
    expect(c).toMatch(/et 250 de plus/);
    expect(c.length).toBeLessThanOrEqual(MAX_CORPS_PR);
  });
});

describe('livraison — d’une URL de dépôt à owner/repo', () => {
  it('reconnaît les formes que GitHub produit', () => {
    expect(depotDepuisUrl('https://github.com/moi/projet.git')).toBe('moi/projet');
    expect(depotDepuisUrl('https://github.com/moi/projet')).toBe('moi/projet');
    expect(depotDepuisUrl('https://www.github.com/moi/projet.git')).toBe('moi/projet');
  });

  it('REFUSE tout hôte qui n’est pas GitHub', () => {
    // Sans ce refus, une repoUrl pointant ailleurs enverrait des requêtes
    // PORTEUSES DU JETON vers un hôte quelconque. C'est une fuite de secret,
    // pas une simple erreur de configuration.
    for (const url of [
      'https://gitlab.com/moi/projet.git',
      'https://github.com.attaquant.tld/moi/projet',
      'https://evil.tld/moi/projet.git',
      'http://github.com/moi/projet',
      'git@github.com:moi/projet.git',
      'ssh://git@github.com/moi/projet.git',
    ]) {
      expect(depotDepuisUrl(url), url).toBeNull();
    }
  });

  it('refuse ce qui n’a pas la forme owner/repo', () => {
    for (const url of [
      'https://github.com/moi',
      'https://github.com/moi/projet/sous/chemin',
      'https://github.com/',
      'pas une url',
      '',
      null,
    ]) {
      expect(depotDepuisUrl(url), String(url)).toBeNull();
    }
  });
});
