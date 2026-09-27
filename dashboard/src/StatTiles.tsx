// Rangée de KPI : l'état de la ruche en un coup d'œil.

import type { StateSnapshot } from '../../src/shared/types';
import type { DepenseRuche } from './api';
import { useLang, useT } from './i18n';
import { direSommeDeclaree, direUsd, ProgressBar } from './ui';
import { direNote } from './horloge-vue';
import type { NoteVue } from './horloge-vue';
import { direDuree } from '../../src/shared/horloge-chantier';

interface Props {
  snapshot: StateSnapshot;
  /** Débit : tâches terminées dans la dernière minute (dérivé du journal). */
  throughput: number;
  /**
   * La note que l'horloge s'est donnée, si le journal en porte encore une.
   *
   * Optionnel, et il faut qu'il le reste : le journal est élagué. Absent, la
   * tuile ne se rend PAS — une tuile vide se lirait « la ruche ne se note
   * pas », alors que la vérité est « le journal ne s'en souvient plus ».
   */
  calibration?: NoteVue;
  /**
   * La dépense des dernières 24 heures (`GET /api/cockpit`). Absente tant que
   * le cockpit n'a pas répondu : la tuile ne se rend pas — un « 0 $ » affiché
   * pendant le chargement se lirait « rien dépensé ».
   */
  depense?: DepenseRuche;
}

export function StatTiles({ snapshot, throughput, calibration, depense }: Props) {
  const t = useT();
  const lang = useLang();
  const { nodes, tasks } = snapshot;
  // ─── LA FENÊTRE SE DIT, ELLE NE SE DEVINE PAS ──────────────────────────────
  //
  // L'instantané ne transporte plus la table entière : au-delà de 2 000 tâches,
  // il n'en porte que les vivantes et les terminées les plus récentes. Un
  // compteur « 1 200 / 2 000 » sur une ruche qui en a 20 000 serait faux dans
  // les deux sens à la fois — le numérateur ne voit qu'une fenêtre, et le
  // dénominateur ferait croire qu'il n'y a rien d'autre.
  //
  // On ne bricole donc pas la fraction : on garde le rapport SUR LA FENÊTRE, et
  // on écrit à côté ce que la fenêtre laisse dehors.
  const tronque = snapshot.tasksTotal > tasks.length;
  const online = nodes.filter((n) => n.status === 'online').length;
  const done = tasks.filter((t) => t.status === 'done').length;
  const running = tasks.filter((t) => t.status === 'running' || t.status === 'assigned').length;
  const failed = tasks.filter((t) => t.status === 'failed').length;
  const onlineNodes = nodes.filter((n) => n.status === 'online');
  const capacity = onlineNodes.reduce((sum, n) => sum + n.maxConcurrency, 0);
  // Charge = tâches actives des nœuds EN LIGNE (cohérent avec la capacité).
  const load = onlineNodes.reduce((sum, n) => sum + n.running, 0);

  return (
    <div className="stat-tiles">
      <div className="tile">
        <div className="tile-value">
          {online}
          <span className="tile-unit">/{nodes.length}</span>
        </div>
        <div className="tile-label">{t('Nœuds en ligne', 'Nodes online')}</div>
        <ProgressBar value={online} max={Math.max(nodes.length, 1)} />
      </div>

      <div className="tile accent">
        <div className="tile-value">
          {done}
          <span className="tile-unit">/{tasks.length}</span>
        </div>
        <div className="tile-label">{t('Tâches terminées', 'Tasks done')}</div>
        <ProgressBar value={done} max={Math.max(tasks.length, 1)} />
        {tronque && (
          <div className="tile-sub" title={t('Fenêtre de l’instantané', 'Snapshot window')}>
            {t('sur les ', 'of the last ')}
            {tasks.length}
            {t(' plus récentes · ', ' · ')}
            {snapshot.tasksTotal}
            {t(' au total', ' in total')}
          </div>
        )}
      </div>

      <div className="tile">
        <div className="tile-value">{running}</div>
        <div className="tile-label">{t('En cours', 'Running')}</div>
        <ProgressBar value={load} max={Math.max(capacity, 1)} />
        <div className="tile-sub">
          {t('charge', 'load')} {load}/{capacity}
        </div>
      </div>

      <div className={`tile${failed > 0 ? ' danger' : ''}`}>
        <div className="tile-value">{failed}</div>
        <div className="tile-label">{t('Échecs', 'Failures')}</div>
      </div>

      <div className="tile">
        <div className="tile-value">
          {throughput}
          <span className="tile-unit"> /min</span>
        </div>
        <div className="tile-label">{t('Débit', 'Throughput')}</div>
      </div>

      {/*
        LA DÉPENSE N'EST UN CHIFFRE DE TÊTE QU'AVEC SA COUVERTURE.

        Le coût vient de ce que les CLI des agents DÉCLARENT : Claude Code le
        dit, Codex ne dit que ses jetons. Un total nu se lirait comme une
        facture ; il est donc toujours suivi de « 3/5 tentatives déclarées », et
        précédé de « ≥ » quand une tentative s'est tue. Rien n'est extrapolé à
        la tentative muette. Le temps modèle suit la même règle ; le temps
        Worker, lui, est MESURÉ par les nœuds.
      */}
      {depense && <TuileDepense depense={depense} />}

      {/*
        L'HORLOGE SE NOTE, ET LA NOTE EST À L'ÉCRAN.

        Une horloge qui affiche sa propre erreur est utilisable ; une horloge
        faussement précise ne l'est pas. Cette tuile est ce qui sépare les deux.

        `optimiste` est le seul verdict peint en alerte, et c'est asymétrique
        exprès : l'horloge promet alors PLUS COURT que la réalité, et tout ce
        qui se planifie dessus déborde. `pessimiste` coûte de l'attente ;
        `optimiste` coûte des promesses tenues par personne.
      */}
      {calibration && (
        <div className={`tile${calibration.verdict === 'optimiste' ? ' danger' : ''}`}>
          <div className="tile-value tile-value-mot">
            {calibration.verdict === 'trop_peu'
              ? t('—', '—')
              : `${Math.round(calibration.partTenue * 100)}`}
            {calibration.verdict !== 'trop_peu' && <span className="tile-unit"> %</span>}
          </div>
          <div className="tile-label">{t('Horloge tenue', 'Clock held')}</div>
          <div className="tile-sub" title={direNote(calibration, lang)}>
            {direNote(calibration, lang)}
          </div>
        </div>
      )}
    </div>
  );
}

function TuileDepense({ depense }: { depense: DepenseRuche }) {
  const t = useT();
  const lang = useLang();
  const cout = direSommeDeclaree(depense.coutFournisseur, (v) => direUsd(v, lang), t);
  const modele = direSommeDeclaree(depense.dureeModele, (v) => direDuree(v, lang), t);
  const aucune = depense.tentatives === 0;
  return (
    <div className="tile" data-testid="tuile-depense">
      <div className="tile-value tile-value-mot">{aucune ? '—' : cout.valeur}</div>
      <div className="tile-label">{t('Dépense déclarée · 24 h', 'Declared spend · 24 h')}</div>
      <div className="tile-sub" data-testid="depense-couverture">
        {aucune
          ? t('aucune tentative sur 24 h', 'no attempt in 24 h')
          : (cout.couverture ??
            t(
              `aucune des ${depense.tentatives} tentative(s) ne déclare son coût`,
              `none of the ${depense.tentatives} attempt(s) declares its cost`,
            ))}
      </div>
      {!aucune && (
        <div className="tile-sub" data-testid="depense-temps">
          {t('modèle', 'model')} {modele.valeur}
          {modele.couverture ? ` (${modele.couverture})` : ''} · {t('Worker', 'Worker')}{' '}
          {depense.dureeWorker
            ? direDuree(depense.dureeWorker.totalMs, lang)
            : t('non mesuré', 'not measured')}
        </div>
      )}
      {depense.tronquee && (
        <div
          className="tile-sub"
          data-testid="depense-tronquee"
          title={t(
            'Le journal a été élagué : des tentatives de ces 24 heures ont pu en sortir.',
            'The journal was pruned: attempts from these 24 hours may have left it.',
          )}
        >
          {t('journal élagué : ont pu manquer', 'journal pruned: some may be missing')}
        </div>
      )}
    </div>
  );
}
