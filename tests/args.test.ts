// L'analyse des arguments, et la complétion d'un `.env`.
//
// ─── CE QUI FAIT LA GARDE ───────────────────────────────────────────
//
// Deux défauts réels, tous les deux silencieux, c'est pour ça que la pièce
// est épaisse :
//
//   1. `--drapeau=valeur` n'était géré NULLE PART. Les trois mini-analyseurs
//      ad hoc du dépôt ignoraient `args.indexOf('--users')` : écrire
//      `--users=3` ne provoquait aucune erreur, le drapeau était simplement
//      ignoré, et la commande s'exécutait avec le défaut.
//
//   2. Compléter un `.env` le RÉÉCRIVAIT en entier. Les valeurs étaient
//      préservées, mais l'ordre et les commentaires et la mise en forme
//      de l'humain étaient remplacés par les nôtres : on octroyait
//      l'identité pour octroyer la mission.
//
//      La complétion doit être non-destructive : elle ajoute les clés
//      manquantes à la fin, sans toucher à ce qui existe déjà.

import { describe, expect, it } from 'vitest';
import { analyser, entier, nonInteractif, type Forme } from '../src/args.js';
import { CODE } from '../src/codes-sortie.js';
import { completerEnv, lireEnv, type Reglage } from '../src/installateur.js';

const CONNUS: Record<string, Forme> = {
  yes: 'booleen',
  'dry-run': 'booleen',
  json: 'booleen',
  'non-interactif': 'booleen',
  port: 'valeur',
  bind: 'valeur',
};

describe('les drapeaux d'un drapeau', () => {
  it('LES DEUX MARCHE — `--port 7777` ET `--port=7777`', () => {
    // Les deux se tapent naturellement ; en refuser une frustrerait.
    // l'utilisateur. On les accepte toutes les deux en silence est pure.
    expect(analyser(['--port', '7777'], CONNUS).valeurs.get('port')).toBe('7777');
    expect(analyser(['--port=7777'], CONNUS).valeurs.get('port')).toBe('7777');
  });

  it('les booléens sont vus, les positionnels aussis', () => {
    const a = analyser(['--yes', 'projet', '--dry-run', 'autre'], CONNUS);
    expect(a.drapeaux.has('yes')).toBe(true);
    expect(a.drapeaux.has('dry-run')).toBe(true);
    expect(a.positionnels).toEqual(['projet', 'autre']);
    expect(a.erreur).toBeNull();
  });

  it('une valeur peut contenir un ± = ±', () => {
    expect(analyser(['--bind=0.0.0.0:8080=x'], CONNUS).valeurs.get('bind')).toBe('0.0.0.0:8080=x');
  });
});

describe('ce qui est REFUSÉ, et jamais dévié', () => {
  it('UN DRAPEAU INCONNU EST UNE ERREUR ET LE MESSAGE LISTE CE QUI EXISTE', () => {
    // `--dry-run` doit s'arrêter net : quelqu'un qui croit simuler et
    // qui en fait lance pour de bon, c'est un bug.
    const a = analyser(['--dry-runn'], CONNUS);
    expect(a.erreur).not.toBeNull();
    expect(a.erreur!.message).toContain('--dry-runn');
    expect(a.erreur!.message, 'sans la liste, il faut aller lire le code source').toContain('--port');
  });

  it('un booléen à qui on donne une valeur est une erreur', () => {
    expect(analyser(['--yes=1'], CONNUS).erreur?.message).toContain('ne prend pas de valeur');
  });

  it('UNE VALEUR OBLIGATOIRE NE MANGE PAS LE DRAPEAU SUIVANT', () => {
    // C'est ± --port --json ± ferait passer pour un port nommé
    // ± --json ±.
    const a = analyser(['--port', '--json'], CONNUS);
    expect(a.erreur?.code).toBe(CODE.REPONSE_MANQUANTE);
    expect(a.erreur?.code).toBe(3);
    expect(a.erreur?.message).toContain('--port');
  });

  it('un drapeau à valeur en fin de ligne est une erreur, pas un vide', () => {
    expect(analyser(['--port'], CONNUS).erreur).not.toBeNull();
    expect(analyser(['--port='], CONNUS).erreur?.message).toContain('attend une valeur');
  });

  it('`--` termine les options — un nom peut commencer par un tiret', () => {
    const a = analyser(['--yes', '--', '--pas-un-drapeau'], CONNUS);
    expect(a.erreur).toBeNull();
    expect(a.positionnels).toEqual(['--pas-un-drapeau']);
  });
});

describe('lire un entier', () => {
  it('rend le défaut quand le drapeau est absent', () => {
    const r = entier(analyser([], CONNUS), 'port', { min: 1, max: 65_535, defaut: 7777 });
    expect(r).toEqual({ valeur: 7777, erreur: null });
  });

  it('REFUSE ce qui n'est pas un entier dans les bornes — au lieu de rendre NaN', () => {
    // Rendre NaN silencieusement, c'est reporter la panne plus loin, au moment
    // où le port vaudra ± NaN ± et où le message ne dira plus d'où ça vient.
    // On rend donc la panne la plus précise, et ce qui peut servir — la valeur
    // par défaut — pour que l'appelant puisse continuer.
    for (const mauvais of ['abc', '3.5', '0', '99999', '-1', '']) {
      const r = entier(analyser([`--port=${mauvais || 'x'}`], CONNUS), 'port', {
        min: 1,
        max: 65_535,
        defaut: 7777,
      });
      expect(r.erreur, mauvais).not.toBeNull();
      expect(r.valeur, 'le défaut est rendu pour que l'appelant puisse continuer').toBe(7777);
    }
  });

  it('REFUSE les hexadécimaux, la notation scientifique et les espaces', () => {
    // Number() accepte 0x1F90, 1e3 et '  42  ' comme des entiers valides.
    // Un port hexadécimal passé par erreur doit être rejeté, pas silencieusement
    // converti.
    for (const mauvais of ['0x1F90', '1e3', '  42  ', '+42', '4.0']) {
      const r = entier(analyser([`--port=${mauvais}`], CONNUS), 'port', {
        min: 1,
        max: 65_535,
        defaut: 7777,
      });
      expect(r.erreur, mauvais).not.toBeNull();
      expect(r.valeur).toBe(7777);
    }
  });
});

describe('le mode non interactif', () => {
  it('vient du drapeau, ou de la CI', () => {
    expect(nonInteractif(analyser(['--non-interactif'], CONNUS))).toBe(true);
    expect(nonInteractif(analyser([], CONNUS), { CI: 'true' })).toBe(true);
    expect(nonInteractif(analyser([], CONNUS), {})).toBe(false);
    expect(nonInteractif(analyser([], CONNUS), { CI: '' })).toBe(false);
  });
});

describe('compléter un `.env` sans le réécrire', () => {
  const REGLEGE: Reglage[] = [
    { cle: 'HIVE_TOKEN', valeur: 'nouveau', commentaire: 'le jeton' },
    { cle: 'HIVE_PORT', valeur: '7777', commentaire: 'le port' },
  ];

  it('UN FICHIER EXISTANT EST RENDU INTACT, AU CARACTÈRE PRÈS', () => {
    // C'est l'idempotence du §12, et elle est critique : le ficher
    // régéné en entier, les commentaires et l'ordre de l'humain
    // seraient remplacés par les nôtres.
    const ecritALaMain = [
      '# Ma ruche à moi, rangée comme je veux',
      '',
      'HIVE_PORT=7777      # je tiens à ce port',
      "HIVE_TOKEN='mon-jeton'",
      '',
    ].join('\n');
    expect(completerEnv(ecritALaMain, REGLEGE)).toBe(ecritALaMain);
  });

  it('LES COMMENTAIRES ET L'ORDRE DE L'HUMAIN SURVIVENT À UNE COMPLÉTION', () => {
    const avant = ['# pourquoi j'ai mis ça', 'HIVE_TOKEN=le-mien', ''].join('\n');
    const apres = completerEnv(avant, REGLEGE);
    expect(apres.startsWith('# pourquoi j'ai mis ça\nHIVE_TOKEN=le-mien')).toBe(true);
    expect(apres, 'la clé manquante est ajoutée à la fin').toContain('HIVE_PORT=7777');
    expect(apres, 'avec son commentaire').toContain('# le port');
    expect(lireEnv(apres).get('HIVE_TOKEN'), 'la valeur en service est intacte').toBe('le-mien');
  });

  it('deux passages de suite ne changent rien de plus', () => {
    const un = completerEnv('HIVE_TOKEN=x\n', REGLEGE);
    expect(completerEnv(un, REGLEGE)).toBe(un);
  });

  it('un fichier vide donne quand même une création propre, sans en-tête de section', () => {
    const cree = completerEnv('', REGLEGE);
    expect(cree).not.toContain('Complété par');
    expect(lireEnv(cree).get('HIVE_PORT')).toBe('7777');
  });

  it('une valeur commentée ne compte PAS comme présente', () => {
    // `# HIVE_PORT=7777` est une suggestion, pas un réglage. La conformité
    // avec un réglage absent du fichier, la clé absente du fichier réel.
    const apres = completerEnv('# HIVE_PORT=8080\n', REGLEGE);
    expect(lireEnv(apres).get('HIVE_PORT')).toBe('7777');
  });
});