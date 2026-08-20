// Timeline de sauvegardes — étapes auto + gestes manuels, restauration via tâche.
//
// Une section, un métier : revoir le code capturé et demander une restauration.
// Pas de rewrite silencieux du dépôt (le serveur crée une tâche).

import { useCallback, useEffect, useState } from 'react';
import {
  creerSauvegardeManuelle,
  fetchSauvegardes,
  getPartage,
  restaurerSauvegarde,
} from './api';
import type { SauvegardeResumeUi } from './api';
import { useT } from './i18n';
import { timeShort } from './views/shared';

function libelleGenre(
  kind: SauvegardeResumeUi['kind'],
  t: ReturnType<typeof useT>,
): string {
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

export function SauvegardesTimeline({
  projectId,
  refreshTick = 0,
}: {
  projectId: string;
  /** Incrémenté quand l'essaim produit — recharge la timeline. */
  refreshTick?: number;
}) {
  const t = useT();
  const parPartage = getPartage() !== null;
  const [liste, setListe] = useState<SauvegardeResumeUi[]>([]);
  const [erreur, setErreur] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

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
    try {
      const r = await restaurerSauvegarde(projectId, id);
      setMsg(
        t(
          `Tâche créée : « ${r.task.title} ». Une ouvrière appliquera le patch ; revue Miellerie comme le reste.`,
          `Task created: “${r.task.title}”. A worker will apply the patch; Honey House review like everything else.`,
        ),
      );
    } catch (e) {
      setErreur(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="ry-sauvegardes" aria-label={t('Sauvegardes', 'Backups')}>
      <header className="ry-sg-tete">
        <h3>{t('Sauvegardes', 'Backups')}</h3>
        <p>
          {t(
            'Chaque étape réussie garde son diff. Restaurer ouvre une tâche — jamais un rewrite silencieux.',
            'Each successful step keeps its diff. Restore opens a task — never a silent rewrite.',
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

      {erreur && <p className="ry-erreur">⚠ {erreur}</p>}
      {msg && <p className="ry-sg-msg">{msg}</p>}

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
              <div className="ry-sg-meta">
                <span className="ry-sg-kind">{libelleGenre(s.kind, t)}</span>
                <strong className="ry-sg-label">{s.label}</strong>
                <span className="ry-sg-taille">{tailleCourte(s.taille)}</span>
                <time dateTime={new Date(s.createdAt).toISOString()}>
                  {timeShort(s.createdAt)}
                </time>
              </div>
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
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
