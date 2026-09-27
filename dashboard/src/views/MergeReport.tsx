// LE RAPPORT D'UN MERGE RENDU — applied, conflits, verdict des tests, journal.
//
// Sorti de `Projets.tsx` parce que DEUX gestes le rendent : le merge d'essai
// du plan Honeycomb, et la livraison d'une mission (`LivraisonMission.tsx`).
// Deux copies d'un rapport qu'on lit pour décider de fusionner finiraient par
// ne plus dire la même chose du même résultat.

import type { MergeRunResult } from '../api';
import { useT } from '../i18n';
import { verdictDesTests } from './projets-rendu';

/** Le rapport d'un merge rendu par une ouvrière. */
export function MergeReport({
  result,
  taskTitles,
}: {
  result: MergeRunResult;
  taskTitles: Map<string, string>;
}) {
  const t = useT();
  // L'ENVIRONNEMENT EN ÉCHEC N'EST PAS UN TEST ROUGE. Les tests n'ont alors pas
  // tourné du tout : afficher « tests non lancés » sans dire pourquoi enverrait
  // chercher une régression dans du code qui va très bien.
  const envRate = result.preparedOk === false;
  // Les CINQ issues vivent dans `verdictDesTests`, pure et éprouvée : ce
  // message est lu pour décider de fusionner, et son mutant le plus grave
  // annonce « ✔ tests verts » sur une suite rouge.
  const tests = verdictDesTests(result, t);
  // UN MERGE QUI N'A PAS EU LIEU N'EST PAS UN MERGE VIDE. Sans cette ligne, un
  // clone refusé (identifiants, dépôt introuvable) se lisait « 0 diff(s)
  // appliqué(s), 0 conflit(s) » — un succès creux — et la cause dormait dans
  // le journal replié. Le journal s'ouvre donc aussi : c'est lui qui la porte.
  const avorte = result.refused;
  return (
    <div className="pj-merge-report">
      {avorte ? (
        <p className="panel-error">
          {t('Merge non effectué :', 'Merge not performed:')} {avorte}
        </p>
      ) : (
        <p>
          <strong>{result.applied.length}</strong> {t('diff(s) appliqué(s),', 'diff(s) applied,')}{' '}
          <strong>{result.conflicts.length}</strong> {t('conflit(s)', 'conflict(s)')} — {tests}
        </p>
      )}
      {envRate && (
        <p className="panel-error">
          {t(
            'L’installation des dépendances a échoué sur le nœud : le code n’est pas en cause. Vérifiez son accès réseau, puis le fichier de verrouillage du dépôt.',
            'Dependency installation failed on the node: the code is not at fault. Check its network access, then the repository lockfile.',
          )}
        </p>
      )}
      {result.applied.length > 0 && (
        <ul className="pj-applied">
          {result.applied.map((id) => (
            <li key={id}>✔ {taskTitles.get(id) ?? id}</li>
          ))}
        </ul>
      )}
      {result.conflicts.length > 0 && (
        <ul className="pj-conf-list">
          {result.conflicts.map((c) => (
            <li key={c.taskId}>
              <strong>{taskTitles.get(c.taskId) ?? c.taskId}</strong> — {c.reason}
            </li>
          ))}
        </ul>
      )}
      {result.logs && (
        <details className="pj-report-detail" open={Boolean(avorte)}>
          <summary>{t('Journal du merge', 'Merge log')}</summary>
          <pre className="code-block scroll">{result.logs}</pre>
        </details>
      )}
    </div>
  );
}
