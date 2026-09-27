// Le registre des connecteurs — la liste des intégrations que la ruche connaît.
//
// C'est du CODE, pas de la donnée : le registre référence des DÉFINITIONS
// (`DefinitionConnecteur`), immuables, comme le catalogue des clés d'API
// (`requisition-env.ts`) référence des fournisseurs. La base ne garde que ce
// qu'un humain a décidé (les autorisations par projet, le journal des appels) ;
// jamais la définition elle-même, qui vivrait alors en double et finirait par
// contredire le code.
//
// Ajouter un connecteur = ajouter une définition ici. La garde du serveur, le
// journal et l'UI le voient tous par ce même registre : un connecteur absent du
// registre n'est autorisable nulle part, et une autorisation en base qui vise
// un id disparu est ignorée à la lecture (jamais appliquée à l'aveugle).

import type { DefinitionConnecteur } from './contrat.js';
import { DEF_WEBHOOK } from './webhook/definition.js';
import { DEF_SLACK } from './slack/definition.js';

/**
 * Les connecteurs livrés. GitHub n'y est PAS : son importeur de dépôt est
 * antérieur au contrat et n'a ni portée ni journal ; l'absorber demanderait de
 * réécrire son chemin d'auth, hors de la portée de ce lot (suivi séparément).
 */
const DEFINITIONS: readonly DefinitionConnecteur[] = Object.freeze([DEF_WEBHOOK, DEF_SLACK]);

const PAR_ID = new Map<string, DefinitionConnecteur>(DEFINITIONS.map((d) => [d.id, d]));

/** La définition d'un connecteur, ou `undefined` s'il n'est pas au registre. */
export function definitionConnecteur(id: string): DefinitionConnecteur | undefined {
  return PAR_ID.get(id);
}

/** Ce connecteur existe-t-il au registre ? */
export function connecteurConnu(id: string): boolean {
  return PAR_ID.has(id);
}

/** Toutes les définitions, dans l'ordre du registre (déterministe). */
export function listerDefinitions(): readonly DefinitionConnecteur[] {
  return DEFINITIONS;
}
