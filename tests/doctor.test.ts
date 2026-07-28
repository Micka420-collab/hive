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

import { describe, expect, it } from 'vitest';
import {
  codeDeSortie,
  diagnostiquer,
  ESPACE_MINIMUM_OCTETS,
  NODE_MINIMUM,
  pire,
} from '../src/shared/doctor.js';
import type { Diagnostic, Releve } from '../src/shared/doctor.js';

/** Une ruche en parfait état. Chaque test n'en dérange qu'un point. */
const SAINE: Releve = {
  nodeMajeur: 22,
  fichierEnv: { present: true, lisible: true, permissions: 0o600 },
  jeton: { present: true, longueur: 48, trivial: false },
  port: { numero: 7777, libre: true, parNous: null },
  base: { presente: true, integre: true, inscriptible: true },
  dashboardConstruit: true,
  agent: 'claude-code',
  isolement: 'podman',
  wsJoignable: true,
  reglages: { runner: 'off', bindPublic: false, gardiennes: 'strict', corsOuvert: false },
  espace: { octetsLibres: 40 * 1024 * 1024 * 1024, inscriptible: true },
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
    // `ok` doit dire quoi taper. C'est une garde sur la RÈGLE, pas sur onze
    // endroits — le douzième diagnostic qu'on ajoutera y passera aussi.
    const cassee: Releve = {
      nodeMajeur: 18,
      fichierEnv: { present: false, lisible: false, permissions: null },
      jeton: { present: false, longueur: 0, trivial: false },
      port: { numero: 7777, libre: false, parNous: false },
      base: { presente: true, integre: false, inscriptible: true },
      dashboardConstruit: false,
      agent: null,
      isolement: null,
      wsJoignable: false,
      reglages: { runner: 'on', bindPublic: true, gardiennes: 'off', corsOuvert: true },
      espace: { octetsLibres: 0, inscriptible: true },
    };
    const diags = diagnostiquer(cassee);
    expect(diags.length, 'les onze diagnostics de la mission').toBe(11);

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
    const d = diag(avec({ nodeMajeur: NODE_MINIMUM - 1 }), 'node_version');
    expect(d.gravite).toBe('bloquant');

    // LA COMMANDE EXACTE, et pas seulement « elle contient 20 ». La loupe a
    // trouvé ici un `&&` que rien ne défendait : dans
    // `nvm install 20 && nvm use 20`, le remplacer par `||` donne une commande
    // qui n'active la version QUE SI l'installation a échoué. Elle a l'air
    // juste, elle ne répare rien — et c'est précisément ce que ce module
    // existe pour éviter. Une réparation fausse est pire qu'aucune : on la
    // tape, il ne se passe rien, et on cherche ailleurs.
    expect(d.reparation).toBe(`nvm install ${NODE_MINIMUM} && nvm use ${NODE_MINIMUM}`);
  });

  it('AU SEUIL EXACT, ça passe — et c’est la version que fait tourner la CI', () => {
    // Oubli attrapé par la loupe : je testais `NODE_MINIMUM - 1` et une version
    // large, jamais le seuil lui-même. Avec `>` au lieu de `>=`, une ruche sur
    // Node 20 pile — le minimum documenté, et ce que fait tourner notre propre
    // CI — se serait entendu dire d'aller mettre Node à jour.
    //
    // La même borne était testée pour l'espace disque et pas ici. Une
    // inégalité se retourne toujours là où on n'a pas regardé.
    const d = diag(avec({ nodeMajeur: NODE_MINIMUM }), 'node_version');
    expect(d.gravite).toBe('ok');
    expect(d.reparation).toBeNull();
  });

  it('et le diagnostic vient EN PREMIER, parce que c’est ce qu’on répare d’abord', () => {
    // L'ordre est une information : réparer un port sous Node 18 ne sert à rien.
    expect(diagnostiquer(SAINE)[0]?.cle).toBe('node_version');
  });
});

describe('2. LE FICHIER .env', () => {
  it('absent : la commande dit exactement quoi copier', () => {
    const d = diag(
      avec({ fichierEnv: { present: false, lisible: false, permissions: null } }),
      'env_present',
    );
    expect(d.gravite).toBe('bloquant');
    expect(d.reparation).toContain('.env.example');
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

describe('LE VERDICT D’ENSEMBLE, ET LE CODE DE SORTIE', () => {
  it('le pire l’emporte, dans le bon ordre', () => {
    expect(pire(diagnostiquer(SAINE))).toBe('ok');
    expect(pire(diagnostiquer(avec({ dashboardConstruit: false })))).toBe('risque');
    expect(pire(diagnostiquer(avec({ nodeMajeur: 18 })))).toBe('bloquant');
    expect(pire(diagnostiquer(avec({ wsJoignable: null })))).toBe('inconnu');
  });

  it('un BLOQUANT couvre un risque, et un risque couvre un inconnu', () => {
    const tout = avec({ nodeMajeur: 18, dashboardConstruit: false, wsJoignable: null });
    expect(pire(diagnostiquer(tout))).toBe('bloquant');
  });

  it('UN « INCONNU » NE FAIT PAS ÉCHOUER UN SCRIPT — et c’est un choix', () => {
    // Faire sortir en erreur parce qu'on n'a pas su lire des permissions
    // Windows rendrait la commande inutilisable là où elle sert le plus : dans
    // une supervision, sur une machine qu'on ne regarde pas.
    expect(codeDeSortie(diagnostiquer(avec({ wsJoignable: null })))).toBe(0);
    expect(codeDeSortie(diagnostiquer(SAINE))).toBe(0);
    expect(codeDeSortie(diagnostiquer(avec({ dashboardConstruit: false })))).toBe(1);
    expect(codeDeSortie(diagnostiquer(avec({ nodeMajeur: 18 })))).toBe(2);
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
      'env_present',
      'jeton',
      'port',
      'base',
      'dashboard',
      'agent',
      'isolement',
      'websocket',
      'reglages',
      'espace',
    ]);
  });
});
