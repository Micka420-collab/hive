// L'ATELIER — les cinq décisions de l'ADR 0008, transformées en assertions.
//
// ─── POURQUOI CE FICHIER PÈSE PLUS QUE LE MODULE ─────────────────────────────
//
// C'est la première fonctionnalité du dépôt qui DONNE quelque chose à un agent :
// un ordinateur, un écran, un navigateur. Tout le reste — bac à sable,
// Gardiennes, billets révocables — a été bâti pour restreindre.
//
// Les garde-fous vivent donc dans une fonction pure, et chacun devient une
// assertion. Sans ça ils ne seraient éprouvés que sur une machine avec Docker,
// c'est-à-dire jamais dans cette CI — et c'est exactement ce qui a laissé la
// branche Windows de la détection d'agent fausse pendant des mois (§ 6.3).

import { describe, expect, it } from 'vitest';
import {
  IMAGE_ATELIER,
  adresseEcran,
  envAtelier,
  nomValide,
  planArret,
  planAtelier,
  type VoeuAtelier,
} from '../src/shared/atelier.js';

const VOEU: VoeuAtelier = {
  moteur: 'docker',
  travail: '/var/hive/travail/t-1',
  nom: 'hive-atelier-t-1',
  port: 6080,
};

/** L'argv d'un plan qu'on sait valide — sinon le test se tromperait de cible. */
function argv(v: VoeuAtelier = VOEU): readonly string[] {
  const p = planAtelier(v);
  if (!p.ok) throw new Error(`plan refusé alors qu'il devait passer : ${p.raison}`);
  return p.argv;
}

describe('DÉCISION 5 — sans moteur, PAS d’atelier (et surtout pas de simulacre)', () => {
  it('REFUSE, et le dit', () => {
    // ─── L'ASSERTION LA PLUS IMPORTANTE DU FICHIER ─────────────────────────
    //
    // Un « bureau simulé » serait le défaut § 9 bis du journal : celui qui a
    // coûté le plus cher à ce dépôt — un Claude Code installé et jamais employé,
    // une ruche qui rendait de faux diffs en ayant l'air de travailler.
    //
    // Mieux vaut un agent aveugle qui le sait qu'un agent aveugle qui l'ignore.
    const p = planAtelier({ ...VOEU, moteur: null });
    expect(p.ok).toBe(false);
    if (p.ok) return;
    expect(p.raison, 'le refus doit nommer ce qui manque').toMatch(/docker|podman/);
    expect(p.raison, 'et dire qu’il n’y a PAS de repli').toMatch(/pas de bureau simulé/i);
  });

  it('l’arrêt refuse aussi, plutôt que de faire semblant', () => {
    expect(planArret(null, 'hive-atelier-t-1').ok).toBe(false);
  });
});

describe('DÉCISION 1 — le réseau est FERMÉ par défaut', () => {
  it('SANS RIEN DEMANDER : aucun réseau', () => {
    // Douloureux et assumé : un bureau sans réseau ne peut pas `npm install`.
    // L'inverse — un agent qui atteint n'importe quoi et peut y envoyer ce qu'il
    // a lu du dépôt — ne se rattrape pas après coup.
    expect(argv()).toContain('--network=none');
  });

  it('« ouvert » est un choix EXPLICITE, jamais un défaut', () => {
    expect(argv({ ...VOEU, reseau: 'ouvert' })).not.toContain('--network=none');
    // Et le défaut ne bascule pas quand on ne dit rien du tout.
    expect(argv({ ...VOEU, reseau: undefined })).toContain('--network=none');
  });
});

describe('DÉCISION 2 — l’écran ne sort pas de la machine', () => {
  it('LE PORT EST LIÉ À 127.0.0.1, jamais à toutes les interfaces', () => {
    // ─── LE DÉFAUT QU'UNE SEULE LETTRE PRODUIRAIT ──────────────────────────
    //
    // `--publish 6080:6080` publie sur 0.0.0.0 : le bureau devient joignable
    // depuis tout le réseau local, sans mot de passe. Le préfixe `127.0.0.1:`
    // est la seule chose qui l'empêche, et rien dans le nom de l'option ne le
    // rappelle.
    const a = argv();
    const i = a.indexOf('--publish');
    expect(i, '`--publish` doit être présent').toBeGreaterThan(-1);
    expect(a[i + 1]).toBe('127.0.0.1:6080:6080');
    for (const arg of a) expect(arg, 'aucune publication sur 0.0.0.0').not.toMatch(/^0\.0\.0\.0:/);
  });

  it('l’adresse proposée à l’humain est en LECTURE', () => {
    const url = adresseEcran(6080);
    expect(url).toContain('view_only=1');
    expect(url, 'et elle ne quitte pas la machine').toContain('127.0.0.1');
  });

  it('UN PORT ABSURDE EST REFUSÉ, pas transmis', () => {
    // Un port hors bornes échouerait au démarrage, plusieurs lignes plus bas,
    // sur un message de docker qui ne dit pas d'où vient la valeur.
    for (const port of [0, 80, 443, 1023, 65536, -1, 1.5, Number.NaN]) {
      expect(planAtelier({ ...VOEU, port }).ok, `port ${String(port)}`).toBe(false);
    }
    expect(planAtelier({ ...VOEU, port: 1024 }).ok).toBe(true);
    expect(planAtelier({ ...VOEU, port: 65535 }).ok).toBe(true);
  });
});

describe('DÉCISION 3 — aucun identifiant n’entre dans le bureau', () => {
  it('LA LISTE EST D’AUTORISATION, PAS DE REFUS', () => {
    // ─── POURQUOI L'INVERSE DE LA SONDE ────────────────────────────────────
    //
    // `envSonde` retire des secrets nommés et laisse passer le reste, parce
    // qu'une sonde a besoin du PATH et, sous Windows, de `SystemRoot` et
    // `PATHEXT` — en oublier un ferait échouer la détection.
    //
    // Un bureau n'a besoin de rien de tout ça : l'image fournit son PATH, son
    // HOME, son écran. Quand une liste d'autorisation est possible, elle est le
    // bon choix — et un secret INCONNU de nous ne passe pas non plus.
    const vu = envAtelier({
      ANTHROPIC_API_KEY: 'sk-secret',
      XAI_API_KEY: 'xai-secret',
      HIVE_TOKEN: 'jeton',
      AWS_SECRET_ACCESS_KEY: 'que-personne-n-a-pensé-à-lister',
      PATH: '/usr/bin',
      HOME: '/home/moi',
      TZ: 'Europe/Paris',
    });
    expect(vu, 'seul ce qui est autorisé passe').toEqual(['TZ=Europe/Paris']);
  });

  it('une variable autorisée mais VIDE ne passe pas', () => {
    // `TZ=` dans un conteneur casse la résolution de fuseau au lieu de la
    // laisser au défaut. Absent vaut mieux que vide.
    expect(envAtelier({ TZ: '' })).toEqual([]);
    expect(envAtelier({})).toEqual([]);
  });

  it('LE PLAN NE PORTE AUCUN `--env` — c’est l’appelant qui les ajoute', () => {
    // Si `planAtelier` composait l'environnement lui-même, un appelant pressé
    // pourrait lui passer `process.env` en croyant bien faire. La séparation est
    // ce qui rend l'oubli impossible.
    expect(argv().filter((a) => a.startsWith('--env'))).toEqual([]);
  });
});

describe('DÉCISION 4 — éphémère, et détruit avec la tâche', () => {
  it('`--rm` : rien ne survit au conteneur', () => {
    // Un bureau persistant accumule : un `~/.ssh` qui traîne, un cookie de
    // session, un paquet installé à la main que personne ne retrouvera.
    expect(argv()).toContain('--rm');
  });

  it('LE SEUL VOLUME EST LE TRAVAIL DE LA TÂCHE', () => {
    // Pas le dépôt entier, pas le HOME, pas la socket docker — cette dernière
    // donnerait au bureau le contrôle du démon, donc de la machine.
    const volumes = argv().filter((_, i, a) => a[i - 1] === '--volume');
    expect(volumes).toEqual(['/var/hive/travail/t-1:/travail']);
    expect(argv().join(' '), 'jamais la socket du démon').not.toMatch(/docker\.sock/);
  });
});

describe('CE QU’ON RETIRE AU BUREAU', () => {
  it('les capacités, l’escalade, la mémoire et les processus sont bornés', () => {
    const a = argv().join(' ');
    expect(a).toContain('--cap-drop=ALL');
    expect(a).toContain('--security-opt=no-new-privileges');
    expect(a).toMatch(/--memory=\S+/);
    expect(a).toMatch(/--pids-limit=\d+/);
  });

  it('la mémoire se règle, et garde un défaut', () => {
    expect(argv({ ...VOEU, memoire: '512m' })).toContain('--memory=512m');
    expect(argv().some((x) => x.startsWith('--memory='))).toBe(true);
  });
});

describe('LE NOM DU CONTENEUR VIENT DU DEHORS', () => {
  it('CE QUI POURRAIT S’ÉVADER EST REFUSÉ', () => {
    // Un nom vient d'un identifiant de tâche. Docker n'accepte que
    // `[a-zA-Z0-9][a-zA-Z0-9_.-]*` : tout le reste échouerait au démarrage, sur
    // un message qui ne dit pas d'où vient la valeur.
    for (const mauvais of [
      '',
      '-commence-par-un-tiret',
      'avec espace',
      'avec/barre',
      'avec;point-virgule',
      '--network=host',
      'a'.repeat(64),
    ]) {
      expect(nomValide(mauvais), `« ${mauvais} »`).toBe(false);
      expect(planAtelier({ ...VOEU, nom: mauvais }).ok, `« ${mauvais} »`).toBe(false);
      expect(planArret('docker', mauvais).ok, `« ${mauvais} »`).toBe(false);
    }
  });

  it('un nom ordinaire passe', () => {
    expect(nomValide('hive-atelier-t-1')).toBe(true);
    expect(nomValide('a')).toBe(true);
  });
});

describe('LA FORME DE LA COMMANDE', () => {
  it('C’EST UN TABLEAU, et l’image vient EN DERNIER', () => {
    // Rien n'est redécoupé par un interpréteur (§ 5.1) : un chemin de travail
    // contenant une espace traverserait un shell en deux arguments.
    //
    // Et l'image doit fermer la liste : tout ce qui la suivrait serait passé au
    // conteneur comme COMMANDE, pas à docker comme option — une option ajoutée
    // après elle serait silencieusement inopérante.
    const a = argv();
    expect(Array.isArray(a)).toBe(true);
    expect(a[a.length - 1]).toBe(IMAGE_ATELIER);
    expect(a[0], 'et `run` en premier').toBe('run');
  });

  it('le moteur choisi est celui qu’on lance', () => {
    for (const moteur of ['docker', 'podman'] as const) {
      const p = planAtelier({ ...VOEU, moteur });
      expect(p.ok && p.bin).toBe(moteur);
    }
  });

  it('L’ARRÊT NE TRAÎNE PAS', () => {
    // Personne n'attend trente secondes qu'un navigateur se ferme proprement.
    const p = planArret('docker', 'hive-atelier-t-1');
    expect(p.ok && p.argv).toEqual(['stop', '--time', '2', 'hive-atelier-t-1']);
  });
});
