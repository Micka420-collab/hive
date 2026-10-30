// Le panneau du RÉSEAU DES AGENTS d'un projet — ce que le proxy du nœud laisse
// sortir du bac (`src/shared/reseau.ts`, `src/node-client/proxy-egress.ts`).
//
// PARTI PRIS : trois boutons, et pour chacun ce qu'il OUVRE, dit en une
// phrase. L'humain ne choisit pas « sécurité : moyenne » à l'aveugle ; il voit
// que `ouvert` rend le réseau entier aux agents, et que le défaut n'est pas un
// réglage qu'il aurait oublié mais un choix de la ruche, dit comme tel.
//
// Même forme que le panneau Garde-Fous (mêmes classes, aucun style neuf) :
// c'est un réglage de « ce que le projet s'autorise », à côté des autres.

import { useCallback, useEffect, useState } from 'react';
import { fetchReseauProjet, reglerReseauProjet } from './api';
import type { EtatReseauUi, NiveauReseauUi } from './api';
import { useT } from './i18n';

/** Le nom affichable d'un niveau. */
export function nomNiveauReseau(n: NiveauReseauUi, t: ReturnType<typeof useT>): string {
  switch (n) {
    case 'integrations':
      return t('Intégrations seules', 'Integrations only');
    case 'dependances':
      return t('Dépendances', 'Dependencies');
    default:
      return t('Ouvert', 'Open');
  }
}

/** Ce qu'un niveau OUVRE, en une phrase — pour ne pas le deviner. */
export function descriptionNiveauReseau(n: NiveauReseauUi, t: ReturnType<typeof useT>): string {
  switch (n) {
    case 'integrations':
      return t(
        'L’API du modèle de l’agent, et rien d’autre.',
        'The agent’s model API, and nothing else.',
      );
    case 'dependances':
      return t(
        'L’API du modèle, les registres que le dépôt déclare (lockfiles) et l’hôte git du projet.',
        'The model API, the registries the repository declares (lockfiles) and the project’s git host.',
      );
    default:
      return t(
        'Le réseau entier : aucun filtre, les clés réelles dans le bac.',
        'The whole network: no filter, real keys inside the sandbox.',
      );
  }
}

export function ReseauProjet({ projectId }: { projectId: string }) {
  const t = useT();
  const [etat, setEtat] = useState<EtatReseauUi | null>(null);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  const recharger = useCallback(async () => {
    try {
      setEtat(await fetchReseauProjet(projectId));
      setErreur('');
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void recharger();
  }, [recharger]);

  const appliquer = async (niveau: NiveauReseauUi): Promise<void> => {
    setOccupe(true);
    try {
      await reglerReseauProjet(projectId, niveau);
      await recharger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setOccupe(false);
    }
  };

  if (!etat) {
    return (
      <section className="garde-fou-panneau" data-testid="reseau-projet" aria-busy="true">
        {erreur || t('Chargement du réseau des agents…', 'Loading the agents’ network…')}
      </section>
    );
  }

  return (
    <section className="garde-fou-panneau" data-testid="reseau-projet">
      <h3>{t('Réseau des agents', 'Agents’ network')}</h3>
      <p className="garde-fou-explication">
        {t(
          'Ce que les agents de ce projet peuvent joindre depuis leur bac à sable. Le proxy du nœud refuse le reste, et chaque refus apparaît dans le journal de la tâche. Sur un nœud sans bac, le réseau n’est pas filtré, et la tâche le dit.',
          'What this project’s agents can reach from their sandbox. The node’s proxy refuses the rest, and each refusal shows in the task log. On a node without a sandbox, the network is not filtered, and the task says so.',
        )}
      </p>
      <div className="garde-fou-bornes">
        <fieldset>
          <legend>{t('Niveau', 'Level')}</legend>
          {etat.niveaux.map((n) => (
            <button
              key={n}
              type="button"
              disabled={occupe}
              aria-pressed={etat.niveau === n}
              data-testid={`reseau-${n}`}
              onClick={() => void appliquer(n)}
            >
              {nomNiveauReseau(n, t)}
            </button>
          ))}
        </fieldset>
      </div>
      <p className="garde-fou-elu" data-testid="reseau-niveau">
        <strong>{nomNiveauReseau(etat.niveau, t)}</strong>
        {etat.regle ? '' : t(' (défaut)', ' (default)')}
        {' — '}
        {descriptionNiveauReseau(etat.niveau, t)}
      </p>
      {erreur && <p className="garde-fou-erreur">{erreur}</p>}
    </section>
  );
}
