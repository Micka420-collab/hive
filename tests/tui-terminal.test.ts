// Le terminal, éprouvé avec un faux clavier.
//
// ─── CE QUE CE FICHIER GARDE ─────────────────────────────────────────────────
//
// Le mode brut ne se teste pas sur un vrai terminal dans une CI. Il se teste
// en INJECTANT les flux, ce que `creerTerminal` permet — et c'est la raison
// pour laquelle il les prend en paramètre plutôt que de lire `process`.
//
// Deux propriétés valent tout le fichier :
//
//   1. LE TERMINAL EST TOUJOURS RENDU. Mode brut coupé, curseur réaffiché,
//      écouteur retiré — après un choix, après un ^C, après une exception. Un
//      installeur qui laisse un terminal en mode brut oblige quelqu'un à taper
//      `reset` à l'aveugle dans un shell devenu muet.
//
//   2. HORS TERMINAL, RIEN N'EST DEVINÉ. Pas de réponse possible et pas de
//      défaut documenté ⇒ erreur nommée, code 3. Un choix silencieux dans une
//      CI est un choix que personne n'a fait et que personne ne verra.

import { describe, expect, it } from 'vitest';
import { CODE } from '../src/codes-sortie.js';
import {
  Interrompu,
  decouper,
  ReponseManquante,
  creerTerminal,
  deplacer,
  toucheDe,
  type FluxEntree,
  type FluxSortie,
} from '../src/tui/terminal.js';

const CHOIX = [
  { libelle: 'Ouvrir ma propre ruche' },
  { libelle: 'Rejoindre une ruche' },
  { libelle: 'Installer sur un serveur' },
];

/** Un clavier de test : on lui « tape » des séquences d'octets. */
class Clavier implements FluxEntree {
  isTTY = true;
  brut = false;
  reprises = 0;
  pauses = 0;
  private gestionnaires: Array<(d: Buffer | string) => void> = [];

  setRawMode(actif: boolean): void {
    this.brut = actif;
  }
  on(_e: 'data', g: (d: Buffer | string) => void): void {
    this.gestionnaires.push(g);
  }
  off(_e: 'data', g: (d: Buffer | string) => void): void {
    this.gestionnaires = this.gestionnaires.filter((x) => x !== g);
  }
  resume(): void {
    this.reprises++;
  }
  pause(): void {
    this.pauses++;
  }

  taper(...sequences: string[]): void {
    for (const s of sequences) for (const g of [...this.gestionnaires]) g(s);
  }
  get branches(): number {
    return this.gestionnaires.length;
  }
}

/** Un écran de test : il retient tout ce qu'on lui écrit. */
class Ecran implements FluxSortie {
  ecrit = '';
  constructor(
    public isTTY = true,
    public columns = 100,
  ) {}
  write(texte: string): void {
    this.ecrit += texte;
  }
}

function terminal(clavier = new Clavier(), ecran = new Ecran()) {
  return {
    clavier,
    ecran,
    t: creerTerminal({ entree: clavier, sortie: ecran, env: { TERM: 'xterm-256color' } }),
  };
}

describe('les touches (fonction pure)', () => {
  it('une flèche n’est pas un caractère : les deux encodages sont reconnus', () => {
    // `ESC [ A` est l'usuel ; `ESC O A` sort des terminaux en mode
    // application (tmux, émulateurs anciens). N'en gérer qu'un laisse un menu
    // figé chez une partie des gens, sans message d'erreur.
    expect(toucheDe('\x1b[A')).toBe('haut');
    expect(toucheDe('\x1bOA')).toBe('haut');
    expect(toucheDe('\x1b[B')).toBe('bas');
    expect(toucheDe('\x1bOB')).toBe('bas');
  });

  it('les quatre façons de dire « laisse-moi sortir »', () => {
    for (const s of ['\x03', '\x04', '\x1b', 'q']) expect(toucheDe(s), s).toBe('annuler');
  });

  it('entrée, dans les deux fins de ligne', () => {
    expect(toucheDe('\r')).toBe('entree');
    expect(toucheDe('\n')).toBe('entree');
  });

  it('tout le reste est ignoré, jamais interprété au hasard', () => {
    for (const s of ['a', 'Z', '5', '\t', '\x1b[C', '\x1b[5~', '']) {
      expect(toucheDe(s), s).toBe('autre');
    }
  });
});

describe('UNE FLÈCHE COUPÉE EN DEUX RESTE UNE FLÈCHE', () => {
  // Le bug trouvé en lançant l'installeur pour de vrai, sur un terminal
  // simulé : les trois octets d'une flèche étaient arrivés séparément, et
  // l'`ESC` seul avait été lu comme « annuler ». L'installeur se FERMAIT au
  // lieu de descendre d'une ligne, et rien ne disait pourquoi.
  it('en un seul morceau', () => {
    expect(decouper('\x1b[B')).toEqual({ touches: ['bas'], reste: '' });
  });

  it('EN DEUX MORCEAUX : l’ESC est RETENU, pas pris pour une annulation', () => {
    const premier = decouper('\x1b');
    expect(premier.touches, 'un ESC seul ne décide de rien').toEqual([]);
    expect(premier.reste).toBe('\x1b');
    expect(decouper(premier.reste + '[B').touches).toEqual(['bas']);
  });

  it('en trois morceaux, un octet à la fois', () => {
    let reste = '';
    const vues: string[] = [];
    for (const octet of ['\x1b', '[', 'A']) {
      const r = decouper(reste + octet);
      reste = r.reste;
      vues.push(...r.touches);
    }
    expect(vues).toEqual(['haut']);
    expect(reste).toBe('');
  });

  it('plusieurs touches dans un seul morceau sont toutes vues', () => {
    // Une frappe rapide, ou un collage : rien ne doit être perdu.
    expect(decouper('\x1b[B\x1b[B\r').touches).toEqual(['bas', 'bas', 'entree']);
  });

  it('un ESC suivi d’autre chose reste une annulation', () => {
    expect(decouper('\x1bq').touches).toEqual(['annuler']);
  });

  it('LE RESTE EST RENDU BRUT, pas ré-encodé', () => {
    // Le défaut trouvé en lançant l'assistant : tout arrive en un morceau,
    // « \r ruche.exemple.fr \r ». Ré-encoder le reste en touches détruisait le
    // texte — un nom de domaine n'est pas une suite de flèches — et la
    // question suivante s'ouvrait sur du vide.
    const r = decouper('\rruche.exemple.fr\rautre-chose');
    expect(r.touches).toEqual(['entree']);
    expect(r.reste).toBe('ruche.exemple.fr\rautre-chose');
  });

  it('une séquence inconnue est CONSOMMÉE, pas gardée — sinon elle bloque', () => {
    expect(decouper('\x1b[C')).toEqual({ touches: [], reste: '' });
    expect(decouper('\x1b[C\r').touches).toEqual(['entree']);
  });

  it('^C reste instantané, sans attendre quoi que ce soit', () => {
    expect(decouper('\x03').touches).toEqual(['annuler']);
  });
});

describe('le curseur du menu (fonction pure)', () => {
  it('reste dans la liste, sans reboucler', () => {
    expect(deplacer(0, 'haut', 3)).toBe(0);
    expect(deplacer(2, 'bas', 3)).toBe(2);
    expect(deplacer(1, 'haut', 3)).toBe(0);
    expect(deplacer(1, 'bas', 3)).toBe(2);
  });

  it('une touche neutre ne bouge rien', () => {
    expect(deplacer(1, 'autre', 3)).toBe(1);
    expect(deplacer(1, 'entree', 3)).toBe(1);
  });

  it('une liste vide ne rend jamais un index hors bornes', () => {
    expect(deplacer(5, 'bas', 0)).toBe(0);
  });
});

describe('choisir, au clavier', () => {
  it('deux flèches et entrée mènent au troisième choix', async () => {
    const { clavier, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'le chemin d’entrée' });
    clavier.taper('\x1b[B', '\x1b[B', '\r');
    expect(await promesse).toBe(2);
  });

  it('MÊME QUAND LES OCTETS ARRIVENT COUPÉS — le cas qui fermait l’installeur', async () => {
    const { clavier, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    // Un octet à la fois, comme sur une liaison lente ou en SSH.
    clavier.taper('\x1b', '[', 'B', '\x1b', '[', 'B', '\r');
    expect(await promesse).toBe(2);
  });

  it('⏎ SEUL PREND LE PREMIER CHOIX — le défaut est le plus prudent', () => {
    // « Toute question a un défaut sûr » (§6.3). Le premier choix est
    // « ouvrir ma propre ruche », qui n'écrit rien avant récapitulatif.
    const { clavier, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    clavier.taper('\r');
    return expect(promesse).resolves.toBe(0);
  });

  it('LE TERMINAL EST RENDU APRÈS UN CHOIX', async () => {
    const { clavier, ecran, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    expect(clavier.brut, 'le mode brut doit être actif pendant la question').toBe(true);
    clavier.taper('\r');
    await promesse;
    expect(clavier.brut, 'mode brut laissé actif').toBe(false);
    expect(clavier.pauses, 'flux d’entrée laissé ouvert').toBeGreaterThan(0);
    expect(ecran.ecrit, 'curseur laissé caché').toContain('\x1b[?25h');
    expect(clavier.branches, 'écouteur de touches laissé branché').toBe(0);
  });

  it('^C REND LE TERMINAL AUSSI, et porte le code 130', async () => {
    const { clavier, ecran, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    clavier.taper('\x03');
    await expect(promesse).rejects.toBeInstanceOf(Interrompu);
    expect(clavier.brut).toBe(false);
    expect(ecran.ecrit).toContain('\x1b[?25h');
    expect(clavier.branches).toBe(0);
    await promesse.catch((e: Interrompu) => {
      // 130 = 128 + SIGINT. Un ^C qui rendrait 1 se confondrait avec un
      // échec, et un script de supervision réessaierait une installation que
      // quelqu'un venait d'annuler à la main.
      expect(e.code).toBe(CODE.INTERROMPU);
      expect(e.code).toBe(130);
    });
  });

  it('le menu est repeint sans empiler les écrans', async () => {
    const { clavier, ecran, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    clavier.taper('\x1b[B');
    clavier.taper('\r');
    await promesse;
    // Un repaint = remonter de N lignes puis effacer jusqu'en bas. Sans ça,
    // chaque flèche laisserait une copie du menu dans le scrollback.
    //
    // Le motif est CONSTRUIT plutôt qu'écrit en littéral : `no-control-regex`
    // interdit l'octet d'échappement dans une expression régulière, et il a
    // raison partout ailleurs.
    const ESC = String.fromCharCode(27);
    expect(ecran.ecrit).toMatch(new RegExp(`${ESC}\\[\\d+A${ESC}\\[0J`));
  });

  it('une touche sans effet ne repeint pas', async () => {
    const { clavier, ecran, t } = terminal();
    const promesse = t.choisir(CHOIX, { quoi: 'x' });
    const avant = ecran.ecrit.length;
    clavier.taper('\x1b[A'); // déjà en haut
    clavier.taper('z');
    const apres = ecran.ecrit.length;
    clavier.taper('\r');
    await promesse;
    expect(apres).toBe(avant);
  });
});

describe('hors terminal, rien n’est deviné', () => {
  function horsTerminal() {
    const clavier = new Clavier();
    clavier.isTTY = false;
    return terminal(clavier, new Ecran(false, 100));
  }

  it('SANS DÉFAUT DOCUMENTÉ, C’EST UNE ERREUR NOMMÉE DE CODE 3', async () => {
    const { t } = horsTerminal();
    await expect(t.choisir(CHOIX, { quoi: 'le chemin d’entrée' })).rejects.toBeInstanceOf(
      ReponseManquante,
    );
    await t.choisir(CHOIX, { quoi: 'le chemin d’entrée' }).catch((e: ReponseManquante) => {
      expect(e.code).toBe(CODE.REPONSE_MANQUANTE);
      expect(e.code).toBe(3);
      // Le message nomme la question : sans ça, écrire un script obligerait à
      // lire le code source pour savoir quoi fournir.
      expect(e.message).toContain('le chemin d’entrée');
    });
  });

  it('avec un défaut documenté, il est pris — et borné', async () => {
    const { t } = horsTerminal();
    expect(await t.choisir(CHOIX, { quoi: 'x', defautNonInteractif: 1 })).toBe(1);
    expect(await t.choisir(CHOIX, { quoi: 'x', defautNonInteractif: 99 })).toBe(2);
    expect(await t.choisir(CHOIX, { quoi: 'x', defautNonInteractif: -5 })).toBe(0);
  });

  it('AUCUNE SÉQUENCE ANSI N’EST ÉCRITE HORS TERMINAL', async () => {
    // C'est ce qui permet de rediriger l'installeur dans un fichier de log
    // sans le remplir de séquences illisibles.
    const { ecran, t } = horsTerminal();
    await t.choisir(CHOIX, { quoi: 'x', defautNonInteractif: 0 });
    t.ecrire(['une ligne', 'une autre']);
    expect(ecran.ecrit).not.toContain('\x1b');
    expect(ecran.ecrit).toContain('une ligne');
  });

  it('un terminal sans mode brut est traité comme un non-terminal', async () => {
    // `setRawMode` n'existe pas sur un flux qui n'est pas un TTY. Le supposer
    // présent ferait planter l'installeur au lieu de le dégrader.
    const clavier = new Clavier();
    const sansBrut = { ...clavier, setRawMode: undefined } as unknown as FluxEntree;
    const t = creerTerminal({ entree: sansBrut, sortie: new Ecran(true, 100), env: {} });
    expect(await t.choisir(CHOIX, { quoi: 'x', defautNonInteractif: 2 })).toBe(2);
  });
});

describe('demander une ligne', () => {
  function avecReponses(...reponses: string[]) {
    const donnees = [...reponses];
    const clavier = new Clavier();
    const ecran = new Ecran();
    const t = creerTerminal({
      entree: clavier,
      sortie: ecran,
      env: { TERM: 'xterm-256color' },
      lireLigne: async (q: string) => {
        ecran.write(q);
        return Promise.resolve(donnees.shift() ?? '');
      },
    });
    return { t, ecran };
  }

  it('rend la réponse, débarrassée des espaces', async () => {
    const { t } = avecReponses('  ruche.exemple.fr  ');
    expect(await t.demander('Domaine ?', { quoi: 'le domaine' })).toBe('ruche.exemple.fr');
  });

  it('⏎ SEUL PREND LE DÉFAUT, et le défaut est affiché', async () => {
    const { t, ecran } = avecReponses('');
    expect(await t.demander('Nom du tunnel ?', { quoi: 'le nom', defaut: 'hive' })).toBe('hive');
    expect(ecran.ecrit, 'le défaut doit être visible avant de valider').toContain('[hive]');
  });

  it('une réponse OBLIGATOIRE est redemandée plutôt qu’inventée', async () => {
    // Rendre une chaîne vide ferait porter la question au code appelant, qui
    // la traiterait mal une fois sur deux.
    const { t, ecran } = avecReponses('', '   ', 'enfin-une-reponse');
    expect(await t.demander('Domaine ?', { quoi: 'le domaine', obligatoire: true })).toBe(
      'enfin-une-reponse',
    );
    expect(ecran.ecrit).toContain('une réponse est nécessaire');
  });

  it('hors terminal : le défaut documenté, ou une erreur nommée', async () => {
    const clavier = new Clavier();
    clavier.isTTY = false;
    const t = creerTerminal({ entree: clavier, sortie: new Ecran(false, 100), env: {} });
    expect(await t.demander('Domaine ?', { quoi: 'le domaine', defaut: 'x' })).toBe('x');
    await expect(t.demander('Domaine ?', { quoi: 'le domaine' })).rejects.toBeInstanceOf(
      ReponseManquante,
    );
  });
});

describe('restaurer', () => {
  it('est sans effet quand il n’y a rien à restaurer, et se répète sans dommage', () => {
    const { clavier, ecran, t } = terminal();
    t.restaurer();
    t.restaurer();
    expect(ecran.ecrit).toBe('');
    expect(clavier.pauses).toBe(0);
  });

  it('une liste de choix vide est une erreur, pas un index inventé', async () => {
    const { t } = terminal();
    await expect(t.choisir([], { quoi: 'rien' })).rejects.toBeInstanceOf(ReponseManquante);
  });
});
