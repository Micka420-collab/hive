// Vue Miellerie — centre de revue des productions IA : file de revue à gauche,
// inspection (diff / logs / consensus) au centre, verdict à droite (repliable),
// barre de décision sticky et coulée du miel (merge par projet) en pied de vue.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { HiveNode, Task, TaskResult } from '../../../src/shared/types';
import {
  fetchConflicts,
  fetchConsensus,
  fetchMergePlan,
  fetchMergeResult,
  fetchResults,
  runMerge,
} from '../api';
import type { Conflict, MergePlan, MergeRunResult, Verdict } from '../api';
import { t as tNow, useT } from '../i18n';
import type { Translate } from '../i18n';
import { activateProps, formatMs, modalOpen, StatusBadge } from '../ui';
import { getReview, Honeycomb, setReview, useApiPoll, useReviewTick } from './shared';
import type { ReviewState, ViewProps } from './shared';
import './miellerie.css';

// ─── Aides pures ─────────────────────────────────────────────────────────────

/** Le focus est-il dans un champ de saisie ? (neutralise les raccourcis) */
function inInput(): boolean {
  const el = document.activeElement;
  if (!el) return false;
  const tag = el.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    (el as HTMLElement).isContentEditable
  );
}

/** Nom lisible d'un nœud (sinon id court, sinon tiret). */
function nodeName(nodes: HiveNode[], id: string | null | undefined): string {
  if (!id) return '—';
  return nodes.find((n) => n.id === id)?.name ?? id.slice(0, 8);
}

/** Erreur API → texte lisible (503 = aucun nœud en ligne, etc.). */
function readableError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (/503/.test(msg))
    return tNow(
      'Aucun nœud en ligne pour exécuter le merge (503).',
      'No node online to run the merge (503).',
    );
  if (/failed to fetch/i.test(msg))
    return tNow(
      'Orchestrateur injoignable — vérifiez la connexion.',
      'Orchestrator unreachable — check the connection.',
    );
  return msg;
}

/** Rang de tri : échouées d'abord, puis non-revues, puis revues. */
function reviewRank(t: Task): number {
  if (t.status === 'failed') return 0;
  return getReview(t.id) === null ? 1 : 2;
}

// ─── Pré-découpe du diff par fichier ─────────────────────────────────────────

interface DiffFilePart {
  name: string;
  lines: string[];
  adds: number;
  dels: number;
}

const MAX_DIFF_LINES = 2000;

/** Découpe un diff unifié par fichier ; null → fallback brut (trop long ou illisible). */
function splitDiff(diff: string): DiffFilePart[] | null {
  try {
    if (diff.split('\n').length > MAX_DIFF_LINES) return null;
    const chunks = diff.split(/^(?=diff --git )/m).filter((c) => c.trim() !== '');
    if (chunks.length === 0 || !chunks[0]?.startsWith('diff --git ')) return null;
    return chunks.map((chunk) => {
      const lines = chunk.replace(/\n$/, '').split('\n');
      const head = lines[0] ?? '';
      const m = /^diff --git a\/(.+?) b\/(.+)$/.exec(head);
      return {
        name: m?.[2] ?? head.replace('diff --git ', ''),
        lines,
        adds: lines.filter((l) => l.startsWith('+') && !l.startsWith('+++')).length,
        dels: lines.filter((l) => l.startsWith('-') && !l.startsWith('---')).length,
      };
    });
  } catch {
    return null;
  }
}

/** Classe de coloration d'une ligne de diff. */
function lineClass(line: string): string | undefined {
  if (line.startsWith('+++') || line.startsWith('---')) return 'mi-meta';
  if (line.startsWith('+')) return 'mi-add';
  if (line.startsWith('-')) return 'mi-del';
  if (line.startsWith('@@')) return 'mi-hunk';
  if (line.startsWith('diff --git') || line.startsWith('index ')) return 'mi-meta';
  return undefined;
}

// ─── Panneau Diff ────────────────────────────────────────────────────────────

function DiffPanel({ diff }: { diff: string }) {
  const t = useT();
  const parts = useMemo(() => splitDiff(diff), [diff]);
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set([0]));
  const [copied, setCopied] = useState(false);
  const secRefs = useRef<(HTMLElement | null)[]>([]);

  // Nouveau diff → repli remis à zéro, 1re section dépliée.
  useEffect(() => {
    setOpen(new Set([0]));
  }, [diff]);

  const toggle = (i: number) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const copy = () => {
    navigator.clipboard
      .writeText(diff)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => setCopied(false));
  };

  if (diff.trim() === '') {
    return (
      <p className="muted-text">
        {t(
          'Diff vide — rien à butiner sur cette production.',
          'Empty diff — nothing to forage on this production.',
        )}
      </p>
    );
  }

  const copyBtn = (
    <button className="btn mi-copy" onClick={copy}>
      {copied ? t('Copié !', 'Copied!') : t('Copier le diff', 'Copy the diff')}
    </button>
  );

  if (!parts) {
    // Fallback brut : diff trop long (> 2000 lignes) ou format inattendu.
    return (
      <div>
        <div className="mi-files">
          <span className="muted-text">
            {t(
              'Diff affiché brut (long ou non découpable).',
              'Diff shown raw (too long or not splittable).',
            )}
          </span>
          {copyBtn}
        </div>
        <pre className="code-block scroll mi-diff-pre">{diff}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="mi-files">
        {parts.map((f, i) => (
          <button
            key={`${i}-${f.name}`}
            className={`mi-file-chip${open.has(i) ? ' open' : ''}`}
            title={f.name}
            onClick={() => {
              if (!open.has(i)) toggle(i);
              secRefs.current[i]?.scrollIntoView({ block: 'nearest' });
            }}
          >
            <span className="mi-file-name">{f.name}</span>
            <span className="mi-add-stat">+{f.adds}</span>
            <span className="mi-del-stat">−{f.dels}</span>
          </button>
        ))}
        {copyBtn}
      </div>
      {parts.map((f, i) => (
        <section
          key={`${i}-${f.name}`}
          className="mi-file-section"
          ref={(el) => {
            secRefs.current[i] = el;
          }}
        >
          <button className="mi-file-head" aria-expanded={open.has(i)} onClick={() => toggle(i)}>
            <span className="mi-fold" aria-hidden="true">
              {open.has(i) ? '▾' : '▸'}
            </span>
            <span className="mi-file-name">{f.name}</span>
            <span className="mi-add-stat">+{f.adds}</span>
            <span className="mi-del-stat">−{f.dels}</span>
          </button>
          {open.has(i) && (
            <pre className="code-block scroll mi-diff-pre">
              {f.lines.map((l, j) => (
                <span key={j} className={lineClass(l)}>
                  {l}
                  {'\n'}
                </span>
              ))}
            </pre>
          )}
        </section>
      ))}
    </div>
  );
}

// ─── Panneau Consensus (Parlement des Agents) ────────────────────────────────

// ─── CE QUE CET ÉCRAN A LONGTEMPS FAIT CROIRE ────────────────────────────────
//
// « Pas de quorum — arbitrage humain » se lisait comme un constat : les agents
// ont examiné, ils ne sont pas d'accord, tranchez. C'est faux sur du code.
//
// Le quorum se mesure par IDENTITÉ TEXTUELLE du diff. Deux agents différents
// qui font exactement la même correction ne rendent jamais les mêmes octets —
// un commentaire de plus suffit. Sur du code, `no_quorum` est donc le résultat
// NORMAL, et il ne veut pas dire « ils ne sont pas d'accord » : il veut dire
// « on n'a rien pu mesurer ».
//
// Le libellé le dit maintenant. Voir `src/orchestrator/parliament.ts`, et la
// SURFACE plus bas — le signal qui, lui, fonctionne sur du code.
const outcomeLabel = (t: Translate): Record<Verdict['outcome'], string> => ({
  elected: t('Sorties identiques', 'Identical outputs'),
  no_quorum: t('Sorties toutes différentes', 'All outputs differ'),
  no_ballots: t('Aucun bulletin', 'No ballots'),
});

/** Ce que le résultat veut dire — parce que le mot seul induit en erreur. */
const outcomeSens = (t: Translate): Record<Verdict['outcome'], string> => ({
  elected: t(
    'Au moins deux agents ont rendu exactement les mêmes octets. Sur une sortie courte (une décision, une réponse) c’est un signal fort ; sur du code, c’est rare et cela signale souvent des agents identiques.',
    'At least two agents returned the exact same bytes. On a short output (a decision, an answer) that is a strong signal; on code it is rare and usually means the agents were identical.',
  ),
  no_quorum: t(
    'Attendu sur du code : deux agents qui font la MÊME correction ne rendent pas les mêmes octets. Ce n’est pas un désaccord constaté — regardez la surface ci-dessous.',
    'Expected on code: two agents making the SAME fix do not return the same bytes. This is not an observed disagreement — look at the surface below.',
  ),
  no_ballots: t('Aucun résultat en succès à départager.', 'No successful result to compare.'),
});

/**
 * LA SURFACE — le seul accord mesurable sur du code.
 *
 * Elle ne dit pas que deux agents ont écrit la même chose : elle dit qu'ils
 * sont allés au même endroit. C'est faible, et c'est assumé.
 *
 * Sa valeur est surtout dans le DÉSACCORD : deux surfaces distinctes veulent
 * dire que les agents ne s'entendent pas sur l'endroit où le changement va —
 * une divergence réelle, que l'identité textuelle noyait dans le bruit puisque
 * tout lui paraissait déjà divergent.
 *
 * Rendu SÉPARÉMENT des factions, et jamais fondu dans le verdict : « même
 * surface » ne doit pas pouvoir se lire comme « consensus ».
 */
function SurfacesPanel({ verdict }: { verdict: Verdict }) {
  const t = useT();
  if (verdict.surfaces.length === 0 && verdict.sansSurface === 0) return null;

  // « Accord sur le lieu » exige AU MOINS DEUX voix : une surface à une voix
  // n'est pas un accord avec soi-même, personne n'a confirmé l'endroit.
  // L'annoncer serait exactement le mensonge rassurant qu'on cherche à éviter.
  const accord = verdict.surfaces.length === 1 && (verdict.surfaces[0]?.votes ?? 0) > 1;
  return (
    <div className="mi-surf">
      <h5 className="mi-surf-titre">
        {t('Où le changement a été fait', 'Where the change was made')}
      </h5>
      {verdict.surfaces.length > 1 && (
        <p className="mi-surf-alerte">
          {t(
            'Les agents ne sont pas d’accord sur l’ENDROIT. C’est un désaccord réel, et il se voit ici seulement.',
            'The agents disagree on WHERE. That is a real disagreement, and it is visible only here.',
          )}
        </p>
      )}
      {accord && (
        <p className="mi-surf-note">
          {t(
            'Même surface, quelle que soit l’écriture — accord sur le lieu, pas sur le code.',
            'Same surface, whatever the wording — agreement on the place, not on the code.',
          )}
        </p>
      )}
      <ul className="mi-surf-list">
        {verdict.surfaces.map((s) => (
          <li key={s.fichiers.join('\n')} className="mi-surf-row">
            <span className="mi-surf-votes">{t(`${s.votes} voix`, `${s.votes} vote(s)`)}</span>
            {s.agentTypes.map((at) => (
              <span key={at} className="chip mi-chip-static">
                {at}
              </span>
            ))}
            <code className="mi-surf-fichiers">{s.fichiers.join(' · ')}</code>
          </li>
        ))}
      </ul>
      {verdict.sansSurface > 0 && (
        // L'abstention se VOIT. Un zéro silencieux se lirait comme « tout le
        // monde a été pris en compte ».
        <p className="mi-surf-note">
          {t(
            `${verdict.sansSurface} bulletin(s) sans diff lisible — écarté(s), pas comptés comme d’accord.`,
            `${verdict.sansSurface} ballot(s) with no readable diff — set aside, not counted as agreeing.`,
          )}
        </p>
      )}
    </div>
  );
}

/**
 * EXPORTÉ POUR ÊTRE RENDU EN TEST — pas pour être réutilisé ailleurs.
 * Ce panneau porte une affirmation sur ce que la ruche a MESURÉ ; seul un rendu
 * réel dit ce qu'un relecteur y lit. Voir `dashboard/tests/surfaces-panneau.test.tsx`.
 */
export function ConsensusPanel({
  verdict,
  error,
}: {
  verdict: Verdict | null;
  error: string | null;
}) {
  const t = useT();
  if (error)
    return (
      <p className="panel-error">
        {t('Consensus indisponible :', 'Consensus unavailable:')} {error}
      </p>
    );
  if (!verdict)
    return <p className="muted-text">{t('Dépouillement en cours…', 'Counting the ballots…')}</p>;

  const total = verdict.factions.reduce((sum, f) => sum + f.votes, 0);
  const quorumPct = total > 0 ? Math.min(100, (verdict.quorum / total) * 100) : null;

  return (
    <div>
      <p className={`mi-cons-outcome ${verdict.outcome}`}>{outcomeLabel(t)[verdict.outcome]}</p>
      <p className="mi-cons-sens">{outcomeSens(t)[verdict.outcome]}</p>
      <SurfacesPanel verdict={verdict} />
      {verdict.factions.length > 0 && (
        <>
          <div
            className="mi-cons-bar"
            role="img"
            aria-label={t(
              `${verdict.factions.length} faction(s), quorum à ${verdict.quorum} voix`,
              `${verdict.factions.length} faction(s), quorum at ${verdict.quorum} votes`,
            )}
          >
            {verdict.factions.map((f) => (
              <div
                key={f.signature}
                className={`mi-fac-seg${f.diversity >= 2 ? ' gold' : ' hatch'}${
                  verdict.winner?.signature === f.signature ? ' win' : ''
                }`}
                style={{ flexGrow: f.votes }}
                title={t(
                  `${f.votes} voix — ${f.agentTypes.join(', ')}`,
                  `${f.votes} vote(s) — ${f.agentTypes.join(', ')}`,
                )}
              />
            ))}
            {quorumPct !== null && (
              <div
                className="mi-quorum"
                style={{ left: `${quorumPct}%` }}
                title={t(`Quorum : ${verdict.quorum} voix`, `Quorum: ${verdict.quorum} votes`)}
              />
            )}
          </div>
          <p className="mi-cons-note">
            {t(
              `quorum : ${verdict.quorum} voix · ${total} voix exprimée(s)`,
              `quorum: ${verdict.quorum} votes · ${total} vote(s) cast`,
            )}
          </p>
          <ul className="mi-fac-list">
            {verdict.factions.map((f) => (
              <li key={f.signature} className="mi-fac-row">
                <code className="mi-fac-sig">{f.signature}</code>
                <span>{t(`${f.votes} voix`, `${f.votes} vote(s)`)}</span>
                {f.agentTypes.map((at) => (
                  <span key={at} className="chip mi-chip-static">
                    {at}
                  </span>
                ))}
                {verdict.winner?.signature === f.signature && (
                  <span className="mi-elected">{t('Élu', 'Elected')}</span>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

// ─── Vue principale ──────────────────────────────────────────────────────────

type Tab = 'diff' | 'logs' | 'consensus';

type MergePhase =
  | { step: 'idle' }
  | { step: 'arming' }
  | { step: 'starting' }
  | { step: 'waiting'; mergeId: string; since: number }
  | { step: 'done'; result: MergeRunResult }
  | { step: 'error'; message: string };

export default function Miellerie({
  snapshot,
  onOpenTask,
  onNavigate,
  selectedId,
  refreshTick,
}: ViewProps) {
  const t = useT();
  const reviewTick = useReviewTick();
  void reviewTick; // relit localStorage (tri + compteurs) à chaque revue

  // File de revue : done/failed, groupées par projet, triées (failed → non-revues → revues).
  const finished = snapshot.tasks.filter((t) => t.status === 'done' || t.status === 'failed');
  const byRank = (a: Task, b: Task) => reviewRank(a) - reviewRank(b) || b.updatedAt - a.updatedAt;
  const groups: { id: string; name: string; tasks: Task[] }[] = [];
  for (const p of snapshot.projects) {
    const tasks = finished.filter((t) => t.projectId === p.id).sort(byRank);
    if (tasks.length > 0) groups.push({ id: p.id, name: p.name, tasks });
  }
  const known = new Set(snapshot.projects.map((p) => p.id));
  const orphans = finished.filter((t) => !known.has(t.projectId)).sort(byRank);
  if (orphans.length > 0)
    groups.push({ id: '?', name: t('Projet inconnu', 'Unknown project'), tasks: orphans });
  const flat = groups.flatMap((g) => g.tasks);
  const reviewedCount = flat.filter((t) => getReview(t.id) !== null).length;

  // Sélection : selectedId du hash si présent dans la liste, sinon la dernière
  // tâche affichée (épinglée : le re-tri à l'arrivée d'une production ne doit
  // jamais changer la tâche inspectée sous les doigts de l'utilisateur).
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const activeTask =
    (selectedId ? flat.find((t) => t.id === selectedId) : undefined) ??
    (pinnedId ? flat.find((t) => t.id === pinnedId) : undefined) ??
    flat[0] ??
    null;
  const activeId = activeTask ? activeTask.id : null;
  const projectId = activeTask ? activeTask.projectId : null;
  useEffect(() => {
    if (activeId) setPinnedId(activeId);
  }, [activeId]);
  // Sélection intra-vue : replace (pas d'entrée d'historique à chaque j/k).
  const select = (id: string) => onNavigate('miellerie', id, { replace: true });

  const [tab, setTab] = useState<Tab>('diff');
  const [showInfo, setShowInfo] = useState(true);
  const queueRef = useRef<HTMLUListElement | null>(null);

  // Époque de sélection : force le re-fetch des sondes quand la tâche change
  // (useApiPoll ne réagit qu'au tick, pas au fetcher).
  const [selEpoch, setSelEpoch] = useState(0);
  const prevSel = useRef(activeId);
  useEffect(() => {
    if (prevSel.current !== activeId) {
      prevSel.current = activeId;
      setSelEpoch((e) => e + 1);
    }
  }, [activeId]);
  const pollTick = refreshTick + selEpoch;

  // ─── Sondes REST (≥ 30 s + tick) ────────────────────────────────────────────
  // Chaque sonde renvoie un objet TAGUÉ par l'id demandé (succès ET erreur) :
  // au changement de sélection, les données/erreurs d'une autre tâche sont
  // écartées au lieu d'être affichées comme si elles concernaient la nouvelle.
  const results = useApiPoll<{ id: string; list?: TaskResult[]; error?: string } | null>(
    () => {
      const id = activeId;
      return id
        ? fetchResults(id).then(
            (list) => ({ id, list }),
            (e: unknown) => ({ id, error: e instanceof Error ? e.message : String(e) }),
          )
        : Promise.resolve(null);
    },
    30_000,
    pollTick,
  );
  const curResults = results.data && results.data.id === activeId ? results.data : null;
  const resultsError = curResults?.error ?? null;
  // Dernier résultat de LA tâche active (écarte les données périmées d'une autre tâche).
  const lastResult = useMemo(() => {
    const list = curResults?.list ?? [];
    for (let i = list.length - 1; i >= 0; i--) {
      const r = list[i];
      if (r && r.taskId === activeId) return r;
    }
    return null;
  }, [curResults, activeId]);
  const resultsReady =
    curResults?.list != null && (curResults.list.length === 0 || lastResult !== null);

  const consensus = useApiPoll<{
    id: string;
    v?: Awaited<ReturnType<typeof fetchConsensus>>;
    error?: string;
  } | null>(
    () => {
      const id = activeId;
      return id
        ? fetchConsensus(id).then(
            (v) => ({ id, v }),
            (e: unknown) => ({ id, error: e instanceof Error ? e.message : String(e) }),
          )
        : Promise.resolve(null);
    },
    30_000,
    pollTick,
  );
  const curConsensus = consensus.data && consensus.data.id === activeId ? consensus.data : null;
  const verdict = curConsensus?.v ?? null;
  const consensusError = curConsensus?.error ?? null;

  const conflictsPoll = useApiPoll(
    () => {
      const id = projectId;
      return id
        ? fetchConflicts(id).then((r) => ({ id, list: r.conflicts }))
        : Promise.resolve(null);
    },
    60_000,
    pollTick,
  );
  const sting: Conflict[] | null =
    conflictsPoll.data && conflictsPoll.data.id === projectId
      ? conflictsPoll.data.list.filter((c) => c.a === activeId || c.b === activeId)
      : null;

  // ─── Décision de revue + auto-avance ────────────────────────────────────────
  const decide = (state: ReviewState | null) => {
    if (!activeTask) return;
    setReview(activeTask.id, state);
    if (state === null) return;
    // Auto-avance : prochaine tâche non revue, en bouclant sur la liste.
    const idx = flat.findIndex((t) => t.id === activeTask.id);
    const rest = [...flat.slice(idx + 1), ...flat.slice(0, idx)];
    const next = rest.find((t) => getReview(t.id) === null);
    if (next) select(next.id);
  };

  // ─── Raccourcis clavier (j/k, Enter, a/x/u, i, Esc) ────────────────────────
  const handleKey = (e: KeyboardEvent) => {
    // modalOpen : jamais de décision derrière un tiroir/modale ouverte.
    if (e.ctrlKey || e.metaKey || e.altKey || inInput() || modalOpen()) return;
    const focused = document.activeElement as HTMLElement | null;
    const tag = focused?.tagName ?? '';
    switch (e.key) {
      case 'j':
      case 'k': {
        if (flat.length === 0) return;
        const idx = activeId ? flat.findIndex((t) => t.id === activeId) : 0;
        const next = flat[(idx + (e.key === 'j' ? 1 : -1) + flat.length) % flat.length];
        if (next) select(next.id);
        break;
      }
      case 'Enter': {
        // Ne double pas les éléments interactifs déjà focalisés (rangées, boutons).
        if (tag === 'BUTTON' || tag === 'A' || tag === 'SUMMARY') return;
        if (focused?.getAttribute('role') === 'button') return;
        if (activeId) {
          e.preventDefault();
          onOpenTask(activeId);
        }
        break;
      }
      case 'a':
        // e.repeat : maintenir la touche ne doit pas approuver toute la file.
        if (!e.repeat) decide('approved');
        break;
      case 'x':
        if (!e.repeat) decide('rejected');
        break;
      case 'u':
        decide(null);
        break;
      case 'i':
        setShowInfo((v) => !v);
        break;
      case 'Escape': {
        const row =
          queueRef.current?.querySelector<HTMLElement>('.mi-row.active') ??
          queueRef.current?.querySelector<HTMLElement>('.mi-row');
        row?.focus();
        break;
      }
    }
  };
  const handleKeyRef = useRef(handleKey);
  handleKeyRef.current = handleKey;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ─── Coulée du miel (merge du projet de la tâche active) ───────────────────
  const [planState, setPlanState] = useState<{ id: string; plan: MergePlan } | null>(null);
  const [planErr, setPlanErr] = useState<string | null>(null);
  const [planOpen, setPlanOpen] = useState(false);
  const [planLoading, setPlanLoading] = useState(false);
  const [merge, setMerge] = useState<MergePhase>({ step: 'idle' });
  const armTimer = useRef<number | undefined>(undefined);

  // Changement de projet → on repart d'un pied de vue propre.
  useEffect(() => {
    setPlanState(null);
    setPlanErr(null);
    setPlanOpen(false);
    setMerge({ step: 'idle' });
  }, [projectId]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const togglePlan = () => {
    if (planOpen) {
      setPlanOpen(false);
      return;
    }
    if (!projectId) return;
    const id = projectId;
    setPlanOpen(true);
    setPlanErr(null);
    setPlanLoading(true);
    fetchMergePlan(id)
      .then((plan) => setPlanState({ id, plan }))
      .catch((e: unknown) => setPlanErr(readableError(e)))
      .finally(() => setPlanLoading(false));
  };

  const clickMerge = () => {
    if (!projectId || merge.step === 'starting' || merge.step === 'waiting') return;
    if (merge.step !== 'arming') {
      // 1er clic : armement — le 2e clic (sous 3 s) confirme.
      setMerge({ step: 'arming' });
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => {
        setMerge((m) => (m.step === 'arming' ? { step: 'idle' } : m));
      }, 3_000);
      return;
    }
    window.clearTimeout(armTimer.current);
    setMerge({ step: 'starting' });
    // Le geste de revue compte : approuvées seules si approbation explicite ;
    // sinon tout le terminé SAUF les rejetées (le serveur les exclut aussi —
    // défense en profondeur, il est la source de vérité des revues).
    const doneOfProject = snapshot.tasks.filter(
      (t) => t.projectId === projectId && t.status === 'done',
    );
    const approvedIds = doneOfProject
      .filter((t) => getReview(t.id) === 'approved')
      .map((t) => t.id);
    const keptIds = doneOfProject.filter((t) => getReview(t.id) !== 'rejected').map((t) => t.id);
    if (doneOfProject.length === 0) {
      setMerge({
        step: 'error',
        message: tNow(
          'Aucune production terminée à couler pour ce projet.',
          'No finished production to pour for this project.',
        ),
      });
      return;
    }
    if (keptIds.length === 0) {
      setMerge({
        step: 'error',
        message: tNow(
          'Toutes les productions terminées sont rejetées — rien à couler.',
          'All finished productions are rejected — nothing to pour.',
        ),
      });
      return;
    }
    const taskIds =
      approvedIds.length > 0
        ? approvedIds
        : keptIds.length < doneOfProject.length
          ? keptIds
          : undefined;
    runMerge(projectId, { taskIds })
      .then((start) => setMerge({ step: 'waiting', mergeId: start.mergeId, since: Date.now() }))
      .catch((e: unknown) => setMerge({ step: 'error', message: readableError(e) }));
  };

  // Suivi du merge : relevé toutes les 3 s (exception bornée), 2 min max + refreshTick.
  useEffect(() => {
    if (merge.step !== 'waiting' || !projectId) return;
    const { mergeId, since } = merge;
    const id = projectId;
    let alive = true;
    const check = () => {
      // Timeout évalué hors du .then : un orchestrateur durablement injoignable
      // ne doit pas laisser « Fusion en cours… » à vie.
      if (Date.now() - since > 120_000) {
        if (alive) {
          setMerge({
            step: 'error',
            message: tNow(
              'Pas de résultat après 2 min — le merge tourne peut-être encore côté nœud.',
              'No result after 2 min — the merge may still be running on the node.',
            ),
          });
        }
        return;
      }
      fetchMergeResult(id)
        .then(({ result }) => {
          if (alive && result && result.mergeId === mergeId) setMerge({ step: 'done', result });
        })
        .catch(() => {
          // Relevé raté (coupure réseau, 429…) : on retente au prochain battement.
        });
    };
    check();
    const timer = window.setInterval(check, 3_000);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, [merge, projectId, refreshTick]);

  // ─── État vide accueillant ──────────────────────────────────────────────────
  if (!activeTask) {
    return (
      <div className="mc-view mi-view">
        <div className="mi-empty">
          <span className="mi-empty-icon marque" aria-hidden="true" />
          <p className="mi-empty-lead">
            {t(
              'Le nectar arrive — aucune production à revoir.',
              'The nectar is coming — no production to review.',
            )}
          </p>
          <p className="muted-text">
            {t(
              'Les tâches terminées ou échouées apparaîtront ici pour la revue humaine.',
              'Finished or failed tasks will appear here for human review.',
            )}
          </p>
        </div>
      </div>
    );
  }

  const currentReview = getReview(activeTask.id);
  const titleOf = (id: string) => snapshot.tasks.find((t) => t.id === id)?.title ?? id.slice(0, 8);
  const activeNode = nodeName(
    snapshot.nodes,
    activeTask.result?.nodeId ?? activeTask.assignedNodeId,
  );
  const projTasks = snapshot.tasks.filter((t) => t.projectId === projectId);
  const doneCount = projTasks.filter((t) => t.status === 'done').length;
  const approvedCount = projTasks.filter(
    (t) => t.status === 'done' && getReview(t.id) === 'approved',
  ).length;
  const rejectedCount = projTasks.filter(
    (t) => t.status === 'done' && getReview(t.id) === 'rejected',
  ).length;
  const projName =
    snapshot.projects.find((p) => p.id === projectId)?.name ??
    t('Projet inconnu', 'Unknown project');

  return (
    <div className="mc-view mi-view">
      <div className={`mi-grid${showInfo ? '' : ' no-info'}`}>
        {/* ── Volet 1 : file de revue ── */}
        <aside className="card panel mi-queue-pane" aria-label={t('File de revue', 'Review queue')}>
          <header className="panel-head">
            <h2>{t('File de revue', 'Review queue')}</h2>
            <span className="panel-count">
              {reviewedCount}/{flat.length} {t('revues', 'reviewed')}
            </span>
          </header>
          <div className="mi-comb-wrap">
            <Honeycomb tasks={flat} showReview mini onSelect={(t) => select(t.id)} />
          </div>
          <ul className="queue mi-queue" ref={queueRef}>
            {groups.map((g) => [
              <li key={`g-${g.id}`} className="mi-group">
                ⬡ {g.name} <span className="chip-count">{g.tasks.length}</span>
              </li>,
              ...g.tasks.map((task) => {
                const review = getReview(task.id);
                const active = task.id === activeId;
                return (
                  <li
                    key={task.id}
                    className={`clickable mi-row${active ? ' active' : ''}`}
                    aria-current={active ? 'true' : undefined}
                    {...activateProps(() => select(task.id))}
                  >
                    <StatusBadge status={task.status} />
                    <span className="mi-row-body">
                      <span className="mi-row-title">{task.title}</span>
                      <span className="mi-row-meta">
                        {nodeName(snapshot.nodes, task.result?.nodeId ?? task.assignedNodeId)}
                        {task.result ? ` · ${formatMs(task.result.durationMs)}` : ''}
                      </span>
                    </span>
                    <span
                      className={`mi-dot${review === 'approved' ? ' ok' : review === 'rejected' ? ' ko' : ''}`}
                      title={t('revue locale (ce navigateur)', 'local review (this browser)')}
                    >
                      {review === 'approved' ? '●' : review === 'rejected' ? '✖' : '·'}
                    </span>
                  </li>
                );
              }),
            ])}
          </ul>
        </aside>

        {/* ── Volet 2 : inspection ── */}
        <section
          className="card mi-inspect"
          aria-label={t('Inspection de la tâche', 'Task inspection')}
        >
          <header className="mi-inspect-head">
            <div className="mi-inspect-title">
              <StatusBadge status={activeTask.status} />
              <h2>{activeTask.title}</h2>
            </div>
            <div className="mi-inspect-sub">
              <span title={t('Nœud butineur', 'Foraging node')}>{activeNode}</span>
              {activeTask.branch && <code className="mono mi-branch">{activeTask.branch}</code>}
              {activeTask.result && <span>{formatMs(activeTask.result.durationMs)}</span>}
            </div>
          </header>

          <div
            className="drawer-tabs mi-tabs"
            aria-label={t("Onglets d'inspection", 'Inspection tabs')}
          >
            {(['diff', 'logs', 'consensus'] as const).map((tb) => (
              <button key={tb} className={tab === tb ? 'active' : ''} onClick={() => setTab(tb)}>
                {tb === 'diff' ? 'Diff' : tb === 'logs' ? 'Logs' : 'Consensus'}
              </button>
            ))}
          </div>

          <div className="mi-tab-body">
            {tab === 'diff' &&
              (resultsError ? (
                <p className="panel-error">
                  {t('Résultats indisponibles :', 'Results unavailable:')} {resultsError}
                </p>
              ) : !resultsReady ? (
                <p className="muted-text">{t('Le butin arrive…', 'The forage is on its way…')}</p>
              ) : lastResult ? (
                <DiffPanel diff={lastResult.diff} />
              ) : (
                <p className="muted-text">
                  {t(
                    'Aucun résultat remonté pour cette tâche.',
                    'No result reported for this task.',
                  )}
                </p>
              ))}
            {tab === 'logs' &&
              (resultsError ? (
                <p className="panel-error">
                  {t('Résultats indisponibles :', 'Results unavailable:')} {resultsError}
                </p>
              ) : !resultsReady ? (
                <p className="muted-text">{t('Le butin arrive…', 'The forage is on its way…')}</p>
              ) : lastResult ? (
                <pre className="code-block scroll mi-logs">
                  {lastResult.logs || t('(aucun log)', '(no logs)')}
                </pre>
              ) : (
                <p className="muted-text">
                  {t(
                    'Aucun résultat remonté pour cette tâche.',
                    'No result reported for this task.',
                  )}
                </p>
              ))}
            {tab === 'consensus' && <ConsensusPanel verdict={verdict} error={consensusError} />}
          </div>

          {/* ── Barre de décision sticky ── */}
          <div className="mi-decide" aria-label={t('Décision de revue', 'Review decision')}>
            <button
              className="btn primary"
              title={t(
                'Approuver — revue locale (ce navigateur)',
                'Approve — local review (this browser)',
              )}
              onClick={() => decide('approved')}
            >
              {t('Approuver', 'Approve')} <kbd>a</kbd>
            </button>
            <button
              className="btn mi-reject"
              title={t(
                'Rejeter — revue locale (ce navigateur)',
                'Reject — local review (this browser)',
              )}
              onClick={() => decide('rejected')}
            >
              ✖ {t('Rejeter', 'Reject')} <kbd>x</kbd>
            </button>
            <button
              className="btn ghost"
              disabled={currentReview === null}
              title={t('Annuler la revue locale', 'Undo the local review')}
              onClick={() => decide(null)}
            >
              {t('annuler la revue', 'undo the review')} <kbd>u</kbd>
            </button>
            <span
              className="mi-decide-state"
              title={t('revue locale (ce navigateur)', 'local review (this browser)')}
            >
              {currentReview === 'approved'
                ? t('Revue : approuvée', 'Review: approved')
                : currentReview === 'rejected'
                  ? t('Revue : rejetée', 'Review: rejected')
                  : t('Non revue', 'Not reviewed')}
            </span>
            <button
              className="btn ghost mi-info-toggle"
              title={t(
                'Afficher/replier le volet verdict (i)',
                'Show/collapse the verdict pane (i)',
              )}
              onClick={() => setShowInfo((v) => !v)}
            >
              {showInfo ? t('Replier le verdict', 'Collapse the verdict') : 'Verdict'} <kbd>i</kbd>
            </button>
          </div>
        </section>

        {/* ── Volet 3 : verdict (repliable, touche i) ── */}
        {showInfo && (
          <aside
            className="card mi-info"
            aria-label={t('Verdict et contexte', 'Verdict and context')}
          >
            <header className="panel-head">
              <h2>Verdict</h2>
              <button
                className="mi-close-info"
                title={t('Replier (i)', 'Collapse (i)')}
                aria-label={t('Replier le volet verdict', 'Collapse the verdict pane')}
                onClick={() => setShowInfo(false)}
              >
                ✕
              </button>
            </header>
            <div className="mi-info-body">
              <dl className="meta-grid">
                <dt>{t('Nœud', 'Node')}</dt>
                <dd>{activeNode}</dd>
                <dt>{t('Tentatives', 'Attempts')}</dt>
                <dd>{activeTask.attempts}</dd>
                <dt>{t('Branche', 'Branch')}</dt>
                <dd className="mono">{activeTask.branch ?? '—'}</dd>
                <dt>{t('Dépendances', 'Dependencies')}</dt>
                <dd>
                  {activeTask.dependsOn.length > 0
                    ? activeTask.dependsOn.map(titleOf).join(', ')
                    : '—'}
                </dd>
                <dt>Id</dt>
                <dd className="mono">{activeTask.id}</dd>
              </dl>

              <details className="mi-prompt">
                <summary>{t('Prompt d’origine', 'Original prompt')}</summary>
                <pre className="code-block scroll">{activeTask.prompt}</pre>
              </details>

              <h3 className="mi-sub">{t('Conflits Sting', 'Sting conflicts')}</h3>
              {conflictsPoll.error ? (
                <p className="panel-error">
                  {t('Conflits indisponibles :', 'Conflicts unavailable:')} {conflictsPoll.error}
                </p>
              ) : sting === null ? (
                <p className="muted-text">{t('Analyse des dards…', 'Analyzing the stingers…')}</p>
              ) : sting.length === 0 ? (
                <p className="muted-text">
                  {t('Aucun conflit impliquant cette tâche.', 'No conflict involving this task.')}
                </p>
              ) : (
                <ul className="mi-sting">
                  {sting.map((c, i) => {
                    const other = c.a === activeId ? c.b : c.a;
                    return (
                      <li key={i} className={`mi-sting-item ${c.severity}`}>
                        <span className="mi-sting-sev">
                          {c.severity === 'high' ? t('⚡ fort', '⚡ high') : t('· faible', '· low')}
                        </span>
                        <span className="mi-sting-other">
                          {t(`avec « ${titleOf(other)} »`, `with “${titleOf(other)}”`)}
                        </span>
                        {c.sharedPaths.length > 0 && (
                          <code className="mi-sting-paths">{c.sharedPaths.join(', ')}</code>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* ── Pied de vue : coulée du miel (merge par projet) ── */}
      <footer className="mi-merge" aria-label={t('Coulée du miel', 'Honey pour')}>
        <div className="mi-merge-bar">
          <span className="mi-merge-proj">⬡ {projName}</span>
          <span className="mi-merge-count">
            {t('Prêt à fusionner :', 'Ready to merge:')} <strong>{approvedCount}</strong>{' '}
            {t('approuvée(s)', 'approved')} / {doneCount} {t('terminée(s)', 'finished')}
            {rejectedCount > 0 && (
              <em
                className="mi-merge-rejected"
                title={t(
                  'Les rejets ne coulent jamais dans le miel',
                  'Rejects never pour into the honey',
                )}
              >
                {' '}
                · {rejectedCount} {t('rejetée(s) exclue(s)', 'rejected (excluded)')}
              </em>
            )}
          </span>
          <button className="btn" onClick={togglePlan}>
            {planOpen
              ? t('Replier le plan', 'Collapse the plan')
              : t('Plan de merge', 'Merge plan')}
          </button>
          <button
            className={`btn primary mi-pour${merge.step === 'arming' ? ' arming' : ''}`}
            disabled={merge.step === 'starting' || merge.step === 'waiting'}
            title={t(
              'Exécute réellement le merge sur un nœud (double-clic de confirmation)',
              'Actually runs the merge on a node (double-click to confirm)',
            )}
            onClick={clickMerge}
          >
            {merge.step === 'arming'
              ? t('Confirmer la coulée ?', 'Confirm the pour?')
              : merge.step === 'starting'
                ? t('Lancement…', 'Starting…')
                : merge.step === 'waiting'
                  ? t('Fusion en cours…', 'Merging…')
                  : t('Couler le miel', 'Pour the honey')}
          </button>
        </div>

        {planOpen && (
          <div className="mi-plan">
            {planErr && (
              <p className="panel-error">
                {t('Plan indisponible :', 'Plan unavailable:')} {planErr}
              </p>
            )}
            {planLoading && (
              <p className="muted-text">{t('Calcul du plan…', 'Computing the plan…')}</p>
            )}
            {planState && planState.id === projectId && (
              <>
                <p className="mi-plan-head">
                  {planState.plan.done}/{planState.plan.total} {t('terminée(s)', 'finished')} ·{' '}
                  {planState.plan.mergeable
                    ? t('intégrable d’un coup', 'mergeable in one go')
                    : t('intégration partielle ou conflits', 'partial integration or conflicts')}
                </p>
                {planState.plan.order.length > 0 ? (
                  <ol className="mi-plan-order">
                    {planState.plan.order.map((id) => (
                      <li key={id}>{titleOf(id)}</li>
                    ))}
                  </ol>
                ) : (
                  <p className="muted-text">
                    {t('Rien à fusionner pour l’instant.', 'Nothing to merge yet.')}
                  </p>
                )}
                {planState.plan.conflicts.length === 0 ? (
                  <p className="muted-text">
                    {t('Aucun conflit de lignes détecté.', 'No line conflicts detected.')}
                  </p>
                ) : (
                  <ul className="mi-plan-conflicts">
                    {planState.plan.conflicts.map((c, i) => (
                      <li key={i}>
                        ⚡ {titleOf(c.a)} ↔ {titleOf(c.b)} — <code>{c.file}</code>
                      </li>
                    ))}
                  </ul>
                )}
              </>
            )}
          </div>
        )}

        {merge.step === 'waiting' && (
          <p className="mi-merge-wait">
            {t(
              'Le nœud coule le miel… (relevé toutes les 3 s, 2 min max)',
              'The node is pouring the honey… (polled every 3 s, 2 min max)',
            )}
          </p>
        )}
        {merge.step === 'error' && <p className="panel-error">{merge.message}</p>}
        {merge.step === 'done' && (
          <div className="mi-merge-result">
            <p>
              {merge.result.applied.length} {t('branche(s) appliquée(s)', 'branch(es) applied')} ·{' '}
              {merge.result.conflicts.length} {t('conflit(s)', 'conflict(s)')} ·{' '}
              {merge.result.testsRun
                ? merge.result.testsPassed
                  ? 'tests ✔'
                  : 'tests ✘'
                : t('tests non lancés', 'tests not run')}
            </p>
            {merge.result.conflicts.length > 0 && (
              <ul className="mi-plan-conflicts">
                {merge.result.conflicts.map((c, i) => (
                  <li key={i}>
                    ✖ {titleOf(c.taskId)} — {c.reason}
                  </li>
                ))}
              </ul>
            )}
            {merge.result.logs && (
              <details className="mi-merge-logs">
                <summary>{t('Logs du merge', 'Merge logs')}</summary>
                <pre className="code-block scroll">{merge.result.logs}</pre>
              </details>
            )}
          </div>
        )}
      </footer>
    </div>
  );
}
