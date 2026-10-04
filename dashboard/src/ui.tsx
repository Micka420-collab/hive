// Éléments d'UI partagés : libellés/icônes de statut, badge, barre de
// progression, hooks d'accessibilité pour les overlays (dialog), et le geste
// irréversible.

import { Component, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { KeyboardEvent, ReactNode, RefObject } from 'react';
import type { TaskStatus } from '../../src/shared/types';
import type { SommeDeclaree } from '../../src/shared/declaration-fournisseur';
import type { BandeThermo, Domaine } from './api';
import { useLang, useT } from './i18n';
import type { Translate, UiLang } from './i18n';

/**
 * Ce que Tab peut atteindre dans un dialogue. Les éléments éteints, cachés,
 * inertes, ou rangés dans un `<details>` fermé (hors de son `<summary>`) n'en
 * sont pas : les compter ferait « boucler » depuis un élément que le
 * navigateur saute, et la tabulation sortirait du dialogue par ce trou.
 */
const TABULABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [contenteditable]:not([contenteditable="false"]), [tabindex]';

function tabulables(conteneur: HTMLElement): HTMLElement[] {
  return [...conteneur.querySelectorAll<HTMLElement>(TABULABLES)].filter((el) => {
    // L'ATTRIBUT, pas la propriété `tabIndex` : sa valeur par défaut d'un
    // `<summary>` ou d'un `contenteditable` varie d'un moteur à l'autre.
    const retire = Number(el.getAttribute('tabindex') ?? '0') < 0;
    if (retire || el.closest('[hidden], [inert]')) return false;
    const replie = el.closest('details:not([open])');
    return !replie || el.closest('summary')?.parentElement === replie;
  });
}

/**
 * Les dialogues ouverts, du plus ancien au plus récent. Seul le SOMMET écoute
 * le clavier : chaque dialogue pose son écouteur sur `window`, et sans cette
 * pile, un Tab dans le dialogue du dessus serait « rapatrié » par celui du
 * dessous, et un Échap fermerait les deux d'un coup.
 */
const pileDialogues: RefObject<HTMLElement | null>[] = [];

/**
 * Le sommet, c'est le plus récent dont le conteneur est À L'ÉCRAN. Un crochet
 * monté sans son dialogue (appelé au niveau d'une vue toujours montée, comme
 * la Chambre le faisait) garderait sinon le clavier pour un conteneur absent :
 * le dialogue réellement ouvert dessous perdait Échap et Tab.
 */
function sommetDeLaPile(): RefObject<HTMLElement | null> | undefined {
  for (let i = pileDialogues.length - 1; i >= 0; i--) {
    if (pileDialogues[i]?.current?.isConnected) return pileDialogues[i];
  }
  return undefined;
}

/** Tab au BORD du dialogue : on reboucle sur l'autre bord au lieu de sortir. */
function garderLeFocus(e: globalThis.KeyboardEvent, conteneur: HTMLElement): void {
  const liste = tabulables(conteneur);
  // Rien à atteindre : le conteneur lui-même, plutôt qu'une fuite.
  const premier = liste[0] ?? conteneur;
  const dernier = liste.at(-1) ?? conteneur;
  const actif = document.activeElement;
  const dehors = !(actif instanceof Node) || !conteneur.contains(actif);
  const auBord = e.shiftKey ? actif === premier || actif === conteneur : actif === dernier;
  // À l'intérieur et loin du bord : le navigateur avance tout seul.
  if (!dehors && !auBord) return;
  e.preventDefault();
  (e.shiftKey ? dernier : premier).focus();
}

/**
 * Accessibilité d'un overlay (tiroir/modale) :
 *  - ferme sur Échap ;
 *  - déplace le focus dans l'overlay à l'ouverture ;
 *  - GARDE le focus dedans : Tab depuis le dernier élément revient au premier,
 *    Maj+Tab depuis le premier repart du dernier ;
 *  - restaure le focus sur l'élément déclencheur à la fermeture.
 * Retourne un ref à poser sur le conteneur (avec role="dialog" aria-modal).
 *
 * ─── POURQUOI LA GARDE, EN PLUS DU FOCUS QUI ENTRE ──────────────────────────
 *
 * `aria-modal="true"` annonce au lecteur d'écran que le reste de la page est
 * hors d'atteinte. Or la touche Tab, elle, n'en savait rien : du dernier
 * bouton de la modale, elle repartait dans la barre de navigation CACHÉE sous
 * le voile. On tabulait alors à l'aveugle dans une page qu'on ne voit plus, et
 * le dialogue mentait sur ce qu'il promettait.
 *
 * Un Tab déjà PRIS par l'élément focalisé (`defaultPrevented` — un éditeur de
 * code qui indente) n'est pas détourné.
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
  useGardeDialogue(ref, onClose, true, focusInitial);
  return ref;
}

/**
 * Le même contrat que `useDialog`, pour un conteneur qui EXISTE AVANT d'être
 * un dialogue et le reste après : le tiroir de navigation mobile est la barre
 * elle-même, toujours montée, qui ne devient modale que le temps d'être
 * ouverte. `actif` arme la garde (focus qui entre, Tab qui boucle, Échap qui
 * ferme) et la désarme — le focus revient alors au déclencheur, comme à la
 * fermeture d'une modale. Une seule implémentation pour les deux : un second
 * piège à focus écrit à côté divergerait au premier correctif.
 */
export function useGardeDialogue(
  ref: RefObject<HTMLElement | null>,
  onClose: () => void,
  actif: boolean,
  focusInitial?: RefObject<HTMLElement | null>,
): void {
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!actif) return;
    const trigger = document.activeElement as HTMLElement | null;
    const el = ref.current;
    // Focus le 1er élément focusable, sinon le conteneur lui-même.
    const focusable =
      focusInitial?.current ??
      el?.querySelector<HTMLElement>('input, textarea, button, [tabindex]:not([tabindex="-1"])');
    (focusable ?? el)?.focus();
    pileDialogues.push(ref);

    const onKey = (e: globalThis.KeyboardEvent) => {
      if (sommetDeLaPile() !== ref) return;
      if (e.key === 'Escape') closeRef.current();
      if (e.key === 'Tab' && !e.defaultPrevented && ref.current) garderLeFocus(e, ref.current);
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      // Par identité, pas `pop()` : le dialogue du dessous peut se fermer le
      // premier (sa vue est démontée), et retirer le sommet à sa place
      // laisserait le clavier à un dialogue qui n'existe plus.
      const i = pileDialogues.indexOf(ref);
      if (i >= 0) pileDialogues.splice(i, 1);
      trigger?.focus?.(); // restaure le focus au déclencheur
    };
    // `ref` et `focusInitial` sont des objets stables : seul `actif` arme.
  }, [actif]);
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

// ─── LE FILET SOUS UNE VUE — et sous l'application entière ───────────────────
//
// ─── LA PANNE ───────────────────────────────────────────────────────────────
//
// Aucune frontière d'erreur n'existait. Or quand un rendu jette et que rien ne
// le rattrape, React DÉMONTE TOUTE LA RACINE : il ne restait qu'un `#root`
// vide, sans barre, sans voyant, sans un mot. Deux causes ordinaires y
// menaient :
//
//   · une vue qui lit un champ absent d'une réponse (un orchestrateur plus
//     ancien, un relevé à moitié rempli) ;
//   · un morceau paresseux qui ne se charge plus — la ruche a été mise à jour
//     pendant que l'onglet restait ouvert, et les noms de fichiers ont changé.
//
// ─── CE QUE FAIT LE FILET ───────────────────────────────────────────────────
//
// Sous une VUE, il borne la panne à la vue : la barre et l'en-tête restent, on
// peut aller ailleurs, et l'écran dit ce qui s'est passé. Aller ailleurs — une
// autre vue, ou une autre fiche de la même — réarme le filet (`adresse`). Sous
// l'APPLICATION (main.tsx), il remplace la page blanche par la même
// explication.
//
// Deux gestes, parce que les deux causes ne se soignent pas pareil.
// « Réessayer » rend la vue une seconde fois — assez pour une donnée qui a
// changé depuis. Mais `React.lazy` garde en mémoire l'import qui a échoué : un
// morceau introuvable le restera jusqu'au rechargement. D'où « Recharger la
// page », qui va chercher la version courante.
//
// Un nouvel essai qui retombe dans la même panne AFFICHE son compte : sinon le
// clic ne changerait rien à l'écran, et on ne saurait pas s'il a eu lieu.

interface EtatFilet {
  erreur: Error | null;
  essais: number;
  /** L'adresse pour laquelle `erreur` a été constatée. */
  adresse: string | undefined;
}

interface ProprietesFilet {
  portee: 'vue' | 'application';
  /**
   * Ce qu'affiche le filet, À LA FICHE PRÈS (`vue/id`) : quand elle change, une
   * panne constatée ailleurs est oubliée. Pas une `key` : elle remonterait la
   * vue SAINE à chaque fiche ouverte (relectures, onglet, défilement perdus)
   * pour réarmer un filet qui n'a rien rattrapé.
   */
  adresse?: string;
  children: ReactNode;
}

export class FiletDeSecurite extends Component<ProprietesFilet, EtatFilet> {
  override state: EtatFilet = { erreur: null, essais: 0, adresse: this.props.adresse };

  static getDerivedStateFromError(erreur: unknown): Partial<EtatFilet> {
    return { erreur: erreur instanceof Error ? erreur : new Error(String(erreur)) };
  }

  // Avant le rendu, pas après (`componentDidUpdate`) : la panne d'une fiche ne
  // s'affiche pas, même le temps d'une image, sur la fiche suivante.
  static getDerivedStateFromProps(
    props: ProprietesFilet,
    etat: EtatFilet,
  ): Partial<EtatFilet> | null {
    if (props.adresse === etat.adresse) return null;
    return { adresse: props.adresse, erreur: null, essais: 0 };
  }

  override render() {
    const { erreur, essais } = this.state;
    if (erreur === null) return this.props.children;
    return (
      <EcranEnPanne
        portee={this.props.portee}
        erreur={erreur}
        essais={essais}
        onReessayer={() => this.setState({ erreur: null, essais: essais + 1 })}
      />
    );
  }
}

function EcranEnPanne({
  portee,
  erreur,
  essais,
  onReessayer,
}: {
  portee: 'vue' | 'application';
  erreur: Error;
  essais: number;
  onReessayer: () => void;
}) {
  const t = useT();
  return (
    <section className="card mc-panne" role="alert">
      <h2>
        {portee === 'vue'
          ? t('Cette vue est tombée en panne', 'This view crashed')
          : t('Mission Control est tombé en panne', 'Mission Control crashed')}
      </h2>
      <p>
        {portee === 'vue'
          ? t(
              'Le reste de Mission Control répond : la barre de gauche mène aux autres vues.',
              'The rest of Mission Control still answers: the sidebar leads to the other views.',
            )
          : t(
              'La ruche, elle, continue de tourner : seul cet écran s’est arrêté.',
              'The hive itself keeps running: only this screen stopped.',
            )}{' '}
        {t(
          'Si la panne suit une mise à jour de la ruche, recharger la page va chercher la nouvelle version.',
          'If this follows a hive update, reloading the page fetches the new version.',
        )}
      </p>
      {essais > 0 && (
        <p>
          {t(
            `Toujours en panne après ${essais} ${essais > 1 ? 'nouveaux essais' : 'nouvel essai'}.`,
            `Still failing after ${essais} retr${essais > 1 ? 'ies' : 'y'}.`,
          )}
        </p>
      )}
      <code className="mc-panne-detail">{erreur.message || erreur.name}</code>
      <div className="mc-panne-gestes">
        <button type="button" className="btn primary" onClick={onReessayer}>
          {t('Réessayer', 'Retry')}
        </button>
        <button type="button" className="btn" onClick={() => location.reload()}>
          {t('Recharger la page', 'Reload the page')}
        </button>
      </div>
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

/** Un compte de jetons déclaré, groupé à la façon de la langue (« 12 345 »). */
export function direJetons(jetons: number, lang: 'fr' | 'en'): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US').format(jetons);
}

/**
 * Une somme DÉCLARÉE par les CLI des agents, dite avec sa couverture.
 *
 * C'est la seule forme sous laquelle un coût déclaré devient un chiffre de
 * tête : « ≥ » dès qu'une tentative s'est tue, et « 3/5 tentatives
 * déclarées » à côté — jamais un total nu qu'on lirait comme une facture, et
 * jamais extrapolé à la tentative muette. Sans aucune déclaration :
 * « inconnu », sans couverture à dire.
 */
export function direSommeDeclaree(
  s: SommeDeclaree | 'inconnu',
  rendu: (v: number) => string,
  t: Translate,
): { valeur: string; couverture: string | null } {
  if (s === 'inconnu') return { valeur: t('inconnu', 'unknown'), couverture: null };
  return {
    valeur: `${s.declarees < s.tentatives ? '≥ ' : ''}${rendu(s.total)}`,
    couverture: t(
      `${s.declarees}/${s.tentatives} tentative(s) déclarée(s)`,
      `${s.declarees}/${s.tentatives} attempt(s) declared`,
    ),
  };
}

/** Montant déclaré, en dollars US — jusqu'à quatre décimales pour les petits coûts. */
export function direUsd(montant: number, lang: 'fr' | 'en'): string {
  return new Intl.NumberFormat(lang === 'fr' ? 'fr-FR' : 'en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }).format(montant);
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
//
// ─── LE NOM À RETAPER, POUR LE GESTE QUI EMPORTE TOUT ────────────────────────
//
// Supprimer un projet efface des mois de travail d'un coup, sans retour. Deux
// clics bien placés n'y suffisent pas : la main les enchaîne sans que l'œil ait
// relu. `saisie` exige donc de RETAPER le nom de la cible — l'œil doit l'avoir
// lu pour que la main l'écrive, et une ligne qui aurait glissé sous le curseur
// porte un autre nom. La confirmation reste inerte tant que le texte n'est pas
// exactement celui-là. Réservé à ce geste-là : partout ailleurs, la question
// qui nomme sa cible suffit, et une saisie de plus apprendrait à taper sans lire.

export function GesteIrreversible({
  libelle,
  ariaLabel,
  question,
  confirmer,
  onConfirmer,
  disabled = false,
  saisie,
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
  /** Le texte à retaper pour confirmer (le nom de la cible). Absent : un clic suffit. */
  saisie?: string;
}) {
  const t = useT();
  const [arme, setArme] = useState(false);
  const [tape, setTape] = useState('');
  const desarmer = () => {
    setArme(false);
    setTape('');
  };
  const retape = saisie === undefined || tape === saisie;

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
      {saisie !== undefined && (
        <input
          className="geste-irr-saisie"
          type="text"
          value={tape}
          placeholder={saisie}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          aria-label={t(`Tapez « ${saisie} » pour confirmer`, `Type “${saisie}” to confirm`)}
          onChange={(e) => setTape(e.target.value)}
        />
      )}
      <button className="btn ghost geste-irr-non" disabled={disabled} onClick={desarmer}>
        {t('Annuler', 'Cancel')}
      </button>
      <button
        className="btn geste-irr-oui"
        disabled={disabled || !retape}
        onClick={() => {
          desarmer();
          onConfirmer();
        }}
      >
        {confirmer}
      </button>
    </span>
  );
}
