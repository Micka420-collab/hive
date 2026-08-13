// Le service — systemd, launchd, planificateur Windows.
//
// ─── CE QU'ON PEUT VÉRIFIER ICI, ET CE QU'ON NE PEUT PAS ─────────────────────
//
// On ne peut PAS installer un vrai service dans une CI : `systemctl --user`
// n'a pas de bus de session sur un runner, `launchctl load` demande une
// session graphique, `schtasks` inscrit pour de vrai dans le planificateur de
// la machine. Prétendre le contraire donnerait des tests qui ne tournent
// nulle part.
//
// Ce qui EST vérifiable, et qui porte l'essentiel :
//
//   · le PLAN — le fichier posé, les commandes lancées, dans quel ordre. C'est
//     du texte, rendu par un module pur, pour les TROIS plateformes depuis
//     n'importe laquelle (§ 6.3) ;
//   · l'ÉCHAPPEMENT, éprouvé sur des chemins hostiles. Ce fichier décrit ce
//     que la machine lancera au démarrage : une injection ici n'est pas une
//     coquille ;
//   · le cycle install → uninstall contre un système SIMULÉ, avec l'exigence
//     de l'ADR 0004 : après les deux, aucun fichier ne subsiste et rien ne
//     reste inscrit.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  AVERTISSEMENT_LINGER,
  type Contexte,
  type Plan,
  avantDePoser,
  citerArgumentSystemd,
  valeurSystemd,
  echapperXml,
  codeJournal,
  planifier,
  rendreGestes,
  scriptDe,
} from '../src/shared/service.js';
import {
  SYSTEME,
  type Issue,
  type Systeme,
  desinstaller,
  installer,
  statut,
} from '../src/service-reel.js';

const base = (o: Partial<Contexte> = {}): Contexte => ({
  plateforme: 'linux',
  niveau: 'utilisateur',
  cible: 'ruche',
  racine: '/home/moi/hive',
  execNode: '/usr/bin/node',
  home: '/home/moi',
  ...o,
});

const plan = (o: Partial<Contexte> = {}): Plan => {
  const r = planifier(base(o));
  if (r.genre === 'refus') throw new Error(`refus inattendu : ${r.motif}`);
  return r;
};

describe('LE RÉPERTOIRE DE TRAVAIL — la garde qui compte le plus', () => {
  // ─── LE DÉFAUT QUE CETTE SECTION FERME ─────────────────────────────────────
  //
  // `src/orchestrator/main.ts` fait `process.loadEnvFile('.env')` — un chemin
  // RELATIF — et avale l'échec dans un `catch`. Un service lancé depuis le
  // mauvais répertoire démarre donc « avec succès », sans `HIVE_TOKEN`, sans
  // `HIVE_JWT_SECRET`, sur des valeurs par défaut.
  //
  // Il tourne. Il écoute. Il n'est la ruche de personne. Et rien, nulle part,
  // ne le dit — c'est la pire forme de panne que ce dépôt collectionne.

  it.each([
    ['linux', 'WorkingDirectory'],
    ['darwin', 'WorkingDirectory'],
    ['win32', 'WorkingDirectory'],
  ] as const)('%s pose un répertoire de travail EXPLICITE', (plateforme, cle) => {
    const p = plan({ plateforme });
    expect(p.fichier.contenu, `${plateforme} : ${cle} absent`).toContain(cle);
    expect(p.fichier.contenu, `${plateforme} : la racine n’y est pas`).toContain('/home/moi/hive');
  });

  it('…et c’est bien LA RACINE, pas le dossier du fichier de service', () => {
    // Un `WorkingDirectory` qui pointerait sur `~/.config/systemd/user` serait
    // présent, syntaxiquement correct, et tout aussi faux.
    const p = plan();
    const ligne = p.fichier.contenu.split('\n').find((l) => l.startsWith('WorkingDirectory='))!;
    // SANS guillemets : `WorkingDirectory=` prend la ligne entière. Cette ligne
    // affirmait l'inverse, et elle était verte — parce qu'elle comparait le
    // fichier à lui-même. `tests/service-accepte.test.ts` le soumet désormais à
    // `systemd-analyze verify`, qui, lui, le refusait.
    expect(ligne).toBe('WorkingDirectory=/home/moi/hive');
  });
});

describe('L’ÉCHAPPEMENT — ce fichier décrit ce que la machine lancera', () => {
  it('systemd : les espaces sont citées DANS UNE LIGNE DE COMMANDE', () => {
    expect(citerArgumentSystemd('/mes docs/hive')).toBe('"/mes docs/hive"');
  });

  it('systemd : `%` EST DOUBLÉ — le piège qu’on ne voit pas venir', () => {
    // `%` est le caractère de spécificateur de systemd : `%h` devient le home,
    // `%i` le nom d'instance. Un chemin contenant `%h` ne PLANTERAIT pas — il
    // serait silencieusement remplacé par autre chose. Une panne qui ne
    // ressemble pas à une panne.
    expect(citerArgumentSystemd('/tmp/100%h/hive')).toBe('"/tmp/100%%h/hive"');
  });

  it('systemd : `%` est doublé AUSSI hors ligne de commande', () => {
    // La seule règle commune aux deux grammaires. `valeurSystemd` n'échappe
    // rien d'autre — et c'est délibéré : hors découpage, `\` et `"` sont des
    // caractères du chemin, pas de la syntaxe.
    expect(valeurSystemd('/tmp/100%h/hive')).toBe('/tmp/100%%h/hive');
    expect(valeurSystemd('/a"b\\c')).toBe('/a"b\\c');
  });

  it('systemd : guillemets et barres inverses', () => {
    expect(citerArgumentSystemd('/a"b\\c')).toBe('"/a\\"b\\\\c"');
  });

  it('XML : les cinq entités', () => {
    expect(echapperXml(`<a&b"c'd>`)).toBe('&lt;a&amp;b&quot;c&apos;d&gt;');
  });

  it.each(['darwin', 'win32'] as const)(
    '%s : UN CHEMIN HOSTILE NE PEUT PAS RÉÉCRIRE LE DOCUMENT',
    (plateforme) => {
      // Le scénario réel : quelqu'un installe dans un dossier dont le nom
      // contient une balise. Sans échappement, ce document — qui décrit ce que
      // la machine lance au démarrage — se laisse réécrire.
      const mechant =
        plateforme === 'win32'
          ? 'C:\\a</Command><Command>calc.exe</Command><x>'
          : '/a</string></array><key>Program</key><string>/bin/sh';
      const p = plan({ plateforme, racine: mechant, home: mechant });

      // On ne peut pas interdire `</string>` : le document en contient
      // légitimement. Ce qui compte est que la chaîne HOSTILE n'y soit pas
      // telle quelle, et qu'elle y soit sous sa forme échappée.
      expect(p.fichier.contenu, 'la chaîne hostile est passée telle quelle').not.toContain(mechant);
      expect(p.fichier.contenu).toContain(echapperXml(mechant));
      // Et le document reste équilibré : autant de `<` que de `>` d'origine.
      const ouvrants = (p.fichier.contenu.match(/</g) ?? []).length;
      const fermants = (p.fichier.contenu.match(/>/g) ?? []).length;
      expect(ouvrants).toBe(fermants);
    },
  );

  it('linux : UN RETOUR À LA LIGNE EST REFUSÉ, pas échappé', () => {
    // ─── LE DÉFAUT QUE CE TEST A TROUVÉ ────────────────────────────────────
    //
    // Ma première version citait la valeur et croyait s'en sortir. Non : le
    // format d'unité systemd termine une directive à la FIN DE LIGNE,
    // guillemets ou pas. Un `\n` dans le chemin ajoutait donc un
    // `ExecStartPre=` à l'unité — c'est-à-dire une commande de plus au
    // démarrage de la machine.
    //
    // La bonne réponse n'est pas un échappement plus malin, c'est un refus :
    // aucun chemin légitime ne contient un caractère de contrôle.
    const r = planifier(base({ racine: '/a\nExecStartPre=/bin/sh -c evil' }));
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') expect(r.motif).toMatch(/caractère de contrôle/);
  });

  it('…et le refus vaut pour les TROIS valeurs qui entrent dans le fichier', () => {
    for (const champ of ['racine', 'home', 'execNode'] as const) {
      const r = planifier(base({ [champ]: `/a\nb` }));
      expect(r.genre, `${champ} accepte un retour à la ligne`).toBe('refus');
    }
  });
});

describe('LE PLAN, PAR PLATEFORME — vérifié depuis n’importe laquelle', () => {
  it('linux : une unité systemd --user, durcie', () => {
    const p = plan();
    expect(p.fichier.chemin).toBe('/home/moi/.config/systemd/user/hive-ruche.service');
    for (const durcissement of [
      'NoNewPrivileges=true',
      'PrivateTmp=true',
      'ProtectSystem=strict',
      'ProtectHome=read-only',
      'Restart=on-failure',
      'RestartSec=5',
    ]) {
      expect(p.fichier.contenu, `${durcissement} manquant`).toContain(durcissement);
    }
    // `ProtectSystem=strict` rend TOUT en lecture seule : sans `ReadWritePaths`,
    // la ruche ne pourrait pas écrire sa propre base.
    expect(p.fichier.contenu).toContain('ReadWritePaths="/home/moi/hive"');
  });

  it('linux : le niveau système vise /etc et le DIT', () => {
    const p = plan({ niveau: 'systeme' });
    expect(p.fichier.chemin).toBe('/etc/systemd/system/hive-ruche.service');
    expect(p.avertissements.join(' ')).toMatch(/sudo/);
  });

  it('linux : la limite de `--user` est dite À L’INSTALLATION', () => {
    // « Une ruche qui s'éteint sans raison apparente est un bug d'accueil,
    //   même quand c'est le comportement documenté de systemd. » — ADR 0004.
    expect(plan().avertissements).toContain(AVERTISSEMENT_LINGER);
    expect(AVERTISSEMENT_LINGER).toMatch(/loginctl enable-linger/);
  });

  it('darwin : un LaunchAgent qui ne relance QUE sur échec', () => {
    const p = plan({ plateforme: 'darwin' });
    expect(p.fichier.chemin).toBe('/home/moi/Library/LaunchAgents/fr.hive.ruche.plist');
    // `SuccessfulExit=false` : on relance si ça meurt mal, pas si quelqu'un
    // l'arrête. Sans ça, un `hive` éteint à la main repart aussitôt — un
    // logiciel qu'on ne peut pas arrêter.
    expect(p.fichier.contenu).toContain('<key>SuccessfulExit</key>');
    expect(p.fichier.contenu).toContain('<false/>');
    expect(p.fichier.contenu).toContain('<key>RunAtLoad</key>');
  });

  it('win32 : une tâche à l’ouverture de session, SANS élévation', () => {
    const p = plan({ plateforme: 'win32', racine: 'C:\\Users\\moi\\hive', home: 'C:\\Users\\moi' });
    expect(p.fichier.chemin).toBe('C:\\Users\\moi\\hive\\data\\hive-ruche.xml');
    expect(p.fichier.contenu).toContain('<LogonTrigger>');
    // JAMAIS `HighestAvailable`. Une ruche n'a aucune raison d'être
    // administrateur, et une tâche qui le demande ne s'installe pas sans UAC.
    expect(p.fichier.contenu).toContain('<RunLevel>LeastPrivilege</RunLevel>');
    expect(p.fichier.contenu).not.toContain('HighestAvailable');
  });

  it('win32 : le niveau système est REFUSÉ, avec un motif utile', () => {
    const r = planifier(base({ plateforme: 'win32', niveau: 'systeme' }));
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') expect(r.motif).toMatch(/administrateur/);
  });

  it('LES CHEMINS SUIVENT LA PLATEFORME VISÉE, pas celle qui exécute', () => {
    // § 6.3. Ce test tourne sous Linux en CI et vérifie quand même la forme
    // Windows — c'est tout l'intérêt de passer la plateforme en paramètre.
    const p = plan({ plateforme: 'win32', racine: 'C:\\hive', home: 'C:\\Users\\moi' });
    expect(p.fichier.chemin).toContain('\\');
    expect(p.fichier.chemin).not.toContain('/');
  });

  it('une racine RELATIVE est refusée, et le motif dit pourquoi', () => {
    const r = planifier(base({ racine: './hive' }));
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') expect(r.motif).toMatch(/absolus/);
  });

  it('une plateforme inconnue rend la commande à lancer à la main', () => {
    const r = planifier(base({ plateforme: 'freebsd' }));
    expect(r.genre).toBe('refus');
    if (r.genre === 'refus') expect(r.motif).toContain('/home/moi/hive/dist/orchestrator/main.js');
  });

  it('la cible choisit le point d’entrée', () => {
    expect(scriptDe('ruche')).toBe('dist/orchestrator/main.js');
    expect(scriptDe('noeud')).toBe('dist/node-client/main.js');
    expect(plan({ cible: 'noeud' }).fichier.contenu).toContain('dist/node-client/main.js');
  });

  it('AUCUNE commande ne passe par un shell — elles sont toutes décomposées', () => {
    // Contrainte § 5.1 du projet. Une commande rendue sous forme de CHAÎNE
    // finirait tôt ou tard dans un `exec`, et le chemin d'installation vient
    // de l'utilisateur.
    for (const plateforme of ['linux', 'darwin', 'win32'] as const) {
      const p = plan(
        plateforme === 'win32'
          ? { plateforme, racine: 'C:\\hive', home: 'C:\\Users\\moi' }
          : { plateforme },
      );
      for (const c of [...p.installer, ...p.desinstaller, p.statut, p.journal]) {
        expect(Array.isArray(c.args), `${plateforme} : ${c.bin} n’a pas d’args décomposés`).toBe(
          true,
        );
        expect(c.bin, `${plateforme} : ${c.bin} contient une espace`).not.toMatch(/\s/);
      }
    }
  });
});

describe('LE CYCLE install → uninstall, contre un système simulé', () => {
  /** Un système de fichiers et un lanceur en mémoire, qui n'ont rien à poser. */
  const simule = (codes: Record<string, number> = {}) => {
    const fichiers = new Map<string, { contenu: string; mode: number }>();
    const lances: string[] = [];
    const sys: Systeme = {
      ecrire: (chemin, contenu, mode) => void fichiers.set(chemin, { contenu, mode }),
      effacer: (chemin) => void fichiers.delete(chemin),
      existe: (chemin) => fichiers.has(chemin),
      lancer: (c): Issue => {
        lances.push(`${c.bin} ${c.args.join(' ')}`);
        return { quoi: c.quoi, code: codes[c.bin] ?? 0, sortie: '' };
      },
    };
    return { sys, fichiers, lances };
  };

  it('installe : le fichier D’ABORD, l’inscription ENSUITE', () => {
    // L'ordre inverse inscrirait un service qui pointe vers un fichier absent.
    const { sys, fichiers, lances } = simule();
    const r = installer(base(), sys);
    expect(r).not.toHaveProperty('motif');
    if ('plan' in r) {
      expect(fichiers.has(r.plan.fichier.chemin), 'le fichier n’a pas été écrit').toBe(true);
      expect(r.abouti).toBe(true);
    }
    expect(lances[0]).toContain('daemon-reload');
    expect(lances[1]).toContain('enable --now');
  });

  it('le fichier est écrit en 600', () => {
    const { sys, fichiers } = simule();
    const r = installer(base(), sys);
    if ('plan' in r) expect(fichiers.get(r.plan.fichier.chemin)?.mode).toBe(0o600);
  });

  it('S’ARRÊTE à la première commande en échec', () => {
    // Enchaîner après un `daemon-reload` raté donnerait un second message qui
    // masque le premier — et c'est le premier qui dit ce qui ne va pas.
    const { sys, lances } = simule({ systemctl: 1 });
    const r = installer(base(), sys);
    expect(lances).toHaveLength(1);
    if ('plan' in r) expect(r.abouti).toBe(false);
  });

  it('APRÈS install PUIS uninstall, PLUS RIEN NE SUBSISTE — exigence de l’ADR 0004', () => {
    const { sys, fichiers, lances } = simule();
    installer(base(), sys);
    expect(fichiers.size).toBe(1);

    const r = desinstaller(base(), sys);
    expect(fichiers.size, 'un fichier de service subsiste').toBe(0);
    if ('plan' in r) expect(r.abouti).toBe(true);
    // Et on a bien DÉSINSCRIT avant d'effacer.
    expect(lances.join('\n')).toContain('disable --now');
  });

  it('désinstalle QUAND MÊME si la désinscription échoue', () => {
    // Un `disable` qui échoue parce que le service n'était plus là ne doit pas
    // empêcher d'effacer le fichier : sinon un service à moitié retiré le
    // reste pour toujours, et chaque tentative échoue au même endroit.
    const { sys, fichiers } = simule();
    installer(base(), sys);
    const { sys: casse } = simule({ systemctl: 1 });
    // On rejoue la désinstallation sur le système où le fichier existe.
    const sysMixte: Systeme = { ...sys, lancer: casse.lancer };
    const r = desinstaller(base(), sysMixte);
    expect(fichiers.size, 'le fichier a survécu à l’échec').toBe(0);
    if ('plan' in r) expect(r.abouti).toBe(true);
  });

  it('`statut` dit si le fichier est POSÉ, pas seulement ce que le système répond', () => {
    // « inactive » et « je n'ai jamais été installé » sont deux situations
    // différentes, et la sortie de `systemctl` ne les distingue pas toujours.
    const { sys } = simule();
    const avant = statut(base(), sys);
    expect('pose' in avant && avant.pose).toBe(false);
    installer(base(), sys);
    const apres = statut(base(), sys);
    expect('pose' in apres && apres.pose).toBe(true);
  });

  it('une plateforme refusée ne pose RIEN', () => {
    const { sys, fichiers, lances } = simule();
    const r = installer(base({ plateforme: 'win32', niveau: 'systeme' }), sys);
    expect(r).toHaveProperty('motif');
    expect(fichiers.size).toBe(0);
    expect(lances).toHaveLength(0);
  });
});

describe('LE SERVICE ENTRE DANS L’EMPREINTE', () => {
  // Sans ça, `hive desinstaller` ne mentionnerait pas le fichier que le service
  // pose — et `docs/INSTALLATION.md` redeviendrait une promesse que rien ne
  // tient. C'est exactement le défaut que le lot précédent a fermé.
  it('les trois plateformes annoncent leur fichier de service', async () => {
    const { empreinte } = await import('../src/shared/empreinte.js');
    for (const [plateforme, attendu] of [
      ['linux', '/home/moi/.config/systemd/user/hive-ruche.service'],
      ['darwin', '/home/moi/Library/LaunchAgents/fr.hive.ruche.plist'],
    ] as const) {
      const e = empreinte({
        racine: '/home/moi/hive',
        dbPath: '/home/moi/hive/data/hive.db',
        workdir: '/home/moi/hive/.hive-work',
        tmpdir: '/tmp',
        home: '/home/moi',
        plateforme,
      }).find((x) => x.cle === 'service');
      expect(e, `${plateforme} : pas d’emplacement « service »`).toBeTruthy();
      expect(e!.chemin).toBe(attendu);
      // JAMAIS retirable à la main : effacer le fichier sans désinscrire
      // laisse une unité orpheline qui relance un binaire absent.
      expect(e!.retirable).toBe(false);
      expect(e!.consequence).toMatch(/service uninstall/);
    }
  });

  it('le chemin annoncé est CELUI QUE LE PLAN POSE', () => {
    // Deux vérités écrites à deux endroits divergent le jour où l'une bouge.
    // Ce test les confronte, pour les deux plateformes où le service vit dans
    // le dossier personnel.
    return import('../src/shared/empreinte.js').then(({ empreinte }) => {
      for (const plateforme of ['linux', 'darwin'] as const) {
        const dansEmpreinte = empreinte({
          racine: '/home/moi/hive',
          dbPath: '/home/moi/hive/data/hive.db',
          workdir: '/home/moi/hive/.hive-work',
          tmpdir: '/tmp',
          home: '/home/moi',
          plateforme,
        }).find((x) => x.cle === 'service')!.chemin;
        expect(dansEmpreinte, `${plateforme} : l’empreinte et le plan divergent`).toBe(
          plan({ plateforme }).fichier.chemin,
        );
      }
    });
  });
});

describe('LE RENDU DES GESTES — la branche qu’un test ne peut pas exercer', () => {
  // Lancer un vrai `service uninstall` DÉSINSTALLERAIT le service de qui fait
  // tourner la suite. La branche « cette commande a échoué » est donc
  // inatteignable de bout en bout — et la loupe l'a signalée, à juste titre.
  //
  // Extraire le rendu est la seule façon de la couvrir sans toucher à la
  // machine de quelqu'un.
  it('marque ce qui a abouti, et ce qui n’a pas abouti', () => {
    expect(rendreGestes([{ code: 0, quoi: 'systemctl --user disable' }])).toEqual([
      '  ✔ systemctl --user disable',
    ]);
    expect(rendreGestes([{ code: 1, quoi: 'systemctl --user disable' }])).toEqual([
      '  · systemctl --user disable',
    ]);
  });

  it('rend une ligne par geste, dans l’ordre', () => {
    expect(
      rendreGestes([
        { code: 0, quoi: 'a' },
        { code: 5, quoi: 'b' },
        { code: 0, quoi: 'c' },
      ]),
    ).toEqual(['  ✔ a', '  · b', '  ✔ c']);
  });

  it('aucun geste, aucune ligne', () => {
    expect(rendreGestes([])).toEqual([]);
  });

  it('un journal ILLISIBLE n’est pas un journal vide', () => {
    // Les codes de sortie sont une interface publique : une supervision doit
    // pouvoir distinguer « rien à lire » de « je n'ai pas pu lire ». Selon la
    // machine, `journalctl` réussit, échoue faute de bus de session, ou
    // n'existe pas — d'où une fonction pure plutôt qu'un test de bout en bout
    // qui serait vrai ici et faux ailleurs.
    expect(codeJournal(0, 1)).toBe(0);
    expect(codeJournal(1, 1)).toBe(1);
    expect(codeJournal(-1, 1)).toBe(1);
    expect(codeJournal(127, 1)).toBe(1);
  });
});

describe('`hive service` LANCÉ POUR DE VRAI', () => {
  // Le plan et son exécution sont éprouvés au-dessus, contre un système
  // simulé. Ceci vérifie le CÂBLAGE et — surtout — le contrat de codes de
  // sortie, qui est ce qu'un script d'installation regarde.
  //
  // `process.execPath`, pas `npx` : sous Windows, `npx` est `npx.cmd`, que Node
  // refuse d'exécuter sans shell (§ 6.2, déjà payé deux fois).
  const lancer = (args: string[]): { code: number; sortie: string } => {
    try {
      const sortie = execFileSync(
        process.execPath,
        ['--import', 'tsx', 'src/cli.ts', 'service', ...args],
        {
          cwd: fileURLToPath(new URL('..', import.meta.url)),
          encoding: 'utf8',
          env: { ...process.env, NO_COLOR: '1' },
        },
      );
      return { code: 0, sortie };
    } catch (e) {
      const err = e as { status?: number; stdout?: string; stderr?: string };
      return { code: err.status ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
    }
  };

  it('`install` SANS NIVEAU sort en 3, et dit les deux options', () => {
    // Le contrat de l'ADR 0004 : « son absence est une erreur de code 3, pas un
    // défaut silencieux ». `3` est `REPONSE_MANQUANTE` dans `codes-sortie.ts` —
    // un script d'installation peut donc distinguer « il te manque une
    // réponse » de « ça a planté », ce qui appelle des gestes différents.
    const r = lancer(['install']);
    expect(r.code, r.sortie).toBe(3);
    expect(r.sortie).toMatch(/--utilisateur/);
    expect(r.sortie).toMatch(/--systeme/);
    // Et la limite de systemd --user est dite AVANT, pas après.
    expect(r.sortie).toMatch(/enable-linger/);
  });

  it('un niveau inconnu sort en 3 lui aussi', () => {
    const r = lancer(['install', '--niveau=nimportequoi']);
    expect(r.code, r.sortie).toBe(3);
    expect(r.sortie).toMatch(/utilisateur.*systeme|systeme.*utilisateur/s);
  });

  it('`status` ne pose RIEN et n’exige aucun niveau', () => {
    // Regarder ne demande pas de décision. Un `status` qui refuserait de
    // répondre sans drapeau serait une porte fermée sur un diagnostic.
    const r = lancer(['status']);
    expect(r.code, r.sortie).toBe(0);
    expect(r.sortie).toMatch(/aucun fichier de service|fichier de service posé/);
  });

  it('une sous-commande inconnue rend l’usage', () => {
    const r = lancer(['farfelu']);
    expect(r.code).toBe(1);
    expect(r.sortie).toMatch(/install \| status \| logs \| uninstall/);
  });
});

describe('CE QUI N’EST PAS VÉRIFIÉ ICI, ET QUI LE SAIT', () => {
  it('aucun vrai service n’est installé par cette suite', () => {
    // Une CI n'a ni bus de session systemd, ni session graphique launchd, ni
    // envie qu'on inscrive une tâche dans son planificateur. Le dire à voix
    // haute vaut mieux que de laisser croire à une couverture qu'on n'a pas.
    //
    // Ce qui reste non éprouvé, et qu'il faudra une machine réelle pour dire :
    //   · qu'un `systemctl --user enable --now` accepte cette unité ;
    //   · que `launchctl load -w` accepte ce plist ;
    //   · que `schtasks /Create /XML` accepte ce document.
    //
    // La forme est vérifiée ; l'acceptation ne l'est pas.
    expect(path.isAbsolute(plan().fichier.chemin)).toBe(true);
  });
});

describe('LES OCTETS ÉCRITS DISENT CE QUE LE DOCUMENT DÉCLARE', () => {
  // ─── UNE GARDE D'UNE AUTRE NATURE QUE LES QUARANTE AUTRES ──────────────────
  //
  // Tous les tests de ce fichier lisent le PLAN — une structure en mémoire. Le
  // défaut vivait entre le plan et le disque : le XML Windows déclarait
  // `encoding="UTF-16"` et `SYSTEME.ecrire` faisait `writeFileSync(chemin,
  // contenu)`, donc de l'UTF-8 sans marque d'ordre.
  //
  // Un analyseur XML conforme — celui du planificateur de tâches en est un —
  // refuse un flux dont les octets contredisent la déclaration :
  // `schtasks /Create /XML` sortait en erreur, aucune tâche n'était inscrite, et
  // la ruche ne redémarrait jamais à l'ouverture de session. Sur la seule des
  // trois plateformes où personne ici ne peut l'essayer à la main.
  //
  // Cette garde-ci écrit POUR DE VRAI et relit les octets. C'est la seule façon
  // de voir un désaccord entre une déclaration et un encodage.

  const bac = mkdtempSync(path.join(os.tmpdir(), 'hive-service-'));

  /** Écrit un plan par le vrai `SYSTEME` et rend les octets bruts. */
  function octetsEcrits(p: Plan): Buffer {
    const chemin = path.join(bac, path.basename(p.fichier.chemin));
    SYSTEME.ecrire(chemin, p.fichier.contenu, p.fichier.mode, p.fichier.encodage);
    return readFileSync(chemin);
  }

  for (const [plateforme, attendu] of [
    ['win32', 'utf16le'],
    ['darwin', 'utf8'],
    ['linux', 'utf8'],
  ] as const) {
    it(`${plateforme} : le plan annonce « ${attendu} », et les octets le sont`, () => {
      const p = planifier(base({ plateforme, niveau: 'utilisateur' }));
      expect(p.genre, `plan refusé sur ${plateforme}`).toBe('plan');
      if (p.genre !== 'plan') return;
      expect(p.fichier.encodage).toBe(attendu);

      const octets = octetsEcrits(p);
      const bom = octets.subarray(0, 2);
      if (attendu === 'utf16le') {
        // `FF FE` n'est pas décoratif : sans lui, le planificateur ne sait pas
        // dans quel sens lire les paires d'octets.
        expect([...bom], 'marque d’ordre UTF-16LE absente').toEqual([0xff, 0xfe]);
        expect(octets.subarray(2).toString('utf16le')).toBe(p.fichier.contenu);
      } else {
        expect([...bom], 'aucune marque d’ordre attendue en UTF-8').not.toEqual([0xff, 0xfe]);
        expect(octets.toString('utf8')).toBe(p.fichier.contenu);
      }
    });
  }

  it('LA DÉCLARATION DU XML ET L’ENCODAGE RÉEL SONT D’ACCORD', () => {
    // ─── LA GARDE GÉNÉRALE, celle qui vaut pour les prochains plans ─────────
    //
    // Elle ne connaît pas Windows : elle lit ce que le document DIT de
    // lui-même et le confronte aux octets. Le même désaccord, sur une
    // plateforme qu'on ajouterait demain, rougirait ici sans qu'on y touche.
    for (const plateforme of ['win32', 'darwin', 'linux'] as const) {
      const p = planifier(base({ plateforme, niveau: 'utilisateur' }));
      if (p.genre !== 'plan') continue;
      const declare = /<\?xml[^>]*encoding="([^"]+)"/i.exec(p.fichier.contenu)?.[1];
      if (declare === undefined) continue; // ni systemd ni un plist ne déclarent rien
      const normalise = declare.toLowerCase().replace('-', '');
      expect(
        p.fichier.encodage === 'utf16le' ? 'utf16' : 'utf8',
        `${plateforme} : le document déclare « ${declare} » et le plan écrit en « ${p.fichier.encodage} »`,
      ).toBe(normalise);
    }
  });
});

describe('avant de poser — on ne pose rien quand le plan refuse', () => {
  // ─── LE DERNIER SURVIVANT DU BALAYAGE DE `src/cli.ts` ────────────────────────
  //
  // La commande de service décidait sur place, dans un fichier qui n'exporte
  // rien : `if (avant.genre === 'refus') return dire(avant)`. Muté en `!==`,
  // aucune assertion ne bougeait, et les deux sens sont graves.
  //
  // C'est le seul des neuf qui ne soit pas de l'affichage : ce qui suit cette
  // ligne POSE UN FICHIER DE SERVICE sur la machine.

  it('UN REFUS NE POSE RIEN, et son motif remonte tel quel', () => {
    // Le refus le plus parlant est celui des caractères de contrôle : le motif
    // dit que la valeur AJOUTERAIT une directive au fichier d'unité. Passer
    // outre écrirait précisément ce fichier-là.
    const suite = avantDePoser({ genre: 'refus', motif: 'contient un caractère de contrôle' });

    expect(suite.poser, 'un refus ne pose rien').toBe(false);
    expect(suite.poser === false && suite.motif).toContain('caractère de contrôle');
  });

  it('UN PLAN VALIDE POSE, et rend SES avertissements — pas `undefined`', () => {
    // L'autre sens du mutant : un plan valide pris pour un refus. `dire` aurait
    // affiché le `motif` d'un objet qui n'en a pas, c'est-à-dire « undefined »,
    // et l'installation n'aurait jamais eu lieu.
    const plan = {
      genre: 'plan',
      nom: 'hive.service',
      fichier: { chemin: '/tmp/hive.service', contenu: '', mode: 0o644 },
      installer: [],
      desinstaller: [],
      statut: { bin: 'systemctl', args: [] },
      journal: { bin: 'journalctl', args: [] },
      avertissements: [AVERTISSEMENT_LINGER],
    } as unknown as Plan;

    const suite = avantDePoser(plan);

    expect(suite.poser, 'un plan valide doit poser').toBe(true);
    expect(suite.poser === true && suite.avertissements).toEqual([AVERTISSEMENT_LINGER]);
  });

  it('un plan SANS avertissement pose quand même — la liste vide n’est pas un refus', () => {
    const plan = { genre: 'plan', avertissements: [] } as unknown as Plan;
    const suite = avantDePoser(plan);

    expect(suite.poser).toBe(true);
    expect(suite.poser === true && suite.avertissements).toEqual([]);
  });

  it('LA CHAÎNE COMPLÈTE : un contexte hostile ne pose rien', () => {
    // Bout à bout avec le vrai `planifier`, sur l'entrée qui l'a fait naître —
    // sans quoi on n'éprouverait que le branchement, jamais son emploi.
    const hostile: Contexte = {
      racine: '/home/x/hive\nExecStart=/bin/sh',
      home: '/home/x',
      execNode: '/usr/bin/node',
      plateforme: 'linux',
      niveau: 'utilisateur',
    } as unknown as Contexte;

    const suite = avantDePoser(planifier(hostile));
    expect(suite.poser, 'un retour à la ligne dans la racine ne pose pas de service').toBe(false);
  });
});
