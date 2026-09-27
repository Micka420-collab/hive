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
import { creerCaviardeur } from '../shared/caviardage.js';
import type { HiveStore } from './store.js';
import {
  porteePourEvenement,
  type EvenementConnecteur,
  type Portee,
} from '../connectors/contrat.js';
import { definitionConnecteur, listerDefinitions } from '../connectors/registre.js';
import { ENV_WEBHOOK_SECRET, ENV_WEBHOOK_URL } from '../connectors/webhook/definition.js';
import { construireRequeteWebhook } from '../connectors/webhook/charge.js';
import { envoyerWebhook, type FetchLike } from '../connectors/webhook/envoi.js';
import { ENV_SLACK_APP, ENV_SLACK_BOT } from '../connectors/slack/definition.js';
import { messagePourEvenement } from '../connectors/slack/messages.js';
import {
  accuse,
  ouvrirConnexionSocket,
  parserEnveloppe,
  posterMessageSlack,
  type SlackFetch,
  type WsFactory,
  type WsLike,
} from '../connectors/slack/client.js';
import { autoriserInteraction, extraireInteraction } from '../connectors/slack/interactions.js';

/** Le verdict que le serveur rend quand le hub lui demande d'appliquer une revue. */
export type ResultatRevueConnecteur =
  'applique' | 'tache_inconnue' | 'non_terminal' | 'deja_livree';

export interface DepsHub {
  readonly store: HiveStore;
  readonly env: NodeJS.ProcessEnv;
  /** Applique une revue humaine par le CHEMIN CANONIQUE du serveur (jamais un doublon). */
  readonly appliquerRevue: (
    taskId: string,
    verdict: 'approved' | 'rejected',
  ) => ResultatRevueConnecteur;
  /** `fetch` pour les webhooks sortants (défaut : global). */
  readonly fetchWebhook?: FetchLike;
  /** `fetch` pour l'API Slack (défaut : global). */
  readonly fetchSlack?: SlackFetch;
  /** Fabrique de WebSocket pour le Socket Mode (défaut : `ws`). */
  readonly wsFactory?: WsFactory;
  /** Journalise (test/observabilité). */
  readonly log?: (msg: string) => void;
}

/** Empreinte + aperçu CAVIARDÉS d'une charge — jamais le clair, jamais un secret. */
function empreinteCaviardee(
  charge: string,
  secrets: readonly string[],
): { chargeDigest: string; apercu: string } {
  const caviardeur = creerCaviardeur(secrets);
  const propre = caviardeur.texte(charge);
  const chargeDigest = createHash('sha256').update(propre, 'utf8').digest('hex');
  const apercu = propre.length <= 200 ? propre : `${propre.slice(0, 199)}…`;
  return { chargeDigest, apercu };
}

export class HubConnecteurs {
  private readonly deps: DepsHub;
  private readonly fetchWebhook: FetchLike;
  private readonly fetchSlack: SlackFetch;
  private readonly wsFactory: WsFactory | null;
  private socket: WsLike | null = null;
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

  /** Les valeurs secrètes des connecteurs, pour les caviarder d'une charge. */
  private secretsConnus(): string[] {
    const noms = [ENV_WEBHOOK_SECRET, ENV_WEBHOOK_URL, ENV_SLACK_BOT, ENV_SLACK_APP];
    return noms.map((n) => this.secret(n)).filter((v) => v.length > 0);
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
    const requise = porteePourEvenement(evenement.kind);
    for (const def of listerDefinitions()) {
      if (!this.estActif(def.id)) continue;
      const autorisation = this.deps.store.lireAutorisationConnecteur(def.id, evenement.projectId);
      if (!autorisation || !autorisation.actif) continue;
      if (!autorisation.portees.includes(requise)) continue;
      if (def.id === 'webhook') await this.envoyerWebhook(evenement, requise);
      else if (def.id === 'slack') await this.envoyerSlack(evenement, requise, autorisation.canaux);
    }
  }

  private async envoyerWebhook(evenement: EvenementConnecteur, portee: Portee): Promise<void> {
    const url = this.secret(ENV_WEBHOOK_URL);
    const secret = this.secret(ENV_WEBHOOK_SECRET);
    const requete = construireRequeteWebhook({ url, secret, evenement, now: Date.now() });
    const empreinte = empreinteCaviardee(requete.corps, this.secretsConnus());
    const res = await envoyerWebhook(requete, this.fetchWebhook);
    this.deps.store.journaliserConnecteur({
      connecteurId: 'webhook',
      projectId: evenement.projectId,
      portee,
      acte: evenement.kind,
      cible: evenement.taskId ?? null,
      resultat: res.ok ? 'ok' : 'echec',
      qui: 'ruche',
      apercu: res.ok ? empreinte.apercu : `${empreinte.apercu} — ${res.motif}`,
      chargeDigest: empreinte.chargeDigest,
    });
  }

  private async envoyerSlack(
    evenement: EvenementConnecteur,
    portee: Portee,
    canaux: readonly string[],
  ): Promise<void> {
    const token = this.secret(ENV_SLACK_BOT);
    const message = messagePourEvenement(evenement);
    const empreinte = empreinteCaviardee(JSON.stringify(message), this.secretsConnus());
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
        qui: 'ruche',
        apercu: 'aucun canal configuré',
        chargeDigest: empreinte.chargeDigest,
      });
      return;
    }
    for (const channel of canaux) {
      const res = await posterMessageSlack({ token, channel, message }, this.fetchSlack);
      this.deps.store.journaliserConnecteur({
        connecteurId: 'slack',
        projectId: evenement.projectId,
        portee,
        acte: evenement.kind,
        cible: evenement.taskId ?? null,
        resultat: res.ok ? 'ok' : 'echec',
        qui: 'ruche',
        apercu: res.ok ? `#${channel} ${empreinte.apercu}` : `#${channel} — ${res.motif}`,
        chargeDigest: empreinte.chargeDigest,
      });
    }
  }

  /**
   * Envoie un fait à travers UN SEUL connecteur, pour le bouton « tester » de
   * l'Intendance. Rend pourquoi rien n'est parti (inactif, non autorisé, portée
   * manquante) plutôt qu'un silence — un test muet ne prouve rien.
   */
  async tester(
    connecteurId: string,
    evenement: EvenementConnecteur,
  ): Promise<{ envoye: boolean; motif?: string }> {
    if (!this.estActif(connecteurId)) return { envoye: false, motif: 'connecteur inactif' };
    const autorisation = this.deps.store.lireAutorisationConnecteur(
      connecteurId,
      evenement.projectId,
    );
    if (!autorisation || !autorisation.actif)
      return { envoye: false, motif: 'non autorisé sur ce projet' };
    const portee = porteePourEvenement(evenement.kind);
    if (!autorisation.portees.includes(portee))
      return { envoye: false, motif: 'portée non accordée' };
    if (connecteurId === 'webhook') await this.envoyerWebhook(evenement, portee);
    else if (connecteurId === 'slack')
      await this.envoyerSlack(evenement, portee, autorisation.canaux);
    else return { envoye: false, motif: 'connecteur sans émission' };
    return { envoye: true };
  }

  // ─── Socket Mode entrant (approbations Slack) ───────────────────────────────

  /**
   * Ouvre le Socket Mode si — et seulement si — le jeton d'app est posé. Sans
   * lui, aucune connexion ne s'ouvre : c'est le défaut, et il ne crée ni ne
   * propage aucun jeton. Idempotent ; sûr à appeler au démarrage.
   */
  async demarrer(): Promise<void> {
    if (this.ferme || this.socket !== null) return;
    if (this.wsFactory === null) return;
    if (this.secret(ENV_SLACK_APP) === '' || this.secret(ENV_SLACK_BOT) === '') return;
    await this.connecter();
  }

  private async connecter(): Promise<void> {
    if (this.ferme || this.wsFactory === null) return;
    const appToken = this.secret(ENV_SLACK_APP);
    const ouverture = await ouvrirConnexionSocket(appToken, this.fetchSlack);
    if (!ouverture.ok) {
      this.deps.log?.(`[connecteurs] Socket Mode Slack indisponible : ${ouverture.motif}`);
      this.planifierReconnexion();
      return;
    }
    if (this.ferme) return;
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
    this.traiterInteraction(enveloppe.payload);
  }

  /**
   * Traite une interaction entrante : parse, résout la tâche→projet (autorité),
   * vérifie portée + canal + usager, applique la revue par le chemin canonique,
   * et journalise le résultat (appliqué comme refusé). Rien ici ne fait
   * confiance au `block_id` : le projet vient de la tâche.
   */
  traiterInteraction(payload: unknown): void {
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
    const projectId = this.deps.store.getTask(ex.taskId)?.projectId ?? null;
    if (projectId === null) {
      this.journalRefus(ex.userId, ex.taskId, 'tache_inconnue');
      return;
    }
    const autorisation = this.deps.store.lireAutorisationConnecteur('slack', projectId);
    if (!autorisation || !autorisation.actif) {
      this.journalRefus(ex.userId, ex.taskId, 'non_autorise', projectId);
      return;
    }
    const verdict = autoriserInteraction(ex, {
      portees: autorisation.portees as Portee[],
      canaux: autorisation.canaux,
      usagers: autorisation.usagers,
    });
    if (!verdict.ok) {
      this.journalRefus(ex.userId, ex.taskId, verdict.motif, projectId);
      return;
    }
    const resultat = this.deps.appliquerRevue(verdict.taskId, verdict.verdict);
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
