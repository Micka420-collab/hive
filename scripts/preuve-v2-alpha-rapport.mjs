// LA CONCLUSION DE LA PREUVE V2 ALPHA — le texte imprimé, et la seule
// décision qui compte pour une machine : le code de sortie.
//
// Séparée du coureur pour être jugée sans lancer de processus : c'est ICI que
// se décide ce qui est EXIGÉ. Tout le reste du rapport est dit, ✔ ? ou ✘,
// mais seules ces lignes font sortir en 0 :
//
//   · une mission : A-agent et A-diff ; A-bac sous `--exige-bac` ; Git sous
//     `--depot` (une livraison demandée qui échoue n'est pas une mission
//     livrée) ;
//   · un essaim : les mêmes, pour CHAQUE tâche confiée, plus les critères
//     d'essaim (`EXIGES_ESSAIM`).
//
// L'Evaluator et la reprise après objection sont dits sans être exigés : le
// premier attend des validations qu'un producteur de preuve doit apporter, la
// seconde une objection qu'aucun banc honnête ne peut provoquer.

import { EXIGES_ESSAIM, essaimProuve, jugerEssaim } from './preuve-v2-alpha-essaim.mjs';
import {
  jugerLivraison,
  jugerV2Alpha,
  missionReelleProuvee,
  rapportV2Alpha,
} from './preuve-v2-alpha-verdict.mjs';

/** Ce que la sortie 0 exige, dit en clair quand elle est refusée. */
function exigences({ exigeBac, depot }, essaim) {
  const parTache = ['A-agent', 'A-diff', ...(exigeBac ? ['A-bac'] : [])].join(', ');
  return [
    essaim ? `${parTache} de chaque tâche` : parTache,
    ...(essaim ? EXIGES_ESSAIM : []),
    ...(depot ? ['Git'] : []),
  ].join(', ');
}

/**
 * @param {any} issue  ce que `menerLaPreuve` a rendu avec `ok: true`
 * @param {{ exigeBac?: boolean, depot?: string | null }} options
 * @returns {{ texte: string, prouve: boolean }}
 */
export function conclurePreuve(issue, { exigeBac = false, depot = null } = {}) {
  const git = jugerLivraison(issue.livraisons);
  const livree = !depot || git.etat === 'prouve';

  if (issue.mode !== 'essaim') {
    const verdicts = [...jugerV2Alpha(issue.faits), git];
    const prouve = missionReelleProuvee(verdicts, { exigeBac }) && livree;
    return {
      prouve,
      texte: [
        `Preuve V2 Alpha — mission ${issue.taskId}`,
        '',
        rapportV2Alpha(verdicts),
        '',
        prouve
          ? '✔ Mission réelle prouvée : un agent réel a produit le travail demandé.'
          : `✘ Mission réelle NON prouvée — exigés : ${exigences({ exigeBac, depot }, false)}.`,
      ].join('\n'),
    };
  }

  const blocs = [];
  let taches = true;
  for (const m of issue.missions) {
    const verdicts = jugerV2Alpha(m.faits);
    taches = missionReelleProuvee(verdicts, { exigeBac }) && taches;
    blocs.push(`Tâche ${m.taskId} — ${m.titre}\n${rapportV2Alpha(verdicts)}`);
  }
  const essaim = [...jugerEssaim(issue.essaim), git];
  const prouve = taches && essaimProuve(essaim) && livree;
  return {
    prouve,
    texte: [
      `Preuve V2 Alpha — essaim de ${issue.essaim.requis} ouvrières, projet ${issue.projetId}`,
      '',
      blocs.join('\n\n'),
      '',
      `Essaim\n${rapportV2Alpha(essaim)}`,
      '',
      prouve
        ? '✔ Essaim prouvé : des ouvrières réelles de plusieurs familles ont travaillé en ' +
          'même temps, délégué et relu le travail des autres.'
        : `✘ Essaim NON prouvé — exigés : ${exigences({ exigeBac, depot }, true)}.`,
    ].join('\n'),
  };
}
