// Chambre — poste de travail d'une ouvrière baptisée (ADR 0010).
//
// Quatre zones. Rien n'est inventé : baptême / métier / présence absents ⇒
// l'écran se tait. Zone Ordinateur = Atelier existant (noVNC), ou « éteint ».
//
// Améliorations (réfs Magentic-One / agentic UX 2026) :
// - file HITL réquisitions en bandeau (approval gate)
// - journal = activity panel (outil·chemin, échecs quoi/pourquoi)
// - onglets Identité : Fiche / Travail / Intégrations / Suivi (horizon + fabrique)

import './chambre.css';
import { useEffect, useMemo, useState } from 'react';
import {
  ajouterHorizon,
  appliquerMotif,
  arreterAtelier,
  demarrerAtelier,
  fetchAtelier,
  fetchChambre,
  fetchMotifs,
  repondreRequisition,
} from '../api';
import type { ChambrePoste, EtatAtelier, MotifCatalogue } from '../api';
import { useLang, useT } from '../i18n';
import { demanderFocusFichier } from '../focus-vue';
import { libelleMetier } from '../../../src/orchestrator/metier.js';
import type { MetierCycle } from '../../../src/orchestrator/metier.js';
import {
  libelleGenreRequisition,
  type GenreRequisition,
} from '../../../src/orchestrator/requisition.js';
import { resumerEvenementChambre } from '../../../src/orchestrator/chambre-journal.js';
import { timeShort } from './shared';
import type { ViewProps } from './shared';
import type { HiveEvent, Task, TaskStatus } from '../../../src/shared/types';

type OngletId = 'fiche' | 'travail' | 'integrations' | 'suivi';

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

/** Chemin constaté → lien Rayon si projet lié, sinon silence du faux focus. */
function CheminConstate({
  chemin,
  projectId,
  onNavigate,
  className,
}: {
  chemin: string;
  projectId: string | null;
  onNavigate: ViewProps['onNavigate'];
  className?: string;
}) {
  const t = useT();
  if (projectId) {
    return (
      <button
        type="button"
        className={className ? `${className} ch-lien-chemin` : 'ch-lien-chemin'}
        title={t('Ouvrir dans le Rayon', 'Open in Rayon')}
        onClick={() => {
          demanderFocusFichier(chemin);
          onNavigate('rayon', projectId);
        }}
      >
        {chemin}
      </button>
    );
  }
  return (
    <span className={className}>
      {chemin}
      <span className="muted-text"> · {t('pas de projet lié', 'no linked project')}</span>
    </span>
  );
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
  const langCode = lang === 'en' ? 'en' : 'fr';
  const nodeId = selectedId ?? '';
  const [poste, setPoste] = useState<ChambrePoste | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busyAtelier, setBusyAtelier] = useState(false);
  const [filtre, setFiltre] = useState<'cours' | 'pause' | 'terminees' | 'echecs'>('cours');
  const [onglet, setOnglet] = useState<OngletId>('fiche');
  const [motifs, setMotifs] = useState<MotifCatalogue[]>([]);
  const [busyMotif, setBusyMotif] = useState<string | null>(null);
  const [brouillonHorizon, setBrouillonHorizon] = useState('');
  const [kindHorizon, setKindHorizon] = useState<'fait' | 'hypothese'>('fait');
  const [busyHorizon, setBusyHorizon] = useState(false);
  const [busyReqId, setBusyReqId] = useState<string | null>(null);

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

  useEffect(() => {
    if (onglet !== 'integrations') return;
    void fetchMotifs()
      .then((r) => setMotifs(r.motifs))
      .catch(() => setMotifs([]));
  }, [onglet]);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Ne pas voler Échap à un dialogue / tiroir modal ouvert.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      ev.preventDefault();
      onNavigate('ruche');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onNavigate]);

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
  const reqs = poste?.requisitions ?? [];

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
      ? libelleMetier(poste.metier.metier as MetierCycle, langCode)
      : null;

  const pillPour = (status: TaskStatus): { className: string; label: string } => {
    if (status === 'running' || status === 'assigned') {
      return { className: 'ch-pill ch-pill-cours', label: t('En cours', 'In progress') };
    }
    if (status === 'done') {
      return { className: 'ch-pill ch-pill-done', label: t('Terminé', 'Done') };
    }
    if (status === 'failed') {
      return { className: 'ch-pill ch-pill-fail', label: t('Échec', 'Failed') };
    }
    return { className: 'ch-pill ch-pill-pause', label: t('En pause', 'Paused') };
  };

  const badgeClass = (badge: string) => {
    const b = badge.toLowerCase();
    if (b === 'read') return 'ch-badge ch-badge-read';
    if (b === 'write') return 'ch-badge ch-badge-write';
    if (b === 'fail' || b === 'échec') return 'ch-badge ch-badge-fail';
    return 'ch-badge';
  };

  return (
    <div className="mc-view ch-view">
      <header className="ch-brand">
        <button
          type="button"
          className="btn ghost ch-brand-back"
          onClick={() => onNavigate('ruche')}
        >
          ← {t('Ruche', 'Hive')}
        </button>
        <div className="ch-brand-mark">
          <p className="ch-brand-hive">
            Hive
            <span className="ch-brand-hex" aria-hidden="true">
              <HexMiel />
            </span>
          </p>
          <p className="ch-brand-sub">{t('Chambre · poste ouvrière', 'Chambre · workstation')}</p>
        </div>
        <div className="ch-brand-aside">
          {poste?.projectId ? (
            <button
              type="button"
              className="btn ghost ch-lien-rayon"
              data-testid="chambre-ouvrir-rayon"
              onClick={() => onNavigate('rayon', poste.projectId!)}
            >
              {t('Voir le Rayon', 'Open Rayon')}
            </button>
          ) : null}
          {poste?.node.status === 'online' ? (
            <span className="ch-live" aria-live="polite">
              {t('en ligne', 'online')}
            </span>
          ) : (
            <span className="ch-live ch-live-off">{t('hors ligne', 'offline')}</span>
          )}
        </div>
      </header>

      {reqs.length > 0 && (
        <div className="ch-hitl" role="region" aria-label={t('À trancher', 'Needs a decision')}>
          <div className="ch-hitl-lead">
            <span className="ch-hitl-titre">{t('À trancher', 'Needs a decision')}</span>
            <span className="ch-hitl-sous">
              {t('Des décisions d’approbation sont en attente', 'Approval decisions are pending')} ·{' '}
              {reqs.length}
            </span>
          </div>
          <ul className="ch-hitl-list">
            {reqs.map((r) => (
              <li key={r.id}>
                <span>
                  <em>{libelleGenreRequisition(r.genre as GenreRequisition, langCode)}</em>
                  {' — '}
                  {r.libelle}
                  {r.detail ? <span className="muted-text"> · {r.detail}</span> : null}
                </span>
                <span className="ch-req-actions">
                  <button
                    type="button"
                    className="btn primary ch-btn-accorder"
                    disabled={busyReqId === r.id}
                    aria-busy={busyReqId === r.id}
                    onClick={() => {
                      setBusyReqId(r.id);
                      void repondreRequisition(r.id, 'accordee')
                        .then(rafraichir)
                        .finally(() => setBusyReqId(null));
                    }}
                  >
                    {busyReqId === r.id ? t('…', '…') : t('Accorder', 'Grant')}
                  </button>
                  <button
                    type="button"
                    className="btn ghost ch-btn-refuser"
                    disabled={busyReqId === r.id}
                    aria-busy={busyReqId === r.id}
                    onClick={() => {
                      setBusyReqId(r.id);
                      void repondreRequisition(r.id, 'refusee')
                        .then(rafraichir)
                        .finally(() => setBusyReqId(null));
                    }}
                  >
                    {busyReqId === r.id ? t('…', '…') : t('Refuser', 'Deny')}
                  </button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="ch-grid">
        <aside className="ch-zone ch-identite" aria-label={t('Identité', 'Identity')}>
          {poste ? (
            <>
              <div className="ch-ornement" aria-hidden="true">
                <AbeilleOrnement />
                <FleurOrnement />
              </div>
              <p className="ch-eyebrow">{t('Baptême', 'Baptism')}</p>
              <p className="ch-nom">
                {titre ?? (
                  <span className="muted-text">{t('Pas encore baptisée', 'Not baptised yet')}</span>
                )}
              </p>
              <p className="ch-sous-nom">
                {metier
                  ? `${t('Métier', 'Role')} · ${metier}`
                  : t('Métier non assigné', 'No role assigned')}
                {poste.caste ? ` · ${poste.caste}` : ''}
              </p>

              <div
                className="ch-onglets"
                role="tablist"
                aria-label={t('Sections', 'Sections')}
                data-testid="chambre-sections"
                aria-orientation="vertical"
                onKeyDown={(e) => {
                  const ordre: OngletId[] = ['fiche', 'travail', 'integrations', 'suivi'];
                  const i = ordre.indexOf(onglet);
                  if (i < 0) return;
                  let next = i;
                  if (e.key === 'ArrowDown' || e.key === 'ArrowRight')
                    next = (i + 1) % ordre.length;
                  else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft')
                    next = (i - 1 + ordre.length) % ordre.length;
                  else if (e.key === 'Home') next = 0;
                  else if (e.key === 'End') next = ordre.length - 1;
                  else return;
                  e.preventDefault();
                  setOnglet(ordre[next]!);
                  queueMicrotask(() => {
                    document.getElementById(`ch-tab-${ordre[next]}`)?.focus();
                  });
                }}
              >
                {(
                  [
                    ['fiche', t('Fiche', 'Sheet')],
                    ['travail', t('Travail', 'Work')],
                    ['integrations', t('Intégrations', 'Integrations')],
                    ['suivi', t('Suivi', 'Horizon')],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    id={`ch-tab-${id}`}
                    aria-controls={`ch-panel-${id}`}
                    aria-selected={onglet === id}
                    tabIndex={onglet === id ? 0 : -1}
                    className={onglet === id ? 'actif' : ''}
                    onClick={() => setOnglet(id)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div
                className="ch-onglet-corps"
                id={`ch-panel-${onglet}`}
                role="tabpanel"
                aria-labelledby={`ch-tab-${onglet}`}
                data-onglet={onglet}
                data-testid="chambre-onglet-corps"
              >
                {onglet === 'fiche' && (
                  <ul className="ch-meta">
                    <li>
                      <span className="ch-meta-k">{t('Statut', 'Status')}</span>
                      <span className="ch-meta-v ch-statut-dot">
                        {poste.node.status === 'online'
                          ? t('En ligne', 'Online')
                          : t('Hors ligne', 'Offline')}
                      </span>
                    </li>
                    {metier && (
                      <li>
                        <span className="ch-meta-k">{t('Métier', 'Role')}</span>
                        <span className="ch-meta-v">{metier}</span>
                      </li>
                    )}
                    {poste.caste && (
                      <li>
                        <span className="ch-meta-k">{t('Caste', 'Caste')}</span>
                        <span className="ch-meta-v">{poste.caste}</span>
                      </li>
                    )}
                    <li>
                      <span className="ch-meta-k">{t('Hôte', 'Host')}</span>
                      <span className="ch-meta-v">{poste.node.ownerName}</span>
                    </li>
                    <li>
                      <span className="ch-meta-k">{t('Agent', 'Agent')}</span>
                      <span className="ch-meta-v">{poste.node.agentType}</span>
                    </li>
                    <li>
                      <span className="ch-meta-k">{t('En vol', 'In flight')}</span>
                      <span className="ch-meta-v">
                        {poste.node.running}/{poste.node.maxConcurrency}
                      </span>
                    </li>
                    {!titre && (
                      <li>
                        <span className="ch-meta-k">{t('Technique', 'Technical')}</span>
                        <span className="ch-meta-v">{poste.node.nameTechnique}</span>
                      </li>
                    )}
                  </ul>
                )}

                {onglet === 'travail' &&
                  (poste.presences.length > 0 ? (
                    <div className="ch-presences">
                      <h4>{t('Outils en cours (constatés)', 'Live tools (observed)')}</h4>
                      <ul>
                        {poste.presences.map((p) => (
                          <li key={p.toolUseId}>
                            <span className="ch-outil">{p.outil}</span>{' '}
                            <CheminConstate
                              chemin={p.chemin}
                              projectId={poste.projectId}
                              onNavigate={onNavigate}
                            />
                            <span className="ch-tache-time"> {timeShort(p.constateA)}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : (
                    <p className="ch-silence">
                      {t('Aucun fichier ouvert constaté.', 'No open file observed.')}
                    </p>
                  ))}

                {onglet === 'integrations' && (
                  <div className="ch-fabrique">
                    <h4>{t('Fabrique', 'Forge')}</h4>
                    {(poste.fabriques?.length ?? 0) === 0 ? (
                      <p className="ch-silence">
                        {t(
                          'Aucun outil en fabrique pour ce projet.',
                          'No forge tool for this project.',
                        )}
                      </p>
                    ) : (
                      <ul>
                        {poste.fabriques!.map((f) => (
                          <li key={f.id}>
                            <strong>{f.libelle}</strong>
                            <span className="ch-silence">
                              {' '}
                              · {f.genre} · {f.statut}
                              {f.nomScript ? ` · ${f.nomScript}` : ''}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                    <p className="ch-note">
                      {t(
                        'Chantiers ne lance qu’après merge + script déclaré.',
                        'Chantiers runs only after merge + declared script.',
                      )}
                    </p>
                    <h4>{t('Motifs', 'Motifs')}</h4>
                    {!poste.projectId ? (
                      <p className="ch-silence">
                        {t(
                          'Pas de projet — impossible d’appliquer un motif.',
                          'No project — cannot apply a motif.',
                        )}
                      </p>
                    ) : motifs.length === 0 ? (
                      <p className="ch-silence">{t('Catalogue vide.', 'Empty catalogue.')}</p>
                    ) : (
                      <ul className="ch-motifs">
                        {motifs.map((m) => (
                          <li key={m.id}>
                            <span>
                              {langCode === 'en' ? m.libelleEn : m.libelleFr}
                              <span className="ch-silence"> · {m.etapes.length} étapes</span>
                            </span>
                            <button
                              type="button"
                              className="btn ghost"
                              disabled={busyMotif === m.id}
                              onClick={() => {
                                if (!poste.projectId) return;
                                setBusyMotif(m.id);
                                void appliquerMotif(poste.projectId, m.id, { lang: langCode })
                                  .then(rafraichir)
                                  .finally(() => setBusyMotif(null));
                              }}
                            >
                              {t('Appliquer', 'Apply')}
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {onglet === 'suivi' && (
                  <div className="ch-horizon">
                    <h4>{t('Horizon', 'Horizon')}</h4>
                    {!poste.horizon ? (
                      <p className="ch-silence">
                        {t(
                          'Pas de projet rattaché — pas de carnet.',
                          'No linked project — no ledger.',
                        )}
                      </p>
                    ) : (
                      <>
                        <p className="ch-horizon-label">{t('Faits', 'Facts')}</p>
                        {poste.horizon.faits.length === 0 ? (
                          <p className="ch-silence">{t('Aucun fait.', 'No facts.')}</p>
                        ) : (
                          <ul>
                            {poste.horizon.faits.map((f) => (
                              <li key={f.id}>{f.texte}</li>
                            ))}
                          </ul>
                        )}
                        <p className="ch-horizon-label">{t('Hypothèses', 'Hypotheses')}</p>
                        {poste.horizon.hypotheses.length === 0 ? (
                          <p className="ch-silence">{t('Aucune hypothèse.', 'No hypotheses.')}</p>
                        ) : (
                          <ul className="ch-hypotheses">
                            {poste.horizon.hypotheses.map((h) => (
                              <li key={h.id}>{h.texte}</li>
                            ))}
                          </ul>
                        )}
                        {poste.projectId && (
                          <form
                            className="ch-horizon-form"
                            onSubmit={(ev) => {
                              ev.preventDefault();
                              const texte = brouillonHorizon.trim();
                              if (!texte || !poste.projectId) return;
                              setBusyHorizon(true);
                              void ajouterHorizon(poste.projectId, kindHorizon, texte)
                                .then(() => {
                                  setBrouillonHorizon('');
                                  rafraichir();
                                })
                                .finally(() => setBusyHorizon(false));
                            }}
                          >
                            <label className="ch-horizon-label" htmlFor="ch-horizon-kind">
                              {t('Ajouter', 'Add')}
                            </label>
                            <select
                              id="ch-horizon-kind"
                              value={kindHorizon}
                              onChange={(e) =>
                                setKindHorizon(
                                  e.target.value === 'hypothese' ? 'hypothese' : 'fait',
                                )
                              }
                            >
                              <option value="fait">{t('Fait', 'Fact')}</option>
                              <option value="hypothese">{t('Hypothèse', 'Hypothesis')}</option>
                            </select>
                            <input
                              type="text"
                              maxLength={500}
                              value={brouillonHorizon}
                              onChange={(e) => setBrouillonHorizon(e.target.value)}
                              placeholder={t('Constater…', 'Observe…')}
                            />
                            <button
                              type="submit"
                              className="btn primary ch-btn-accorder"
                              disabled={busyHorizon || !brouillonHorizon.trim()}
                            >
                              {t('Noter', 'Note')}
                            </button>
                          </form>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            </>
          ) : (
            <p className="ch-silence">{t('Chargement…', 'Loading…')}</p>
          )}
        </aside>

        <section className="ch-zone ch-journal" aria-label={t('Journal', 'Journal')}>
          <div className="ch-zone-head">
            <h3>{t('Journal', 'Journal')}</h3>
          </div>
          {poste && poste.presences.length > 0 && (
            <ul className="ch-timeline ch-stream" aria-live="polite">
              {poste.presences.map((p) => (
                <li key={`s-${p.toolUseId}`}>
                  <span className={badgeClass(p.outil)}>{p.outil.toUpperCase()}</span>
                  <span className="ch-log-body">
                    <CheminConstate
                      chemin={p.chemin}
                      projectId={poste.projectId}
                      onNavigate={onNavigate}
                      className="ch-log-resume"
                    />
                  </span>
                  <span className="ch-log-time">{timeShort(p.constateA)}</span>
                </li>
              ))}
            </ul>
          )}
          {journal.length === 0 && !(poste && poste.presences.length > 0) ? (
            <p className="ch-silence">
              {t('Pas encore de journal pour cette ouvrière.', 'No journal for this worker yet.')}
            </p>
          ) : journal.length > 0 ? (
            <ul className="ch-timeline">
              {journal.map((ev) => {
                const ligne = resumerEvenementChambre(
                  ev.type,
                  ev.payload as Record<string, unknown>,
                  langCode,
                );
                return (
                  <li key={ev.id}>
                    <span className={badgeClass(ligne.badge)}>{ligne.badge}</span>
                    <span className="ch-log-body">
                      <span className="ch-log-resume">{ligne.resume}</span>
                      {ligne.detail && <span className="ch-log-detail">{ligne.detail}</span>}
                    </span>
                    <span className="ch-log-time">{timeShort(ev.ts)}</span>
                  </li>
                );
              })}
            </ul>
          ) : null}
        </section>

        <section className="ch-zone ch-activite" aria-label={t('Missions', 'Missions')}>
          <div className="ch-zone-head">
            <h3>{t('Missions', 'Missions')}</h3>
          </div>
          <div
            className="ch-filtres"
            role="group"
            aria-label={t('Filtrer les missions', 'Filter missions')}
            data-testid="chambre-filtres-taches"
          >
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
                aria-pressed={filtre === id}
                className={filtre === id ? 'actif' : ''}
                onClick={() => setFiltre(id)}
              >
                {label}
              </button>
            ))}
          </div>
          {activite.length === 0 ? (
            <p className="ch-silence">{t('Rien dans ce filtre.', 'Nothing in this filter.')}</p>
          ) : (
            <ul className="ch-taches">
              {activite.slice(0, 24).map((tk) => {
                const pill = pillPour(tk.status);
                return (
                  <li key={tk.id}>
                    <button type="button" className="ch-tache" onClick={() => onOpenTask(tk.id)}>
                      {tk.title}
                    </button>
                    <span className={pill.className}>{pill.label}</span>
                    {filtre === 'echecs' && (
                      <span className="ch-echec-hint">
                        {t(
                          'quoi : échec · suite : ouvrir la tâche',
                          'what: failed · next: open task',
                        )}
                      </span>
                    )}
                    <span className="ch-tache-time">{timeShort(tk.updatedAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="ch-zone ch-ordi" aria-label={t('Ordinateur', 'Computer')}>
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
    return (
      <div className="ch-ordi-chrome">
        <div className="ch-ordi-top">
          <h3>{t('Ordinateur — noVNC', 'Computer — noVNC')}</h3>
        </div>
        <div className="ch-ordi-off">
          <p className="ch-silence">{t('État de l’atelier inconnu.', 'Computer state unknown.')}</p>
        </div>
      </div>
    );
  }

  if (!etat.actif) {
    return (
      <div className="ch-ordi-chrome">
        <div className="ch-ordi-top">
          <h3>{t('Ordinateur — noVNC', 'Computer — noVNC')}</h3>
        </div>
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
              className="btn primary ch-btn-accorder"
              disabled={busy}
              onClick={() => void agir(demarrerAtelier)}
            >
              {t('Allumer l’atelier', 'Start the computer')}
            </button>
          )}
          {etat.mode === 'off' && <p className="ch-silence">HIVE_ATELIER=off</p>}
        </div>
      </div>
    );
  }

  return (
    <div className="ch-ordi-chrome">
      <div className="ch-ordi-top">
        <h3>{t('Ordinateur — noVNC', 'Computer — noVNC')}</h3>
        <div className="ch-ordi-actions">
          <a className="btn ghost" href={etat.ecran} target="_blank" rel="noreferrer">
            {t('Plein écran', 'Fullscreen')}
          </a>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            onClick={() => void agir(arreterAtelier)}
          >
            {t('Éteindre', 'Stop')}
          </button>
        </div>
      </div>
      <div className="ch-ordi-on">
        <iframe
          className="ch-vnc"
          title={t('Écran de l’atelier', 'Computer screen')}
          src={etat.ecran}
          sandbox="allow-scripts allow-same-origin allow-forms"
        />
      </div>
      <div className="ch-ordi-foot">
        <span>{t('Connecté', 'Connected')}</span>
        <span>noVNC</span>
      </div>
    </div>
  );
}

/** Hexagone miel — marque Hive à côté du wordmark. */
function HexMiel() {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" aria-hidden="true">
      <path d="M12 2.2 20.2 7v10L12 21.8 3.8 17V7L12 2.2Z" fill="#F2B441" fillOpacity="0.95" />
      <path d="M12 6.2 16.8 9v6L12 17.8 7.2 15V9L12 6.2Z" fill="#1A1A1A" fillOpacity="0.88" />
    </svg>
  );
}

/**
 * Abeille décorative (maquette) — ornement de marque, pas un portrait.
 * Position : haut gauche du panneau identité.
 */
function AbeilleOrnement() {
  return (
    <svg
      className="ch-abeille"
      viewBox="0 0 64 48"
      width="52"
      height="40"
      fill="none"
      aria-hidden="true"
    >
      {/* ailes */}
      <ellipse cx="18" cy="18" rx="14" ry="9" fill="#F7F1E6" stroke="#C4A574" strokeWidth="1.2" />
      <ellipse cx="46" cy="18" rx="14" ry="9" fill="#F7F1E6" stroke="#C4A574" strokeWidth="1.2" />
      {/* corps */}
      <ellipse cx="32" cy="26" rx="11" ry="14" fill="#F2B441" />
      <path
        d="M24 18.5h16M23.5 24h17M24 29.5h16M25.5 35h13"
        stroke="#1A1A1A"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
      {/* tête */}
      <circle cx="32" cy="10" r="6.2" fill="#1A1A1A" />
      <circle cx="29.6" cy="9.2" r="1.1" fill="#F6C445" />
      <circle cx="34.4" cy="9.2" r="1.1" fill="#F6C445" />
      {/* antennes */}
      <path
        d="M28.5 5.2C26 2.4 23.2 2 21.5 3.2M35.5 5.2C38 2.4 40.8 2 42.5 3.2"
        stroke="#1A1A1A"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * Fleur botanique (ligne, teinte cire) — rappel « Capucine », pas une photo.
 * Position : haut droite du panneau identité.
 */
function FleurOrnement() {
  return (
    <svg
      className="ch-fleur"
      viewBox="0 0 120 140"
      width="88"
      height="102"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M62 132C58 104 54 78 48 52"
        stroke="#C4A574"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
      <path d="M50 86C38 78 28 82 22 90" stroke="#C4A574" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M54 68C66 58 78 62 86 72" stroke="#C4A574" strokeWidth="1.2" strokeLinecap="round" />
      {/* feuilles */}
      <path
        d="M50 86C40 72 28 70 22 78C30 86 42 90 50 86Z"
        stroke="#C4A574"
        strokeWidth="1.2"
        fill="#C4A574"
        fillOpacity="0.12"
      />
      <path
        d="M54 68C64 54 78 52 86 60C78 70 64 72 54 68Z"
        stroke="#C4A574"
        strokeWidth="1.2"
        fill="#C4A574"
        fillOpacity="0.1"
      />
      {/* corolle type capucine */}
      <path
        d="M48 52C40 40 42 28 52 22C58 30 60 40 56 50"
        stroke="#C4A574"
        strokeWidth="1.3"
        fill="#F2B441"
        fillOpacity="0.14"
      />
      <path
        d="M48 52C56 38 68 32 78 36C72 46 64 52 54 54"
        stroke="#C4A574"
        strokeWidth="1.3"
        fill="#F2B441"
        fillOpacity="0.18"
      />
      <path
        d="M48 52C36 48 30 36 34 26C44 28 50 38 50 48"
        stroke="#C4A574"
        strokeWidth="1.3"
        fill="#F2B441"
        fillOpacity="0.12"
      />
      <circle cx="48" cy="44" r="3.2" fill="#F2B441" fillOpacity="0.55" />
      {/* bouton secondaire */}
      <path
        d="M70 78C66 70 68 62 74 58C78 64 78 72 74 78"
        stroke="#C4A574"
        strokeWidth="1.1"
        fill="#F2B441"
        fillOpacity="0.1"
      />
    </svg>
  );
}
