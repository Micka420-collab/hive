// Quand on DEMANDE quelque chose à la Reine, et qu'elle ne peut pas le faire.
//
// ─── LE DÉFAUT, DIT PAR L'UTILISATEUR ────────────────────────────────────────
//
// « elle me répond à côté ». La capture montrait la scène : quelqu'un demande
// de SUPPRIMER un projet, et reçoit un bilan d'activité — nombre de tâches,
// « 0 nœud(s) actif(s) ». Pas un refus, pas une explication : un hors-sujet.
//
// La cause est mécanique. `detectIntent` cherche des mots-clés de CONSULTATION
// (avancement, nœuds, courses, santé…) et, quand rien ne matche, retombe sur
// `help`, qui affiche un état général. Une demande d'ACTION ne ressemble à
// aucune question de consultation : elle tombe donc systématiquement dans ce
// dernier filet, et le filet répond à une question qu'on n'a pas posée.
//
// ─── CE QUE CE MODULE FAIT, ET CE QU'IL NE FERA JAMAIS ──────────────────────
//
// Il RECONNAÎT la demande, pour que la Reine puisse dire trois choses :
//
//   1. ce qu'elle a compris — sinon on ne sait pas si on a été entendu ;
//   2. qu'elle ne le fait PAS depuis la conversation ;
//   3. où le geste se trouve vraiment.
//
// Il ne donne AUCUN pouvoir d'exécution au fil de discussion, et c'est un choix
// tenu : le chat est en lecture seule. Un geste destructeur déclenché par une
// phrase — surtout par une phrase INTERPRÉTÉE — n'a pas de place ici. Le dépôt
// a déjà un mécanisme pour ça (`GesteIrreversible`, dans le tableau de bord) :
// il demande une confirmation explicite, sur l'objet nommé, à l'écran.
//
// Reconnaître n'est donc pas un premier pas vers exécuter. C'est l'inverse :
// c'est ce qui permet de REFUSER clairement, au lieu de changer de sujet.

/** Les gestes qu'on demande le plus souvent, et qu'aucun ne se fait ici. */
export type ActionDemandee =
  'supprimer' | 'creer' | 'renommer' | 'lancer' | 'arreter' | 'fusionner' | 'inviter';

/** Sans accents, en minuscules — même normalisation que le concierge. */
function normaliser(texte: string): string {
  return texte
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
}

/**
 * L'ORDRE COMPTE, et il est délibéré.
 *
 * Le premier motif qui matche gagne. `supprimer` vient en tête parce qu'une
 * phrase qui mêle deux verbes (« supprime ce projet et recrée-le ») doit être
 * lue sur son geste le plus lourd : c'est celui dont l'utilisateur a le plus
 * besoin d'entendre qu'il ne se fera pas tout seul.
 *
 * Les motifs commencent par une espace : la question est encadrée d'espaces
 * avant la comparaison, donc ils ne matchent qu'en DÉBUT de mot. Sans ça,
 * `cree` matcherait « décrée », « recrée », « accrédité ».
 */
const MOTIFS: readonly (readonly [ActionDemandee, readonly string[]])[] = Object.freeze([
  ['supprimer', [' supprim', ' efface', ' detrui', ' delete', ' remove', ' drop ']],
  ['arreter', [' arret', ' arrete', ' stopp', ' stop ', ' annul', ' cancel', ' kill ']],
  ['fusionner', [' fusionn', ' merge', ' rebase']],
  ['renommer', [' renomm', ' rename', ' rebaptis']],
  ['inviter', [' invit', ' ajoute un membre', ' add a member', ' exclu', ' revoqu', ' revoke']],
  ['creer', [' cree ', ' creer', ' cree-', ' nouveau projet', ' new project', ' create ']],
  ['lancer', [' lance ', ' lancer', ' demarre le', ' relance', ' run the', ' execute ']],
]);

/**
 * Les verbes qui ne posent JAMAIS une question sur la ruche.
 *
 * ─── POURQUOI CETTE SÉPARATION EXISTE ───────────────────────────────────────
 *
 * J'ai d'abord posé toute la détection en BOUT de chaîne, pour ne rien voler
 * aux questions de consultation. Mesuré, ça ne réparait pas le défaut :
 *
 *     progress  ← supprime le projet Rucher
 *     progress  ← delete this project
 *     progress  ← renomme ce projet
 *     action    ← supprime ça
 *
 * C'est le NOM qui décidait, pas le verbe : « projet » suffit à emporter la
 * question vers `progress`, « course » vers `races`. La phrase exacte de la
 * capture tombait donc encore dans le mauvais filet — mon correctif ne
 * réparait que les phrases sans complément.
 *
 * Ces cinq verbes passent donc AVANT. Les deux autres (`creer`, `lancer`)
 * restent en bout de chaîne, parce qu'ils appartiennent pour de bon au
 * vocabulaire de consultation : « aide-moi à créer un brief », « comment
 * lancer une course ? » sont des questions que le concierge sert déjà bien.
 *
 * ─── LE COMPROMIS, DIT PLUTÔT QUE CACHÉ ─────────────────────────────────────
 *
 * « pourquoi la tâche a été supprimée ? » sera lue comme une demande de
 * suppression. C'est un mauvais classement, et il est ASSUMÉ, parce que les
 * deux erreurs ne coûtent pas la même chose :
 *
 *   · lire une question comme une demande → la réponse NOMME ce qu'elle a
 *     compris, le lecteur voit le malentendu en une ligne, et rien n'est
 *     détruit ;
 *   · lire une demande comme une question → le bilan d'activité hors sujet,
 *     c'est-à-dire exactement le défaut qu'on répare.
 *
 * La réponse qui s'annonce est ce qui rend le premier supportable.
 */
const PRIORITAIRES: ReadonlySet<ActionDemandee> = new Set<ActionDemandee>([
  'supprimer',
  'arreter',
  'fusionner',
  'renommer',
  'inviter',
]);

/**
 * L'action à traiter AVANT les intentions de consultation, ou `null`.
 *
 * Le concierge l'appelle en tête de `detectIntent` ; `detecterAction` reste
 * appelée en queue pour les deux verbes ambigus.
 */
export function actionPrioritaire(question: string): ActionDemandee | null {
  const a = detecterAction(question);
  return a !== null && PRIORITAIRES.has(a) ? a : null;
}

/**
 * La demande d'action contenue dans ce message, ou `null`.
 *
 * `null` n'est pas « rien compris » : c'est « ce n'est pas une demande
 * d'action ». Le concierge continue alors son chemin habituel, et ce module
 * n'a rien changé pour les questions de consultation — c'est la condition pour
 * qu'il puisse être posé en bout de chaîne sans rien casser.
 */
export function detecterAction(question: string): ActionDemandee | null {
  const q = ` ${normaliser(question)} `;
  for (const [action, motifs] of MOTIFS) {
    if (motifs.some((m) => q.includes(m))) return action;
  }
  return null;
}

interface Formulation {
  /** Ce que la Reine dit avoir compris. */
  readonly compris: string;
  /** Où le geste se trouve vraiment. */
  readonly ou: string;
}

const FR: Readonly<Record<ActionDemandee, Formulation>> = Object.freeze({
  supprimer: {
    compris: 'supprimer quelque chose',
    ou: 'Le tableau de bord demande une confirmation explicite, sur l’objet nommé — c’est voulu : une suppression déclenchée par une phrase interprétée serait un mauvais marché.',
  },
  arreter: {
    compris: 'arrêter ou annuler un travail en cours',
    ou: 'Ouvrez la tâche dans le tableau de bord : le bouton d’annulation s’y trouve, avec ce qu’elle avait déjà produit.',
  },
  fusionner: {
    compris: 'fusionner du travail',
    ou: 'La fusion part de l’écran des tâches, une fois le diff relu.',
  },
  renommer: {
    compris: 'renommer quelque chose',
    ou: 'Le nom se change là où l’objet vit — fiche du projet, ou fiche de l’ouvrière pour un baptême.',
  },
  inviter: {
    compris: 'gérer qui entre dans la ruche',
    ou: 'Les billets d’invitation et les exclusions vivent dans l’écran d’équipe.',
  },
  creer: {
    compris: 'créer quelque chose',
    ou: 'La création se fait depuis l’écran des projets, ou depuis le champ de tâches d’un projet ouvert.',
  },
  lancer: {
    compris: 'lancer un travail',
    ou: 'Le lancement part de l’écran du projet, une fois les tâches posées.',
  },
});

const EN: Readonly<Record<ActionDemandee, Formulation>> = Object.freeze({
  supprimer: {
    compris: 'delete something',
    ou: 'The dashboard asks for an explicit confirmation, on the named object — deliberately: a deletion triggered by an interpreted sentence would be a bad bargain.',
  },
  arreter: {
    compris: 'stop or cancel work in progress',
    ou: 'Open the task in the dashboard: the cancel button is there, along with whatever it had already produced.',
  },
  fusionner: {
    compris: 'merge work',
    ou: 'Merging starts from the tasks screen, once the diff has been read.',
  },
  renommer: {
    compris: 'rename something',
    ou: 'A name is changed where the object lives — the project card, or the worker card for a naming.',
  },
  inviter: {
    compris: 'manage who joins the hive',
    ou: 'Invitation tickets and exclusions live in the team screen.',
  },
  creer: {
    compris: 'create something',
    ou: 'Creation happens from the projects screen, or from the task field of an open project.',
  },
  lancer: {
    compris: 'start work',
    ou: 'Starting happens from the project screen, once the tasks are in place.',
  },
});

/**
 * Ce que la Reine répond à une demande d'action.
 *
 * Trois phrases, dans cet ordre, et l'ordre est le message :
 *   · j'ai compris CECI — vous avez été entendu ;
 *   · je ne le fais pas d'ici — la limite, dite sans détour ;
 *   · voilà où c'est — vous n'êtes pas renvoyé les mains vides.
 *
 * Ce qu'elle ne fait pas : proposer de le faire quand même, ni demander
 * « voulez-vous que je… ». Une question de ce genre laisserait croire qu'un
 * « oui » suffirait, et il ne suffit pas.
 */
export function direAction(action: ActionDemandee, lang: 'fr' | 'en' = 'fr'): string {
  const f = (lang === 'en' ? EN : FR)[action];
  return lang === 'en'
    ? [
        `I understand you want to **${f.compris}**.`,
        'I cannot do it from this conversation: the chat reads the hive, it never changes it.',
        f.ou,
      ].join('\n\n')
    : [
        `Je comprends que vous voulez **${f.compris}**.`,
        'Je ne le fais pas depuis cette conversation : le fil de discussion LIT la ruche, il ne la modifie jamais.',
        f.ou,
      ].join('\n\n');
}
