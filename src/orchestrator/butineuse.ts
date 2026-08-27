// LA BUTINEUSE — la seule fonction du dépôt qui rapporte un fichier d'Internet.
//
// ═══ POURQUOI UNE SEULE PORTE ══════════════════════════════════════════════
//
// Le dépôt porte déjà cette règle pour l'envoi de tâches (`envoyerTache`) et
// pour la même raison : deux portes, c'est une porte qu'on oublie de garder.
// Un second `fetch` qui ramène une archive, écrit ailleurs, sans passer par
// les trois jugements, réduirait tout ce module à de la décoration.
//
// ═══ CE QU'ELLE PROMET, ET CE QU'ELLE NE PROMET PAS ════════════════════════
//
// Elle promet que le fichier posé en quarantaine :
//
//   · vient d'un hôte de la liste blanche, à une référence FIGÉE (porte 1) ;
//   · n'a traversé aucune redirection ;
//   · ne dépasse pas le plafond, mesuré APRÈS décompression ;
//   · a le condensat SHA-256 exigé par la demande ;
//   · porte un nom que le serveur d'en face n'a pas choisi ;
//   · est écrit hors de l'arbre de travail, et n'est jamais exécuté.
//
// Elle ne promet PAS qu'il est inoffensif. Aucune de ces gardes ne lit le code.
// C'est le travail de `nectar-suspect.ts`, qui vient après — et qui ne promet
// pas davantage : « aucune forme connue n'a été vue » n'est pas « sûr ».
//
// ═══ L'ORDRE DES GESTES, QUI EST LE SUJET ══════════════════════════════════
//
// juger l'adresse → ouvrir → juger les en-têtes → lire en comptant →
// condenser → comparer → écrire.
//
// L'écriture est le DERNIER geste. Rien ne touche le disque avant que le
// condensat ne soit vérifié : un fichier à demi écrit puis rejeté est un
// fichier que quelqu'un finira par trouver et croire bon.

import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { BUTIN_OCTETS_MAX, jugerSourceButinage } from '../shared/butinage.js';
import {
  BUTIN_DELAI_MS,
  depasseLePlafond,
  jugerEnTetes,
  nomDeQuarantaine,
  verifierCondensat,
} from '../shared/butinage-transport.js';
import type { MotifRefusTransport, RefusTransport } from '../shared/butinage-transport.js';
import type { MotifRefusButinage } from '../shared/butinage.js';

export interface ButinRapporte {
  readonly ok: true;
  readonly chemin: string;
  readonly octets: number;
  readonly condensat: string;
  readonly url: string;
}

export interface ButinRefuse {
  readonly ok: false;
  readonly motif: MotifRefusTransport | MotifRefusButinage;
  readonly detail: string;
}

export type ResultatButinage = ButinRapporte | ButinRefuse;

export interface DemandeButinage {
  readonly url: unknown;
  /** Condensat SHA-256 attendu, en hexadécimal. EXIGÉ — voir `verifierCondensat`. */
  readonly condensat: unknown;
  /** Le dossier de quarantaine. Hors de l'arbre de travail, c'est à l'appelant. */
  readonly quarantaine: string;
}

/**
 * Ce que la butineuse a le droit d'utiliser pour parler au réseau.
 *
 * Injecté plutôt que capté : c'est ce qui permet d'éprouver TOUS les chemins de
 * refus — redirection, mensonge sur la taille, condensat faux — sans serveur et
 * sans réseau. Une garde de sécurité qu'on ne peut pas mettre en défaut dans un
 * banc est une garde dont personne ne sait si elle marche.
 */
export interface OutilsButinage {
  readonly fetch: typeof globalThis.fetch;
}

/** Le seul chemin par lequel un octet d'Internet entre dans cette ruche. */
export async function butiner(
  demande: DemandeButinage,
  outils: OutilsButinage = { fetch: globalThis.fetch },
): Promise<ResultatButinage> {
  // ─── PORTE 1 : où a-t-on le droit d'aller ────────────────────────────────
  const source = jugerSourceButinage(demande.url);
  if (!source.ok) return { ok: false, motif: source.motif, detail: source.detail };

  // Le condensat est exigé AVANT la requête. Partir chercher un fichier qu'on
  // ne saura pas reconnaître, c'est dépenser du réseau pour un refus certain —
  // et c'est surtout la porte ouverte à « on verra bien ce qui arrive ».
  const attendu = verifierCondensat(demande.condensat, '');
  if (!attendu.ok && attendu.motif === 'condensat_absent') {
    return { ok: false, motif: attendu.motif, detail: attendu.detail };
  }

  let reponse: Response;
  try {
    reponse = await outils.fetch(source.url, {
      // AUCUNE redirection suivie. `manual` rendrait une réponse opaque qu'il
      // faudrait interpréter ; `error` fait rejeter la promesse, ce qui est le
      // comportement voulu — une redirection est une panne, pas une étape.
      redirect: 'error',
      signal: AbortSignal.timeout(BUTIN_DELAI_MS),
      headers: { accept: 'application/octet-stream' },
      // Pas de cookie, pas d'identifiant : rien de la ruche ne part avec la
      // requête. Un butinage n'a aucune raison d'être authentifié, et une
      // requête authentifiée vers un hôte tiers est une fuite en puissance.
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    if (nom === 'TimeoutError' || nom === 'AbortError') {
      return {
        ok: false,
        motif: 'delai_depasse',
        detail: `Aucune réponse complète en ${BUTIN_DELAI_MS} ms — un filet d'octets tient une ouvrière aussi sûrement qu'un fichier géant.`,
      };
    }
    return {
      ok: false,
      motif: 'transport_casse',
      detail: `Le transport a échoué : ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  // ─── PORTE 2 : ce que la réponse DIT, avant de lire un octet ─────────────
  const entetes = jugerEnTetes(
    reponse.status,
    reponse.headers.get('content-type'),
    reponse.headers.get('content-length'),
    BUTIN_OCTETS_MAX,
  );
  if (!entetes.ok) return refus(entetes);

  const corps = reponse.body;
  if (corps === null) {
    return { ok: false, motif: 'transport_casse', detail: 'Réponse sans corps à lire.' };
  }

  // ─── PORTE 3 : ce que la réponse FAIT, octet par octet ───────────────────
  //
  // On accumule en mémoire plutôt que d'écrire au fil de l'eau : le plafond est
  // de 25 Mio, donc c'est tenable, et cela garantit qu'aucun octet non vérifié
  // n'atteint jamais le disque. Écrire puis effacer laisserait une fenêtre où
  // le fichier existe sans avoir été jugé.
  const morceaux: Uint8Array[] = [];
  let lus = 0;
  const lecteur = corps.getReader();
  try {
    for (;;) {
      const { done, value } = await lecteur.read();
      if (done) break;
      if (value === undefined) continue;
      // Le plafond s'applique à ce qu'on LIT — donc après décompression. Une
      // archive de 40 Kio sur le fil peut en rendre 4 Gio ici.
      if (depasseLePlafond(lus, value.byteLength, BUTIN_OCTETS_MAX)) {
        await lecteur.cancel();
        return {
          ok: false,
          motif: 'trop_gros',
          detail: `Le flux dépasse ${BUTIN_OCTETS_MAX} octets — lecture interrompue. L'annonce du serveur ne prouvait rien.`,
        };
      }
      lus += value.byteLength;
      morceaux.push(value);
    }
  } catch (e) {
    const nom = e instanceof Error ? e.name : '';
    if (nom === 'TimeoutError' || nom === 'AbortError') {
      return {
        ok: false,
        motif: 'delai_depasse',
        detail: `Le corps n'est pas arrivé en entier en ${BUTIN_DELAI_MS} ms.`,
      };
    }
    return {
      ok: false,
      motif: 'transport_casse',
      detail: `Lecture interrompue : ${e instanceof Error ? e.message : String(e)}`,
    };
  } finally {
    lecteur.releaseLock();
  }

  const octets = Buffer.concat(morceaux);
  const condensat = createHash('sha256').update(octets).digest('hex');
  const verdict = verifierCondensat(demande.condensat, condensat);
  if (!verdict.ok) return refus(verdict);

  // ─── ET SEULEMENT MAINTENANT, LE DISQUE ──────────────────────────────────
  const nom = nomDeQuarantaine(createHash('sha256').update(source.url).digest('hex'));
  const chemin = path.join(demande.quarantaine, nom);
  await mkdir(demande.quarantaine, { recursive: true });
  // `mode` en lecture seule : un butin n'est pas fait pour être modifié sur
  // place, et surtout pas pour être exécuté. Sous Windows le bit d'exécution
  // n'existe pas de la même façon — la vraie garde reste que RIEN n'exécute ce
  // dossier, pas la permission.
  await writeFile(chemin, octets, { mode: 0o444 });

  return { ok: true, chemin, octets: octets.byteLength, condensat, url: source.url };
}

function refus(r: RefusTransport): ButinRefuse {
  return { ok: false, motif: r.motif, detail: r.detail };
}
