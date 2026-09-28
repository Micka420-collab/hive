// LA LIAISON AVEC LA RUCHE, DITE À L'ÉCRAN — hors ligne, pas encore arrivé,
// ou jeton refusé.
//
// ─── CE QUI MENTAIT ──────────────────────────────────────────────────────────
//
// L'écran démarre sur un instantané VIDE, en attendant le premier `state` du
// flux. Tant qu'il n'était pas arrivé — et s'il n'arrivait jamais, Reine
// arrêtée —, chaque vue disait son état vide comme une vérité : « Votre ruche
// est prête — démarrez un projet » sur une ruche qui en a quarante, « aucune
// production à revoir » sur une file pleine. Un vide et une absence de
// nouvelles se ressemblaient à l'octet près.
//
// Et une coupure en cours de route ne se lisait qu'à une pastille de la barre
// (« hors ligne »), à côté d'un écran qui continuait d'afficher, sans le
// dire, un état figé à l'heure de la coupure — et dont chaque geste allait
// échouer.
//
// ─── CE QUI EST DÉCIDÉ ICI, ET SEULEMENT ICI ─────────────────────────────────
//
// `lireLiaison` est PURE : elle reçoit les faits que la coquille tient déjà
// (premier instantané reçu, coupure du flux, réseau de l'appareil, jeton
// refusé, coupure pour lenteur) et rend UNE décision fermée :
//
//   · `squelette` — rien n'est encore arrivé, rien n'a encore échoué : on
//     réserve la place, on ne dit pas « vide » ;
//   · `panne`     — rien n'est arrivé ET la liaison a échoué : on dit pourquoi,
//     avec « Réessayer » (jamais une vue vide à la place) ;
//   · `vue`       — un instantané existe : la vue s'affiche, avec un bandeau
//     si la liaison est coupée depuis (ce qu'on voit peut être périmé).
//
// Le jeton refusé a déjà son bandeau (App.tsx) : on n'en empile pas un second
// qui dirait « hors ligne » pour la même cause.

import { useT } from './i18n';
import { ErrorState, Skeleton } from './composants';
import { timeShort } from './views/shared';

/** Ce que la coquille sait de sa liaison — des FAITS, relevés à leur source. */
export interface FaitsLiaison {
  /** Un `state` complet est arrivé au moins une fois depuis le chargement. */
  instantaneRecu: boolean;
  /** Le flux est tombé à cette heure-là et n'est pas revenu ; `null` = relié ou jamais tenté. */
  coupeDepuis: number | null;
  /** Le navigateur se dit sans réseau depuis cette heure-là ; `null` = réseau présent. */
  horsReseauDepuis: number | null;
  jetonRefuse: boolean;
  /** La Reine a coupé cet écran parce qu'il lisait trop lentement. */
  tropLent: boolean;
}

export type CauseCoupure = 'reseau' | 'ruche' | 'trop_lent';

export type Liaison =
  | { affichage: 'squelette' }
  | { affichage: 'panne'; cause: 'jeton' | 'reseau' | 'ruche' }
  | { affichage: 'vue'; bandeau: { cause: CauseCoupure; depuis: number } | null };

export function lireLiaison(f: FaitsLiaison): Liaison {
  if (!f.instantaneRecu) {
    if (f.jetonRefuse) return { affichage: 'panne', cause: 'jeton' };
    if (f.horsReseauDepuis !== null) return { affichage: 'panne', cause: 'reseau' };
    if (f.coupeDepuis !== null) return { affichage: 'panne', cause: 'ruche' };
    return { affichage: 'squelette' };
  }
  if (f.jetonRefuse) return { affichage: 'vue', bandeau: null };
  // Le réseau de l'APPAREIL d'abord : c'est la cause que l'on peut réparer
  // soi-même, et « la ruche ne répond plus » y enverrait chercher à tort.
  if (f.horsReseauDepuis !== null) {
    return {
      affichage: 'vue',
      bandeau: { cause: 'reseau', depuis: f.coupeDepuis ?? f.horsReseauDepuis },
    };
  }
  if (f.coupeDepuis !== null) {
    return {
      affichage: 'vue',
      bandeau: { cause: f.tropLent ? 'trop_lent' : 'ruche', depuis: f.coupeDepuis },
    };
  }
  return { affichage: 'vue', bandeau: null };
}

/**
 * Le bandeau d'une liaison coupée APRÈS un premier instantané. « Réessayer
 * maintenant » n'est offert que là où il peut servir : sans réseau, rappeler
 * la ruche échoue à coup sûr ; coupé pour lenteur, la Reine refuserait de
 * même — le recul existe pour ça.
 */
export function BandeauHorsLigne({
  cause,
  depuis,
  dernierEssai,
  onReessayer,
}: {
  cause: CauseCoupure;
  depuis: number;
  /** Heure du dernier échec : elle bouge à chaque essai, et prouve le clic. */
  dernierEssai: number | null;
  onReessayer: () => void;
}) {
  const t = useT();
  const heure = timeShort(depuis);
  const texte =
    cause === 'reseau'
      ? t(
          `Cet appareil n’a plus de réseau (depuis ${heure}). L’écran montre l’état de ce moment-là et ne bouge plus ; il se reconnecte seul au retour du réseau.`,
          `This device has no network (since ${heure}). The screen shows the state from that moment and no longer updates; it reconnects on its own once the network is back.`,
        )
      : cause === 'trop_lent'
        ? t(
            `Coupé par la Reine à ${heure} : cet écran lisait moins vite qu’elle n’écrivait. Il se reconnecte seul, puis rattrape le journal.`,
            `Cut by the Queen at ${heure}: this screen read slower than she wrote. It reconnects on its own, then catches up the journal.`,
          )
        : t(
            `La ruche ne répond plus depuis ${heure}. Ce qui s’affiche peut être périmé, et vos gestes échoueront jusqu’au retour ; l’écran se reconnecte seul.`,
            `The hive has not answered since ${heure}. What is shown may be stale, and your actions will fail until it is back; the screen reconnects on its own.`,
          );
  return (
    <div className="mc-token-banner mc-session-banner mc-hors-ligne" role="status">
      <p>
        <strong>{t('Hors ligne.', 'Offline.')}</strong> {texte}
        {dernierEssai !== null && cause === 'ruche' && (
          <span className="echec-sondage-quand">
            {' '}
            {t('dernier essai à', 'last attempt at')} {timeShort(dernierEssai)}
          </span>
        )}
      </p>
      {cause === 'ruche' && (
        <button type="button" className="btn ghost" onClick={onReessayer}>
          {t('Réessayer maintenant', 'Retry now')}
        </button>
      )}
    </div>
  );
}

/**
 * La place de la vue tant qu'aucun instantané n'est arrivé : un squelette, ou
 * la panne qui l'empêche d'arriver. Jamais l'état vide d'une vue.
 */
export function AvantPremierEtat({
  liaison,
  onReessayer,
}: {
  liaison: Exclude<Liaison, { affichage: 'vue' }>;
  onReessayer: () => void;
}) {
  const t = useT();
  if (liaison.affichage === 'squelette') {
    return (
      <div className="mc-view mc-avant-etat">
        <Skeleton lignes={6} libelle={t('Lecture de la ruche…', 'Reading the hive…')} />
      </div>
    );
  }
  const { titre, detail } =
    liaison.cause === 'jeton'
      ? {
          titre: t('La ruche refuse ce jeton.', 'The hive rejects this token.'),
          detail: t(
            'Rien n’est affiché tant qu’elle ne l’accepte pas : collez HIVE_TOKEN dans le champ « Jeton » en haut à droite.',
            'Nothing is shown until it accepts it: paste HIVE_TOKEN into the Token field at the top right.',
          ),
        }
      : liaison.cause === 'reseau'
        ? {
            titre: t('Cet appareil n’a pas de réseau.', 'This device has no network.'),
            detail: t(
              'La ruche n’a encore rien pu envoyer. L’écran se reconnecte seul au retour du réseau.',
              'The hive could not send anything yet. The screen reconnects on its own once the network is back.',
            ),
          }
        : {
            titre: t('La ruche ne répond pas.', 'The hive does not answer.'),
            detail: t(
              'Aucun état n’est encore arrivé : ce n’est pas une ruche vide. Vérifiez que l’orchestrateur tourne (npm run ruche) ; l’écran réessaie seul.',
              'No state has arrived yet: this is not an empty hive. Check that the orchestrator is running (npm run ruche); the screen retries on its own.',
            ),
          };
  return (
    <div className="mc-view mc-avant-etat">
      <ErrorState titre={titre} detail={detail} onReessayer={onReessayer} />
    </div>
  );
}
