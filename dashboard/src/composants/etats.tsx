// LES TROIS ÉTATS D'UNE ZONE QUI N'A PAS (ENCORE) SES DONNÉES — chargement,
// vide, panne.
//
// Le tableau de bord les écrivait chacun à sa façon : « Chargement… » en texte
// nu à un endroit, un paragraphe gris à un autre, une ligne rouge sans geste
// ailleurs. Trois conséquences :
//
//   · un chargement en texte nu fait SAUTER la mise en page à l'arrivée des
//     données — le squelette réserve la place qu'elles prendront ;
//   · un « rien » sans phrase ne dit pas si c'est normal (aucun projet encore)
//     ou si quelque chose manque (le relevé n'est pas revenu) : l'état vide
//     NOMME l'absence et, quand il y en a une, propose l'action qui la comble ;
//   · une panne sans « Réessayer » est une impasse : l'état d'erreur porte
//     TOUJOURS ce geste. Un relevé qui a échoué et qu'on ne peut que regarder
//     apprend à recharger toute la page.
//
// Aucun des trois n'invente une donnée : un vide dit « aucun », jamais « 0 ».

import type { ReactNode } from 'react';
import { useT } from '../i18n';

/**
 * Des lignes grises à la place du contenu attendu. Annoncé une fois
 * (« Chargement… », `role="status"`), les lignes elles-mêmes sont muettes.
 */
export function Skeleton({ lignes = 3, libelle }: { lignes?: number; libelle?: string }) {
  const t = useT();
  return (
    <div className="ds-squelette" role="status" aria-busy="true">
      <span className="ds-invisible">{libelle ?? t('Chargement…', 'Loading…')}</span>
      {Array.from({ length: Math.max(1, lignes) }, (_, i) => (
        <span key={i} className="ds-squelette-ligne" aria-hidden="true" />
      ))}
    </div>
  );
}

/** Rien à montrer — et pourquoi, et quoi faire. */
export function EmptyState({
  titre,
  texte,
  action,
}: {
  titre: ReactNode;
  texte?: ReactNode;
  /** Le geste qui comble le vide (« Démarrer un projet »), s'il y en a un. */
  action?: ReactNode;
}) {
  return (
    <div className="ds-vide">
      <span className="ds-vide-marque" aria-hidden="true" />
      <p className="ds-vide-titre">{titre}</p>
      {texte && <p className="ds-vide-texte">{texte}</p>}
      {action && <div className="ds-vide-action">{action}</div>}
    </div>
  );
}

/**
 * Une lecture a échoué. `role="alert"` : elle est annoncée dès qu'elle paraît.
 * `enCours` éteint « Réessayer » pendant la relance — en `aria-disabled`, pas
 * `disabled` : le bouton GARDE le focus, et le clavier ne tombe pas au début
 * de la page au moment où l'on relance (même choix que `EchecSondage`).
 * Sans `onReessayer`, pas de bouton : un « Réessayer » qui échouera à coup
 * sûr (appareil sans réseau, jeton refusé renvoyé tel quel) ment sur le remède.
 */
export function ErrorState({
  titre,
  detail,
  onReessayer,
  enCours = false,
}: {
  titre: ReactNode;
  detail?: ReactNode;
  onReessayer?: () => void;
  enCours?: boolean;
}) {
  const t = useT();
  return (
    <div className="ds-erreur" role="alert">
      <p className="ds-erreur-titre">
        <span aria-hidden="true">⚠ </span>
        {titre}
      </p>
      {detail && <p className="ds-erreur-detail">{detail}</p>}
      {onReessayer && (
        <button
          type="button"
          className="btn"
          aria-disabled={enCours || undefined}
          onClick={() => {
            if (!enCours) onReessayer();
          }}
        >
          {enCours ? t('Nouvel essai…', 'Retrying…') : t('Réessayer', 'Retry')}
        </button>
      )}
    </div>
  );
}
