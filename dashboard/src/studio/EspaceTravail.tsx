// L'espace de travail de l'accueil : conversation, plan, fichiers, résultats — et le code.
//
// ─── DEUX PANNEAUX, REDIMENSIONNABLES ────────────────────────────────────────
//
// À gauche, ce que fait la mission ; à droite, ce qu'elle touche : le fichier
// choisi dans « Fichiers » (lu dans Le Rayon), ou la production choisie dans
// « Résultats » (son diff, ses journaux). La séparation se tire à la souris,
// au doigt ou aux flèches du clavier, et se retient. Chaque panneau peut
// prendre toute la place, et la rendre.
//
// Rien n'est inventé : un projet sans dépôt n'a pas de fichiers, une tâche
// sans production n'a pas de diff, et l'écran le dit.

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent as KeyboardEventReact, PointerEvent as PointerEventReact } from 'react';
import { fetchFichierRayon, fetchRayon, fetchResults, postReview } from '../api';
import type { EntreeRayon } from '../api';
import type { CodeLang } from '../CodeEditor';
import { useLang, useT } from '../i18n';
import type { Translate } from '../i18n';
import { formatDuree, statusLabel } from '../ui';
import { getReview, setReview, timeShort } from '../views/shared';
import type { HiveNode, Project, Task, TaskResult } from '../../../src/shared/types';
import type { Conversation } from './conversation';
import { Icone } from './Icone';
import type { NomIcone } from './Icone';
import type { MissionAffichee } from './mission-courante';
import { CLES, ecrire, lirePartage, usePreference } from './preferences';

const CodeEditor = lazy(() => import('../CodeEditor'));

export type Onglet = 'conversation' | 'plan' | 'fichiers' | 'resultats';
const ONGLETS: readonly Onglet[] = ['conversation', 'plan', 'fichiers', 'resultats'];

export function lireOnglet(v: string | null): Onglet {
  return ONGLETS.includes(v as Onglet) ? (v as Onglet) : 'conversation';
}

/** Ce que le panneau de code affiche. */
export type Affichage =
  | {
      genre: 'fichier';
      chemin: string;
      contenu: string;
      langage: string;
      tronque: boolean;
      taille: number;
    }
  | { genre: 'diff' | 'journaux'; tacheId: string; titre: string; contenu: string };

interface Props {
  projet: Project | null;
  mission: MissionAffichee;
  brief: string | null;
  noeuds: readonly HiveNode[];
  conversation: Conversation;
  onglet: Onglet;
  onOnglet: (o: Onglet) => void;
  onOuvrirTache: (id: string) => void;
  /** Change à chaque événement de revue : relit les verdicts affichés. */
  reviewTick: number;
}

export function EspaceTravail(p: Props) {
  const t = useT();
  const partage = usePreference(CLES.partage, lirePartage);
  const [agrandi, setAgrandi] = useState<'gauche' | 'droite' | null>(null);
  const [affichage, setAffichage] = useState<Affichage | null>(null);
  const zone = useRef<HTMLDivElement>(null);
  const glisse = useRef(false);

  // Un autre projet : ce que montrait le panneau de code ne lui appartient pas.
  useEffect(() => setAffichage(null), [p.projet?.id]);

  const regler = useCallback((ratio: number) => {
    ecrire(CLES.partage, String(Math.min(0.7, Math.max(0.3, ratio))));
  }, []);

  const surPointeur = (e: PointerEventReact<HTMLDivElement>) => {
    if (!glisse.current || !zone.current) return;
    const r = zone.current.getBoundingClientRect();
    regler((e.clientX - r.left) / r.width);
  };

  const surClavierSeparateur = (e: KeyboardEventReact<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') regler(partage - 0.05);
    else if (e.key === 'ArrowRight') regler(partage + 0.05);
    else if (e.key === 'Home') regler(0.3);
    else if (e.key === 'End') regler(0.7);
    else return;
    e.preventDefault();
  };

  const montrer = (a: Affichage) => {
    setAffichage(a);
    if (agrandi === 'gauche') setAgrandi(null);
  };

  return (
    <div
      ref={zone}
      className={`hs-espace${agrandi ? ` agrandi-${agrandi}` : ''}`}
      style={{ ['--hs-partage' as string]: `${Math.round(partage * 1000) / 10}%` }}
      onPointerMove={surPointeur}
      onPointerUp={() => (glisse.current = false)}
      onPointerLeave={() => (glisse.current = false)}
    >
      <section
        className="hs-panneau gauche"
        aria-label={t('Suivi de la mission', 'Mission follow-up')}
      >
        <div
          className="hs-onglets"
          role="tablist"
          aria-label={t('Vues de la mission', 'Mission views')}
        >
          {ONGLETS.map((o) => (
            <button
              key={o}
              role="tab"
              id={`hs-onglet-${o}`}
              aria-selected={p.onglet === o}
              aria-controls={`hs-volet-${o}`}
              tabIndex={p.onglet === o ? 0 : -1}
              className={p.onglet === o ? 'actif' : undefined}
              onClick={() => p.onOnglet(o)}
              onKeyDown={(e) => {
                const i = ONGLETS.indexOf(o);
                const suivant =
                  e.key === 'ArrowRight'
                    ? ONGLETS[(i + 1) % ONGLETS.length]
                    : e.key === 'ArrowLeft'
                      ? ONGLETS[(i + ONGLETS.length - 1) % ONGLETS.length]
                      : null;
                if (!suivant) return;
                e.preventDefault();
                p.onOnglet(suivant);
                document.getElementById(`hs-onglet-${suivant}`)?.focus();
              }}
            >
              <Icone nom={ICONE_ONGLET[o]} taille={16} />
              {nomOnglet(o, t)}
              {o === 'resultats' && compterAValider(p.mission.taches) > 0 && (
                <span className="hs-nombre" aria-label={t('à valider', 'to review')}>
                  {compterAValider(p.mission.taches)}
                </span>
              )}
            </button>
          ))}
          <span className="hs-onglets-espace" />
          <button
            type="button"
            className="hs-icone-btn"
            onClick={() => setAgrandi((a) => (a === 'gauche' ? null : 'gauche'))}
            aria-pressed={agrandi === 'gauche'}
            aria-label={
              agrandi === 'gauche'
                ? t('Réduire le panneau', 'Restore panel')
                : t('Agrandir le panneau', 'Maximise panel')
            }
          >
            <Icone nom={agrandi === 'gauche' ? 'reduire' : 'agrandir'} taille={16} />
          </button>
        </div>
        <div
          className="hs-volet"
          role="tabpanel"
          id={`hs-volet-${p.onglet}`}
          aria-labelledby={`hs-onglet-${p.onglet}`}
          tabIndex={0}
        >
          {p.onglet === 'conversation' && <VoletConversation {...p} onMontrer={montrer} />}
          {p.onglet === 'plan' && <VoletPlan {...p} />}
          {p.onglet === 'fichiers' && <VoletFichiers projet={p.projet} onMontrer={montrer} />}
          {p.onglet === 'resultats' && <VoletResultats {...p} onMontrer={montrer} />}
        </div>
      </section>

      <div
        className="hs-separateur"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('Redimensionner les panneaux', 'Resize panels')}
        aria-valuemin={30}
        aria-valuemax={70}
        aria-valuenow={Math.round(partage * 100)}
        tabIndex={0}
        onPointerDown={(e) => {
          glisse.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerUp={(e) => {
          glisse.current = false;
          e.currentTarget.releasePointerCapture(e.pointerId);
        }}
        onPointerMove={surPointeur}
        onKeyDown={surClavierSeparateur}
        onDoubleClick={() => regler(0.5)}
      />

      <PanneauCode
        affichage={affichage}
        agrandi={agrandi === 'droite'}
        onAgrandir={() => setAgrandi((a) => (a === 'droite' ? null : 'droite'))}
        onFermer={() => setAffichage(null)}
      />
    </div>
  );
}

const ICONE_ONGLET: Record<Onglet, NomIcone> = {
  conversation: 'bulle',
  plan: 'plan',
  fichiers: 'fichier',
  resultats: 'resultats',
};

function nomOnglet(o: Onglet, t: Translate): string {
  switch (o) {
    case 'conversation':
      return t('Conversation', 'Conversation');
    case 'plan':
      return t('Plan', 'Plan');
    case 'fichiers':
      return t('Fichiers', 'Files');
    case 'resultats':
      return t('Résultats', 'Results');
  }
}

function compterAValider(taches: readonly Task[]): number {
  return taches.filter((x) => x.status === 'done' && getReview(x.id) === null).length;
}

// ─── Conversation ────────────────────────────────────────────────────────────

const TON_TACHE: Record<Task['status'], 'ok' | 'encours' | 'attente' | 'echec'> = {
  done: 'ok',
  running: 'encours',
  assigned: 'encours',
  ready: 'attente',
  pending: 'attente',
  failed: 'echec',
};

function ChipStatut({ tache }: { tache: Task }) {
  const lang = useLang();
  return (
    <span className={`hs-chip ton-${TON_TACHE[tache.status]}`}>
      {statusLabel(tache.status, lang)}
    </span>
  );
}

function resumeHive(m: MissionAffichee, t: Translate): string {
  const c = m.compte;
  if (m.etat === 'terminee') {
    return c.echouees > 0
      ? t(
          `Mission terminée : ${c.faites}/${c.total} tâches réussies, ${c.echouees} en échec.`,
          `Mission ended: ${c.faites}/${c.total} tasks succeeded, ${c.echouees} failed.`,
        )
      : t(
          `Mission terminée : les ${c.total} tâches sont faites.`,
          `Mission completed: all ${c.total} tasks done.`,
        );
  }
  if (c.enCours > 0)
    return t(
      `La mission avance : ${c.faites}/${c.total} tâches terminées.`,
      `The mission is moving: ${c.faites}/${c.total} tasks done.`,
    );
  if (m.statut === 'attente_agent')
    return t(
      `Plan de ${c.total} tâches prêt — il attend qu’un agent se connecte.`,
      `${c.total}-task plan ready — waiting for an agent to connect.`,
    );
  return t(`Plan de ${c.total} tâches en file.`, `${c.total}-task plan queued.`);
}

function VoletConversation(p: Props & { onMontrer: (a: Affichage) => void }) {
  const t = useT();
  const [texte, setTexte] = useState('');
  const fin = useRef<HTMLDivElement>(null);
  const { conversation: c, mission: m } = p;

  useEffect(() => {
    fin.current?.scrollIntoView({ block: 'end' });
  }, [c.messages.length, c.enCours]);

  const aValider = m.taches.filter((x) => x.status === 'done' && getReview(x.id) === null);
  const echecs = m.taches.filter((x) => x.status === 'failed');

  return (
    <div className="hs-conversation">
      <div className="hs-fil" aria-live="polite">
        {m.etat === 'aucune' && c.messages.length === 0 && (
          <p className="hs-vide">
            {t(
              'Rien ici pour l’instant. Lance une mission ou pose une question à la Reine : le fil se remplit avec ce que font réellement tes agents.',
              'Nothing here yet. Launch a mission or ask the Queen: this thread fills with what your agents actually do.',
            )}
          </p>
        )}
        {p.brief && m.etat !== 'aucune' && (
          <article className="hs-message moi">
            <header>
              <span className="hs-auteur">{t('Toi', 'You')}</span>
              {m.ouverteA !== null && <time>{timeShort(m.ouverteA)}</time>}
            </header>
            <p>{p.brief}</p>
          </article>
        )}
        {m.etat !== 'aucune' && (
          <article className="hs-message hive">
            <header>
              <span className="hs-avatar-hive" aria-hidden="true">
                <Icone nom="ruche" taille={14} />
              </span>
              <span className="hs-auteur">Hive</span>
            </header>
            <p>{resumeHive(m, t)}</p>
            <ul className="hs-checklist">
              {m.taches.map((x) => (
                <li key={x.id}>
                  <span className={`hs-coche ton-${TON_TACHE[x.status]}`} aria-hidden="true">
                    <Icone
                      nom={
                        x.status === 'done' ? 'coche' : x.status === 'failed' ? 'croix' : 'horloge'
                      }
                      taille={12}
                    />
                  </span>
                  <button type="button" className="hs-lien" onClick={() => p.onOuvrirTache(x.id)}>
                    {x.title}
                  </button>
                  <ChipStatut tache={x} />
                </li>
              ))}
            </ul>
            {aValider.map((x) => (
              <CarteDecision
                key={x.id}
                tache={x}
                onMontrer={p.onMontrer}
                reviewTick={p.reviewTick}
              />
            ))}
            {echecs.length > 0 && (
              <div className="hs-carte-fil echec">
                <Icone nom="avertissement" taille={18} />
                <div>
                  <strong>
                    {t(`${echecs.length} tâche(s) en échec`, `${echecs.length} failed task(s)`)}
                  </strong>
                  <p className="hs-discret">
                    {t(
                      'Ouvre la tâche pour lire la raison et la relancer.',
                      'Open the task to read why and retry it.',
                    )}
                  </p>
                </div>
                <button
                  type="button"
                  className="hs-btn petit"
                  onClick={() => p.onOuvrirTache(echecs[0]!.id)}
                >
                  {t('Ouvrir', 'Open')}
                </button>
              </div>
            )}
          </article>
        )}
        {c.messages.map((msg) => (
          <article key={msg.id} className={`hs-message ${msg.role === 'moi' ? 'moi' : 'hive'}`}>
            <header>
              {msg.role === 'reine' && (
                <span className="hs-avatar-hive" aria-hidden="true">
                  <Icone nom="ruche" taille={14} />
                </span>
              )}
              <span className="hs-auteur">
                {msg.role === 'moi' ? t('Toi', 'You') : t('Reine', 'Queen')}
              </span>
              <time>{timeShort(msg.ts)}</time>
              {msg.source === 'live' && (
                <span
                  className="hs-chip ton-attente"
                  title={t(
                    'Réponse composée par la ruche sans modèle de langage',
                    'Answer composed by the hive without a language model',
                  )}
                >
                  {t('sans IA', 'no AI')}
                </span>
              )}
            </header>
            <p>{msg.texte}</p>
          </article>
        ))}
        {c.enCours && (
          <p className="hs-discret">
            <span className="hs-rouet" aria-hidden="true" />{' '}
            {t('La Reine réfléchit…', 'The Queen is thinking…')}
          </p>
        )}
        {c.erreur && (
          <p className="hs-alerte erreur" role="alert">
            {c.indisponible
              ? t(
                  'Cette Reine ne propose pas encore la conversation (/api/chat).',
                  'This Queen does not offer chat yet (/api/chat).',
                )
              : c.erreur}
          </p>
        )}
        <div ref={fin} />
      </div>
      <form
        className="hs-repondre"
        onSubmit={(e) => {
          e.preventDefault();
          const q = texte.trim();
          if (!q) return;
          setTexte('');
          void c.envoyer(q);
        }}
      >
        <label htmlFor="hs-repondre" className="hs-visuellement-cache">
          {t('Répondre à Hive', 'Reply to Hive')}
        </label>
        <input
          id="hs-repondre"
          type="text"
          value={texte}
          maxLength={4000}
          placeholder={t('Répondre à Hive…', 'Reply to Hive…')}
          onChange={(e) => setTexte(e.target.value)}
          disabled={c.indisponible}
        />
        <button
          type="submit"
          className="hs-envoyer petit"
          disabled={texte.trim() === '' || c.enCours || c.indisponible}
          aria-label={t('Envoyer', 'Send')}
        >
          <Icone nom="envoyer" taille={18} />
        </button>
      </form>
    </div>
  );
}

/**
 * Le verdict d'une production : le geste est celui de la Miellerie (POST de la
 * revue, puis le cache local), partagé par la carte de la conversation et par
 * la liste des résultats.
 */
function useVerdict(tacheId: string) {
  const [etat, setEtat] = useState<'repos' | 'envoi' | 'erreur'>('repos');
  const [erreur, setErreur] = useState<string | null>(null);
  const trancher = (verdict: 'approved' | 'rejected') => {
    setEtat('envoi');
    setErreur(null);
    postReview(tacheId, verdict)
      .then(() => {
        setReview(tacheId, verdict);
        setEtat('repos');
      })
      .catch((e: unknown) => {
        setEtat('erreur');
        setErreur(e instanceof Error ? e.message : String(e));
      });
  };
  return { etat, erreur, trancher };
}

/** Refuser / Approuver, et l'erreur du dernier envoi s'il y en a une. */
function BoutonsVerdict({ v }: { v: ReturnType<typeof useVerdict> }) {
  const t = useT();
  return (
    <>
      <button
        type="button"
        className="hs-btn petit fantome"
        disabled={v.etat === 'envoi'}
        onClick={() => v.trancher('rejected')}
      >
        {t('Refuser', 'Reject')}
      </button>
      <button
        type="button"
        className="hs-btn petit primaire"
        disabled={v.etat === 'envoi'}
        onClick={() => v.trancher('approved')}
      >
        {t('Approuver', 'Approve')}
      </button>
    </>
  );
}

/** Une production qui attend un verdict humain — le geste est celui de la Miellerie. */
function CarteDecision({
  tache,
  onMontrer,
  reviewTick,
}: {
  tache: Task;
  onMontrer: (a: Affichage) => void;
  reviewTick: number;
}) {
  const t = useT();
  const v = useVerdict(tache.id);
  void reviewTick;

  return (
    <div className="hs-carte-fil decision">
      <Icone nom="coche" taille={18} />
      <div>
        <strong>
          {t(`« ${tache.title} » attend ta validation`, `“${tache.title}” awaits your review`)}
        </strong>
        <p className="hs-discret">
          {t(
            'Relis le diff avant de décider. Rien n’est fusionné sans toi.',
            'Read the diff before deciding. Nothing is merged without you.',
          )}
        </p>
        {v.erreur && (
          <p className="hs-alerte erreur" role="alert">
            {v.erreur}
          </p>
        )}
      </div>
      <div className="hs-carte-actions">
        <BoutonDiff tache={tache} onMontrer={onMontrer} />
        <BoutonsVerdict v={v} />
      </div>
    </div>
  );
}

/**
 * Une ligne de la liste des résultats. Une production qui attend un verdict le
 * reçoit SUR PLACE : on y lit le diff, et c'est là qu'on veut trancher —
 * l'E2E réel cherchait « Approuver » dans les résultats et ne l'y trouvait pas.
 */
function LigneResultat({
  x,
  onOuvrirTache,
  onMontrer,
}: {
  x: Task;
  onOuvrirTache: (id: string) => void;
  onMontrer: (a: Affichage) => void;
}) {
  const t = useT();
  const v = useVerdict(x.id);
  const verdict = getReview(x.id);
  const attend = x.status === 'done' && verdict === null;
  return (
    <li className={`ton-${TON_TACHE[x.status]}`}>
      <div className="hs-resultat-tete">
        <button type="button" className="hs-lien fort" onClick={() => onOuvrirTache(x.id)}>
          {x.title}
        </button>
        <ChipStatut tache={x} />
        {verdict && (
          <span className={`hs-chip ton-${verdict === 'approved' ? 'ok' : 'echec'}`}>
            {verdict === 'approved' ? t('Validée', 'Approved') : t('Refusée', 'Rejected')}
          </span>
        )}
      </div>
      <p className="hs-discret">
        {x.result
          ? `${formatDuree(x.result.durationMs)} · ${x.result.success ? t('réussie', 'succeeded') : t('échouée', 'failed')}`
          : t('sans production rangée', 'no stored production')}
      </p>
      {v.erreur && (
        <p className="hs-alerte erreur" role="alert">
          {v.erreur}
        </p>
      )}
      <div className="hs-carte-actions">
        <BoutonDiff tache={x} onMontrer={onMontrer} />
        <BoutonDiff tache={x} onMontrer={onMontrer} genre="journaux" />
        {attend && <BoutonsVerdict v={v} />}
      </div>
    </li>
  );
}

function BoutonDiff({
  tache,
  onMontrer,
  genre = 'diff',
}: {
  tache: Task;
  onMontrer: (a: Affichage) => void;
  genre?: 'diff' | 'journaux';
}) {
  const t = useT();
  const [charge, setCharge] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const voir = () => {
    setCharge(true);
    setErreur(null);
    fetchResults(tache.id)
      .then((r) => {
        const dernier: TaskResult | undefined = r[r.length - 1];
        if (!dernier) {
          setErreur(
            t('Aucune production rangée pour cette tâche.', 'No stored production for this task.'),
          );
          return;
        }
        onMontrer({
          genre,
          tacheId: tache.id,
          titre: tache.title,
          contenu:
            genre === 'diff'
              ? dernier.diff ||
                t(
                  '(diff vide : la tâche n’a modifié aucun fichier)',
                  '(empty diff: the task changed no file)',
                )
              : [dernier.finalText ? `${dernier.finalText}\n\n────────\n` : '', dernier.logs].join(
                  '',
                ),
        });
      })
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setCharge(false));
  };
  return (
    <>
      <button type="button" className="hs-btn petit" onClick={voir} disabled={charge}>
        <Icone nom={genre === 'diff' ? 'diff' : 'code'} taille={14} />
        {genre === 'diff' ? t('Diff', 'Diff') : t('Journaux', 'Logs')}
      </button>
      {erreur && (
        <span className="hs-alerte erreur petit" role="alert">
          {erreur}
        </span>
      )}
    </>
  );
}

// ─── Plan ────────────────────────────────────────────────────────────────────

function VoletPlan(p: Props) {
  const t = useT();
  const noeuds = useMemo(() => new Map(p.noeuds.map((n) => [n.id, n])), [p.noeuds]);
  const rang = useMemo(
    () => new Map(p.mission.taches.map((x, i) => [x.id, i + 1])),
    [p.mission.taches],
  );
  if (p.mission.taches.length === 0) {
    return (
      <p className="hs-vide">
        {t(
          'Pas de plan : aucune mission en cours sur ce projet.',
          'No plan: no mission running on this project.',
        )}
      </p>
    );
  }
  return (
    <ol className="hs-plan">
      {p.mission.taches.map((x) => {
        const n = x.assignedNodeId ? noeuds.get(x.assignedNodeId) : undefined;
        return (
          <li key={x.id} className={`ton-${TON_TACHE[x.status]}`}>
            <span className="hs-rang">{rang.get(x.id)}</span>
            <div className="hs-plan-corps">
              <button type="button" className="hs-lien fort" onClick={() => p.onOuvrirTache(x.id)}>
                {x.title}
              </button>
              <span className="hs-discret">
                {n ? `${n.name} · ${n.agentType}` : t('pas encore confiée', 'not assigned yet')}
                {x.dependsOn.length > 0 &&
                  ` · ${t('après', 'after')} ${x.dependsOn.map((d) => `#${rang.get(d) ?? '?'}`).join(', ')}`}
                {x.attempts > 1 && ` · ${t(`${x.attempts} tentatives`, `${x.attempts} attempts`)}`}
                {x.result && ` · ${formatDuree(x.result.durationMs)}`}
              </span>
            </div>
            <ChipStatut tache={x} />
          </li>
        );
      })}
    </ol>
  );
}

// ─── Fichiers (Le Rayon) ─────────────────────────────────────────────────────

function VoletFichiers({
  projet,
  onMontrer,
}: {
  projet: Project | null;
  onMontrer: (a: Affichage) => void;
}) {
  const t = useT();
  const [chemin, setChemin] = useState('');
  const [entrees, setEntrees] = useState<EntreeRayon[] | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [ouvert, setOuvert] = useState<string | null>(null);

  useEffect(() => setChemin(''), [projet?.id]);

  useEffect(() => {
    if (!projet || !projet.repoUrl) return;
    let vivant = true;
    setEntrees(null);
    setErreur(null);
    fetchRayon(projet.id, chemin)
      .then((r) => vivant && setEntrees(r.entrees))
      .catch((e: unknown) => vivant && setErreur(e instanceof Error ? e.message : String(e)));
    return () => {
      vivant = false;
    };
  }, [projet, chemin]);

  if (!projet)
    return <p className="hs-vide">{t('Aucun projet choisi.', 'No project selected.')}</p>;
  if (!projet.repoUrl) {
    return (
      <p className="hs-vide">
        {t(
          'Ce projet n’a pas de dépôt : ses fichiers n’existent nulle part où Hive puisse les lire. Ajoute un dépôt depuis la page Projets.',
          'This project has no repository: there is nowhere Hive could read its files from. Add a repository from the Projects page.',
        )}
      </p>
    );
  }

  const parties = chemin === '' ? [] : chemin.split('/');
  const ouvrir = (e: EntreeRayon) => {
    if (e.type === 'dossier') {
      setChemin(e.chemin);
      return;
    }
    setOuvert(e.chemin);
    fetchFichierRayon(projet.id, e.chemin)
      .then((f) =>
        onMontrer({
          genre: 'fichier',
          chemin: f.chemin,
          contenu: f.contenu,
          langage: f.langage,
          tronque: f.tronque,
          taille: f.taille,
        }),
      )
      .catch((err: unknown) => setErreur(err instanceof Error ? err.message : String(err)))
      .finally(() => setOuvert(null));
  };

  return (
    <div className="hs-fichiers">
      <nav className="hs-fil-ariane" aria-label={t('Emplacement', 'Location')}>
        <button type="button" className="hs-lien" onClick={() => setChemin('')}>
          {projet.name}
        </button>
        {parties.map((part, i) => (
          <span key={`${part}-${i}`}>
            <span aria-hidden="true">/</span>
            <button
              type="button"
              className="hs-lien"
              onClick={() => setChemin(parties.slice(0, i + 1).join('/'))}
            >
              {part}
            </button>
          </span>
        ))}
      </nav>
      {erreur && (
        <p className="hs-alerte erreur" role="alert">
          {erreur}
        </p>
      )}
      {entrees === null && !erreur && (
        <p className="hs-discret">{t('Lecture du dépôt…', 'Reading the repository…')}</p>
      )}
      {entrees && entrees.length === 0 && (
        <p className="hs-vide">{t('Dossier vide.', 'Empty folder.')}</p>
      )}
      {entrees && entrees.length > 0 && (
        <ul className="hs-arbre">
          {entrees.map((e) => (
            <li key={e.chemin}>
              <button type="button" onClick={() => ouvrir(e)} aria-busy={ouvert === e.chemin}>
                <Icone nom={e.type === 'dossier' ? 'dossier' : 'fichier'} taille={16} />
                <span>{e.nom}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Résultats ───────────────────────────────────────────────────────────────

function VoletResultats(p: Props & { onMontrer: (a: Affichage) => void }) {
  const t = useT();
  const finies = p.mission.taches.filter((x) => x.status === 'done' || x.status === 'failed');
  if (finies.length === 0) {
    return (
      <p className="hs-vide">
        {t(
          'Aucun résultat pour l’instant : les productions apparaissent ici dès qu’une tâche se termine.',
          'No results yet: productions appear here as soon as a task finishes.',
        )}
      </p>
    );
  }
  return (
    <ul className="hs-resultats">
      {finies.map((x) => (
        <LigneResultat key={x.id} x={x} onOuvrirTache={p.onOuvrirTache} onMontrer={p.onMontrer} />
      ))}
    </ul>
  );
}

// ─── Le panneau de code ──────────────────────────────────────────────────────

const LANGAGES = new Set<CodeLang>([
  'diff',
  'javascript',
  'typescript',
  'json',
  'css',
  'html',
  'markdown',
  'python',
  'rust',
  'go',
  'java',
  'ruby',
  'php',
  'shell',
  'yaml',
  'sql',
  'texte',
]);

export function langageDe(a: Affichage): CodeLang {
  if (a.genre !== 'fichier') return a.genre === 'diff' ? 'diff' : 'texte';
  return LANGAGES.has(a.langage as CodeLang) ? (a.langage as CodeLang) : 'texte';
}

function PanneauCode({
  affichage,
  agrandi,
  onAgrandir,
  onFermer,
}: {
  affichage: Affichage | null;
  agrandi: boolean;
  onAgrandir: () => void;
  onFermer: () => void;
}) {
  const t = useT();
  const titre =
    affichage === null
      ? t('Code', 'Code')
      : affichage.genre === 'fichier'
        ? (affichage.chemin.split('/').pop() ?? affichage.chemin)
        : `${affichage.genre === 'diff' ? 'diff' : t('journaux', 'logs')} · ${affichage.titre}`;
  const lignes = affichage ? affichage.contenu.split('\n').length : 0;
  return (
    <section className="hs-panneau droite" aria-label={t('Code', 'Code')}>
      <div className="hs-onglets code">
        <span
          className="hs-onglet-fichier"
          title={affichage?.genre === 'fichier' ? affichage.chemin : undefined}
        >
          <Icone nom={affichage?.genre === 'diff' ? 'diff' : 'code'} taille={16} />
          <span>{titre}</span>
          {affichage && (
            <button
              type="button"
              className="hs-icone-btn petit"
              onClick={onFermer}
              aria-label={t('Fermer le fichier', 'Close file')}
            >
              <Icone nom="croix" taille={14} />
            </button>
          )}
        </span>
        <span className="hs-onglets-espace" />
        <button
          type="button"
          className="hs-icone-btn"
          onClick={onAgrandir}
          aria-pressed={agrandi}
          aria-label={
            agrandi
              ? t('Réduire le panneau', 'Restore panel')
              : t('Agrandir le panneau', 'Maximise panel')
          }
        >
          <Icone nom={agrandi ? 'reduire' : 'agrandir'} taille={16} />
        </button>
      </div>
      <div className="hs-code">
        {affichage === null ? (
          <p className="hs-vide">
            {t(
              'Choisis un fichier dans « Fichiers », ou un diff dans « Résultats » : il s’affiche ici, en lecture seule.',
              'Pick a file in “Files”, or a diff in “Results”: it shows here, read-only.',
            )}
          </p>
        ) : (
          <Suspense
            fallback={
              <p className="hs-discret">{t('Chargement de l’éditeur…', 'Loading editor…')}</p>
            }
          >
            <CodeEditor value={affichage.contenu} lang={langageDe(affichage)} />
          </Suspense>
        )}
      </div>
      <footer className="hs-barre-etat">
        {affichage ? (
          <>
            <span>{langageDe(affichage)}</span>
            <span>{t(`${lignes} lignes`, `${lines(lignes)} lines`)}</span>
            {affichage.genre === 'fichier' && affichage.tronque && (
              <span className="attention">{t('tronqué à la lecture', 'truncated on read')}</span>
            )}
            <span className="hs-barre-etat-espace" />
            <span>
              <span className="hs-point neutre" aria-hidden="true" />{' '}
              {t('Lecture seule', 'Read-only')}
            </span>
          </>
        ) : (
          <span>{t('Aucun fichier ouvert', 'No file open')}</span>
        )}
      </footer>
    </section>
  );
}

const lines = (n: number) => String(n);
