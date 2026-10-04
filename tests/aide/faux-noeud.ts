// Un faux nœud qui VIT comme un vrai : il s'inscrit, attend `registered`, puis
// bat toutes les `HEARTBEAT_INTERVAL_MS` — ce que fait `src/node-client`.
//
// ─── LE DÉFAUT QUI A JUSTIFIÉ CE FICHIER ────────────────────────────────────
//
// Une vingtaine de bancs ouvraient leur propre socket, envoyaient `register`
// et ne battaient jamais. La Reine a raison de faucher un nœud muet depuis
// `NODE_TIMEOUT_MS` (15 s) : `heartbeat_timeout`, sa tâche en vol repart en
// `ready`, le résultat qui suit est écarté (`stale_assignment`), et plus rien
// ne lui est confié. Tant qu'un banc tient sous 15 s, personne ne le voit ; sur
// un runner Windows chargé, il les dépasse, et l'attente en cours expire avec
// un message qui parle d'assignation ou de verdict alors que le nœud vient
// simplement d'être déclaré mort (#533 : `caste-boucle`, rouge à 15,1–15,7 s
// après l'inscription, à un tour différent à chaque run).
//
// ─── CE QUE FAIT LE HELPER, ET POURQUOI DANS CET ORDRE ───────────────────────
//
// • L'écouteur du banc est posé AVANT l'ouverture : une `assign_task` peut
//   arriver dans la même trame TCP que `registered`, et un écouteur posé après
//   la promesse la perdrait. Il voit TOUS les messages, `registered` compris.
// • L'inscription est ATTENDUE (`registered`), pas supposée : c'est elle qui
//   pose le premier `lastSeen`, et une inscription lente se paie ici plutôt
//   que dans la première attente du banc.
// • Le battement part tout de suite puis toutes les `HEARTBEAT_INTERVAL_MS`,
//   comme `startHeartbeat` du vrai client. `running` n'est qu'informatif côté
//   Reine (`scheduler.heartbeat` ne touche que `lastSeen`).
// • Il s'arrête SEUL à la fermeture de la socket, quel que soit le côté qui
//   ferme : les bancs gardent leur `for (const ws of sockets) ws.close()`. Le
//   minuteur est `unref` : il ne retient jamais un worker vitest.
// • Un refus d'inscription (4401, 4403…) rejette avec son code
//   (`InscriptionRefusee`) : un banc d'accès lit ce que la Reine a RÉPONDU.
//   Une erreur de socket ne tranche pas seule : `ws` émet toujours `close`
//   après `error`, et c'est là que la promesse se règle, erreur comprise.
//
// ─── CE QUI N'EN PASSE PAS PAR ICI, À DESSEIN ───────────────────────────────
//
// • `reine-veille-ws` : il éprouve le silence au niveau TRANSPORT (pings `ws`,
//   `autoPong: false`) avec un même ouvreur pour nœud et tableau de bord, en
//   quelques centaines de ms ; un battement applicatif n'y a pas sa place.
// • `service-hub` : le battement y est l'OBJET du banc (`onShift`), envoyé à
//   la main et attendu jusqu'à ce que `lastSeen` bouge ; un battement de fond
//   ferait bouger `lastSeen` sans `onShift` et rendrait la main trop tôt.
// • `hardening` (4400/4401) et `ws-avant-auth` : des inscriptions REFUSÉES ou
//   des trames hostiles — jamais un nœud, donc rien à faucher.
// • Les bancs qui montent un vrai `HiveNodeClient` : il bat déjà.

import WebSocket from 'ws';
import type { RegisterMsg } from '../../src/shared/protocol.js';
import { HEARTBEAT_INTERVAL_MS } from '../../src/shared/types.js';

/** Ce qu'un faux nœud déclare à son inscription — tout `register` sauf le type. */
type InscriptionFauxNoeud = Omit<RegisterMsg, 'type'>;

export interface FauxNoeud {
  readonly ws: WebSocket;
  /** Coupe le battement et ferme la socket ; rend la main une fois fermée. */
  readonly arreter: () => Promise<void>;
}

/** La Reine a fermé la socket avant `registered` : son code dit pourquoi. */
export class InscriptionRefusee extends Error {
  constructor(
    readonly code: number,
    raison: string,
  ) {
    super(`inscription refusée : ${code}${raison ? ` (${raison})` : ''}`);
  }
}

/**
 * Inscrit un faux nœud sur la Reine de `port` et le garde en vie.
 *
 * `surMessage` reçoit chaque message du hub, déjà analysé, dès l'ouverture.
 */
export function brancherFauxNoeud<M extends { type: string } = { type: string }>(
  port: number,
  inscription: InscriptionFauxNoeud,
  surMessage?: (message: M) => void,
): Promise<FauxNoeud> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
  let battement: ReturnType<typeof setInterval> | undefined;
  const battre = (): void => {
    if (ws.readyState === WebSocket.OPEN)
      ws.send(JSON.stringify({ type: 'heartbeat', running: 0 }));
  };
  const fermee = new Promise<void>((resolve) => {
    ws.once('close', () => {
      clearInterval(battement);
      resolve();
    });
  });
  const noeud: FauxNoeud = {
    ws,
    arreter: async () => {
      clearInterval(battement);
      if (ws.readyState !== WebSocket.CLOSED) ws.close();
      await fermee;
    },
  };
  return new Promise<FauxNoeud>((resolve, reject) => {
    let erreur: Error | undefined;
    ws.on('message', (data) => {
      const message = JSON.parse(data.toString()) as M;
      surMessage?.(message);
      if (message.type === 'registered' && battement === undefined) {
        battre();
        battement = setInterval(battre, HEARTBEAT_INTERVAL_MS);
        battement.unref();
        resolve(noeud);
      }
    });
    ws.once('open', () => ws.send(JSON.stringify({ type: 'register', ...inscription })));
    ws.on('error', (e) => {
      erreur ??= e;
    });
    ws.once('close', (code, raison) => {
      reject(erreur ?? new InscriptionRefusee(code, raison.toString()));
    });
  });
}
