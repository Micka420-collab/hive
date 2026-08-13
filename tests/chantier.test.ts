// Les Chantiers — les travaux que le dépôt DÉCLARE.
//
// ─── LES DEUX ASSERTIONS QUI PORTENT LE MODULE ───────────────────────────────
//
//   1. LA RUCHE CHOISIT DANS CE QUE LE DÉPÔT DÉCLARE. Un nom absent du
//      `package.json` est REFUSÉ, pas lancé « au cas où ». C'est la même
//      frontière que `preparation.ts` et `commande-test.ts`, et elle a été
//      établie en fermant de vraies failles — pas par précaution théorique.
//
//   2. CE QUI SORT DE LA MACHINE DEMANDE UN HUMAIN. Publier, déployer,
//      démarrer un service : irréversible et visible de l'extérieur, donc même
//      famille que « jamais de fusion sans revue humaine ».

import { describe, expect, it } from 'vitest';
import {
  argvDe,
  chantiersDe,
  jugerChantier,
  nature,
  nomDeChantierValide,
  NOM_MAX,
} from '../src/shared/chantier.js';

const SCRIPTS = {
  test: 'vitest run',
  lint: 'eslint . && prettier --check .',
  'build:node': 'tsc -p tsconfig.build.json',
  typecheck: 'tsc --noEmit',
  publish: 'npm publish --access public',
  deploy: './scripts/deploy.sh',
  start: 'node dist/main.js',
  demo: 'node scripts/demo.js',
};

describe('LA RUCHE NE PEUT PAS INVENTER UN TRAVAIL', () => {
  it('UN SCRIPT NON DÉCLARÉ EST REFUSÉ', () => {
    // L'assertion centrale. Si elle tombe, la ruche exécute des commandes que
    // le dépôt n'a jamais écrites — et toute la frontière de confiance saute.
    const v = jugerChantier(SCRIPTS, 'inexistant');
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.motif).toMatch(/n’invente pas de commande/);
      // Le refus doit dire ce qui EXISTE : sinon l'appelant devine, et deviner
      // sur cette frontière-là est précisément ce qu'on refuse.
      expect(v.motif, 'le refus doit lister les scripts déclarés').toMatch(/test/);
    }
  });

  it('un dépôt SANS aucun script le dit clairement', () => {
    const v = jugerChantier({}, 'test');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toMatch(/n’en déclare aucun/);
  });

  it('UN NOM COMMENÇANT PAR « - » EST REFUSÉ — npm le lirait comme un drapeau', () => {
    // Même famille que le § 1.3 du journal : `npm run install:hive --dry-run`,
    // où npm garde le drapeau POUR LUI. Un script nommé `--force` ne serait
    // jamais lancé, il serait INTERPRÉTÉ.
    const v = jugerChantier({ '--force': 'rm -rf /' }, '--force');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toMatch(/drapeau/);
  });

  it('un nom qui fabrique une fausse ligne de journal est refusé', () => {
    // Le nom traverse le protocole, un événement, un écran. `shell: false`
    // empêche qu'il devienne une commande ; il n'empêche pas qu'il casse un
    // affichage.
    expect(jugerChantier({ 'a\nb': 'x' }, 'a\nb').ok).toBe(false);
    expect(jugerChantier({ 'a b': 'x' }, 'a b').ok).toBe(false);
  });

  it('un nom démesuré est refusé', () => {
    const long = 'a'.repeat(200);
    expect(jugerChantier({ [long]: 'x' }, long).ok).toBe(false);
  });

  it('un script déclaré et vérificateur passe', () => {
    expect(jugerChantier(SCRIPTS, 'test')).toEqual({ ok: true });
    expect(jugerChantier(SCRIPTS, 'build:node')).toEqual({ ok: true });
  });

  it('L’HÉRITAGE D’OBJET N’EST PAS UNE DÉCLARATION', () => {
    // `'toString' in scripts` est vrai sur n'importe quel objet. Sans
    // `hasOwnProperty`, la ruche croirait le dépôt déclarer `toString`,
    // `constructor` et `valueOf` — et lancerait `npm run toString`.
    expect(jugerChantier(SCRIPTS, 'toString').ok).toBe(false);
    expect(jugerChantier(SCRIPTS, 'constructor').ok).toBe(false);
  });
});

describe('CE QUI SORT DE LA MACHINE DEMANDE UN HUMAIN', () => {
  it('PUBLIER N’EST PAS AUTOMATISABLE', () => {
    const v = jugerChantier(SCRIPTS, 'publish');
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.motif).toMatch(/irréversibles|humain/);
  });

  it('…mais un humain peut le demander explicitement', () => {
    // La ruche PROPOSE, l'humain dispose. Refuser même sur intention explicite
    // ferait de la garde un mur, et on la contournerait ailleurs.
    expect(jugerChantier(SCRIPTS, 'publish', true)).toEqual({ ok: true });
  });

  it('UN SEGMENT SORTANT SUFFIT, OÙ QU’IL SOIT DANS LE NOM', () => {
    // ─── LE TROU QUE CE TEST FERME ─────────────────────────────────────────
    //
    // La première version comparait les deux listes au DÉBUT du nom. La
    // précédence « sortant l'emporte » était donc MORTE — aucun nom ne peut
    // commencer par deux mots à la fois — et la loupe l'a tuée sans faire
    // rougir un seul test.
    //
    // Ce n'était pas qu'une ligne inutile. `build:publish` était classé
    // « vérification », donc AUTOMATISABLE : un script qui publie, lancé sans
    // humain. Le doute profite désormais à la liste qui exige un humain.
    expect(nature('build')).toBe('verification');
    expect(nature('publish:build')).toBe('sortant');
    expect(nature('build:publish'), 'un build qui publie SORT').toBe('sortant');
    expect(nature('ci:deploy'), 'un ci qui déploie SORT').toBe('sortant');
    expect(nature('test:e2e:deploy')).toBe('sortant');
  });

  it('…et un tel script n’est jamais automatisable', () => {
    // L'assertion précédente porte sur la classification ; celle-ci sur la
    // conséquence, qui est ce qui compte vraiment.
    const scripts = { 'build:publish': 'npm run build && npm publish' };
    expect(jugerChantier(scripts, 'build:publish').ok).toBe(false);
    expect(chantiersDe(scripts)[0]?.automatisable).toBe(false);
  });

  it('démarrer un service compte comme sortant', () => {
    // `start` et `serve` ne rendent jamais la main : lancés par la ruche, ils
    // tiendraient un nœud occupé pour toujours.
    expect(nature('start')).toBe('sortant');
    expect(nature('serve:prod')).toBe('sortant');
  });
});

describe('RECONNAÎTRE UN NOM SANS SE TROMPER DE MOT', () => {
  it('le préfixe exige une VRAIE frontière', () => {
    // Sans cette règle, `testament` passerait pour un test et `deployeur` pour
    // un déploiement — deux erreurs opposées, aussi fausses l'une que l'autre.
    expect(nature('testament')).toBe('inconnu');
    expect(nature('deployeur')).toBe('inconnu');
    expect(nature('linter')).toBe('inconnu');
  });

  it('…et il accepte les conventions répandues', () => {
    for (const n of ['test:unit', 'lint-css', 'build.node', 'typecheck:dashboard']) {
      expect(nature(n), n).toBe('verification');
    }
  });

  it('la casse ne change pas la nature', () => {
    expect(nature('Test')).toBe('verification');
    expect(nature('PUBLISH')).toBe('sortant');
  });

  it('un nom qu’on ne reconnaît pas reste INCONNU — on ne devine pas', () => {
    // « inconnu » n'est pas « sûr » : ce n'est pas automatisable non plus.
    expect(nature('demo')).toBe('inconnu');
    expect(chantiersDe(SCRIPTS).find((c) => c.nom === 'demo')?.automatisable).toBe(false);
  });
});

describe('L’ARGV EST UN TABLEAU, JAMAIS UNE CHAÎNE', () => {
  it('c’est ce qui fait tenir `shell: false`', () => {
    expect(argvDe('test')).toEqual(['npm', 'run', 'test']);
  });

  it('`--` sépare les arguments de npm de ceux du script', () => {
    // Sans lui, npm garde les drapeaux pour lui — § 1.3 du journal.
    expect(argvDe('test', ['--reporter=json'])).toEqual([
      'npm',
      'run',
      'test',
      '--',
      '--reporter=json',
    ]);
  });
});

describe('LA LISTE PROPOSÉE', () => {
  it('L’ORDRE EST TOTAL — deux ruches proposent la même liste', () => {
    // L'ordre des clés d'un objet JSON dépend de qui l'a écrit ; deux ruches
    // regardant le même dépôt doivent afficher la même chose.
    const a = chantiersDe(SCRIPTS).map((c) => c.nom);
    const inverse = Object.fromEntries(Object.entries(SCRIPTS).reverse());
    const b = chantiersDe(inverse).map((c) => c.nom);
    expect(a).toEqual(b);
    expect(a).toEqual([...a].sort((x, y) => x.localeCompare(y)));
  });

  it('seule la vérification est automatisable', () => {
    const par = new Map(chantiersDe(SCRIPTS).map((c) => [c.nom, c.automatisable]));
    expect(par.get('test')).toBe(true);
    expect(par.get('lint')).toBe(true);
    expect(par.get('publish')).toBe(false);
    expect(par.get('demo')).toBe(false);
  });

  it('LA COMMANDE AFFICHÉE EST UNE DONNÉE', () => {
    // Elle vient du dépôt connecté. Un `\n` dedans casserait la ligne qui la
    // présente à l'humain qui décide de lancer.
    const c = chantiersDe({ test: 'vitest\nrm -rf /' })[0];
    expect(c?.commande).toBe('vitest rm -rf /');
  });

  it('un nom illisible n’entre pas dans la liste', () => {
    // Ce qu'on refuserait de lancer, on ne le propose pas : proposer un
    // chantier qui sera refusé au clic est une promesse fausse.
    expect(chantiersDe({ 'a b': 'x', test: 'y' }).map((c) => c.nom)).toEqual(['test']);
  });

  it('un dépôt sans script rend une liste vide, pas une erreur', () => {
    expect(chantiersDe({})).toEqual([]);
  });
});

// ─── LA BORNE DU NOM, TENUE AUX TROIS PORTES ─────────────────────────────────
//
// D'où vient ce bloc : le balayage du cœur a muté DEUX des trois gardes de
// longueur sans faire rougir personne —
//
//     jugerChantier   `nom.length > NOM_MAX`   → `>=`
//     chantiersDe     `nom.length <= NOM_MAX`  → `<`
//
// Le banc « un nom démesuré est refusé » plus haut emploie 200 caractères : il
// passe si loin de la borne qu'il ne la touche jamais. Le côté REFUSÉ était
// donc éprouvé, et le côté ACCEPTÉ — la valeur que la borne promet d'admettre —
// ne l'était nulle part. C'est le motif du § 9 (la borne acceptée d'
// `isModeleList`), et il revient parce qu'il est naturel : on écrit le test qui
// montre que la garde refuse, pas celui qui montre ce qu'elle laisse passer.
//
// TROIS PORTES, UNE SEULE BORNE. `nomDeChantierValide` dit si un nom est
// utilisable, `chantiersDe` décide ce que la ruche PROPOSE, `jugerChantier`
// décide ce qu'elle LANCE. Elles doivent s'accorder : si l'une dérive d'un
// caractère, un chantier apparaît à l'écran et se fait refuser au clic — ou
// l'inverse, plus grave : il est jugé bon sans avoir jamais été proposé.

describe('la borne du nom de chantier — les trois portes disent la même chose', () => {
  /** Un nom de longueur voulue, conforme au motif (lettres seulement). */
  const nomDe = (n: number): string => 'a'.repeat(n);

  /** Les trois verdicts pour un nom donné, avec le script déclaré. */
  const troisPortes = (nom: string): [boolean, boolean, boolean] => {
    const scripts = { [nom]: 'echo bonjour' };
    return [
      nomDeChantierValide(nom),
      chantiersDe(scripts).some((c) => c.nom === nom),
      jugerChantier(scripts, nom).ok,
    ];
  };

  it('LA BORNE EXACTE EST ACCEPTÉE — c’est ce qu’une borne promet', () => {
    // `>` muté en `>=` dans `jugerChantier`, ou `<=` muté en `<` dans
    // `chantiersDe` : un nom de NOM_MAX caractères, licite, serait rejeté.
    expect(troisPortes(nomDe(NOM_MAX))).toEqual([true, true, true]);
  });

  it('UN CARACTÈRE DE PLUS EST REFUSÉ — aux trois portes', () => {
    expect(troisPortes(nomDe(NOM_MAX + 1))).toEqual([false, false, false]);
  });

  it('LES TROIS PORTES NE PEUVENT PAS SE CONTREDIRE, de part et d’autre de la borne', () => {
    // La garde vraie n'est pas « chacune refuse les noms trop longs » : c'est
    // « elles refusent LES MÊMES ». Une dérive d'un seul caractère entre deux
    // d'entre elles fait apparaître un chantier qu'on ne peut pas lancer.
    for (let n = NOM_MAX - 2; n <= NOM_MAX + 2; n++) {
      const [valide, propose, juge] = troisPortes(nomDe(n));
      expect([valide, propose, juge], `longueur ${n}`).toEqual([valide, valide, valide]);
    }
  });

  it('la borne vaut bien ce que la table annonce', () => {
    expect(NOM_MAX).toBe(100);
  });
});
