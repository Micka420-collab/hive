// Le banc du seuil — qui garde le gardien.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// `scripts/essai-installation.sh` est la seule chose du dépôt qui mène
// l'installation en une commande jusqu'à une ruche qui répond. La CI l'appelle,
// et personne ne le regardait : un balayage de la loupe a muté son garde du
// `.env` — `||` en `&&` — et AUCUN cas de la suite n'a bougé.
//
// Un gardien que rien ne garde a la forme exacte du défaut qu'il existe pour
// attraper. Si ce script cessait silencieusement d'affirmer quoi que ce soit,
// la CI resterait verte et dirait « l'installation marche » sans l'avoir
// vérifiée — c'est-à-dire pire que si le pas n'existait pas.
//
// ─── CE QU'IL EXERCE, ET COMMENT ─────────────────────────────────────────────
//
// Le VRAI script, lancé par `sh`, dans un dossier temporaire où l'on plante :
//
//   - un faux `install.sh` dont on décide le code de sortie et le `.env` ;
//   - un `package.json` dont le script `ruche` lance un vrai serveur HTTP.
//
// Le script ne sait pas qu'on le trompe : il fait exactement ce qu'il fait en
// CI. Chaque cas ci-dessous change UNE chose et vérifie que le verdict change
// avec elle — c'est la seule façon de savoir qu'il affirme encore.
//
// ─── CE QUE CE BANC NE COUVRE PAS, ET C'EST DIT ──────────────────────────────
//
// Sous Windows, seule la syntaxe est vérifiée. Le script lit `/proc`, appelle
// `readlink` et `curl`, et son ménage suppose des processus POSIX : l'exercer
// sous Git Bash mesurerait l'émulation, pas le produit. Le travail `seuil` de
// la CI ne tourne lui non plus que sous Linux, et `docs/ETAPES.md` § 2.1 le
// note comme une couverture d'un système sur trois.
//
// Le cas « la ruche ne répond jamais » n'est pas exercé : le script attend
// soixante secondes avant de trancher, et cette durée n'est pas réglable de
// l'extérieur. Il a été mesuré à la main, sur un arbre cassé exprès
// (`app.listen({ port: config.port + 1 })`) — CODE=1, journal à l'appui.

import { execFileSync, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { chmodSync, cpSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

// `fileURLToPath`, jamais `.pathname` : sur Windows ce dernier rend
// `/D:/a/hive/…` et `path.resolve` en fait `D:\D:\a\hive\…` (§ 6.1 du carnet).
const SCRIPT = fileURLToPath(new URL('../scripts/essai-installation.sh', import.meta.url));

// ─── L'INSTRUMENT DU PARCOURS VOYAGE AVEC LE SCRIPT ─────────────────────────
//
// Les pas 4 et 5 sont en Node, à côté de l'essai. Le banc copie l'essai dans un
// dossier temporaire : il doit donc copier ses voisins, sinon il éprouve un
// script amputé. C'est ce qui est arrivé — l'essai sortait en 1 sur un chantier
// sain, et le banc a été le seul à le dire.
// ─── LES VOISINS SE DÉCOUVRENT, ILS NE S'ÉNUMÈRENT PAS ───────────────────────
//
// Ce banc COPIE le script dans un dossier temporaire, donc il doit y emmener les
// instruments que le script lance à côté de lui.
//
// C'était une liste écrite à la main. Elle a vieilli au premier lot suivant : le
// pas 6 a ajouté `essai-entree.mjs`, qui importe `entree-invite.mjs`, et le banc
// est mort sur `MODULE_NOT_FOUND` — un rouge qui ne parlait pas du produit.
//
// C'est le § 9 quinoctogies mot pour mot : une liste garde ce qu'on a pensé à y
// mettre, LE JOUR OÙ ON L'A ÉCRITE. On prend donc tous les `.mjs` du dossier :
// ce sont des fichiers de quelques kilo-octets dans un dossier temporaire, et
// cette copie-là ne peut plus être courte.
const VOISINS = readdirSync(fileURLToPath(new URL('../scripts', import.meta.url)))
  .filter((f) => f.endsWith('.mjs'))
  .map((f) => fileURLToPath(new URL(`../scripts/${f}`, import.meta.url)));

describe('le banc du seuil — la syntaxe, sur tous les systèmes', () => {
  it('`sh -n` accepte le script', () => {
    // Rien d'autre ne relit ce fichier : une virgule de travers y dormirait
    // jusqu'à la prochaine PR, et rougirait alors sur un diff sans rapport.
    expect(() => execFileSync('sh', ['-n', SCRIPT], { stdio: 'pipe' })).not.toThrow();
  });
});

/** Un port libre, demandé au système plutôt que deviné. */
function portLibre(): Promise<number> {
  return new Promise((resoudre, rejeter) => {
    const sonde = createServer();
    sonde.on('error', rejeter);
    sonde.listen(0, '127.0.0.1', () => {
      const adresse = sonde.address();
      if (adresse === null || typeof adresse === 'string') {
        sonde.close();
        rejeter(new Error('adresse inattendue'));
        return;
      }
      const port = adresse.port;
      sonde.close(() => resoudre(port));
    });
  });
}

// `runIf` plutôt qu'un saut muet : sous Windows ces cas seraient VERTS et sans
// objet, ce qui est la pire des deux façons de ne pas tester quelque chose.
describe.runIf(process.platform !== 'win32')('le banc du seuil — en comportement', () => {
  const dossiers: string[] = [];

  afterEach(() => {
    for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  /**
   * Plante un faux chantier et rend le verdict du script.
   *
   * Le faux `install.sh` est un shell de trois lignes : c'est lui qui décide du
   * code de sortie et du `.env`, donc lui qui choisit ce que le script devrait
   * conclure. Rien d'autre n'est simulé — le script lit le `.env` pour de vrai,
   * lance `npm run ruche` pour de vrai, et interroge le port pour de vrai.
   */
  function courir(options: {
    codeInstall: number;
    env?: string | null;
    permissions?: number;
    rucheRepond?: boolean;
    tableau?: 'construit' | 'repli';
    rangeLeProjet?: boolean;
    /** L'invité s'inscrit-il vraiment ? Le bouton qui fait MENTIR le pas 6. */
    inviteEntre?: boolean;
    /** Le faux script d'entrée réinstalle-t-il au lieu de reconnaître ? */
    inviteReinstalle?: boolean;
    /**
     * Le travail confié aboutit-il ? Le bouton qui fait MENTIR le pas 7.
     *
     * `false` : la ruche PREND la tâche, la marque `failed`, et ne range aucun
     * résultat — ce qu'une ouvrière sans agent produit réellement. C'est le
     * seul monde qui distingue un pas 7 qui MESURE d'un pas 7 qui décore.
     */
    travailAboutit?: boolean;
    args?: string[];
  }): { code: number; sortie: string } {
    const dossier = mkdtempSync(path.join(os.tmpdir(), 'banc-seuil-'));
    dossiers.push(dossier);

    cpSync(SCRIPT, path.join(dossier, 'essai-installation.sh'));
    for (const v of VOISINS) cpSync(v, path.join(dossier, path.basename(v)));

    // Tout est posé par le FAUX INSTALLEUR, dans le dossier qu'il reçoit en
    // `--dir` — pas à côté. Première version : les fichiers étaient écrits dans
    // le dossier de travail du banc, et `npm run ruche` mourait sur un
    // `package.json` introuvable. La leçon est celle du script lui-même : le
    // pas 3 lance la ruche DEPUIS l'installation, jamais depuis ailleurs.
    //
    // Les documents passent par des heredocs entre quotes : `printf '%s'`
    // n'interprète pas les échappements, et une chaîne JSON y aurait déposé un
    // « \n » littéral. Mesuré — le port lu valait `36465\nHIVE_TOKEN`.
    // ─── LA FAUSSE RUCHE PARLE MAINTENANT LES ROUTES DU PARCOURS ───────────
    //
    // Elle rendait `{}` sur tout. Cela suffisait tant que l'essai s'arrêtait à
    // `/api/pulse` ; les pas 4 et 5 lui demandent trois choses distinctes, et
    // une fausse ruche qui répond la même chose à toutes ne départage rien.
    //
    // Les deux boutons — `tableau` et `rangeLeProjet` — existent pour que le
    // banc puisse MENTIR : c'est en la faisant mentir qu'on voit si les
    // nouveaux pas mordent, ou s'ils décorent.
    const PAGE_CONSTRUITE =
      '<!doctype html><html><head><script type="module" src="/assets/x.js"></script>' +
      '</head><body><div id="root"></div></body></html>';
    const PAGE_REPLI =
      '<!doctype html><html><body><main><code>npm run build:dashboard</code></main></body></html>';
    const page = options.tableau === 'repli' ? PAGE_REPLI : PAGE_CONSTRUITE;
    const range = options.rangeLeProjet !== false;

    const ruche =
      options.rucheRepond === false
        ? 'process.exit(0);'
        : [
            "import { createServer } from 'node:http';",
            "import { readFileSync } from 'node:fs';",
            "const env = readFileSync(new URL('.env', import.meta.url), 'utf8');",
            "const port = Number(/^HIVE_PORT=(.*)$/m.exec(env)?.[1] ?? '0');",
            `const PAGE = ${JSON.stringify(page)};`,
            `const RANGE = ${range};`,
            'const projets = [];',
            'const noeuds = [];',
            'const taches = [];',
            `const ABOUTIT = ${options.travailAboutit !== false};`,
            'createServer((q, r) => {',
            "  if (q.url === '/') {",
            "    r.writeHead(200, { 'content-type': 'text/html' });",
            '    return r.end(PAGE);',
            '  }',
            "  if (q.url === '/api/projects' && q.method === 'POST') {",
            "    const id = 'p-' + projets.length;",
            '    if (RANGE) projets.push({ id });',
            "    r.writeHead(201, { 'content-type': 'application/json' });",
            '    return r.end(JSON.stringify({ id }));',
            '  }',
            // ─── ET MAINTENANT LE PAS 6 : ELLE FRAPPE DES BILLETS ──────────
            //
            // La fausse ruche doit remettre une commande d'entrée COMPLÈTE,
            // sans quoi l'essai s'arrête avant d'avoir rien joué. Elle expose
            // aussi une porte que seul le faux script d'entrée pousse : c'est
            // ainsi que « l'invité est entré » devient observable sans WebSocket
            // ni vrai nœud.
            "  if (q.url === '/api/billets' && q.method === 'POST') {",
            "    const b = 'hive2_billetDeBanc-01';",
            "    r.writeHead(200, { 'content-type': 'application/json' });",
            '    return r.end(',
            '      JSON.stringify({',
            '        billet: b,',
            "        entree: { posix: 'sh rejoindre.sh ' + b, windows: 'pwsh rejoindre.ps1 ' + b },",
            '      }),',
            '    );',
            '  }',
            "  if (q.url === '/api/faux-noeud' && q.method === 'POST') {",
            "    noeuds.push({ id: 'node-invite-du-banc' });",
            '    r.writeHead(201);',
            "    return r.end('');",
            '  }',
            // ─── ET LE PAS 7 : ELLE PREND UN TRAVAIL, ET LE REND ───────────
            //
            // Trois routes, parce que le pas en demande trois : créer la tâche,
            // la voir finir dans l'instantané, et lire le résultat rangé. Une
            // fausse ruche qui n'en servirait que deux ferait rougir le pas
            // pour une raison qui n'est pas celle qu'on éprouve.
            //
            // `ABOUTIT` est le mensonge : la tâche est PRISE et marquée
            // `failed`, sans résultat. C'est exactement ce qu'une ouvrière sans
            // agent utilisable rend — le défaut que le pas 7 a trouvé le jour
            // de sa première exécution.
            "  if (q.method === 'POST' && /^\\/api\\/projects\\/[^/]+\\/tasks$/.test(q.url)) {",
            "    const id = 't-du-banc-' + taches.length;",
            "    taches.push({ id, status: ABOUTIT ? 'done' : 'failed' });",
            "    r.writeHead(201, { 'content-type': 'application/json' });",
            '    return r.end(JSON.stringify([{ id }]));',
            '  }',
            '  if (/^\\/api\\/tasks\\/[^/]+\\/results$/.test(q.url)) {',
            "    r.writeHead(200, { 'content-type': 'application/json' });",
            '    return r.end(',
            '      JSON.stringify(',
            '        ABOUTIT',
            "          ? [{ nodeId: noeuds[0]?.id ?? 'n-?', success: true, diff: '--- a\\n+++ b\\n' }]",
            '          : [],',
            '      ),',
            '    );',
            '  }',
            "  if (q.url === '/api/state') {",
            "    r.writeHead(200, { 'content-type': 'application/json' });",
            '    return r.end(JSON.stringify({ projects: projets, nodes: noeuds, tasks: taches }));',
            '  }',
            "  r.writeHead(200, { 'content-type': 'application/json' });",
            "  r.end('{}');",
            '})',
            "  .listen(port, '127.0.0.1');",
          ].join('\n');

    // ─── LE FAUX SCRIPT D'ENTRÉE, ET SES DEUX MENSONGES POSSIBLES ────────────
    //
    // `inviteEntre: false` — il dit tout ce qu'il faut et n'inscrit personne.
    //     C'est le cas qui départage un pas 6 qui MESURE d'un pas 6 qui décore :
    //     tout le texte attendu est là, seul le résultat manque.
    //
    // `inviteReinstalle: true` — il annonce une installation. Le vrai script le
    //     ferait en tirant du dépôt PUBLIC : l'essai mesurerait alors `main` et
    //     non l'arbre livré, en restant vert.
    //
    // Il dort ensuite, comme le vrai qui `exec npm run join` : c'est
    // l'instrument qui emporte son groupe de processus.
    const faussEntree = [
      '#!/usr/bin/env sh',
      options.inviteReinstalle === true
        ? 'echo "→ Installation de Hive dans $HIVE_DIR…"'
        : 'echo "→ Hive est déjà installé dans $HIVE_DIR — on rejoint directement."',
      // ─── QUAND IL N'INSCRIT PERSONNE, IL REND LA MAIN TOUT DE SUITE ────────
      //
      // Première version : il dormait 60 s comme le vrai. Mesuré — l'instrument
      // attend 90 s, donc la mort du script arrivait AVANT l'épuisement de
      // l'attente, et le cas rougissait sur « s'est arrêté » là où il cherchait
      // « aucun nœud neuf ». Les deux verdicts sont justes ; c'était l'attente
      // du banc qui visait le mauvais.
      //
      // On garde donc la mort immédiate : elle est déterministe, elle coûte une
      // seconde au lieu de quatre-vingt-dix, et c'est une panne réelle — un
      // script d'entrée qui rend la main sans avoir fait entrer personne.
      //
      // ⚠ CE QUI RESTE NON EXERCÉ, et c'est dit plutôt que tu : la branche
      // « l'attente s'épuise » (un script qui vit et n'inscrit jamais rien). La
      // jouer coûterait 90 s par exécution sur les trois jambes.
      ...(options.inviteEntre === false
        ? []
        : [
            // Le port est LU dans le `.env` que ce même banc vient d'écrire —
            // pas reçu en second exemplaire. Deux sources pour un seul chiffre
            // finissent toujours par diverger, et celle-ci divergerait en
            // silence : le faux script pousserait une porte fermée, et le pas 6
            // rougirait sur un banc mal câblé plutôt que sur le produit.
            `curl -fsS -m 5 -X POST "http://127.0.0.1:${/^HIVE_PORT=(.*)$/m.exec(options.env ?? '')?.[1] ?? '0'}/api/faux-noeud" >/dev/null 2>&1 || true`,
            // Puis il vit, comme le vrai qui `exec npm run join` : c'est
            // l'instrument qui emporte son groupe de processus.
            'sleep 60',
          ]),
    ];

    const pose =
      options.env === null || options.env === undefined
        ? []
        : [
            'mkdir -p "$CIBLE"',
            'cat > "$CIBLE/.env" <<\'ENVFIN\'',
            options.env.replace(/\n$/, ''),
            'ENVFIN',
            `chmod ${(options.permissions ?? 0o600).toString(8).padStart(3, '0')} "$CIBLE/.env"`,
            'cat > "$CIBLE/package.json" <<\'PKGFIN\'',
            '{ "name": "faux-chantier", "private": true, "scripts": { "ruche": "node ruche.mjs" } }',
            'PKGFIN',
            'cat > "$CIBLE/ruche.mjs" <<\'RUCHEFIN\'',
            ruche,
            'RUCHEFIN',
            // ─── CE QUE LE PAS 6 A BESOIN DE TROUVER ─────────────────────────
            //
            // `node_modules` : c'est à ce dossier que `rejoindre.sh` reconnaît
            // une installation. Vide ici — l'instrument le LIE, il ne le lit
            // pas.
            'mkdir -p "$CIBLE/node_modules"',
            // Et un faux script d'entrée. Le vrai ouvre un WebSocket et fait
            // vivre un nœud ; celui-ci pousse une porte de la fausse ruche, ce
            // qui rend « l'invité est entré » observable sans rien simuler de ce
            // qu'on mesure — le VERDICT reste celui de l'instrument.
            'cat > "$CIBLE/rejoindre.sh" <<\'ENTREEFIN\'',
            ...faussEntree,
            'ENTREEFIN',
            'chmod 755 "$CIBLE/rejoindre.sh"',
          ];

    writeFileSync(
      path.join(dossier, 'install.sh'),
      [
        '#!/usr/bin/env sh',
        'CIBLE=""',
        'for a in "$@"; do case "$a" in --dir=*) CIBLE="${a#--dir=}" ;; esac; done',
        ...pose,
        `exit ${options.codeInstall}`,
        '',
      ].join('\n'),
    );
    chmodSync(path.join(dossier, 'install.sh'), 0o755);

    const verdict = spawnSync('sh', ['essai-installation.sh', ...(options.args ?? [])], {
      cwd: dossier,
      encoding: 'utf8',
      // shell: false par défaut — aucun argument ne traverse d'interpréteur.
      timeout: 90_000,
    });

    return { code: verdict.status ?? -1, sortie: `${verdict.stdout}${verdict.stderr}` };
  }

  function envValide(port: number): string {
    return `HIVE_PORT=${port}\nHIVE_TOKEN=jeton-de-banc-suffisamment-long\n`;
  }

  it('LES SEPT AFFIRMATIONS passent quand tout va bien', async () => {
    // ─── TROIS PAS, PUIS CINQ, PUIS SEPT ───────────────────────────────────
    //
    // Ce cas s'est appelé « les trois affirmations », puis « les cinq ».
    // L'essai en mène maintenant SEPT : l'invité qui entre, et le travail qui
    // aboutit — le seul geste qui prouve que le produit fait ce qu'il promet.
    //
    // Le nom compte plus qu'il n'en a l'air, et c'est la troisième fois qu'il
    // faut le changer. Tant qu'il disait « cinq », un essai amputé de ses deux
    // derniers pas serait resté VERT sous un titre qui ne mentait pas — et le
    // compte des `✔` ci-dessous est la seule chose qui empêche cette dérive.
    const port = await portLibre();
    const { code, sortie } = courir({ codeInstall: 0, env: envValide(port) });

    expect(sortie).toContain('✔ 1/3');
    expect(sortie).toContain('✔ 2/3 — .env en -rw-------');
    expect(sortie, 'le seul pas qui ne peut pas être simulé').toContain('✔ 3/3');
    expect(sortie, 'le tableau n’est pas ouvert').toContain('✔ 4/5');
    expect(sortie, 'le premier projet n’est pas créé').toContain('✔ 5/5');
    expect(sortie, 'l’invité n’est pas entré').toContain('✔ 6/6');
    expect(sortie, 'le travail confié n’aboutit pas').toContain('✔ 7/7');
    expect(code).toBe(0);
  });

  it('UN TRAVAIL QUI N’ABOUTIT PAS fait rougir — la ruche l’a PRIS, et n’a rien rendu', async () => {
    // ─── LE CAS QUI DÉPARTAGE LE PAS 7 ─────────────────────────────────────
    //
    // La fausse ruche accepte la tâche, la marque `failed`, et ne range aucun
    // résultat. C'est mot pour mot ce qu'une ouvrière sans agent utilisable
    // rend — le défaut réel que le pas 7 a trouvé à sa toute première
    // exécution, contre une ruche où le démon Docker ne tournait pas.
    //
    // Sans ce cas, un pas 7 qui se contenterait de créer la tâche et de dire
    // « ✔ » serait vert sur une ruche qui ne produit rien. C'est le même monde
    // que `inviteEntre: false` pour le pas 6 : tout le décor est là, et il ne
    // s'est rien passé.
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      travailAboutit: false,
    });

    expect(sortie, 'les six premiers pas doivent passer — sinon on mesure autre chose').toContain(
      '✔ 6/6',
    );
    expect(sortie, 'un travail raté est annoncé comme un succès').not.toContain('✔ 7/7');
    expect(sortie, 'le refus ne dit pas ce qui s’est passé').toContain('raté');
    expect(code, 'l’essai sort en 0 sur une ruche qui n’a rien produit').toBe(1);
  });

  it('UN INVITÉ QUI N’ENTRE PAS fait rougir — même s’il dit tout ce qu’il faut', async () => {
    // ─── LE CAS QUI DÉPARTAGE LE PAS 6 ─────────────────────────────────────
    //
    // Le faux script d'entrée annonce exactement ce qu'annonce le vrai : « Hive
    // est déjà installé — on rejoint directement ». Il n'inscrit simplement
    // personne.
    //
    // C'est le seul monde qui distingue un pas 6 qui MESURE d'un pas 6 qui
    // décore : tout le texte attendu est là, et il ne s'est rien passé. Sans ce
    // cas, une garde qui se contenterait de lire la sortie du script serait
    // verte sur une ruche où aucun invité ne peut entrer.
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      inviteEntre: false,
    });

    expect(sortie, 'les cinq premiers pas doivent passer').toContain('✔ 5/5');
    expect(sortie, 'le pas 6 se déclare vert sans invité').not.toContain('✔ 6/6');
    expect(sortie, 'l’échec ne dit pas ce qui manque').toContain('sans faire entrer personne');
    expect(code, 'un invité qui n’entre pas n’est pas un succès').not.toBe(0);
  }, 120_000);

  it('UNE RÉINSTALLATION fait rougir — l’essai mesurerait `main`, pas l’arbre livré', async () => {
    // ─── LE PIÈGE QUE CE CAS FERME ─────────────────────────────────────────
    //
    // La branche « installer » du vrai script d'entrée va chercher `install.sh`
    // SUR LE DÉPÔT PUBLIC. Prise par accident — un `node_modules` absent du
    // poste d'invité suffit — l'essai durerait des minutes et mesurerait le code
    // de `main` au lieu de celui qu'on livre. En restant vert.
    //
    // Un essai qui mesure la mauvaise version sans le dire est pire qu'un essai
    // absent : il porte un verdict qu'on croit.
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      inviteReinstalle: true,
    });

    expect(sortie, 'le pas 6 accepte une réinstallation').not.toContain('✔ 6/6');
    expect(sortie, 'l’échec ne nomme pas le risque').toContain('REINSTALLÉ');
    expect(code).not.toBe(0);
  }, 120_000);

  it('UN TABLEAU NON CONSTRUIT fait rougir — 200 ne veut pas dire « ça marche »', async () => {
    // ─── LE CAS QUI DÉPARTAGE LE PAS 4 ─────────────────────────────────────
    //
    // La page de repli rend HTTP 200, comme le tableau. Un essai qui regarde le
    // code de statut les déclare identiques — et déclare donc « installé » une
    // ruche où l'arrivant lit un mode d'emploi au lieu d'utiliser le produit.
    //
    // Sans ce cas, le pas 4 serait du décor : il passerait sur les deux mondes.
    const port = await portLibre();
    const { code, sortie } = courir({ codeInstall: 0, env: envValide(port), tableau: 'repli' });

    expect(sortie, 'le pas 4 accepte une page de repli').not.toContain('✔ 4/5');
    expect(sortie).toContain('l’écran n’est pas construit');
    expect(code, 'un tableau absent laisse l’essai vert').toBe(1);
  });

  it('UN PROJET CRÉÉ MAIS NON RANGÉ fait rougir — 201 ne prouve pas qu’il existe', async () => {
    // ─── LE CAS QUI DÉPARTAGE LE PAS 5 ─────────────────────────────────────
    //
    // La fausse ruche répond 201 avec un identifiant, et ne range rien. C'est
    // exactement ce que ferait une création dont l'écriture échoue en silence :
    // l'appelant reçoit un projet, le magasin n'en a aucun.
    //
    // Se fier à l'écho de la création serait vert ici. C'est pourquoi le pas 5
    // relit l'instantané que LIT LE TABLEAU — le seul point de vue qui soit
    // celui de l'arrivant.
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      rangeLeProjet: false,
    });

    expect(sortie).toContain('✔ 4/5');
    expect(sortie, 'le pas 5 se contente de l’écho de la création').not.toContain('✔ 5/5');
    expect(sortie).toContain('n’est PAS dans l’instantané');
    expect(code).toBe(1);
  });

  it('un `.env` ABSENT est dit, et il fait rougir', async () => {
    // C'est le mutant que la loupe avait planté : `[ -f … ] ||` devenu `&&`.
    // Avec lui, un `.env` manquant ne déclenche plus rien et le script échoue
    // plus loin, sur un `ls`, sans jamais nommer ce qui manque.
    const { code, sortie } = courir({ codeInstall: 0, env: null });

    expect(sortie).toContain('✘ .env absent');
    expect(code).toBe(1);
  });

  it('un `.env` lisible par tous fait rougir — un secret n’est pas un réglage', async () => {
    const port = await portLibre();
    const { code, sortie } = courir({
      codeInstall: 0,
      env: envValide(port),
      permissions: 0o644,
    });

    expect(sortie).toContain('un secret doit être en 0600');
    expect(sortie, 'le pas 2 ne doit pas se déclarer réussi').not.toContain('✔ 2/3');
    expect(code).toBe(1);
  });

  it('un `.env` sans HIVE_PORT fait rougir plutôt que de supposer 7777', async () => {
    // Supposer le port ferait passer le pas 3 sur une ruche qu'on n'a pas
    // installée — un vert emprunté, c'est-à-dire le pire des rouges.
    const { code, sortie } = courir({
      codeInstall: 0,
      env: 'HIVE_TOKEN=jeton-de-banc-suffisamment-long\n',
    });

    expect(sortie).toContain('✘ .env sans HIVE_PORT');
    expect(code).toBe(1);
  });

  it('une installation qui échoue est redonnée telle quelle, avec son code', async () => {
    const { code, sortie } = courir({ codeInstall: 7, env: null });

    expect(sortie).toContain('✘ installation sortie en 7');
    expect(code).toBe(1);
  });

  it('« je n’ai pas pu conclure » n’est PAS « le produit est cassé »', async () => {
    // 4 = PORT_OCCUPE : un service étranger tient le port par défaut.
    // Confondre ce cas avec un rouge apprend à relancer au lieu de lire, et
    // c'est ainsi qu'on cesse de croire aux rouges.
    const { code, sortie } = courir({ codeInstall: 4, env: null });

    expect(sortie).toContain('NON CONCLUANT');
    expect(code, '78, pas 1').toBe(78);
  });

  it('un drapeau inconnu est refusé plutôt qu’ignoré', async () => {
    const { code, sortie } = courir({ codeInstall: 0, env: null, args: ['--parapluie'] });

    expect(sortie).toContain('argument inconnu : --parapluie');
    expect(code).toBe(64);
  });

  it('le dossier d’essai ne survit pas à la course, même quand elle échoue', async () => {
    // Les deux ménages précédents laissaient des ruches vivantes, et le rouge
    // apparaissait plus tard dans un banc innocent (§ 9 sexquinquagies).
    const { sortie } = courir({ codeInstall: 0, env: null });

    const trace = /hive-essai-installation-\d+/.exec(sortie);
    expect(trace, 'le script annonce son dossier').not.toBeNull();
    expect(
      spawnSync('test', ['-d', path.join(os.tmpdir(), trace?.[0] ?? 'introuvable')]).status,
      'le dossier doit avoir disparu',
    ).not.toBe(0);
  });
});
