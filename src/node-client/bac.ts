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
  preparerImage,
  ramasserConteneurs,
  sonderAgentDansBac,
  trouverFournisseurs,
  type BacExecution,
  type Fournisseur,
  type ResultatPreflightAgent,
} from './isolement.js';
import { CODE, type CodeSortie } from '../codes-sortie.js';
import { requisitionSiCredentialsManquantes, type AgentType } from './agent-detect.js';
import type { IsolementDeclare } from '../shared/types.js';
import { variablesAgentSansSecrets } from './workspace.js';
import { occuperIdentite } from './identite-noeud.js';

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

/** Ce que `preparerBac` consulte sur la machine — injectable pour les bancs. */
export interface OutilsBac {
  /**
   * Les moteurs qui répondent, dans l'ordre de préférence. Défaut : la sonde
   * réelle (`trouverFournisseurs`, `--version` de chacun).
   */
  moteurs?: () => Promise<Fournisseur[]>;
  /**
   * L'image est-elle prête dans ce moteur ? Défaut : la vraie (`preparerImage`).
   * `tirer` : une image nommée absente peut-elle être téléchargée ?
   */
  preparerImage?: (
    fournisseur: Fournisseur,
    image: string,
    tirer: boolean,
  ) => Promise<ResultatPreflightAgent>;
  /** Le preflight d'un binaire dans le bac. Défaut : le vrai, qui le lance. */
  sonderAgent?: (
    fournisseur: Fournisseur,
    bin: string,
    image: string,
  ) => Promise<ResultatPreflightAgent>;
  /** Un dossier de session existe-t-il ? Défaut : le disque. */
  existe?: (chemin: string) => boolean;
  plateforme?: NodeJS.Platform;
  /** Ce qu'il faut dire PENDANT la préparation (un téléchargement). Défaut : la console. */
  informer?: (ligne: string) => void;
}

/**
 * Éprouve UN moteur : l'image (conteneurs seulement), puis l'agent, puis le
 * `node` du pont MCP. Rend le premier refus, ou ce qui a passé.
 */
async function eprouverMoteur(
  fournisseur: Fournisseur,
  image: string,
  binAgent: string | null,
  binPont: string | null,
  outils: Required<Pick<OutilsBac, 'preparerImage' | 'sonderAgent'>>,
  tirer: boolean,
): Promise<ResultatPreflightAgent> {
  let dernier: ResultatPreflightAgent | null = null;
  let moteur = fournisseur;
  if (fournisseur.bin !== 'bwrap') {
    dernier = await outils.preparerImage(fournisseur, image, tirer);
    if (!dernier.executable) return dernier;
    // Ce que l'image a appris du moteur (Podman rootless ou non) vaut pour la suite.
    moteur = dernier.fournisseur ?? fournisseur;
  }
  if (!binAgent) return dernier ?? { executable: true, motif: 'aucun agent à éprouver' };
  const agent = await outils.sonderAgent(moteur, binAgent, image);
  if (!agent.executable) return agent;
  const appris = moteur === fournisseur ? {} : { fournisseur: moteur };
  if (!binPont) return { ...agent, ...appris };
  const pont = await outils.sonderAgent(moteur, binPont, image);
  return pont.executable
    ? { ...agent, ...appris }
    : { executable: false, motif: `${pont.motif} — runtime Node requis par le pont MCP CLI` };
}

/**
 * Le moteur retenu : le PREMIER, dans l'ordre de préférence, dont le preflight
 * passe — plus ce qu'on a dit des moteurs écartés avant lui.
 *
 * ─── LE MOTEUR ÉTAIT « LE PREMIER QUI RÉPOND À --version » ───────────────────
 *
 * Un Docker installé démon arrêté répond à `--version` ; un Podman présent
 * n'a pas l'image que Docker a construite. Le nœud retenait ce premier moteur,
 * son preflight échouait, et il retombait en sandbox de processus — alors que
 * le moteur suivant (le Docker qui A l'image, le bubblewrap qui marche)
 * l'aurait isolé. Le banc d'intégration, lui, choisissait déjà le moteur qui a
 * l'image : la production suit maintenant la même règle.
 *
 * ─── TROIS PASSES : L'IMAGE LÀ OÙ ELLE EST, PUIS UN TÉLÉCHARGEMENT, PUIS BWRAP ─
 *
 * Une image NOMMÉE absente du premier moteur y était téléchargée aussitôt —
 * jusqu'à 10 min, par la résolution des noms courts de Podman — alors que le
 * Docker suivant l'avait déjà construite. On éprouve donc d'abord les moteurs
 * de conteneurs SANS rien tirer ; si aucun ne passe, on télécharge dans le
 * PREMIER qui ne l'avait pas, et lui seul ; bubblewrap, sans image, ne vient
 * qu'ensuite : un opérateur qui nomme une image veut un conteneur, et c'est
 * l'ordre qui le lui donnait déjà.
 */
async function choisirMoteur(
  moteurs: readonly Fournisseur[],
  image: string,
  binAgent: string | null,
  binPont: string | null,
  outils: Required<Pick<OutilsBac, 'preparerImage' | 'sonderAgent'>>,
): Promise<{ retenu: Fournisseur | null; motif: string | null; ecartes: string[] }> {
  const ecartes: string[] = [];
  const conteneurs = moteurs.filter((f) => f.bin !== 'bwrap');
  let aTirer: Fournisseur | null = null;
  let retenu: { fournisseur: Fournisseur; motif: string | null } | null = null;
  const essayer = async (fournisseur: Fournisseur, tirer: boolean): Promise<boolean> => {
    const r = await eprouverMoteur(fournisseur, image, binAgent, binPont, outils, tirer);
    if (r.imageAbsente) {
      // Pas un refus : une image à télécharger, si aucun moteur ne l'a.
      aTirer ??= fournisseur;
      return false;
    }
    const motif = `${r.motif}${lieuDuBac(fournisseur, image)}`;
    if (r.executable) {
      // Rien n'a été lancé (bubblewrap, sans agent) : pas de preflight à citer.
      retenu = {
        fournisseur: r.fournisseur ?? fournisseur,
        motif: binAgent || fournisseur.bin !== 'bwrap' ? motif : null,
      };
      return true;
    }
    ecartes.push(moteurs.length > 1 ? `${fournisseur.nom} : ${motif}` : motif);
    return false;
  };
  const fin = (): { retenu: Fournisseur | null; motif: string | null; ecartes: string[] } => ({
    retenu: retenu?.fournisseur ?? null,
    motif: retenu?.motif ?? null,
    ecartes,
  });
  for (const f of conteneurs) if (await essayer(f, false)) return fin();
  if (aTirer && (await essayer(aTirer, true))) return fin();
  for (const f of moteurs) if (f.bin === 'bwrap' && (await essayer(f, false))) return fin();
  return fin();
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
  const informer = outils.informer ?? ((ligne: string) => console.log(ligne));
  const epreuves = {
    sonderAgent: outils.sonderAgent ?? sonderAgentDansBac,
    preparerImage:
      outils.preparerImage ??
      ((f: Fournisseur, img: string, tirer: boolean) => preparerImage(f, img, { informer, tirer })),
  };
  const moteurs = await moteursDuMode(env, outils.moteurs);
  let fournisseur = moteurs[0] ?? null;
  let decision = decider(mode, fournisseur);
  let preflight: string | null = null;
  let ecartes: string[] = [];
  const binAgent = agent ? binaireDansBac(agent, env) : null;

  // Les identifiants AVANT le preflight : c'est gratuit (aucun `spawn`), et si
  // l'agent ne peut pas s'authentifier dans le bac, l'éprouver dedans ne dirait
  // rien d'utile. Même chose pour le pont MCP sous Windows : aucun moteur n'y
  // changerait rien.
  const renoncement =
    fournisseur && agent
      ? (sessionHoteSeule(agent, env, outils) ?? raisonPontMcpDansBac(agent, outils.plateforme))
      : null;
  if (fournisseur && renoncement) {
    ({ decision, fournisseur } = sansBac(mode, renoncement));
  } else if (fournisseur) {
    const binPont = agent ? binaireMcpDansBac(agent) : null;
    const choix = await choisirMoteur(moteurs, image, binAgent, binPont, epreuves);
    ecartes = choix.ecartes;
    if (choix.retenu) {
      fournisseur = choix.retenu;
      decision = decider(mode, fournisseur);
      preflight = choix.motif;
    } else {
      ({ decision, fournisseur } = sansBac(mode, choix.ecartes.join(' · ')));
    }
  }
  const lignes = annonce(decision, fournisseur);
  if (fournisseur) {
    // Un moteur écarté AVANT celui qu'on garde se dit : l'humain qui a
    // installé podman doit savoir pourquoi c'est docker qui isole.
    const details = [
      ...(preflight ? [`   Preflight : ${preflight}`] : []),
      ...ecartes.map((e) => `   Écarté : ${e}`),
    ];
    lignes.splice(1, 0, ...details);
  }
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
 * Les moteurs qui répondent à `--version`, dans l'ordre de préférence — aucun
 * en `off`. Sondés UNE fois au démarrage : le ramassage (`ramasserRestes`)
 * puis le preflight (`preparerBac`, par `OutilsBac.moteurs`) partent de la
 * même liste.
 */
export async function moteursDuMode(
  env: NodeJS.ProcessEnv = process.env,
  trouver: () => Promise<Fournisseur[]> = trouverFournisseurs,
): Promise<Fournisseur[]> {
  return modeDepuisEnv(env) === 'off' ? [] : trouver();
}

/**
 * Au démarrage d'un nœud : supprime ce qu'un lancement précédent de CE nœud a
 * laissé tourner (voir `ramasserConteneurs`). Rend les lignes à afficher —
 * rien quand il n'y avait rien. L'appelant tient déjà l'identité
 * (`occuperIdentite`) : aucun autre processus vivant ne porte ces conteneurs.
 *
 * ─── DANS CHAQUE MOTEUR QUI RÉPOND, PAS SEULEMENT CELUI D'AUJOURD'HUI ────────
 *
 * Le ramassage n'interrogeait que le moteur RETENU à ce démarrage. Or les
 * orphelins sont les plus probables précisément quand ce démarrage-ci est
 * dégradé : le Docker d'hier tué net, une machine encore chargée par son
 * agent, un preflight qui expire — le nœud se replie, et l'orphelin, jamais
 * cherché, continuait d'écrire et de dépenser. Ou Podman retenu aujourd'hui,
 * Docker hier. L'étiquette porte l'identité STABLE du nœud : la chercher dans
 * chaque moteur de conteneurs qui répond ne touche rien d'autre.
 *
 * ─── AVANT LE PREFLIGHT, PAS APRÈS ───────────────────────────────────────────
 *
 * Le ramassage venait après `preparerBac` : jusqu'à 10 min de téléchargement,
 * 10 de préparation `keep-id`, puis les preflights — pendant lesquels
 * l'orphelin écrivait et dépensait, alors que la Reine avait peut-être déjà
 * rendu sa tâche à un autre nœud. Et un refus `exige` sortait avant de
 * ramasser, précisément quand le démarrage est dégradé. Il ne lui faut que
 * l'identité et les moteurs qui répondent : il passe en premier.
 *
 * Un moteur qui ne répond pas ne fait PAS refuser le nœud : un orphelin non
 * ramassé coûte moins qu'une ruche sans ouvrière. Mais il se dit — sobrement
 * quand le moteur a répondu « injoignable » (un Docker Desktop arrêté ne fait
 * rien tourner qu'on pourrait joindre), en avertissement sinon.
 */
export async function ramasserRestes(
  moteurs: readonly Fournisseur[],
  noeud: string,
  ramasser: typeof ramasserConteneurs = ramasserConteneurs,
): Promise<string[]> {
  const lignes: string[] = [];
  // Bubblewrap : `--die-with-parent`, rien ne lui survit.
  for (const moteur of moteurs.filter((f) => f.bin !== 'bwrap')) {
    const r = await ramasser(moteur, noeud);
    if ('injoignable' in r) {
      lignes.push(`   · ${r.injoignable} — ses conteneurs n'ont pas été cherchés.`);
    } else if ('motif' in r) {
      lignes.push(`   ⚠ ${r.motif} — un agent d'un lancement précédent tourne peut-être encore.`);
    } else if (r.supprimes.length > 0) {
      lignes.push(
        `   ${r.supprimes.length} conteneur(s) laissé(s) par un lancement précédent de ce nœud ` +
          `supprimé(s) (${moteur.nom}).`,
      );
    }
  }
  return lignes;
}

/** Ce que rend `reprendreIdentite`. */
export type Reprise =
  { occupee: true; message: string } | { occupee: false; moteurs: Fournisseur[]; lignes: string[] };

/**
 * Le début commun des deux chemins de démarrage (`main.ts`, `join.ts`), AVANT
 * le preflight : prendre l'identité du nœud (`occuperIdentite`), puis
 * ramasser ce qu'un lancement précédent a laissé (`ramasserRestes`) dans
 * chaque moteur qui répond. Rend ces moteurs, à passer à `preparerBac` — ou
 * `occupee` : un autre processus vivant porte l'identité, le nœud ne démarre
 * pas.
 */
export async function reprendreIdentite(
  env: NodeJS.ProcessEnv,
  noeud: string,
  racine: string,
  /** Les sondes réelles par défaut ; un banc les remplace. */
  outils: { trouver?: () => Promise<Fournisseur[]>; ramasser?: typeof ramasserConteneurs } = {},
): Promise<Reprise> {
  if ((await occuperIdentite(racine)).occupee) {
    return {
      occupee: true,
      message:
        `un autre processus vivant porte déjà l'identité de ce nœud (${racine}) — ` +
        'deux nœuds sous un même nom se disputeraient la ruche et leurs conteneurs. ' +
        'Arrêtez l’autre, ou lancez celui-ci dans un autre atelier (HIVE_WORKDIR).',
    };
  }
  const moteurs = await moteursDuMode(env, outils.trouver);
  return { occupee: false, moteurs, lignes: await ramasserRestes(moteurs, noeud, outils.ramasser) };
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
): { bac: BacExecution } | Record<string, never> {
  if (!bacActif(bac)) return {};
  return {
    bac: {
      fournisseur: bac.fournisseur,
      variables: variablesAgentSansSecrets(variables),
      image: bac.image,
    },
  };
}
