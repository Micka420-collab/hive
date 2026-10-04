// Le transport mDNS — une prise UDP multicast, et rien de plus.
//
// ─── POURQUOI UNE INTERFACE, ET PAS DIRECTEMENT `dgram` ──────────────────────
//
// La machine qui se signale (`node-client/decouverte-noeud.ts`) et la Reine qui
// écoute (`orchestrator/decouverte-reseau.ts`) ne parlent qu'à `TransportMdns`.
// En production, c'est la vraie prise ci-dessous. Sous banc, c'est un bus en
// mémoire : le parcours « liste → Rejoindre → billet → clé » s'éprouve ainsi
// PARTOUT, y compris sur les runners où le multicast de boucle n'existe pas —
// et le vrai multicast a son propre banc, qui le dit quand il doit s'abstenir.
//
// ─── LES CHOIX DE LA PRISE ───────────────────────────────────────────────────
//
//   · `reuseAddr` : le port 5353 est PARTAGÉ par définition — avahi, Bonjour,
//     le service mDNS de Windows et Chrome y écoutent déjà. Sans ce drapeau,
//     le premier arrivé le garderait pour lui ;
//   · une adhésion au groupe PAR INTERFACE IPv4 non interne : sans argument,
//     le noyau choisit UNE interface, et une machine à deux cartes (Wi-Fi +
//     Ethernet, ou un pont de VM) n'entendrait qu'un des deux réseaux ;
//   · l'émission fait le tour des interfaces, UNE À LA FOIS : on change
//     l'interface de sortie puis on attend que l'envoi soit parti avant de
//     passer à la suivante. Changer d'interface pendant qu'un envoi est encore
//     en file le ferait partir du mauvais côté ;
//   · TTL 255 : c'est ce que la RFC 6762 § 11 exige d'un émetteur, et ce que
//     certains répondeurs vérifient pour écarter ce qui vient d'ailleurs ;
//   · une résolution d'adresse SYNCHRONE. `send()` fait passer même une
//     adresse IP littérale par `dns.lookup`, qui rappelle au tick suivant :
//     le paquet émis juste avant un `process.exit` — l'ADIEU d'un nœud qu'on
//     arrête d'un Ctrl+C (`arreterSurSignaux`) — n'était jamais parti, MESURÉ,
//     et la machine restait deux minutes à l'écran avec un « Rejoindre » voué
//     à l'échec. Notre groupe est toujours une IP : on la rend telle quelle,
//     et l'envoi part dans l'appel même. Limite assumée : à l'arrêt brutal,
//     seule la PREMIÈRE interface reçoit l'adieu (les suivantes attendent le
//     rappel du précédent) ; les autres réseaux oublient la machine à
//     l'expiration de son annonce.
//
// Une erreur de la prise n'arrête JAMAIS le processus : la découverte est un
// confort, pas une fonction vitale de la ruche ni du nœud.

import dgram from 'node:dgram';
import dns from 'node:dns';
import { isIPv4 } from 'node:net';
import os from 'node:os';
import { GROUPE_MDNS, PORT_MDNS } from './mdns.js';

export interface TransportMdns {
  /** Émet un paquet vers le groupe, sur chaque interface. N'échoue jamais bruyamment. */
  emettre(paquet: Buffer): void;
  /** Branche l'écoute. `source` est l'adresse IPv4 de l'émetteur, telle que le noyau l'a vue. */
  surPaquet(ecouteur: (paquet: Buffer, source: string) => void): void;
  fermer(): Promise<void>;
}

export interface ReglageUdp {
  /** Défaut : 5353. Un banc prend un port éphémère pour ne croiser personne. */
  port?: number;
  groupe?: string;
  /** Les adresses IPv4 des interfaces à rejoindre. Défaut : `interfacesLocales()`. */
  interfaces?: readonly string[];
  /** Où dire une panne de prise survenue APRÈS l'ouverture. Défaut : `console.warn`, une fois. */
  signaler?: (message: string) => void;
}

/** Les adresses IPv4 non internes de cette machine — celles qui voient le réseau local. */
export function interfacesLocales(): string[] {
  const adresses: string[] = [];
  for (const liste of Object.values(os.networkInterfaces())) {
    for (const a of liste ?? []) {
      if (a.family === 'IPv4' && !a.internal) adresses.push(a.address);
    }
  }
  return adresses;
}

/**
 * Ouvre la prise. LÈVE si aucune interface n'a pu rejoindre le groupe, ou si
 * le port ne s'ouvre pas : c'est à l'appelant de dire « découverte
 * indisponible » en nommant la cause — une prise qui n'entend rien ne doit pas
 * passer pour une découverte qui ne trouve personne.
 */
export async function ouvrirTransportUdp(reglage: ReglageUdp = {}): Promise<TransportMdns> {
  const port = reglage.port ?? PORT_MDNS;
  const groupe = reglage.groupe ?? GROUPE_MDNS;
  const interfaces = [...(reglage.interfaces ?? interfacesLocales())];
  if (interfaces.length === 0) {
    throw new Error('aucune interface réseau IPv4 active : rien à écouter');
  }
  let signale = false;
  const signaler =
    reglage.signaler ??
    ((m: string) => {
      if (signale) return;
      signale = true;
      console.warn(`[hive] découverte réseau : ${m}`);
    });

  const prise = dgram.createSocket({
    type: 'udp4',
    reuseAddr: true,
    // Voir l'en-tête : une IP littérale se rend sur-le-champ, pour que l'envoi
    // parte dans l'appel. Un nom (jamais utilisé ici) passerait par le DNS.
    lookup: (adresse, options, rappel) => {
      if (isIPv4(adresse)) rappel(null, adresse, 4);
      else dns.lookup(adresse, options, rappel);
    },
  });
  await new Promise<void>((resoudre, rejeter) => {
    prise.once('error', rejeter);
    prise.bind(port, () => {
      prise.off('error', rejeter);
      resoudre();
    });
  });
  // Après l'ouverture, une erreur de prise se DIT et n'arrête rien.
  prise.on('error', (e) => signaler(e.message));

  const rejointes = interfaces.filter((adresse) => {
    try {
      prise.addMembership(groupe, adresse);
      return true;
    } catch {
      return false;
    }
  });
  if (rejointes.length === 0) {
    prise.close();
    throw new Error(`aucune interface n'a pu rejoindre le groupe ${groupe}`);
  }
  prise.setMulticastTTL(255);
  prise.setMulticastLoopback(true);

  // Les envois s'enchaînent : une file, un envoi en vol à la fois (voir l'en-tête).
  const file: Buffer[] = [];
  let enVol = false;
  /** Plus rien n'entre dans la file ; ce qui y est encore PART (l'adieu, typiquement). */
  let fermeture = false;
  let fermee = false;
  let videe: (() => void) | null = null;
  const pomper = (): void => {
    if (enVol || fermee) return;
    const paquet = file.shift();
    if (!paquet) {
      videe?.();
      return;
    }
    enVol = true;
    let i = 0;
    const suivant = (): void => {
      if (fermee || i >= rejointes.length) {
        enVol = false;
        pomper();
        return;
      }
      const adresse = rejointes[i++]!;
      try {
        prise.setMulticastInterface(adresse);
        prise.send(paquet, port, groupe, (err) => {
          if (err) signaler(err.message);
          suivant();
        });
      } catch (err) {
        signaler(err instanceof Error ? err.message : String(err));
        suivant();
      }
    };
    suivant();
  };

  return {
    emettre(paquet) {
      if (fermeture) return;
      // Borne de la file : un émetteur emballé ne remplit pas la mémoire.
      if (file.length < 64) file.push(paquet);
      pomper();
    },
    surPaquet(ecouteur) {
      prise.on('message', (paquet, info) => {
        if (info.family === 'IPv4') ecouteur(paquet, info.address);
      });
    },
    async fermer() {
      if (fermeture) return;
      fermeture = true;
      // L'ADIEU D'ABORD. Fermer la prise avec des paquets encore en file les
      // jetterait — et c'est justement l'adieu (TTL 0) qu'on vient d'y mettre,
      // celui qui retire la machine des écrans sans attendre deux minutes.
      // Borné : une prise coincée ne retient pas l'arrêt du processus.
      if (enVol || file.length > 0) {
        await new Promise<void>((resoudre) => {
          const garde = setTimeout(resoudre, 500);
          garde.unref();
          videe = () => {
            clearTimeout(garde);
            resoudre();
          };
        });
      }
      fermee = true;
      file.length = 0;
      await new Promise<void>((resoudre) => prise.close(() => resoudre()));
    },
  };
}
