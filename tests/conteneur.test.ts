// L'image et son orchestration — `Dockerfile`, `.dockerignore`, `compose`.
//
// ─── CE QUI EST VÉRIFIÉ ICI, ET CE QUI L'EST EN CI ───────────────────────────
//
// Ces trois fichiers vivent hors de la compilation et hors du typage : rien ne
// les regarderait. C'est la même famille que les installeurs, et elle a déjà
// coûté assez cher à ce dépôt pour qu'on ne recommence pas.
//
//   · ici : les invariants lisibles — la version de Node, la base d'image, le
//     compte qui exécute, et surtout CE QUI NE DOIT JAMAIS ENTRER dans le
//     contexte de construction ;
//   · en CI : l'image est CONSTRUITE, la ruche y démarre, elle répond sur
//     `/api/health`, et le module natif est chargé pour de vrai. Un Dockerfile
//     qu'on ne construit jamais est une promesse de plus que rien n'exerce.
//
// Le second n'est pas faisable ici : ce conteneur n'a pas de démon Docker.
// C'est dit à voix haute plutôt que laissé croire.

import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { NODE_MINIMUM } from '../src/shared/doctor.js';
import { PORT_PAR_DEFAUT } from '../src/shared/port.js';

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

const DOCKERFILE = lire('Dockerfile');
const IGNORE = lire('.dockerignore');
const COMPOSE = lire('docker-compose.yml');

/** Sans les commentaires — sinon la prose ferait passer les gardes. */
const nu = (s: string): string => s.replace(/^\s*#.*$/gm, '');
const DOCKERFILE_NU = nu(DOCKERFILE);
const COMPOSE_NU = nu(COMPOSE);

/**
 * L'unique couche de l'étage qui SERT, continuations recollées.
 *
 * Un `RUN` étalé sur quinze lignes par des `\` reste UNE couche : c'est cette
 * unité-là qu'il faut examiner, pas les lignes du fichier. Docker met en cache
 * la couche entière ou rien — d'où l'intérêt d'y trouver l'installation ET sa
 * vérification.
 */
const coucheQuiSert = (): string => {
  const lignes = DOCKERFILE_NU.replace(/\\\r?\n\s*/g, ' ')
    .split(/\r?\n/)
    .filter((l) => /npm ci/.test(l) && l.includes('--omit=dev'));
  expect(lignes.length, 'l’étage qui sert doit avoir exactement un `npm ci --omit=dev`').toBe(1);
  return lignes[0]!;
};

/**
 * La seule partie de cette couche qui puisse faire ROUGIR la construction :
 * ce qui suit le `done` de la boucle de reprise.
 *
 * ─── POURQUOI CE DÉCOUPAGE EXISTE ────────────────────────────────────────────
 *
 * La première version de ces gardes cherchait les `require` dans la couche
 * ENTIÈRE. La loupe l'a prise en défaut : en retirant `@fastify/static` de la
 * vérification finale, les 24 tests restaient verts — la sonde de la boucle,
 * qui mentionne les mêmes paquets, suffisait à les satisfaire.
 *
 * Et ce n'était pas qu'un test faible, c'était un vrai trou : un paquet
 * vérifié seulement dans la boucle fait échouer la sonde, donc épuiser les
 * trois tentatives… puis la boucle sort avec 0, la vérification finale ne
 * regarde pas ce paquet, et l'image part verte sans lui.
 *
 * On ne regarde donc que ce qui décide.
 */
const verificationFinale = (): string => {
  const couche = coucheQuiSert();
  const i = couche.search(/done\s*&&\s*node -e/);
  expect(i, 'la vérification ne suit plus le `done` : plus rien ne fait rougir').toBeGreaterThan(
    -1,
  );
  return couche.slice(i);
};

describe('LES TROIS FICHIERS EXISTENT', () => {
  it('à la racine, là où `docker build .` et `docker compose up` les cherchent', () => {
    for (const f of ['Dockerfile', '.dockerignore', 'docker-compose.yml']) {
      expect(existsSync(path.join(RACINE, f)), `${f} manquant`).toBe(true);
    }
  });
});

describe('AUCUN SECRET NE PEUT ENTRER DANS L’IMAGE', () => {
  // ─── LA GARDE LA PLUS IMPORTANTE DU FICHIER ────────────────────────────────
  //
  // Une couche Docker est IMMUABLE. Un `.env` copié par mégarde y reste même
  // si une couche ultérieure le supprime : `docker history` le rend, et une
  // image poussée quelque part le publie. Un jeton qui a fuité de cette
  // façon-là ne se rattrape pas en corrigeant le Dockerfile — il faut le
  // révoquer, et donc s'en apercevoir.
  //
  // `.dockerignore` est ce qui fait que le fichier n'atteint même pas le démon.

  it('`.env` et la base sont exclus du contexte de construction', () => {
    for (const motif of ['.env', 'data/', '*.db']) {
      expect(IGNORE, `${motif} devrait être ignoré`).toMatch(
        new RegExp(`^${motif.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm'),
      );
    }
    // Les fichiers frères de SQLite aussi : un `-wal` copié seul ne sert à
    // rien, mais il contient les écritures récentes.
    expect(IGNORE).toMatch(/^\*\.db-wal$/m);
    expect(IGNORE).toMatch(/^\*\.db-shm$/m);
  });

  it('`.env.example` reste, lui — c’est un modèle, pas un secret', () => {
    expect(IGNORE).toMatch(/^!\.env\.example$/m);
  });

  it('le Dockerfile ne COPIE jamais de secret, et n’en grave aucun', () => {
    // Ni copie explicite, ni `ENV` qui porterait une valeur.
    expect(DOCKERFILE_NU, 'le Dockerfile copie un .env').not.toMatch(/^\s*COPY\s+[^\n]*\.env/m);
    for (const cle of ['HIVE_TOKEN', 'HIVE_JWT_SECRET', 'ANTHROPIC_API_KEY', 'HIVE_GITHUB_TOKEN']) {
      expect(DOCKERFILE_NU, `${cle} figé dans l’image`).not.toContain(cle);
    }
  });

  it('compose passe les secrets par FICHIER, jamais en ligne de commande', () => {
    // `docker run -e HIVE_TOKEN=…` se lit dans `ps` de n'importe quel compte
    // de la machine. C'est la contrainte §5.1 du projet, appliquée ici.
    expect(COMPOSE_NU).toMatch(/env_file:/);
    expect(COMPOSE_NU, 'une valeur de secret en clair dans compose').not.toMatch(
      /HIVE_TOKEN\s*[:=]\s*\S/,
    );
  });
});

describe('LA BASE DE L’IMAGE', () => {
  it('est la MÊME version de Node que partout ailleurs', () => {
    // Le plancher est écrit dans `NODE_MINIMUM`, `engines.node`, les deux
    // installeurs, et maintenant ici. Un cinquième endroit qui diverge, c'est
    // une image qui vérifie une configuration que personne n'installe.
    for (const m of DOCKERFILE.matchAll(/^FROM\s+node:(\d+)/gm)) {
      expect(Number(m[1]), `FROM node:${m[1]} ne suit plus NODE_MINIMUM`).toBe(NODE_MINIMUM);
    }
    expect([...DOCKERFILE.matchAll(/^FROM\s+node:/gm)].length, 'aucun FROM node:').toBeGreaterThan(
      0,
    );
  });

  it('N’EST PAS ALPINE — `better-sqlite3` n’y a pas de binaire prébuilt', () => {
    // Sur musl, npm doit COMPILER le module natif : python3, make et g++ dans
    // l'image, plusieurs minutes de plus, et un échec sur toute machine où l'un
    // des trois manque.
    //
    // Et comme la dépendance est OPTIONNELLE, cet échec ne fait pas échouer
    // `npm ci` : on obtient une image « réussie » dont le démarrage meurt sur
    // ERR_MODULE_NOT_FOUND. C'est la panne exacte que Node 24 a supprimée côté
    // poste de travail ; la réintroduire ici serait la refaire.
    expect(DOCKERFILE_NU, 'alpine réintroduit la compilation du module natif').not.toMatch(
      /FROM\s+node:\S*alpine/,
    );
  });

  it('garde les dépendances OPTIONNELLES — sans elles la ruche ne démarre pas', () => {
    // `--omit=dev` retire TypeScript et Vite : c'est voulu. `--omit=optional`
    // retirerait `better-sqlite3` et Fastify : ce serait une image inerte.
    expect(DOCKERFILE_NU).toMatch(/npm ci --omit=dev/);
    expect(DOCKERFILE_NU, '--omit=optional rendrait l’image inerte').not.toContain(
      '--omit=optional',
    );
  });

  it('AUCUN `npm ci` NE DÉCLENCHE `prepare` — le défaut qui a rougi la première construction', () => {
    // ─── CE QUE CE TEST GARDE ─────────────────────────────────────────────
    //
    // `package.json` porte « prepare: npm run build:node », et npm lance
    // `prepare` à CHAQUE `npm ci` — y compris avec `--omit=dev`. Les deux
    // étages de l'image tombaient dessus, chacun à sa façon :
    //
    //   étage 1 : `prepare` s'exécute alors que seuls les deux manifestes ont
    //             été copiés → error TS5058, `tsconfig.build.json` absent.
    //   étage 2 : `--omit=dev` a retiré TypeScript, et `prepare` appelle
    //             `tsc` → sh: 1: tsc: not found, npm error code 127.
    //
    // Rien dans le Dockerfile ne le laissait voir : la ligne fautive est dans
    // `package.json`, à deux fichiers de là.
    const logiques = DOCKERFILE_NU.replace(/\\\r?\n\s*/g, ' ')
      .split(/\r?\n/)
      .filter((l) => /npm ci/.test(l));

    expect(logiques.length, 'plus aucun `npm ci` : ce test garde le vide').toBeGreaterThan(0);

    for (const ligne of logiques) {
      const neutralise =
        ligne.includes('--ignore-scripts') || /npm pkg delete scripts\.prepare/.test(ligne);
      expect(neutralise, `« ${ligne.trim()} » laisserait tourner \`prepare\``).toBe(true);
    }
  });

  it('…mais l’étage QUI SERT ne se neutralise pas au `--ignore-scripts`', () => {
    // Le correctif d'une ligne est un piège : `--ignore-scripts` tuerait aussi
    // le script d'installation de `better-sqlite3`, celui qui télécharge le
    // binaire prébuilt. Mesuré sur les deux vrais manifestes de ce dépôt :
    //
    //   tel quel                        npm ci → 127        (tsc: not found)
    //   --ignore-scripts                npm ci → 0          binaire ABSENT
    //   npm pkg delete scripts.prepare  npm ci → 0          binaire présent
    //
    // La ligne du milieu construit une image verte qui meurt au démarrage sur
    // un module natif introuvable — la panne exacte que le choix de `slim`
    // plutôt qu'`alpine` évite vingt lignes plus haut. Une image qui échoue à
    // se construire est un problème ; une image qui se construit et ne démarre
    // pas est un piège.
    const sert = DOCKERFILE_NU.replace(/\\\r?\n\s*/g, ' ')
      .split(/\r?\n/)
      .filter((l) => /npm ci/.test(l) && l.includes('--omit=dev'));

    expect(sert.length, 'l’étage qui sert doit installer sans les dépendances de dev').toBe(1);
    expect(sert[0], '`--ignore-scripts` ici priverait la ruche de son module natif').not.toContain(
      '--ignore-scripts',
    );
    expect(sert[0]).toMatch(/npm pkg delete scripts\.prepare/);
  });

  it('LA COUCHE QUI INSTALLE VÉRIFIE CE QU’ELLE A INSTALLÉ', () => {
    // ─── LE PIÈGE QUE CETTE GARDE FERME ──────────────────────────────────────
    //
    // Les quatre dépendances nécessaires au démarrage sont OPTIONNELLES — un
    // nœud membre, qui ne fait que prêter du temps-machine, n'en a pas l'usage.
    // Seulement « optionnel » veut dire, pour npm : SI L'INSTALLATION ÉCHOUE,
    // JE CONTINUE. `better-sqlite3` télécharge un binaire prébuilt ; quand ce
    // téléchargement rate, npm avertit, retire le paquet, et SORT AVEC 0.
    //
    // Mesuré sur ce dépôt : deux constructions du MÊME Dockerfile et du MÊME
    // lock, à quatre minutes d'écart.
    //
    //     a8f8909  06:05  image construite, ruche démarrée        vert
    //     a3ceec0  06:10  image construite, ruche morte au boot   rouge
    //
    // Aucune ligne de code ne sépare ces deux images : le second commit ne
    // touche que deux fichiers Markdown. Le test d'à côté garde le cas
    // `--ignore-scripts`, qui est l'autre cause de la MÊME panne ; celui-ci
    // garde le cas où personne n'a rien écrit de faux et où le réseau a suffi.
    //
    // La vérification doit vivre DANS LA MÊME COUCHE que l'installation.
    // Séparée, Docker pourrait garder en cache une couche d'installation
    // cassée et ne plus jamais la revérifier : une couche mise en cache serait
    // alors une couche jamais vérifiée.
    // On interroge la VÉRIFICATION FINALE, pas la couche entière : la sonde de
    // la boucle cite les mêmes paquets et rendrait cette garde inopérante.
    // C'est la loupe qui l'a montré — voir `verificationFinale`.
    const verif = verificationFinale();
    for (const paquet of ['better-sqlite3', 'fastify', '@fastify/cors', '@fastify/static']) {
      expect(verif, `${paquet} n’est pas vérifié là où ça fait rougir`).toContain(
        `require('${paquet}')`,
      );
    }
  });

  it('…et elle OUVRE une base — résoudre le module ne prouve pas que le natif répond', () => {
    // Un `require` qui aboutit prouve que le dossier est là. Il ne prouve pas
    // que le `.node` se charge, ni que SQLite répond : la panne d'un binaire
    // natif ne se voit qu'à l'usage.
    const verif = verificationFinale();
    expect(verif, 'aucune base n’est ouverte à la construction').toContain(':memory:');
    expect(verif).toContain('CREATE TABLE');
    expect(verif, 'ouvrir sans relire ne prouve pas que la base répond').toMatch(
      /SELECT count\(\*\)/,
    );
  });

  it('LA REPRISE S’APPUIE SUR LA VÉRIFICATION, PAS SUR LE CODE DE SORTIE', () => {
    // Reprendre sur le code de sortie ne rattraperait rien : il vaut 0
    // précisément dans le cas qu'on veut rattraper. C'est la même leçon
    // qu'`--retry-connrefused` en CI — encore faut-il reprendre sur la BONNE
    // panne.
    //
    // Et la boucle sort TOUJOURS avec 0, même quand ses trois tentatives
    // échouent — mesuré au shell, pas supposé. C'est donc la vérification
    // finale, chaînée en `&&` APRÈS le `done`, qui fait rougir la
    // construction. Une vérification placée dans la boucle laisserait passer
    // une image cassée.
    const couche = coucheQuiSert();
    expect(couche, 'aucune reprise : un aléa réseau suffit à casser l’image').toMatch(/for essai/);
    expect(couche, 'la vérification qui fait rougir doit suivre le `done`').toMatch(
      /done\s*&&\s*node -e/,
    );
  });

  it('installe depuis le LOCK, pas depuis une résolution du jour', () => {
    // `npm install` dans une image donne une image qu'on ne peut pas
    // reproduire : deux constructions du même commit peuvent différer.
    expect(DOCKERFILE_NU).toMatch(/npm ci/);
    expect(DOCKERFILE_NU, 'npm install rend l’image irreproductible').not.toMatch(
      /^\s*RUN\s+npm install/m,
    );
  });
});

describe('CE QUE L’IMAGE NE S’AUTORISE PAS', () => {
  it('ELLE NE TOURNE PAS EN ROOT', () => {
    // Une ruche n'a aucune raison d'avoir les droits d'administration du
    // conteneur — et un agent qui s'échapperait de son bac à sable les
    // trouverait. La CI le vérifie en plus par `id -un`.
    expect(DOCKERFILE_NU).toMatch(/^USER\s+node\s*$/m);
    const lignes = DOCKERFILE_NU.split('\n');
    const user = lignes.findIndex((l) => /^USER\s+node/.test(l));
    const cmd = lignes.findIndex((l) => /^CMD\s/.test(l));
    // `USER` doit précéder `CMD`, sinon il ne s'applique pas au processus.
    expect(user, 'USER node absent').toBeGreaterThan(-1);
    expect(user, 'USER node arrive APRÈS le CMD').toBeLessThan(cmd);
  });

  it('compose PUBLIE SUR LA BOUCLE LOCALE, pas sur toutes les interfaces', () => {
    // ─── LE DÉFAUT QUE CETTE GARDE FERME ─────────────────────────────────────
    //
    // `ports: - '7777:7777'` publie sur TOUTES les interfaces de l'hôte. Et
    // sous Linux, Docker écrit ses règles directement dans netfilter, EN AMONT
    // de la plupart des pare-feu : la ruche se retrouve ouverte sur Internet
    // sans que rien ne l'ait annoncé, et sans que `ufw status` le montre.
    //
    // Pour l'ouvrir vraiment, il y a `hive tunnel` — chiffré, révocable.
    const ports = [...COMPOSE_NU.matchAll(/^\s*-\s*'([^']*:\d+)'/gm)].map((m) => m[1]!);
    expect(ports.length, 'aucun port publié — la garde ne regarde rien').toBeGreaterThan(0);
    for (const p of ports) {
      expect(p, `« ${p} » publie sur toutes les interfaces`).toMatch(/^127\.0\.0\.1:/);
    }
  });

  it('compose durcit le conteneur comme l’unité systemd durcit le service', () => {
    // Mêmes intentions que le lot 9 : pas d'élévation possible, rien
    // d'inscriptible hors de ce qui doit l'être.
    expect(COMPOSE_NU).toMatch(/no-new-privileges:true/);
    expect(COMPOSE_NU).toMatch(/read_only:\s*true/);
    expect(COMPOSE_NU).toMatch(/cap_drop:/);
  });

  it('`restart: unless-stopped`, PAS `always`', () => {
    // Un logiciel qui repart quand on l'a éteint est un logiciel qu'on ne
    // contrôle pas. Même décision que le `SuccessfulExit=false` du LaunchAgent.
    expect(COMPOSE_NU).toMatch(/restart:\s*unless-stopped/);
    expect(COMPOSE_NU).not.toMatch(/restart:\s*always/);
  });
});

describe('LA SONDE DE SANTÉ INTERROGE LA RUCHE, PAS LE PORT', () => {
  it('elle demande `/api/health`, une route qui existe vraiment', () => {
    // Un port ouvert ne dit pas qu'une ruche répond : un processus bloqué garde
    // son écoute. Et la route doit exister — une sonde qui interroge une URL
    // absente échoue toujours, ce qui revient à ne pas avoir de sonde.
    expect(DOCKERFILE_NU).toMatch(/HEALTHCHECK/);
    expect(DOCKERFILE_NU).toContain('/api/health');
    expect(COMPOSE_NU).toContain('/api/health');
    const serveur = lire('src/orchestrator/server.ts');
    expect(serveur, 'la route /api/health n’existe plus').toMatch(
      /app\.get\(\s*['"]\/api\/health['"]/,
    );
  });

  it('le port du conteneur est celui que le serveur écoute par défaut', () => {
    // Une image qui expose 8787 pendant que le serveur écoute 7777 démarre,
    // passe pour saine, et ne répond à personne.
    //
    // Ce banc CHERCHAIT ce défaut par une expression régulière dans le texte de
    // `server.ts`. Il a rougi le jour où la règle du port a déménagé dans
    // `shared/port.ts` — à juste titre, mais pour la mauvaise raison : rien
    // n'avait changé de COMPORTEMENT, seulement d'adresse. Il lit désormais la
    // constante elle-même. Une garde qui suit un fichier suit un déménagement ;
    // une garde qui suit une valeur suit le sens.
    const defaut = String(PORT_PAR_DEFAUT);
    expect(DOCKERFILE_NU, `EXPOSE devrait valoir ${defaut}`).toMatch(
      new RegExp(`^EXPOSE\\s+${defaut}\\s*$`, 'm'),
    );
    expect(DOCKERFILE_NU).toMatch(new RegExp(`ENV HIVE_PORT=${defaut}`));
  });
});

describe('LA CI CONSTRUIT L’IMAGE — sans quoi rien de tout ceci n’est vérifié', () => {
  // Commentaires retirés, comme pour le Dockerfile et le compose. La règle est
  // au § 2.3 du journal, et je l'avais appliquée à deux fichiers sur trois :
  // les commentaires de ce travail-ci CITENT `--retry-connrefused` et
  // `docker logs` pour expliquer pourquoi ils n'y sont plus / y sont. Sans ce
  // retrait, une garde échoue sur sa propre prose — ou pire, passe grâce à
  // elle. En YAML comme en shell, une ligne qui commence par `#` est un
  // commentaire : le même retrait vaut pour les deux.
  const CI = nu(lire('.github/workflows/ci.yml'));

  it('un travail construit l’image à chaque PR', () => {
    expect(CI).toMatch(/docker build/);
  });

  it('…et la ruche y DÉMARRE, et répond', () => {
    // Construire ne suffit pas : `better-sqlite3` est optionnel, donc une image
    // où son installation aurait échoué se construit quand même et ne meurt
    // qu'au premier démarrage. C'est précisément la panne que le choix de
    // `slim` existe pour éviter — la vérifier demande de lancer.
    expect(CI).toMatch(/docker run/);
    expect(CI).toContain('/api/health');
    expect(CI, 'le module natif n’est pas chargé pour de vrai').toMatch(
      /require\('better-sqlite3'\)/,
    );
  });

  it('elle n’attend pas avec un `sleep` deviné — et elle attend la BONNE erreur', () => {
    // Un `sleep 10` est soit trop court un jour de lenteur, soit dix secondes
    // perdues à chaque run. On attend donc ce qu'on attend.
    //
    // Encore faut-il attendre la bonne panne. `--retry-connrefused` ne reprend
    // QUE « connection refused » (7). Or Docker publie le port de l'hôte dès le
    // `run` : `docker-proxy` écoute avant la ruche, la connexion aboutit, puis
    // elle est coupée — `curl: (56) Recv failure: Connection reset by peer`.
    // Mesuré sur un port qui accepte puis coupe :
    //
    //     --retry-connrefused   1 tentative, aucune reprise
    //     --retry-all-errors    4 tentatives (1 + 3 reprises)
    //
    // La boucle d'attente ne bouclait pas, et l'image échouait en 0,2 s.
    expect(CI, 'un `sleep` deviné ne garde rien').not.toMatch(/^\s*sleep \d+\s*$/m);
    expect(CI).toMatch(/--retry-all-errors/);
    expect(CI, '`--retry-connrefused` ne reprend pas une connexion COUPÉE').not.toMatch(
      /--retry-connrefused/,
    );
  });

  it('LE JOURNAL DU CONTENEUR SORT MÊME QUAND LE DÉMARRAGE ÉCHOUE', () => {
    // `docker logs` était la dernière ligne du pas qui attend la ruche. Sous
    // `bash -e`, l'échec de `curl` l'emportait : la seule fois où ce journal
    // servait était la seule fois où il ne s'affichait pas. La première panne
    // réelle du démarrage n'a donc rien diagnostiqué du tout.
    //
    // Un diagnostic placé en aval de ce qu'il diagnostique n'existe pas.
    const pas = CI.split(/^\s{6}- name:/m).find((p) => /docker logs/.test(p));
    expect(pas, 'plus aucun pas ne montre le journal du conteneur').toBeDefined();
    expect(pas, 'sans `if: always()` le journal disparaît quand il devient utile').toMatch(
      /if:\s*always\(\)/,
    );
  });
});
