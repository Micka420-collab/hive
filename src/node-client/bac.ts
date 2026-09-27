// Le bac à sable au démarrage d'un nœud — décision, annonce, refus.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Il a été extrait de `main.ts` parce que `join.ts` ne faisait RIEN de tout
// cela. Les deux fichiers démarrent un nœud ; un seul décidait de l'isolement.
// Concrètement, un nœud lancé par `npm run join` tournait TOUJOURS en sandbox
// de processus, jamais en conteneur — et `HIVE_ISOLEMENT=exige`, le réglage
// qu'on pose précisément quand on prête sa machine à des inconnus, y était
// sans le moindre effet.
//
// C'est le pire endroit possible pour ce trou : `join` est le chemin des AMIS,
// c'est-à-dire des machines de gens qui n'ont pas lu `.env.example` et qui
// font confiance à celui qui leur a envoyé le billet.
//
// Le duplicata était le vrai problème : deux chemins de démarrage, deux codes,
// et donc une dérive garantie. Il n'y en a plus qu'un.
//
// ─── LA RÈGLE, ET ELLE NE SE DISCUTE PAS ─────────────────────────────────────
//
// « Passe quand même » est TOUJOURS affiché, même au meilleur niveau
// d'isolement. Une interface qui dirait « isolé ✓ » sans dire ce qui traverse
// encore ferait prendre un risque à quelqu'un qui croit ne pas en prendre —
// et le réseau traverse toujours, parce qu'un agent de codage doit joindre
// l'API de son modèle.

import { existsSync } from 'node:fs';
import {
  constat,
  decider,
  imageDepuisEnv,
  modeDepuisEnv,
  sonderAgentDansBac,
  trouverFournisseur,
  type Fournisseur,
} from './isolement.js';
import { CODE, type CodeSortie } from '../codes-sortie.js';
import { requisitionSiCredentialsManquantes, type AgentType } from './agent-detect.js';
import type { IsolementDeclare } from '../shared/types.js';
import { variablesAgentSansSecrets } from './workspace.js';

/** Ce que `decider` rend — nommé ici, faute de l'être à la source. */
export type Decision = ReturnType<typeof decider>;

/** Ce qu'il faut savoir du bac à sable pour démarrer — et quoi en dire. */
export interface Bac {
  decision: Decision;
  fournisseur: Fournisseur | null;
  image: string;
  /** Les lignes à afficher, déjà composées. */
  lignes: string[];
  /** Le nœud doit-il renoncer à démarrer ? */
  refuse: boolean;
  /**
   * Le code que le processus doit rendre — porté ICI, pas recopié par chaque
   * chemin de démarrage.
   *
   * ─── POURQUOI CE CHAMP EXISTE ─────────────────────────────────────────────
   *
   * Les deux chemins sortaient en `1`. Or `codes-sortie.ts` dit exactement ce
   * qu'est ce `1` : « Erreur non classée. Le fourre-tout, à n'utiliser qu'en
   * DERNIER RECOURS » — et il définit `REFUS_SECURITE` juste en dessous, pour
   * ce cas précis.
   *
   * Ce n'est pas une coquetterie de numérotation. Le même fichier dit ce que ça
   * coûte : « Ansible, systemd ou un Makefile ne peuvent pas distinguer
   * "déjà en place" de "port occupé" de "on a refusé pour raison de sécurité".
   * La seule réponse possible devient relancer et espérer. »
   *
   * Un `Restart=on-failure` voit `1`, relance, le nœud refuse à nouveau,
   * relance — sur une machine qui ne pourra JAMAIS travailler, faute de moteur
   * de conteneurs. Avec un code dédié, le superviseur s'arrête et le dit à un
   * humain, qui est le seul à pouvoir installer podman.
   *
   * Le champ vit dans la décision plutôt que chez l'appelant parce que le trou
   * d'origine était précisément un duplicata : deux chemins, deux copies, une
   * dérive garantie — c'est ce que dit l'en-tête de ce fichier.
   */
  codeSortie: CodeSortie;
  /**
   * Une session de l'hôte (`~/.claude`, `~/.codex`…) authentifie-t-elle encore
   * un agent de CE poste ? C'est la question du constat envoyé au hub, posée
   * pour TOUS les agents — pas seulement celui que le nœud a retenu.
   *
   * ─── LA DÉCISION D'UN AGENT NE VAUT PAS POUR LES AUTRES ─────────────────────
   *
   * Le constat jugeait chaque agent avec le bac de l'agent RETENU. En présence
   * seule (`shell`), bubblewrap restait retenu sans preflight : `~/.claude` ne
   * comptait plus, et le poste taisait « la clé de Claude Code est déjà là » —
   * alors qu'une fois installé, Claude Code, n'ayant que cette session, serait
   * revenu à la sandbox de processus, où elle sert.
   *
   * La règle vaut pour tout agent : en `auto`, une session seule fait revenir
   * l'agent à la sandbox de processus (`sessionHoteSeule`) — elle compte ; en
   * `exige`, elle fait refuser le nœud — elle ne compte pas ; en `off`, rien
   * n'est isolé — elle compte. Les tâches de l'agent retenu, elles, se jugent
   * avec son bac réel (`sessionsHote: !bac` dans le client).
   */
  sessionsHote: boolean;
}

/**
 * Compose l'annonce du bac à sable. **Pur** : c'est ce qui la rend testable
 * sans sonder la machine.
 */
export function annonce(decision: Decision, fournisseur: Fournisseur | null): string[] {
  const etat = constat(decision.niveau, fournisseur);
  const lignes = [`\n🛡  Isolement : ${decision.motif}`];
  if (etat.protege.length > 0) {
    lignes.push('   Protégé :');
    for (const l of etat.protege) lignes.push(`     ✔ ${l}`);
  }
  lignes.push('   Passe quand même :');
  for (const l of etat.laissePasser) lignes.push(`     • ${l}`);
  lignes.push('');
  return lignes;
}

/**
 * Le code que le processus doit rendre, selon qu'il refuse ou non.
 *
 * Exporté et minuscule À DESSEIN. Tant que la règle vivait à l'intérieur de
 * `preparerBac`, un banc ne pouvait l'éprouver qu'en fabriquant un `Bac` à la
 * main — c'est-à-dire en RECOPIANT la règle, donc en jugeant sa propre copie.
 * Mesuré : deux mutations de la règle d'origine laissaient le banc vert.
 */
export function codeDuBac(refuse: boolean): CodeSortie {
  return refuse ? CODE.REFUS_SECURITE : CODE.SUCCES;
}

/**
 * `Bac.sessionsHote` selon le mode — exporté pour la même raison que
 * `codeDuBac` : un banc qui fabrique un `Bac` éprouve la règle, pas sa copie.
 */
export function sessionsHoteDuMode(mode: ReturnType<typeof modeDepuisEnv>): boolean {
  return mode !== 'exige';
}

/**
 * Décide l'isolement UNE FOIS, au démarrage.
 *
 * Sonder un moteur de conteneurs coûte un `spawn` ; le faire par tâche
 * coûterait un `spawn` de plus par butinage, pour une réponse qui ne change
 * pas d'une tâche à l'autre.
 */
export function binaireDansBac(
  agent: AgentType,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (agent === 'shell') return null;
  if (agent === 'custom') return env.HIVE_AGENT_CMD?.trim().split(/\s+/)[0] || null;
  return {
    'claude-code': 'claude',
    cursor: 'cursor-agent',
    cline: 'cline',
    codex: 'codex',
    grok: 'grok',
  }[agent];
}

/** Le pont MCP CLI est un processus Node séparé dans l'image de l'agent. */
export function binaireMcpDansBac(agent: AgentType): string | null {
  return agent === 'claude-code' || agent === 'codex' ? 'node' : null;
}

/**
 * Le pont MCP est local au processus Worker. Sous Windows, le bac ne partage
 * pas ce transport avec le CLI ; annoncer le conteneur ferait donc accepter
 * une tâche qui échouerait dès son démarrage. Le mode `auto` doit revenir à la
 * sandbox de processus et `exige` doit refuser le nœud, avec une raison visible.
 */
export function raisonPontMcpDansBac(
  agent: AgentType,
  plateforme: NodeJS.Platform = process.platform,
): string | null {
  if (plateforme !== 'win32' || !binaireMcpDansBac(agent)) return null;
  return `bac conteneurisé indisponible pour ${agent} sous Windows : le pont MCP local du CLI n'est pas partageable`;
}

/**
 * Où le preflight a cherché l'agent, pour le dire à l'humain.
 *
 * Un conteneur cherche dans son IMAGE ; bubblewrap n'en a pas — il remonte
 * l'installation de l'hôte en lecture seule. Lui prêter « (image
 * docker.io/library/node:20-slim) » envoyait l'humain corriger une image que
 * rien n'utilise.
 */
function lieuDuBac(fournisseur: Fournisseur, image: string): string {
  return fournisseur.bin === 'bwrap' ? '' : ` (image ${image})`;
}

/** Le bac est écarté : `auto` le dit et se replie, `exige` refuse. */
function sansBac(
  mode: ReturnType<typeof modeDepuisEnv>,
  motif: string,
): { decision: Decision; fournisseur: null } {
  return {
    fournisseur: null,
    decision: {
      ...decider(mode, null),
      motif:
        mode === 'exige'
          ? `HIVE_ISOLEMENT=exige : ${motif} — ce nœud refuse de travailler.`
          : `${motif} — repli explicite vers la sandbox de processus, non isolée du disque.`,
    },
  };
}

export function deciderAvecPreflight(
  mode: ReturnType<typeof modeDepuisEnv>,
  fournisseur: Fournisseur,
  image: string,
  resultat: Awaited<ReturnType<typeof sonderAgentDansBac>>,
): { decision: Decision; fournisseur: Fournisseur | null } {
  if (resultat.executable) return { decision: decider(mode, fournisseur), fournisseur };
  return sansBac(mode, `${resultat.motif}${lieuDuBac(fournisseur, image)}`);
}

/** Ce que `preparerBac` consulte sur la machine — injectable pour les bancs. */
export interface OutilsBac {
  /** Le moteur disponible. Défaut : la sonde réelle (`--version`). */
  trouver?: () => Promise<Fournisseur | null>;
  /** Le preflight d'un binaire dans le bac. Défaut : le vrai, qui le lance. */
  sonderAgent?: (
    fournisseur: Fournisseur,
    bin: string,
    image: string,
  ) => ReturnType<typeof sonderAgentDansBac>;
  /** Un dossier de session existe-t-il ? Défaut : le disque. */
  existe?: (chemin: string) => boolean;
  plateforme?: NodeJS.Platform;
}

/**
 * La seule façon qu'a cet agent de s'authentifier est-elle une session de
 * l'HÔTE, que le bac ne monte pas ? Rend alors ce qu'il faut poser, sinon `null`.
 *
 * ─── LE NŒUD DISAIT « CONTENEUR », ET CHAQUE TÂCHE ÉCHOUAIT ──────────────────
 *
 * `~/.claude` comptait comme identifiant. Or le bac donne à l'agent un HOME
 * éphémère et ne monte jamais celui du membre : la session de `claude login` n'y
 * entre pas. Le nœud annonçait donc un vrai bac à sable, puis chaque tâche
 * échouait « non authentifié » — un échec d'INFRA, réaffecté, en boucle.
 *
 * Le cas visé est exact : une clé nommée passe (rien à dire) ; aucune session
 * ni clé nulle part, la sandbox de processus ne ferait pas mieux — le bac reste,
 * et la réquisition nomme la variable. Seule la session de l'hôte, qui marche
 * DEHORS et pas DEDANS, justifie de renoncer au bac.
 */
function sessionHoteSeule(
  agent: AgentType,
  env: NodeJS.ProcessEnv,
  outils: Pick<OutilsBac, 'existe' | 'plateforme'> = {},
): string | null {
  const opts = {
    existe: outils.existe ?? existsSync,
    ...(outils.plateforme ? { plateforme: outils.plateforme } : {}),
  };
  const dansLeBac = requisitionSiCredentialsManquantes(agent, env, {
    ...opts,
    sessionsHote: false,
  });
  if (!dansLeBac) return null;
  const surLHote = requisitionSiCredentialsManquantes(agent, env, { ...opts, sessionsHote: true });
  return surLHote ? null : dansLeBac.detail;
}

export async function preparerBac(
  env: NodeJS.ProcessEnv = process.env,
  agent?: AgentType,
  outils: OutilsBac = {},
): Promise<Bac> {
  const mode = modeDepuisEnv(env);
  const image = imageDepuisEnv(env);
  const sonderAgent = outils.sonderAgent ?? sonderAgentDansBac;
  let fournisseur = mode === 'off' ? null : await (outils.trouver ?? trouverFournisseur)();
  let decision = decider(mode, fournisseur);
  let preflight: string | null = null;
  const binAgent = agent ? binaireDansBac(agent, env) : null;

  // Les identifiants AVANT le preflight : c'est gratuit (aucun `spawn`), et si
  // l'agent ne peut pas s'authentifier dans le bac, l'éprouver dedans ne dirait
  // rien d'utile.
  const perdus = fournisseur && agent ? sessionHoteSeule(agent, env, outils) : null;
  if (fournisseur && perdus) {
    ({ decision, fournisseur } = sansBac(mode, perdus));
  } else if (fournisseur && binAgent) {
    const motifPont = agent ? raisonPontMcpDansBac(agent, outils.plateforme) : null;
    let resultat = motifPont
      ? { executable: false, motif: motifPont }
      : await sonderAgent(fournisseur, binAgent, image);
    if (!motifPont) {
      const binPont = agent ? binaireMcpDansBac(agent) : null;
      if (resultat.executable && binPont) {
        const pont = await sonderAgent(fournisseur, binPont, image);
        if (!pont.executable) {
          resultat = {
            executable: false,
            motif: `${pont.motif} — runtime Node requis par le pont MCP CLI`,
          };
        }
      }
    }
    preflight = `${resultat.motif}${lieuDuBac(fournisseur, image)}`;
    ({ decision, fournisseur } = deciderAvecPreflight(mode, fournisseur, image, resultat));
  }
  const lignes = annonce(decision, fournisseur);
  if (preflight && fournisseur) lignes.splice(1, 0, `   Preflight : ${preflight}`);
  return {
    decision,
    fournisseur,
    image,
    lignes,
    // FERMÉ PAR DÉFAUT en « exige » : mieux vaut un nœud qui ne prend aucune
    // tâche qu'un nœud qui en prend une sans bac à sable en croyant le
    // contraire.
    refuse: decision.refuse,
    codeSortie: codeDuBac(decision.refuse),
    sessionsHote: sessionsHoteDuMode(mode),
  };
}

/**
 * Ce que le nœud DÉCLARE au hub de son bac à sable : le niveau réellement
 * décidé au démarrage (préflight compris), et le moteur quand il y en a un.
 *
 * C'est une déclaration pour l'AFFICHAGE (Mission Control, preuve V2 Alpha) —
 * le hub n'en fait jamais un critère d'assignation. Un nœud non isolé se dit
 * `processus` : cwd et environnement épurés, rien de plus, et l'écran le dit.
 */
export function isolementDeclareDe(bac: Bac): IsolementDeclare {
  if (bacActif(bac)) {
    return { niveau: 'conteneur', fournisseur: bac.fournisseur.nom };
  }
  // Sans moteur, « conteneur » serait un mensonge : on retombe sur ce qui tourne.
  return { niveau: bac.decision.niveau === 'conteneur' ? 'processus' : bac.decision.niveau };
}

/**
 * Les tâches de ce nœud tourneront-elles dans un bac ? La décision ET le moteur
 * doivent le dire ensemble — une seule réponse, pour l'option passée au client
 * et pour ce qui est déclaré au hub.
 */
function bacActif(bac: Bac): bac is Bac & { fournisseur: Fournisseur } {
  return bac.decision.isole && bac.fournisseur !== null;
}

/**
 * L'option `bac` à passer au client — ou rien du tout.
 *
 * `variables` reprend EXACTEMENT ce que la sandbox laisse passer : le bac ne
 * doit ni en ajouter (fuite) ni en retirer (agent non authentifié, donc échec
 * d'infrastructure en boucle).
 */
export function optionBac(
  bac: Bac,
  variables: readonly string[],
):
  | { bac: { fournisseur: Fournisseur; variables: string[]; image: string } }
  | Record<string, never> {
  if (!bacActif(bac)) return {};
  return {
    bac: {
      fournisseur: bac.fournisseur,
      variables: variablesAgentSansSecrets(variables),
      image: bac.image,
    },
  };
}
