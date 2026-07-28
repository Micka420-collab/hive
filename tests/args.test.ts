// L'analyse des arguments, et la complétion d'un `.env`.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// Deux défauts réels, tous les deux silencieux — c'est-à-dire de la pire
// espèce, celle qui fait autre chose que ce qu'on a demandé sans le dire :
//
//   1. `--drapeau=valeur` n'était géré NULLE PART. Les trois mini-analyseurs
//      ad hoc du dépôt cherchaient `args.indexOf('--uses')` : écrire
//      `--uses=3` ne provoquait aucune erreur, le drapeau était simplement
//      ignoré, et la commande tournait avec le défaut.
//
//   2. Compléter un `.env` le RÉGÉNÉRAIT en entier. Les valeurs étaient bien
//      préservées, mais l'ordre, les commentaires et la mise en forme de
//      l'humain étaient remplacés par les nôtres — donc l'idempotence octet
//      pour octet exigée au §12 de la mission était fausse.

import { describe, expect, it } from 'vitest';
import { analyser, entier, nonInteractif, type Forme } from '../src/args.js';
import { CODE } from '../src/codes-sortie.js';
import { completerEnv, lireEnv, type Reglage } from '../src/installer.js';

const CONNUS: Record<string, Forme> = {
  yes: 'booleen',
  'dry-run': 'booleen',
  json: 'booleen',
  'non-interactive': 'booleen',
  port: 'valeur',
  bind: 'valeur',
};

describe('les deux écritures d’un drapeau', () => {
  it('LES DEUX MARCHENT — `--port 7777` ET `--port=7777`', () => {
    // Les deux se tapent naturellement ; en refuser une n'apprend rien à
    // personne, et l'ignorer en silence est pire.
    expect(analyser(['--port', '7777'], CONNUS).valeurs.get('port')).toBe('7777');
    expect(analyser(['--port=7777'], CONNUS).valeurs.get('port')).toBe('7777');
  });

  it('les booléens sont vus, les positionnels aussi', () => {
    const a = analyser(['--yes', 'projet', '--dry-run', 'autre'], CONNUS);
    expect(a.drapeaux.has('yes')).toBe(true);
    expect(a.drapeaux.has('dry-run')).toBe(true);
    expect(a.positionnels).toEqual(['projet', 'autre']);
    expect(a.erreur).toBeNull();
  });

  it('une valeur peut contenir un « = »', () => {
    expect(analyser(['--bind=0.0.0.0:8080=x'], CONNUS).valeurs.get('bind')).toBe('0.0.0.0:8080=x');
  });
});

describe('ce qui est REFUSÉ, et jamais deviné', () => {
  it('UN DRAPEAU INCONNU EST UNE ERREUR — et le message liste ce qui existe', () => {
    // `--dry-runn` doit s'arrêter net : quelqu'un qui croit simuler et qui
    // écrit pour de bon a été trahi par son outil.
    const a = analyser(['--dry-runn'], CONNUS);
    expect(a.erreur).not.toBeNull();
    expect(a.erreur!.message).toContain('--dry-runn');
    expect(a.erreur!.message, 'sans la liste, il faut lire le code source').toContain('--dry-run');
  });

  it('un booléen à qui on donne une valeur est une erreur', () => {
    expect(analyser(['--yes=1'], CONNUS).erreur?.message).toContain('ne prend pas de valeur');
  });

  it('UNE VALEUR OUBLIÉE NE MANGE PAS LE DRAPEAU SUIVANT', () => {
    // Sinon « --port --json » ferait un port nommé « --json », et l'erreur
    // n'apparaîtrait que bien plus loin, sans rapport apparent.
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

  it('REFUSE ce qui n’est pas un entier dans les bornes — au lieu de rendre NaN', () => {
    // Rendre NaN reporte la panne au moment où le port vaudra « NaN », et le
    // message ne dira plus d'où ça vient.
    for (const mauvais of ['abc', '3.5', '0', '99999', '-1', '']) {
      const r = entier(analyser([`--port=${mauvais || 'x'}`], CONNUS), 'port', {
        min: 1,
        max: 65_535,
        defaut: 7777,
      });
      expect(r.erreur, mauvais).not.toBeNull();
      expect(r.valeur, 'le défaut est rendu pour que l’appelant puisse continuer').toBe(7777);
    }
  });
});

describe('le mode non interactif', () => {
  it('vient du drapeau, ou de la CI', () => {
    expect(nonInteractif(analyser(['--non-interactive'], CONNUS))).toBe(true);
    expect(nonInteractif(analyser([], CONNUS), { CI: 'true' })).toBe(true);
    expect(nonInteractif(analyser([], CONNUS), {})).toBe(false);
    expect(nonInteractif(analyser([], CONNUS), { CI: '' })).toBe(false);
  });
});

describe('compléter un .env sans le réécrire', () => {
  const REGLAGES: Reglage[] = [
    { cle: 'HIVE_TOKEN', valeur: 'nouveau', commentaire: 'le jeton' },
    { cle: 'HIVE_PORT', valeur: '7777', commentaire: 'le port' },
  ];

  it('UN FICHIER DÉJÀ COMPLET EST RENDU INTACT, AU CARACTÈRE PRÈS', () => {
    // C'est l'idempotence du §12, et elle n'était pas vraie : le fichier était
    // régénéré en entier dès qu'une clé manquait.
    const ecritALaMain = [
      '# Ma ruche à moi, rangée comme je veux',
      '',
      'HIVE_PORT=7777      # je tiens à ce port',
      "HIVE_TOKEN='mon-jeton'",
      '',
    ].join('\n');
    expect(completerEnv(ecritALaMain, REGLAGES)).toBe(ecritALaMain);
  });

  it('LES COMMENTAIRES ET L’ORDRE DE L’HUMAIN SURVIVENT à une complétion', () => {
    const avant = ['# pourquoi j’ai mis ça', 'HIVE_TOKEN=le-mien', ''].join('\n');
    const apres = completerEnv(avant, REGLAGES);
    expect(apres.startsWith('# pourquoi j’ai mis ça\nHIVE_TOKEN=le-mien')).toBe(true);
    expect(apres, 'la clé manquante est ajoutée').toContain('HIVE_PORT=7777');
    expect(apres, 'avec son explication').toContain('# le port');
    expect(lireEnv(apres).get('HIVE_TOKEN'), 'la valeur en service est intacte').toBe('le-mien');
  });

  it('deux passages de suite ne changent rien de plus', () => {
    const un = completerEnv('HIVE_TOKEN=x\n', REGLAGES);
    expect(completerEnv(un, REGLAGES)).toBe(un);
  });

  it('un fichier vide donne une création propre, sans en-tête de section', () => {
    const cree = completerEnv('', REGLAGES);
    expect(cree).not.toContain('Complété par');
    expect(lireEnv(cree).get('HIVE_PORT')).toBe('7777');
  });

  it('une valeur commentée ne compte PAS comme présente', () => {
    // `# HIVE_PORT=7777` est une suggestion, pas un réglage. La confondre
    // avec une valeur en service laisserait la clé absente du fichier réel.
    const apres = completerEnv('# HIVE_PORT=8080\nHIVE_TOKEN=x\n', REGLAGES);
    expect(lireEnv(apres).get('HIVE_PORT')).toBe('7777');
  });
});
