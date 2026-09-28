// Le connecteur Slack — poster dans des canaux, et n'écouter QUE ce qu'on lui
// a explicitement ouvert.
//
// ─── DEUX JETONS, DEUX RÔLES ─────────────────────────────────────────────────
//
//   · le jeton de bot (`xoxb-…`) POSTE via `chat.postMessage`. Requis : sans
//     lui, le connecteur ne peut rien envoyer.
//   · le jeton d'app (`xapp-…`) ouvre le Socket Mode — la SEULE voie entrante.
//     Facultatif : un hôte qui ne veut que des notifications ne le pose pas, et
//     aucune boucle entrante ne s'ouvre alors. C'est le défaut : pas de jeton
//     d'app ⇒ pas d'écoute, donc pas d'approbation possible depuis Slack.
//
// ─── POURQUOI LE MODE EST `action`, ET CE QUE ÇA N'AUTORISE PAS ──────────────
//
// Slack peut recevoir une approbation humaine (bouton), donc il n'est pas
// `lecture_seule`. Mais `action` ne veut pas dire « écoute tout » : Slack
// n'écoute JAMAIS globalement. Une interaction n'est retenue que si elle vient
// d'un canal ET d'un usager explicitement inscrits sur l'autorisation du projet
// (`slack/interactions.ts`), et une approbation ne fait que rejoindre la revue
// existante — jamais une autorité nouvelle. Les portées offertes s'arrêtent à
// `approbation` : pas d'`action` arbitraire.

import type { DefinitionConnecteur } from '../contrat.js';

/** Le jeton de bot Slack (`xoxb-…`) qui poste les messages. */
export const ENV_SLACK_BOT = 'SLACK_BOT_TOKEN';
/** Le jeton d'app Slack (`xapp-…`) qui ouvre le Socket Mode entrant. */
export const ENV_SLACK_APP = 'SLACK_APP_TOKEN';

/**
 * La forme d'un identifiant Slack de canal (`C…`, `G…`) ou d'usager (`U…`,
 * `W…`) : majuscules et chiffres. L'inscription se fait par ID, parce que
 * c'est l'ID — jamais le nom — qu'une interaction entrante porte ; un nom
 * inscrit ne correspondrait à rien et refuserait tout, sans un mot.
 */
export const ID_SLACK_MOTIF = '^[A-Z][A-Z0-9]{2,31}$';

export const DEF_SLACK: DefinitionConnecteur = Object.freeze({
  id: 'slack',
  libelleFr: 'Slack',
  libelleEn: 'Slack',
  hintFr:
    'Poste décisions, blocages, résumés et demandes d’approbation ; approbations via Socket Mode',
  hintEn: 'Posts decisions, blockers, summaries and approval requests; approvals via Socket Mode',
  mode: 'action',
  porteesPossibles: ['notification', 'approbation'] as const,
  secrets: [
    {
      envVar: ENV_SLACK_BOT,
      libelleFr: 'Jeton de bot (xoxb-…)',
      libelleEn: 'Bot token (xoxb-…)',
      hintFr: 'Slack → OAuth & Permissions ; scope chat:write. Poste les messages',
      hintEn: 'Slack → OAuth & Permissions; chat:write scope. Posts the messages',
      requis: true,
    },
    {
      envVar: ENV_SLACK_APP,
      libelleFr: 'Jeton d’app (xapp-…)',
      libelleEn: 'App token (xapp-…)',
      hintFr:
        'Slack → Basic Information → App-Level Tokens ; scope connections:write. Requis pour les approbations',
      hintEn:
        'Slack → Basic Information → App-Level Tokens; connections:write scope. Required for approvals',
      requis: false,
    },
  ],
});
