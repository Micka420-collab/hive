// POSER UN OUTIL — l'exécution, côté machine du membre.
//
// ─── CE QUE CE FICHIER A LE DROIT DE FAIRE ───────────────────────────────────
//
// Lancer une commande d'installation. Une seule, celle que SON catalogue
// déclare pour l'identifiant reçu. Le message venu du hub ne porte pas de
// commande — voir `PoserOutilMsg` — et ce fichier n'en fabrique pas non plus :
// il la lit dans `PAQUETS` via `jugerPose`.
//
// La conséquence est la borne du lot : quoi qu'un hub compromis envoie, le pire
// qu'il obtienne est l'installation d'un outil DÉJÀ au catalogue. Pas une
// commande arbitraire.
//
// ─── LES TROIS BORNES D'EXÉCUTION ────────────────────────────────────────────
//
// · `shell: false` — jamais d'interprétation shell. Une commande de catalogue
//   n'en a pas besoin, et l'autoriser rouvrirait par la fenêtre ce que le
//   protocole ferme par la porte.
// · sortie plafonnée — une installation bavarde ne doit pas saturer la mémoire
//   du nœud ni le message de retour.
// · délai borné — `npm install -g` peut pendre indéfiniment sur un registre
//   injoignable ; sans butoir, le nœud reste bloqué sans jamais répondre.

import { ENTREE_FERMEE } from '../adapters/exec.js';
import { lancerArbre } from '../shared/arbre-processus.js';
import { POSE_DELAI_MS } from '../shared/butoirs-noeud.js';
import { direRefusPose, jugerPose } from '../shared/pose-outil.js';
import type { PoseResultMsg, PoserOutilMsg } from '../shared/protocol.js';

/** Au-delà, on tronque : c'est une trace, pas un journal complet. */
export const POSE_SORTIE_MAX = 512 * 1024;

export interface Lancement {
  /** Code de sortie, ou `null` si le processus n'a jamais démarré. */
  readonly code: number | null;
  readonly sortie: string;
}

/** Injecté pour que la décision soit éprouvable sans rien installer. */
export type Lanceur = (bin: string, args: readonly string[]) => Promise<Lancement>;

export interface OutilsPose {
  /** Ce que le nœud VOIT sur sa machine — pas ce que le hub suppose. */
  readonly dejaPose: boolean;
  readonly lancer: Lanceur;
}

/**
 * Le lanceur réel. `shell: false`, sortie plafonnée, délai borné — et l'ARBRE
 * entier, pas le seul `npm` (`lancerArbre`, `shared/arbre-processus.ts`).
 *
 * `npm install -g` lance un `node`, qui lance les scripts `postinstall` du
 * paquet. Tuer `npm` seul au délai laissait tourner le reste ; et un script
 * qui laissait un descendant sur la sortie retenait `close` : la pose restait
 * « en cours » jusqu'au butoir de dix minutes, pour une commande déjà finie.
 * L'arbre est aussi RETENU : un nœud qui s'arrête l'emporte avec lui.
 *
 * Un `spawn` qui échoue à démarrer (ENOENT : npm absent) rend `code: null` et
 * dit pourquoi, plutôt que de laisser croire à un échec d'installation.
 */
export const lancerVraiment: Lanceur = (bin, args) =>
  new Promise<Lancement>((resolve) => {
    let sortie = '';
    const enfant = lancerArbre(
      bin,
      args,
      { cwd: process.cwd(), env: process.env, stdio: ENTREE_FERMEE },
      { delaiMs: POSE_DELAI_MS },
      (fin) => {
        if (fin.issue === 'sortie') resolve({ code: fin.code, sortie });
        else if (fin.issue === 'arret') {
          resolve({
            code: null,
            sortie: `${sortie}\n[hive] pose interrompue après ${POSE_DELAI_MS / 60_000} min`,
          });
        } else {
          resolve({
            code: null,
            sortie: `${sortie}\n[hive] la commande n'a pas démarré : ${fin.erreur.message}`,
          });
        }
      },
    );
    const prendre = (c: Buffer): void => {
      if (sortie.length < POSE_SORTIE_MAX) sortie += c.toString();
    };
    enfant.stdout?.on('data', prendre);
    enfant.stderr?.on('data', prendre);
  });

/**
 * Traite une demande de pose et rend ce qu'il faut renvoyer au hub.
 *
 * Ne jette jamais : un nœud qui lève sur un message du hub laisse la demande
 * sans réponse, et le tableau de bord tourne indéfiniment sur « en cours ».
 * Tout échec devient un `pose_result` qui dit ce qui s'est passé.
 */
export async function poserOutil(msg: PoserOutilMsg, outils: OutilsPose): Promise<PoseResultMsg> {
  const verdict = jugerPose({ outilId: msg.outilId, dejaPose: outils.dejaPose });
  if (!verdict.accordee) {
    return {
      type: 'pose_result',
      poseId: msg.poseId,
      outilId: msg.outilId,
      code: null,
      sortie: '',
      ok: false,
      refuse: direRefusPose(verdict.motif),
    };
  }

  const [bin, ...args] = verdict.commande;
  // `bin` ne peut pas manquer : `PAQUETS` ne contient que des commandes non
  // vides, et un banc du catalogue le tient. La garde existe quand même parce
  // que `spawn(undefined)` jetterait au lieu de rendre un résultat.
  if (bin === undefined) {
    return {
      type: 'pose_result',
      poseId: msg.poseId,
      outilId: msg.outilId,
      code: null,
      sortie: '',
      ok: false,
      refuse: 'commande vide au catalogue',
    };
  }

  const { code, sortie } = await outils.lancer(bin, args);
  return {
    type: 'pose_result',
    poseId: msg.poseId,
    outilId: msg.outilId,
    code,
    sortie: sortie.slice(0, POSE_SORTIE_MAX),
    // `ok` n'est vrai que sur un 0 franc. `null` (jamais démarré) et tout code
    // non nul disent la même chose au membre : ça n'a pas marché.
    ok: code === 0,
  };
}
