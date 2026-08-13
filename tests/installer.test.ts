// L'installation en une commande.
//
// Le test qui compte : un `.env` existant n'est JAMAIS écrasé. Écraser une
// configuration, c'est effacer un jeton en service et couper tous les nœuds
// déjà connectés — pour « aider ». C'est le genre de dégât qu'un installeur
// fait une seule fois, et qu'on ne lui pardonne pas.

import { describe, expect, it } from 'vitest';
import { SECRET_JWT_INTERDIT } from '../src/orchestrator/auth.js';
import {
  LONGUEUR_JETON,
  LONGUEUR_SECRET_SESSION,
  NODE_MIN,
  avertissements,
  composerReglages,
  engendrerJeton,
  lireEnv,
  PORT_DEFAUT,
  nodeSuffisant,
  portRetenu,
  prochainesEtapes,
  rendreEnv,
} from '../src/installer.js';
import { MIN_TOKEN_LENGTH } from '../src/shared/types.js';
import { LARGEUR_MAX, largeurVisible, panneau, type Capacites } from '../src/tui/rendu.js';

describe('installation — le jeton', () => {
  it('dépasse confortablement le minimum exigé par la ruche', () => {
    const j = engendrerJeton();
    expect(j).toHaveLength(LONGUEUR_JETON);
    expect(j.length).toBeGreaterThan(MIN_TOKEN_LENGTH);
  });

  it('n’est jamais deux fois le même', () => {
    // Ce jeton est la SEULE chose qui sépare une ruche d'un inconnu qui a
    // trouvé son port.
    const jetons = new Set(Array.from({ length: 200 }, () => engendrerJeton()));
    expect(jetons.size).toBe(200);
  });

  it('ne contient que des caractères sûrs dans un .env', () => {
    // Un caractère exotique casserait le parsing, ou pire, y ferait entrer
    // autre chose.
    for (let i = 0; i < 50; i++) expect(engendrerJeton()).toMatch(/^[0-9a-f]+$/);
  });
});

describe('installation — lire un .env écrit à la main', () => {
  it('lit une configuration ordinaire', () => {
    const m = lireEnv('HIVE_TOKEN=abc\nHIVE_PORT=8080\n');
    expect(m.get('HIVE_TOKEN')).toBe('abc');
    expect(m.get('HIVE_PORT')).toBe('8080');
  });

  it('tolère commentaires, lignes vides, export et guillemets', () => {
    // Un .env écrit à la main contient tout ça. Le refuser pour un détail de
    // forme reviendrait à écraser une configuration valide.
    const m = lireEnv(
      ['# un commentaire', '', 'export HIVE_TOKEN="secret"', "HIVE_PORT='9000'", '  '].join('\n'),
    );
    expect(m.get('HIVE_TOKEN')).toBe('secret');
    expect(m.get('HIVE_PORT')).toBe('9000');
  });

  it('ignore ce qui n’est pas une affectation', () => {
    const m = lireEnv('bonjour\n=orphelin\n1INVALIDE=x\n');
    expect(m.size).toBe(0);
  });

  it('garde une valeur contenant un « = »', () => {
    expect(lireEnv('CLE=a=b=c').get('CLE')).toBe('a=b=c');
  });
});

describe('installation — ne JAMAIS écraser', () => {
  it('préserve chaque valeur existante', () => {
    const existant = new Map([
      ['HIVE_TOKEN', 'mon-jeton-en-service'],
      ['HIVE_PORT', '9999'],
      ['HIVE_GARDIENNES', 'strict'],
    ]);
    const r = composerReglages(existant, 'un-jeton-neuf');
    const valeur = (cle: string): string => r.find((x) => x.cle === cle)?.valeur ?? '';
    expect(valeur('HIVE_TOKEN'), 'le jeton en service a été écrasé').toBe('mon-jeton-en-service');
    expect(valeur('HIVE_PORT')).toBe('9999');
    expect(valeur('HIVE_GARDIENNES')).toBe('strict');
  });

  it('préserve même un jeton trivial — mais le SIGNALE', () => {
    // Le changer couperait les nœuds connectés. On prévient, on ne décide pas
    // à la place de l'humain.
    const r = composerReglages(new Map([['HIVE_TOKEN', 'court']]));
    expect(r.find((x) => x.cle === 'HIVE_TOKEN')?.valeur).toBe('court');
    const dits = avertissements(r);
    expect(dits).toHaveLength(1);
    expect(dits[0]).toMatch(new RegExp(`${MIN_TOKEN_LENGTH} caractères`));
  });

  it('ne dit rien quand tout va bien', () => {
    expect(avertissements(composerReglages(new Map()))).toEqual([]);
  });

  it('complète les clés absentes sans toucher aux autres', () => {
    const r = composerReglages(new Map([['HIVE_TOKEN', 'garde-moi']]));
    expect(r.find((x) => x.cle === 'HIVE_TOKEN')?.valeur).toBe('garde-moi');
    expect(r.find((x) => x.cle === 'HIVE_GARDIENNES')?.valeur).toBe('consultatif');
    expect(r.find((x) => x.cle === 'HIVE_POLYETHISME')?.valeur).toBe('consignes');
  });

  it('les défauts posés ne sont jamais contraignants', () => {
    // Une installation neuve ne doit rien refuser ni rien retenir : c'est la
    // règle que suivent déjà les Gardiennes et le polyéthisme.
    const r = composerReglages(new Map());
    expect(r.find((x) => x.cle === 'HIVE_GARDIENNES')?.valeur).not.toBe('strict');
    expect(r.find((x) => x.cle === 'HIVE_POLYETHISME')?.valeur).not.toBe('strict');
  });

  it('L’AUTONOMIE RÉELLE EST ÉTEINTE À L’INSTALLATION', () => {
    // Le seul réglage qui fait DÉPENSER sans qu'on regarde. Une ruche
    // fraîchement installée ne se met pas au travail toute seule pendant la
    // nuit — ce défaut-là n'est pas un choix de confort.
    expect(composerReglages(new Map()).find((x) => x.cle === 'HIVE_RUNNER')?.valeur).toBe('off');
  });

  it('l’allumer est ANNONCÉ, pas glissé dans le fichier', () => {
    // Un installeur qui se tait sur une configuration coûteuse a échoué même
    // s'il s'est terminé sans erreur.
    const dits = avertissements(
      composerReglages(
        new Map([
          ['HIVE_TOKEN', 'un-jeton-bien-assez-long-pour-passer'],
          ['HIVE_RUNNER', 'on'],
        ]),
      ),
    );
    expect(dits.some((d) => /HIVE_RUNNER/.test(d) && /seuls?/i.test(d))).toBe(true);
  });

  it('L’INSTALLATION POSE UN SECRET DE SESSION, ET IL N’EST PAS LE JETON', () => {
    // La ruche refuse de démarrer sans lui : s'il manquait ici, « npm run
    // setup » livrerait une installation qui ne démarre pas. Et il doit être
    // DISTINCT du jeton de ruche — celui-là se recopie de machine en machine,
    // et se retrouve donc dans des mains qui n'ont pas à signer de sessions.
    const r = composerReglages(new Map());
    const secret = r.find((x) => x.cle === 'HIVE_JWT_SECRET')?.valeur ?? '';
    expect(secret).toHaveLength(LONGUEUR_SECRET_SESSION);
    expect(secret).not.toBe(r.find((x) => x.cle === 'HIVE_TOKEN')?.valeur);
    expect(secret).not.toBe(SECRET_JWT_INTERDIT);
  });

  it('mais il ne bouge pas s’il existe déjà — sinon tout le monde est déconnecté', () => {
    const r = composerReglages(new Map([['HIVE_JWT_SECRET', 'le-secret-en-service']]));
    expect(r.find((x) => x.cle === 'HIVE_JWT_SECRET')?.valeur).toBe('le-secret-en-service');
  });

  it('un .env qui a recopié l’ancien secret PUBLIÉ est signalé', () => {
    // Il a circulé dans un dépôt public. Le garder, c'est laisser n'importe qui
    // se fabriquer la session de l'administrateur.
    const dits = avertissements(
      composerReglages(
        new Map([
          ['HIVE_TOKEN', 'un-jeton-bien-assez-long-pour-passer'],
          ['HIVE_JWT_SECRET', SECRET_JWT_INTERDIT],
        ]),
      ),
    );
    expect(dits.some((d) => /HIVE_JWT_SECRET/.test(d))).toBe(true);
  });

  it('HIVE_HTTP suit le port choisi', () => {
    const r = composerReglages(new Map([['HIVE_PORT', '4242']]));
    expect(r.find((x) => x.cle === 'HIVE_HTTP')?.valeur).toBe('http://localhost:4242');
  });
});

describe('installation — le fichier rendu', () => {
  it('fait l’aller-retour sans perte', () => {
    // Le .env engendré doit être relisible par le script lui-même, sinon la
    // seconde exécution croirait tout absent et réécrirait tout.
    const r = composerReglages(new Map(), 'jeton-de-test-0123456789abcdef');
    const relu = lireEnv(rendreEnv(r));
    for (const reglage of r) expect(relu.get(reglage.cle), reglage.cle).toBe(reglage.valeur);
  });

  it('explique chaque réglage', () => {
    // Ce fichier sera relu dans six mois par quelqu'un qui mettra
    // HIVE_GARDIENNES à « strict » au hasard s'il n'y a rien pour l'en dissuader.
    const texte = rendreEnv(composerReglages(new Map()));
    for (const cle of ['HIVE_TOKEN', 'HIVE_GARDIENNES', 'HIVE_POLYETHISME']) {
      const i = texte.indexOf(`${cle}=`);
      const ligneAvant = texte.slice(0, i).split('\n').slice(-2)[0] ?? '';
      expect(ligneAvant.startsWith('#'), `${cle} sans explication`).toBe(true);
    }
  });

  it('dit que le jeton ne se publie pas', () => {
    expect(rendreEnv(composerReglages(new Map()))).toMatch(/Ne le publiez jamais/);
  });
});

describe('installation — la version de Node', () => {
  it('accepte ce qui suffit, refuse ce qui ne suffit pas', () => {
    expect(nodeSuffisant(`v${NODE_MIN}.0.0`)).toBe(true);
    expect(nodeSuffisant(`v${NODE_MIN + 4}.11.1`)).toBe(true);
    expect(nodeSuffisant(`v${NODE_MIN - 2}.9.0`)).toBe(false);
  });

  it('tolère l’absence de « v »', () => {
    expect(nodeSuffisant(`${NODE_MIN}.1.0`)).toBe(true);
  });

  it('refuse une version illisible plutôt que de supposer', () => {
    expect(nodeSuffisant('inconnue')).toBe(false);
    expect(nodeSuffisant('')).toBe(false);
  });
});

describe('installation — les prochaines étapes', () => {
  it('donnent des commandes réelles du dépôt', () => {
    const etapes = prochainesEtapes('Claude Code', 'linux', '/home/x/hive');
    expect(etapes.join('\n')).toContain('npm run dev');
    expect(etapes.join('\n')).toContain('npm run node');
    expect(etapes.join('\n')).toContain('Claude Code');
  });

  it('sans agent, disent que la ruche tourne quand même', () => {
    // Ne pas avoir d'agent ne doit jamais ressembler à un échec d'installation.
    expect(prochainesEtapes(null).join('\n')).toMatch(/simulé/);
  });

  // ═══ CE QUE LE TERRAIN A APPRIS ══════════════════════════════════════════════
  //
  // Une installation réelle sur Windows 11 est allée jusqu'au bout, puis a buté
  // sur la PREMIÈRE commande de ce panneau :
  //
  //     PS C:\WINDOWS\system32> npm run dev
  //     npm : Impossible de charger le fichier …\npm.ps1, car l'exécution de
  //     scripts est désactivée sur ce système.
  //
  // Deux défauts dans une ligne : le shell n'est PAS dans le dossier de la
  // ruche (les deux installeurs y entrent puis en ressortent), et sous
  // PowerShell `npm` passe par un `.ps1` que la stratégie d'exécution refuse.

  it('DISENT OÙ ALLER — le shell n’est pas resté dans la ruche', () => {
    // `install.ps1` fait `Push-Location $Dir` … `Pop-Location`, `install.sh`
    // clone dans `$HOME/hive` sans déplacer le shell de l'appelant : dans les
    // deux cas, la personne se retrouve là où elle était. Conseiller
    // `npm run dev` depuis cet endroit-là, c'est conseiller un ENOENT.
    const chemin = '/home/quelquun/hive';
    const etapes = prochainesEtapes('Claude Code', 'linux', chemin);

    expect(etapes[0], 'la toute première étape est d’y aller').toContain(`cd '${chemin}'`);
    // Le dossier vient du paramètre, jamais d'une constante : deux personnes
    // n'installent pas au même endroit.
    expect(prochainesEtapes(null, 'linux', '/opt/ruche')[0]).toContain(`cd '/opt/ruche'`);
  });

  it('UN CHEMIN AVEC UNE ESPACE RESTE COLLABLE — « C:\\Users\\Jean Dupont »', () => {
    // Défaut introduit par le correctif du rapport de terrain lui-même : la
    // ligne `cd` était écrite NUE. Sur Windows, un compte s'appelle très
    // souvent « Jean Dupont », et `cd C:\Users\Jean Dupont\hive` échoue —
    // PowerShell y voit deux paramètres positionnels. Sous sh, `cd` reçoit
    // deux arguments et n'en garde qu'un.
    //
    // La première commande de l'écran de fin ne peut pas être collable
    // « seulement quand le nom d'utilisateur est simple ».
    const w = prochainesEtapes('Claude Code', 'win32', 'C:\\Users\\Jean Dupont\\hive');
    expect(w[0]).toContain(`cd 'C:\\Users\\Jean Dupont\\hive'`);

    const l = prochainesEtapes('Claude Code', 'linux', '/home/jean dupont/hive');
    expect(l[0]).toContain(`cd '/home/jean dupont/hive'`);
  });

  it('UNE APOSTROPHE DANS LE CHEMIN NE CASSE PAS LA CITATION — « O’Brien »', () => {
    // Un compte Windows « O'Brien » existe, et l'apostrophe ferme la citation.
    // Les deux systèmes ne l'échappent pas de la même façon : PowerShell double
    // l'apostrophe, sh la sort de la citation. Se tromper de convention rend
    // une ligne qui a l'air juste et qui ne l'est pas.
    const w = prochainesEtapes(null, 'win32', "C:\\Users\\O'Brien\\hive");
    expect(w[0], 'PowerShell double l’apostrophe').toContain(`cd 'C:\\Users\\O''Brien\\hive'`);

    const l = prochainesEtapes(null, 'linux', "/home/o'brien/hive");
    expect(l[0], 'sh la sort de la citation').toContain(`cd '/home/o'\\''brien/hive'`);
  });

  it('SOUS WINDOWS, C’EST `npm.cmd` — jamais `npm`, que PowerShell refuse', () => {
    const etapes = prochainesEtapes('Claude Code', 'win32', 'C:\\Users\\Evan\\hive');
    const texte = etapes.join('\n');

    expect(texte).toContain(`cd 'C:\\Users\\Evan\\hive'`);
    expect(texte).toContain('npm.cmd run dev');
    // La garde qui compte : AUCUNE commande conseillée ne doit passer par le
    // shim `.ps1`. Un seul `npm ` nu suffirait à rejouer la panne du terrain.
    expect(texte, 'aucune commande nue ne doit rester').not.toMatch(/(^|[^.\w])npm run /);
    // Et on DIT pourquoi : une commande bizarre sans explication se fait
    // « corriger » par la première personne qui la relit.
    expect(texte).toContain('npm.ps1');
  });

  it('ET LE PANNEAU LES AFFICHE EN ENTIER — l’adresse ne tombe pas dans la coupe', () => {
    // ─── LES DEUX MOITIÉS D'UN MÊME ÉCRAN ──────────────────────────────────
    //
    // Ces étapes sont justes, et le cadre qui les affiche les tronquait :
    //
    //     Ouvrir Mission Control   :  npm run dev:dashboard   (puis http://loc…
    //
    // Aucun des tests au-dessus ne pouvait le voir — ils lisent les ÉTAPES,
    // jamais le panneau. Une ligne juste rendue par un cadre qui coupe reste
    // une adresse que personne ne peut ouvrir.
    const caps: Capacites = {
      couleur: 0,
      unicode: true,
      cadres: true,
      interactif: true,
      largeur: LARGEUR_MAX,
    };
    const rendu = panneau(
      'Et maintenant',
      prochainesEtapes('Claude Code', 'linux', '/home/x/hive'),
      caps,
    );
    const texte = rendu.join('\n');
    expect(texte, 'une étape a été tronquée').not.toContain('…');
    const ligne = prochainesEtapes(null, 'linux', '/home/x/hive').find((e) =>
      e.includes('Mission Control'),
    );
    const adresse = /(https?:\/\/[^\s)]+)/.exec(ligne ?? '')?.[1];
    expect(adresse, 'l’installeur doit annoncer une adresse').toBeTruthy();
    expect(texte, `« ${adresse ?? ''} » est annoncée mais coupée`).toContain(adresse);
    for (const l of rendu) expect(largeurVisible(l)).toBeLessThanOrEqual(caps.largeur);
  });

  it('AILLEURS, C’EST `npm` — on n’impose pas un shim Windows à tout le monde', () => {
    const texte = prochainesEtapes('Claude Code', 'darwin', '/Users/x/hive').join('\n');

    expect(texte).toContain('npm run dev');
    expect(texte, 'le shim `.cmd` n’existe pas hors de Windows').not.toContain('npm.cmd');
    expect(texte, 'et l’explication PowerShell n’a rien à y faire').not.toContain('npm.ps1');
  });
});

describe('installation — le port que la ruche ouvrira RÉELLEMENT', () => {
  // Cette fonction existe parce que la sonde et l'écriture divergeaient : la
  // première regardait `PORT_DEFAUT` sans condition, la seconde retenait le
  // port du `.env`. Les deux doivent désormais lire la MÊME décision, sinon
  // l'installeur répond sur une porte qu'il n'ouvrira pas.

  it('sans .env, c’est le port par défaut', () => {
    expect(portRetenu(new Map())).toBe(PORT_DEFAUT);
  });

  it('avec un HIVE_PORT existant, c’est LUI — pas le défaut', () => {
    expect(portRetenu(new Map([['HIVE_PORT', '9000']]))).toBe(9000);
    expect(portRetenu(new Map([['HIVE_PORT', '9000']]))).not.toBe(PORT_DEFAUT);
  });

  it('la décision suit `composerReglages` — une seule vérité pour un port', () => {
    // La garde qui compte : si l'une des deux dérivait, l'installeur
    // annoncerait un port et en écrirait un autre. On les compare plutôt que
    // de recopier la règle ici, où elle pourrait vieillir en silence.
    for (const existant of [
      new Map<string, string>(),
      new Map([['HIVE_PORT', '9000']]),
      new Map([['HIVE_PORT', String(PORT_DEFAUT)]]),
    ]) {
      const ecrit = composerReglages(existant).find((r) => r.cle === 'HIVE_PORT')?.valeur;
      expect(String(portRetenu(existant)), `pour ${JSON.stringify([...existant])}`).toBe(ecrit);
    }
  });

  it('une valeur qui n’est pas un port rend `null` — on ne sonde pas au hasard', () => {
    // `null` n'est pas « libre » : c'est « je ne peux pas conclure ». Retomber
    // sur le défaut sonderait une porte que personne n'a demandée, et le dirait
    // libre — un vert emprunté, la pire des réponses.
    for (const brut of ['abc', '', '  ', '80.5', '-1', '0', '65536', '7777abc']) {
      expect(portRetenu(new Map([['HIVE_PORT', brut]])), `pour « ${brut} »`).toBeNull();
    }
  });

  it('les bornes du domaine sont acceptées', () => {
    expect(portRetenu(new Map([['HIVE_PORT', '1']]))).toBe(1);
    expect(portRetenu(new Map([['HIVE_PORT', '65535']]))).toBe(65535);
  });
});
