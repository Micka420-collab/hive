// Choix du modèle au premier lancement.
//
// Les candidats viennent uniquement de la configuration locale ou de
// suggestions clairement marquées. Rien n'est appelé chez un fournisseur :
// l'humain confirme ce que son compte sait réellement utiliser.

import type { AgentType } from './agent-detect.js';
import type { ModeleLocal } from './modeles-locaux.js';
import { parseModeles } from './modeles.js';
import { outil } from '../shared/catalogue-outils.js';

export type ChoixModele = { ok: true; modeles: string[] | null } | { ok: false };

export function agentAccepteModele(agent: AgentType): boolean {
  return outil(agent)?.capacites.modeleChoisi === true;
}

export function sourceModeleLisible(source: ModeleLocal['source']): string {
  switch (source) {
    case 'environnement':
      return 'configuré par variable';
    case 'configuration':
      return 'trouvé dans la configuration locale';
    case 'suggestion':
      return 'suggestion — accès compte à confirmer';
  }
}

export function menuChoixModele(candidats: readonly ModeleLocal[]): string {
  const lignes = [
    '  1. Automatique — laisser l’application choisir',
    ...candidats.map((m, i) => `  ${i + 2}. ${m.id} · ${sourceModeleLisible(m.source)}`),
  ];
  if (candidats.length > 1) {
    lignes.push(
      `  ${candidats.length + 2}. Tous les modèles listés — laisser l’Aiguillage choisir`,
    );
  }
  return `Modèle pour ce nœud :\n${lignes.join('\n')}`;
}

export function interpreterChoixModele(
  saisie: string,
  candidats: readonly ModeleLocal[],
): ChoixModele {
  const propre = saisie.trim();
  if (propre === '' || propre === '1') return { ok: true, modeles: null };
  const index = Number(propre);
  if (!Number.isInteger(index)) return { ok: false };
  if (index >= 2 && index <= candidats.length + 1) {
    const choisi = candidats[index - 2];
    return choisi ? { ok: true, modeles: [choisi.id] } : { ok: false };
  }
  if (candidats.length > 1 && index === candidats.length + 2) {
    return { ok: true, modeles: candidats.map((m) => m.id) };
  }
  return { ok: false };
}

/**
 * Priorité : HIVE_MODELES explicite → préférence locale → question TTY →
 * défaut de l'application. Un agent qui n'honore pas `ctx.modele` ne déclare
 * rien, même si HIVE_MODELES existe : attribuer ses résultats au mauvais
 * modèle empoisonnerait l'Aiguillage.
 */
export async function resoudreModelesAuDemarrage(opts: {
  agent: AgentType;
  env?: NodeJS.ProcessEnv;
  preference?: string[] | null;
  reconfigurer?: boolean;
  candidats: readonly ModeleLocal[];
  stdinEstTty?: boolean;
  demander?: (question: string) => Promise<string>;
  informer?: (message: string) => void;
}): Promise<string[] | undefined> {
  const env = opts.env ?? process.env;
  const informer = opts.informer ?? console.log;
  if (!agentAccepteModele(opts.agent)) {
    if ((env.HIVE_MODELES ?? '').trim()) {
      informer(
        `   ⚠ HIVE_MODELES ignoré : ${opts.agent} ne sait pas encore recevoir un modèle choisi.`,
      );
    }
    return undefined;
  }

  const explicites = parseModeles(env.HIVE_MODELES);
  if (explicites) return explicites;
  if (!opts.reconfigurer && opts.preference !== undefined) {
    return opts.preference ?? undefined;
  }
  if (!opts.stdinEstTty || !opts.demander) return undefined;
  if (opts.candidats.length === 0) {
    informer(`   Modèle : automatique — aucune configuration locale lisible pour ${opts.agent}.`);
    return undefined;
  }

  informer(`\n${menuChoixModele(opts.candidats)}`);
  for (;;) {
    const max = opts.candidats.length + (opts.candidats.length > 1 ? 2 : 1);
    const saisie = await opts.demander(
      `Quel modèle utiliser ? [1-${max}] (Entrée = automatique) : `,
    );
    const choix = interpreterChoixModele(saisie, opts.candidats);
    if (choix.ok) {
      informer(
        choix.modeles
          ? `   → ${choix.modeles.join(', ')} confirmé(s) pour ce nœud.\n`
          : `   → Modèle automatique : ${opts.agent} garde son choix par défaut.\n`,
      );
      return choix.modeles ?? undefined;
    }
    informer(`   Saisie invalide — choisissez un numéro entre 1 et ${max}.`);
  }
}
