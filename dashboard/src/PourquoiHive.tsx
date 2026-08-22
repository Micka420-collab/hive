// Story produit — pourquoi Hive vs agents solo (Cursor, Devin…).
// Réutilisé dans Mon espace et Chronique : même message, pas de marketing inventé.

import { useT } from './i18n';

export function PourquoiHive({ compact = false }: { compact?: boolean }) {
  const t = useT();
  if (compact) {
    return (
      <p className="pourquoi-hive-compact muted-text">
        {t(
          'Hive coordonne plusieurs machines réelles, avec revue humaine avant merge — pas un agent isolé sur un seul poste.',
          'Hive coordinates multiple real machines, with human review before merge — not a lone agent on one laptop.',
        )}
      </p>
    );
  }
  return (
    <aside className="pourquoi-hive" aria-label={t('Pourquoi Hive', 'Why Hive')}>
      <h3>{t('Pourquoi Hive plutôt qu’un agent solo ?', 'Why Hive over a solo agent?')}</h3>
      <ul>
        <li>
          {t(
            'Multi-machine : plusieurs ouvrières sur des postes distincts, orchestrées par la Reine — pas un seul IDE.',
            'Multi-machine: several workers on distinct machines, orchestrated by the Queen — not a single IDE.',
          )}
        </li>
        <li>
          {t(
            'Merge gate humain : la Miellerie valide chaque diff avant fusion — pas de push autonome silencieux.',
            'Human merge gate: the Honeycomb validates every diff before merge — no silent autonomous push.',
          )}
        </li>
        <li>
          {t(
            'Mémoire collective (Hive Mind) et veille techno (OpenAlex) partagées entre tâches et projets longs.',
            'Collective memory (Hive Mind) and tech watch (OpenAlex) shared across tasks and long projects.',
          )}
        </li>
        <li>
          {t(
            'Autonomie graduée (Plein Essaim) : vous choisissez jusqu’où la ruche va seule, avec checklist explicite.',
            'Graduated autonomy (Full Swarm): you choose how far the hive runs alone, with an explicit checklist.',
          )}
        </li>
      </ul>
      <p className="muted-text">
        {t(
          'Cursor ou Devin excellent sur un poste ; Hive vise l’équipe distribuée, la reprise après échec et la gouvernance.',
          'Cursor or Devin excel on one machine; Hive targets distributed teams, failure recovery, and governance.',
        )}
      </p>
    </aside>
  );
}
