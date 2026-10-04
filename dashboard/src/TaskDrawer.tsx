// Tiroir latéral : détail complet d'une tâche + son résultat (diff/logs) pour
// revue humaine, avec possibilité d'annuler une tâche en cours.

import { lazy, Suspense, useEffect, useState } from 'react';
import { cancelTask, fetchDelegationGraph, fetchRace, fetchResults, raceTask } from './api';
import type {
  DelegationEvent,
  DelegationRecord,
  DroneRace,
  EnveloppeDelegation,
  RaceVictory,
  TaskDelegationGraph,
} from './api';
import type {
  HiveNode,
  RaisonSansMesure,
  RessourcesExecution,
  Task,
  TaskResult,
} from '../../src/shared/types';
import { INTERVALLE_METRIQUES_MS } from '../../src/shared/bac-direct';
import { ressourcesLues } from '../../src/shared/protocol';
import { octetsLisibles } from './views/bac-direct-rendu';
import { useLang, useT } from './i18n';
import { formatMs, StatusBadge, useDialog } from './ui';
import { direAnnonce, direDuree } from '../../src/shared/horloge-chantier';
import { verdictAnnonce } from './horloge-vue';
import { RoutageTache } from './RoutageTache';
import { ConsigneRoutageTache } from './ConsigneRoutageTache';
import { ChronologieTache } from './ChronologieTache';
import { ConsoleDeTache } from './ConsoleDirecte';
import type { MagasinSorties } from './sorties-directes';
import type { VueHorloge } from './horloge-vue';

function raisonDelegation(events: DelegationEvent[], taskId: string): string | null {
  const event = events.find(
    (candidate) =>
      candidate.type === 'delegation_created' && candidate.payload.childTaskId === taskId,
  );
  return typeof event?.payload.reason === 'string' ? event.payload.reason : null;
}

/**
 * Une sous-tâche annulée avec le sous-arbre d'un ancêtre terminé porte le même
 * badge « échouée » que n'importe quel échec. Sans cette ligne, l'opérateur
 * chercherait une panne qui n'a pas eu lieu : c'est son destinataire qui avait
 * fini. Le texte est reconstruit ici depuis le code typé du journal.
 */
function annulationDelegation(
  events: DelegationEvent[],
  taskId: string,
  t: ReturnType<typeof useT>,
): string | null {
  const event = events.find(
    (candidate) =>
      candidate.type === 'delegation_cancelled' && candidate.payload.childTaskId === taskId,
  );
  if (!event) return null;
  const ancetre =
    typeof event.payload.ancestorTaskId === 'string' ? event.payload.ancestorTaskId : '?';
  switch (event.payload.reason) {
    case 'ancestor_done':
      return t(
        `Annulée : ${ancetre} a abouti sans attendre ce résultat.`,
        `Cancelled: ${ancetre} finished without waiting for this result.`,
      );
    case 'ancestor_failed':
      return t(
        `Annulée : ${ancetre} a échoué, plus personne n’attendait ce résultat.`,
        `Cancelled: ${ancetre} failed, nobody was waiting for this result any more.`,
      );
    case 'root_cost_budget_exhausted':
      return t(
        `Annulée : la dépense déclarée de l’arbre de ${ancetre} a atteint son budget coût.`,
        `Cancelled: the declared spend of ${ancetre}'s tree reached its cost budget.`,
      );
    default:
      return t(`Annulée avec ${ancetre}.`, `Cancelled along with ${ancetre}.`);
  }
}

function budgetDelegation(record: DelegationRecord | null, t: ReturnType<typeof useT>): string {
  if (!record) {
    return t(
      'Budget indisponible dans le graphe persistant.',
      'Requested budget missing from the persisted graph.',
    );
  }
  const duree = formatMs(record.durationMs);
  const cout = String(record.costMicros);
  return t(
    `Budget réservé : ${duree} · coût ${cout} µUSD · ressources ${record.resourceUnits}`,
    `Reserved budget: ${duree} · cost ${cout} µUSD · resources ${record.resourceUnits}`,
  );
}

/**
 * L'enveloppe de la RACINE, telle que la Reine la tient : ce que tout l'arbre
 * a réservé sur chaque plafond, et ce qu'il a dépensé selon les CLI. Une
 * dépense avec des tentatives au coût inconnu est dite « au moins » : ce n'est
 * pas une somme, c'est un plancher, et l'écran ne la présente pas comme
 * complète.
 */
function enveloppeDelegation(e: EnveloppeDelegation, t: ReturnType<typeof useT>): string {
  const { limites, reserve, depense } = e;
  const reservee = t(
    `Enveloppe de la racine — réservé : ${formatMs(reserve.durationMs)} / ${formatMs(limites.maxDurationMs)} · ${reserve.costMicros} / ${limites.maxCostMicros} µUSD · ${reserve.resourceUnits} / ${limites.maxResourceUnits} unités.`,
    `Root envelope — reserved: ${formatMs(reserve.durationMs)} / ${formatMs(limites.maxDurationMs)} · ${reserve.costMicros} / ${limites.maxCostMicros} µUSD · ${reserve.resourceUnits} / ${limites.maxResourceUnits} units.`,
  );
  if (depense.tentatives === 0) {
    return `${reservee} ${t('Aucune tentative rendue.', 'No attempt returned yet.')}`;
  }
  const plancher = depense.sansCout > 0;
  const declaree = plancher
    ? t(
        `Dépense déclarée : au moins ${depense.micros} µUSD — ${depense.sansCout} tentative(s) sur ${depense.tentatives} sans coût déclaré (inconnu, pas zéro).`,
        `Declared spend: at least ${depense.micros} µUSD — ${depense.sansCout} of ${depense.tentatives} attempt(s) declared no cost (unknown, not zero).`,
      )
    : t(
        `Dépense déclarée : ${depense.micros} µUSD sur ${depense.tentatives} tentative(s).`,
        `Declared spend: ${depense.micros} µUSD over ${depense.tentatives} attempt(s).`,
      );
  const epuise = e.coutEpuise
    ? t(
        ' Budget coût épuisé : plus aucun enfant n’est admis sous cette racine.',
        ' Cost budget exhausted: no further child is admitted under this root.',
      )
    : '';
  return `${reservee} ${declaree}${epuise}`;
}

/**
 * La durée réellement observée vient du résultat persisté, relayé dans
 * `delegation_result`. Le budget demandé ne doit jamais être présenté comme
 * une consommation : coût et ressources restent inconnus tant qu'un Worker ne
 * fournit pas un contrat de mesure fiable.
 */
function consommationDelegation(
  events: DelegationEvent[],
  taskId: string,
  t: ReturnType<typeof useT>,
): string {
  const event = [...events]
    .reverse()
    .find(
      (candidate) =>
        candidate.type === 'delegation_result' && candidate.payload.childTaskId === taskId,
    );
  const durationMs = event?.payload.durationMs;
  if (typeof durationMs !== 'number' || !Number.isFinite(durationMs) || durationMs < 0) {
    return t(
      'Consommation réelle : non disponible · coût et ressources non mesurés',
      'Actual usage: unavailable · cost and resources not measured',
    );
  }
  const duree = formatMs(durationMs);
  // Le journal garde aussi les mesures d'AVANT celle de l'agent (`usage`, les
  // compteurs du nœud) : lues `noeud_ancien`, jamais affichées comme les siennes.
  const ressources = ressourcesLues(event?.payload.ressources, event?.payload.usage);
  return t(
    `Dernière exécution mesurée : ${duree} · ${direRessources(ressources, t)} · coût fournisseur non mesuré`,
    `Last measured run: ${duree} · ${direRessources(ressources, t)} · provider cost not measured`,
  );
}

const RAISON_SANS_MESURE: Record<RaisonSansMesure, readonly [string, string]> = {
  plateforme: [
    'Windows hors conteneur, sans table des processus lisible',
    'Windows without a container has no readable process table',
  ],
  aucun_processus: ['aucun processus d’agent lancé', 'no agent process was started'],
  aucun_releve: ['aucun relevé de l’agent n’a abouti', 'no sample of the agent succeeded'],
  noeud_ancien: [
    'nœud d’une version antérieure, qui ne mesurait que lui-même',
    'node from an earlier version, which only measured itself',
  ],
};

/**
 * Les ressources de l'AGENT, telles que son nœud les a relevées : l'arbre de
 * ses processus ou son conteneur — la mesure de Sandbox Live, cumulée. Le CPU
 * est un plancher (« au moins ») : ce qui a suivi le dernier relevé n'y est
 * pas. Un pic échantillonné est dit tel ; celui du noyau aussi. Ce qui ne se
 * mesure pas est dit avec sa raison, jamais remplacé par un autre chiffre.
 */
function direRessources(r: RessourcesExecution | undefined, t: ReturnType<typeof useT>): string {
  if (!r) return t('ressources de l’agent non mesurées', 'agent’s resources not measured');
  if (r.portee === 'aucune') {
    const [fr, en] = RAISON_SANS_MESURE[r.raison];
    return t(
      `ressources de l’agent non mesurées — ${fr}`,
      `agent’s resources not measured — ${en}`,
    );
  }
  const sujet =
    r.portee === 'arbre'
      ? t('arbre de processus de l’agent', 'agent’s process tree')
      : t('conteneur de l’agent', 'agent’s container');
  const cpu =
    r.cpuMs !== undefined
      ? t(`au moins ${formatMs(r.cpuMs)} CPU`, `at least ${formatMs(r.cpuMs)} CPU`)
      : t(
          'CPU non mesuré (le moteur n’en tient pas le cumul)',
          'CPU not measured (the engine keeps no total)',
        );
  const pic = r.picOctets !== undefined ? octetsLisibles(r.picOctets) : null;
  const memoire =
    pic === null
      ? t('mémoire non mesurée', 'memory not measured')
      : r.picNoyau
        ? t(`pic mémoire ${pic} (noyau)`, `memory peak ${pic} (kernel)`)
        : r.portee === 'arbre'
          ? t(`pic RSS échantillonné ${pic}`, `sampled RSS peak ${pic}`)
          : t(`pic mémoire échantillonné ${pic}`, `sampled memory peak ${pic}`);
  const s = INTERVALLE_METRIQUES_MS / 1000;
  const releves = t(
    `${r.releves} relevé${r.releves > 1 ? 's' : ''} toutes les ${s} s`,
    `${r.releves} sample${r.releves > 1 ? 's' : ''} every ${s} s`,
  );
  return `${sujet} : ${cpu} · ${memoire} · ${releves}`;
}

// Les ressources de l'agent (CPU, mémoire) ne sont PAS un coût : le coût
// fournisseur a sa propre ligne, dans « Où est passé le temps », avec ce que le
// CLI de l'agent déclare — ou « inconnu ». Le dire ici « non mesuré »
// contredirait ce panneau dès qu'un CLI déclare un montant.
function ressourcesObservees(
  ressources: RessourcesExecution | undefined,
  t: ReturnType<typeof useT>,
): string {
  const dit = direRessources(ressources, t);
  const cout = t(
    'coût fournisseur à part (« Où est passé le temps »)',
    'provider cost shown separately (“Where the time went”)',
  );
  return `${dit.charAt(0).toUpperCase()}${dit.slice(1)} · ${cout}`;
}

// L'éditeur (CodeMirror) est chargé à la demande — pesant seulement quand on
// ouvre le tiroir d'une tâche.
const CodeEditor = lazy(() => import('./CodeEditor'));

interface Props {
  task: Task;
  nodes: HiveNode[];
  /**
   * Ce que la ruche avait annoncé pour CETTE tâche, replié du journal.
   *
   * Optionnel, et il faut qu'il le reste : le journal est élagué, donc une
   * tâche assez vieille n'a plus son annonce. On n'affiche alors rien — mieux
   * qu'un « — » qui laisserait croire que la ruche n'avait rien annoncé.
   */
  horloge?: VueHorloge;
  /** Incrémenté par App quand un événement persistant peut modifier le graphe. */
  refreshTick?: number;
  /** Les sorties en direct, gardées par App hors de React (`sorties-directes.ts`). */
  magasinSorties?: MagasinSorties;
  onClose: () => void;
}

export function TaskDrawer({
  task,
  nodes,
  horloge,
  refreshTick = 0,
  magasinSorties,
  onClose,
}: Props) {
  const t = useT();
  const lang = useLang();
  const [results, setResults] = useState<TaskResult[] | null>(null);
  const [tab, setTab] = useState<'diff' | 'logs'>('diff');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [raced, setRaced] = useState<number | null>(null);
  const [race, setRace] = useState<DroneRace | null>(null);
  const [victory, setVictory] = useState<RaceVictory | null>(null);
  const [delegation, setDelegation] = useState<TaskDelegationGraph | null>(null);
  const [delegationLoading, setDelegationLoading] = useState(true);
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [editable, setEditable] = useState(false);
  const [edited, setEdited] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const dialogRef = useDialog<HTMLElement>(onClose);

  // Calculé ici et pas dans le JSX : le rendu ci-dessous s'en sert deux fois
  // (choix du bloc, puis choix de la phrase), et deux appels pourraient
  // diverger si l'un des deux oubliait un argument.
  const verdict = verdictAnnonce(horloge?.annonce, task.result?.durationMs ?? -1);
  // Le plafond sorti de l'optionnel : `verdict !== 'sans_objet'` IMPLIQUE qu'il
  // existe, mais le compilateur ne peut pas le savoir — et le lui affirmer avec
  // un `!` échangerait une vérification contre une promesse. Le rendu teste les
  // deux, ce qui coûte une comparaison et ne peut pas mentir.
  const plafondMs = horloge?.annonce?.p80Ms;

  useEffect(() => {
    let alive = true;
    setResults(null);
    fetchResults(task.id)
      .then((r) => alive && setResults(r))
      .catch(() => alive && setResults([]));
    return () => {
      alive = false;
    };
  }, [task.id]);

  // Le graphe est relu depuis la même API que Mission Control : aucun enfant,
  // statut ou événement ne doit être déduit du rendu temps réel.
  useEffect(() => {
    let alive = true;
    setDelegation(null);
    setDelegationLoading(true);
    setDelegationError(null);
    fetchDelegationGraph(task.id)
      .then((graph) => {
        if (!alive) return;
        setDelegation(graph);
      })
      .catch((e: unknown) => {
        if (!alive) return;
        setDelegationError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (alive) setDelegationLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [task.id, refreshTick]);

  // Drone Wars : une course est-elle en vol sur cette tâche ? (lecture à
  // l'ouverture et au changement de statut — pas de polling, les événements
  // WS re-rendent le tiroir via le snapshot).
  useEffect(() => {
    let alive = true;
    setRace(null);
    setVictory(null);
    // En vol : montrer la course. Terminée : montrer le vainqueur éventuel
    // (reconstruit côté serveur depuis le journal — la course n'est plus en
    // mémoire une fois tranchée).
    if (task.status === 'assigned' || task.status === 'running' || task.status === 'done') {
      fetchRace(task.id)
        .then((r) => {
          if (!alive) return;
          setRace(r.race);
          setVictory(r.victory ?? null);
        })
        .catch(() => alive && setRace(null));
    }
    return () => {
      alive = false;
    };
  }, [task.id, task.status]);

  const nodeName = task.assignedNodeId
    ? (nodes.find((n) => n.id === task.assignedNodeId)?.name ?? task.assignedNodeId.slice(0, 8))
    : '—';
  const last = results && results.length > 0 ? results[results.length - 1] : null;
  const cancellable = task.status !== 'done' && task.status !== 'failed';

  // Contenu affiché dans l'éditeur : édition locale prioritaire, sinon la source.
  const source = last ? (tab === 'diff' ? last.diff : last.logs) : '';
  const shown = edited ?? source;
  // Réinitialiser l'édition locale quand on change d'onglet ou de tâche.
  useEffect(() => {
    setEdited(null);
    setCopied(false);
  }, [tab, task.id, results]);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(shown);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('copie impossible dans ce contexte.', 'copy is unavailable in this context.'));
    }
  };

  const doCancel = async () => {
    setBusy(true);
    setError(null);
    try {
      await cancelTask(task.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  // Drone Wars : course compétitive sur une tâche prête (geste humain explicite).
  const doRace = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await raceTask(task.id);
      setRaced(res.drones.length);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside
        className="drawer"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="drawer-title"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="drawer-head">
          <div>
            <h2 id="drawer-title">{task.title}</h2>
            <StatusBadge status={task.status} />
          </div>
          <button className="modal-close" onClick={onClose} aria-label={t('Fermer', 'Close')}>
            ×
          </button>
        </header>

        <dl className="meta-grid">
          <dt>{t('Nœud', 'Node')}</dt>
          <dd>{nodeName}</dd>
          <dt>{t('Tentatives', 'Attempts')}</dt>
          <dd>{task.attempts}</dd>
          <dt>{t('Branche', 'Branch')}</dt>
          <dd className="mono">{task.branch ?? '—'}</dd>
          <dt>{t('Durée', 'Duration')}</dt>
          <dd>{task.result ? formatMs(task.result.durationMs) : '—'}</dd>
          <dt>{t('Ressources observées', 'Observed resources')}</dt>
          <dd data-testid="task-observed-resources">
            {ressourcesObservees(task.result?.ressources, t)}
          </dd>
          {horloge?.annonce && (
            <>
              <dt>{t('Annoncé', 'Announced')}</dt>
              <dd className="horloge-annonce">{direAnnonce(horloge.annonce, lang)}</dd>
            </>
          )}
          <dt>{t('Dépendances', 'Dependencies')}</dt>
          <dd>{task.dependsOn.length > 0 ? task.dependsOn.length : t('aucune', 'none')}</dd>
          <dt>ID</dt>
          <dd className="mono">{task.id}</dd>
        </dl>

        <ChronologieTache taskId={task.id} cle={`${task.status}:${task.attempts}:${refreshTick}`} />

        <RoutageTache
          taskId={task.id}
          cle={`${task.status}:${task.assignedNodeId ?? ''}:${refreshTick}`}
          nodes={nodes}
        />

        <ConsigneRoutageTache task={task} nodes={nodes} />

        <section className="delegation-panel" aria-labelledby="delegation-title">
          <div className="delegation-panel-head">
            <h3 id="delegation-title">{t('Délégation Hive', 'Hive delegation')}</h3>
            {delegation && delegation.events.length > 0 && (
              <span className="muted-text">
                {delegation.events.length} {t('événement(s)', 'event(s)')}
              </span>
            )}
          </div>
          {delegationLoading && (
            <p className="muted-text" role="status">
              {t('Lecture du graphe réel…', 'Reading the live graph…')}
            </p>
          )}
          {delegationError && (
            <p className="modal-error" role="status">
              {t('Graphe indisponible :', 'Graph unavailable:')} {delegationError}
            </p>
          )}
          {!delegationLoading &&
            !delegationError &&
            delegation?.enveloppe &&
            // Un arbre sans enfant Hive n'a rien réservé ni dépensé : la ligne
            // ne serait que du bruit dans le tiroir de chaque tâche.
            delegation.graph.some((n) => n.origine === 'hive' && n.parentTaskId !== null) && (
              <p
                className={`delegation-tree-budget${delegation.enveloppe.coutEpuise ? ' epuise' : ''}`}
                data-testid="delegation-enveloppe"
              >
                {enveloppeDelegation(delegation.enveloppe, t)}
              </p>
            )}
          {!delegationLoading && !delegationError && delegation && delegation.graph.length <= 1 && (
            <p className="muted-text">
              {t('Aucune sous-tâche Hive persistée.', 'No persisted Hive child task.')}
            </p>
          )}
          {!delegationLoading && !delegationError && delegation && delegation.graph.length > 1 && (
            <ol
              className="delegation-tree"
              aria-label={t('Graphe de délégation', 'Delegation graph')}
            >
              {delegation.graph.map((node) => {
                const reason = raisonDelegation(delegation.events, node.taskId);
                const annulation = annulationDelegation(delegation.events, node.taskId, t);
                const record = node.parentTaskId
                  ? (delegation.delegations.find(
                      (candidate) => candidate.childTaskId === node.taskId,
                    ) ?? null)
                  : null;
                return (
                  <li key={node.taskId} className="delegation-tree-node">
                    <div
                      className="delegation-tree-row"
                      style={{ paddingInlineStart: node.depth * 16 }}
                    >
                      <span className="delegation-tree-id mono">{node.taskId}</span>
                      <StatusBadge status={node.status} />
                    </div>
                    {node.parentTaskId && (
                      <span className="delegation-tree-parent">
                        {t('parent', 'parent')} : {node.parentTaskId}
                      </span>
                    )}
                    {node.parentTaskId && (
                      <p
                        className={`delegation-tree-budget${record ? '' : ' missing'}`}
                        data-testid={`delegation-budget-${node.taskId}`}
                      >
                        {budgetDelegation(record, t)}
                      </p>
                    )}
                    {node.parentTaskId && (
                      <p
                        className="delegation-tree-budget"
                        data-testid={`delegation-consumption-${node.taskId}`}
                      >
                        {consommationDelegation(delegation.events, node.taskId, t)}
                      </p>
                    )}
                    {reason && <p className="delegation-tree-reason">{reason}</p>}
                    {annulation && (
                      <p
                        className="delegation-tree-reason"
                        data-testid={`delegation-cancelled-${node.taskId}`}
                      >
                        {annulation}
                      </p>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {race && !race.decided && (
          <p className="muted-text" title={t('Course de drones en vol', 'Drone race in flight')}>
            {t(
              `Course en vol : ${race.drones.filter((d) => d.status === 'running').length} drone(s) sur ${race.drones.length} — le premier succès gagne.`,
              `Race in flight: ${race.drones.filter((d) => d.status === 'running').length} drone(s) of ${race.drones.length} — first success wins.`,
            )}
          </p>
        )}
        {task.status === 'done' && victory && (
          <p className="muted-text" title={t('Course de drones gagnée', 'Drone race won')}>
            {(() => {
              const name =
                nodes.find((n) => n.id === victory.nodeId)?.name ??
                `${victory.nodeId.slice(0, 8)}…`;
              return t(
                `Gagnée en course de drones par ${name}` +
                  (victory.cancelled > 0
                    ? ` — ${victory.cancelled} concurrent(s) annulé(s).`
                    : '.'),
                `Won in a drone race by ${name}` +
                  (victory.cancelled > 0
                    ? ` — ${victory.cancelled} competitor(s) cancelled.`
                    : '.'),
              );
            })()}
          </p>
        )}

        {horloge?.horsDomaine && (
          <p className="horloge-alerte" role="status">
            {t(
              `Sortie du domaine connu après ${direDuree(horloge.horsDomaine.ecouleMs, 'fr')} — plus longue que tout ce que la ruche avait observé (record : ${direDuree(horloge.horsDomaine.recordMs, 'fr')}).`,
              `Out of the known domain after ${direDuree(horloge.horsDomaine.ecouleMs, 'en')} — longer than anything the hive had observed (record: ${direDuree(horloge.horsDomaine.recordMs, 'en')}).`,
            )}
          </p>
        )}
        {/*
          L'ANNONCE, CONFRONTÉE AU RÉEL.

          C'est la seule ligne de cet écran qui rende l'horloge réfutable : sans
          elle, une annonce est un chiffre que personne ne repasse jamais, donc
          un chiffre qu'on peut se permettre de faire n'importe comment. Avec
          elle, chaque tâche finie porte publiquement le résultat du pari.

          `sans_objet` n'est PAS affiché : sur socle « aucun », la ruche a dit
          « je ne sais pas encore ». Rendre un verdict là-dessus noterait comme
          un échec le fait d'avoir refusé de chiffrer.
        */}
        {task.result && verdict !== 'sans_objet' && plafondMs !== undefined && (
          <p className={`horloge-verdict ${verdict}`} role="status">
            {verdict === 'tenue'
              ? t(
                  `Annonce tenue : ${direDuree(task.result.durationMs, 'fr')} pour un plafond annoncé de ${direDuree(plafondMs, 'fr')}.`,
                  `Announcement held: ${direDuree(task.result.durationMs, 'en')} against an announced ceiling of ${direDuree(plafondMs, 'en')}.`,
                )
              : t(
                  `Annonce débordée : ${direDuree(task.result.durationMs, 'fr')} pour un plafond annoncé de ${direDuree(plafondMs, 'fr')}. Une annonce sur cinq est censée déborder — c'est leur RÉPÉTITION qui accuse l'horloge, pas celle-ci.`,
                  `Announcement overrun: ${direDuree(task.result.durationMs, 'en')} against an announced ceiling of ${direDuree(plafondMs, 'en')}. One announcement in five is meant to overrun — it is their REPETITION that indicts the clock, not this one.`,
                )}
          </p>
        )}

        <h3>Prompt</h3>
        <pre className="code-block">{task.prompt}</pre>

        {/* Pendant l'exécution — et tant qu'App garde une sortie. */}
        <ConsoleDeTache
          magasin={magasinSorties}
          taskId={task.id}
          enCours={task.status === 'assigned' || task.status === 'running'}
        />

        {last && (
          <>
            <div className="editor-bar">
              <div className="drawer-tabs">
                <button className={tab === 'diff' ? 'active' : ''} onClick={() => setTab('diff')}>
                  Diff
                </button>
                <button className={tab === 'logs' ? 'active' : ''} onClick={() => setTab('logs')}>
                  Logs
                </button>
              </div>
              <div className="editor-actions">
                <label
                  className="toggle"
                  title={t(
                    "Autoriser l'édition locale (non enregistrée)",
                    'Allow local editing (not saved)',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={editable}
                    onChange={(e) => setEditable(e.target.checked)}
                  />
                  {t('éditer', 'edit')}
                </label>
                <button className="chip" onClick={copyCode}>
                  {copied ? t('✔ copié', '✔ copied') : t('copier', 'copy')}
                </button>
              </div>
            </div>
            <Suspense
              fallback={<pre className="code-block scroll">{shown || t('(vide)', '(empty)')}</pre>}
            >
              <CodeEditor
                value={
                  shown ||
                  (tab === 'diff' ? t('(aucun diff)', '(no diff)') : t('(aucun log)', '(no logs)'))
                }
                lang={tab === 'diff' ? 'diff' : 'text'}
                editable={editable}
                onChange={setEdited}
              />
            </Suspense>
            {editable && (
              <p className="editor-hint">
                {t(
                  'Édition locale d’exploration — non enregistrée (le merge arrivera au Palier 3).',
                  'Local exploratory edit — not saved (merge lands at Stage 3).',
                )}
              </p>
            )}
          </>
        )}
        {results !== null && results.length === 0 && (
          <p className="muted-text">
            {t('Aucun résultat remonté pour l’instant.', 'No results reported yet.')}
          </p>
        )}

        {error && <p className="modal-error">{error}</p>}
        {task.status === 'ready' && raced === null && (
          <button
            className="btn"
            onClick={doRace}
            disabled={busy}
            title={t(
              'Drone Wars : la même tâche confiée à plusieurs nœuds — le premier succès gagne, les autres sont annulés',
              'Drone Wars: the same task handed to several nodes — the first success wins, the others are cancelled',
            )}
          >
            {busy
              ? t('Lancement…', 'Launching…')
              : t('Course de drones (3 nœuds)', 'Drone race (3 nodes)')}
          </button>
        )}
        {raced !== null && task.status !== 'done' && task.status !== 'failed' && (
          <p className="muted-text">
            {t('Course lancée :', 'Race launched:')} {raced}{' '}
            {t(
              'drone(s) en vol — le premier succès gagne.',
              'drone(s) in flight — the first success wins.',
            )}
          </p>
        )}
        {cancellable && (
          <button className="btn danger-btn" onClick={doCancel} disabled={busy}>
            {busy ? t('Annulation…', 'Cancelling…') : t('Annuler la tâche', 'Cancel the task')}
          </button>
        )}
      </aside>
    </div>
  );
}
