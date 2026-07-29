// Les Chantiers — les travaux que le dépôt DÉCLARE, et que la ruche peut lancer.
//
// ─── LE BESOIN ───────────────────────────────────────────────────────────────
//
// Une ouvrière produit un diff. Il passe en revue humaine. Entre les deux,
// personne ne demande au PROJET ce qu'il pense de ce diff — alors que le projet
// le dit lui-même, dans ses propres commandes : `npm test`, `npm run lint`,
// `npm run typecheck`. La ruche doit pouvoir les lancer, en local comme sur
// GitHub, et rapporter ce qu'elles répondent.
//
// ─── LA FRONTIÈRE, QUI N'EST PAS NÉGOCIABLE ──────────────────────────────────
//
// **La ruche CHOISIT dans ce que le dépôt déclare. Elle n'invente jamais une
// commande.** C'est la même règle que `preparation.ts` — « la préparation
// installe ce que le DÉPÔT déclare, jamais ce que la COMMANDE nomme » — et ce
// n'est pas une précaution théorique : deux failles réelles ont été fermées pour
// l'établir (voir `commande-test.ts`, où `["/bin/sh","-c","curl … | sh"]`
// s'exécutait sur la machine d'un membre, `shell: false` n'y pouvant rien
// puisque `argv[0]` EST le binaire).
//
// Ici, la conséquence est directe : on ne prend PAS une commande en entrée. On
// prend un NOM DE SCRIPT, et on vérifie qu'il figure dans le `package.json` du
// dépôt. Un nom absent est refusé — pas exécuté « au cas où ».
//
// ─── POURQUOI LES SCRIPTS, ET PAS LES WORKFLOWS GITHUB ───────────────────────
//
// Un `.github/workflows/*.yml` décrit des étapes pour les runners de GitHub :
// des `uses:` d'actions tierces, des matrices, des variables de contexte. Le
// rejouer localement demanderait de réimplémenter GitHub Actions — et de le
// faire mal, donc de rapporter des verts qui ne veulent rien dire.
//
// Les scripts de `package.json`, eux, sont ce que le projet lance VRAIMENT, et
// c'est d'ailleurs ce que ses propres workflows appellent. On lance donc les
// scripts en local, et sur GitHub on lance les workflows PAR L'API — chacun
// exécuté par qui sait l'exécuter.
//
// Module PUR : aucune I/O. Il lit un manifeste déjà chargé et rend des
// décisions.

import { champSurUneLigne } from './donnees-non-fiables.js';

/** Ce qu'un chantier fait, une fois qu'on a regardé son nom. */
export type Nature =
  /** Vérifie sans rien changer d'extérieur : test, lint, typage, build. */
  | 'verification'
  /** Sort du poste : publier, déployer, taguer. Jamais automatique. */
  | 'sortant'
  /** Ni l'un ni l'autre de façon sûre — on ne devine pas. */
  | 'inconnu';

export interface Chantier {
  /** Le nom du script, tel que le dépôt l'écrit. */
  readonly nom: string;
  readonly nature: Nature;
  /** La commande du script, pour que l'humain voie ce qu'il lance. */
  readonly commande: string;
  /** Vrai si la ruche peut le lancer d'elle-même. */
  readonly automatisable: boolean;
}

/**
 * Les noms qui vérifient. Comparés au PREMIER segment, par égalité.
 *
 * Un nom de script se lit en segments (`test:unit`, `lint-css`, `build.node`),
 * et le premier dit ce que le script FAIT — les suivants le précisent. L'égalité
 * sur segment plutôt que le préfixe sur la chaîne évite d'un coup les deux
 * erreurs symétriques : `testament` n'est pas un test, `deployeur` n'est pas un
 * déploiement.
 */
const VERIFIE = ['test', 'tests', 'lint', 'typecheck', 'tsc', 'build', 'check', 'verify', 'audit'];

/**
 * Les noms qui SORTENT de la machine.
 *
 * Ceux-là ne sont jamais automatisables, quel que soit le réglage d'autonomie.
 * Publier un paquet ou déployer un service est IRRÉVERSIBLE et VISIBLE DE
 * L'EXTÉRIEUR : c'est exactement la famille de gestes que le dépôt réserve à un
 * humain, au même titre que « jamais de fusion sans revue humaine ».
 *
 * Le doute profite à cette liste : mieux vaut refuser un `release:notes`
 * inoffensif que lancer un `release` qui pousse un tag.
 */
const SORT = [
  'publish',
  'deploy',
  'release',
  'push',
  'prepublish',
  'prepublishonly',
  'postpublish',
  'start',
  'serve',
];

/**
 * Les segments d'un nom de script, en minuscules.
 *
 * `build:publish` → `['build', 'publish']`. C'est ce découpage qui rend la
 * précédence ci-dessous ATTEIGNABLE — voir le commentaire de `nature`.
 */
function segments(nom: string): string[] {
  return nom
    .toLowerCase()
    .split(/[:\-._]/)
    .filter((x) => x !== '');
}

/**
 * Ce que fait ce script, d'après son nom.
 *
 * ─── POURQUOI ON NE LIT PAS LA COMMANDE ──────────────────────────────────────
 *
 * Il serait tentant de classer d'après ce que le script CONTIENT (« il appelle
 * `npm publish`, donc il sort »). C'est une analyse de chaîne sur du shell
 * arbitraire, et elle se contourne trivialement : `sh -c "$(echo cHVibGlzaA== |
 * base64 -d)"`. Une garde qu'on peut contourner en une ligne donne la confiance
 * d'une garde sans en être une.
 *
 * Le nom, lui, est ce que l'AUTEUR DU DÉPÔT a écrit pour ses collègues. Il peut
 * mentir, mais alors il ment aussi aux humains du projet — et ce n'est plus à
 * la ruche de rattraper ça. Ce qui protège vraiment, c'est que rien ne sort de
 * la liste `SORT` sans un humain.
 */
export function nature(nom: string): Nature {
  const parts = segments(nom);
  // ─── LA PRÉCÉDENCE, ET POURQUOI ELLE A DÛ DEVENIR ATTEIGNABLE ─────────────
  //
  // « Sortant » l'emporte : entre deux lectures possibles, on garde celle qui
  // demande un humain.
  //
  // La première version comparait les deux listes au DÉBUT du nom. La règle
  // était donc morte — aucun nom ne peut commencer par deux mots à la fois, et
  // la loupe l'a tuée sans faire rougir un test. Ce n'était pas qu'une ligne
  // inutile : `build:publish` était classé « vérification », donc AUTOMATISABLE.
  // Un script qui publie, lancé sans humain.
  //
  // « Sortant » regarde donc N'IMPORTE QUEL segment — le doute profite à la
  // liste qui exige un humain — tandis que « vérification » ne regarde que le
  // premier, celui qui dit ce que le script fait.
  if (parts.some((p) => SORT.includes(p))) return 'sortant';
  if (parts.length > 0 && VERIFIE.includes(parts[0]!)) return 'verification';
  return 'inconnu';
}

/** Longueur au-delà de laquelle un nom de script n'est plus un nom. */
const NOM_MAX = 100;

/**
 * Un nom de script utilisable.
 *
 * ─── POURQUOI CETTE VALIDATION EXISTE MÊME AVEC `shell: false` ───────────────
 *
 * `spawn('npm', ['run', nom], { shell: false })` ne laisse pas un nom hostile
 * devenir une commande : c'est tout l'objet de la contrainte § 5.1. Mais le nom
 * ne s'arrête pas là — il traverse le protocole, un événement, un écran, et un
 * journal. Un nom contenant un saut de ligne y fabrique une fausse entrée.
 *
 * Et surtout, `npm run` a ses PROPRES arguments : un nom commençant par `-`
 * serait lu par npm comme un drapeau, pas comme un script. C'est exactement la
 * famille d'erreur du § 1.3 (`npm run install:hive --dry-run`, où npm garde le
 * drapeau pour lui).
 */
const NOM_VALIDE = /^[A-Za-z0-9][A-Za-z0-9:_.-]*$/;

export type Verdict = { readonly ok: true } | { readonly ok: false; readonly motif: string };

/**
 * Ce dépôt déclare-t-il ce chantier, et la ruche peut-elle le lancer seule ?
 *
 * `scripts` est le bloc du `package.json` du DÉPÔT CONNECTÉ — pas celui de la
 * ruche. C'est lui la source de vérité, et c'est pour ça que le nom doit y
 * figurer : la ruche choisit dans une liste qu'elle n'a pas écrite.
 */
export function jugerChantier(
  scripts: Readonly<Record<string, string>>,
  nom: string,
  intentionHumaine = false,
): Verdict {
  if (!NOM_VALIDE.test(nom) || nom.length > NOM_MAX) {
    return {
      ok: false,
      motif:
        `« ${champSurUneLigne(nom, 80)} » n’est pas un nom de script utilisable. ` +
        'Lettres, chiffres, et « : _ . - » seulement, en commençant par une ' +
        'lettre ou un chiffre — un nom qui commence par « - » serait lu par npm ' +
        'comme un drapeau, pas comme un script.',
    };
  }

  if (!Object.prototype.hasOwnProperty.call(scripts, nom)) {
    const proposes = Object.keys(scripts).slice(0, 12).join(', ');
    return {
      ok: false,
      motif:
        `Le dépôt ne déclare aucun script « ${nom} ». La ruche choisit dans ce ` +
        'que le dépôt déclare, elle n’invente pas de commande. ' +
        (proposes === '' ? 'Ce dépôt n’en déclare aucun.' : `Déclarés : ${proposes}.`),
    };
  }

  const n = nature(nom);
  if (n === 'sortant' && !intentionHumaine) {
    return {
      ok: false,
      motif:
        `« ${nom} » sort de la machine (publier, déployer, démarrer un service). ` +
        'Ces gestes sont irréversibles et visibles de l’extérieur : ils demandent ' +
        'un humain, comme la fusion. La ruche peut le proposer, pas le lancer.',
    };
  }

  return { ok: true };
}

/**
 * L'argv à lancer, en TABLEAU — jamais une chaîne.
 *
 * Le tableau est ce qui fait tenir `shell: false` : rien n'est redécoupé par un
 * interpréteur. `--` sépare les arguments de npm de ceux du script, pour la
 * raison exacte du § 1.3 — sans lui, npm garde les drapeaux pour lui.
 */
export function argvDe(nom: string, arguments_: readonly string[] = []): string[] {
  return arguments_.length > 0 ? ['npm', 'run', nom, '--', ...arguments_] : ['npm', 'run', nom];
}

/**
 * Les chantiers d'un dépôt, classés, dans un ordre TOTAL.
 *
 * L'ordre est alphabétique et non celui du `package.json` : deux ruches
 * regardant le même dépôt doivent proposer la même liste, et l'ordre des clés
 * d'un objet JSON dépend de qui l'a écrit.
 */
export function chantiersDe(scripts: Readonly<Record<string, string>>): Chantier[] {
  return Object.keys(scripts)
    .filter((nom) => NOM_VALIDE.test(nom) && nom.length <= NOM_MAX)
    .sort((a, b) => a.localeCompare(b))
    .map((nom) => {
      const n = nature(nom);
      return {
        nom,
        nature: n,
        // La commande est AFFICHÉE, donc c'est une donnée : elle vient du
        // dépôt, et un `\n` dedans casserait la ligne qui la présente.
        commande: champSurUneLigne(scripts[nom] ?? '', 300),
        automatisable: n === 'verification',
      };
    });
}
