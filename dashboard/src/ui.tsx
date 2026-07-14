// Éléments d'UI partagés : libellés/icônes de statut, badge, barre de
// progression, et hooks d'accessibilité pour les overlays (dialog).

import { useEffect, useRef } from 'react';
import type { KeyboardEvent } from 'react';
import type { TaskStatus } from '../../src/shared/types';

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

export const STATUS_LABEL: Record<TaskStatus, string> = {
  pending: 'en attente',
  ready: 'prête',
  assigned: 'assignée',
  running: 'en cours',
  done: 'terminée',
  failed: 'échouée',
};

export const STATUS_ICON: Record<TaskStatus, string> = {
  pending: '○',
  ready: '◇',
  assigned: '◈',
  running: '▶',
  done: '✔',
  failed: '✘',
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  return (
    <span className={`badge ${status}`}>
      <span className="badge-icon">{STATUS_ICON[status]}</span>
      {STATUS_LABEL[status]}
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

/** Durée lisible (ms → « 1,2 s » / « 340 ms »). */
export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`;
}
