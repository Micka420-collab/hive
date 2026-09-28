// Le hub des connecteurs — le point unique où la ruche parle au monde extérieur
// et où elle écoute la seule voie qu'on lui a ouverte.
//
// ─── CE QUE CE MODULE CENTRALISE, ET POURQUOI IL LE FAUT ────────────────────
//
// Un fan-out qui vivrait éclaté dans server.ts (un `fetch` Slack ici, un webhook
// là) finirait par diverger : l'un caviarderait, l'autre non ; l'un
// journaliserait, l'autre oublierait. Tout passe donc ICI :
//
//   1. la lecture du secret (dans le `.env` Queen, JAMAIS en base, JAMAIS au nœud) ;
//   2. la vérification de la portée accordée au projet (pas de portée ⇒ rien) ;
//   3. le caviardage de la charge AVANT toute trace (empreinte + aperçu) ;
//   4. l'écriture au journal append-only — un envoi réussi comme un envoi raté.
//
// La boucle ENTRANTE (Socket Mode Slack) suit la même discipline : une
// interaction n'applique une décision que si le projet a la portée `approbation`
// ET que le canal et l'usager sont explicitement inscrits, et elle rejoint la
// revue existante par `appliquerRevue` — jamais une autorité nouvelle.
//
// I/O injectée : `fetch` (webhook + Slack), fabrique de WebSocket (`ws`), et le
// rappel `appliquerRevue` (fermé sur le store/scheduler du serveur). Un test
// pilote des faux ; la preuve Slack VIVE demande un atelier réel (hors machine).

import { createHash } from 'node:crypto';
import { creerCaviardeur, valeursSecretes, type Caviardeur } from '../shared/caviardage.js';
import type { HiveStore } from './store.js';
import {
  porteePourEvenement,
  type EvenementConnecteur,
  type LiaisonApprobation,
  type Portee,
} from '../connectors/contrat.js';
import { definitionConnecteur, listerDefinitions } from '../connectors/registre.js';
import {
  ENV_WEBHOOK_SECRET,
  ENV_WEBHOOK_URL,
  urlWebhookValide,
} from '../connectors/webhook/definition.js';
import { construireRequeteWebhook } from '../connectors/webhook/charge.js';
import { envoyerWebhook, type FetchLike } from '../connectors/webhook/envoi.js';
import {
  ENV_SLACK_APP,
  ENV_SLACK_BOT,
  ENV_SLACK_CANAUX,
  canauxDeLaRuche,
} from '../connectors/slack/definition.js';
import { echapperMrkdwn, messagePourEvenement } from '../connectors/slack/messages.js';
import {
  accuse,
  corpsPostMessage,
  ouvrirConnexionSocket,
  parserEnveloppe,
  posterMessageSlack,
  repondreInteraction,
  type SlackFetch,
  type WsFactory,
  type WsLike,
} from '../connectors/slack/client.js';
import {
  autoriserInteraction,
  extraireInteraction,
  type ExtractionInteraction,
} from '../connectors/slack/interactions.js';

/**
 * Le verdict que le serveur rend quand le hub lui demande d'appliquer une revue.
 * `perime` : la production n'est plus la dernière, ou le verdict humain a bougé
 * depuis l'envoi du message — le clic portait sur un état qui n'existe plus.
 */
export type ResultatRevueConnecteur = 'applique' | 'tache_inconnue' | 'non_terminal' | 'perime';

/** Ce que le cliqueur lit quand son clic est refusé — la raison, pas un « non » muet. */
const MOTIF_REFUS_LISIBLE: Record<string, string> = {
  tache_inconnue: 'cette tâche est inconnue de la ruche.',
  non_autorise: 'Slack n’est pas autorisé sur ce projet.',
  portee_absente: 'la portée « approbation » n’est pas accordée à ce projet.',
  canal_refuse: 'ce canal n’est pas inscrit pour les approbations de ce projet.',
  usager_refuse: 'vous n’êtes pas inscrit comme approbateur de ce projet.',
  non_terminal: 'la tâche n’est pas terminée — rien à juger encore.',
  perime:
    'ce message est périmé : la production ou son verdict ont changé depuis. Voyez la Miellerie.',
  erreur: 'la ruche n’a pas pu appliquer ce verdict (erreur interne, consignée au journal).',
};

/** L'issue d'un envoi, telle que le bouton « tester » la rend à l'humain. */
type IssueEnvoi = { readonly ok: true } | { readonly ok: false; readonly motif: string };

export interface DepsHub {
  readonly store: HiveStore;
  readonly env: NodeJS.ProcessEnv;
  /** Applique une revue humaine par le CHEMIN CANONIQUE du serveur (jamais un doublon). */
  readonly appliquerRevue: (
    taskId: string,
    verdict: 'approved' | 'rejected',
    liaison: LiaisonApprobation,
    /** Qui a cliqué : `slack:<U…>`, la provenance écrite au fait. */
    par: string,
  ) => ResultatRevueConnecteur;
  /** `fetch` pour les webhooks sortants (défaut : global). */
  readonly fetchWebhook?: FetchLike;
  /** `fetch` pour l'API Slack (défaut : global). */
  readonly fetchSlack?: SlackFetch;
  /** Fabrique de WebSocket pour le Socket Mode (défaut : `ws`). */
  readonly wsFactory?: WsFactory;
  /** Journalise (test/observabilité). */
  readonly log?: (msg: string) => void;
  /**
   * La porte des actions irréversibles (`missions.ts`, `porteIrreversible`) :
   * un envoi vers l'extérieur EST une action qu'on ne reprend pas. Sur un
   * projet de rejeu, elle rend `simulee` — l'envoi est rangé et journalisé,
   * jamais parti. Absente : tout part (bancs du hub seul).
   */
  readonly porteSortie?: (demande: { projectId: string; cible: string }) => 'executer' | 'simulee';
}

/**
 * Empreinte + aperçu d'une charge DÉJÀ caviardée (`caviarderEvenement`), prise
 * sur les OCTETS EXACTS de la requête (corps webhook signé ; corps
 * `chat.postMessage` canal compris) : l'empreinte rapproche une entrée du
 * journal du corps que le récepteur a reçu. La base n'en garde que les 200
 * premiers caractères, caviardés — un aperçu pour l'humain, pas le corps entier.
 */
function empreinte(charge: string): { chargeDigest: string; apercu: string } {
  const chargeDigest = createHash('sha256').update(charge, 'utf8').digest('hex');
  const apercu = charge.length <= 200 ? charge : `${charge.slice(0, 199)}…`;
  return { chargeDigest, apercu };
}

export class HubConnecteurs {
  private readonly deps: DepsHub;
  private readonly fetchWebhook: FetchLike;
  private readonly fetchSlack: SlackFetch;
  private readonly wsFactory: WsFactory | null;
  private socket: WsLike | null = null;
  /**
   * L'ouverture en cours, s'il y en a une. `socket` n'est posé qu'APRÈS l'appel
   * `apps.connections.open` : sans ce verrou, deux `demarrer` qui se chevauchent
   * (démarrage + pose d'un secret, ou une route + le minuteur de reconnexion)
   * ouvraient DEUX sockets — l'orphelin survivait à `fermer()`, retenait le
   * processus, et se reconnectait tout seul à sa fermeture par Slack.
   */
  private ouverture: Promise<void> | null = null;
  private ferme = false;
  private reconnexion: ReturnType<typeof setTimeout> | null = null;

  constructor(deps: DepsHub) {
    this.deps = deps;
    this.fetchWebhook =
      deps.fetchWebhook ?? ((url, init) => fetch(url, init) as ReturnType<FetchLike>);
    this.fetchSlack =
      deps.fetchSlack ?? ((url, init) => fetch(url, init) as ReturnType<SlackFetch>);
    this.wsFactory = deps.wsFactory ?? null;
  }

  private secret(nom: string): string {
    return (this.deps.env[nom] ?? '').trim();
  }

  /** Les canaux que l'administrateur permet (`SLACK_CANAUX`) : l'envoi et l'écoute s'y bornent. */
  private canauxRuche(): ReadonlySet<string> {
    return canauxDeLaRuche(this.secret(ENV_SLACK_CANAUX));
  }

  /**
   * Le caviardeur de ce qui QUITTE la ruche : les valeurs des secrets des
   * connecteurs (l'URL du webhook peut porter un jeton), celles des variables
   * d'identification de l'env Queen (`HIVE_TOKEN`, clés d'API…), et les motifs
   * de jetons connus. Un titre de tâche ou un motif d'échec est écrit par un
   * humain ou un agent : rien ne garantit qu'il ne contient pas une clé collée
   * par erreur — et Slack, lui, la garderait pour toujours.
   */
  private caviardeur(): Caviardeur {
    const noms = [ENV_WEBHOOK_SECRET, ENV_WEBHOOK_URL, ENV_SLACK_BOT, ENV_SLACK_APP];
    const connecteurs = noms.map((n) => this.secret(n)).filter((v) => v.length > 0);
    return creerCaviardeur([...connecteurs, ...valeursSecretes(this.deps.env)]);
  }

  /** L'événement tel qu'il PEUT partir : titre et corps caviardés, le reste structurel. */
  private caviarderEvenement(ev: EvenementConnecteur): EvenementConnecteur {
    const c = this.caviardeur();
    return {
      ...ev,
      titre: c.texte(ev.titre),
      ...(ev.corps !== undefined ? { corps: c.texte(ev.corps) } : {}),
    };
  }

  /**
   * Le hub est-il fermé ? L'arrêt de la Reine le ferme AVANT la base : ce qui
   * lit la base pour le hub (le relais d'événements, différé d'un tour) le
   * consulte d'abord, sans quoi un événement émis juste avant l'arrêt lisait
   * une base déjà fermée — une exception non rattrapée en plein arrêt.
   */
  estFerme(): boolean {
    return this.ferme;
  }

  /** Un connecteur est ACTIF si tous ses secrets requis sont posés dans l'env Queen. */
  estActif(connecteurId: string): boolean {
    const def = definitionConnecteur(connecteurId);
    if (!def) return false;
    return def.secrets.every((s) => !s.requis || this.secret(s.envVar) !== '');
  }

  /**
   * Pousse un événement vers TOUS les connecteurs actifs qui ont la portée
   * requise sur ce projet. Chaque envoi — réussi ou non — laisse une entrée au
   * journal. Un connecteur inactif (secret absent) ou sans la portée est
   * silencieusement sauté : ce n'est pas un envoi raté, c'est un non-envoi.
   */
  async notifier(evenement: EvenementConnecteur): Promise<void> {
    if (this.ferme) return;
    const propre = this.caviarderEvenement(evenement);
    for (const def of listerDefinitions()) {
      if (!this.estActif(def.id)) continue;
      const autorisation = this.deps.store.lireAutorisationConnecteur(def.id, evenement.projectId);
      if (!autorisation || !autorisation.actif) continue;
      const requise = porteePourEvenement(evenement.kind, def.mode);
      if (!autorisation.portees.includes(requise)) continue;
      // En DERNIER, une fois toutes les autres portes franchies : la
      // simulation dit exactement « ceci serait parti ».
      const cible = `${def.id}:${evenement.kind}:${evenement.taskId ?? evenement.projectId}`;
      if (this.deps.porteSortie?.({ projectId: evenement.projectId, cible }) === 'simulee') {
        continue;
      }
      await this.envoyer(def.id, propre, requise, autorisation.canaux, 'ruche');
    }
  }

  /** L'aiguillage par connecteur : un seul endroit sait quel envoi appartient à qui. */
  private async envoyer(
    connecteurId: string,
    evenement: EvenementConnecteur,
    portee: Portee,
    canaux: readonly string[],
    qui: string,
  ): Promise<IssueEnvoi | null> {
    if (connecteurId === 'webhook') return this.envoyerWebhook(evenement, portee, qui);
    if (connecteurId === 'slack') return this.envoyerSlack(evenement, portee, canaux, qui);
    return null;
  }

  private async envoyerWebhook(
    evenement: EvenementConnecteur,
    portee: Portee,
    qui: string,
  ): Promise<IssueEnvoi> {
    const url = this.secret(ENV_WEBHOOK_URL);
    const secret = this.secret(ENV_WEBHOOK_SECRET);
    // La route de pose refuse déjà une telle URL ; une URL écrite à la main
    // dans le `.env` passe par ici aussi : rien ne part en clair sur le réseau.
    if (!urlWebhookValide(url)) {
      const motif = 'URL refusée : https:// exigé (http:// seulement vers la boucle locale)';
      this.deps.store.journaliserConnecteur({
        connecteurId: 'webhook',
        projectId: evenement.projectId,
        portee,
        acte: evenement.kind,
        cible: evenement.taskId ?? null,
        resultat: 'refuse',
        qui,
        apercu: motif,
      });
      return { ok: false, motif };
    }
    const requete = construireRequeteWebhook({ url, secret, evenement, now: Date.now() });
    const trace = empreinte(requete.corps);
    const res = await envoyerWebhook(requete, this.fetchWebhook);
    // Le motif d'un échec réseau peut citer l'URL (et le jeton qu'elle porte).
    const motif = res.ok ? undefined : this.caviardeur().texte(res.motif);
    this.deps.store.journaliserConnecteur({
      connecteurId: 'webhook',
      projectId: evenement.projectId,
      portee,
      acte: evenement.kind,
      cible: evenement.taskId ?? null,
      resultat: res.ok ? 'ok' : 'echec',
      qui,
      apercu: motif === undefined ? trace.apercu : `${trace.apercu} — ${motif}`,
      chargeDigest: trace.chargeDigest,
    });
    return motif === undefined ? { ok: true } : { ok: false, motif };
  }

  private async envoyerSlack(
    evenement: EvenementConnecteur,
    portee: Portee,
    inscrits: readonly string[],
    qui: string,
  ): Promise<IssueEnvoi> {
    const token = this.secret(ENV_SLACK_BOT);
    const message = messagePourEvenement(evenement, { boutons: this.boucleEntrantePosee() });
    // Un canal inscrit par le projet mais retiré depuis de la liste de la ruche
    // (`SLACK_CANAUX`, tenue par l'administrateur) ne reçoit rien : refusé,
    // et le journal le dit, canal par canal.
    const ruche = this.canauxRuche();
    const horsRuche = inscrits.filter((c) => !ruche.has(c));
    for (const channel of horsRuche) {
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: evenement.projectId,
        portee,
        acte: evenement.kind,
        cible: evenement.taskId ?? null,
        resultat: 'refuse',
        qui,
        apercu: `#${channel} — hors des canaux permis par l’administrateur (${ENV_SLACK_CANAUX})`,
      });
    }
    if (horsRuche.length > 0 && horsRuche.length === inscrits.length) {
      return { ok: false, motif: `canaux hors de la liste de la ruche (${ENV_SLACK_CANAUX})` };
    }
    const canaux = inscrits.filter((c) => ruche.has(c));
    // On poste dans CHAQUE canal inscrit : « configurés explicitement » vaut
    // pour l'envoi comme pour l'écoute. Aucun canal ⇒ rien n'est posté (et une
    // entrée `refuse` le dit, plutôt qu'un silence).
    if (canaux.length === 0) {
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: evenement.projectId,
        portee,
        acte: evenement.kind,
        cible: evenement.taskId ?? null,
        resultat: 'refuse',
        qui,
        apercu: 'aucun canal configuré',
      });
      return { ok: false, motif: 'aucun canal configuré' };
    }
    const echecs: string[] = [];
    const caviardeur = this.caviardeur();
    const motif = (brut: string): string => caviardeur.texte(brut).slice(0, 200);
    for (const channel of canaux) {
      // L'empreinte couvre le corps EXACT de la requête de CE canal.
      const trace = empreinte(corpsPostMessage(channel, message));
      const res = await posterMessageSlack({ token, channel, message }, this.fetchSlack);
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: evenement.projectId,
        portee,
        acte: evenement.kind,
        cible: evenement.taskId ?? null,
        resultat: res.ok ? 'ok' : 'echec',
        qui,
        // Le motif d'un échec vient de Slack (ou du réseau) : caviardé comme
        // tout ce qui est journalisé.
        apercu: res.ok ? `#${channel} ${trace.apercu}` : `#${channel} — ${motif(res.motif)}`,
        chargeDigest: trace.chargeDigest,
      });
      if (!res.ok) echecs.push(`#${channel} : ${motif(res.motif)}`);
    }
    return echecs.length === 0 ? { ok: true } : { ok: false, motif: echecs.join(' ; ') };
  }

  /**
   * Envoie un fait à travers UN SEUL connecteur, pour le bouton « tester » de
   * l'Intendance. Rend pourquoi rien n'est parti (inactif, non autorisé, portée
   * manquante) plutôt qu'un silence — un test muet ne prouve rien.
   */
  async tester(
    connecteurId: string,
    evenement: EvenementConnecteur,
    qui: string,
  ): Promise<{ envoye: boolean; motif?: string }> {
    const def = definitionConnecteur(connecteurId);
    if (!def) return { envoye: false, motif: 'connecteur inconnu' };
    if (!this.estActif(connecteurId)) return { envoye: false, motif: 'connecteur inactif' };
    const autorisation = this.deps.store.lireAutorisationConnecteur(
      connecteurId,
      evenement.projectId,
    );
    if (!autorisation || !autorisation.actif)
      return { envoye: false, motif: 'non autorisé sur ce projet' };
    const portee = porteePourEvenement(evenement.kind, def.mode);
    if (!autorisation.portees.includes(portee))
      return { envoye: false, motif: 'portée non accordée' };
    const cible = `${connecteurId}:test`;
    if (this.deps.porteSortie?.({ projectId: evenement.projectId, cible }) === 'simulee') {
      return { envoye: false, motif: 'projet de rejeu : envoi simulé, rien n’est parti' };
    }
    const propre = this.caviarderEvenement(evenement);
    const issue = await this.envoyer(connecteurId, propre, portee, autorisation.canaux, qui);
    // L'issue RÉELLE de l'envoi : un récepteur qui répond 500, un canal où le
    // bot n'est pas invité, disent « échec » ici comme au journal — un bouton
    // qui annoncerait « envoyé » sur un 500 ferait croire le connecteur prêt.
    if (issue === null) return { envoye: false, motif: 'connecteur sans émission' };
    return issue.ok ? { envoye: true } : { envoye: false, motif: issue.motif };
  }

  // ─── Socket Mode entrant (approbations Slack) ───────────────────────────────

  /**
   * La boucle entrante est-elle POSÉE (fabrique de socket + jeton d'app) ? C'est
   * ce qui décide si une demande d'approbation porte des boutons : sans boucle,
   * un bouton serait un clic qui n'aboutit nulle part et que rien ne consigne.
   * On lit la configuration, pas l'état instantané du socket — une reconnexion
   * de cinq secondes ne doit pas faire partir une demande sans boutons.
   */
  private boucleEntrantePosee(): boolean {
    return this.wsFactory !== null && this.secret(ENV_SLACK_APP) !== '';
  }

  /**
   * Ouvre le Socket Mode si — et seulement si — le jeton d'app est posé. Sans
   * lui, aucune connexion ne s'ouvre : c'est le défaut, et il ne crée ni ne
   * propage aucun jeton. Idempotent, y compris en appels concurrents ; sûr à
   * appeler au démarrage.
   */
  async demarrer(): Promise<void> {
    if (this.ferme || this.socket !== null) return;
    if (!this.boucleEntrantePosee() || this.secret(ENV_SLACK_BOT) === '') return;
    await this.connecter();
  }

  /** Une seule ouverture à la fois : un appel concurrent rejoint celle en cours. */
  private connecter(): Promise<void> {
    if (this.ouverture !== null) return this.ouverture;
    this.ouverture = this.ouvrir().finally(() => {
      this.ouverture = null;
    });
    return this.ouverture;
  }

  private async ouvrir(): Promise<void> {
    if (this.ferme || this.wsFactory === null || this.socket !== null) return;
    const appToken = this.secret(ENV_SLACK_APP);
    const ouverture = await ouvrirConnexionSocket(appToken, this.fetchSlack);
    if (!ouverture.ok) {
      this.deps.log?.(`[connecteurs] Socket Mode Slack indisponible : ${ouverture.motif}`);
      this.planifierReconnexion();
      return;
    }
    if (this.ferme || this.socket !== null) return;
    const ws = this.wsFactory(ouverture.url);
    this.socket = ws;
    ws.on('message', (data) => {
      void this.surMessage(ws, data);
    });
    ws.on('close', () => {
      if (this.socket === ws) this.socket = null;
      this.planifierReconnexion();
    });
    ws.on('error', () => {
      // Le 'close' suit toujours un 'error' côté `ws` ; la reconnexion s'y fait.
    });
  }

  private planifierReconnexion(): void {
    if (this.ferme || this.reconnexion !== null) return;
    // Backoff fixe et modeste : ce n'est pas une file critique, et un backoff
    // agressif martèlerait l'API Slack. Le timer ne retient pas le processus.
    this.reconnexion = setTimeout(() => {
      this.reconnexion = null;
      void this.connecter();
    }, 5_000);
    this.reconnexion.unref?.();
  }

  private async surMessage(ws: WsLike, data: unknown): Promise<void> {
    const enveloppe = parserEnveloppe(data);
    if (enveloppe === null) return;
    // Toute enveloppe à `envelope_id` DOIT être acquittée, sinon Slack la
    // renvoie et coupe la connexion. On acquitte AVANT de traiter.
    if (typeof enveloppe.envelope_id === 'string') ws.send(accuse(enveloppe.envelope_id));
    if (enveloppe.type === 'disconnect') {
      if (this.socket === ws) this.socket = null;
      ws.close();
      this.planifierReconnexion();
      return;
    }
    if (enveloppe.type !== 'interactive' || enveloppe.payload === undefined) return;
    // L'enveloppe est DÉJÀ acquittée : Slack ne la renverra pas. Une exception
    // ici (base occupée pendant `appliquerRevue`…) perdrait l'approbation sans
    // trace — on la consigne au journal plutôt qu'au seul logger global.
    try {
      await this.traiterInteraction(enveloppe.payload);
    } catch (err) {
      // Fermé entre-temps (arrêt de la Reine) : la base l'est peut-être aussi,
      // et y consigner l'échec lèverait à son tour, cette fois sans filet.
      if (this.ferme) return;
      this.deps.log?.(
        `[connecteurs] interaction Slack non traitée : ${err instanceof Error ? err.message : err}`,
      );
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: null,
        portee: 'approbation',
        acte: 'approbation_recue',
        cible: null,
        resultat: 'echec',
        qui: 'slack',
        apercu: this.caviardeur().texte(err instanceof Error ? err.message : 'erreur'),
      });
    }
  }

  /**
   * Traite une interaction entrante : parse, résout la tâche→projet (autorité),
   * vérifie portée + canal + usager, applique la revue par le chemin canonique
   * (qui revérifie la tâche terminée ET la liaison production/verdict), journalise
   * le résultat (appliqué comme refusé), puis RÉPOND au cliqueur. Rien ici ne
   * fait confiance au `block_id` : le projet vient de la tâche.
   *
   * La décision et le journal sont synchrones ; seule la réponse à Slack attend
   * le réseau, APRÈS que la ruche a tranché.
   */
  async traiterInteraction(payload: unknown): Promise<void> {
    const extrait = extraireInteraction(payload);
    if (!extrait.ok) {
      // `type_ignore` / `action_ignore` ne sont pas des refus d'accès : rien à
      // journaliser (ce ne sont pas des tentatives d'approbation).
      if (extrait.motif === 'type_ignore' || extrait.motif === 'action_ignore') return;
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: null,
        portee: 'approbation',
        acte: 'approbation_recue',
        cible: null,
        resultat: 'refuse',
        qui: 'slack',
        apercu: extrait.motif,
      });
      return;
    }
    const ex = extrait.extraction;
    const task = this.deps.store.getTask(ex.taskId);
    if (!task) {
      this.journalRefus(ex.userId, ex.taskId, 'tache_inconnue');
      await this.repondreRefus(ex, null, 'tache_inconnue');
      return;
    }
    const projectId = task.projectId;
    const autorisation = this.deps.store.lireAutorisationConnecteur('slack', projectId);
    if (!autorisation || !autorisation.actif) {
      this.journalRefus(ex.userId, ex.taskId, 'non_autorise', projectId);
      await this.repondreRefus(ex, projectId, 'non_autorise');
      return;
    }
    const verdict = autoriserInteraction(ex, {
      portees: autorisation.portees as Portee[],
      // Un clic depuis un canal que la ruche ne permet plus ne vaut rien, même
      // inscrit sur le projet.
      canaux: autorisation.canaux.filter((c) => this.canauxRuche().has(c)),
      usagers: autorisation.usagers,
    });
    if (!verdict.ok) {
      this.journalRefus(ex.userId, ex.taskId, verdict.motif, projectId);
      // `action_ignore` n'est pas un refus d'accès : rien à dire au cliqueur.
      if (verdict.motif !== 'action_ignore') await this.repondreRefus(ex, projectId, verdict.motif);
      return;
    }
    const resultat = this.deps.appliquerRevue(
      verdict.taskId,
      verdict.verdict,
      verdict.liaison,
      `slack:${ex.userId}`,
    );
    this.deps.store.journaliserConnecteur({
      connecteurId: 'slack',
      projectId,
      portee: 'approbation',
      acte: 'approbation_recue',
      cible: verdict.taskId,
      resultat: resultat === 'applique' ? 'ok' : 'refuse',
      qui: `slack:${ex.userId}`,
      apercu: `${verdict.verdict} — ${resultat}`,
    });
    if (resultat !== 'applique') {
      await this.repondreRefus(ex, projectId, resultat);
      return;
    }
    const titre = echapperMrkdwn(this.caviardeur().texte(task.title));
    const geste = verdict.verdict === 'approved' ? '✅ Approuvée' : '↩️ Rejetée';
    await this.repondre(ex, projectId, {
      texte: `*${titre}* — ${geste} par <@${ex.userId}> ; verdict appliqué dans la ruche.`,
      remplacer: true,
    });
  }

  private async repondreRefus(
    ex: ExtractionInteraction,
    projectId: string | null,
    motif: string,
  ): Promise<void> {
    const lisible = MOTIF_REFUS_LISIBLE[motif] ?? motif;
    await this.repondre(ex, projectId, {
      texte: `Verdict non appliqué : ${lisible}`,
      remplacer: false,
    });
  }

  /**
   * Répond au cliqueur, et CONSIGNE la réponse comme tout appel sortant. Sans
   * `response_url` (surface qui n'en fournit pas), rien ne part : il n'y a pas
   * d'autre canal sûr pour lui répondre.
   */
  private async repondre(
    ex: ExtractionInteraction,
    projectId: string | null,
    reponse: { texte: string; remplacer: boolean },
  ): Promise<void> {
    if (ex.responseUrl === null) return;
    const res = await repondreInteraction(
      { responseUrl: ex.responseUrl, texte: reponse.texte, remplacer: reponse.remplacer },
      this.fetchSlack,
    );
    this.deps.store.journaliserConnecteur({
      connecteurId: 'slack',
      projectId,
      portee: 'approbation',
      acte: 'reponse_interaction',
      cible: ex.taskId,
      resultat: res.ok ? 'ok' : 'echec',
      qui: `slack:${ex.userId}`,
      apercu: res.ok ? reponse.texte : `${reponse.texte} — ${res.motif}`,
    });
  }

  private journalRefus(
    userId: string,
    taskId: string,
    motif: string,
    projectId: string | null = null,
  ): void {
    this.deps.store.journaliserConnecteur({
      connecteurId: 'slack',
      projectId,
      portee: 'approbation',
      acte: 'approbation_recue',
      cible: taskId,
      resultat: 'refuse',
      qui: `slack:${userId}`,
      apercu: motif,
    });
  }

  /** Ferme la connexion et empêche toute reconnexion. Idempotent. */
  fermer(): void {
    this.ferme = true;
    if (this.reconnexion !== null) {
      clearTimeout(this.reconnexion);
      this.reconnexion = null;
    }
    if (this.socket !== null) {
      try {
        this.socket.close();
      } catch {
        /* déjà fermé */
      }
      this.socket = null;
    }
  }
}
