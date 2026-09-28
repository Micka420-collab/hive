#!/usr/bin/env node
// LA RELECTRICE DE DÉMONSTRATION — une seconde famille d'agent, pour que le
// débat de la War Room existe sur la ruche de laboratoire des captures.
//
// ─── POURQUOI ELLE EXISTE ────────────────────────────────────────────────────
//
// La ruche photographiée ne lance aucun agent réel (`HIVE_AGENT=shell`), et le
// `shell` simulé ne relit jamais personne (`AGENTS_SANS_AVIS`,
// src/shared/contre-expertise.ts). Sans une seconde famille, chaque production
// finit en « contre-expertise impossible — aucun second modèle en ligne », et
// la War Room n'a rien d'autre à montrer : ni objection, ni correction, ni
// relecture close sans avis, ni Conseil qui débat.
//
// Elle est branchée comme l'opérateur branche n'importe quelle IA en CLI :
// l'adaptateur « commande libre » (`HIVE_AGENT=custom`, `HIVE_AGENT_CMD`,
// src/adapters/custom.ts), qui lui passe le prompt de la tâche en dernier
// argument et lit sa sortie standard comme réponse finale. Tout le reste est
// la VRAIE ruche : la Reine choisit la relectrice parce qu'elle est d'une
// autre famille, lit son verdict, relance le producteur contesté avec la
// critique, épuise ses essais, constate l'impossibilité — rien n'est écrit en
// base à la main.
//
// ─── CE QU'ELLE RÉPOND, ET POURQUOI C'EST ÉCRIT DANS LE TITRE ──────────────
//
// Une démonstration doit se refaire à l'identique : sa réponse dépend donc du
// TITRE de la production relue, jamais du hasard (`VERDICTS_DEMO`, que la
// ruche de laboratoire lit aussi pour nommer ses tâches : un seul endroit dit
// quelle tâche sera contestée). `conteste` : elle conteste, avec deux
// objections ; `muet` : elle termine sans rien dire (la relecture se clôt sans
// avis) ; toute autre production, elle la valide. Au Conseil, elle rapporte une
// piste par lentille et soutient les pistes — sauf celles qui proposent de
// RETIRER quelque chose, où elle émet un signal d'arrêt.
//
// C'est une démonstration, et elle le dit : aucune de ses phrases ne prétend
// avoir lu le code.

import process from 'node:process';
import { fileURLToPath } from 'node:url';

/** La tâche relue, lue dans la consigne de critique (`consigneDeCritique`). */
const TACHE_RELUE = /sur la tâche « (.*?) »/;

/** Les productions que la relectrice ne valide pas, par titre exact. */
export const VERDICTS_DEMO = Object.freeze({
  'Validation des montants': 'conteste',
  'Arrondi des taxes': 'muet',
});

/** Les pistes que la relectrice rapporte au Conseil, une par lentille. */
const PISTES = [
  {
    motif: /À QUI ce projet sert/,
    titre: 'Rendre le paiement accessible hors ligne',
    corps: 'Démonstration : les commerçants sans réseau stable perdent des ventes.',
  },
  {
    motif: /projets comparables/,
    titre: 'Reprendre la validation des montants d’un module existant',
    corps: 'Démonstration : un module éprouvé couvre déjà les arrondis et les devises.',
  },
  {
    motif: /Attaque le projet/,
    titre: 'Les arrondis de taxes ne sont pas testés',
    corps: 'Démonstration : aucune preuve ne couvre les montants à trois décimales.',
  },
  {
    motif: /le plus PETIT possible/,
    titre: 'Journaliser chaque remboursement',
    corps: 'Démonstration : un journal suffit à expliquer un litige client.',
  },
  {
    motif: /RETIRER/,
    titre: 'Retirer l’export CSV maison',
    corps: 'Démonstration : il duplique un export que la banque fournit déjà.',
  },
];

/**
 * Où commence la VRAIE consigne. Le nœud fait précéder le prompt de la tâche
 * du contexte de la ruche (`composeAgentPrompt`) — dont les souvenirs Hive Mind
 * des tâches déjà faites, consignes de relecture et de Conseil comprises. Lue
 * au PREMIER marqueur venu, la relectrice répondait au souvenir d'une relecture
 * précédente : mesuré au premier essai, la relecture de « Export CSV des
 * paiements » était lue comme celle d'« Arrondi des taxes », et se taisait. La
 * consigne de la tâche vient EN DERNIER : c'est son début qu'on cherche.
 */
const DEBUTS = [
  { genre: 'verification', marque: 'en mission de VÉRIFICATION.' },
  { genre: 'exploration', marque: 'Tu es une ÉCLAIREUSE du Conseil de la ruche Hive.\n' },
  { genre: 'relecture', marque: 'CONTRE-EXPERTISE — relis le travail' },
];

function consigne(texte) {
  let retenue = null;
  for (const d of DEBUTS) {
    const i = texte.lastIndexOf(d.marque);
    if (i >= 0 && (retenue === null || i > retenue.debut)) retenue = { genre: d.genre, debut: i };
  }
  return retenue ? { genre: retenue.genre, texte: texte.slice(retenue.debut) } : null;
}

/**
 * La réponse finale de la relectrice à un prompt de tâche — ou `''` quand elle
 * reste muette (la sortie vide est lue comme « aucune réponse finale »).
 */
export function reponseRelectrice(prompt) {
  const lue = consigne(String(prompt ?? ''));
  switch (lue?.genre) {
    // Vérification d'une piste du Conseil.
    case 'verification':
      return /Retirer/.test(lue.texte)
        ? 'HIVE_AVIS {"type":"arret","force":7,"raison":"démonstration : retirer cet export casserait la réconciliation bancaire"}'
        : 'HIVE_AVIS {"type":"soutien","force":6,"raison":"démonstration : la piste tient au regard du projet"}';
    // Exploration d'une lentille du Conseil.
    case 'exploration': {
      const piste = PISTES.find((p) => p.motif.test(lue.texte));
      return piste
        ? `HIVE_PROPOSITION ${JSON.stringify({ titre: piste.titre, corps: piste.corps, qualite: 6, sources: [] })}`
        : 'HIVE_PROPOSITION {"titre":"","corps":"","qualite":0,"sources":[]}';
    }
    // Contre-expertise d'une production d'une autre famille.
    case 'relecture': {
      const relue = TACHE_RELUE.exec(lue.texte)?.[1] ?? '';
      const verdict = Object.hasOwn(VERDICTS_DEMO, relue) ? VERDICTS_DEMO[relue] : 'valide';
      if (verdict === 'muet') return '';
      if (verdict === 'conteste') {
        return [
          'conteste',
          '- démonstration : un montant négatif passe la validation',
          '- démonstration : aucun test ne couvre la devise par défaut',
        ].join('\n');
      }
      // `valide` SEUL : une ligne d'objection, même sous « valide », compte
      // comme une contestation (`agreger`, contre-expertise.ts) — mesuré au
      // premier essai, où chaque production validée repartait en correction.
      return 'valide';
    }
    // Toute autre tâche : la relectrice n'est pas là pour produire.
    default:
      return 'démonstration : relectrice de laboratoire, aucune production';
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const reponse = reponseRelectrice(process.argv.slice(2).join(' '));
  if (reponse !== '') process.stdout.write(`${reponse}\n`);
}
