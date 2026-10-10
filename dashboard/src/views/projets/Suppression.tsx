// SUPPRIMER UN PROJET — le seul geste de la carte qui emporte tout. Sorti de
// `Projets.tsx` tel quel (découpe #704) ; exporté pour être rendu en test
// (`dashboard/tests/suppression-projet.test.tsx`).

import { useState } from 'react';
import { estAdmin, RefusSuppression, supprimerProjet } from '../../api';
import type { AuthUser, ProjetSupprime } from '../../api';
import { useLang, useT } from '../../i18n';
import { GesteIrreversible, statusLabel } from '../../ui';
import type { Project, TaskStatus } from '../../../../src/shared/types';
import { errMsg, STATUSES } from './commun';
import '../projets.css';

/** Un statut de tâche tel que le rend la Reine — relu, jamais supposé. */
const estStatut = (s: string): s is TaskStatus => (STATUSES as readonly string[]).includes(s);

/**
 * Supprimer le projet — le seul geste de cette carte qui emporte TOUT.
 *
 * ─── POURQUOI LE NOM À RETAPER ───────────────────────────────────────────────
 *
 * Les autres gestes de la carte coupent UNE chose (un membre, un lien). Celui-ci
 * efface des mois de travail — tâches, résultats, journal, mémoires, liens,
 * miroir du code — et la Reine ne garde qu'une ligne d'audit. La question nomme
 * le projet, et la confirmation exige de RETAPER ce nom (`saisie`).
 *
 * ─── LE REFUS SE LIT, IL NE S'AFFICHE PAS SEULEMENT ──────────────────────────
 *
 * Des tâches qui tournent font refuser la suppression (409). L'écran les NOMME,
 * puis le même geste — réarmé, nom retapé — les annule d'abord (`force`). Ce
 * que la Reine refuse même forcé (un merge en vol, un abonnement actif) se dit
 * avec sa marche à suivre, et le geste reste la suppression simple : proposer
 * de forcer promettrait ce qui sera refusé.
 *
 * Visible pour qui la Reine laissera faire : un COMPTE — le propriétaire, ou un
 * administrateur (le seul pour un projet orphelin). Le jeton de ruche seul ne
 * supprime aucun projet (#527) : sans compte, le geste n'est pas proposé.
 * Cosmétique — la garde est à la Reine.
 */
export function SuppressionProjet({
  project,
  user,
  onSupprime,
}: {
  project: Project;
  user: AuthUser | null;
  onSupprime: (fait: ProjetSupprime) => void;
}) {
  const t = useT();
  const lang = useLang();
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const [enVol, setEnVol] = useState<RefusSuppression['taches'] | null>(null);

  // Le MÊME prédicat que la Reine (`suppressionProjetPermise`) : le
  // propriétaire, ou un administrateur. Proposé à qui tient seulement le
  // jeton, le geste ferait retaper le nom pour récolter un refus.
  const peut = estAdmin(user) || (user !== null && project.ownerId === user.id);
  if (!peut) return null;

  const nom = project.name;
  const forcer = enVol !== null && enVol.length > 0;
  const agir = (p: Promise<ProjetSupprime>) => {
    setOccupe(true);
    setErreur(null);
    p.then(onSupprime)
      .catch((e: unknown) => {
        const taches = e instanceof RefusSuppression && e.code === 'taches_en_vol' ? e.taches : [];
        setEnVol(taches.length > 0 ? taches : null);
        if (taches.length === 0) setErreur(errMsg(e));
      })
      .finally(() => setOccupe(false));
  };

  return (
    <div className="pj-sub pj-suppression">
      <div className="pj-sub-head">
        <h4>{t('Supprimer le projet', 'Delete the project')}</h4>
      </div>
      <p className="pj-suppression-dit">
        {t(
          'Tâches, résultats, journal, mémoires, épisodes du Cerveau, liens de partage et miroir du code : tout part, sans retour. Seule une ligne d’audit reste. Les ateliers des ouvrières se nettoient chez elles ; les notes du Cerveau écrites à la main restent.',
          'Tasks, results, journal, memories, Cerveau episodes, share links and the code mirror: everything goes, with no way back. Only one audit line remains. Workers clean up their own workspaces; the Cerveau notes written by hand stay.',
        )}
      </p>
      {forcer && (
        <div className="pj-suppression-envol">
          <p>
            {t(
              `${enVol.length} tâche(s) tournent encore — la suppression les annulera d’abord :`,
              `${enVol.length} task(s) still running — deleting will cancel them first:`,
            )}
          </p>
          <ul>
            {enVol.map((tache) => (
              <li key={tache.id}>
                {tache.title}
                {estStatut(tache.status) && (
                  <span className="pj-meta"> · {statusLabel(tache.status, lang)}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      <GesteIrreversible
        libelle={
          forcer ? t('Annuler et supprimer…', 'Cancel and delete…') : t('Supprimer…', 'Delete…')
        }
        question={t(
          `Supprimer « ${nom} » et tout ce qu’il contient ?`,
          `Delete “${nom}” and everything in it?`,
        )}
        confirmer={t(
          forcer ? 'Annuler et supprimer' : 'Supprimer',
          forcer ? 'Cancel and delete' : 'Delete',
        )}
        saisie={nom}
        disabled={occupe}
        onConfirmer={() => agir(supprimerProjet(project.id, { force: forcer }))}
      />
      {erreur && <p className="panel-error">{erreur}</p>}
    </div>
  );
}
