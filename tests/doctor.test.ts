// `hive doctor` — un test par diagnostic, comme la mission l'exige.
//
// ─── CE QUE CES TESTS SURVEILLENT VRAIMENT ───────────────────────────────────
//
// Pas « le module rend onze lignes ». Deux propriétés, et elles portent tout :
//
//   1. **Tout échec porte SA réparation.** Un diagnostic qui dit « port
//      occupé » sans dire quoi taper est un thermomètre. La personne retourne
//      chercher dans le README, et le docteur n'aura fait que nommer sa peine.
//
//   2. **Ce qu'on n'a pas pu mesurer ne se lit JAMAIS « tout va bien ».** Les
//      permissions sur Windows, le propriétaire d'un port, la place libre : on
//      ne sait pas toujours. `null` doit produire `inconnu`, jamais `ok`. Un
//      silence rassurant ne se corrige jamais, parce que personne ne va
//      chercher ce qui a l'air d'aller.
//
// La seconde est la raison d'être du module. Les cas `null` sont donc testés
// un par un, et pas seulement les cas de panne.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  codeDeSortie,
  diagnostiquer,
  ESPACE_MINIMUM_OCTETS,
  GLIBC_MINIMUM,
  NODE_MINIMUM,
  pire,
  RUCHE_COMPLETE,
} from '../src/shared/doctor.js';
import type { Diagnostic, Releve } from '../src/shared/doctor.js';
import { LONGUEUR_MIN_SECRET_JWT, secretJwtDepuisEnv } from '../src/orchestrator/auth.js';
import { VALEUR_ETIQUETTE_PORTE, VERSION_EPINGLEE } from '../src/shared/porte-securite.js';

/** Une ruche en parfait état. Chaque test n'en dérange qu'un point. */
const SAINE: Releve = {
  // Au-dessus du plancher, pas dessus : le SEUIL EXACT a son propre test.
  // Ce 22 valait « sain » quand le plancher était 20 ; passé à 24, il est
  // devenu bloquant et trois tests l'ont dit. Un fixture qui cesse de
  // représenter ce qu'il prétend est un piège silencieux — celui-ci n'a pas
  // été silencieux.
  versionNode: '26.10.0',
  glibc: '2.36',
  fichierEnv: { present: true, lisible: true, permissions: 0o600 },
  secretSession: { utilisable: true, longueur: 64, publie: false, simulation: false },
  jeton: { present: true, longueur: 48, trivial: false },
  port: { numero: 7777, libre: true, parNous: null },
  moteur: { manquants: [], raison: null },
  base: { presente: true, integre: true, inscriptible: true },
  dashboardConstruit: true,
  agent: 'claude-code',
  agentsNonConnectes: [],
  isolement: 'podman',
  imageBac: {
    image: 'localhost/hive-agent:local',
    dans: 'podman',
    absenteDe: null,
    construire: null,
  },
  // L'image porte l'étiquette que pose le Dockerfile après avoir vérifié les
  // outils : la porte de sécurité y est vérifiable, sans rien lancer.
  porteSecurite: {
    hote: { betterleaks: null, 'osv-scanner': null },
    image: VALEUR_ETIQUETTE_PORTE,
    osv: { joignable: true, proxy: null },
  },
  wsJoignable: true,
  reglages: { runner: 'off', bindPublic: false, gardiennes: 'strict', corsOuvert: false },
  espace: { octetsLibres: 40 * 1024 * 1024 * 1024, inscriptible: true },
  decouverte: { ruche: false, machine: false, ecouteLocale: true },
};

/** Le relevé sain, avec un point dérangé. */
const avec = (patch: Partial<Releve>): Releve => ({ ...SAINE, ...patch });

/** Le diagnostic d'une clé — et un message utile s'il manque. */
function diag(r: Releve, cle: string): Diagnostic {
  const d = diagnostiquer(r).find((x) => x.cle === cle);
  expect(d, `aucun diagnostic « ${cle} »`).toBeTruthy();
  return d as Diagnostic;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('LES DEUX RÈGLES QUI PORTENT TOUT LE MODULE', () => {
  it('TOUT ÉCHEC PORTE SA RÉPARATION — aucun diagnostic ne se contente de nommer', () => {
    // On balaie une ruche entièrement cassée : chaque verdict qui n'est pas
    // `ok` doit dire quoi taper. C'est une garde sur la RÈGLE, pas sur douze
    // endroits — le treizième diagnostic qu'on ajoutera y passera aussi.
    //
    // Elle a tenu : `moteur` est arrivé après coup et s'y est plié sans qu'une
    // ligne de ce test change, à part le compte.
    const cassee: Releve = {
      versionNode: '18.20.4',
      glibc: '2.31',
      fichierEnv: { present: false, lisible: false, permissions: null },
      jeton: { present: false, longueur: 0, trivial: false },
      secretSession: { utilisable: false, longueur: 0, publie: false, simulation: false },
      port: { numero: 7777, libre: false, parNous: false },
      moteur: { manquants: ['better-sqlite3'], raison: 'Cannot find module' },
      base: { presente: true, integre: false, inscriptible: true },
      dashboardConstruit: false,
      agent: null,
      agentsNonConnectes: [],
      isolement: null,
      imageBac: null,
      // Sans bac, la porte tourne sur l'hôte — où ses outils manquent.
      porteSecurite: {
        hote: { betterleaks: null, 'osv-scanner': null },
        image: null,
        osv: { joignable: null, proxy: null },
      },
      wsJoignable: false,
      reglages: { runner: 'on', bindPublic: true, gardiennes: 'off', corsOuvert: true },
      espace: { octetsLibres: 0, inscriptible: true },
      // La découverte demandée sur une ruche qui n'écoute qu'elle-même.
      decouverte: { ruche: true, machine: false, ecouteLocale: true },
    };
    const diags = diagnostiquer(cassee);
    // ─── DOUZE, PUIS TREIZE, PUIS QUATORZE, PUIS QUINZE ─────────────────────
    //
    // Le treizième est `secret_session`. Il est arrivé parce qu'un nouveau venu
    // pouvait suivre le docteur À LA LETTRE, ne plus voir aucun ✘ réparable,
    // taper `npm run ruche`, et voir la Reine mourir à la seconde sur une garde
    // qu'aucun des douze n'exerçait.
    //
    // Le quatorzième est `decouverte`, placé en DERNIER : demander à la ruche
    // de lister le réseau local alors qu'elle n'écoute qu'elle-même ne
    // l'empêche pas de tourner, mais fait échouer chaque « Rejoindre ».
    //
    // Ce compte est délibérément écrit en dur : ajouter un contrôle DOIT faire
    // rougir ce test, pour qu'on écrive aussi sa place dans l'ordre — l'ordre
    // est une information, pas une présentation.
    //
    // Le quinzième est `porte_securite`, juste après le bac qui dit où ses
    // outils tournent : sans eux, chaque production est « non vérifiée ».
    expect(diags.length, 'les quinze diagnostics de la mission').toBe(15);

    for (const d of diags) {
      expect(d.gravite, `${d.cle} devrait signaler quelque chose`).not.toBe('ok');
      expect(d.reparation, `${d.cle} NE DIT PAS QUOI FAIRE`).toBeTruthy();
      expect((d.reparation ?? '').length, `${d.cle} : réparation trop vague`).toBeGreaterThan(8);
    }
  });

  it('CE QU’ON N’A PAS PU MESURER NE SE LIT JAMAIS « ok »', () => {
    // La règle du fichier. Trois faits indéterminables, trois `inconnu`.
    // Aucun ne doit passer pour vérifié.
    expect(
      diag(avec({ fichierEnv: { present: true, lisible: true, permissions: null } }), 'env_present')
        .gravite,
      'permissions illisibles (Windows)',
    ).toBe('inconnu');

    expect(
      diag(avec({ port: { numero: 7777, libre: false, parNous: null } }), 'port').gravite,
      'port occupé par on ne sait qui',
    ).toBe('inconnu');

    expect(
      diag(avec({ espace: { octetsLibres: null, inscriptible: true } }), 'espace').gravite,
      'place libre non mesurable',
    ).toBe('inconnu');

    expect(
      diag(avec({ base: { presente: true, integre: null, inscriptible: true } }), 'base').gravite,
      'intégrité non vérifiable',
    ).toBe('inconnu');

    expect(
      diag(avec({ wsJoignable: null }), 'websocket').gravite,
      'ruche éteinte : le WS n’a pas pu être essayé',
    ).toBe('inconnu');
  });

  it('…et un « inconnu » dit quand même quoi taper pour lever le doute', () => {
    // Un « je ne sais pas » sans marche à suivre est une impasse polie.
    for (const r of [
      avec({ fichierEnv: { present: true, lisible: true, permissions: null } }),
      avec({ port: { numero: 7777, libre: false, parNous: null } }),
      avec({ espace: { octetsLibres: null, inscriptible: true } }),
      avec({ wsJoignable: null }),
    ]) {
      const inconnus = diagnostiquer(r).filter((d) => d.gravite === 'inconnu');
      expect(inconnus.length).toBeGreaterThan(0);
      for (const d of inconnus) expect(d.reparation, `${d.cle}`).toBeTruthy();
    }
  });

  it('une ruche saine ne dit RIEN d’autre que « ok »', () => {
    // La moitié qu'on oublie : un docteur qui trouve toujours quelque chose
    // apprend à être ignoré.
    const diags = diagnostiquer(SAINE);
    expect(
      diags.every((d) => d.gravite === 'ok'),
      'bruit sur une ruche saine',
    ).toBe(true);
    expect(
      diags.every((d) => d.reparation === null),
      'rien à réparer',
    ).toBe(true);
  });
});

describe('1. LA VERSION DE NODE', () => {
  it('sous le seuil, c’est bloquant — le reste ne sert à rien', () => {
    const d = diag(avec({ versionNode: '23.99.0' }), 'node_version');
    expect(d.gravite).toBe('bloquant');

    // LA COMMANDE EXACTE, et pas seulement « elle contient 20 ». La loupe a
    // trouvé ici un `&&` que rien ne défendait : dans
    // `nvm install 20 && nvm use 20`, le remplacer par `||` donne une commande
    // qui n'active la version QUE SI l'installation a échoué. Elle a l'air
    // juste, elle ne répare rien — et c'est précisément ce que ce module
    // existe pour éviter. Une réparation fausse est pire qu'aucune : on la
    // tape, il ne se passe rien, et on cherche ailleurs.
    //
    // Le MAJEUR, pas le plancher figé : `nvm install 24` tire le dernier 24,
    // `nvm install 24.18.0` figerait la machine sur le plus vieux accepté.
    const majeur = NODE_MINIMUM.split('.')[0] ?? '';
    expect(d.reparation).toBe(`nvm install ${majeur} && nvm use ${majeur}`);
  });

  it('LE MINEUR COMPTE : 24.17 est refusé, parce que son npm ignore `allowScripts`', () => {
    // Node 24.0 à 24.17 embarquent npm 11.3 à 11.13, qui lancent le
    // `node-gyp rebuild` de better-sqlite3 malgré le refus du paquet : sans
    // python3, la dépendance tombe en silence. Un plancher « 24 » tout court
    // les laissait passer.
    const [majeur = '', mineur = ''] = NODE_MINIMUM.split('.');
    const veille = `${majeur}.${String(Number(mineur) - 1)}.9`;
    const d = diag(avec({ versionNode: veille }), 'node_version');
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain(NODE_MINIMUM);
    expect(d.constat).toContain('npm ≥ 11.16');
  });

  it('AU SEUIL EXACT, ça passe — et c’est la version que fait tourner la CI', () => {
    // Oubli attrapé par la loupe : je testais `NODE_MINIMUM - 1` et une version
    // large, jamais le seuil lui-même. Avec `>` au lieu de `>=`, une ruche sur
    // le plancher pile — le minimum documenté, et ce que fait tourner notre propre
    // CI — se serait entendu dire d'aller mettre Node à jour.
    //
    // La même borne était testée pour l'espace disque et pas ici. Une
    // inégalité se retourne toujours là où on n'a pas regardé.
    const d = diag(avec({ versionNode: NODE_MINIMUM }), 'node_version');
    expect(d.gravite).toBe('ok');
    expect(d.reparation).toBeNull();
  });

  it('et le diagnostic vient EN PREMIER, parce que c’est ce qu’on répare d’abord', () => {
    // L'ordre est une information : réparer un port sous Node 18 ne sert à rien.
    expect(diagnostiquer(SAINE)[0]?.cle).toBe('node_version');
  });
});

describe('2. LE FICHIER .env', () => {
  it('ABSENT : le remède mène à un .env UTILISABLE, pas à une copie du modèle', () => {
    // ─── POURQUOI CE TEST A CHANGÉ DE CAMP ─────────────────────────────────
    //
    // Il exigeait `.env.example` — c'est-à-dire le `cp`. Mesuré sur un clone
    // vierge, ce geste plante `HIVE_TOKEN=change-me` et
    // `HIVE_JWT_SECRET=change-me`, les valeurs publiées avec le code. Or
    // l'installeur ne complète que les clés ABSENTES : il répond ensuite
    // « vos valeurs sont intactes » et laisse les deux marque-places.
    //
    // Le premier remède du docteur était donc le geste qui DÉSARMAIT l'outil
    // fait pour réparer, et le nouveau venu restait avec deux modifications à
    // la main dans un fichier de quatre cents lignes.
    const d = diag(
      avec({ fichierEnv: { present: false, lisible: false, permissions: null } }),
      'env_present',
    );
    expect(d.gravite).toBe('bloquant');
    expect(d.reparation).toBe('npm run install:hive');
    expect(
      d.reparation,
      'un `cp` du modèle plante les valeurs publiées et désarme l’installeur',
    ).not.toMatch(/^\s*cp\b/);
  });

  it('LISIBLE PAR TOUTE LA MACHINE : le jeton de ruche fuit', () => {
    // 0644 laisse n'importe quel compte de la machine lire HIVE_TOKEN.
    const d = diag(
      avec({ fichierEnv: { present: true, lisible: true, permissions: 0o644 } }),
      'env_present',
    );
    expect(d.gravite).toBe('risque');
    expect(d.reparation).toContain('chmod 600');
  });

  it('0600 est le bon cas, et ne dit rien', () => {
    expect(diag(SAINE, 'env_present').gravite).toBe('ok');
  });
});

describe('3. LE JETON', () => {
  it('la valeur d’exemple est BLOQUANTE — elle est publique', () => {
    // Le dépôt est public : la valeur livrée avec n'est pas un défaut, c'est
    // une valeur connue du monde entier.
    const d = diag(avec({ jeton: { present: true, longueur: 9, trivial: true } }), 'jeton');
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toMatch(/publique/);
    expect(d.reparation).toContain('randomBytes');
  });

  it('trop court : bloquant, et la réparation est la même commande', () => {
    const d = diag(avec({ jeton: { present: true, longueur: 8, trivial: false } }), 'jeton');
    expect(d.gravite).toBe('bloquant');
    expect(d.reparation).toContain('randomBytes');
  });
});

describe('4. LE PORT — la distinction qui évite de tuer sa propre ruche', () => {
  it('OCCUPÉ PAR NOUS n’est PAS une panne : la ruche tourne déjà', () => {
    // Sans cette distinction, « port occupé » enverrait quelqu'un tuer sa
    // propre ruche, qui fonctionnait très bien.
    const d = diag(avec({ port: { numero: 7777, libre: false, parNous: true } }), 'port');
    expect(d.gravite).toBe('ok');
    expect(d.reparation, 'rien à réparer').toBeNull();
    expect(d.constat).toMatch(/tourne déjà/);
  });

  it('occupé par un AUTRE : bloquant, avec la commande qui dit par qui', () => {
    const d = diag(avec({ port: { numero: 7777, libre: false, parNous: false } }), 'port');
    expect(d.gravite).toBe('bloquant');
    expect(d.reparation).toContain('7777');
  });

  it('la réparation nomme le port réel, pas un port d’exemple', () => {
    const d = diag(avec({ port: { numero: 9999, libre: false, parNous: false } }), 'port');
    expect(d.reparation).toContain('9999');
  });
});

describe('5. LA BASE', () => {
  it('ABSENTE n’est pas une panne : une ruche neuve n’en a pas encore', () => {
    const d = diag(avec({ base: { presente: false, integre: null, inscriptible: true } }), 'base');
    expect(d.gravite).toBe('ok');
  });

  it('corrompue : bloquant, avec la commande de récupération', () => {
    const d = diag(avec({ base: { presente: true, integre: false, inscriptible: true } }), 'base');
    expect(d.gravite).toBe('bloquant');
    expect(d.reparation).toContain('.recover');
  });

  it('non inscriptible : bloquant', () => {
    const d = diag(avec({ base: { presente: true, integre: true, inscriptible: false } }), 'base');
    expect(d.gravite).toBe('bloquant');
  });
});

describe('6. LE TABLEAU DE BORD', () => {
  it('non construit : un RISQUE, pas un blocage — la ruche tourne sans écran', () => {
    const d = diag(avec({ dashboardConstruit: false }), 'dashboard');
    expect(d.gravite, 'la ruche fonctionne quand même').toBe('risque');
    expect(d.reparation).toContain('build:dashboard');
  });
});

describe('7. L’AGENT DE CODAGE', () => {
  it('aucun agent : ce nœud ne produira rien, et on le dit', () => {
    const d = diag(avec({ agent: null }), 'agent');
    expect(d.gravite).toBe('risque');
    expect(d.constat).toMatch(/ne pourra rien produire/);
  });
});

describe('8. LE BAC À SABLE', () => {
  it('ni docker ni podman : les agents tourneront à nu', () => {
    const d = diag(avec({ isolement: null }), 'isolement');
    expect(d.gravite).toBe('risque');
    expect(d.reparation).toMatch(/podman/);
  });

  // Machine neuve : `docker info` répond, l'image par défaut n'est construite
  // nulle part. Le docteur disait « ✔ disponible », puis le nœud écartait
  // docker et se repliait en processus.
  const IMAGE = 'localhost/hive-agent:local';
  const sansImage = {
    image: IMAGE,
    dans: null,
    absenteDe: 'docker',
    construire: 'npm run bac:image -- --moteur docker',
  };

  it('un moteur qui répond SANS l’image par défaut n’est pas un bac : risque, et la commande', () => {
    const d = diag(avec({ isolement: 'docker', imageBac: sansImage }), 'isolement');
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain(IMAGE);
    expect(d.reparation).toContain('npm run bac:image -- --moteur docker');
  });

  it('le moteur qui A l’image est celui qu’on annonce', () => {
    const d = diag(
      avec({ isolement: 'podman', imageBac: { ...sansImage, dans: 'docker', construire: null } }),
      'isolement',
    );
    expect(d).toMatchObject({ gravite: 'ok', reparation: null });
    expect(d.constat).toBe(`bac à sable disponible : docker (image ${IMAGE})`);
  });

  it('une image NOMMÉE absente sera téléchargée par le nœud : pas de risque inventé', () => {
    const nommee = {
      image: 'ghcr.io/x/agent:1',
      dans: null,
      absenteDe: 'podman',
      construire: null,
    };
    const d = diag(avec({ isolement: 'podman', imageBac: nommee }), 'isolement');
    expect(d.gravite).toBe('ok');
    expect(d.constat).toMatch(/téléchargée au démarrage/);
  });

  it('aucun moteur n’a su dire si l’image est là : inconnu, jamais « ok »', () => {
    const muet = { image: IMAGE, dans: null, absenteDe: null, construire: null };
    const d = diag(avec({ isolement: 'docker', imageBac: muet }), 'isolement');
    expect(d.gravite).toBe('inconnu');
    expect(d.reparation).toContain(`docker image inspect ${IMAGE}`);
  });
});

describe('9. LE WEBSOCKET — le point de panne qui ne se voit pas', () => {
  it('HTTP répond mais le WS est refusé : BLOQUANT, et on dit pourquoi l’écran fige', () => {
    // C'est le cas qui fait chercher du côté du code pendant une heure :
    // l'API répond, l'écran s'affiche, et rien ne bouge jamais.
    const d = diag(avec({ wsJoignable: false }), 'websocket');
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toMatch(/figé/);
    expect(d.reparation).toMatch(/Upgrade/);
  });
});

describe('10. LES RÉGLAGES DANGEREUX', () => {
  it('les quatre sont signalés, et NOMMÉS', () => {
    const d = diag(
      avec({
        reglages: { runner: 'on', bindPublic: true, gardiennes: 'off', corsOuvert: true },
      }),
      'reglages',
    );
    expect(d.gravite).toBe('risque');
    for (const attendu of ['HIVE_RUNNER', 'réseau', 'HIVE_GARDIENNES', 'CORS']) {
      expect(d.constat, `« ${attendu} » doit être nommé`).toContain(attendu);
    }
  });

  it('un seul allumé se signale seul — on ne noie pas le réglage qui compte', () => {
    const d = diag(
      avec({
        reglages: { runner: 'off', bindPublic: false, gardiennes: 'off', corsOuvert: false },
      }),
      'reglages',
    );
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('HIVE_GARDIENNES');
    expect(d.constat, 'et rien d’autre').not.toContain('HIVE_RUNNER');
  });

  it('aucun allumé : silence', () => {
    expect(diag(SAINE, 'reglages').gravite).toBe('ok');
  });
});

describe('11. L’ESPACE DE TRAVAIL', () => {
  it('sous le seuil : bloquant — un clone de dépôt ne tiendra pas', () => {
    const d = diag(
      avec({ espace: { octetsLibres: ESPACE_MINIMUM_OCTETS - 1, inscriptible: true } }),
      'espace',
    );
    expect(d.gravite).toBe('bloquant');
  });

  it('juste au seuil : ça passe', () => {
    // La borne est INCLUSIVE. Un test à la frontière, parce que c'est là que
    // les inégalités se retournent sans qu'on s'en aperçoive.
    const d = diag(
      avec({ espace: { octetsLibres: ESPACE_MINIMUM_OCTETS, inscriptible: true } }),
      'espace',
    );
    expect(d.gravite).toBe('ok');
  });

  it('non inscriptible : bloquant, quelle que soit la place', () => {
    const d = diag(
      avec({ espace: { octetsLibres: 999 * 1024 * 1024 * 1024, inscriptible: false } }),
      'espace',
    );
    expect(d.gravite).toBe('bloquant');
  });
});

describe('12. LE MOTEUR — la panne que le docteur savait possible et taisait', () => {
  // ─── CE QUE CE BLOC RATTRAPE ───────────────────────────────────────────────
  //
  // `better-sqlite3` 12 ne publiait AUCUN binaire prébuilt : chaque
  // installation le compilait. Sur une machine Windows neuve — pas d'outillage
  // C++ — la compilation échouait, npm sortait en 0 parce que le paquet est
  // OPTIONNEL, et `hive start` mourait sur `ERR_MODULE_NOT_FOUND`. La 13 ne se
  // compile plus ; le module peut encore manquer (`--omit=optional`, npm sous
  // 11.16, glibc trop vieille, plateforme sans binaire).
  //
  // Le docteur connaissait ce cas : `baseIntegre()` importe paresseusement, et
  // son commentaire dit « c'est même un cas de panne fréquent ». Il était donc
  // bâti pour SURVIVRE à cette panne — sans jamais la nommer.

  const sansSqlite = avec({
    moteur: { manquants: ['better-sqlite3'], raison: "Cannot find package 'better-sqlite3'" },
  });

  it('tout se charge : rien à signaler', () => {
    expect(diag(SAINE, 'moteur').gravite).toBe('ok');
    expect(diag(SAINE, 'moteur').reparation).toBeNull();
  });

  it('LE MODULE NATIF MANQUANT EST BLOQUANT, ET LA RAISON EST CITÉE', () => {
    const d = diag(sansSqlite, 'moteur');
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain('better-sqlite3');
    // La raison brute compte : « introuvable » sans le message d'origine
    // renvoie la personne deviner. C'est la première ligne, pas les cinquante.
    expect(d.constat).toContain("Cannot find package 'better-sqlite3'");
    expect(d.reparation).toContain('npm install --include=optional');
  });

  it('LE REMÈDE NOMME LES VRAIES CAUSES — plus d’outillage C++, plus de `rebuild`', () => {
    // Avec la 13, le script est refusé (`allowScripts`) et le binaire vient du
    // paquet : installer Visual Studio ou python ne répare rien, et
    // `npm rebuild better-sqlite3` ne lance aucun script. Mesuré : il répond
    // « rebuilt dependencies successfully » et la panne reste entière.
    const r = diag(sansSqlite, 'moteur').reparation ?? '';
    for (const faux of ['Visual Studio', 'build-essential', 'python3', 'rebuild']) {
      expect(r, `le remède conseille encore « ${faux} »`).not.toContain(faux);
    }
    expect(r, 'npm sous 11.16 : mettre Node à jour').toContain(NODE_MINIMUM);
    expect(r, 'plateforme sans binaire : l’image Docker').toContain('Docker');
  });

  it('UNE GLIBC SOUS LE PLANCHER EST NOMMÉE, avec le geste qui répare', () => {
    // Le binaire Linux de la 13 exige GLIBC_2.34 : sur Ubuntu 20.04 ou
    // Debian 11 (2.31) il ne se charge pas, et aucune compilation ne vient en
    // secours. « npm install » n'y changerait rien — ce serait le conseil
    // qu'on tape pour rien.
    const vieille = avec({
      glibc: '2.31',
      moteur: {
        manquants: ['better-sqlite3'],
        raison: "/lib/x86_64-linux-gnu/libc.so.6: version `GLIBC_2.34' not found",
      },
    });
    const r = diag(vieille, 'moteur').reparation ?? '';
    expect(r).toContain('2.31');
    expect(r).toContain(GLIBC_MINIMUM);
    expect(r).toContain('Ubuntu 22.04');
    expect(r).toContain('Docker');
    expect(r).not.toContain('npm install');
    // Au plancher pile, la glibc n'est pas la cause : on retombe sur le remède
    // général.
    const auPlancher = avec({ glibc: GLIBC_MINIMUM, moteur: vieille.moteur });
    expect(diag(auPlancher, 'moteur').reparation).toContain('npm install --include=optional');
  });

  it('les QUATRE d’un coup se lisent « installation de nœud », pas « compilation ratée »', () => {
    // Distinction utile : `--omit=optional` est un choix documenté par le
    // README, et son geste de réparation n'est pas celui d'un `node-gyp` qui
    // a échoué. Confondre les deux enverrait installer Visual Studio à
    // quelqu'un qui n'en a aucun besoin.
    const nœud = avec({
      moteur: { manquants: [...RUCHE_COMPLETE], raison: 'Cannot find package' },
    });
    const d = diag(nœud, 'moteur');
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain('nœud');
    expect(d.reparation).toContain('--include=optional');
    expect(d.reparation, 'ne parle PAS d’outillage C++ ici').not.toContain('Visual Studio');
  });

  it('SANS LE MOTEUR, LA BASE NE SE LIT PLUS « ok » — le mensonge le plus coûteux', () => {
    // C'était le comportement AVANT : machine Windows neuve, pas de base
    // (puisque la ruche n'a jamais démarré), donc `presente: false`, donc
    //
    //     ✔ base   aucune base — elle sera créée au premier démarrage
    //
    // en VERT. Or elle ne sera jamais créée : il n'y aura pas de premier
    // démarrage. Le docteur rassurait exactement la personne qu'il devait
    // alerter, et c'est le pire des deux mensonges possibles — celui qui ne
    // se corrige jamais, parce que personne ne va vérifier ce qui a l'air
    // d'aller.
    const neuve = avec({
      moteur: { manquants: ['better-sqlite3'], raison: 'Cannot find package' },
      base: { presente: false, integre: null, inscriptible: true },
    });
    const d = diag(neuve, 'base');
    expect(d.gravite, 'un « ok » ici est un mensonge').not.toBe('ok');
    expect(d.gravite).toBe('inconnu');
    expect(d.constat).not.toContain('sera créée');
    expect(d.reparation).toContain('moteur');
  });

  it('sans le moteur, une base PRÉSENTE n’accuse plus un verrou imaginaire', () => {
    // L'autre branche mentait plus discrètement : `integre` vaut `null` faute
    // de moteur, et le verdict lisait « fichier verrouillé ? » en proposant
    // d'arrêter une ruche qui ne tourne pas.
    const d = diag(
      avec({
        moteur: { manquants: ['better-sqlite3'], raison: 'Cannot find package' },
        base: { presente: true, integre: null, inscriptible: true },
      }),
      'base',
    );
    expect(d.constat).not.toContain('verrouillé');
    expect(d.reparation).not.toContain('arrêtez la ruche');
  });

  it('le moteur présent laisse la base parler normalement', () => {
    // La garde ne doit pas AVALER le diagnostic qu'elle protège : sans ce
    // test, remplacer le corps de `base()` par le seul cas « moteur absent »
    // passerait inaperçu.
    expect(
      diag(avec({ base: { presente: false, integre: null, inscriptible: true } }), 'base').constat,
    ).toContain('sera créée');
    expect(
      diag(avec({ base: { presente: true, integre: false, inscriptible: true } }), 'base').gravite,
    ).toBe('bloquant');
  });

  it('un AUTRE paquet manquant que SQLite ne muselle pas la base', () => {
    // La garde vise `better-sqlite3` nommément, pas « quelque chose manque » :
    // sans SQLite on ne peut rien dire de la base, mais sans `@fastify/static`
    // la base reste parfaitement lisible.
    const d = diag(
      avec({ moteur: { manquants: ['@fastify/static'], raison: 'Cannot find package' } }),
      'base',
    );
    expect(d.gravite).toBe('ok');
  });
});

describe('porte_securite — les outils de la porte là où le nœud les lancera', () => {
  const hote = (betterleaks: string | null, osv: string | null) => ({
    hote: { betterleaks, 'osv-scanner': osv },
    image: null,
    osv: { joignable: osv === null ? null : true, proxy: null },
  });
  const bubblewrap: Releve['imageBac'] = {
    image: 'localhost/hive-agent:local',
    dans: 'bubblewrap',
    absenteDe: null,
    construire: null,
  };

  it('DANS L’IMAGE : l’étiquette posée après l’installation vérifiée suffit — sans rien lancer', () => {
    const d = diag(SAINE, 'porte_securite');
    expect(d.gravite).toBe('ok');
    expect(d.constat).toContain(`betterleaks ${VERSION_EPINGLEE.betterleaks}`);
    expect(d.constat).toContain(`osv-scanner ${VERSION_EPINGLEE['osv-scanner']}`);
  });

  it('UNE IMAGE CONSTRUITE AVANT LA PORTE est un risque, et la commande la reconstruit', () => {
    const d = diag(
      avec({
        porteSecurite: {
          hote: { betterleaks: '1.9.0', 'osv-scanner': '2.6.0' },
          image: '',
          osv: { joignable: true, proxy: null },
        },
      }),
      'porte_securite',
    );
    // Les outils de l'HÔTE n'y changent rien : le nœud lance ceux de l'image.
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('non vérifiée');
    expect(d.reparation).toContain('npm run bac:image');
  });

  it('D’AUTRES VERSIONS DANS L’IMAGE sont nommées, avec celles qu’épingle le Dockerfile', () => {
    const d = diag(
      avec({
        porteSecurite: { ...hote(null, null), image: 'betterleaks=1.8.1 osv-scanner=2.6.0' },
      }),
      'porte_securite',
    );
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('betterleaks=1.8.1');
    expect(d.reparation).toContain(VALEUR_ETIQUETTE_PORTE);
  });

  it('UNE ÉTIQUETTE QUE LE MOTEUR N’A PAS DITE est « inconnu », jamais « ok »', () => {
    const d = diag(avec({ porteSecurite: hote(null, null) }), 'porte_securite');
    expect(d.gravite).toBe('inconnu');
    expect(d.reparation).toContain('podman image inspect');
  });

  it('SOUS BUBBLEWRAP, ce sont ceux du PATH de l’hôte : présents et épinglés, ok', () => {
    const d = diag(
      avec({
        imageBac: bubblewrap,
        isolement: 'bubblewrap',
        porteSecurite: hote('1.9.0', '2.6.0'),
      }),
      'porte_securite',
    );
    expect(d.gravite).toBe('ok');
    expect(d.constat).toContain('bubblewrap');
  });

  it('ABSENTS DE L’HÔTE : un risque, et chaque release avec son fichier d’empreintes', () => {
    const d = diag(
      avec({ imageBac: bubblewrap, isolement: 'bubblewrap', porteSecurite: hote(null, null) }),
      'porte_securite',
    );
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('betterleaks absent');
    expect(d.constat).toContain('jamais verte');
    expect(d.reparation).toContain(
      'https://github.com/betterleaks/betterleaks/releases/tag/v1.9.0 (vérifiez le SHA-256 dans checksums.txt)',
    );
    expect(d.reparation).toContain(
      'https://github.com/google/osv-scanner/releases/tag/v2.6.0 (vérifiez le SHA-256 dans osv-scanner_SHA256SUMS)',
    );
  });

  it('UNE AUTRE VERSION SUR L’HÔTE n’est pas celle dont les rapports ont été éprouvés', () => {
    const d = diag(
      avec({
        imageBac: bubblewrap,
        isolement: 'bubblewrap',
        porteSecurite: hote('1.9.0', '2.5.1'),
      }),
      'porte_securite',
    );
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('osv-scanner 2.5.1 (épinglé : 2.6.0)');
    // La porte la LANCE : le docteur ne dit pas « absente » d'un outil présent.
    expect(d.constat).toContain('la porte les lance');
    expect(d.constat).not.toContain('chaque production sera « non vérifiée »');
    expect(d.reparation).not.toContain('betterleaks');
  });

  it('OUTILS PRÊTS, api.osv.dev INJOIGNABLE : un risque qui nomme l’hôte, le proxy, et quoi faire', () => {
    const direct = diag(
      avec({
        porteSecurite: { ...SAINE.porteSecurite, osv: { joignable: false, proxy: null } },
      }),
      'porte_securite',
    );
    expect(direct.gravite).toBe('risque');
    expect(direct.constat).toContain('api.osv.dev injoignable');
    expect(direct.constat).toContain('« non vérifié »');
    expect(direct.reparation).toContain('HTTPS_PROXY');
    const parProxy = diag(
      avec({
        imageBac: bubblewrap,
        isolement: 'bubblewrap',
        porteSecurite: {
          hote: { betterleaks: '1.9.0', 'osv-scanner': '2.6.0' },
          image: null,
          osv: { joignable: false, proxy: 'proxy.entreprise.test:3128' },
        },
      }),
      'porte_securite',
    );
    expect(parProxy.gravite).toBe('risque');
    expect(parProxy.constat).toContain('par le proxy proxy.entreprise.test:3128');
    expect(parProxy.reparation).toContain('à travers proxy.entreprise.test:3128');
  });

  it('L’IMAGE PAR DÉFAUT CONSTRUITE NULLE PART : le nœud se replie, la porte tourne sur l’hôte', () => {
    const d = diag(
      avec({
        imageBac: {
          image: 'localhost/hive-agent:local',
          dans: null,
          absenteDe: 'podman',
          construire: 'npm run bac:image',
        },
        porteSecurite: {
          hote: { betterleaks: null, 'osv-scanner': null },
          image: null,
          osv: { joignable: null, proxy: null },
        },
      }),
      'porte_securite',
    );
    expect(d.gravite).toBe('risque');
    expect(d.constat).toContain('sans bac');
  });
});

describe('LE VERDICT D’ENSEMBLE, ET LE CODE DE SORTIE', () => {
  it('le pire l’emporte, dans le bon ordre', () => {
    expect(pire(diagnostiquer(SAINE))).toBe('ok');
    expect(pire(diagnostiquer(avec({ dashboardConstruit: false })))).toBe('risque');
    expect(pire(diagnostiquer(avec({ versionNode: '18.20.4' })))).toBe('bloquant');
    expect(pire(diagnostiquer(avec({ wsJoignable: null })))).toBe('inconnu');
  });

  it('un BLOQUANT couvre un risque, et un risque couvre un inconnu', () => {
    const tout = avec({ versionNode: '18.20.4', dashboardConstruit: false, wsJoignable: null });
    expect(pire(diagnostiquer(tout))).toBe('bloquant');
  });

  it('UN « INCONNU » NE FAIT PAS ÉCHOUER UN SCRIPT — et c’est un choix', () => {
    // Faire sortir en erreur parce qu'on n'a pas su lire des permissions
    // Windows rendrait la commande inutilisable là où elle sert le plus : dans
    // une supervision, sur une machine qu'on ne regarde pas.
    expect(codeDeSortie(diagnostiquer(avec({ wsJoignable: null })))).toBe(0);
    expect(codeDeSortie(diagnostiquer(SAINE))).toBe(0);
    expect(codeDeSortie(diagnostiquer(avec({ dashboardConstruit: false })))).toBe(1);
    expect(codeDeSortie(diagnostiquer(avec({ versionNode: '18.20.4' })))).toBe(2);
  });
});

describe('CE QUE LE MODULE NE FAIT PAS', () => {
  it('il est PUR : deux appels sur le même relevé rendent la même chose', () => {
    // Pas d'horloge, pas d'aléa, pas d'I/O — famille de balance.ts et
    // gardiennes.ts. C'est ce qui rend les cas « je ne sais pas » testables :
    // aucun test ne pourrait fabriquer un disque non interrogeable si le
    // module allait le lire lui-même.
    expect(diagnostiquer(SAINE)).toEqual(diagnostiquer(SAINE));
  });

  it('les clés sont STABLES — c’est ce qu’une supervision surveille, pas le texte', () => {
    expect(diagnostiquer(SAINE).map((d) => d.cle)).toEqual([
      'node_version',
      // `moteur` est DEUXIÈME, et cet ordre est une information : sans lui la
      // ruche ne démarre pas, donc régler un CORS trop ouvert plus bas dans la
      // liste serait du temps perdu.
      'moteur',
      'env_present',
      'jeton',
      // Juste après le jeton : les deux secrets se posent dans le même fichier
      // et dans le même geste. Réparer l'un sans l'autre ne fait pas démarrer
      // la ruche.
      'secret_session',
      'port',
      'base',
      'dashboard',
      'agent',
      'isolement',
      // Juste après le bac : c'est lui qui dit où tournent les outils de la porte.
      'porte_securite',
      'websocket',
      'reglages',
      'espace',
      // En dernier : la découverte n'empêche jamais une ruche de tourner.
      'decouverte',
    ]);
  });
});

describe('LA LISTE DE LA RUCHE COMPLÈTE N’EXISTE QU’UNE FOIS', () => {
  it('le script de CI et le docteur sondent EXACTEMENT les mêmes paquets', () => {
    // `RUCHE_COMPLETE` porte son propre avertissement : « deux listes séparées
    // finiraient par diverger, et le jour où elles divergent, le docteur
    // cherche un paquet que personne n'installe ».
    //
    // Or `scripts/deps-optionnelles.mjs` en tient une deuxième — il tourne
    // dans la CI, avant que quoi que ce soit ne soit construit, et ne peut pas
    // importer le module TypeScript. L'avertissement était donc écrit et rien
    // ne l'appliquait : le défaut que ce dépôt collectionne, dans le
    // commentaire qui le dénonce.
    //
    // Ce test est ce qui l'applique. Ajouter un paquet d'un seul côté le rougit.
    const script = readFileSync('scripts/deps-optionnelles.mjs', 'utf8');
    const bloc = /const OPTIONNELLES = \[([^\]]*)\]/.exec(script);
    expect(bloc, 'le tableau OPTIONNELLES a été renommé ou reformaté').toBeTruthy();

    const duScript = [...(bloc?.[1] ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]);
    expect(duScript, 'la liste du script de CI').toEqual([...RUCHE_COMPLETE]);
  });
});

describe('LE TREIZIÈME CONTRÔLE — celui qui manquait au nouveau venu', () => {
  // ─── LE PARCOURS EXACT QUI ÉCHOUAIT ────────────────────────────────────────
  //
  //   1. `cp .env.example .env`            ← conseillé par le docteur
  //   2. la commande qui engendre HIVE_TOKEN ← conseillée par le docteur
  //   3. `hive doctor`                     → plus AUCUN ✘ réparable
  //   4. `npm run ruche`                   → la Reine meurt à la seconde
  //
  // Un docteur qui déclare la ruche saine à l'instant où elle ne peut pas
  // démarrer est pire qu'un docteur absent : il fait chercher ailleurs.

  it('SECRET ABSENT : bloquant, et la commande est donnée', () => {
    const d = diag(
      avec({ secretSession: { utilisable: false, longueur: 0, publie: false, simulation: false } }),
      'secret_session',
    );
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain('absent');
    expect(d.reparation, 'un échec sans réparation ne sert à rien').toContain('randomBytes');
    expect(d.reparation).toContain('HIVE_JWT_SECRET');
  });

  it('LE SECRET PUBLIÉ EST TRAITÉ À PART — il est pire qu’absent', () => {
    // Absent, la ruche refuse de démarrer et personne n'est en danger. Publié,
    // elle démarrerait très bien avec une clé que le dépôt entier connaît : se
    // forger la session de l'administrateur devient un exercice de cinq lignes.
    const d = diag(
      avec({ secretSession: { utilisable: false, longueur: 21, publie: true, simulation: false } }),
      'secret_session',
    );
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain('public');
  });

  it('trop court : le constat DIT le minimum, il ne dit pas « invalide »', () => {
    const d = diag(
      avec({
        secretSession: { utilisable: false, longueur: 12, publie: false, simulation: false },
      }),
      'secret_session',
    );
    expect(d.gravite).toBe('bloquant');
    expect(d.constat).toContain('12');
    expect(d.constat).toContain(String(LONGUEUR_MIN_SECRET_JWT));
  });

  it('EN SIMULATION, IL NE SE PLAINT PAS', () => {
    // `npm run demo` doit marcher sans configuration : la Reine tire son secret
    // au démarrage. Un docteur qui se plaint de ce qui va bien finit par n'être
    // plus lu — et c'est ainsi qu'on rate le vrai ✘ à côté.
    const d = diag(
      avec({ secretSession: { utilisable: false, longueur: 0, publie: false, simulation: true } }),
      'secret_session',
    );
    expect(d.gravite).toBe('ok');
  });

  it('LA RÈGLE EST CELLE DU SERVEUR, pas une règle approchante', () => {
    // Le seuil vient de `auth.ts`, pas d'un nombre recopié ici : deux règles
    // qui se ressemblent divergent le jour où l'une bouge, et le docteur
    // donnerait alors un avis sur un autre programme que celui qui va tourner.
    const juste = 'x'.repeat(LONGUEUR_MIN_SECRET_JWT);
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: juste })).not.toBe('');
    expect(secretJwtDepuisEnv({ HIVE_JWT_SECRET: 'x'.repeat(LONGUEUR_MIN_SECRET_JWT - 1) })).toBe(
      '',
    );
  });
});

describe('LE QUATORZIÈME — la découverte du réseau local', () => {
  // Deux consentements (`HIVE_DECOUVERTE` pour la ruche, `HIVE_DECOUVRABLE`
  // pour la machine), tous deux éteints par défaut. Le docteur doit dire le
  // chemin pour les allumer SANS faire du défaut un défaut — et crier le seul
  // cas voué à l'échec : une ruche qui liste le réseau mais n'écoute qu'elle.

  it('ÉTEINTE (le défaut) : ok, sans réparation — mais le constat nomme les deux réglages', () => {
    const d = diag(SAINE, 'decouverte');
    expect(d.gravite).toBe('ok');
    expect(d.reparation, 'une ruche saine ne porte aucune réparation').toBeNull();
    expect(d.constat).toContain('HIVE_DECOUVERTE=1');
    expect(d.constat).toContain('--decouvrable');
  });

  it('DEMANDÉE sur une écoute locale : ⚠, et la réparation ouvre l’écoute', () => {
    const d = diag(
      avec({ decouverte: { ruche: true, machine: false, ecouteLocale: true } }),
      'decouverte',
    );
    expect(d.gravite).toBe('risque');
    expect(d.reparation).toContain('HIVE_HOST=0.0.0.0');
  });

  it('DEMANDÉE sur une écoute ouverte : ok, et elle le dit', () => {
    const d = diag(
      avec({ decouverte: { ruche: true, machine: false, ecouteLocale: false } }),
      'decouverte',
    );
    expect(d).toMatchObject({ gravite: 'ok', reparation: null });
    expect(d.constat).toContain('HIVE_DECOUVERTE=1');
  });

  it('LA MACHINE QUI SE SIGNALE dit ce qu’elle diffuse — et rien que ça', () => {
    // Une machine qui se signale ne doit pas passer pour muette : l'opérateur
    // lit ICI ce que son réseau apprend d'elle.
    const d = diag(
      avec({ decouverte: { ruche: false, machine: true, ecouteLocale: true } }),
      'decouverte',
    );
    expect(d.gravite, 'se signaler n’exige pas d’écoute ouverte').toBe('ok');
    expect(d.constat).toContain('HIVE_DECOUVRABLE=1');
    expect(d.constat).toMatch(/nom, système, agents connectés, places, état/);
  });
});
