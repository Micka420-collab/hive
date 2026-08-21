// Chambre — poste de travail d'une ouvrière baptisée (ADR 0010, lot 5).
//
// Quatre zones. Rien n'est inventé : baptême / métier / présence absents ⇒
// l'écran se tait. Zone Ordinateur = Atelier existant (noVNC), ou « éteint ».

import './chambre.css';
import { useEffect, useMemo, useState } from 'react';
import { arreterAtelier, demarrerAtelier, fetchAtelier, fetchChambre } from '../api';
import type { ChambrePoste, EtatAtelier } from '../api';
import { useLang, useT } from '../i18n';
import { libelleMetier } from '../../../src/orchestrator/metier.js';
import type { MetierCycle } from '../../../src/orchestrator/metier.js';
import { timeShort } from './shared';
import type { ViewProps } from './shared';
import type { HiveEvent, Task, TaskStatus } from '../../../src/shared/types';

function missionsFiltrees(
  tasks: Task[],
  filtre: 'cours' | 'pause' | 'terminees' | 'echecs',
): Task[] {
  const map: Record<typeof filtre, TaskStatus[]> = {
    cours: ['assigned', 'running'],
    pause: ['ready', 'pending'],
    terminees: ['done'],
    echecs: ['failed'],
  };
  const ok = new Set(map[filtre]);
  return tasks.filter((t) => ok.has(t.status));
}

function evenementsDuNoeud(events: HiveEvent[], nodeId: string, tasks: Task[]): HiveEvent[] {
  const taskIds = new Set(tasks.map((t) => t.id));
  return events
    .filter((ev) => {
      const p = ev.payload as Record<string, unknown>;
      if (p.nodeId === nodeId) return true;
      if (typeof p.taskId === 'string' && taskIds.has(p.taskId)) return true;
      return false;
    })
    .slice(-80)
    .reverse();
}

export default function Chambre({
  snapshot,
  events,
  selectedId,
  onNavigate,
  onOpenTask,
}: ViewProps) {
  const t = useT();
  const lang = useLang();
  const nodeId = selectedId ?? '';
  const [poste, setPoste] = useState<ChambrePoste | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyAtelier, setBusyAtelier] = useState(false);
  const [filtre, setFiltre] = useState<'cours' | 'pause' | 'terminees' | 'echecs'>('cours');

  const rafraichir = () => {
    if (!nodeId) return;
    void fetchChambre(nodeId)
      .then((p) => {
        setPoste(p);
        setErr(null);
      })
      .catch((e) => {
        setPoste(null);
        setErr(e instanceof Error ? e.message : String(e));
      });
  };

  useEffect(() => {
    rafraichir();
    const id = window.setInterval(rafraichir, 4_000);
    return () => window.clearInterval(id);
  }, [nodeId]);

  // Fusion live : tâches du snapshot pour CETTE ouvrière (plus frais que le GET).
  const tasksLive = useMemo(() => {
    if (!nodeId) return [];
    const fromSnap = snapshot.tasks.filter(
      (tk) => tk.assignedNodeId === nodeId || tk.result?.nodeId === nodeId,
    );
    if (!poste) return fromSnap;
    const byId = new Map(poste.tasks.map((tk) => [tk.id, tk]));
    for (const tk of fromSnap) byId.set(tk.id, tk);
    return [...byId.values()].sort((a, b) => b.updatedAt - a.updatedAt);
  }, [snapshot.tasks, poste, nodeId]);

  const journal = useMemo(
    () => evenementsDuNoeud(events, nodeId, tasksLive),
    [events, nodeId, tasksLive],
  );

  const activite = missionsFiltrees(tasksLive, filtre);

  if (!nodeId) {
    return (
      <div className="mc-view ch-view">
        <p className="muted-text">
          {t(
            'Aucune ouvrière sélectionnée — ouvrez un poste depuis la fiche d’un nœud.',
            'No worker selected — open a workstation from a node sheet.',
          )}
        </p>
      </div>
    );
  }

  if (err && !poste) {
    return (
      <div className="mc-view ch-view">
        <button type="button" className="btn ghost" onClick={() => onNavigate('ruche')}>
          ← {t('Ruche', 'Hive')}
        </button>
        <p className="ch-err">{err}</p>
      </div>
    );
  }

  const titre = poste?.bapteme?.nom;
  const metier =
    poste?.metier && (poste.metier.metier as MetierCycle)
      ? libelleMetier(poste.metier.metier as MetierCycle, lang === 'en' ? 'en' : 'fr')
      : null;

  return (
    <div className="mc-view ch-view">
      <header className="ch-bar">
        <button type="button" className="btn ghost" onClick={() => onNavigate('ruche')}>
          ← {t('Ruche', 'Hive')}
        </button>
        <h2 className="ch-titre">
          {titre ?? t('Poste ouvrière', 'Worker station')}
          {!titre && poste && (
            <span className="ch-tech muted-text"> · {poste.node.nameTechnique}</span>
          )}
        </h2>
      </header>

      <div className="ch-grid">
        {/* 1 — Identité */}
        <aside className="ch-zone ch-identite" aria-label={t('Identité', 'Identity')}>
          <h3>{t('Identité', 'Identity')}</h3>
          {poste ? (
            <>
              <p className="ch-nom">
                {titre ?? (
                  <span className="muted-text">{t('Pas encore baptisée', 'Not baptised yet')}</span>
                )}
              </p>
              <ul className="ch-meta">
                <li>
                  {poste.node.status === 'online'
                    ? t('en ligne', 'online')
                    : t('hors ligne', 'offline')}
                </li>
                {metier && (
                  <li>
                    {t('Métier', 'Role')}: {metier}
                  </li>
                )}
                {poste.caste && (
                  <li>
                    {t('Caste', 'Caste')}: {poste.caste}
                  </li>
                )}
                <li>
                  {poste.node.ownerName} · {poste.node.agentType}
                </li>
                <li>
                  {poste.node.running}/{poste.node.maxConcurrency} {t('en vol', 'in flight')}
                </li>
              </ul>
              {poste.presences.length > 0 ? (
                <div className="ch-presences">
                  <h4>{t('Fichiers ouverts', 'Open files')}</h4>
                  <ul>
                    {poste.presences.map((p) => (
                      <li key={p.toolUseId}>
                        <span className="ch-outil">{p.outil}</span> {p.chemin}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : (
                <p className="muted-text ch-silence">
                  {t('Aucun fichier ouvert constaté.', 'No open file observed.')}
                </p>
              )}
            </>
          ) : (
            <p className="muted-text">{t('Chargement…', 'Loading…')}</p>
          )}
        </aside>

        {/* 2 — Journal */}
        <section className="ch-zone ch-journal" aria-label={t('Journal', 'Log')}>
          <h3>{t('Journal', 'Log')}</h3>
          {journal.length === 0 ? (
            <p className="muted-text">
              {t('Pas encore d’activité pour cette ouvrière.', 'No activity for this worker yet.')}
            </p>
          ) : (
            <ul className="ch-log">
              {journal.map((ev) => (
                <li key={ev.id}>
                  <span className="ch-log-time">{timeShort(ev.ts)}</span>
                  <span className="ch-log-type">{ev.type}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 3 — Activité */}
        <section className="ch-zone ch-activite" aria-label={t('Activité', 'Activity')}>
          <h3>{t('Activité', 'Activity')}</h3>
          <div className="ch-filtres" role="tablist">
            {(
              [
                ['cours', t('En cours', 'In progress')],
                ['pause', t('En pause', 'Paused')],
                ['terminees', t('Terminées', 'Done')],
                ['echecs', t('Échecs', 'Failed')],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={filtre === id}
                className={filtre === id ? 'actif' : ''}
                onClick={() => setFiltre(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {activite.length === 0 ? (
            <p className="muted-text">{t('Rien dans ce filtre.', 'Nothing in this filter.')}</p>
          ) : (
            <ul className="ch-taches">
              {activite.slice(0, 24).map((tk) => (
                <li key={tk.id}>
                  <button type="button" className="ch-tache" onClick={() => onOpenTask(tk.id)}>
                    {tk.title}
                  </button>
                  <span className="ch-tache-time">{timeShort(tk.updatedAt)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* 4 — Ordinateur = Atelier */}
        <section className="ch-zone ch-ordi" aria-label={t('Ordinateur', 'Computer')}>
          <h3>{t('Ordinateur', 'Computer')}</h3>
          <AtelierPoste
            etat={poste?.atelier ?? null}
            busy={busyAtelier}
            onBusy={setBusyAtelier}
            onChange={(e) => setPoste((p) => (p ? { ...p, atelier: e } : p))}
          />
        </section>
      </div>
    </div>
  );
}

function AtelierPoste({
  etat,
  busy,
  onBusy,
  onChange,
}: {
  etat: EtatAtelier | null;
  busy: boolean;
  onBusy: (b: boolean) => void;
  onChange: (e: EtatAtelier) => void;
}) {
  const t = useT();

  const agir = async (fn: () => Promise<unknown>) => {
    onBusy(true);
    try {
      await fn();
      onChange(await fetchAtelier());
    } catch {
      /* l'état suivant le dira */
      try {
        onChange(await fetchAtelier());
      } catch {
        /* */
      }
    } finally {
      onBusy(false);
    }
  };

  if (!etat) {
    return <p className="muted-text">{t('État de l’atelier inconnu.', 'Studio state unknown.')}</p>;
  }

  if (!etat.actif) {
    return (
      <div className="ch-ordi-off">
        <p>
          {t(
            'Bureau de recette éteint sur la machine de la ruche — on n’invente pas d’écran.',
            'Acceptance desktop is off on the hive computer — no fake screen.',
          )}
        </p>
        {etat.mode !== 'off' && (
          <button
            type="button"
            className="btn primary"
            disabled={busy}
            onClick={() => void agir(demarrerAtelier)}
          >
            {t('Allumer l’atelier', 'Start the studio')}
          </button>
        )}
        {etat.mode === 'off' && <p className="muted-text">HIVE_ATELIER=off</p>}
      </div>
    );
  }

  return (
    <div className="ch-ordi-on">
      <div className="ch-ordi-actions">
        <button
          type="button"
          className="btn ghost"
          disabled={busy}
          onClick={() => void agir(arreterAtelier)}
        >
          {t('Éteindre', 'Stop')}
        </button>
        <a className="btn ghost" href={etat.ecran} target="_blank" rel="noreferrer">
          {t('Ouvrir l’écran', 'Open screen')}
        </a>
      </div>
      <iframe
        className="ch-vnc"
        title={t('Écran de l’atelier', 'Studio screen')}
        src={etat.ecran}
        // noVNC est local ; sandbox minimale pour ne pas élargir.
        sandbox="allow-scripts allow-same-origin allow-forms"
      />
    </div>
  );
}
