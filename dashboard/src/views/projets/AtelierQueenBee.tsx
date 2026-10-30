// L'ATELIER QUEEN BEE — un brief devient un plan de tâches (DAG), relu puis
// envoyé à un projet. Sorti de `Projets.tsx` tel quel : la vue ne fait plus
// que composer ses panneaux, chacun lisible (et éprouvé) seul.

import { useMemo, useState } from 'react';
import { addTasks, planBrief } from '../../api';
import type { NewTaskInput, PlanResponse } from '../../api';
import { useT } from '../../i18n';
import { CarteDevis } from '../Balance';
import type { Project } from '../../../../src/shared/types';
import { errMsg } from './commun';
import '../projets.css';

// ─── Atelier Queen Bee : brief → plan de tâches (DAG) → envoi au projet ──────

type PlanMode = 'auto' | 'heuristic' | 'llm';

/** Profondeur de chaque tâche du plan selon dependsOn (cycles tolérés). */
function planDepths(tasks: NewTaskInput[]): number[] {
  const byId = new Map<string, NewTaskInput>();
  for (const t of tasks) if (t.id) byId.set(t.id, t);
  const memo = new Map<string, number>();
  const depthOf = (task: NewTaskInput, stack: Set<string>): number => {
    let max = -1;
    for (const dep of task.dependsOn ?? []) {
      const parent = byId.get(dep);
      if (!parent || stack.has(dep)) continue; // dépendance externe ou cycle
      let d = memo.get(dep);
      if (d === undefined) {
        stack.add(dep);
        d = depthOf(parent, stack);
        stack.delete(dep);
        memo.set(dep, d);
      }
      if (d > max) max = d;
    }
    return max + 1;
  };
  return tasks.map((t) => depthOf(t, new Set(t.id ? [t.id] : [])));
}

export function QueenBee({ projects }: { projects: Project[] }) {
  const t = useT();
  const [brief, setBrief] = useState('');
  const [mode, setMode] = useState<PlanMode>('auto');
  const [plan, setPlan] = useState<PlanResponse | null>(null);
  const [targetId, setTargetId] = useState('');
  const [busy, setBusy] = useState<'idle' | 'plan' | 'send'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);

  // Cible : sélection explicite, sinon le projet le plus récent.
  const target = targetId || (projects[0]?.id ?? '');
  const depths = useMemo(() => (plan ? planDepths(plan.tasks) : []), [plan]);
  const titleById = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of plan?.tasks ?? []) if (t.id) m.set(t.id, t.title);
    return m;
  }, [plan]);

  const propose = () => {
    setBusy('plan');
    setError(null);
    setSent(null);
    planBrief(brief.trim(), mode)
      .then((p) => setPlan(p))
      .catch((e: unknown) =>
        setError(t(`Plan impossible : ${errMsg(e)}`, `Could not plan: ${errMsg(e)}`)),
      )
      .finally(() => setBusy('idle'));
  };

  const send = () => {
    if (!plan || !target) return;
    setBusy('send');
    setError(null);
    // Les ids du planner sont déterministes ('socle', 'tests'…) et la validation
    // serveur est GLOBALE : on les suffixe d'un nonce (dependsOn remappés) pour
    // que le 2e plan de la ruche ne soit pas rejeté en collision d'ids.
    const suffix = Date.now().toString(36);
    const rename = new Map(
      plan.tasks.filter((t) => t.id).map((t) => [t.id!, `${t.id}-${suffix}`] as const),
    );
    const uniqueTasks = plan.tasks.map((t) => ({
      ...t,
      ...(t.id ? { id: rename.get(t.id) } : {}),
      ...(t.dependsOn ? { dependsOn: t.dependsOn.map((d) => rename.get(d) ?? d) } : {}),
    }));
    addTasks(target, uniqueTasks)
      .then((created) => {
        const name = projects.find((p) => p.id === target)?.name ?? target;
        setSent(
          t(
            `${created.length} tâche(s) déposée(s) dans « ${name} ». Bon butinage !`,
            `${created.length} task(s) dropped into “${name}”. Happy foraging!`,
          ),
        );
        setPlan(null);
        setBrief('');
      })
      .catch((e: unknown) =>
        setError(t(`Envoi refusé : ${errMsg(e)}`, `Send rejected: ${errMsg(e)}`)),
      )
      .finally(() => setBusy('idle'));
  };

  return (
    <section className="card pj-queen">
      <header className="panel-head">
        <h2>
          <span className="marque" aria-hidden="true" />{' '}
          {t('Atelier Queen Bee', 'Queen Bee Workshop')}
        </h2>
        <span className="panel-count">
          {t('brief → plan de butinage', 'brief → foraging plan')}
        </span>
      </header>
      <div className="pj-queen-body">
        <textarea
          className="pj-brief"
          rows={3}
          placeholder={t(
            'Décrivez votre projet… (ex. : API de sondages avec auth JWT et dashboard de résultats)',
            'Describe your project… (e.g. a survey API with JWT auth and a results dashboard)',
          )}
          value={brief}
          onChange={(e) => setBrief(e.target.value)}
          disabled={busy !== 'idle'}
          aria-label={t('Brief du projet', 'Project brief')}
        />
        <div className="pj-qb-actions">
          <label className="pj-select-label">
            <span>Mode</span>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as PlanMode)}
              disabled={busy !== 'idle'}
            >
              <option value="auto">auto</option>
              <option value="heuristic">{t('heuristique', 'heuristic')}</option>
              <option value="llm">llm</option>
            </select>
          </label>
          <button
            className="btn primary"
            onClick={propose}
            disabled={busy !== 'idle' || brief.trim().length < 8}
          >
            {busy === 'plan'
              ? t('La reine réfléchit…', 'The Queen is thinking…')
              : t('Proposer un plan', 'Propose a plan')}
          </button>
        </div>

        {error && <p className="panel-error">{error}</p>}
        {sent && <p className="pj-sent">{sent}</p>}

        {plan && (
          <div className="pj-plan">
            <div className="pj-plan-head">
              <span className={`pj-src ${plan.source}`}>
                {plan.source === 'llm' ? 'IA' : t('heuristique', 'heuristic')}
              </span>
              <span className="panel-count">
                {plan.tasks.length} {t('tâche(s)', 'task(s)')}
              </span>
              {plan.note && <span className="plan-note">{plan.note}</span>}
            </div>
            <ul className="pj-plan-list" aria-label={t('Prévisualisation du plan', 'Plan preview')}>
              {plan.tasks.map((t2, i) => {
                const deps = (t2.dependsOn ?? []).map((d) => titleById.get(d) ?? d);
                return (
                  <li key={t2.id ?? `t${i}`} style={{ paddingLeft: 8 + (depths[i] ?? 0) * 18 }}>
                    <span className="pj-plan-title">
                      {(depths[i] ?? 0) > 0 && (
                        <span className="pj-plan-arrow" aria-hidden="true">
                          ↳{' '}
                        </span>
                      )}
                      {t2.title}
                    </span>
                    {deps.length > 0 && (
                      <span className="pj-plan-deps mono">
                        {t('après :', 'after:')} {deps.join(', ')}
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
            {/* Devis (la Balance, « prévoir ») : `null` — ou absent, sur un
                orchestrateur d'avant le pèse-ruche — ⇒ SILENCE complet, jamais
                un « 0 » qui se lirait comme « gratuit ». Placé après le plan
                qu'il chiffre et avant l'envoi : c'est le dernier chiffre qu'on
                regarde avant de déposer les tâches. Volontairement loin de tout
                solde et de tout plafond — voir CarteDevis. */}
            {plan.devis && <CarteDevis devis={plan.devis} nbTaches={plan.tasks.length} />}
            <div className="pj-send">
              {projects.length > 0 ? (
                <>
                  <label className="pj-select-label">
                    <span>{t('Projet cible', 'Target project')}</span>
                    <select value={target} onChange={(e) => setTargetId(e.target.value)}>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button className="btn primary" onClick={send} disabled={busy !== 'idle'}>
                    {busy === 'send'
                      ? t('Envoi…', 'Sending…')
                      : t('Envoyer les tâches', 'Send the tasks')}
                  </button>
                </>
              ) : (
                <p className="muted-text pj-no-target">
                  {t(
                    'Créez d’abord un projet (« + Projet » dans la barre du haut) pour y déposer ces tâches.',
                    'Create a project first (“+ Project” in the top bar) to drop these tasks into.',
                  )}
                </p>
              )}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
