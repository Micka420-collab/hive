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
  appliquerMotifPerso,
  arreterAtelier,
  assignerMetierOuvriere,
  baptiserOuvriere,
  creerMotifPerso,
  demarrerAtelier,
  fetchAtelier,
  fetchChambre,
  fetchMotifs,
  fetchMotifsPerso,
  fetchQueenCles,
  jugerFabriqueChantier,
  lancerChantier,
  ouvrirFabrique,
  poserQueenCle,
  poserStatutFabrique,
  repondreRequisition,
} from '../api';
import type {
  ChambrePoste,
  EtatAtelier,
  FournisseurCleApi,
  MotifCatalogue,
  MotifPerso,
} from '../api';
import { useLang, useT } from '../i18n';
import { demanderFocusFichier } from '../focus-vue';
import { libelleMetier, METIERS } from '../../../src/orchestrator/metier.js';
import type { MetierCycle } from '../../../src/orchestrator/metier.js';
import {
  libelleGenreRequisition,
  suiteAccordRequisition,
  type GenreRequisition,
} from '../../../src/orchestrator/requisition.js';
import {
  libelleGenreFabrique,
  libelleStatutFabrique,
  expliquerRefusFabrique,
} from '../../../src/orchestrator/fabrique.js';
import { resumerEvenementChambre } from '../../../src/orchestrator/chambre-journal.js';
import { nomEnvDepuisLibelle } from '../../../src/orchestrator/requisition-env.js';
import { timeShort } from './shared';
import type { ViewProps } from './shared';
import type { HiveEvent, Task, TaskStatus } from '../../../src/shared/types';
import { useDialog, Voile } from '../ui';
import type { RequisitionPoste } from '../api';

type OngletId = 'fiche' | 'travail' | 'integrations' | 'suivi';

function libelleCaste(caste: string, t: (fr: string, en: string) => string): string {
  if (caste === 'nourrice') return t('nourrice', 'nurse');
  if (caste === 'batisseuse') return t('bâtisseuse', 'builder');
  if (caste === 'butineuse') return t('butineuse', 'forager');
  return caste;
}

function classeStatutFabrique(statut: string): string {
  if (statut === 'proposee') return 'ch-fab-proposee';
  if (statut === 'en_revue') return 'ch-fab-revue';
  if (statut === 'mergee') return 'ch-fab-mergee';
  if (statut === 'refusee') return 'ch-fab-refusee';
  return 'ch-fab-inconnu';
}

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
  projectId: string | null | undefined;
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
        aria-label={t(`${chemin} — ouvrir dans le Rayon`, `${chemin} — open in Rayon`)}
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
  const [motifs, setMotifs] = useState<MotifCatalogue[] | null>(null);
  const [errMotifs, setErrMotifs] = useState<string | null>(null);
  const [busyMotif, setBusyMotif] = useState<string | null>(null);
  const [brouillonHorizon, setBrouillonHorizon] = useState('');
  const [kindHorizon, setKindHorizon] = useState<'fait' | 'hypothese'>('fait');
  const [busyHorizon, setBusyHorizon] = useState(false);
  const [busyReqId, setBusyReqId] = useState<string | null>(null);
  const [errHitl, setErrHitl] = useState<string | null>(null);
  const [statusHitl, setStatusHitl] = useState<string | null>(null);
  const [errMotif, setErrMotif] = useState<string | null>(null);
  const [statusMotif, setStatusMotif] = useState<string | null>(null);
  const [errHorizon, setErrHorizon] = useState<string | null>(null);
  const [statusHorizon, setStatusHorizon] = useState<string | null>(null);
  const [brouillonBapteme, setBrouillonBapteme] = useState('');
  const [busyBapteme, setBusyBapteme] = useState(false);
  const [errBapteme, setErrBapteme] = useState<string | null>(null);
  const [busyMetier, setBusyMetier] = useState(false);
  const [errMetier, setErrMetier] = useState<string | null>(null);
  const [grantReq, setGrantReq] = useState<RequisitionPoste | null>(null);
  const [grantSecret, setGrantSecret] = useState('');
  const [grantEnvVar, setGrantEnvVar] = useState('');
  const [fabGenre, setFabGenre] = useState('script_npm');
  const [fabLibelle, setFabLibelle] = useState('');
  const [fabNomScript, setFabNomScript] = useState('');
  const [busyFabrique, setBusyFabrique] = useState<string | null>(null);
  const [errFabrique, setErrFabrique] = useState<string | null>(null);
  const [statusFabrique, setStatusFabrique] = useState<string | null>(null);
  const [verdictFab, setVerdictFab] = useState<Record<string, { ok: boolean; text: string }>>({});
  const [motifsPerso, setMotifsPerso] = useState<MotifPerso[] | null>(null);
  const [persoLibelle, setPersoLibelle] = useState('');
  const [persoEtapes, setPersoEtapes] = useState('');
  const [busyPerso, setBusyPerso] = useState(false);
  const [motifConfirm, setMotifConfirm] = useState<MotifCatalogue | null>(null);
  const [motifExpandid, setMotifExpandid] = useState<string | null>(null);
  const [fournisseursCle, setFournisseursCle] = useState<FournisseurCleApi[] | null>(null);
  const [presenceCle, setPresenceCle] = useState<Record<string, boolean>>({});
  const [errCles, setErrCles] = useState<string | null>(null);
  const [statusCles, setStatusCles] = useState<string | null>(null);
  const [grantCatalogue, setGrantCatalogue] = useState<{
    libelle: string;
    envVar: string;
    hint: string;
  } | null>(null);
  const [busyCle, setBusyCle] = useState(false);

  const fermerGrant = () => {
    setGrantReq(null);
    setGrantCatalogue(null);
    setGrantSecret('');
    setGrantEnvVar('');
  };
  const grantDialogRef = useDialog<HTMLDivElement>(fermerGrant);
  const motifConfirmRef = useDialog<HTMLDivElement>(() => setMotifConfirm(null));

  const rafraichir = () => {
    if (!nodeId) return;
    void fetchChambre(nodeId)
      .then((p) => {
        setPoste(p);
        setErr(null);
      })
      .catch((e) => {
        // Un blip réseau ne doit pas vider un poste déjà constaté.
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
    setMotifs(null);
    setMotifsPerso(null);
    setErrMotifs(null);
    setFournisseursCle(null);
    setErrCles(null);
    void fetchMotifs()
      .then((r) => {
        setMotifs(r.motifs);
        setErrMotifs(null);
      })
      .catch((e) => {
        setMotifs([]);
        setErrMotifs(e instanceof Error ? e.message : String(e));
      });
    void fetchQueenCles()
      .then((r) => {
        setFournisseursCle(r.fournisseurs);
        const map: Record<string, boolean> = {};
        for (const p of r.presence) map[p.id] = p.presente;
        setPresenceCle(map);
        setErrCles(null);
      })
      .catch((e) => {
        setFournisseursCle([]);
        setErrCles(e instanceof Error ? e.message : String(e));
      });
    if (poste?.projectId) {
      void fetchMotifsPerso(poste.projectId)
        .then((r) => setMotifsPerso(r.motifs))
        .catch(() => setMotifsPerso([]));
    }
  }, [onglet, poste?.projectId]);

  // Onglets : colonne desktop, rangée sous 960px — aria-orientation suit le layout.
  const [ongletsHorizontaux, setOngletsHorizontaux] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(max-width: 960px)').matches,
  );
  useEffect(() => {
    const mq = window.matchMedia('(max-width: 960px)');
    const sync = () => setOngletsHorizontaux(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const onKey = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Ne pas voler Échap à un dialogue / tiroir modal ouvert.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
      // Ni à un champ en cours de saisie (horizon, etc.).
      const el = document.activeElement;
      if (el) {
        const tag = el.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          tag === 'IFRAME' ||
          (el as HTMLElement).isContentEditable
        ) {
          return;
        }
      }
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
            'Aucune ouvrière sélectionnée — ouvrez la Chambre depuis la fiche d’un nœud.',
            'No worker selected — open the Chambre from a node sheet.',
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
    if (b === 'edit') return 'ch-badge ch-badge-edit';
    if (b === 'write') return 'ch-badge ch-badge-write';
    if (b === 'fail' || b === 'échec') return 'ch-badge ch-badge-fail';
    return 'ch-badge';
  };

  const rayonAide =
    poste && poste.presences[0]
      ? t('Ouvrir le Rayon sur le fichier constaté', 'Open Rayon on the observed file')
      : t('Ouvrir le Rayon du projet', 'Open the project Rayon');

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
              title={rayonAide}
              aria-label={rayonAide}
              onClick={() => {
                const recent = [...poste.presences].sort((a, b) => b.constateA - a.constateA)[0];
                if (recent?.chemin) demanderFocusFichier(recent.chemin);
                onNavigate('rayon', poste.projectId!);
              }}
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

      {err && poste ? (
        <p className="ch-err-soft" role="status" data-testid="chambre-poll-soft">
          {t('Actualisation interrompue', 'Refresh interrupted')} · {err}
        </p>
      ) : null}

      {reqs.length > 0 && (
        <div className="ch-hitl" role="region" aria-label={t('À trancher', 'Needs a decision')}>
          <div className="ch-hitl-lead">
            <span className="ch-hitl-titre">{t('À trancher', 'Needs a decision')}</span>
            <span className="ch-hitl-sous">
              {t('Des décisions d’approbation sont en attente', 'Approval decisions are pending')} ·{' '}
              {reqs.length}
            </span>
          </div>
          {errHitl ? (
            <p className="ch-err-soft" role="status">
              {errHitl}
            </p>
          ) : null}
          {statusHitl ? (
            <p className="ch-status-soft" role="status" aria-live="polite">
              {statusHitl}
            </p>
          ) : null}
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
                    aria-label={t(`Accorder — ${r.libelle}`, `Grant — ${r.libelle}`)}
                    onClick={() => {
                      const genre = r.genre as GenreRequisition;
                      const suite = suiteAccordRequisition(genre);
                      if (suite.action === 'modal_cle') {
                        setGrantReq(r);
                        setGrantSecret('');
                        setGrantEnvVar(nomEnvDepuisLibelle(r.libelle));
                        return;
                      }
                      setBusyReqId(r.id);
                      setErrHitl(null);
                      setStatusHitl(null);
                      void repondreRequisition(r.id, 'accordee')
                        .then(async () => {
                          if (suite.action === 'atelier') {
                            try {
                              await demarrerAtelier();
                              setStatusHitl(
                                t('Accordée — atelier allumé', 'Granted — studio started'),
                              );
                            } catch (e) {
                              setStatusHitl(t('Accordée', 'Granted'));
                              setErrHitl(
                                e instanceof Error
                                  ? e.message
                                  : t(
                                      'Atelier non démarré (HIVE_ATELIER ?)',
                                      'Studio not started (HIVE_ATELIER?)',
                                    ),
                              );
                            }
                          } else if (suite.action === 'fabrique') {
                            if (!poste?.projectId) {
                              setStatusHitl(t('Accordée', 'Granted'));
                              setErrHitl(
                                t(
                                  'Pas de projet lié — ouvrez Intégrations pour proposer une fabrique.',
                                  'No linked project — open Integrations to propose a forge item.',
                                ),
                              );
                            } else {
                              try {
                                await ouvrirFabrique(poste.projectId, {
                                  genre: suite.genreFabrique,
                                  libelle: r.libelle,
                                  nodeId,
                                });
                                setOnglet('integrations');
                                setStatusHitl(
                                  t(
                                    'Accordée — fabrique proposée (Intégrations)',
                                    'Granted — forge proposal opened (Integrations)',
                                  ),
                                );
                              } catch (e) {
                                setStatusHitl(t('Accordée', 'Granted'));
                                setErrHitl(e instanceof Error ? e.message : String(e));
                              }
                            }
                          } else if (suite.action === 'hint_binaire') {
                            setStatusHitl(
                              t(
                                'Accordée — installez l’outil sur le poste (hive doctor / CLI), puis relancez le nœud.',
                                'Granted — install the tool on the host (hive doctor / CLI), then restart the node.',
                              ),
                            );
                          } else {
                            setStatusHitl(t('Accordée', 'Granted'));
                          }
                          rafraichir();
                        })
                        .catch((e) => {
                          setErrHitl(e instanceof Error ? e.message : String(e));
                        })
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
                    aria-label={t(`Refuser — ${r.libelle}`, `Deny — ${r.libelle}`)}
                    onClick={() => {
                      setBusyReqId(r.id);
                      setErrHitl(null);
                      setStatusHitl(null);
                      void repondreRequisition(r.id, 'refusee')
                        .then(() => {
                          setStatusHitl(t('Refusée', 'Denied'));
                          rafraichir();
                        })
                        .catch((e) => {
                          setErrHitl(e instanceof Error ? e.message : String(e));
                        })
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
                {poste.caste ? ` · ${libelleCaste(poste.caste, t)}` : ''}
              </p>

              <div
                className="ch-onglets"
                role="tablist"
                aria-label={t('Sections', 'Sections')}
                data-testid="chambre-sections"
                aria-orientation={ongletsHorizontaux ? 'horizontal' : 'vertical'}
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
                    ['suivi', t('Suivi', 'Follow-up')],
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
                  <>
                    <ul className="ch-meta">
                      <li>
                        <span className="ch-meta-k">{t('Statut', 'Status')}</span>
                        <span
                          className={`ch-meta-v ch-statut-dot${
                            poste.node.status === 'online' ? ' ch-statut-on' : ' ch-statut-off'
                          }`}
                        >
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
                          <span className="ch-meta-v">{libelleCaste(poste.caste, t)}</span>
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
                    {!titre && nodeId && (
                      <form
                        className="ch-bapteme-form"
                        onSubmit={(e) => {
                          e.preventDefault();
                          if (!brouillonBapteme.trim()) return;
                          setBusyBapteme(true);
                          setErrBapteme(null);
                          void baptiserOuvriere(nodeId, brouillonBapteme.trim())
                            .then(() => {
                              setBrouillonBapteme('');
                              rafraichir();
                            })
                            .catch((ex) => {
                              setErrBapteme(ex instanceof Error ? ex.message : String(ex));
                            })
                            .finally(() => setBusyBapteme(false));
                        }}
                      >
                        <label className="ch-bapteme-label">
                          {t('Baptiser cette ouvrière', 'Baptise this worker')}
                          <input
                            type="text"
                            value={brouillonBapteme}
                            maxLength={40}
                            placeholder={t('Prénom (Reine)', 'First name (Queen)')}
                            disabled={busyBapteme}
                            onChange={(ev) => setBrouillonBapteme(ev.target.value)}
                          />
                        </label>
                        <button
                          type="submit"
                          className="btn"
                          disabled={busyBapteme || !brouillonBapteme.trim()}
                        >
                          {busyBapteme ? '…' : t('Baptiser', 'Baptise')}
                        </button>
                        {errBapteme && <p className="ch-err">{errBapteme}</p>}
                      </form>
                    )}
                    {nodeId && (
                      <div className="ch-metier-form">
                        <span className="ch-meta-k">{t('Métier de cycle', 'Cycle role')}</span>
                        <div className="ch-metier-btns">
                          {METIERS.map((m) => (
                            <button
                              key={m}
                              type="button"
                              className={
                                poste?.metier?.metier === m
                                  ? 'btn actif ch-metier-btn'
                                  : 'btn ch-metier-btn'
                              }
                              disabled={busyMetier}
                              onClick={() => {
                                setBusyMetier(true);
                                setErrMetier(null);
                                void assignerMetierOuvriere(nodeId, m)
                                  .then(() => rafraichir())
                                  .catch((ex) => {
                                    setErrMetier(ex instanceof Error ? ex.message : String(ex));
                                  })
                                  .finally(() => setBusyMetier(false));
                              }}
                            >
                              {libelleMetier(m, langCode)}
                            </button>
                          ))}
                        </div>
                        {errMetier && <p className="ch-err">{errMetier}</p>}
                      </div>
                    )}
                  </>
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
                    <h4>{t('Clés API', 'API keys')}</h4>
                    <p className="ch-silence">
                      {t(
                        'OpenRouter, Anthropic, OpenAI… écrites dans le .env Queen (jamais en base).',
                        'OpenRouter, Anthropic, OpenAI… written to the Queen .env (never in the DB).',
                      )}
                    </p>
                    {errCles ? (
                      <p className="ch-err-soft" role="status">
                        {errCles}
                      </p>
                    ) : null}
                    {statusCles ? (
                      <p className="ch-status-soft" role="status" aria-live="polite">
                        {statusCles}
                      </p>
                    ) : null}
                    {fournisseursCle === null ? (
                      <p className="ch-silence">{t('Chargement…', 'Loading…')}</p>
                    ) : (
                      <ul className="ch-cles-list">
                        {fournisseursCle.map((f) => {
                          const libelle = langCode === 'en' ? f.libelleEn : f.libelleFr;
                          const hint = langCode === 'en' ? f.hintEn : f.hintFr;
                          const presente = Boolean(presenceCle[f.id]);
                          return (
                            <li key={f.id} className="ch-cle-ligne">
                              <span>
                                <strong>{libelle}</strong>
                                {f.envVar ? (
                                  <span className="ch-silence"> · {f.envVar}</span>
                                ) : null}
                                <span className="ch-silence"> — {hint}</span>
                                {presente ? (
                                  <span className="ch-cle-ok" title={t('Présente', 'Present')}>
                                    {' '}
                                    · {t('posée', 'set')}
                                  </span>
                                ) : null}
                              </span>
                              <button
                                type="button"
                                className="btn primary ch-btn-accorder"
                                onClick={() => {
                                  setGrantReq(null);
                                  setGrantCatalogue({
                                    libelle,
                                    envVar: f.envVar,
                                    hint,
                                  });
                                  setGrantEnvVar(f.envVar);
                                  setGrantSecret('');
                                  setStatusCles(null);
                                  setErrCles(null);
                                }}
                              >
                                {presente ? t('Remplacer', 'Replace') : t('Ajouter', 'Add')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}

                    <h4>{t('Fabrique', 'Forge')}</h4>
                    {poste.projectId ? (
                      <form
                        className="ch-fab-form"
                        onSubmit={(ev) => {
                          ev.preventDefault();
                          if (!poste.projectId || !fabLibelle.trim()) return;
                          setBusyFabrique('proposer');
                          setErrFabrique(null);
                          setStatusFabrique(null);
                          void ouvrirFabrique(poste.projectId, {
                            genre: fabGenre,
                            libelle: fabLibelle.trim(),
                            nomScript: fabNomScript.trim() || undefined,
                            nodeId,
                          })
                            .then(() => {
                              setFabLibelle('');
                              setFabNomScript('');
                              setStatusFabrique(t('Proposition ouverte', 'Proposal opened'));
                              rafraichir();
                            })
                            .catch((e) => {
                              setErrFabrique(e instanceof Error ? e.message : String(e));
                            })
                            .finally(() => setBusyFabrique(null));
                        }}
                      >
                        <label className="ch-fab-field">
                          <span>{t('Genre', 'Kind')}</span>
                          <select value={fabGenre} onChange={(e) => setFabGenre(e.target.value)}>
                            <option value="script_npm">script npm</option>
                            <option value="pont">pont</option>
                            <option value="mcp">MCP</option>
                          </select>
                        </label>
                        <label className="ch-fab-field">
                          <span>{t('Libellé', 'Label')}</span>
                          <input
                            value={fabLibelle}
                            onChange={(e) => setFabLibelle(e.target.value)}
                            maxLength={200}
                            required
                          />
                        </label>
                        <label className="ch-fab-field">
                          <span>{t('Script npm (optionnel)', 'npm script (optional)')}</span>
                          <input
                            value={fabNomScript}
                            onChange={(e) => setFabNomScript(e.target.value)}
                            maxLength={80}
                            placeholder="lint"
                          />
                        </label>
                        <button
                          type="submit"
                          className="btn primary"
                          disabled={busyFabrique === 'proposer'}
                        >
                          {busyFabrique === 'proposer' ? t('…', '…') : t('Proposer', 'Propose')}
                        </button>
                      </form>
                    ) : null}
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
                          <li key={f.id} className="ch-fab-ligne">
                            <strong>{f.libelle}</strong>
                            <span
                              className={`ch-fab-pill ${classeStatutFabrique(f.statut)}`}
                              title={f.statut}
                            >
                              {libelleStatutFabrique(f.statut, langCode)}
                            </span>
                            <span className="ch-silence">
                              {libelleGenreFabrique(f.genre, langCode)}
                              {f.nomScript ? ` · ${f.nomScript}` : ''}
                            </span>
                            {poste.projectId && f.statut === 'proposee' ? (
                              <span className="ch-req-actions">
                                <button
                                  type="button"
                                  className="btn ghost"
                                  disabled={busyFabrique === f.id}
                                  onClick={() => {
                                    setBusyFabrique(f.id);
                                    void poserStatutFabrique(poste.projectId!, f.id, 'en_revue')
                                      .then(() => rafraichir())
                                      .finally(() => setBusyFabrique(null));
                                  }}
                                >
                                  {t('Revue', 'Review')}
                                </button>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  disabled={busyFabrique === f.id}
                                  onClick={() => {
                                    setBusyFabrique(f.id);
                                    void poserStatutFabrique(poste.projectId!, f.id, 'refusee')
                                      .then(() => rafraichir())
                                      .finally(() => setBusyFabrique(null));
                                  }}
                                >
                                  {t('Refuser', 'Deny')}
                                </button>
                              </span>
                            ) : null}
                            {poste.projectId && f.statut === 'mergee' && f.nomScript ? (
                              <span className="ch-req-actions">
                                <button
                                  type="button"
                                  className="btn ghost"
                                  disabled={busyFabrique === `j-${f.id}`}
                                  onClick={() => {
                                    setBusyFabrique(`j-${f.id}`);
                                    void jugerFabriqueChantier(poste.projectId!, f.nomScript!)
                                      .then((v) => {
                                        setVerdictFab((prev) => ({
                                          ...prev,
                                          [f.id]: {
                                            ok: v.ok,
                                            text: v.ok
                                              ? t('Chantier autorisé', 'Chantier allowed')
                                              : expliquerRefusFabrique(
                                                  (v.motif ?? 'non_declare') as 'non_declare',
                                                  langCode,
                                                ),
                                          },
                                        }));
                                      })
                                      .finally(() => setBusyFabrique(null));
                                  }}
                                >
                                  {t('Juger Chantiers', 'Judge Chantiers')}
                                </button>
                                {verdictFab[f.id]?.ok ? (
                                  <button
                                    type="button"
                                    className="btn primary"
                                    disabled={busyFabrique === `l-${f.id}`}
                                    onClick={() => {
                                      setBusyFabrique(`l-${f.id}`);
                                      void lancerChantier(poste.projectId!, f.nomScript!)
                                        .then(() => {
                                          setStatusFabrique(
                                            t('Chantier lancé', 'Chantier started'),
                                          );
                                        })
                                        .catch((e) => {
                                          setErrFabrique(
                                            e instanceof Error ? e.message : String(e),
                                          );
                                        })
                                        .finally(() => setBusyFabrique(null));
                                    }}
                                  >
                                    {t('Lancer', 'Run')}
                                  </button>
                                ) : null}
                              </span>
                            ) : null}
                            {verdictFab[f.id] ? (
                              <p className="ch-status-soft">{verdictFab[f.id]!.text}</p>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    )}
                    {errFabrique ? (
                      <p className="ch-err-soft" role="status">
                        {errFabrique}
                      </p>
                    ) : null}
                    {statusFabrique ? (
                      <p className="ch-status-soft" role="status">
                        {statusFabrique}
                      </p>
                    ) : null}
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
                    ) : errMotifs ? (
                      <p className="ch-err-soft" role="status">
                        {t('Catalogue injoignable', 'Catalogue unreachable')}
                        {errMotifs ? ` · ${errMotifs}` : ''}
                      </p>
                    ) : motifs === null ? (
                      <p className="ch-silence">{t('Chargement…', 'Loading…')}</p>
                    ) : motifs.length === 0 ? (
                      <p className="ch-silence">{t('Catalogue vide.', 'Empty catalogue.')}</p>
                    ) : (
                      <ul className="ch-motifs">
                        {motifs.map((m) => {
                          const libelle = langCode === 'en' ? m.libelleEn : m.libelleFr;
                          const ouvert = motifExpandid === m.id;
                          return (
                            <li key={m.id}>
                              <span>
                                <button
                                  type="button"
                                  className="btn ghost ch-motif-toggle"
                                  aria-expanded={ouvert}
                                  onClick={() => setMotifExpandid(ouvert ? null : m.id)}
                                >
                                  {libelle}
                                  <span className="ch-silence">
                                    {' '}
                                    · {m.etapes.length} {t('étapes', 'steps')}
                                  </span>
                                </button>
                              </span>
                              {ouvert ? (
                                <ol className="ch-motif-etapes">
                                  {m.etapes.map((e) => (
                                    <li key={e.id}>{langCode === 'en' ? e.titreEn : e.titreFr}</li>
                                  ))}
                                </ol>
                              ) : null}
                              <button
                                type="button"
                                className="btn ghost"
                                disabled={busyMotif === m.id}
                                aria-busy={busyMotif === m.id}
                                aria-label={t(`Appliquer — ${libelle}`, `Apply — ${libelle}`)}
                                onClick={() => setMotifConfirm(m)}
                              >
                                {busyMotif === m.id ? t('…', '…') : t('Appliquer', 'Apply')}
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                    {poste.projectId ? (
                      <>
                        <h4>{t('Procédures perso', 'Custom procedures')}</h4>
                        <form
                          className="ch-motif-perso-form"
                          onSubmit={(ev) => {
                            ev.preventDefault();
                            if (!poste.projectId) return;
                            const etapes = persoEtapes
                              .split('\n')
                              .map((l) => l.trim())
                              .filter(Boolean);
                            setBusyPerso(true);
                            setErrMotif(null);
                            void creerMotifPerso(poste.projectId, {
                              libelle: persoLibelle.trim(),
                              etapes,
                            })
                              .then(() => {
                                setPersoLibelle('');
                                setPersoEtapes('');
                                setStatusMotif(t('Procédure enregistrée', 'Procedure saved'));
                                return fetchMotifsPerso(poste.projectId!);
                              })
                              .then((r) => setMotifsPerso(r.motifs))
                              .catch((e) => {
                                setErrMotif(e instanceof Error ? e.message : String(e));
                              })
                              .finally(() => setBusyPerso(false));
                          }}
                        >
                          <label className="ch-fab-field">
                            <span>{t('Libellé', 'Label')}</span>
                            <input
                              value={persoLibelle}
                              onChange={(e) => setPersoLibelle(e.target.value)}
                              maxLength={120}
                              required
                            />
                          </label>
                          <label className="ch-fab-field">
                            <span>{t('Étapes (une par ligne)', 'Steps (one per line)')}</span>
                            <textarea
                              value={persoEtapes}
                              onChange={(e) => setPersoEtapes(e.target.value)}
                              rows={4}
                              required
                            />
                          </label>
                          <button type="submit" className="btn primary" disabled={busyPerso}>
                            {busyPerso ? t('…', '…') : t('Créer', 'Create')}
                          </button>
                        </form>
                        {(motifsPerso?.length ?? 0) > 0 ? (
                          <ul className="ch-motifs">
                            {motifsPerso!.map((m) => (
                              <li key={m.id}>
                                <span>
                                  {m.libelle}
                                  <span className="ch-silence">
                                    {' '}
                                    · {m.etapes.length} {t('étapes', 'steps')}
                                  </span>
                                </span>
                                <button
                                  type="button"
                                  className="btn ghost"
                                  disabled={busyMotif === m.id}
                                  onClick={() => {
                                    if (!poste.projectId) return;
                                    setBusyMotif(m.id);
                                    void appliquerMotifPerso(poste.projectId, m.id)
                                      .then((r) => {
                                        setStatusMotif(
                                          t(
                                            `Procédure appliquée · ${r.taskIds.length} tâches`,
                                            `Procedure applied · ${r.taskIds.length} tasks`,
                                          ),
                                        );
                                        setFiltre('pause');
                                        rafraichir();
                                      })
                                      .catch((e) => {
                                        setErrMotif(e instanceof Error ? e.message : String(e));
                                      })
                                      .finally(() => setBusyMotif(null));
                                  }}
                                >
                                  {t('Appliquer', 'Apply')}
                                </button>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </>
                    ) : null}
                    {errMotif ? (
                      <p className="ch-err-soft" role="status">
                        {errMotif}
                      </p>
                    ) : null}
                    {statusMotif ? (
                      <p className="ch-status-soft" role="status" aria-live="polite">
                        {statusMotif}
                      </p>
                    ) : null}
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
                              <li key={f.id}>
                                <span>{f.texte}</span>
                                <span className="ch-silence">
                                  {' '}
                                  · {f.source} · {timeShort(f.creeA)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
                        <p className="ch-horizon-label">{t('Hypothèses', 'Hypotheses')}</p>
                        {poste.horizon.hypotheses.length === 0 ? (
                          <p className="ch-silence">{t('Aucune hypothèse.', 'No hypotheses.')}</p>
                        ) : (
                          <ul className="ch-hypotheses">
                            {poste.horizon.hypotheses.map((h) => (
                              <li key={h.id}>
                                <span>{h.texte}</span>
                                <span className="ch-silence">
                                  {' '}
                                  · {h.source} · {timeShort(h.creeA)}
                                </span>
                              </li>
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
                              setErrHorizon(null);
                              setStatusHorizon(null);
                              const kind = kindHorizon;
                              void ajouterHorizon(poste.projectId, kind, texte)
                                .then(() => {
                                  setBrouillonHorizon('');
                                  setStatusHorizon(
                                    kind === 'fait'
                                      ? t('Fait noté', 'Fact noted')
                                      : t('Hypothèse notée', 'Hypothesis noted'),
                                  );
                                  rafraichir();
                                  queueMicrotask(() => {
                                    document.getElementById('ch-horizon-texte')?.focus();
                                  });
                                })
                                .catch((e) => {
                                  setErrHorizon(e instanceof Error ? e.message : String(e));
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
                            <label className="ch-horizon-label" htmlFor="ch-horizon-texte">
                              {t('Texte', 'Text')}
                            </label>
                            <input
                              id="ch-horizon-texte"
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
                              aria-busy={busyHorizon}
                            >
                              {busyHorizon ? t('…', '…') : t('Noter', 'Note')}
                            </button>
                            {errHorizon ? (
                              <p className="ch-err-soft" role="status">
                                {errHorizon}
                              </p>
                            ) : null}
                            {statusHorizon ? (
                              <p className="ch-status-soft" role="status" aria-live="polite">
                                {statusHorizon}
                              </p>
                            ) : null}
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
            <ul className="ch-timeline ch-stream">
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
                      {['READ', 'EDIT', 'WRITE'].includes(ligne.badge) ? (
                        <CheminConstate
                          chemin={ligne.resume}
                          projectId={poste?.projectId ?? null}
                          onNavigate={onNavigate}
                          className="ch-log-resume"
                        />
                      ) : (
                        <span className="ch-log-resume">{ligne.resume}</span>
                      )}
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

      {grantReq || grantCatalogue ? (
        <Voile onClose={fermerGrant}>
          <div
            ref={grantDialogRef}
            className="ch-grant-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ch-grant-titre"
          >
            <h3 id="ch-grant-titre">
              {grantCatalogue
                ? t('Ajouter une clé API', 'Add an API key')
                : t('Accorder la clé', 'Grant the key')}
            </h3>
            <p className="ch-silence">{grantCatalogue?.libelle ?? grantReq!.libelle}</p>
            {grantCatalogue?.hint ? (
              <p className="ch-silence muted-text">{grantCatalogue.hint}</p>
            ) : null}
            <p className="ch-silence muted-text">
              {t(
                'Écrit sur la Queen (.env) — jamais en base ni sur le journal. Mono-machine : le nœud local recharge ce fichier à la reprise. Nœud distant / Cursor sur une autre machine : posez aussi la clé sur CE poste (CURSOR_API_KEY, etc.) — la Queen ne pousse pas de secrets aux ouvrières.',
                'Written on the Queen (.env) — never in the DB or journal. Single-machine: the local node reloads this file on resume. Remote node / Cursor on another machine: also set the key on THAT host (CURSOR_API_KEY, etc.) — the Queen never pushes secrets to workers.',
              )}
            </p>
            <label className="ch-grant-field">
              <span>{t('Variable .env Queen', 'Queen .env variable')}</span>
              <input
                type="text"
                value={grantEnvVar}
                onChange={(e) => {
                  // Réquisition HITL : le nom est dérivé du libellé (serveur
                  // refuse tout autre). Catalogue « Autre » : libre.
                  if (grantReq) return;
                  setGrantEnvVar(e.target.value);
                }}
                readOnly={Boolean(grantReq)}
                aria-readonly={grantReq ? true : undefined}
                autoComplete="off"
                spellCheck={false}
                placeholder={grantCatalogue && !grantCatalogue.envVar ? 'GROQ_API_KEY' : undefined}
              />
            </label>
            <p className="ch-silence muted-text">
              {grantReq
                ? t(
                    'Nom fixé par le libellé de la réquisition — non modifiable (évite d’écraser HIVE_*).',
                    'Name fixed by the requisition label — not editable (avoids overwriting HIVE_*).',
                  )
                : grantCatalogue && !grantCatalogue.envVar
                  ? t(
                      'Choisissez un nom UPPER_SNAKE (hors préfixe HIVE_).',
                      'Pick an UPPER_SNAKE name (not HIVE_*).',
                    )
                  : null}
            </p>
            <label className="ch-grant-field">
              <span>{t('Clé (secret)', 'Key (secret)')}</span>
              <input
                type="password"
                value={grantSecret}
                onChange={(e) => setGrantSecret(e.target.value)}
                autoComplete="off"
              />
            </label>
            <div className="ch-grant-actions">
              <button type="button" className="btn ghost" onClick={fermerGrant}>
                {t('Annuler', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={
                  busyCle ||
                  busyReqId === (grantReq?.id ?? '') ||
                  grantSecret.trim() === '' ||
                  grantEnvVar.trim() === ''
                }
                aria-busy={busyCle || busyReqId === (grantReq?.id ?? '')}
                onClick={() => {
                  const secret = grantSecret;
                  const envVar = grantEnvVar.trim();
                  if (grantCatalogue) {
                    setBusyCle(true);
                    setErrCles(null);
                    void poserQueenCle({
                      secret,
                      envVar,
                      libelle: grantCatalogue.libelle,
                    })
                      .then((r) => {
                        setStatusCles(t(`Clé posée · ${r.envVar}`, `Key saved · ${r.envVar}`));
                        fermerGrant();
                        void fetchQueenCles().then((res) => {
                          setFournisseursCle(res.fournisseurs);
                          const map: Record<string, boolean> = {};
                          for (const p of res.presence) map[p.id] = p.presente;
                          setPresenceCle(map);
                        });
                      })
                      .catch((e) => {
                        setErrCles(e instanceof Error ? e.message : String(e));
                      })
                      .finally(() => setBusyCle(false));
                    return;
                  }
                  if (!grantReq) return;
                  setBusyReqId(grantReq.id);
                  setErrHitl(null);
                  void repondreRequisition(grantReq.id, 'accordee', {
                    secret,
                    envVar: envVar || undefined,
                  })
                    .then(() => {
                      setStatusHitl(t('Accordée', 'Granted'));
                      fermerGrant();
                      rafraichir();
                    })
                    .catch((e) => {
                      setErrHitl(e instanceof Error ? e.message : String(e));
                    })
                    .finally(() => setBusyReqId(null));
                }}
              >
                {busyCle || busyReqId === (grantReq?.id ?? '')
                  ? t('…', '…')
                  : grantCatalogue
                    ? t('Enregistrer', 'Save')
                    : t('Accorder', 'Grant')}
              </button>
            </div>
          </div>
        </Voile>
      ) : null}

      {motifConfirm && poste?.projectId ? (
        <Voile onClose={() => setMotifConfirm(null)}>
          <div
            ref={motifConfirmRef}
            className="ch-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="ch-motif-confirm-titre"
          >
            <h3 id="ch-motif-confirm-titre">{t('Appliquer le motif ?', 'Apply motif?')}</h3>
            <p>
              {langCode === 'en' ? motifConfirm.libelleEn : motifConfirm.libelleFr}
              {' · '}
              {motifConfirm.etapes.length} {t('tâches chaînées', 'chained tasks')}
            </p>
            <ol className="ch-motif-etapes">
              {motifConfirm.etapes.map((e) => (
                <li key={e.id}>{langCode === 'en' ? e.titreEn : e.titreFr}</li>
              ))}
            </ol>
            <div className="ch-dialog-actions">
              <button type="button" className="btn ghost" onClick={() => setMotifConfirm(null)}>
                {t('Annuler', 'Cancel')}
              </button>
              <button
                type="button"
                className="btn primary"
                disabled={busyMotif === motifConfirm.id}
                onClick={() => {
                  const pid = poste.projectId!;
                  setBusyMotif(motifConfirm.id);
                  setErrMotif(null);
                  void appliquerMotif(pid, motifConfirm.id, { lang: langCode })
                    .then((r) => {
                      const n = r.taskIds?.length ?? 0;
                      setStatusMotif(
                        t(`Motif appliqué · ${n} tâches`, `Motif applied · ${n} tasks`),
                      );
                      setMotifConfirm(null);
                      setFiltre('pause');
                      rafraichir();
                    })
                    .catch((e) => {
                      setErrMotif(e instanceof Error ? e.message : String(e));
                    })
                    .finally(() => setBusyMotif(null));
                }}
              >
                {t('Confirmer', 'Confirm')}
              </button>
            </div>
          </div>
        </Voile>
      ) : null}
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
  const [errAtelier, setErrAtelier] = useState<string | null>(null);

  const agir = async (fn: () => Promise<unknown>) => {
    onBusy(true);
    setErrAtelier(null);
    try {
      await fn();
      onChange(await fetchAtelier());
    } catch (e) {
      setErrAtelier(e instanceof Error ? e.message : String(e));
      try {
        onChange(await fetchAtelier());
      } catch {
        /* état inconnu — le message d'erreur suffit */
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
              aria-busy={busy}
              onClick={() => void agir(demarrerAtelier)}
            >
              {busy ? t('…', '…') : t('Allumer l’atelier', 'Start the computer')}
            </button>
          )}
          {etat.mode === 'off' && (
            <p className="ch-silence">
              {t('Atelier désactivé (HIVE_ATELIER=off)', 'Studio disabled (HIVE_ATELIER=off)')}
            </p>
          )}
          {errAtelier ? (
            <p className="ch-err-soft" role="status">
              {errAtelier}
            </p>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="ch-ordi-chrome">
      <div className="ch-ordi-top">
        <h3>{t('Ordinateur — noVNC', 'Computer — noVNC')}</h3>
        <div className="ch-ordi-actions">
          <a
            className="btn ghost"
            href={etat.ecran}
            target="_blank"
            rel="noreferrer"
            aria-label={t('Plein écran — atelier', 'Fullscreen — computer')}
          >
            {t('Plein écran', 'Fullscreen')}
          </a>
          <button
            type="button"
            className="btn ghost"
            disabled={busy}
            aria-busy={busy}
            aria-label={t('Éteindre l’atelier', 'Stop the computer')}
            onClick={() => void agir(arreterAtelier)}
          >
            {busy ? t('…', '…') : t('Éteindre', 'Stop')}
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
        {errAtelier ? (
          <span className="ch-err-soft" role="status">
            {errAtelier}
          </span>
        ) : null}
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
