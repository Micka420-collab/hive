// Éléments d'UI partagés : libellés/icônes de statut, badge, barre de
// progression, hooks d'accessibilité pour les overlays (dialog), et le geste
// irréversible.

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { TaskStatus } from '../../src/shared/types';
import type { BandeThermo, Domaine } from './api';
import { useLang, useT } from './i18n';
import type { Translate, UiLang } from './i18n';

/**
 * Accessibilité d'un overlay (tiroir/modale) :
 *  - ferme sur Échap ;
 *  - déplace le focus dans l'overlay à l'ouverture ;
 *  - restaure le focus sur l'élément déclencheur à la fermeture.
 * Retourne un ref à poser sur le conteneur (avec role="dialog" aria-modal).
 *
 * `focusInitial` désigne l'élément à focaliser à l'ouverture quand le premier
 * focusable du DOM n'est pas le bon point de départ : dans un panneau de
 * recherche, la croix de fermeture précède le champ, et focaliser la croix
 * offre d'abord de partir.
 */
export function useDialog<T extends HTMLElement>(
  onClose: () => void,
  focusInitial?: RefObject<HTMLElement | null>,
) {
  const ref = useRef<T>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus le 1er élément focusable, sinon le conteneur lui-même.
    const focusable =
      focusInitial?.current ??
      el?.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])');
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

/**
 * LE VOILE D'UNE MODALE — et pourquoi il est monté à la racine du document.
 *
 * ─── LA PANNE ───────────────────────────────────────────────────────────────
 *
 * `InvitePanel` et `AccountPanel` vivent DANS la barre du haut. Or `.topbar`
 * porte un `backdrop-filter: blur(14px)` : d'après la spec, un filtre fait de
 * l'élément le BLOC CONTENEUR de ses descendants en `position: fixed`. Le
 * `inset: 0` du voile ne visait donc plus la fenêtre mais la barre — mesuré
 * dans Chrome, voile 1057×78 px et modale à y = −129 px, c'est-à-dire hors
 * de l'écran, par le haut. « Inviter un ami » ouvrait une popup illisible
 * dont on ne pouvait pas copier la commande : la fonction était inatteignable.
 *
 * ─── LE CHOIX ───────────────────────────────────────────────────────────────
 *
 * Retirer le flou de la barre aurait remis les modales d'aplomb aujourd'hui,
 * et la même panne serait revenue au premier ancêtre qui reprend un filtre,
 * un `transform` ou un `contain`. Le portail supprime la question : une
 * surface modale n'est plus la descendante de rien.
 */
export function Voile({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="modal-backdrop" onClick={onClose}>
      {children}
    </div>,
    document.body,
  );
}

interface EmptyAction {
  label: string;
  onClick: () => void;
}

/**
 * État vide partagé : une explication courte et un prochain geste concret.
 * Les anciens vides mélangeaient prose poétique, bouton ou aucune issue selon
 * la vue ; ici, l'utilisateur sait toujours pourquoi l'écran est vide et quoi
 * faire ensuite.
 */
export function FriendlyEmptyState({
  title,
  description,
  primary,
  secondary,
}: {
  title: string;
  description: string;
  primary?: EmptyAction;
  secondary?: EmptyAction;
}) {
  return (
    <section className="friendly-empty">
      <span className="friendly-empty-mark" aria-hidden="true" />
      <div className="friendly-empty-copy">
        <h2>{title}</h2>
        <p>{description}</p>
      </div>
      {(primary || secondary) && (
        <div className="friendly-empty-actions">
          {primary && (
            <button type="button" className="btn primary" onClick={primary.onClick}>
              {primary.label}
            </button>
          )}
          {secondary && (
            <button type="button" className="btn ghost" onClick={secondary.onClick}>
              {secondary.label}
            </button>
          )}
        </div>
      )}
    </section>
  );
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

// ─── Domaines (phéromones, devis de la Balance) ──────────────────────────────
// Double libellé fr/en, résolu via `t` au rendu. Ici plutôt que dans une vue :
// la carte Phéromones (Essaim) et le devis de la Balance (Projets) sont deux
// chunks lazy distincts — partager la constante par ui.tsx évite d'en tirer un
// dans l'autre. Même motif que BANDE_LABEL, partagé par Santé et le Journal.

export const DOMAINE_LABEL: Record<Domaine, { fr: string; en: string }> = {
  api: { fr: 'API', en: 'API' },
  ui: { fr: 'Interface', en: 'UI' },
  db: { fr: 'Base de données', en: 'Database' },
  tests: { fr: 'Tests', en: 'Tests' },
  docs: { fr: 'Documentation', en: 'Docs' },
  infra: { fr: 'Infra', en: 'Infra' },
  general: { fr: 'Général', en: 'General' },
};

/**
 * Durée d'AGRÉGAT lisible — l'échelle de la Balance, où l'on additionne des
 * heures de temps machine et non plus la latence d'une tâche (`formatMs`, qui
 * reste le bon outil sous la minute).
 *
 * Trois paliers, parce qu'un opérateur ne lit pas « 15 132 400 ms » :
 * millisecondes sous la seconde, secondes sous la minute, puis « m min s » et
 * « h h min ». Le reste est omis dès que le chiffre de tête est assez gros pour
 * porter l'ordre de grandeur (au-delà de 10 min / 10 h, la précision fine est
 * du bruit). Unités s / min / h : identiques en français et en anglais, donc
 * aucune chaîne à traduire ici.
 *
 * JAMAIS de symbole monétaire : l'unité de la Balance est la seconde-ouvrière,
 * du temps machine PRÊTÉ. Aucun tarif n'est connu de la ruche, et convertir
 * sans tarif serait inventer un chiffre (balance.ts, `enEuros`).
 */
export function formatDuree(ms: number): string {
  const v = Math.max(0, ms);
  if (v < 1_000) return `${Math.round(v)} ms`;
  const s = v / 1_000;
  // Sous 10 s, une décimale : c'est l'échelle d'une tâche courte, pas du bruit.
  if (s < 9.95) return `${s.toFixed(1)} s`;
  const sec = Math.round(s);
  if (sec < 60) return `${sec} s`;
  const min = Math.floor(sec / 60);
  const restSec = sec % 60;
  if (min < 60) return restSec === 0 || min >= 10 ? `${min} min` : `${min} min ${restSec} s`;
  const h = Math.floor(min / 60);
  const restMin = min % 60;
  return restMin === 0 || h >= 10 ? `${h} h` : `${h} h ${restMin} min`;
}

// ─── Le geste qui coupe ──────────────────────────────────────────────────────
//
// ─── CE QUI CLOCHAIT ─────────────────────────────────────────────────────────
//
// Quatre gestes du tableau de bord sont IRRÉVERSIBLES et partaient d'un clic
// unique : retirer un membre d'un projet, éteindre un lien de partage,
// révoquer la clé d'une machine. Deux d'entre eux étaient un simple « ✕ » dans
// une ligne de liste.
//
// Deux choses rendaient cela pire qu'une simple absence de garde.
//
// **Les listes se rafraîchissent toutes seules.** `useApiPoll` les relit toutes
// les 60 à 120 secondes ; la ligne qu'on visait peut donc BOUGER entre le
// moment où l'œil la choisit et celui où le doigt clique. Une confirmation qui
// demanderait « êtes-vous sûr ? » ne rattraperait pas ça : elle confirmerait la
// mauvaise ligne aussi volontiers que la bonne.
//
// C'est pourquoi `question` NOMME sa cible. « Retirer Léa du projet ? » attrape
// une ligne qui a glissé ; « Êtes-vous sûr ? » ne le fait pas.
//
// **Et « Révoquer » ne voulait pas dire la même chose deux fois.** Dans le
// panneau des clés, deux listes se suivent avec des boutons identiques : l'un
// déconnecte une machine sur-le-champ, l'autre — le billet — « ne déconnecte
// personne », comme l'écrit le panneau lui-même. Le texte disait la différence,
// les commandes la démentaient.
//
// ─── POURQUOI L'ANNULATION EST AVANT LA CONFIRMATION ─────────────────────────
//
// L'armement remplace le bouton par cette rangée, à la même place. Un
// double-clic, ou un clic impatient, retomberait donc à quelques pixels du
// premier. Deux choses éloignent la confirmation de cet endroit-là : la
// question, qui est une phrase entière, puis « Annuler ». Ce qui reste près du
// point de départ ne fait donc RIEN — et c'est le point.
//
// ─── CE QU'ON NE FAIT PAS ────────────────────────────────────────────────────
//
// On ne met pas de garde sur les gestes anodins. Révoquer un billet ne coupe
// personne : lui coller une confirmation apprendrait à cliquer à travers les
// confirmations, et la prochaine — celle qui compte — se ferait traverser
// aussi. Une garde partout est une garde nulle part.
//
// On ne pose pas non plus de minuterie de désarmement : l'état armé ne
// RESSEMBLE pas à l'état au repos (une question, deux boutons), donc personne
// ne peut le prendre pour l'autre en revenant plus tard.

export function GesteIrreversible({
  libelle,
  ariaLabel,
  question,
  confirmer,
  onConfirmer,
  disabled = false,
}: {
  /** Ce que montre le bouton au repos — « ✕ » ou un verbe. */
  libelle: string;
  /** Obligatoire quand `libelle` est une icône : « ✕ » ne se lit pas. */
  ariaLabel?: string;
  /** La question, qui doit NOMMER sa cible et dire ce qui se perd. */
  question: string;
  /** Le verbe de la confirmation — jamais « OK », qui ne dit rien. */
  confirmer: string;
  onConfirmer: () => void;
  disabled?: boolean;
}) {
  const t = useT();
  const [arme, setArme] = useState(false);

  if (!arme) {
    return (
      <button
        className="btn ghost geste-irr-armer"
        aria-label={ariaLabel}
        title={question}
        disabled={disabled}
        onClick={() => setArme(true)}
      >
        {libelle}
      </button>
    );
  }

  return (
    <span className="geste-irr" role="group" aria-label={question}>
      <span className="geste-irr-q">{question}</span>
      <button
        className="btn ghost geste-irr-non"
        disabled={disabled}
        onClick={() => setArme(false)}
      >
        {t('Annuler', 'Cancel')}
      </button>
      <button
        className="btn geste-irr-oui"
        disabled={disabled}
        onClick={() => {
          setArme(false);
          onConfirmer();
        }}
      >
        {confirmer}
      </button>
    </span>
  );
}
