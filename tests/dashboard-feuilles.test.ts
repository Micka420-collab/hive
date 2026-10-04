// LES FEUILLES DU TABLEAU DE BORD — ce qu'aucun compilateur ne lit.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// `tsc`, ESLint et Vitest ne lisent pas une cascade CSS. Six défauts y
// vivaient donc en paix, tous visibles à l'écran et tous invisibles à la CI :
//
//   · QUINZE jetons lus sans jamais avoir été posés (`var(--text-muted, #aaa)`,
//     `var(--surface-raised, …)`…). Chaque règle vivait de son repli — et
//     plusieurs replis étaient ceux d'un thème SOMBRE : l'indice des étapes
//     d'onboarding, gris #aaa sur crème, tombait à 2,08:1 ;
//   · la pastille d'alerte « critique », chiffre blanc sur rouge vif : 3,6:1,
//     la plus urgente des trois était la moins lisible ; et la pastille « info »,
//     un gris pour la crème posé sur l'encre de la barre : 3,2:1 ;
//   · trois surfaces en verre (`backdrop-filter`) sans repli : sans flou, il ne
//     restait que leur transparence, et le texte défilait lisible À TRAVERS ;
//   · vingt-quatre `@keyframes`, et la garde `prefers-reduced-motion` recopiée
//     à la main, règle par règle — le tiroir, les modales, le graphe d'essaim
//     et presque toutes les transitions y avaient échappé ;
//   · `.mc-sidebar-brand` déclarée DEUX fois, en ligne puis en colonne, parce
//     que la marque et le nom qu'elle contient portaient la même classe ;
//   · le dialogue du secret de la Chambre, monté par `Voile` hors de
//     `.ch-view`, lisait des jetons `--ch-…` qui n'existent QUE dans `.ch-view` :
//     sans fond ni bordure, il flottait transparent sur le voile. La garde 1
//     ne pouvait pas le voir — le jeton était bien posé, mais ailleurs.
//
// Chaque garde ci-dessous rougissait sur l'arbre d'avant ce lot. Les cas
// « LE RELEVÉ TROUVE… » et « …ET CETTE FEUILLE-LÀ » passaient déjà : ils ne
// jugent rien, ils vérifient que les gardes ont quelque chose à garder.

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../dashboard/src/', import.meta.url));
const lire = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');

/** Les commentaires `/* … *\/` retirés : un jeton CITÉ dans une explication n'est pas lu. */
const sansCommentaires = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

/** Tous les fichiers de `dashboard/src`, chemins relatifs, récursivement. */
function fichiers(dossier = ''): string[] {
  return readdirSync(path.join(SRC, dossier), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? fichiers(path.join(dossier, e.name)) : [path.join(dossier, e.name)],
  );
}

// ─── Une cascade, lue juste assez pour la juger ──────────────────────────────

interface Regle {
  prelude: string;
  /** Les déclarations d'une règle ordinaire. */
  corps?: string;
  /** Les règles d'un `@media` / `@supports`. */
  enfants?: Regle[];
}

/**
 * Le découpage d'une feuille en règles, `@media` et `@supports` compris.
 * Juste assez de CSS pour ces gardes : pas de chaînes contenant des
 * accolades dans ces feuilles, et les commentaires sont retirés d'abord.
 */
function analyser(css: string): Regle[] {
  const out: Regle[] = [];
  let i = 0;
  for (;;) {
    const ouvre = css.indexOf('{', i);
    if (ouvre < 0) return out;
    const prelude = css.slice(i, ouvre).trim();
    let profondeur = 1;
    let j = ouvre + 1;
    for (; j < css.length && profondeur > 0; j++) {
      if (css[j] === '{') profondeur += 1;
      else if (css[j] === '}') profondeur -= 1;
    }
    const interieur = css.slice(ouvre + 1, j - 1);
    out.push(
      /^@(media|supports)\b/.test(prelude)
        ? { prelude, enfants: analyser(interieur) }
        : { prelude, corps: interieur },
    );
    i = j;
  }
}

const selecteurs = (r: Regle): string[] => r.prelude.split(',').map((s) => s.trim());

/** Les déclarations d'une règle, propriété → valeur. */
function declarations(corps: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const brut of corps.split(';')) {
    const deux = brut.indexOf(':');
    if (deux > 0) m.set(brut.slice(0, deux).trim(), brut.slice(deux + 1).trim());
  }
  return m;
}

/** La règle de premier niveau qui nomme exactement ce sélecteur. */
function regle(feuille: Regle[], selecteur: string): Map<string, string> {
  const r = feuille.find((x) => x.corps !== undefined && selecteurs(x).includes(selecteur));
  expect(r, `règle « ${selecteur} » introuvable`).toBeTruthy();
  return declarations(r?.corps ?? '');
}

const STYLES = analyser(sansCommentaires(lire('styles.css')));
/** Les jetons posés sur `:root` — lus à l'intérieur d'un cas, où `expect` a un sens. */
const racine = (): Map<string, string> => regle(STYLES, ':root');

/**
 * Une couleur, jetons résolus EXACTEMENT comme le navigateur les résout : un
 * jeton posé l'emporte, un jeton jamais posé laisse passer son repli. C'est ce
 * second chemin qui rendait #aaa à l'écran — le juger autrement serait juger
 * un écran qui n'existe pas.
 */
function couleur(valeur: string): string {
  const v = valeur.trim();
  const jeton = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v);
  if (jeton) {
    const pose = racine().get(jeton[1] ?? '');
    if (pose !== undefined) return couleur(pose);
    expect(jeton[2], `${jeton[1]} n'est pas posé et n'a pas de repli`).toBeTruthy();
    return couleur(jeton[2] ?? '');
  }
  expect(v, `couleur non résoluble ici : ${v}`).toMatch(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  return v;
}

/** Contraste WCAG 2.x entre deux couleurs hexadécimales. */
function contraste(a: string, b: string): number {
  const lum = (hex: string): number => {
    const h = hex.replace('#', '');
    const plein = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
    const [r, g, bl] = [0, 2, 4].map((k) => {
      const c = parseInt(plein.slice(k, k + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [clair, sombre] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((clair ?? 0) + 0.05) / ((sombre ?? 0) + 0.05);
}

// ─── 1. AUCUN JETON LU SANS AVOIR ÉTÉ POSÉ ───────────────────────────────────

describe('les jetons du tableau de bord', () => {
  const lus = new Map<string, Set<string>>();
  const poses = new Set<string>();
  for (const rel of fichiers()) {
    if (!/\.(css|tsx?)$/.test(rel)) continue;
    const src = sansCommentaires(lire(rel));
    for (const m of src.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const nom = m[1] ?? '';
      lus.set(nom, (lus.get(nom) ?? new Set()).add(rel));
    }
    // Une déclaration CSS (`--x:`), ou une propriété posée depuis React
    // (`style={{ '--x': … }}`) — les deux posent le jeton pour de bon.
    for (const m of src.matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)) poses.add(m[1] ?? '');
    for (const m of src.matchAll(/['"](--[\w-]+)['"]\s*:/g)) poses.add(m[1] ?? '');
  }

  it('LE RELEVÉ TROUVE LES JETONS — sinon la garde est creuse', () => {
    expect(lus.size, 'aucun `var(--…)` lu dans dashboard/src').toBeGreaterThan(40);
    for (const pilier of ['--bg', '--panel', '--text', '--muted', '--miel', '--encre']) {
      expect(poses.has(pilier), `${pilier} n'est plus posé nulle part`).toBe(true);
    }
  });

  it('AUCUN `var(--x)` NE LIT UN JETON QUE PERSONNE NE POSE', () => {
    // Un jeton jamais posé ne casse rien de visible au premier regard : la
    // règle vit de son repli. C'est exactement pourquoi quinze d'entre eux ont
    // survécu — et pourquoi ce repli, écrit pour un autre thème, a fini par
    // rendre des textes illisibles. On ne juge pas le repli : on exige le jeton.
    const orphelins = [...lus]
      .filter(([nom]) => !poses.has(nom))
      .map(([nom, ou]) => `${nom} (${[...ou].join(', ')})`);
    expect(orphelins, `jetons lus mais jamais posés : ${orphelins.join(' · ')}`).toEqual([]);
  });

  it('AUCUN JETON N’EST POSÉ SANS QUE PERSONNE LE LISE — hors réserve nommée', () => {
    // Le pendant de la garde précédente. Un jeton posé et jamais lu promet un
    // rôle que rien ne tient : on le croit câblé, on le règle, rien ne bouge.
    // La RÉSERVE nomme ceux qui attendent leurs lecteurs, avec la raison ; elle
    // ne fait que rétrécir — un jeton réservé qui trouve un lecteur doit en
    // sortir (sinon la liste ment à son tour).
    const RESERVE = new Map([
      // Les séries de graphes (docs/DIRECTION-ARTISTIQUE.md, « Graphes ») :
      // posées et jugées en contraste dans les deux thèmes, câblées par les
      // lots d'écrans qui refont les graphes (essaim, balance).
      ...[1, 2, 3, 4, 5, 6].map((n): [string, string] => [`--graphe-${n}`, 'séries de graphes']),
    ]);
    const muets = [...poses].filter((nom) => !lus.has(nom) && !RESERVE.has(nom));
    expect(muets, `jetons posés mais jamais lus : ${muets.join(' · ')}`).toEqual([]);
    const sortis = [...RESERVE.keys()].filter((nom) => lus.has(nom) || !poses.has(nom));
    expect(sortis, `à retirer de la réserve : ${sortis.join(' · ')}`).toEqual([]);
  });
});

// ─── 2. LES DEUX DÉFAUTS DE CONTRASTE QUE LES ORPHELINS CACHAIENT ────────────

describe('ce que les jetons rendent lisible', () => {
  it('L’INDICE D’UNE ÉTAPE D’ONBOARDING SE LIT SUR LA CRÈME ET SUR LE PANNEAU', () => {
    // `.onboarding-hint` : le texte qui dit QUOI FAIRE à l'étape en cours.
    // AA exige 4,5:1 pour un texte courant ; le #aaa hérité rendait 2,08:1.
    const encart = regle(analyser(sansCommentaires(lire('onboarding.css'))), '.onboarding-hint');
    const texte = couleur(encart.get('color') ?? '');
    for (const fond of ['--bg', '--panel']) {
      const c = contraste(texte, couleur(`var(${fond})`));
      expect(c, `indice d'onboarding sur ${fond} : ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('LES TROIS PASTILLES D’ALERTE SE LISENT SUR LA BARRE D’ENCRE', () => {
    // Un chiffre de 10 px : AA exige 4,5:1. Et la pastille pleine doit se
    // détacher de la barre (3:1, contraste d'un élément non textuel).
    const encre = couleur('var(--encre)');
    for (const gravite of ['critique', 'attention']) {
      const p = regle(STYLES, `.mc-nav-badge--${gravite}`);
      const fond = couleur(p.get('background') ?? '');
      const chiffre = contraste(couleur(p.get('color') ?? ''), fond);
      expect(chiffre, `chiffre ${gravite} : ${chiffre.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      const detache = contraste(fond, encre);
      expect(
        detache,
        `pastille ${gravite} sur l'encre : ${detache.toFixed(2)}:1`,
      ).toBeGreaterThanOrEqual(3);
    }
    // La pastille « info » est CREUSE : son chiffre est posé sur l'encre même.
    const info = regle(STYLES, '.mc-nav-badge--info');
    expect(info.get('background')).toBe('transparent');
    const c = contraste(couleur(info.get('color') ?? ''), encre);
    expect(c, `chiffre info sur l'encre : ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});

// ─── 3. SANS FLOU, PAS DE VERRE ──────────────────────────────────────────────

describe('le verre du tableau de bord a un repli', () => {
  /** Les sélecteurs qui posent un flou d'arrière-plan, au premier niveau. */
  const verres = STYLES.filter((r) => r.corps !== undefined && /backdrop-filter\s*:/.test(r.corps))
    .flatMap(selecteurs)
    .sort();

  const repli = STYLES.find(
    (r) => r.prelude.startsWith('@supports not') && r.prelude.includes('backdrop-filter'),
  );

  it('LE RELEVÉ TROUVE LES SURFACES EN VERRE', () => {
    expect(
      verres,
      'plus aucun `backdrop-filter` au premier niveau : la garde est creuse',
    ).not.toEqual([]);
  });

  it('UN `@supports not` TESTE LES DEUX ÉCRITURES DU FLOU', () => {
    // Safari a longtemps exigé le préfixe : ne tester que la forme nue ferait
    // basculer au repli un moteur qui floute très bien.
    expect(repli, 'aucun `@supports not (backdrop-filter…)`').toBeTruthy();
    expect(repli?.prelude).toContain('-webkit-backdrop-filter');
    expect(repli?.prelude).toMatch(/\bor\b/);
  });

  it('CHAQUE SURFACE EN VERRE Y REPREND UN FOND COUVRANT', () => {
    const fonds = new Map<string, string>();
    for (const r of repli?.enfants ?? []) {
      const fond = declarations(r.corps ?? '').get('background');
      if (fond !== undefined) for (const s of selecteurs(r)) fonds.set(s, fond);
    }
    for (const s of verres) {
      const fond = fonds.get(s);
      expect(fond, `${s} n'a pas de fond de repli sans flou`).toBeTruthy();
      // Opaque (un jeton de surface), ou un voile assez dense pour que la
      // page ne se lise plus au travers. Le voile est un JETON (`--voile-dense`,
      // redéfini par le thème sombre) : on lit ce qu'il vaut dans le thème
      // clair ; le thème sombre est jugé par tests/dashboard-contraste.test.ts.
      const jeton = /^var\(\s*(--[\w-]+)\s*\)$/.exec(fond ?? '')?.[1];
      const brut = jeton === undefined ? fond : (racine().get(jeton) ?? fond);
      const alpha = /^rgba\([^)]*,\s*([\d.]+)\)$/.exec(brut ?? '')?.[1];
      if (alpha !== undefined) {
        expect(Number(alpha), `${s} : voile de repli trop clair`).toBeGreaterThanOrEqual(0.7);
      } else {
        expect(couleur(fond ?? ''), `${s} : fond de repli non opaque`).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });
});

// ─── 4. LE MOUVEMENT RÉDUIT, PARTOUT ─────────────────────────────────────────

describe('`prefers-reduced-motion` couvre toutes les animations', () => {
  it('UNE GARDE UNIVERSELLE ÉTEINT ANIMATIONS ET TRANSITIONS', () => {
    // Une garde par règle s'oublie à la règle suivante. Celle-ci vise `*` et
    // ses pseudo-éléments : ce qui s'anime demain est couvert aujourd'hui.
    const gardes = STYLES.filter((r) => /prefers-reduced-motion:\s*reduce/.test(r.prelude));
    const universelle = gardes
      .flatMap((g) => g.enfants ?? [])
      .find((r) => ['*', '*::before', '*::after'].every((s) => selecteurs(r).includes(s)));
    expect(universelle, 'aucune garde de mouvement réduit sur `*`').toBeTruthy();
    const d = declarations(universelle?.corps ?? '');
    for (const prop of ['animation-duration', 'transition-duration']) {
      // `!important` : sans lui, n'importe quelle règle plus précise — donc
      // toutes — reprendrait sa durée.
      expect(d.get(prop), prop).toMatch(/^0\.01ms\s*!important$/);
    }
    // Une animation infinie jouée en 0,01 ms tournerait encore, très vite.
    expect(d.get('animation-iteration-count')).toMatch(/^1\s*!important$/);
  });

  it('…ET CETTE FEUILLE-LÀ S’APPLIQUE À TOUT L’ÉCRAN', () => {
    // La garde ne vaut que si la feuille qui la porte est globale : c'est
    // `main.tsx` qui l'importe, avant toute vue.
    expect(lire('main.tsx')).toMatch(/^import '\.\/styles\.css';$/m);
    const animations = fichiers()
      .filter((f) => f.endsWith('.css'))
      .flatMap((f) => [...sansCommentaires(lire(f)).matchAll(/@keyframes\s+([\w-]+)/g)]);
    expect(animations.length, 'plus aucune animation : la garde est creuse').toBeGreaterThan(0);
  });
});

// ─── 5. UNE CLASSE, UNE RÈGLE ────────────────────────────────────────────────

describe('la marque de la barre', () => {
  it('`.mc-sidebar-brand` N’EST DÉCLARÉE QU’UNE FOIS', () => {
    // Deux déclarations (en ligne, puis en colonne) : la seconde s'appliquait
    // AUSSI à la marque entière, et le logo passait au-dessus du nom.
    const declarees = STYLES.filter(
      (r) => r.corps !== undefined && selecteurs(r).includes('.mc-sidebar-brand'),
    );
    expect(declarees.length).toBe(1);
    expect(declarations(declarees[0]?.corps ?? '').get('flex-direction')).toBeUndefined();
  });
});

// ─── 6. UN DIALOGUE MONTÉ PAR `Voile` NE LIT PAS LES JETONS D'UNE VUE ────────

describe('les dialogues portés hors de leur vue', () => {
  // `Voile` monte chaque modale à la racine du document (ui.tsx) : elle n'est
  // plus la descendante de sa vue. Un jeton posé sur la RACINE d'une vue
  // (`.ch-view { --ch-papier: … }`) n'y existe donc pas, et la déclaration qui
  // le lit tombe à sa valeur initiale — fond transparent, aucune bordure.
  //
  // Le relevé est statique, donc approché : les classes écrites en dur dans un
  // `<Voile>` — ou dans un composant qui rend `<Voile>` (ses `className` et un
  // `classe="…"` passé en prop) — sont celles d'une surface portée. Une règle
  // dont TOUTES les classes en sont ne peut lire qu'un jeton de `:root`, ou
  // un jeton qu'une règle portée pose elle-même (une vue qui reprend sa palette
  // sur la racine de ses dialogues).
  const sources = fichiers()
    .filter((f) => f.endsWith('.tsx'))
    .map((f) => sansCommentaires(lire(f)));

  /** `Voile`, et chaque composant dont le corps rend un `<Voile>`. */
  const porteurs = new Set(['Voile']);
  for (const src of sources) {
    for (const m of src.matchAll(
      /function (\w+)\([\s\S]*?(?=\n(?:export )?(?:default )?function |$)/g,
    )) {
      if (m[1] !== undefined && m[1] !== 'Voile' && m[0].includes('<Voile')) porteurs.add(m[1]);
    }
  }

  /** Les classes écrites entre `<Porteur …>` et `</Porteur>`, plus le voile lui-même. */
  const portees = new Set(['modal-backdrop']);
  for (const src of sources) {
    for (const porteur of porteurs) {
      for (const ouvre of src.matchAll(new RegExp(`<${porteur}[\\s>]`, 'g'))) {
        const ferme = src.indexOf(`</${porteur}>`, ouvre.index);
        if (ferme < 0) continue; // `<Porteur … />` : rien d'écrit dedans ici.
        for (const m of src.slice(ouvre.index, ferme).matchAll(/(?:className|classe)="([^"]+)"/g)) {
          for (const classe of (m[1] ?? '').split(/\s+/)) portees.add(classe);
        }
      }
    }
  }

  const aplatir = (regles: Regle[]): Regle[] =>
    regles.flatMap((r) => (r.enfants !== undefined ? aplatir(r.enfants) : [r]));
  const regles = fichiers()
    .filter((f) => f.endsWith('.css'))
    .flatMap((f) => aplatir(analyser(sansCommentaires(lire(f)))).map((r) => ({ ...r, f })));
  const posesPar = (r: Regle): string[] =>
    [...(r.corps ?? '').matchAll(/(?:^|[{;\s])(--[\w-]+)\s*:/g)].map((m) => m[1] ?? '');
  const portee = (selecteur: string): boolean => {
    const classes = [...selecteur.matchAll(/\.([\w-]+)/g)].map((m) => m[1] ?? '');
    return classes.length > 0 && classes.every((c) => portees.has(c));
  };

  const globaux = new Set(
    regles.filter((r) => selecteurs(r).some((s) => s.startsWith(':root'))).flatMap(posesPar),
  );
  const reposes = new Set(regles.filter((r) => selecteurs(r).some(portee)).flatMap(posesPar));

  it('LE RELEVÉ TROUVE LES SURFACES PORTÉES — sinon la garde est creuse', () => {
    for (const classe of ['modal', 'modal-backdrop', 'ch-grant-dialog', 'ch-dialog']) {
      expect(portees.has(classe), `« ${classe} » n'est plus vue comme portée par \`Voile\``).toBe(
        true,
      );
    }
    expect(globaux.has('--panel'), 'les jetons de `:root` ne sont plus relevés').toBe(true);
  });

  it('AUCUNE RÈGLE D’UNE SURFACE PORTÉE NE LIT UN JETON RESTÉ DANS SA VUE', () => {
    const fautes = regles.flatMap((r) => {
      const vises = selecteurs(r).filter(portee);
      if (vises.length === 0) return [];
      return [...(r.corps ?? '').matchAll(/var\(\s*(--[\w-]+)/g)]
        .map((m) => m[1] ?? '')
        .filter((jeton) => !globaux.has(jeton) && !reposes.has(jeton))
        .map((jeton) => `${r.f} « ${vises.join(', ')} » lit ${jeton}`);
    });
    expect(fautes, `jetons introuvables hors de leur vue : ${fautes.join(' · ')}`).toEqual([]);
  });
});
