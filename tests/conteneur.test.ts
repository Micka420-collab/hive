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

const RACINE = fileURLToPath(new URL('..', import.meta.url));
const lire = (f: string): string => readFileSync(path.join(RACINE, f), 'utf8');

const DOCKERFILE = lire('Dockerfile');
const IGNORE = lire('.dockerignore');
const COMPOSE = lire('docker-compose.yml');

/** Sans les commentaires — sinon la prose ferait passer les gardes. */
const nu = (s: string): string => s.replace(/^\s*#.*$/gm, '');
const DOCKERFILE_NU = nu(DOCKERFILE);
const COMPOSE_NU = nu(COMPOSE);

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
    const serveur = lire('src/orchestrator/server.ts');
    const defaut = /HIVE_PORT\s*\?\?\s*'(\d+)'/.exec(serveur)?.[1];
    expect(defaut, 'le défaut de HIVE_PORT est introuvable dans le serveur').toBeTruthy();
    expect(DOCKERFILE_NU, `EXPOSE devrait valoir ${defaut}`).toMatch(
      new RegExp(`^EXPOSE\\s+${defaut}\\s*$`, 'm'),
    );
    expect(DOCKERFILE_NU).toMatch(new RegExp(`ENV HIVE_PORT=${defaut}`));
  });
});

describe('LA CI CONSTRUIT L’IMAGE — sans quoi rien de tout ceci n’est vérifié', () => {
  const CI = lire('.github/workflows/ci.yml');

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

  it('elle n’attend pas avec un `sleep` deviné', () => {
    // `--retry-connrefused` attend CE QU'ON ATTEND. Un `sleep 10` est soit trop
    // court un jour de lenteur, soit dix secondes perdues à chaque run.
    expect(CI).toMatch(/--retry-connrefused/);
  });
});
