// La Reine qui écoute le réseau local — ce qu'elle entend, et comment elle offre.
//
// ─── CE QU'ELLE FAIT ─────────────────────────────────────────────────────────
//
// Activée par `HIVE_DECOUVERTE=1` (jamais par défaut), elle pose la question
// mDNS « qui offre `_hive._tcp` ? » au démarrage, puis à intervalles, et range
// ce que répondent les machines qui se signalent. Le tableau de bord en tire la
// liste « Sur votre réseau local » (`GET /api/decouverte`).
//
// ─── CE QU'ELLE CROIT, ET CE QU'ELLE NE CROIT PAS ────────────────────────────
//
// Tout ce qui arrive sur 224.0.0.251 vient de n'importe qui. Donc :
//
//   · l'ADRESSE d'une machine est celle d'où vient le paquet, pas celle qu'il
//     prétend (enregistrement A) — et seulement si elle est privée (voir
//     `ipv4Privee`). La Reine n'enverra jamais d'offre là où une annonce forgée
//     lui dirait d'aller ;
//   · une annonce se lit par `lireAnnonce`, qui refuse au moindre doute ;
//   · la liste est BORNÉE (`ENTREES_MAX`), et chaque adresse n'y tient que
//     `PAR_SOURCE_MAX` places : un voisin qui inonde le segment de fausses
//     machines ne remplit ni la mémoire de la ruche, ni l'écran ;
//   · une entrée vivante est LIÉE à l'adresse d'où elle a été entendue : le
//     nom d'instance est diffusé, n'importe qui peut le recopier — mais une
//     annonce ou un adieu venus d'AILLEURS sous ce nom sont ignorés. Sans
//     ça, un imposteur détournait vers lui l'offre destinée à la vraie
//     machine (qu'il ne peut pas ouvrir, mais à laquelle il pouvait répondre
//     « acceptée »), ou la faisait disparaître de l'écran ;
//   · chaque entrée EXPIRE à la durée de vie annoncée, plafonnée à celle
//     qu'une vraie machine Hive annonce (`TTL_ANNONCE_S`) : une machine
//     éteinte sans adieu disparaît seule, et une annonce forgée ne s'incruste
//     pas plus longtemps qu'une vraie.
//
// Et l'offre ne contient rien que le premier venu puisse ouvrir : elle est
// scellée sous le code que seule la vraie machine affiche (`decouverte.ts`).

import os from 'node:os';
import {
  INSTANCE_RE,
  INTERVALLE_OFFRES_MS,
  SERVICE_HIVE,
  TTL_ANNONCE_S,
  lireAnnonce,
  ipv4Privee,
} from '../shared/decouverte.js';
import type { Annonce, EtatAnnonce, FamilleAnnoncee, OffreScellee } from '../shared/decouverte.js';
import type { PlateformeNoeud } from '../shared/machine.js';
import { TYPE_MDNS, decoderPaquet, encoderPaquet, memeNom } from '../shared/mdns.js';
import type { EnregistrementMdns } from '../shared/mdns.js';
import type { TransportMdns } from '../shared/mdns-reseau.js';

/** Plafond des machines retenues. Un réseau domestique en compte quelques-unes. */
export const ENTREES_MAX = 64;
/**
 * Places d'une même adresse. Une machine Hive s'annonce UNE fois (une seule
 * ouvrière par machine se signale, `demarrage.ts`) ; quatre laissent de quoi
 * à plusieurs `hive join` lancés à la main sur le même poste.
 */
export const PAR_SOURCE_MAX = 4;
/** Cadence des questions de fond. Les annonces vivent 120 s : on repasse bien avant. */
export const INTERVALLE_QUESTIONS_MS = 60_000;
/** Une question sur demande (écran ouvert) au plus toutes les… */
const QUESTION_MIN_MS = 5_000;

/**
 * Ce qu'un membre DIT de sa ruche, rapporté à celle-ci. Une ANNONCE, pas un
 * constat : l'empreinte est publique et se recopie, donc `cette_ruche` se lit
 * « se dit membre de cette ruche » — l'écran le formule ainsi, et seule la
 * liste des ouvrières connectées fait foi.
 */
export type RelationRuche = 'cette_ruche' | 'autre_ruche' | 'inconnue';

/** Une machine entendue, telle que l'écran la montre. */
export interface Decouvert {
  /** Le nom d'instance (`hive-<8 hex>`) : tiré au sort par la machine, jamais son identité. */
  id: string;
  nom: string;
  os: PlateformeNoeud;
  agents: FamilleAnnoncee[];
  places: number;
  etat: EtatAnnonce;
  /** Pour un membre seulement ; `null` pour une machine libre. */
  ruche: RelationRuche | null;
  /** L'adresse d'où l'annonce est venue. */
  adresse: string;
  /** La porte d'offre ; `0` pour un membre. */
  port: number;
  vuA: number;
}

interface Fiche {
  id: string;
  annonce: Annonce;
  adresse: string;
  port: number;
  vuA: number;
  expireA: number;
}

export interface OptionsDecouverte {
  /** L'empreinte de CETTE ruche, pour reconnaître ses propres membres. */
  empreinte: () => string;
  horloge?: () => number;
}

export class DecouverteReseau {
  private readonly fiches = new Map<string, Fiche>();
  private derniereQuestion = Number.NEGATIVE_INFINITY;
  private readonly minuteurs: NodeJS.Timeout[] = [];
  private arretee = false;

  constructor(
    private readonly transport: TransportMdns,
    private readonly o: OptionsDecouverte,
  ) {
    transport.surPaquet((paquet, source) => this.surPaquet(paquet, source));
  }

  private get maintenant(): number {
    return (this.o.horloge ?? Date.now)();
  }

  /**
   * Première question tout de suite, deux rappels rapprochés (un datagramme se
   * perd), puis une question par minute. Tous les minuteurs sont `unref` : la
   * découverte ne retient jamais la Reine de s'arrêter.
   */
  demarrer(): void {
    this.interroger(true);
    for (const apres of [1_000, 3_000]) {
      const t = setTimeout(() => this.interroger(true), apres);
      t.unref();
      this.minuteurs.push(t);
    }
    const fond = setInterval(() => this.interroger(true), INTERVALLE_QUESTIONS_MS);
    fond.unref();
    this.minuteurs.push(fond);
  }

  /**
   * Pose la question « qui offre `_hive._tcp` ? ». Sans `force`, au plus une
   * fois toutes les cinq secondes : l'écran qui se rafraîchit ne doit pas
   * devenir une rafale multicast sur le réseau de toute la maison.
   */
  interroger(force = false): void {
    if (this.arretee) return;
    const maintenant = this.maintenant;
    if (!force && maintenant - this.derniereQuestion < QUESTION_MIN_MS) return;
    this.derniereQuestion = maintenant;
    this.transport.emettre(
      encoderPaquet({
        id: 0,
        reponse: false,
        questions: [{ nom: SERVICE_HIVE, type: TYPE_MDNS.PTR, unicast: false }],
        reponses: [],
        additionnels: [],
      }),
    );
  }

  /** Les machines entendues et encore vivantes : les libres d'abord, puis par nom. */
  liste(): Decouvert[] {
    this.purger();
    const empreinte = this.o.empreinte();
    return [...this.fiches.values()]
      .map((f): Decouvert => {
        const a = f.annonce;
        return {
          id: f.id,
          nom: a.nom,
          os: a.os,
          agents: [...a.agents],
          places: a.places,
          etat: a.etat,
          ruche:
            a.etat === 'libre'
              ? null
              : a.ruche === null
                ? 'inconnue'
                : a.ruche === empreinte
                  ? 'cette_ruche'
                  : 'autre_ruche',
          adresse: f.adresse,
          port: f.port,
          vuA: f.vuA,
        };
      })
      .sort(
        (x, y) =>
          (x.etat === 'libre' ? 0 : 1) - (y.etat === 'libre' ? 0 : 1) || x.nom.localeCompare(y.nom),
      );
  }

  /** Une machine encore vivante, par son nom d'instance. */
  trouver(id: string): Decouvert | null {
    return this.liste().find((d) => d.id === id) ?? null;
  }

  async arreter(): Promise<void> {
    if (this.arretee) return;
    this.arretee = true;
    for (const t of this.minuteurs) clearTimeout(t);
    await this.transport.fermer();
  }

  private purger(): void {
    const maintenant = this.maintenant;
    for (const [id, f] of this.fiches) if (f.expireA <= maintenant) this.fiches.delete(id);
  }

  private surPaquet(brut: Buffer, source: string): void {
    if (this.arretee) return;
    const adresse = ipv4Privee(source);
    if (adresse === null) return;
    const p = decoderPaquet(brut);
    if (!p || !p.reponse) return;
    const tous = [...p.reponses, ...p.additionnels];
    const suffixe = `.${SERVICE_HIVE}`;
    for (const ptr of tous) {
      if (ptr.type !== 'PTR' || !memeNom(ptr.nom, SERVICE_HIVE)) continue;
      if (!ptr.cible.toLowerCase().endsWith(suffixe)) continue;
      const id = ptr.cible.slice(0, -suffixe.length);
      if (!INSTANCE_RE.test(id)) continue;
      // Nom tenu par une AUTRE adresse, encore vivant : ni annonce ni adieu
      // de celle-ci ne le touchent (voir l'en-tête).
      const tenue = this.fiches.get(id);
      if (tenue && tenue.adresse !== adresse && tenue.expireA > this.maintenant) continue;
      // L'ADIEU : la machine part, elle quitte l'écran tout de suite.
      if (ptr.ttl === 0) {
        this.fiches.delete(id);
        continue;
      }
      this.ranger(id, ptr, tous, adresse);
    }
  }

  private ranger(
    id: string,
    ptr: EnregistrementMdns & { type: 'PTR' },
    tous: readonly EnregistrementMdns[],
    adresse: string,
  ): void {
    // Nos machines envoient PTR, SRV et TXT dans le même paquet ; ce qui n'y
    // est pas n'est pas une de nos machines — on ne recolle rien entre paquets.
    const srv = tous.find(
      (e): e is EnregistrementMdns & { type: 'SRV' } =>
        e.type === 'SRV' && memeNom(e.nom, ptr.cible),
    );
    const txt = tous.find(
      (e): e is EnregistrementMdns & { type: 'TXT' } =>
        e.type === 'TXT' && memeNom(e.nom, ptr.cible),
    );
    if (!srv || !txt) return;
    const annonce = lireAnnonce(txt.textes);
    if (!annonce) return;
    // Une machine LIBRE sans porte d'offre ne peut être rejointe par personne :
    // l'afficher proposerait un bouton qui échoue à coup sûr.
    if (annonce.etat === 'libre' && srv.port === 0) return;
    if (!this.fiches.has(id)) {
      this.purger();
      if (this.fiches.size >= ENTREES_MAX) return;
      let memeSource = 0;
      for (const f of this.fiches.values()) if (f.adresse === adresse) memeSource += 1;
      if (memeSource >= PAR_SOURCE_MAX) return;
    }
    const ttl = Math.min(ptr.ttl, srv.ttl, txt.ttl, TTL_ANNONCE_S);
    const vuA = this.maintenant;
    this.fiches.set(id, { id, annonce, adresse, port: srv.port, vuA, expireA: vuA + ttl * 1000 });
  }
}

// ─── L'offre, portée jusqu'à la machine ──────────────────────────────────────

export type IssueLivraison =
  | { issue: 'acceptee' }
  | { issue: 'code_refuse'; restants: number | null }
  | { issue: 'code_renouvele' }
  | { issue: 'deja_accueillie' }
  | { issue: 'occupee' }
  | { issue: 'injoignable'; detail: string }
  | { issue: 'reponse_inattendue'; statut: number };

/** Assez pour un PBKDF2 sur une petite machine ; au-delà, elle ne répondra plus. */
export const DELAI_LIVRAISON_MS = 8_000;
/** Plafond de ce qu'on lit de la réponse : une machine qui répond un roman n'est pas une des nôtres. */
const REPONSE_MAX = 4 * 1024;

async function lireBorne(rep: Response): Promise<unknown> {
  const lecteur = rep.body?.getReader();
  if (!lecteur) return null;
  const morceaux: Uint8Array[] = [];
  let taille = 0;
  for (;;) {
    const { done, value } = await lecteur.read();
    if (done) break;
    taille += value.length;
    if (taille > REPONSE_MAX) {
      await lecteur.cancel();
      return null;
    }
    morceaux.push(value);
  }
  try {
    return JSON.parse(Buffer.concat(morceaux).toString('utf8'));
  } catch {
    return null;
  }
}

/**
 * Dépose l'offre scellée à la porte de la machine. Ne lève jamais : chaque
 * issue a un nom, et l'appelant révoque le billet sur tout ce qui n'est pas
 * `acceptee`.
 *
 * « Trop tôt » (la porte ouvre déjà une autre offre, ou en a ouvert une il y a
 * moins de `INTERVALLE_OFFRES_MS`) n'est PAS une réponse étrangère : c'est une
 * machine Hive occupée. On repasse UNE fois après ce délai ; encore occupée,
 * c'est `occupee` — « réessayez », et non « ce n'est peut-être pas une machine
 * Hive », qui accusait la mauvaise cause.
 *
 * `redirect: 'error'` : une porte d'offre ne redirige pas. Suivre une
 * redirection ferait de la Reine un client HTTP conduit ailleurs que sur le
 * segment local.
 */
export async function livrerOffre(
  cible: { adresse: string; port: number },
  offre: OffreScellee,
  delaiMs: number = DELAI_LIVRAISON_MS,
): Promise<IssueLivraison> {
  const premiere = await deposerOffre(cible, offre, delaiMs);
  if (premiere.issue !== 'occupee') return premiere;
  await new Promise((r) => setTimeout(r, INTERVALLE_OFFRES_MS + 100));
  return deposerOffre(cible, offre, delaiMs);
}

async function deposerOffre(
  cible: { adresse: string; port: number },
  offre: OffreScellee,
  delaiMs: number,
): Promise<IssueLivraison> {
  let rep: Response;
  try {
    rep = await fetch(`http://${cible.adresse}:${cible.port}/offre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(offre),
      redirect: 'error',
      signal: AbortSignal.timeout(delaiMs),
    });
  } catch (err) {
    return { issue: 'injoignable', detail: err instanceof Error ? err.message : String(err) };
  }
  const corps = (await lireBorne(rep).catch(() => null)) as {
    issue?: unknown;
    restants?: unknown;
  } | null;
  if (rep.status === 200 && corps?.issue === 'acceptee') return { issue: 'acceptee' };
  if (rep.status === 403 && corps?.issue === 'code_refuse') {
    return {
      issue: 'code_refuse',
      restants: typeof corps.restants === 'number' ? corps.restants : null,
    };
  }
  if (rep.status === 429 && corps?.issue === 'code_renouvele') return { issue: 'code_renouvele' };
  if (rep.status === 429 && corps?.issue === 'trop_tot') return { issue: 'occupee' };
  if (rep.status === 409 && corps?.issue === 'deja_accueillie') return { issue: 'deja_accueillie' };
  return { issue: 'reponse_inattendue', statut: rep.status };
}

// ─── L'adresse de la Reine, vue de la machine ────────────────────────────────

/** Une IPv4 en entier non signé, ou `null`. */
function ipv4EnEntier(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p) || Number(p) > 255) return null;
    n = n * 256 + Number(p);
  }
  return n;
}

/**
 * L'adresse de CETTE Reine sur le sous-réseau d'où la machine a été entendue,
 * ou `null` si aucune interface ne le partage.
 *
 * `detectLanWsUrl` prend la PREMIÈRE IPv4 non interne de l'hôte : sur une
 * Reine à plusieurs cartes, c'est souvent `docker0`, un vEthernet de WSL ou
 * un VPN. Le billet porté à la machine l'aurait envoyée là — offre ACCEPTÉE
 * (« elle apparaît d'ici quelques secondes »), puis échange du billet en
 * échec sur le seul écran de la machine. La découverte sait d'où la machine
 * parle : on choisit l'interface de ce réseau-là.
 */
export function adresseReineVers(
  cible: string,
  interfaces: NodeJS.Dict<os.NetworkInterfaceInfo[]> = os.networkInterfaces(),
): string | null {
  const c = ipv4EnEntier(cible);
  if (c === null) return null;
  for (const liste of Object.values(interfaces)) {
    for (const a of liste ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      const ip = ipv4EnEntier(a.address);
      const masque = ipv4EnEntier(a.netmask);
      if (ip === null || masque === null || masque === 0) continue;
      // `>>> 0` : les opérateurs binaires de JS sont signés sur 32 bits.
      if ((ip & masque) >>> 0 === (c & masque) >>> 0) return a.address;
    }
  }
  return null;
}
