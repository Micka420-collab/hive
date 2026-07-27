// Éléments d'UI partagés : libellés/icônes de statut, badge, barre de
// progression, et hooks d'accessibilité pour les overlays (dialog).

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { TaskStatus } from '../../src/shared/types';
import type { BandeThermo } from './api';
import { useLang } from './i18n';
import type { Translate, UiLang } from './i18n';

/**
 * Accessibilité d'un overlay (tiroir/modale) :
 *  - ferme sur Échap ;
 *  - déplace le focus dans l'overlay à l'ouverture ;
 *  - restaure le focus sur l'élément déclencheur à la fermeture.
 * Retourne un ref à poser sur le conteneur (avec role="dialog" aria-modal).
 */
export function useDialog<T extends HTMLElement>(onClose: () => void) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus le 1er élément focusable, sinon le conteneur lui-même.
    const focusable = el?.querySelector<HTMLElement>(
      'input, textarea, button, [tabindex]:not([tabindex="-1"])',
    );
    (focusable ?? el)?.focus();

    const onKey = (e: KeyboardEvent | globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      trigger?.focus?.(); // restaure le focus au déclencheur
    };
  }, []);

  return ref;
}

/** Un dialogue modal (tiroir, modale) est-il ouvert ? Neutralise les raccourcis globaux. */
export function modalOpen(): boolean {
  return document.querySelector('[role="dialog"][aria-modal="true"]') !== null;
}

/** Props à étaler sur une ligne cliquable pour la rendre activable au clavier. */
export function activateProps(onActivate: () => void) {
  return {
    role: 'button',
    tabIndex: 0,
    onClick: onActivate,
    onKeyDown: (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onActivate();
      }
    },
  };
}

// Export FR historique conservé tel quel (compat avec les consommateurs existants).
export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'en attente',
  ready: 'prête',
  assigned: 'assignée',
  running: 'en cours',
  done: 'terminée',
  failed: 'échouée',
};

const STATUS_LABEL_EN: Record<TaskStatus, string> = {
  pending: 'pending',
  ready: 'ready',
  assigned: 'assigned',
  running: 'running',
  done: 'done',
  failed: 'failed',
};

/** Libellé de statut dans la langue demandée (FR = export historique). */
export function statusLabel(status: TaskStatus, lang: UiLang): string {
  return lang === 'fr' ? STATUS_LABEL[status] : STATUS_LABEL_EN[status];
}

export const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  ready: '◇',
  assigned: '◈',
  running: '▶',
  done: '✔',
  failed: '✘',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const lang = useLang();
  return (
    <span className={`badge ${status}`}>
      <span className="badge-icon">{STATUS_ICON[status]}</span>
      {statusLabel(status, lang)}
    </span>
  );
}

export function ProgressBar({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div
      className="pbar"
      role="progressbar"
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className="pbar-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ─── Thermorégulation : bandes de température ────────────────────────────────
// Double libellé fr/en (constante de module) — résolu via `t` au rendu, comme
// KIND_LABEL côté Santé. Partagé par la carte Thermorégulation et le Journal.

export const BANDE_LABEL: Record<BandeThermo, { fr: string; en: string }> = {
  froide: { fr: 'froide', en: 'cold' },
  normale: { fr: 'normale', en: 'normal' },
  chaude: { fr: 'chaude', en: 'hot' },
  surchauffe: { fr: 'surchauffe', en: 'overheating' },
};

/** Les 4 bandes, de la plus calme à la plus critique (échelle de la jauge). */
export const BANDES: BandeThermo[] = ['froide', 'normale', 'chaude', 'surchauffe'];

/** Libellé d'une bande venue d'un payload non typé ; repli sur la valeur brute. */
export function bandeText(value: unknown, t: Translate): string {
  const brut = String(value ?? '');
  const connue = BANDE_LABEL[brut as BandeThermo];
  return connue ? t(connue.fr, connue.en) : brut;
}

/** Durée lisible (ms → « 1,2 s » / « 340 ms »). */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
