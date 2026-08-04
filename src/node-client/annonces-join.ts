/**
 * CE QUE `hive join` ANNONCE À L'INVITÉ AVANT DE SE CONNECTER.
 *
 * ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
 *
 * `join.ts` finit par `await main()` : l'importer ouvrirait un WebSocket, donc
 * aucun banc ne peut le charger (§ 2.8 du carnet). Les phrases que ce fichier
 * porte n'étaient donc jamais exécutées sous banc — et le balayage par mutation
 * l'a dit sans détour : inverser `transport === 'clair_public'` ne faisait
 * rougir personne.
 *
 * Le dépôt a déjà tranché ce cas une fois, pour l'installeur : `conseilServeur()`
 * vit dans `installer.ts` (pur) parce que `installer-main.ts` court à l'import,
 * « c'est là que le `&&` du conseil avait survécu au balayage, invisible ». Même
 * cause, même remède.
 *
 * ─── CE QUE CET AVERTISSEMENT PROTÈGE ────────────────────────────────────────
 *
 * `jugerTransport()` est pur et éprouvé ailleurs : il sait dire `sur`,
 * `clair_prive` ou `clair_public`. Ce qui n'était tenu par rien, c'est la
 * CORRESPONDANCE entre ce verdict et ce que l'invité lit.
 *
 * Or les deux messages en clair ne disent pas du tout la même chose :
 *
 *   · « réseau privé (usuel en local) » est un constat rassurant, et il a
 *     raison de l'être ;
 *   · « adresse publique » dit que la clé, les prompts, les logs ET les diffs
 *     de code traverseront l'internet sans chiffrement.
 *
 * Les intervertir, c'est afficher « usuel en local » à quelqu'un qui s'apprête à
 * envoyer son code source en clair sur le réseau — et effrayer sans raison
 * celui qui se connecte à sa propre machine. Un avertissement qui se trompe de
 * situation est pire que pas d'avertissement : il enseigne à ne plus le lire.
 *
 * On n'interdit rien. C'est la machine de l'invité, et l'hôte a pu vouloir ce
 * montage — mais il doit le savoir.
 */

import type { VerdictTransport } from '../shared/acces.js';
import type { AgentType } from './agent-detect.js';

/**
 * Ce qu'il faut dire du transport, ou `null` quand il n'y a rien à signaler.
 *
 * `sur` (wss://) ne rend aucune ligne : chiffré, donc rien à dire. Un verdict
 * `null` — l'URL n'est pas une URL de ruche — n'en rend pas non plus : ce n'est
 * pas ici qu'on refuse, c'est plus tôt.
 */
export function avertissementTransport(verdict: VerdictTransport | null): string | null {
  if (verdict === 'clair_public') {
    return (
      '   ⚠ Transport EN CLAIR vers une adresse publique : votre clé, les prompts,\n' +
      '     les logs et les diffs de code circuleront sans chiffrement. Demandez à\n' +
      '     l’hôte une URL wss:// (`npm run cli -- tunnel`).'
    );
  }
  if (verdict === 'clair_prive') {
    return '   ℹ Transport en clair sur réseau privé (usuel en local).';
  }
  return null;
}

/**
 * Ce qu'il faut dire de l'agent retenu, ou `null` quand il n'y a rien à dire.
 *
 * Deux situations distinctes mènent au même agent « shell simulé », et les
 * confondre trompe dans les deux sens :
 *
 *   · AUCUN agent IA n'est installé — le mode simulé est alors un repli sûr, et
 *     la phrase doit dire comment en sortir ;
 *   · des agents réels SONT là, mais `HIVE_AGENT` impose le simulé — c'est un
 *     choix, et l'invité doit savoir que sa machine ne travaillera pas.
 *
 * Dire « aucun agent détecté » à quelqu'un qui en a trois installés l'envoie
 * réinstaller ce qu'il possède déjà, au lieu de regarder sa variable
 * d'environnement.
 */
export function annonceAgent(
  retenu: AgentType,
  tousLesAgents: readonly AgentType[],
): string | null {
  if (retenu !== 'shell') return null;
  const auMoinsUnReel = tousLesAgents.some((a) => a !== 'shell');
  if (!auMoinsUnReel) {
    return (
      '   ℹ Aucun agent IA détecté : mode « shell simulé » (sûr, sans exécution réelle).\n' +
      '     Installez Claude Code ou Codex, ou définissez HIVE_AGENT, pour du vrai travail.'
    );
  }
  return '   ℹ Agent « shell simulé » forcé (HIVE_AGENT) alors que des agents réels sont disponibles.';
}
