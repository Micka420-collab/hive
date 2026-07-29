// L'assistant de fin d'installation — le DÉROULÉ, séparé de ce qui l'exécute.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// Il vivait dans `installer-main.ts`. C'était un endroit où AUCUN test ne peut
// aller : `installer-main.ts` appelle `main()` à l'import, donc l'importer
// depuis un test lancerait l'installeur — sonderait des ports, écrirait un
// `.env`, poserait des questions au vide.
//
// La conséquence a été mesurée, pas supposée. L'assistant posait une QUATRIÈME
// décision là où l'accueil en promet trois, sur un `.env` que l'installeur
// venait lui-même de créer, avec « Ne rien changer » pour défaut — donc valider
// au ⏎ jetait le choix fait à l'écran précédent. Le défaut a vécu tout ce temps
// parce que rien ne pouvait l'exercer : il fallait un pseudo-terminal et six
// frappes pour le voir.
//
// Le sortir d'ici ne range rien. Ça rend le déroulé JOUABLE : un faux clavier,
// un faux écran, un faux scribe, et l'on compte les arrêts.
//
// ─── CE QUI RESTE DEHORS, ET C'EST VOULU ─────────────────────────────────────
//
// L'écriture du `.env` est INJECTÉE (`scribe`). Un test qui exerce le déroulé
// ne doit pas pouvoir toucher au `.env` de qui le lance — c'est la même raison
// qui a fait naître la séparation `installer.ts` / `installer-main.ts`.
//
// Et cet assistant ne LANCE rien : poser un tunnel ou un reverse proxy touche à
// des comptes, du DNS et des ports. Ce sont des gestes qui se font les yeux
// ouverts, pas dans le dos de quelqu'un qui voulait installer une ruche. Il
// compose les commandes exactes et les affiche.

import {
  EXPOSITIONS,
  fusionner,
  planExposition,
  planOuvre,
  planProjet,
  type Exposition,
  type ReglagePropose,
} from './assistant.js';
import { PORT_DEFAUT } from './installer.js';
import { constat, recapEcritures, titreSection, type Capacites } from './tui/rendu.js';
import type { Terminal } from './tui/terminal.js';

/** Les quatre façons d'être joignable, dans l'ordre du §8. */
export const OFFRES_EXPOSITION: Record<Exposition, { libelle: string; aide: string }> = {
  locale: { libelle: 'Rien que cette machine', aide: 'le plus sûr — défaut' },
  reseau_local: { libelle: 'Mon réseau local', aide: 'mes amis à la maison' },
  tunnel: { libelle: 'Internet, par un tunnel Cloudflare', aide: 'aucun port ouvert' },
  proxy: { libelle: 'Internet, derrière mon reverse proxy', aide: 'Caddy ou nginx' },
};

export interface ContexteAssistant {
  readonly t: Terminal;
  /** Écrit un bloc de lignes déjà composées, séparées comme le veut le §6.1. */
  readonly bloc: (...morceaux: string[][]) => void;
  readonly caps: Capacites;
  /** Le `.env` tel qu'il est APRÈS le passage de l'installeur. */
  readonly reglages: readonly { cle: string; valeur: string }[];
  /** Le `.env` vient-il d'être créé par CETTE exécution ? */
  readonly neuf: boolean;
  /** Ce qui pose vraiment les réglages sur le disque. Injecté — voir l'en-tête. */
  readonly scribe: (reglages: readonly ReglagePropose[]) => void;
}

/**
 * L'assistant : l'exposition réseau, puis le premier projet.
 *
 * Rend le compte des ARRÊTS — les fois où le programme a attendu un humain.
 * Ce n'est pas une statistique décorative : « ≤ 3 décisions » est un critère du
 * definition of done, et sans ce compte il ne se vérifie qu'à la main, une fois,
 * le jour où quelqu'un y pense.
 */
export async function assistant(ctx: ContexteAssistant): Promise<{ arrets: number }> {
  const { t, bloc, caps, reglages, neuf, scribe } = ctx;
  let arrets = 0;
  /** Un arrêt, c'est le programme qui attend. On les compte tous pareil. */
  const demander = async <T>(faire: () => Promise<T>): Promise<T> => {
    arrets += 1;
    return faire();
  };

  const existant = new Map(reglages.map((r) => [r.cle, r.valeur]));
  const port = Number(existant.get('HIVE_PORT') ?? PORT_DEFAUT) || PORT_DEFAUT;
  const jeton = existant.get('HIVE_TOKEN') ?? '';

  bloc(titreSection('Qui pourra joindre votre ruche ?', caps));
  const choix = await demander(() =>
    t.choisir(
      EXPOSITIONS.map((e) => OFFRES_EXPOSITION[e]),
      { quoi: 'l’exposition réseau', defautNonInteractif: 0 },
    ),
  );
  const exposition = EXPOSITIONS[choix]!;

  const domaine =
    exposition === 'tunnel' || exposition === 'proxy'
      ? await demander(() =>
          t.demander('  Votre domaine (ex. ruche.mondomaine.fr) :', {
            quoi: 'le domaine',
            obligatoire: true,
          }),
        )
      : undefined;

  const plan = planExposition({ exposition, port, jeton, domaine });

  // UN REFUS NE POSE RIEN. Le dire et s'arrêter là vaut mieux qu'écrire une
  // configuration dont on sait déjà qu'elle est dangereuse ou inopérante.
  if (plan.refus) {
    bloc([constat({ etat: 'echec', libelle: plan.refus }, caps)]);
  } else {
    const fusion = fusionner(existant, plan.reglages);
    const aEcrire: ReglagePropose[] = [...fusion.ajouts, ...fusion.changements];

    if (aEcrire.length > 0) {
      // Ajouter et REMPLACER ne se confondent pas : remplacer efface une
      // décision antérieure, et ça se dit avant, pas après.
      bloc(
        recapEcritures(
          [
            ...fusion.ajouts.map((r) => `${r.cle}=${r.valeur}   (${r.pourquoi})`),
            ...fusion.changements.map(
              (r) => `${r.cle} : ${r.ancienne}  →  ${r.valeur}   (${r.pourquoi})`,
            ),
          ],
          caps,
        ),
      );
      // ─── QUAND LE RÉCAPITULATIF INFORME AU LIEU DE DEMANDER ────────────────
      //
      // MÊME RÈGLE QU'À L'ÉCRAN PRÉCÉDENT, appliquée jusqu'au bout : sur un
      // fichier qu'on vient de créer, il n'y a aucune décision antérieure à
      // écraser — « la question serait une friction sans contrepartie ». Elle
      // était pire que ça : sa réponse par défaut, « Ne rien changer », JETAIT
      // le choix fait deux secondes plus tôt.
      //
      // La confirmation reste, entière, dès que le plan OUVRE la machine —
      // réseau local, tunnel, reverse proxy. Rendre une ruche joignable n'est
      // pas une friction : c'est le dernier arrêt avant la porte, et il se
      // franchit les yeux ouverts.
      //
      // Le récapitulatif, lui, s'affiche dans les deux cas : rien n'est jamais
      // écrit sans être nommé d'abord.
      const suite =
        !neuf || planOuvre(plan)
          ? await demander(() =>
              t.choisir(
                [{ libelle: 'Ne rien changer', aide: 'défaut' }, { libelle: 'Poser ces réglages' }],
                { quoi: 'la confirmation des réglages réseau', defautNonInteractif: 0 },
              ),
            )
          : 1;
      if (suite === 1) {
        scribe(aEcrire);
        bloc([constat({ etat: 'fait', libelle: '.env mis à jour' }, caps)]);
      } else {
        bloc([constat({ etat: 'avenir', libelle: 'Rien écrit.' }, caps)]);
      }
    }

    for (const a of plan.avertissements) {
      bloc([constat({ etat: 'alerte', libelle: a }, caps)]);
    }
    if (plan.etapes.length > 0) {
      bloc(titreSection('Ce qu’il reste à faire, une fois pour toutes', caps));
      for (const e of plan.etapes) {
        bloc([
          `  ${e.titre}`,
          '',
          ...e.commande.split('\n').map((l) => `      ${l}`),
          '',
          `     ${e.pourquoi}`,
        ]);
      }
    }
  }

  // ─── Le premier projet ──────────────────────────────────────────────────
  bloc(titreSection('Votre premier projet', caps));
  const nom = await demander(() =>
    t.demander('  Son nom (⏎ pour passer) :', { quoi: 'le nom du projet' }),
  );
  if (nom === '') return { arrets };

  const depot = await demander(() =>
    t.demander('  Son dépôt git (⏎ pour aucun) :', { quoi: 'le dépôt' }),
  );
  const projet = planProjet(nom, depot === '' ? undefined : depot);
  if (projet.refus) {
    bloc([constat({ etat: 'echec', libelle: projet.refus }, caps)]);
    return { arrets };
  }
  for (const a of projet.avertissements) bloc([constat({ etat: 'alerte', libelle: a }, caps)]);
  bloc([
    '  Une fois la ruche démarrée (« npm run dev »), créez-le avec :',
    '',
    `      ${projet.commande}`,
  ]);
  return { arrets };
}
