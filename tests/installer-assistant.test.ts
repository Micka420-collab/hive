// L'assistant de fin d'installation, joué au clavier.
//
// ─── CE QUE CE FICHIER GARDE, ET POURQUOI IL N'EXISTAIT PAS ──────────────────
//
// « Machine nue → ruche qui tourne, **≤ 3 décisions** » est un critère du
// definition of done. Il n'a jamais rougi, pour une raison simple : le déroulé
// vivait dans `installer-main.ts`, qui appelle `main()` À L'IMPORT. Aucun test
// ne pouvait donc l'atteindre — l'importer aurait sondé des ports, écrit un
// `.env` et posé des questions au vide.
//
// Le défaut a vécu tout ce temps là-dedans. L'assistant posait une QUATRIÈME
// décision, sur un `.env` que l'installeur venait lui-même de créer, avec
// « Ne rien changer » pour défaut — donc valider au ⏎ **jetait le choix
// d'exposition fait à l'écran précédent**. Il a fallu un pseudo-terminal et six
// frappes pour le voir. Une mesure à la main, une fois, le jour où on y pense.
//
// Ce fichier remplace cette mesure par une garde. Le déroulé est le VRAI, avec
// un faux clavier, un faux écran et un faux scribe — la seule chose qui ne soit
// pas réelle est ce qui toucherait au disque.
//
// ─── LA PROPRIÉTÉ QUI PORTE LE FICHIER ───────────────────────────────────────
//
//   TROIS ARRÊTS SUR LE CHEMIN PAR DÉFAUT, ET LA CONFIRMATION REVIENT DÈS QUE
//   LA MACHINE S'OUVRE.
//
// Les deux moitiés comptent autant l'une que l'autre. Supprimer la question
// aurait « tenu » le critère en laissant l'installeur poser un `0.0.0.0` sans
// demander à personne — un critère tenu par un défaut de sécurité.

import { describe, expect, it } from 'vitest';
import type { ReglagePropose } from '../src/assistant.js';
import { assistant } from '../src/installer-assistant.js';
import { creerTerminal, type FluxEntree, type FluxSortie } from '../src/tui/terminal.js';

/** Un clavier de test : on lui « tape » des séquences d'octets. */
class Clavier implements FluxEntree {
  isTTY = true;
  private gestionnaires: Array<(d: Buffer | string) => void> = [];
  /** Ce qui reste à livrer, dans l'ordre où l'humain le taperait. */
  private file: string[] = [];

  constructor(...frappes: string[]) {
    this.file = frappes;
  }
  setRawMode(): void {
    /* rien à simuler : le mode brut est éprouvé par `tui-terminal.test.ts` */
  }
  on(_e: 'data', g: (d: Buffer | string) => void): void {
    this.gestionnaires.push(g);
    // Livrer À L'ABONNEMENT, une frappe à la fois. Tout envoyer d'un coup
    // marcherait aussi (le tampon vit dans le terminal), mais une frappe par
    // question reproduit ce qu'un humain fait vraiment — et c'est la forme
    // qui a révélé le défaut du tampon jeté entre deux questions.
    const suivante = this.file.shift();
    if (suivante !== undefined) queueMicrotask(() => g(suivante));
  }
  off(_e: 'data', g: (d: Buffer | string) => void): void {
    this.gestionnaires = this.gestionnaires.filter((x) => x !== g);
  }
  resume(): void {
    /* pas de flux réel à reprendre */
  }
  pause(): void {
    /* pas de flux réel à mettre en pause */
  }
}

class Ecran implements FluxSortie {
  ecrit = '';
  isTTY = true;
  columns = 100;
  write(texte: string): void {
    this.ecrit += texte;
  }
}

/** Le `.env` d'une ruche fraîchement installée, tel que l'installeur le pose. */
const REGLAGES = [
  { cle: 'HIVE_TOKEN', valeur: 'a'.repeat(32) },
  { cle: 'HIVE_JWT_SECRET', valeur: 'b'.repeat(64) },
  { cle: 'HIVE_PORT', valeur: '7777' },
];

/**
 * Joue l'assistant avec une suite de frappes, et rend ce qu'on veut savoir.
 *
 * `lignes` alimente `demander` (le domaine, le nom du projet). `touches`
 * alimente `choisir`. Les deux sont distincts parce que le terminal les lit
 * différemment — et confondre les deux est précisément ce qui rendait un
 * assistant impossible à piloter par script.
 */
async function jouer(opts: {
  touches: string[];
  lignes?: string[];
  neuf: boolean;
}): Promise<{ arrets: number; ecrits: ReglagePropose[]; ecran: string }> {
  const clavier = new Clavier(...opts.touches);
  const ecran = new Ecran();
  const restantes = [...(opts.lignes ?? [])];
  const t = creerTerminal({
    entree: clavier,
    sortie: ecran,
    env: { TERM: 'xterm-256color' },
    lireLigne: async (invite) => {
      ecran.write(invite);
      // ─── POURQUOI ÇA LÈVE PLUTÔT QUE DE RENDRE '' ──────────────────────────
      //
      // Écrit trouvé en le payant : la première version rendait `''` une fois
      // le script épuisé. Sur une question `obligatoire`, `demander` REDEMANDE
      // plutôt que d'inventer — c'est son rôle — et le faux clavier lui
      // fournissait donc un flux infini de réponses vides. Le test a tourné
      // quatre secondes puis a explosé sur « Invalid string length » : l'écran
      // de test avait dépassé la taille maximale d'une chaîne JavaScript.
      //
      // Un humain, lui, tape quelque chose ou fait ^C. Un script épuisé est un
      // BUG DU SCRIPT, et le dire tout de suite vaut mieux qu'une boucle qui
      // meurt d'épuisement mémoire quelques secondes plus tard.
      const ligne = restantes.shift();
      if (ligne === undefined) throw new Error('le script de frappes est épuisé');
      return ligne;
    },
  });
  const ecrits: ReglagePropose[] = [];
  const { arrets } = await assistant({
    t,
    bloc: (...morceaux) => ecran.write(morceaux.flat().join('\n')),
    caps: t.caps,
    reglages: REGLAGES,
    neuf: opts.neuf,
    scribe: (r) => ecrits.push(...r),
  });
  return { arrets, ecrits, ecran: ecran.ecrit };
}

/** Valider au ⏎ : le geste de quelqu'un qui fait confiance au programme. */
const ENTREE = '\r';
/** Descendre d'un cran dans un menu. */
const BAS = '\x1b[B';

describe('LE COMPTE DES ARRÊTS — le critère « ≤ 3 décisions »', () => {
  it('LE CHEMIN PAR DÉFAUT S’ARRÊTE DEUX FOIS, ET ÉCRIT', async () => {
    // Deux arrêts ICI — l'exposition et le nom du projet — auxquels s'ajoute
    // le choix du chemin d'entrée, posé par `installer-main.ts` avant
    // d'appeler l'assistant. Trois au total, et c'est la mesure relevée sous
    // un vrai pty : voir `docs/ETAPES.md`.
    const r = await jouer({ touches: [ENTREE], lignes: [''], neuf: true });
    expect(r.arrets, 'plus d’arrêts que l’accueil n’en promet').toBe(2);

    // ET LES RÉGLAGES SONT POSÉS. C'est l'autre moitié du défaut : la question
    // supprimée répondait « Ne rien changer » par défaut, donc valider au ⏎
    // jetait le choix fait juste avant.
    expect(r.ecrits.map((x) => x.cle)).toEqual(['HIVE_HOST', 'HIVE_CORS_ORIGIN']);
    expect(r.ecran).not.toContain('Rien écrit.');
  });

  it('…et les deux origines du dashboard y sont', async () => {
    // Le défaut jumeau : n'en lister qu'une interdisait l'adresse que
    // l'installeur affiche à l'écran suivant.
    const r = await jouer({ touches: [ENTREE], lignes: [''], neuf: true });
    const cors = r.ecrits.find((x) => x.cle === 'HIVE_CORS_ORIGIN')?.valeur ?? '';
    expect(cors.split(',')).toHaveLength(2);
  });

  it('NOMMER UN PROJET AJOUTE UN ARRÊT — et c’est un choix de l’humain', async () => {
    // « Machine nue → ruche qui tourne » s'arrête au `.env`. Nommer un projet
    // est au-delà du critère ; le carnet le dit plutôt que de le cacher.
    const r = await jouer({
      touches: [ENTREE],
      lignes: ['ma-ruche', ''],
      neuf: true,
    });
    expect(r.arrets).toBe(3);
    expect(r.ecran).toContain('npm run cli');
  });

  it('LE DÉPÔT TAPÉ SE RETROUVE DANS LA COMMANDE — pas jeté en route', async () => {
    // Le balayage du soir : `depot === '' ? undefined : depot` muté en `!==`
    // JETTE précisément ce que l'humain vient de taper — la commande
    // proposée crée alors un projet SANS dépôt, et l'avertissement « espace
    // vide » contredit la réponse qu'on vient de donner. Le seul cas testé
    // jusqu'ici était le ⏎ (dépôt vide), qui ne distingue pas les deux sens.
    const r = await jouer({
      touches: [ENTREE],
      lignes: ['ma-ruche', 'https://github.com/exemple/rucher'],
      neuf: true,
    });
    expect(r.ecran, 'la commande porte le dépôt répondu').toContain(
      'https://github.com/exemple/rucher',
    );
    expect(r.ecran, 'avec un dépôt, pas d’avertissement d’espace vide').not.toContain(
      'espace vide',
    );
  });
});

describe('LA CONFIRMATION REVIENT DÈS QUE LA MACHINE S’OUVRE', () => {
  it('« MON RÉSEAU LOCAL » DEMANDE, ET LE DÉFAUT N’ÉCRIT RIEN', async () => {
    // ─── CE QUE CE TEST EMPÊCHE ────────────────────────────────────────────
    //
    // Si la question sautait aussi ici, l'installeur poserait `0.0.0.0` — la
    // ruche écoutant sur toutes les interfaces — parce que quelqu'un a validé
    // trois fois de suite. Le critère « ≤ 3 décisions » serait tenu par un
    // défaut de sécurité, ce qui est la pire façon de le tenir.
    const r = await jouer({ touches: [BAS + ENTREE, ENTREE], lignes: [''], neuf: true });
    expect(r.arrets).toBe(3);
    expect(r.ecrits, 'un ⏎ ne doit pas ouvrir la machine').toEqual([]);
    expect(r.ecran).toContain('Rien écrit.');
    expect(r.ecran).toContain('EN CLAIR');
  });

  it('…et répondre « Poser ces réglages » écrit bien `0.0.0.0`', async () => {
    // La garde ne doit pas être un mur : l'humain qui le demande l'obtient.
    // Sans cette assertion, un assistant qui n'écrirait JAMAIS rien
    // satisferait le test précédent.
    const r = await jouer({
      touches: [BAS + ENTREE, BAS + ENTREE],
      lignes: [''],
      neuf: true,
    });
    expect(r.ecrits).toEqual([expect.objectContaining({ cle: 'HIVE_HOST', valeur: '0.0.0.0' })]);
  });

  it('UNE RELANCE SUR LE `.env` DE QUELQU’UN D’AUTRE DEMANDE TOUJOURS', async () => {
    // Même plan, même choix, `neuf: false` : on touche à un fichier qu'on n'a
    // pas écrit. Le récapitulatif redevient une question.
    const r = await jouer({ touches: [ENTREE, ENTREE], lignes: [''], neuf: false });
    expect(r.arrets).toBe(3);
    expect(r.ecrits).toEqual([]);
    expect(r.ecran).toContain('Rien écrit.');
  });

  it('UN TUNNEL DEMANDE, MÊME EN ÉCOUTANT SUR 127.0.0.1', async () => {
    // Le cas qui dicte la forme de `planOuvre`. Un tunnel laisse `HIVE_HOST`
    // sur la boucle locale — aucun port ouvert, c'est tout son intérêt — et
    // rend pourtant la ruche joignable depuis Internet. Un prédicat qui ne
    // regarderait que `HIVE_HOST` le classerait inoffensif, et l'installeur
    // publierait une ruche sur Internet sans demander.
    const r = await jouer({
      touches: [BAS + BAS + ENTREE, ENTREE],
      lignes: ['ruche.exemple.fr', ''],
      neuf: true,
    });
    expect(r.ecrits, 'un tunnel ne se pose pas sans un humain').toEqual([]);
    expect(r.ecran).toContain('cloudflared');
  });
});

describe('CE QUI EST REFUSÉ N’EST PAS ÉCRIT', () => {
  it('UN DOMAINE QUI N’EN EST PAS UN FAIT REFUSER, ET LE REFUS SE DIT', async () => {
    // ─── LE CHEMIN QU'ON CROYAIT TESTER, ET CELUI QU'ON TESTE ──────────────
    //
    // J'ai d'abord écrit ce test avec un domaine VIDE, pour viser le refus de
    // `planExposition`. Ce chemin est INATTEIGNABLE d'ici : la question du
    // domaine est `obligatoire`, donc le terminal redemande au lieu
    // d'accepter le vide — c'est précisément son rôle, et c'est bien ainsi.
    //
    // Le refus réellement atteignable par un humain est celui-ci : une
    // réponse qui n'est pas un nom d'hôte. (Le garde-fou du domaine vide
    // reste utile dans `planExposition`, qui est une fonction publique et ne
    // doit rien supposer de son appelant — `assistant.test.ts` l'exerce.)
    const r = await jouer({
      touches: [BAS + BAS + ENTREE],
      lignes: ['pas un domaine', ''],
      neuf: true,
    });
    expect(r.ecrits).toEqual([]);
    // Le refus est DIT. Un refus muet ferait croire à un succès.
    expect(r.ecran).toContain('nom de domaine');
    // Et il n'a coûté que ses deux arrêts : l'exposition, le domaine, puis le
    // projet — aucune confirmation pour un plan qui ne pose rien.
    expect(r.arrets).toBe(3);
  });
});
