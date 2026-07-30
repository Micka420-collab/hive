// L'ATELIER — un bureau que l'ouvrière peut allumer. MODULE PUR.
//
// Voir `docs/adr/0008-l-atelier-un-bureau-pour-l-ouvriere.md` pour le pourquoi.
// Ici : le QUOI, calculé et jamais exécuté.
//
// ─── LE MANQUE QUE ÇA COMBLE ─────────────────────────────────────────────────
//
// L'agent travaille en aveugle. Il écrit des fichiers, la ruche calcule un diff,
// et il ne peut pas ouvrir son propre travail : ni lancer le serveur de
// développement et regarder la page, ni cliquer dans son interface, ni lire une
// erreur qui n'apparaît qu'au navigateur, ni itérer sur du visuel.
//
// Aucune quantité de tests ne comble ça : **un test vérifie ce qu'on a pensé à
// vérifier.** Un écran montre ce qu'on n'avait pas prévu.
//
// ─── POURQUOI CE MODULE NE LANCE RIEN ────────────────────────────────────────
//
// C'est la première fonctionnalité du dépôt qui donne à un agent un ordinateur,
// un écran, un navigateur et le réseau. Tout le reste a été bâti pour
// RESTREINDRE ce qu'une ouvrière atteint ; celle-ci ouvre.
//
// Les garde-fous sont donc dans une fonction PURE, qui rend un `argv`. Chaque
// refus, chaque borne, chaque secret retiré devient une assertion — sans démarrer
// un conteneur, sur les trois plateformes, depuis n'importe laquelle. C'est
// exactement ce qui manquait à la branche Windows de la détection d'agent
// pendant des mois (§ 6.3 du journal).

/** Les moteurs de conteneur qu'on sait piloter. Rien d'autre. */
export type Moteur = 'docker' | 'podman';

/** L'image du bureau. Construite depuis `docker/atelier/Dockerfile`. */
export const IMAGE_ATELIER = 'hive-atelier:local';

/**
 * La politique réseau du bureau — décision 1 de l'ADR 0008.
 *
 * `ferme` est le défaut, et c'est DOULOUREUX : un bureau sans réseau ne peut pas
 * `npm install`. On l'assume quand même, parce que l'inverse — un agent qui
 * atteint n'importe quoi et peut y envoyer ce qu'il a lu du dépôt — ne se
 * rattrape pas après coup.
 *
 * `ouvert` existe, s'annonce, et n'est jamais choisi tout seul.
 */
export type Reseau = 'ferme' | 'ouvert';

export interface VoeuAtelier {
  readonly moteur: Moteur | null;
  /** Le dossier de travail de la tâche, monté dans le bureau. */
  readonly travail: string;
  /** Nom du conteneur — sert à le retrouver pour l'arrêter. */
  readonly nom: string;
  /** Port local d'où l'écran se regarde. Lié à 127.0.0.1, jamais à 0.0.0.0. */
  readonly port: number;
  readonly reseau?: Reseau;
  /** Mémoire maximale. Un bureau qui gonfle ne doit pas emporter la machine. */
  readonly memoire?: string;
}

/** Ce qu'on peut lancer — ou la raison de ne pas le faire. */
export type Plan =
  | { readonly ok: true; readonly bin: string; readonly argv: readonly string[] }
  | { readonly ok: false; readonly raison: string };

/** Bornes par défaut. Généreuses pour un navigateur, fatales pour une fuite. */
const MEMOIRE_DEFAUT = '2g';
const PROCESSUS_MAX = '512';

/**
 * L'environnement que le bureau reçoit : une liste d'AUTORISATION.
 *
 * ─── POURQUOI L'INVERSE DE LA SONDE ──────────────────────────────────────────
 *
 * `envSonde` (agent-detect.ts) retire des secrets nommés et laisse passer le
 * reste, parce qu'une sonde a besoin du PATH, de `SystemRoot`, de `PATHEXT`…
 * en oublier un ferait échouer la détection.
 *
 * Un bureau n'a besoin de RIEN de tout ça : l'image fournit son propre PATH, son
 * propre HOME, son propre écran. La liste d'autorisation est donc possible ici —
 * et quand elle est possible, elle est le bon choix. Décision 3 de l'ADR : aucun
 * identifiant de l'humain n'entre. Un navigateur est l'endroit le plus facile du
 * monde pour exfiltrer une clé : il suffit de la taper dans une barre d'adresse.
 *
 * Rien n'est hérité par défaut. Ce qui passe est écrit ici, et nulle part
 * ailleurs.
 */
const AUTORISEES: readonly string[] = ['TZ', 'LANG'];

export function envAtelier(env: Readonly<Record<string, string | undefined>>): string[] {
  const passe: string[] = [];
  for (const cle of AUTORISEES) {
    const v = env[cle];
    if (v !== undefined && v !== '') passe.push(`${cle}=${v}`);
  }
  return passe;
}

/**
 * Un nom de conteneur sûr.
 *
 * Un nom vient d'un identifiant de tâche, donc du dehors. `docker` accepte
 * `[a-zA-Z0-9][a-zA-Z0-9_.-]*` : tout le reste est refusé, et un nom refusé
 * ferait échouer le démarrage plusieurs lignes plus bas, sur un message qui ne
 * dit pas pourquoi. On tranche ici.
 */
export function nomValide(nom: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,62}$/.test(nom);
}

/**
 * La commande qui allume un bureau — ou le refus, avec sa raison.
 *
 * ─── CE QUI EST REFUSÉ, ET POURQUOI C'EST LE CŒUR DU MODULE ──────────────────
 *
 * Décision 5 de l'ADR : **sans moteur de conteneur, PAS d'Atelier.** Aucun
 * repli, aucun « bureau simulé ». Un simulacre qui a l'air de travailler est le
 * défaut § 9 bis du journal, celui qui a coûté le plus cher à ce dépôt — un
 * Claude Code installé et jamais employé, une ruche qui rendait de faux diffs.
 *
 * On rend donc un refus NOMMÉ, que l'appelant affiche, et l'agent travaille en
 * aveugle comme avant. C'est moins bien ; ce n'est pas trompeur.
 */
export function planAtelier(voeu: VoeuAtelier): Plan {
  if (voeu.moteur === null) {
    return {
      ok: false,
      raison:
        'Atelier indisponible : aucun moteur de conteneur (docker ou podman). ' +
        "L'agent travaillera sans bureau — il n'y a pas de bureau simulé.",
    };
  }
  if (!nomValide(voeu.nom)) {
    return { ok: false, raison: `Nom d'atelier refusé : « ${voeu.nom} ».` };
  }
  if (!Number.isInteger(voeu.port) || voeu.port < 1024 || voeu.port > 65535) {
    return {
      ok: false,
      raison: `Port refusé : ${String(voeu.port)} (1024–65535 attendu, hors ports privilégiés).`,
    };
  }

  const reseau = voeu.reseau ?? 'ferme';
  const argv: string[] = [
    'run',
    // ─── ÉPHÉMÈRE — décision 4 de l'ADR ───────────────────────────────────
    //
    // Un bureau persistant accumule : un `~/.ssh` qui traîne, un cookie de
    // session, un paquet installé à la main que personne ne retrouvera. Le
    // workspace git reste la seule chose qui survit à la tâche.
    '--rm',
    '--detach',
    '--name',
    voeu.nom,

    // ─── L'ÉCRAN NE SORT PAS DE LA MACHINE ────────────────────────────────
    //
    // `127.0.0.1:` explicitement. Sans ce préfixe, docker publie sur 0.0.0.0 :
    // le bureau devient joignable depuis tout le réseau local, sans mot de
    // passe. Le partage distant passe par le tunnel à jeton révocable qui
    // existe déjà (décision 2), jamais par un port ouvert.
    '--publish',
    `127.0.0.1:${String(voeu.port)}:6080`,

    // ─── CE QU'ON RETIRE ──────────────────────────────────────────────────
    '--cap-drop=ALL',
    '--security-opt=no-new-privileges',
    `--memory=${voeu.memoire ?? MEMOIRE_DEFAUT}`,
    `--pids-limit=${PROCESSUS_MAX}`,
    // Un navigateur a besoin de mémoire partagée ; sans ça Chromium meurt sur
    // un plantage d'onglet incompréhensible. C'est la seule concession, et elle
    // est bornée.
    '--shm-size=512m',
  ];

  if (reseau === 'ferme') argv.push('--network=none');

  // Le seul volume : le travail de la tâche. Pas le dépôt entier, pas le HOME.
  argv.push('--volume', `${voeu.travail}:/travail`);
  argv.push('--workdir', '/travail');

  argv.push(IMAGE_ATELIER);
  return { ok: true, bin: voeu.moteur, argv };
}

/** La commande qui éteint un bureau. Idempotente : éteindre deux fois va bien. */
export function planArret(moteur: Moteur | null, nom: string): Plan {
  if (moteur === null) return { ok: false, raison: 'Aucun moteur de conteneur.' };
  if (!nomValide(nom)) return { ok: false, raison: `Nom d'atelier refusé : « ${nom} ».` };
  // `--time 2` : on laisse deux secondes au bureau, pas trente. Personne
  // n'attend un navigateur qui se ferme proprement.
  return { ok: true, bin: moteur, argv: ['stop', '--time', '2', nom] };
}

/**
 * L'adresse où l'humain regarde l'écran, en LECTURE.
 *
 * `view_only=1` est passé à noVNC : le spectateur voit et ne touche pas. Ce
 * n'est pas une frontière de sécurité — c'est le client qui l'honore — et c'est
 * pour ça que le port ne quitte pas `127.0.0.1`. La vraie borne est le réseau,
 * pas le paramètre.
 */
export function adresseEcran(port: number): string {
  return `http://127.0.0.1:${String(port)}/vnc.html?view_only=1&autoconnect=1`;
}
