// La machine qui se signale sur le réseau local — et qui n'entre que sur son code.
//
// ─── CE QUE CE FICHIER PORTE ─────────────────────────────────────────────────
//
//   · `Annonceur` : le répondeur mDNS. Il dit `_hive._tcp` avec les seuls
//     champs du contrat (`textesAnnonce`), répond aux questions de la Reine, et
//     dit ADIEU en partant (TTL 0) pour disparaître des écrans tout de suite ;
//   · `ecouterOffres` : la petite porte HTTP où une Reine dépose une offre
//     scellée. Elle n'ouvre que ce qui porte le code affiché ici ;
//   · `attendreUneRuche` : les deux, assemblés pour `hive join --decouvrable` ;
//   · `Signalement` : un nœud déjà membre qui se dit membre (`main.ts`,
//     `join.ts`), une seule copie pour les deux portes — elles ont déjà
//     divergé plus d'une fois.
//
// ─── POURQUOI LE NŒUD NE « REJOINT » JAMAIS TOUT SEUL ────────────────────────
//
// La porte d'offre n'accepte qu'une offre qui s'ouvre avec le code
// d'appariement — et ce code n'existe QUE sur l'écran de cette machine. Une
// ruche voisine qui l'entend se signaler ne peut rien en faire. Cinq essais par
// code, puis un nouveau code : deviner en ligne est hors de portée, et deviner
// hors ligne ne rapporte qu'un billet à usage unique qui expire en dix minutes.
//
// Tout le reste — l'échange du billet contre une clé, la connexion, le bac à
// sable — est le chemin ordinaire de `join.ts`. La découverte ne fait
// qu'apporter le billet jusqu'à la machine, scellé.
//
// Ce module est importable : `join.ts`, qui s'exécute à l'import, n'est pas
// éprouvable, et c'est ICI que vit ce qui mérite de l'être (§ 2.8 du carnet).

import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { randomInt } from 'node:crypto';
import { libelleAgent } from '../shared/agent-libelle.js';
import {
  SERVICE_HIVE,
  TTL_ANNONCE_S,
  formaterCode,
  ipv4Privee,
  ouvrirOffre,
  textesAnnonce,
  tirerCode,
  tirerInstance,
} from '../shared/decouverte.js';
import type { Annonce, ContenuOffre, FamilleAnnoncee } from '../shared/decouverte.js';
import { formaterEmpreinte } from '../shared/empreinte-ruche.js';
import { plateformeDepuis } from '../shared/machine.js';
import { TYPE_MDNS, decoderPaquet, encoderPaquet, memeNom } from '../shared/mdns.js';
import type { EnregistrementMdns } from '../shared/mdns.js';
import { interfacesLocales, ouvrirTransportUdp } from '../shared/mdns-reseau.js';
import type { TransportMdns } from '../shared/mdns-reseau.js';
import type { InventaireAgents } from './agent-detect.js';

/** Ce qu'une machine dit d'elle, hors état : ce qui ne change pas entre « libre » et « membre ». */
export type AnnonceBase = Omit<Annonce, 'etat' | 'ruche'>;

/**
 * L'annonce de CETTE machine, tirée de l'inventaire déjà fait au démarrage.
 *
 * `inventaire.tous` ne contient que les agents CONNECTÉS (#492) : un Cursor
 * installé mais non connecté n'y est pas, donc n'est pas annoncé — la Reine ne
 * doit pas voir sur le réseau une capacité que l'ouvrière refusera ensuite. Le
 * simulacre (`shell`) n'est pas un agent : il n'est jamais annoncé.
 */
export function annonceDeMachine(o: {
  nom: string;
  plateforme: string;
  inventaire: Pick<InventaireAgents, 'tous'>;
  places: number;
}): AnnonceBase {
  return {
    nom: o.nom,
    os: plateformeDepuis(o.plateforme),
    agents: o.inventaire.tous.filter((a): a is FamilleAnnoncee => a !== 'shell'),
    places: o.places,
  };
}

// ─── Le répondeur ────────────────────────────────────────────────────────────

export interface OptionsAnnonceur {
  transport: TransportMdns;
  /** Défaut : tiré au sort (`tirerInstance`). */
  instance?: string;
  /** Les IPv4 des enregistrements A. Défaut : `interfacesLocales()`. */
  adresses?: () => readonly string[];
}

export class Annonceur {
  readonly instance: string;
  private annonce: Annonce | null = null;
  private port = 0;
  private derniereReponse = 0;
  private arrete = false;

  constructor(private readonly o: OptionsAnnonceur) {
    this.instance = o.instance ?? tirerInstance();
    o.transport.surPaquet((paquet) => this.surPaquet(paquet));
  }

  private get nomInstance(): string {
    return `${this.instance}.${SERVICE_HIVE}`;
  }

  private get nomHote(): string {
    return `${this.instance}.local`;
  }

  /**
   * Pose ce que la machine dit d'elle, et l'annonce aussitôt. `port` est celui
   * de la porte d'offre — `0` pour un membre, qui n'en ouvre pas (RFC 6763
   * § 8 : un SRV au port 0 dit « service présent, rien à joindre »).
   *
   * Deux annonces à une seconde d'écart (RFC 6762 § 8.3) : un datagramme se
   * perd, et une Reine qui l'aurait manqué attendrait sa prochaine question.
   */
  annoncer(annonce: Annonce, port: number): void {
    if (this.arrete) return;
    this.annonce = annonce;
    this.port = port;
    this.emettre(TTL_ANNONCE_S);
    const rappel = setTimeout(() => {
      if (!this.arrete && this.annonce === annonce) this.emettre(TTL_ANNONCE_S);
    }, 1_000);
    rappel.unref();
  }

  /** L'adieu (TTL 0), puis la prise refermée. Idempotent. */
  async arreter(): Promise<void> {
    if (this.arrete) return;
    if (this.annonce) this.emettre(0);
    this.arrete = true;
    await this.o.transport.fermer();
  }

  private enregistrements(ttl: number): {
    reponses: EnregistrementMdns[];
    additionnels: EnregistrementMdns[];
  } {
    const annonce = this.annonce!;
    const adresses = (this.o.adresses ?? interfacesLocales)();
    return {
      // Le PTR est PARTAGÉ (toutes les machines Hive répondent au même nom de
      // service) : jamais de bit cache-flush dessus. SRV, TXT et A sont à nous
      // seuls : ils le portent (RFC 6762 § 10.2).
      reponses: [{ type: 'PTR', nom: SERVICE_HIVE, ttl, vidage: false, cible: this.nomInstance }],
      additionnels: [
        {
          type: 'SRV',
          nom: this.nomInstance,
          ttl,
          vidage: true,
          priorite: 0,
          poids: 0,
          port: this.port,
          cible: this.nomHote,
        },
        { type: 'TXT', nom: this.nomInstance, ttl, vidage: true, textes: textesAnnonce(annonce) },
        ...adresses.map((adresse): EnregistrementMdns => ({
          type: 'A',
          nom: this.nomHote,
          ttl,
          vidage: true,
          adresse,
        })),
      ],
    };
  }

  private emettre(ttl: number): void {
    if (this.arrete || !this.annonce) return;
    this.o.transport.emettre(
      encoderPaquet({ id: 0, reponse: true, questions: [], ...this.enregistrements(ttl) }),
    );
  }

  private surPaquet(brut: Buffer): void {
    if (this.arrete || !this.annonce) return;
    const p = decoderPaquet(brut);
    // Nos propres annonces nous reviennent (boucle multicast) : on ne répond
    // qu'aux QUESTIONS.
    if (!p || p.reponse) return;
    const { PTR, SRV, TXT, A, ANY } = TYPE_MDNS;
    const concerne = p.questions.some(
      (q) =>
        (memeNom(q.nom, SERVICE_HIVE) && (q.type === PTR || q.type === ANY)) ||
        (memeNom(q.nom, this.nomInstance) &&
          (q.type === SRV || q.type === TXT || q.type === ANY)) ||
        (memeNom(q.nom, this.nomHote) && (q.type === A || q.type === ANY)),
    );
    if (!concerne) return;
    // UNE réponse par seconde au plus (RFC 6762 § 6) : un voisin qui nous
    // bombarde de questions n'obtient pas un flot de réponses multicast — ce
    // serait lui offrir de quoi saturer le segment avec NOS paquets.
    const maintenant = Date.now();
    if (maintenant - this.derniereReponse < 1_000) return;
    this.derniereReponse = maintenant;
    // 20 à 120 ms d'attente : plusieurs machines Hive répondent à la même
    // question de service, et cet étalement évite qu'elles se marchent dessus.
    const delai = setTimeout(() => this.emettre(TTL_ANNONCE_S), 20 + randomInt(100));
    delai.unref();
  }
}

// ─── La porte d'offre ────────────────────────────────────────────────────────

/** Ce que la porte répond, à la Reine comme à quiconque frappe. */
export type ReponseOffre =
  | 'acceptee'
  | 'code_refuse'
  | 'code_renouvele'
  | 'deja_accueillie'
  | 'offre_illisible'
  | 'trop_tot';

/** Essais de code tolérés avant d'en tirer un nouveau. */
export const ESSAIS_PAR_CODE = 5;
/** Espacement minimal entre deux offres : chaque ouverture coûte un PBKDF2 à cette machine. */
export const INTERVALLE_OFFRES_MS = 500;
/** Au-delà, une offre n'en est pas une (une offre réelle fait moins de 2 Ko). */
const CORPS_MAX = 8 * 1024;

export interface OptionsEcoute {
  /** L'instance annoncée : l'offre est scellée POUR elle (données authentifiées). */
  instance: string;
  /** Défaut : toutes les interfaces. Un banc passe `127.0.0.1`. */
  hote?: string;
  /** Un code neuf a été tiré (au départ, puis après cinq refus). */
  surCode?: (code: string, motif: 'premier' | 'renouvele') => void;
  /** Tirage du code. Défaut : `tirerCode`. */
  tirer?: () => string;
}

export interface EcouteOffres {
  readonly port: number;
  /** Le code en vigueur, tel qu'il est affiché. */
  code(): string;
  /** Résolue à la première offre qui s'ouvre avec le code. */
  readonly offre: Promise<ContenuOffre>;
  fermer(): Promise<void>;
}

const STATUT: Record<ReponseOffre, number> = {
  acceptee: 200,
  offre_illisible: 400,
  code_refuse: 403,
  deja_accueillie: 409,
  code_renouvele: 429,
  trop_tot: 429,
};

function repondre(res: ServerResponse, issue: ReponseOffre, extra: object = {}): void {
  res.writeHead(STATUT[issue], { 'content-type': 'application/json', connection: 'close' });
  res.end(JSON.stringify({ issue, ...extra }));
}

/** Le corps, borné : au-delà de `CORPS_MAX`, `null` et la connexion est coupée. */
function lireCorps(req: IncomingMessage): Promise<string | null> {
  return new Promise((resoudre) => {
    const morceaux: Buffer[] = [];
    let taille = 0;
    req.on('data', (m: Buffer) => {
      taille += m.length;
      if (taille > CORPS_MAX) {
        resoudre(null);
        req.destroy();
        return;
      }
      morceaux.push(m);
    });
    req.on('end', () => resoudre(Buffer.concat(morceaux).toString('utf8')));
    req.on('error', () => resoudre(null));
  });
}

/** Ouvre la porte d'offre sur un port éphémère. */
export async function ecouterOffres(o: OptionsEcoute): Promise<EcouteOffres> {
  const tirer = o.tirer ?? tirerCode;
  let code = tirer();
  let refus = 0;
  let dernierEssai = 0;
  let enCours = false;
  let accueillie = false;
  let accepter: (c: ContenuOffre) => void = () => {};
  const offre = new Promise<ContenuOffre>((resoudre) => {
    accepter = resoudre;
  });

  const traiter = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST' || req.url !== '/offre') {
      res.writeHead(404, { connection: 'close' }).end();
      return;
    }
    // Le segment local seulement : voir `ipv4Privee`.
    if (ipv4Privee(req.socket.remoteAddress) === null) {
      res.writeHead(403, { connection: 'close' }).end();
      return;
    }
    if (accueillie) return repondre(res, 'deja_accueillie');
    // Le corps est lu AVANT de prendre le tour : une connexion qui l'égrène
    // octet par octet ne tient pas la porte fermée aux autres — elle ne tient
    // que la sienne, jusqu'au `requestTimeout`.
    const corps = await lireCorps(req);
    let brut: unknown;
    try {
      brut = corps === null ? null : JSON.parse(corps);
    } catch {
      brut = null;
    }
    // UNE ouverture à la fois, et pas plus d'une par demi-seconde : chacune
    // coûte 100 000 itérations de PBKDF2, et cette porte est ouverte à tout le
    // segment. Sans ça, un voisin occuperait un cœur de la machine à volonté.
    const maintenant = Date.now();
    if (accueillie) return repondre(res, 'deja_accueillie');
    if (enCours || maintenant - dernierEssai < INTERVALLE_OFFRES_MS) {
      return repondre(res, 'trop_tot');
    }
    dernierEssai = maintenant;
    enCours = true;
    try {
      const ouverture = await ouvrirOffre(brut, code, o.instance);
      if (accueillie) return repondre(res, 'deja_accueillie');
      if (ouverture.issue === 'illisible') return repondre(res, 'offre_illisible');
      if (ouverture.issue === 'refusee') {
        refus += 1;
        if (refus < ESSAIS_PAR_CODE) {
          return repondre(res, 'code_refuse', { restants: ESSAIS_PAR_CODE - refus });
        }
        // Cinq refus : ce code est brûlé. Le suivant s'affiche sur CETTE
        // machine, et il faudra de nouveau le lire sur son écran.
        refus = 0;
        code = tirer();
        o.surCode?.(code, 'renouvele');
        return repondre(res, 'code_renouvele');
      }
      accueillie = true;
      repondre(res, 'acceptee');
      accepter(ouverture.contenu);
    } finally {
      enCours = false;
    }
  };

  const serveur = createServer((req, res) => {
    traiter(req, res).catch(() => {
      if (!res.headersSent) res.writeHead(500, { connection: 'close' }).end();
    });
  });
  // Une requête qui traîne ne garde pas la porte ouverte indéfiniment.
  serveur.requestTimeout = 10_000;
  serveur.headersTimeout = 5_000;
  await new Promise<void>((resoudre, rejeter) => {
    serveur.once('error', rejeter);
    serveur.listen(0, o.hote ?? '0.0.0.0', () => {
      serveur.off('error', rejeter);
      resoudre();
    });
  });
  o.surCode?.(code, 'premier');

  return {
    port: (serveur.address() as AddressInfo).port,
    code: () => code,
    offre,
    fermer: () =>
      new Promise<void>((resoudre) => {
        serveur.closeAllConnections();
        serveur.close(() => resoudre());
      }),
  };
}

// ─── L'attente, assemblée ────────────────────────────────────────────────────

export interface OptionsAttente {
  annonce: AnnonceBase;
  /** La prise mDNS. Défaut : la vraie (UDP 5353, toutes les interfaces). */
  ouvrirTransport?: () => Promise<TransportMdns>;
  /** Où ouvrir la porte d'offre. Défaut : toutes les interfaces. */
  hote?: string;
  /** Les IPv4 annoncées (enregistrements A). Défaut : `interfacesLocales()`. */
  adresses?: () => readonly string[];
  /** Où parler à l'humain. Défaut : la console. */
  dire?: (ligne: string) => void;
  /** Abandon (Ctrl+C) : l'adieu part, la porte se ferme, la promesse est rejetée. */
  signal?: AbortSignal;
}

/** Les lignes qui disent CE QUE LA MACHINE MONTRE d'elle — celles qu'on lit avant de donner le code. */
export function lignesAnnonce(a: AnnonceBase): string[] {
  const systeme = { linux: 'Linux', macos: 'macOS', windows: 'Windows', autre: 'autre système' }[
    a.os
  ];
  const agents =
    a.agents.length > 0
      ? a.agents.map((f) => libelleAgent(f)).join(', ')
      : 'aucun agent IA connecté (simulation)';
  return [
    `🐝 Cette machine se signale sur le réseau local : « ${a.nom} »`,
    `   ${systeme} · ${agents} · ${a.places} place${a.places > 1 ? 's' : ''}`,
    '   (rien d’autre n’est diffusé : ni version, ni chemin, ni clé)',
  ];
}

/** Les lignes du code, et le geste à faire de l'autre côté. */
export function lignesCode(code: string, motif: 'premier' | 'renouvele'): string[] {
  return [
    motif === 'premier'
      ? `   🔑 Code d'appariement : ${formaterCode(code)}`
      : `   ⚠ Trop de codes erronés reçus : l'ancien est retiré. Nouveau code : ${formaterCode(code)}`,
    '   Dans le tableau de bord de la ruche : Inviter → « Sur votre réseau local » → Rejoindre,',
    '   puis saisissez ce code. Sans lui, aucune ruche n’entre ici.',
  ];
}

/**
 * `hive join --decouvrable` : se signaler, attendre, et rendre le billet de la
 * première ruche qui présente le bon code. L'annonceur reste vivant : la
 * machine se dit aussitôt MEMBRE de la ruche qui l'accueille, et c'est à
 * l'appelant de le refermer à l'arrêt.
 *
 * LÈVE si la prise mDNS ne s'ouvre pas — `join.ts` le dit, et renvoie au billet.
 */
export async function attendreUneRuche(
  o: OptionsAttente,
): Promise<{ contenu: ContenuOffre; annonceur: Annonceur }> {
  const dire = o.dire ?? ((l: string) => console.log(l));
  const transport = await (o.ouvrirTransport ?? (() => ouvrirTransportUdp()))();
  const annonceur = new Annonceur({
    transport,
    ...(o.adresses ? { adresses: o.adresses } : {}),
  });
  let porte: EcouteOffres;
  try {
    for (const l of lignesAnnonce(o.annonce)) dire(l);
    porte = await ecouterOffres({
      instance: annonceur.instance,
      ...(o.hote ? { hote: o.hote } : {}),
      surCode: (code, motif) => {
        for (const l of lignesCode(code, motif)) dire(l);
      },
    });
  } catch (err) {
    await annonceur.arreter();
    throw err;
  }
  annonceur.annoncer({ ...o.annonce, etat: 'libre', ruche: null }, porte.port);
  dire('   En attente d’une ruche… (Ctrl+C pour quitter)');

  let contenu: ContenuOffre;
  try {
    contenu = await new Promise<ContenuOffre>((resoudre, rejeter) => {
      if (o.signal?.aborted) rejeter(new Error('attente abandonnée'));
      o.signal?.addEventListener('abort', () => rejeter(new Error('attente abandonnée')), {
        once: true,
      });
      porte.offre.then(resoudre, rejeter);
    });
  } catch (err) {
    await Promise.all([porte.fermer(), annonceur.arreter()]);
    throw err;
  }
  await porte.fermer();
  // Aussitôt MEMBRE : laisser « libre » avec une porte refermée ferait
  // proposer « Rejoindre » vers une machine qui ne répond plus.
  annonceur.annoncer({ ...o.annonce, etat: 'membre', ruche: contenu.ruche }, 0);
  dire(`   ✔ Offre reçue — ruche d'empreinte ${formaterEmpreinte(contenu.ruche)}.`);
  return { contenu, annonceur };
}

// ─── Le membre qui se signale ────────────────────────────────────────────────

/**
 * Un nœud membre qui se dit membre, à chaque inscription dans sa ruche.
 *
 * L'empreinte vient du message `registered` de la Reine : c'est elle, et pas
 * le nœud, qui sait qui elle est. Une Reine d'une version antérieure n'en
 * envoie pas : la machine se dit alors membre d'une ruche INCONNUE — jamais
 * d'une ruche inventée.
 *
 * La prise ne s'ouvre qu'à la première inscription : un nœud qui ne rejoint
 * jamais sa ruche n'a rien à dire au réseau.
 */
export class Signalement {
  private annonceur: Annonceur | null;
  private ouverture: Promise<Annonceur | null> | null = null;
  private arrete = false;

  constructor(
    private readonly base: AnnonceBase,
    private readonly o: {
      annonceur?: Annonceur | null;
      ouvrirTransport?: () => Promise<TransportMdns>;
      dire?: (ligne: string) => void;
    } = {},
  ) {
    this.annonceur = o.annonceur ?? null;
  }

  /** À appeler à chaque `registered` (`NodeClientOptions.surInscription`). */
  inscrit(ruche: string | null): void {
    if (this.arrete) return;
    const annonce: Annonce = { ...this.base, etat: 'membre', ruche };
    if (this.annonceur) {
      this.annonceur.annoncer(annonce, 0);
      return;
    }
    this.ouverture ??= (this.o.ouvrirTransport ?? (() => ouvrirTransportUdp()))().then(
      (transport) => {
        this.annonceur = new Annonceur({ transport });
        if (this.arrete) void this.annonceur.arreter();
        return this.annonceur;
      },
      (err: unknown) => {
        // Dit une fois, et le nœud continue : sa place dans la ruche ne dépend
        // pas de sa visibilité sur le réseau.
        (this.o.dire ?? ((l: string) => console.warn(l)))(
          `   ⚠ Découverte réseau indisponible (${err instanceof Error ? err.message : String(err)}) : ` +
            'la machine travaille, mais ne se signale pas.',
        );
        return null;
      },
    );
    void this.ouverture.then((a) => a?.annoncer(annonce, 0));
  }

  async arreter(): Promise<void> {
    this.arrete = true;
    const a = this.annonceur ?? (this.ouverture ? await this.ouverture : null);
    await a?.arreter();
  }
}
