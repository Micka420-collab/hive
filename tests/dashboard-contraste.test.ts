// LES DEUX THÈMES DU TABLEAU DE BORD, JUGÉS SUR PIÈCES — contraste, échelle
// typographique, couleurs en dur, verre.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// `dashboard-feuilles.test.ts` garde la cascade du thème CLAIR. Le thème
// sombre double la surface à juger, et chaque défaut qu'il peut porter est
// invisible à tsc, à ESLint et à l'œil de qui travaille dans l'autre thème :
//
//   · un jeton de texte qui tient 4,5:1 sur la crème et tombe à 2:1 sur
//     l'anthracite (ou l'inverse) ;
//   · les DEUX copies du bloc sombre (préférence du système, choix explicite)
//     qui divergent — le thème change alors selon la façon dont on l'a choisi ;
//   · une couleur écrite en dur dans une vue, qui reste claire sur fond sombre ;
//   · un jeton de couleur ajouté au thème clair et oublié par le sombre.
//
// Ce lot a aussi trouvé un défaut dans le thème clair d'avant lui : `--faint`
// s'annonçait « AA ≥ 4,5:1 sur panel/panel-2/panel-3 » et faisait 4,29:1 sur
// panel-2, 3,89:1 sur panel-3, 4,24:1 sur la page. Le cas « CHAQUE TEXTE SUR
// CHAQUE SURFACE » rougissait sur l'arbre d'avant ; celui de l'échelle
// typographique aussi (seize tailles en px, jusqu'à 9 px).

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../dashboard/src/', import.meta.url));
const lire = (rel: string): string => readFileSync(path.join(SRC, rel), 'utf8');
const sansCommentaires = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '');

function feuilles(dossier = ''): string[] {
  return readdirSync(path.join(SRC, dossier), { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? feuilles(path.join(dossier, e.name))
      : e.name.endsWith('.css')
        ? [path.join(dossier, e.name)]
        : [],
  );
}

interface Regle {
  prelude: string;
  corps?: string;
  enfants?: Regle[];
}

/** Le découpage d'une feuille en règles, `@media` et `@supports` compris. */
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

function declarations(corps: string): Map<string, string> {
  const m = new Map<string, string>();
  for (const brut of corps.split(';')) {
    const deux = brut.indexOf(':');
    if (deux > 0) m.set(brut.slice(0, deux).trim(), brut.slice(deux + 1).trim());
  }
  return m;
}

const selecteurs = (r: Regle): string[] => r.prelude.split(',').map((s) => s.trim());

const STYLES = analyser(sansCommentaires(lire('styles.css')));

function corpsDe(regles: Regle[], selecteur: string): Map<string, string> {
  const r = regles.find((x) => x.corps !== undefined && selecteurs(x).includes(selecteur));
  expect(r, `règle « ${selecteur} » introuvable`).toBeTruthy();
  return declarations(r?.corps ?? '');
}

const CLAIR = corpsDe(STYLES, ':root');
const SOMBRE_CHOISI = corpsDe(STYLES, ":root[data-theme='dark']");
const SOMBRE_SYSTEME = corpsDe(
  STYLES.find((r) => /prefers-color-scheme:\s*dark/.test(r.prelude))?.enfants ?? [],
  ":root:not([data-theme='light'])",
);

/** Les jetons d'un thème : le clair, surchargé par le bloc sombre s'il y en a un. */
const THEMES = {
  clair: CLAIR,
  sombre: new Map([...CLAIR, ...SOMBRE_CHOISI]),
} as const;
type NomTheme = keyof typeof THEMES;

/**
 * Un jeton résolu en hexadécimal DANS un thème : les `var()` suivies, et
 * `color-mix(in srgb, A p%, B)` calculé comme le navigateur le calcule —
 * une interpolation composante par composante dans l'espace sRGB encodé.
 */
function hex(theme: NomTheme, valeur: string): string {
  const v = valeur.trim();
  const jeton = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v)?.[1];
  if (jeton !== undefined) {
    const pose = THEMES[theme].get(jeton);
    expect(pose, `${jeton} n'est pas posé (${theme})`).toBeDefined();
    return hex(theme, pose ?? '');
  }
  const melange = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(v);
  if (melange) {
    const [a, b] = [hex(theme, melange[1] ?? ''), hex(theme, melange[3] ?? '')];
    const p = Number(melange[2]) / 100;
    return `#${[1, 3, 5]
      .map((k) => {
        const c = p * parseInt(a.slice(k, k + 2), 16) + (1 - p) * parseInt(b.slice(k, k + 2), 16);
        return Math.round(c).toString(16).padStart(2, '0');
      })
      .join('')}`;
  }
  expect(v, `pas une couleur pleine : ${v}`).toMatch(/^#[0-9a-f]{6}$/i);
  return v;
}

const jeton = (theme: NomTheme, nom: string): string => hex(theme, `var(${nom})`);

const sansImportant = (v: string): string => v.replace(/\s*!important$/, '').trim();

/**
 * Comme `hex`, mais sans exiger : suit aussi les alias LOCAUX d'une feuille,
 * et rend `null` pour tout ce qui n'est pas une couleur pleine (dégradé,
 * transparence, `currentColor`) — l'emploi est alors laissé à l'œil.
 */
function resoudre(theme: NomTheme, valeur: string, locaux: Map<string, string>): string | null {
  const v = valeur.trim();
  const nom = /^var\(\s*(--[\w-]+)\s*\)$/.exec(v)?.[1];
  if (nom !== undefined) {
    const pose = locaux.get(nom) ?? THEMES[theme].get(nom);
    return pose === undefined || pose === v ? null : resoudre(theme, pose, locaux);
  }
  const melange = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%,\s*(.+)\)$/.exec(v);
  if (melange) {
    const a = resoudre(theme, melange[1] ?? '', locaux);
    const b = resoudre(theme, melange[3] ?? '', locaux);
    if (a === null || b === null) return null;
    return hex(theme, `color-mix(in srgb, ${a} ${melange[2]}%, ${b})`);
  }
  return /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : null;
}

const aplatir = (regles: Regle[]): Regle[] =>
  regles.flatMap((r) => (r.enfants !== undefined ? aplatir(r.enfants) : [r]));

/**
 * Le Cerveau est une carte NOCTURNE dans les deux thèmes : sa toile est
 * peinte en JavaScript (views/Cerveau.tsx, `COULEUR`) sur un fond que sa
 * feuille pose, et les deux palettes doivent rester appariées. Elle est la
 * seule feuille hors jetons, et elle est nommée.
 */
const EXEMPTEES_DE_JETONS = new Set([path.join('views', 'cerveau.css')]);

/** Contraste WCAG 2.x. */
function contraste(a: string, b: string): number {
  const lum = (h: string): number => {
    const [r, g, bl] = [1, 3, 5].map((k) => {
      const c = parseInt(h.slice(k, k + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (bl ?? 0);
  };
  const [clair, sombre] = [lum(a), lum(b)].sort((x, y) => y - x);
  return ((clair ?? 0) + 0.05) / ((sombre ?? 0) + 0.05);
}

/** Les paires à juger : [texte ou marque, fonds, seuil]. */
const SURFACES = ['--bg', '--bg-2', '--panel', '--panel-2', '--panel-3'];
const TEXTES = [
  '--text',
  '--muted',
  '--faint',
  '--honey',
  '--amber',
  '--orange',
  '--gold',
  '--red',
  '--green',
  '--blue',
];
const PAIRES: [string, string[], number][] = [
  ...TEXTES.map((t): [string, string[], number] => [t, SURFACES, 4.5]),
  // La barre latérale : sombre dans les deux thèmes.
  ['--sur-encre', ['--encre'], 4.5],
  ['--sur-encre-fort', ['--encre'], 4.5],
  // Le texte posé sur un remplissage : miel, pastille critique, statut plein.
  ['--encre', ['--miel', '--miel-2', '--rouge'], 4.5],
  ['--sur-plein', ['--red', '--amber'], 4.5],
  // Le miel en fond sous du texte courant.
  ['--text', ['--miel-fond', '--miel-fond-fort'], 4.5],
  // Ce qui n'est pas du texte : 3:1 (WCAG 1.4.11).
  ['--focus', SURFACES, 3],
  ...['--graphe-1', '--graphe-2', '--graphe-3', '--graphe-4', '--graphe-5', '--graphe-6'].map(
    (g): [string, string[], number] => [g, SURFACES, 3],
  ),
];

describe('les deux thèmes', () => {
  it('LES DEUX BLOCS SOMBRES SONT IDENTIQUES', () => {
    // Préférence du système et choix explicite doivent donner LE MÊME écran.
    expect(Object.fromEntries(SOMBRE_SYSTEME)).toEqual(Object.fromEntries(SOMBRE_CHOISI));
    expect(SOMBRE_CHOISI.get('color-scheme')).toBe('dark');
    expect(CLAIR.get('color-scheme')).toBe('light');
  });

  it('LE THÈME SOMBRE REDÉFINIT CHAQUE COULEUR LITTÉRALE DU CLAIR', () => {
    // Un jeton de couleur ajouté au clair et oublié par le sombre garderait sa
    // valeur de crème sur l'anthracite. Seuls les REMPLISSAGES vifs sont
    // communs aux deux thèmes — ils portent l'identité, et le texte posé
    // dessus est l'encre dans les deux.
    const COMMUNS = new Set(['--miel', '--miel-2', '--rouge']);
    const oublies = [...CLAIR]
      .filter(([nom, v]) => nom.startsWith('--') && /^(#|rgba?\()/.test(v))
      .map(([nom]) => nom)
      .filter((nom) => !COMMUNS.has(nom) && !SOMBRE_CHOISI.has(nom));
    expect(oublies, `couleurs du clair sans valeur sombre : ${oublies.join(', ')}`).toEqual([]);
  });

  for (const theme of ['clair', 'sombre'] as const) {
    it(`CHAQUE TEXTE SUR CHAQUE SURFACE — thème ${theme}`, () => {
      const fautes: string[] = [];
      for (const [avant, fonds, seuil] of PAIRES) {
        for (const fond of fonds) {
          const c = contraste(jeton(theme, avant), jeton(theme, fond));
          if (c < seuil) fautes.push(`${avant} sur ${fond} : ${c.toFixed(2)}:1 (< ${seuil})`);
        }
      }
      expect(fautes, fautes.join(' · ')).toEqual([]);
    });
  }

  it('CHAQUE RÈGLE QUI POSE UN TEXTE SUR UN FOND TIENT AA — dans les deux thèmes', () => {
    // La table PAIRES juge les jetons ; celle-ci juge leurs EMPLOIS. Un alias
    // local (`--ch-encre: var(--text)`) peut faire d'une paire saine en clair
    // une paire illisible en sombre sans qu'aucun jeton ne change : le bouton
    // « Accorder » de la Chambre posait `--text` (clair en sombre) sur le miel,
    // 1,37:1, et son `!important` écrasait l'encre de `.btn.primary`. Chaque
    // règle qui déclare À LA FOIS `color` et un fond plein est donc résolue —
    // `!important` retiré, alias locaux de la feuille suivis — et jugée.
    // Ce qui ne se résout pas en une couleur pleine (dégradé, transparence,
    // `currentColor`) est laissé à l'œil : le compte plancher empêche le
    // relevé de devenir vide sans bruit.
    const fautes: string[] = [];
    let jugees = 0;
    for (const f of feuilles()) {
      if (EXEMPTEES_DE_JETONS.has(f)) continue;
      const regles = aplatir(analyser(sansCommentaires(lire(f))));
      // Les alias locaux d'une feuille (`--ch-miel: var(--miel)`), posés sur
      // ses conteneurs : un emploi qui les nomme les voit.
      const locaux = new Map<string, string>();
      for (const r of regles)
        for (const [nom, v] of declarations(r.corps ?? ''))
          if (nom.startsWith('--') && !selecteurs(r).every((s) => s.startsWith(':root')))
            locaux.set(nom, sansImportant(v));
      for (const r of regles) {
        const d = declarations(r.corps ?? '');
        const texte = d.get('color');
        const fond = d.get('background') ?? d.get('background-color');
        if (texte === undefined || fond === undefined) continue;
        for (const theme of ['clair', 'sombre'] as const) {
          const [t, b] = [
            resoudre(theme, sansImportant(texte), locaux),
            resoudre(theme, sansImportant(fond), locaux),
          ];
          if (t === null || b === null) continue;
          jugees += 1;
          const c = contraste(t, b);
          if (c < 4.5)
            fautes.push(`${theme} ${f} « ${r.prelude} » ${texte} sur ${fond} : ${c.toFixed(2)}:1`);
        }
      }
    }
    expect(fautes, fautes.join(' · ')).toEqual([]);
    expect(jugees).toBeGreaterThanOrEqual(150);
  });

  it('SANS FLOU, LE VOILE SOMBRE RESTE DENSE', () => {
    // Le repli `@supports not (backdrop-filter)` pose `--voile-dense` : il doit
    // masquer la page dans le thème sombre aussi.
    const alpha = /,\s*([\d.]+)\)$/.exec(SOMBRE_CHOISI.get('--voile-dense') ?? '')?.[1];
    expect(Number(alpha)).toBeGreaterThanOrEqual(0.7);
  });
});

// ─── L'ÉCHELLE TYPOGRAPHIQUE ─────────────────────────────────────────────────

describe('une seule échelle typographique', () => {
  const echelle = [...CLAIR].filter(([nom]) => nom.startsWith('--fs-'));

  it('L’ÉCHELLE EXISTE ET NE DESCEND PAS SOUS 11 PX', () => {
    expect(echelle.length).toBeGreaterThanOrEqual(8);
    for (const [nom, v] of echelle) {
      expect(v, nom).toMatch(/^\d+px$/);
      expect(parseFloat(v), `${nom} = ${v}`).toBeGreaterThanOrEqual(11);
    }
  });

  it('AUCUNE FEUILLE N’ÉCRIT UNE TAILLE DE TEXTE HORS ÉCHELLE', () => {
    // Permis : un jeton `--fs-*` (seul ou dans un `clamp`), `0` (cacher un
    // texte en gardant sa boîte) et `em` (relatif au texte parent : un `<code>`
    // dans une phrase).
    const fautes = feuilles().flatMap((f) =>
      [...sansCommentaires(lire(f)).matchAll(/font-size:\s*([^;}]+)/g)]
        .map((m) => (m[1] ?? '').replace(/\s*!important$/, '').trim())
        .filter((v) => {
          if (v === '0' || /^[\d.]+em$/.test(v)) return false;
          const sansJetons = v.replace(/var\(--fs-[\w-]+\)/g, '');
          return /\d(px|rem)\b/.test(sansJetons) || !/var\(--fs-/.test(v);
        })
        .map((v) => `${f} : ${v}`),
    );
    expect(fautes, fautes.join(' · ')).toEqual([]);
  });
});

// ─── LES COULEURS EN DUR ─────────────────────────────────────────────────────

describe('aucune couleur en dur hors des jetons', () => {
  it('LE RELEVÉ LIT TOUTES LES FEUILLES', () => {
    const toutes = feuilles();
    expect(toutes).toContain('styles.css');
    expect(toutes).toContain(path.join('composants', 'composants.css'));
    expect(toutes.length).toBeGreaterThan(10);
  });

  // Toutes les écritures d'une couleur qu'un navigateur accepte : hexadécimal,
  // fonctions (`rgb`, `hsl`, `hwb`, `lab`, `lch`, `oklab`, `oklch`) et les noms
  // courants. Un nom n'est une couleur que s'il est un mot entier : `--red`,
  // `pulse-red` ou `.btn-white` n'en sont pas.
  const COULEUR_EN_DUR = new RegExp(
    [
      '#[0-9a-f]{3,8}\\b',
      '\\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\\(',
      '(?<![-\\w])(?:white|black|gr[ae]y|silver|red|green|blue|yellow|orange|purple|pink|brown|navy|teal)(?![-\\w])',
    ].join('|'),
    'gi',
  );

  it('LE RELEVÉ DES COULEURS EN DUR RECONNAÎT CHAQUE ÉCRITURE', () => {
    const trouve = (css: string): boolean => new RegExp(COULEUR_EN_DUR.source, 'i').test(css);
    for (const dur of [
      'color: #fff',
      'color: rgba(0, 0, 0, 0.4)',
      'color: hsl(0 0% 100%)',
      'color: oklch(70% 0.1 80)',
      'color: gray',
      'border: 1px solid white',
    ])
      expect(trouve(dur), dur).toBe(true);
    for (const jeton of ['color: var(--red)', 'animation: pulse-red 1s', 'color: currentColor'])
      expect(trouve(jeton), jeton).toBe(false);
  });

  it('HORS DES BLOCS DE JETONS, UNE FEUILLE NE NOMME QUE DES JETONS', () => {
    const fautes: string[] = [];
    for (const f of feuilles()) {
      if (EXEMPTEES_DE_JETONS.has(f)) continue;
      for (const r of aplatir(analyser(sansCommentaires(lire(f))))) {
        // Les blocs de thème SONT la définition des couleurs.
        if (selecteurs(r).every((s) => s.startsWith(':root'))) continue;
        for (const m of (r.corps ?? '').matchAll(COULEUR_EN_DUR)) {
          fautes.push(`${f} « ${r.prelude} » : ${m[0]}`);
        }
      }
    }
    expect(fautes, fautes.join(' · ')).toEqual([]);
  });
});

// ─── LE VERRE, EN CONTRASTE ÉLEVÉ ET EN COULEURS FORCÉES ─────────────────────

describe('le verre cède quand on demande du contraste', () => {
  const verres = STYLES.filter((r) => r.corps !== undefined && /backdrop-filter\s*:/.test(r.corps))
    .flatMap(selecteurs)
    .sort();
  const bloc = (motif: RegExp): Regle[] =>
    STYLES.filter((r) => motif.test(r.prelude)).flatMap((r) => r.enfants ?? []);

  it('LE RELEVÉ TROUVE LES SURFACES EN VERRE', () => {
    expect(verres).toEqual(['.hero-progress', '.modal-backdrop', '.topbar']);
  });

  it('`prefers-contrast: more` REND CHAQUE VERRE OPAQUE', () => {
    const fonds = new Map<string, string>();
    for (const r of bloc(/prefers-contrast:\s*more/)) {
      const fond = declarations(r.corps ?? '').get('background');
      if (fond !== undefined) for (const s of selecteurs(r)) fonds.set(s, fond);
    }
    for (const s of verres) {
      const fond = fonds.get(s);
      expect(fond, `${s} garde sa transparence en contraste élevé`).toBeDefined();
      // Une surface pleine, ou le voile dense — jamais `--verre`.
      expect(['var(--panel)', 'var(--voile-dense)']).toContain(fond);
    }
  });

  it('`forced-colors: active` COUPE LE FLOU DE CHAQUE VERRE', () => {
    const coupe = new Set<string>();
    for (const r of bloc(/forced-colors:\s*active/)) {
      const d = declarations(r.corps ?? '');
      if (d.get('backdrop-filter') === 'none' && d.get('-webkit-backdrop-filter') === 'none') {
        for (const s of selecteurs(r)) coupe.add(s);
      }
    }
    for (const s of verres)
      expect(coupe.has(s), `${s} floute encore en couleurs forcées`).toBe(true);
  });
});

// ─── LA CARTE NOCTURNE DU CERVEAU ────────────────────────────────────────────

describe('le Cerveau, nocturne dans les deux thèmes', () => {
  it('LES CHIFFRES DES TUILES SE LISENT SUR LA TUILE — ils n’héritent plus de la page', () => {
    // `.cerveau-tuile` héritait (`color: inherit`) le texte de la PAGE : dans le
    // thème clair, des chiffres presque noirs sur une tuile presque noire
    // (relevé par la première série de captures, docs/CAPTURES.md).
    const cerveau = analyser(sansCommentaires(lire(path.join('views', 'cerveau.css'))));
    const palette = corpsDe(cerveau, '.cerveau');
    const tuile = corpsDe(cerveau, '.cerveau-tuile');
    const texte = tuile.get('color') ?? '';
    expect(texte, 'la tuile doit poser sa propre couleur').toMatch(/^#[0-9a-f]{6}$/i);
    const fond = palette.get('--ce-carte') ?? '';
    const c = contraste(texte, fond);
    expect(c, `chiffres sur la tuile : ${c.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
  });
});
