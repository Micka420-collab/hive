// Timeline de sauvegardes — étapes auto + gestes manuels, restauration via tâche.
//
// Une section, un métier : revoir le code capturé et demander une restauration.
// Pas de rewrite silencieux du dépôt (le serveur crée une tâche).

import { useCallback, useEffect, useState } from 'react';
import { copierTexte } from './copier';
import {
  creerSauvegardeManuelle,
  fetchSauvegarde,
  fetchSauvegardes,
  getPartage,
  restaurerSauvegarde,
} from './api';
import type { SauvegardeResumeUi } from './api';
import { useT } from './i18n';
import { timeShort } from './views/shared';
import type { ViewId } from './views/shared';

function libelleGenre(kind: SauvegardeResumeUi['kind'], t: ReturnType<typeof useT>): string {
  switch (kind) {
    case 'etape':
      return t('étape', 'checkpoint');
    case 'manuel':
      return t('manuel', 'manual');
    case 'avant_retouche':
      return t('avant retouche', 'before edit');
    default:
      return kind;
  }
}

function tailleCourte(n: number): string {
  if (n < 1024) return `${n} o`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} Ko`;
  return `${(n / (1024 * 1024)).toFixed(1)} Mo`;
}

/** Aperçu UI borné — le patch complet reste en mémoire pour Copier / restaurer. */
const PATCH_APERCU_MAX = 12_000;

export function SauvegardesTimeline({
  projectId,
  refreshTick = 0,
  onNavigate,
  attirerAttention = false,
}: {
  projectId: string;
  /** Incrémenté quand l'essaim produit — recharge la timeline. */
  refreshTick?: number;
  /** Après restauration : ouvrir la tâche créée dans la Miellerie. */
  onNavigate?: (view: ViewId, selectedId?: string) => void;
  /** Pulse bref quand on arrive depuis la Reine (Sauvegardes / Restaurer…). */
  attirerAttention?: boolean;
}) {
  const t = useT();
  const parPartage = getPartage() !== null;
  const [liste, setListe] = useState<SauvegardeResumeUi[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [tacheRestau, setTacheRestau] = useState<{ id: string; title: string } | null>(null);
  const [copieOk, setCopieOk] = useState(false);
  /** Id de l’étape dont le patch est déplié — un seul à la fois. */
  const [ouvertId, setOuvertId] = useState<string | null>(null);
  const [patchTexte, setPatchTexte] = useState<string | null>(null);
  const [patchCharge, setPatchCharge] = useState(false);

  const charger = useCallback(async () => {
    try {
      const r = await fetchSauvegardes(projectId);
      setListe(r.sauvegardes);
      setErreur(null);
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    }
  }, [projectId]);

  useEffect(() => {
    void charger();
  }, [charger, refreshTick]);

  useEffect(() => {
    setOuvertId(null);
    setPatchTexte(null);
    setTacheRestau(null);
  }, [projectId]);

  const poser = async () => {
    if (parPartage || label.trim().length < 2) return;
    setBusy(true);
    setMsg(null);
    try {
      await creerSauvegardeManuelle(projectId, { label: label.trim() });
      setLabel('');
      setMsg(t('Sauvegarde posée.', 'Checkpoint saved.'));
      await charger();
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const voirPatch = async (id: string) => {
    if (ouvertId === id) {
      setOuvertId(null);
      setPatchTexte(null);
      setCopieOk(false);
      return;
    }
    setOuvertId(id);
    setPatchTexte(null);
    setCopieOk(false);
    setPatchCharge(true);
    setErreur(null);
    try {
      const r = await fetchSauvegarde(projectId, id);
      setPatchTexte(r.sauvegarde.patch || '');
    } catch (e) {
      setOuvertId(null);
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setPatchCharge(false);
    }
  };

  const copierPatch = async () => {
    if (!patchTexte) return;
    // `navigator.clipboard` SEUL, c'était : cet écran échouait sur toute ruche
    // servie en http — c'est-à-dire sur le déploiement LAN, qui est le mode
    // principal du projet. Le repli existait à dix mètres de là, dans
    // `InvitePanel`, et ne servait qu'à lui.
    if (await copierTexte(patchTexte)) {
      setCopieOk(true);
      return;
    }
    setErreur(t('Impossible de copier le patch.', 'Could not copy the patch.'));
  };

  const restaurer = async (id: string, nom: string) => {
    if (parPartage) return;
    const ok = window.confirm(
      t(
        `Restaurer « ${nom} » ? Une tâche sera créée pour l’essaim — le dépôt n’est pas réécrit ici.`,
        `Restore “${nom}”? A task will be created for the swarm — the repo is not rewritten here.`,
      ),
    );
    if (!ok) return;
    setBusy(true);
    setMsg(null);
    setTacheRestau(null);
    try {
      const r = await restaurerSauvegarde(projectId, id);
      setMsg(
        t(
          `Tâche créée : « ${r.task.title} ». Une ouvrière appliquera le patch ; revue Miellerie comme le reste.`,
          `Task created: “${r.task.title}”. A worker will apply the patch; Honey House review like everything else.`,
        ),
      );
      setTacheRestau({ id: r.task.id, title: r.task.title });
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const patchAffiche =
    patchTexte && patchTexte.length > PATCH_APERCU_MAX
      ? `${patchTexte.slice(0, PATCH_APERCU_MAX)}\n…`
      : patchTexte;
  const patchTronque = !!(patchTexte && patchTexte.length > PATCH_APERCU_MAX);

  return (
    <section
      id="ry-sauvegardes"
      className={`ry-sauvegardes${attirerAttention ? ' ry-sauvegardes--focus' : ''}`}
      aria-label={t('Sauvegardes', 'Backups')}
    >
      <header className="ry-sg-tete">
        <h3>{t('Sauvegardes', 'Backups')}</h3>
        <p>
          {t(
            'Chaque étape réussie garde son diff. Ouvrez-le avant de restaurer — restaurer ouvre une tâche, jamais un rewrite silencieux.',
            'Each successful step keeps its diff. Open it before restoring — restore opens a task, never a silent rewrite.',
          )}
        </p>
      </header>

      {!parPartage && (
        <div className="ry-sg-manuel">
          <input
            className="ry-sg-input"
            value={label}
            maxLength={120}
            disabled={busy}
            placeholder={t('Nommer une sauvegarde…', 'Name a checkpoint…')}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void poser();
              }
            }}
          />
          <button
            type="button"
            className="btn"
            disabled={busy || label.trim().length < 2}
            onClick={() => void poser()}
          >
            {t('Poser', 'Save')}
          </button>
        </div>
      )}

      {erreur && <p className="ry-sg-erreur">⚠ {erreur}</p>}
      {msg && (
        <div className="ry-sg-suite">
          <p className="ry-sg-msg">{msg}</p>
          {tacheRestau && onNavigate && (
            <button
              type="button"
              className="btn ghost ry-sg-miellerie"
              onClick={() => onNavigate('miellerie', tacheRestau.id)}
            >
              {t('Ouvrir dans la Miellerie', 'Open in Honey House')}
            </button>
          )}
        </div>
      )}

      {liste.length === 0 && !erreur ? (
        <p className="ry-sg-vide">
          {t(
            'Aucune étape encore — elles apparaissent dès qu’une ouvrière livre un diff.',
            'No checkpoints yet — they appear when a worker delivers a diff.',
          )}
        </p>
      ) : (
        <ol className="ry-sg-liste">
          {liste.map((s) => (
            <li key={s.id} className="ry-sg-item">
              <div className="ry-sg-ligne">
                <div className="ry-sg-meta">
                  <span className="ry-sg-kind">{libelleGenre(s.kind, t)}</span>
                  <strong className="ry-sg-label">{s.label}</strong>
                  <span className="ry-sg-taille">{tailleCourte(s.taille)}</span>
                  <time dateTime={new Date(s.createdAt).toISOString()}>
                    {timeShort(s.createdAt)}
                  </time>
                </div>
                <div className="ry-sg-actions">
                  {s.taille > 0 && (
                    <button
                      type="button"
                      className="btn ghost ry-sg-voir"
                      disabled={busy || (patchCharge && ouvertId === s.id)}
                      aria-expanded={ouvertId === s.id}
                      onClick={() => void voirPatch(s.id)}
                    >
                      {ouvertId === s.id ? t('Fermer', 'Close') : t('Voir le patch', 'View patch')}
                    </button>
                  )}
                  {!parPartage && s.taille > 0 && (
                    <button
                      type="button"
                      className="btn ghost ry-sg-restaure"
                      disabled={busy}
                      onClick={() => void restaurer(s.id, s.label)}
                    >
                      {t('Restaurer', 'Restore')}
                    </button>
                  )}
                </div>
              </div>
              {ouvertId === s.id && (
                <div className="ry-sg-patch-cadre">
                  {patchCharge && !patchTexte ? (
                    <p className="ry-sg-patch-attente">{t('Chargement…', 'Loading…')}</p>
                  ) : (
                    <>
                      <div className="ry-sg-patch-barre">
                        {patchTronque && (
                          <span className="ry-sg-patch-note">
                            {t(
                              `Aperçu tronqué (${tailleCourte(PATCH_APERCU_MAX)} sur ${tailleCourte(patchTexte!.length)}) — Copier garde le patch entier.`,
                              `Truncated preview (${tailleCourte(PATCH_APERCU_MAX)} of ${tailleCourte(patchTexte!.length)}) — Copy keeps the full patch.`,
                            )}
                          </span>
                        )}
                        {patchTexte && patchTexte.length > 0 && (
                          <button
                            type="button"
                            className="btn ghost ry-sg-copier"
                            onClick={() => void copierPatch()}
                          >
                            {copieOk ? t('Copié', 'Copied') : t('Copier', 'Copy')}
                          </button>
                        )}
                      </div>
                      <pre className="ry-sg-patch" tabIndex={0}>
                        {patchAffiche && patchAffiche.length > 0
                          ? patchAffiche
                          : t('(patch vide)', '(empty patch)')}
                      </pre>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
