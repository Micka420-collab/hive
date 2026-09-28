// LE TERMINAL — une surface de lignes qu'on lit comme un terminal, une fois.
//
// La console en direct d'une tâche et le Journal de la ruche montraient des
// lignes chacun à sa façon : la console filtrait sa recherche sans rien
// surligner, le Journal n'avait NI recherche, NI copie, NI repli, et ne rendait
// que ses 40 dernières lignes. Les deux ont les mêmes gestes à offrir ; ils les
// trouvent ICI.
//
// ─── LES GESTES ─────────────────────────────────────────────────────────────
//
//   · CHERCHER : chaque occurrence est surlignée, « 3/17 » dit où l'on est,
//     Entrée / Maj+Entrée (ou n / N dans la zone) vont à la suivante / la
//     précédente — et « lignes trouvées seules » filtre ;
//   · NIVEAUX : un filtre par niveau PRÉSENT, avec son compte. Les niveaux
//     viennent de l'appelant, qui les tient d'un vrai signal (flux du
//     processus, gravité déclarée par l'agent, sévérité d'un événement) —
//     ce composant n'en devine aucun ;
//   · SUIVRE : la zone colle au bas tant qu'on n'est pas remonté lire ;
//     remonter la détache (sinon chaque ligne arracherait celle qu'on lit),
//     et « ↓ N nouvelles lignes » dit ce qui est arrivé depuis ;
//   · COPIER : la sélection, ou toutes les lignes affichées. Le texte copié
//     est celui de l'écran — la sortie d'un agent a été caviardée par son nœud
//     avant de partir (`shared/caviardage.ts`) : rien de plus n'est lisible ;
//   · REPLIER, PLEIN ÉCRAN, HEURES.
//
// ─── POURQUOI VIRTUALISÉ ────────────────────────────────────────────────────
//
// La console garde 256 Kio par tâche (`sorties-directes.ts`) : des dizaines de
// milliers de lignes, re-rendues quatre fois par seconde. Rendre chaque ligne
// en DOM figeait l'onglet ; seules les lignes dans la vue (et une marge) sont
// rendues. Sans repli, une ligne a une hauteur fixe (`HAUTEUR_LIGNE`) ; repliée,
// sa hauteur est MESURÉE une fois rendue, et estimée tant qu'elle ne l'a pas été.
// COMPROMIS ACCEPTÉ : la sélection native ne couvre que les lignes rendues —
// « tout copier » est là pour le reste.

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { KeyboardEvent, ReactNode } from 'react';
import { copierTexte } from '../copier';
import { useT } from '../i18n';

/** Hauteur d'une ligne non repliée, en px — la même que `.ds-terminal-ligne`. */
export const HAUTEUR_LIGNE = 20;
/** Lignes rendues au-delà de la vue, de part et d'autre : le défilement ne découvre pas de vide. */
const MARGE_LIGNES = 30;
/** Distance au bas (px) sous laquelle la zone est « en bas ». */
const SEUIL_BAS_PX = 24;
/** Hauteur supposée d'une zone que la mise en page n'a pas encore mesurée. */
const VUE_PAR_DEFAUT_PX = 400;

export interface LigneTerminal {
  texte: string;
  /** Clé d'un `NiveauTerminal` de l'appelant. */
  niveau: string;
  /** Instant où la ligne est née (ou a été reçue — l'appelant le dit dans son libellé). */
  horodatage?: number;
  /** Un glyphe devant le texte (l'icône d'un événement) : hors recherche. */
  icone?: string;
  /** Une classe de plus sur la ligne (la teinte d'un événement du Journal). */
  classe?: string;
}

export interface NiveauTerminal {
  cle: string;
  libelle: string;
  /** Repère visible devant la ligne : la couleur seule ne suffit pas à dire le niveau. */
  repere: string;
}

/** Une occurrence de la recherche : ligne (dans les lignes AFFICHÉES) et position. */
export interface Occurrence {
  ligne: number;
  debut: number;
}

/** Toutes les occurrences de `requete` (insensible à la casse), dans l'ordre. */
export function occurrences(lignes: readonly LigneTerminal[], requete: string): Occurrence[] {
  const r = requete.toLowerCase();
  if (r === '') return [];
  const out: Occurrence[] = [];
  lignes.forEach((l, ligne) => {
    const t = l.texte.toLowerCase();
    for (let i = t.indexOf(r); i >= 0; i = t.indexOf(r, i + r.length))
      out.push({ ligne, debut: i });
  });
  return out;
}

/** Le premier indice `i` tel que `debuts[i + 1] > y` : la ligne sous l'ordonnée `y`. */
function ligneA(debuts: Float64Array, y: number): number {
  let bas = 0;
  let haut = debuts.length - 2;
  while (bas < haut) {
    const m = (bas + haut + 1) >> 1;
    if ((debuts[m] ?? 0) <= y) bas = m;
    else haut = m - 1;
  }
  return Math.max(0, bas);
}

/** Les lignes à rendre pour une vue `[haut, haut + vue]`, marge comprise. */
export function fenetreVisible(
  debuts: Float64Array,
  haut: number,
  vue: number,
): { premiere: number; derniere: number } {
  const n = debuts.length - 1;
  if (n <= 0) return { premiere: 0, derniere: 0 };
  const premiere = Math.max(0, ligneA(debuts, haut) - MARGE_LIGNES);
  const derniere = Math.min(n, ligneA(debuts, haut + vue) + 1 + MARGE_LIGNES);
  return { premiere, derniere };
}

/** Le texte d'une ligne, occurrences surlignées ; l'occurrence courante marquée. */
function Surligne({
  texte,
  longueur,
  debuts,
  courante,
}: {
  texte: string;
  longueur: number;
  debuts: readonly number[];
  courante: number | null;
}) {
  if (debuts.length === 0) return <>{texte}</>;
  const morceaux: ReactNode[] = [];
  let curseur = 0;
  for (const d of debuts) {
    if (d > curseur) morceaux.push(texte.slice(curseur, d));
    const estCourante = d === courante;
    morceaux.push(
      <mark
        key={d}
        className={`ds-terminal-marque${estCourante ? ' courante' : ''}`}
        {...(estCourante ? { 'aria-current': true } : {})}
      >
        {texte.slice(d, d + longueur)}
      </mark>,
    );
    curseur = d + longueur;
  }
  if (curseur < texte.length) morceaux.push(texte.slice(curseur));
  return <>{morceaux}</>;
}

const heure = (ts: number): string => new Date(ts).toLocaleTimeString();

interface Props {
  titre: ReactNode;
  lignes: readonly LigneTerminal[];
  niveaux: readonly NiveauTerminal[];
  /** Ce que dit la zone tant qu'aucune ligne n'est arrivée. */
  vide: ReactNode;
  /** Des avis entre la barre et la zone (début évincé, journal incomplet). */
  avis?: ReactNode;
  /** Replier les lignes longues au départ. */
  replierAuDepart?: boolean;
  /** Montrer les heures au départ (pour des lignes qui en portent). */
  heuresAuDepart?: boolean;
  /** Ce que désigne l'heure d'une ligne — « reçue à », « émise à ». */
  libelleHeure?: string;
  /** Des classes de plus, pour les feuilles qui stylent déjà ces zones. */
  classes?: { racine?: string; zone?: string; ligne?: string; texte?: string; heure?: string };
  testId?: string;
}

export function Terminal({
  titre,
  lignes,
  niveaux,
  vide,
  avis,
  replierAuDepart = false,
  heuresAuDepart = false,
  libelleHeure,
  classes = {},
  testId,
}: Props) {
  const t = useT();
  const base = useId();
  const [recherche, setRecherche] = useState('');
  const [seulesTrouvees, setSeulesTrouvees] = useState(false);
  const [masques, setMasques] = useState<ReadonlySet<string>>(() => new Set());
  const [courante, setCourante] = useState(0);
  const [suivre, setSuivre] = useState(true);
  const [replier, setReplier] = useState(replierAuDepart);
  const [heures, setHeures] = useState(heuresAuDepart);
  const [plein, setPlein] = useState(false);
  const [copie, setCopie] = useState<'ok' | 'echec' | null>(null);
  const [selection, setSelection] = useState(false);
  const [haut, setHaut] = useState(0);
  const [vue, setVue] = useState(VUE_PAR_DEFAUT_PX);
  // Hauteurs MESURÉES des lignes repliées, par ligne (objet stable de l'appelant).
  // Faiblement tenues : une ligne évincée du tampon emporte sa mesure — une
  // tâche de plusieurs heures les aurait sinon toutes gardées. `versionMesures`
  // dit à React qu'une mesure a changé.
  const mesures = useRef(new WeakMap<LigneTerminal, number>());
  const [versionMesures, setVersionMesures] = useState(0);
  // La dernière ligne vue en se détachant du bas : ce qui la suit est « nouveau ».
  const [repere, setRepere] = useState<LigneTerminal | null>(null);
  const racine = useRef<HTMLElement>(null);
  const zone = useRef<HTMLDivElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  const parNiveau = useMemo(() => {
    const compte = new Map<string, number>();
    for (const l of lignes) compte.set(l.niveau, (compte.get(l.niveau) ?? 0) + 1);
    return compte;
  }, [lignes]);
  const requete = recherche.trim();
  const parNiveauAffiche = useMemo(
    () => (masques.size === 0 ? lignes : lignes.filter((l) => !masques.has(l.niveau))),
    [lignes, masques],
  );
  const trouvees = useMemo(
    () => occurrences(parNiveauAffiche, requete),
    [parNiveauAffiche, requete],
  );
  const affichees = useMemo(() => {
    if (!seulesTrouvees || requete === '') return parNiveauAffiche;
    const garder = new Set(trouvees.map((o) => o.ligne));
    return parNiveauAffiche.filter((_, i) => garder.has(i));
  }, [parNiveauAffiche, seulesTrouvees, requete, trouvees]);
  // Les occurrences, rapportées aux lignes AFFICHÉES (le filtre les renumérote).
  const occ = useMemo(
    () => (affichees === parNiveauAffiche ? trouvees : occurrences(affichees, requete)),
    [affichees, parNiveauAffiche, trouvees, requete],
  );
  const parLigne = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const o of occ) {
      const liste = m.get(o.ligne);
      if (liste) liste.push(o.debut);
      else m.set(o.ligne, [o.debut]);
    }
    return m;
  }, [occ]);
  const indexCourant = occ.length === 0 ? -1 : Math.min(courante, occ.length - 1);

  // Le début de chaque ligne, en px : fixe sans repli, mesuré (ou estimé) replié.
  const debuts = useMemo(() => {
    const d = new Float64Array(affichees.length + 1);
    for (let i = 0; i < affichees.length; i += 1) {
      const l = affichees[i]!;
      d[i + 1] =
        (d[i] ?? 0) + (replier ? (mesures.current.get(l) ?? HAUTEUR_LIGNE) : HAUTEUR_LIGNE);
    }
    return d;
    // `versionMesures` : les mesures vivent dans une référence, pas dans
    // l'état — c'est elle qui dit qu'une mesure a changé.
  }, [affichees, replier, versionMesures]);
  const total = debuts[debuts.length - 1] ?? 0;
  const { premiere, derniere } = fenetreVisible(debuts, haut, vue);

  const nouvelles = useMemo(() => {
    if (suivre || repere === null) return 0;
    const i = lignes.lastIndexOf(repere);
    return i < 0 ? lignes.length : lignes.length - 1 - i;
  }, [suivre, repere, lignes]);

  const defiler = useCallback((y: number) => {
    const el = zone.current;
    if (el) el.scrollTop = y;
    setHaut(y);
  }, []);

  // Après le rendu, AVANT la peinture : la vue, puis le bas si l'on suit —
  // sinon chaque ligne clignoterait en haut puis sauterait en bas.
  useLayoutEffect(() => {
    const el = zone.current;
    if (!el) return;
    if (el.clientHeight > 0 && el.clientHeight !== vue) setVue(el.clientHeight);
    if (suivre) {
      const bas = Math.max(0, total - (el.clientHeight || vue));
      if (el.scrollTop !== bas || haut !== bas) defiler(bas);
    }
  }, [total, suivre, vue, haut, defiler]);

  // Repliées, les lignes rendues sont mesurées : leur hauteur réelle remplace
  // l'estimation. Une hauteur nulle (zone cachée, rendu hors page) n'apprend
  // rien et est ignorée.
  useLayoutEffect(() => {
    if (!replier) return;
    const el = zone.current;
    if (!el) return;
    let change = false;
    for (const noeud of el.querySelectorAll<HTMLElement>('[data-ligne]')) {
      const l = affichees[Number(noeud.dataset.ligne)];
      const h = noeud.offsetHeight;
      if (!l || h <= 0 || mesures.current.get(l) === h) continue;
      mesures.current.set(l, h);
      change = true;
    }
    if (change) setVersionMesures((v) => v + 1);
  });

  // Largeur changée (plein écran, fenêtre) : les lignes repliées se re-mesurent.
  useEffect(() => {
    const el = zone.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    let largeur = el.clientWidth;
    const obs = new ResizeObserver(() => {
      if (el.clientHeight > 0) setVue(el.clientHeight);
      if (el.clientWidth !== largeur) {
        largeur = el.clientWidth;
        mesures.current = new WeakMap();
        setVersionMesures((v) => v + 1);
      }
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    if (copie === null) return;
    const minuteur = window.setTimeout(() => setCopie(null), 1500);
    return () => window.clearTimeout(minuteur);
  }, [copie]);

  // Une sélection DANS la zone rend « copier la sélection » possible.
  useEffect(() => {
    const suivreSelection = () => {
      const s = document.getSelection();
      const el = zone.current;
      setSelection(!!s && !s.isCollapsed && !!el && !!s.anchorNode && el.contains(s.anchorNode));
    };
    document.addEventListener('selectionchange', suivreSelection);
    return () => document.removeEventListener('selectionchange', suivreSelection);
  }, []);

  // Le plein écran natif se quitte aussi par Échap, sans passer par nous.
  useEffect(() => {
    const synchroniser = () => {
      if (document.fullscreenElement !== racine.current) setPlein(false);
    };
    document.addEventListener('fullscreenchange', synchroniser);
    return () => document.removeEventListener('fullscreenchange', synchroniser);
  }, []);

  const detacher = () => {
    setSuivre(false);
    setRepere(lignes[lignes.length - 1] ?? null);
  };

  const basculerSuivre = (oui: boolean) => {
    if (oui) setSuivre(true);
    else detacher();
  };

  const auDefilement = () => {
    const el = zone.current;
    if (!el) return;
    setHaut(el.scrollTop);
    const enBas = el.scrollHeight - el.scrollTop - el.clientHeight <= SEUIL_BAS_PX;
    if (enBas && !suivre) setSuivre(true);
    else if (!enBas && suivre) detacher();
  };

  /** Va à l'occurrence `i` (en boucle) : elle vient au milieu de la vue. */
  const allerA = (i: number) => {
    if (occ.length === 0) return;
    const n = ((i % occ.length) + occ.length) % occ.length;
    setCourante(n);
    detacher();
    const ligne = occ[n]!.ligne;
    const y = (debuts[ligne] ?? 0) - vue / 2 + HAUTEUR_LIGNE / 2;
    defiler(Math.max(0, Math.min(y, total - vue)));
  };

  const texteAffiche = () =>
    affichees
      .map((l) =>
        heures && l.horodatage !== undefined ? `${heure(l.horodatage)} ${l.texte}` : l.texte,
      )
      .join('\n');

  const copier = async (quoi: 'selection' | 'tout') => {
    const texte = quoi === 'tout' ? texteAffiche() : (document.getSelection()?.toString() ?? '');
    setCopie((await copierTexte(texte)) ? 'ok' : 'echec');
  };

  const basculerPlein = () => {
    const el = racine.current;
    if (plein) {
      if (document.fullscreenElement === el) void document.exitFullscreen?.();
      setPlein(false);
      return;
    }
    setPlein(true);
    // Le plein écran NATIF quand le navigateur l'offre ; sinon la zone couvre
    // la fenêtre (classe `plein`), ce qui suffit à lire un long log.
    void el?.requestFullscreen?.().catch(() => undefined);
  };

  // Depuis l'état COURANT, pas celui du rendu : deux bascules dans le même
  // lot (clics rapides) partaient du même ensemble, et la première se perdait.
  const basculerNiveau = (cle: string) =>
    setMasques((avant) => {
      const suite = new Set(avant);
      if (suite.has(cle)) suite.delete(cle);
      else suite.add(cle);
      return suite;
    });

  const toucheZone = (e: KeyboardEvent<HTMLElement>) => {
    // Échap quitte le plein écran, et SEULEMENT lui : le tiroir autour ne se
    // ferme pas avec.
    if (e.key === 'Escape' && plein) {
      e.preventDefault();
      e.stopPropagation();
      basculerPlein();
      return;
    }
    // Les raccourcis à une lettre ne valent que dans la ZONE : ailleurs, « n »
    // est une lettre qu'on tape, ou la touche d'un bouton.
    if (e.target !== zone.current || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === '/') {
      e.preventDefault();
      champ.current?.focus();
    } else if (e.key === 'n' || e.key === 'N') {
      e.preventDefault();
      allerA(indexCourant + (e.key === 'n' ? 1 : -1));
    }
  };

  const toucheRecherche = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      allerA(indexCourant + (e.shiftKey ? -1 : 1));
    } else if (e.key === 'Escape' && recherche !== '') {
      e.preventDefault();
      e.stopPropagation();
      setRecherche('');
    }
  };

  const presents = niveaux.filter((n) => (parNiveau.get(n.cle) ?? 0) > 0);
  const avecHeures = lignes.some((l) => l.horodatage !== undefined);
  const idTitre = `${base}-titre`;
  const texteCopie =
    copie === 'ok'
      ? t('✔ copié', '✔ copied')
      : copie === 'echec'
        ? t('copie impossible', 'copy failed')
        : null;

  return (
    <section
      ref={racine}
      className={`ds-terminal${plein ? ' plein' : ''}${classes.racine ? ` ${classes.racine}` : ''}`}
      aria-labelledby={idTitre}
      onKeyDown={toucheZone}
    >
      <div className="ds-terminal-barre">
        <h3 id={idTitre} className="ds-terminal-titre">
          {titre}
        </h3>
        <div className="ds-terminal-actions" role="toolbar" aria-label={t('Contrôles', 'Controls')}>
          <input
            ref={champ}
            type="search"
            className="ds-terminal-recherche"
            value={recherche}
            onChange={(e) => {
              setRecherche(e.target.value);
              setCourante(0);
            }}
            onKeyDown={toucheRecherche}
            placeholder={t('chercher… (/)', 'search… (/)')}
            aria-label={t('Chercher dans les lignes', 'Search the lines')}
            aria-keyshortcuts="/"
          />
          {requete !== '' && (
            <>
              <span className="ds-terminal-compte" role="status">
                {occ.length === 0 ? t('aucune', 'none') : `${indexCourant + 1}/${occ.length}`}
              </span>
              <button
                type="button"
                className="chip"
                onClick={() => allerA(indexCourant - 1)}
                disabled={occ.length === 0}
                aria-label={t('Occurrence précédente (Maj+Entrée)', 'Previous match (Shift+Enter)')}
              >
                ↑
              </button>
              <button
                type="button"
                className="chip"
                onClick={() => allerA(indexCourant + 1)}
                disabled={occ.length === 0}
                aria-label={t('Occurrence suivante (Entrée)', 'Next match (Enter)')}
              >
                ↓
              </button>
              <button
                type="button"
                className={`chip${seulesTrouvees ? ' active' : ''}`}
                aria-pressed={seulesTrouvees}
                onClick={() => setSeulesTrouvees(!seulesTrouvees)}
              >
                {t('lignes trouvées seules', 'matching lines only')}
              </button>
            </>
          )}
          <button
            type="button"
            className={`chip${suivre ? ' active' : ''}`}
            aria-pressed={suivre}
            onClick={() => basculerSuivre(!suivre)}
          >
            {t('suivre', 'follow')}
          </button>
          <button
            type="button"
            className={`chip${replier ? ' active' : ''}`}
            aria-pressed={replier}
            onClick={() => setReplier(!replier)}
          >
            {t('replier', 'wrap')}
          </button>
          {avecHeures && (
            <button
              type="button"
              className={`chip${heures ? ' active' : ''}`}
              aria-pressed={heures}
              onClick={() => setHeures(!heures)}
              title={libelleHeure}
            >
              {t('heures', 'times')}
            </button>
          )}
          {/* Offert seulement quand il y a de quoi : la barre tient aussi dans
              la colonne étroite du Journal. `preventDefault` au clic : le
              bouton ne doit pas effacer la sélection qu'il va copier. */}
          {selection && (
            <button
              type="button"
              className="chip"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void copier('selection')}
            >
              {t('copier la sélection', 'copy selection')}
            </button>
          )}
          <button
            type="button"
            className="chip"
            onClick={() => void copier('tout')}
            disabled={affichees.length === 0}
            title={t(
              'Toutes les lignes affichées (filtres appliqués)',
              'Every displayed line (filters applied)',
            )}
          >
            {t(`tout copier (${affichees.length})`, `copy all (${affichees.length})`)}
          </button>
          <button
            type="button"
            className={`chip${plein ? ' active' : ''}`}
            aria-pressed={plein}
            onClick={basculerPlein}
            aria-label={t('Plein écran (Échap pour quitter)', 'Fullscreen (Esc to leave)')}
            title={t('Plein écran (Échap pour quitter)', 'Fullscreen (Esc to leave)')}
          >
            ⛶
          </button>
          {texteCopie && (
            <span className="ds-terminal-compte" role="status">
              {texteCopie}
            </span>
          )}
        </div>
      </div>
      {presents.length > 1 && (
        <div className="ds-terminal-niveaux" role="group" aria-label={t('Niveaux', 'Levels')}>
          {presents.map((n) => {
            const visible = !masques.has(n.cle);
            return (
              <button
                key={n.cle}
                type="button"
                className={`chip${visible ? ' active' : ''}`}
                aria-pressed={visible}
                data-niveau={n.cle}
                onClick={() => basculerNiveau(n.cle)}
              >
                <span className={`ds-terminal-repere niveau-${n.cle}`} aria-hidden="true">
                  {n.repere}
                </span>{' '}
                {n.libelle} <span className="chip-count">{parNiveau.get(n.cle)}</span>
              </button>
            );
          })}
        </div>
      )}
      {avis}
      <div className="ds-terminal-cadre">
        <div
          ref={zone}
          className={`ds-terminal-zone${replier ? ' replie' : ''}${classes.zone ? ` ${classes.zone}` : ''}`}
          data-testid={testId}
          onScroll={auDefilement}
          tabIndex={0}
          role="log"
          aria-live="off"
          aria-labelledby={idTitre}
          aria-keyshortcuts="/ n Shift+N"
        >
          {lignes.length === 0 ? (
            <p className="ds-terminal-vide">{vide}</p>
          ) : affichees.length === 0 ? (
            // Des lignes, toutes masquées : la zone le dit, elle ne reste pas
            // vide comme si l'agent n'avait rien écrit.
            <p className="ds-terminal-vide" data-testid={testId && `${testId}-filtree`}>
              {t(
                `Aucune des ${lignes.length} ligne(s) ne passe les filtres.`,
                `None of the ${lignes.length} line(s) pass the filters.`,
              )}
            </p>
          ) : (
            <div className="ds-terminal-espace" style={{ height: total }}>
              {affichees.slice(premiere, derniere).map((l, k) => {
                const i = premiere + k;
                const n = niveaux.find((x) => x.cle === l.niveau);
                const courant = indexCourant >= 0 && occ[indexCourant]!.ligne === i;
                return (
                  <div
                    key={i}
                    data-ligne={i}
                    className={`ds-terminal-ligne niveau-${l.niveau}${l.classe ? ` ${l.classe}` : ''}${classes.ligne ? ` ${classes.ligne}` : ''}`}
                    style={{ top: debuts[i] }}
                  >
                    <span
                      className={`ds-terminal-repere niveau-${l.niveau}`}
                      title={n?.libelle}
                      aria-label={n?.libelle}
                    >
                      {l.icone ?? n?.repere ?? ''}
                    </span>
                    <span
                      className={`ds-terminal-texte${classes.texte ? ` ${classes.texte}` : ''}`}
                    >
                      <Surligne
                        texte={l.texte}
                        longueur={requete.length}
                        debuts={parLigne.get(i) ?? []}
                        courante={courant ? occ[indexCourant]!.debut : null}
                      />
                    </span>
                    {heures && l.horodatage !== undefined && (
                      <time
                        className={`ds-terminal-heure${classes.heure ? ` ${classes.heure}` : ''}`}
                        dateTime={new Date(l.horodatage).toISOString()}
                      >
                        {heure(l.horodatage)}
                      </time>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
        {nouvelles > 0 && (
          <button
            type="button"
            className="chip active ds-terminal-nouvelles"
            onClick={() => basculerSuivre(true)}
          >
            {t(`↓ ${nouvelles} nouvelle(s) ligne(s)`, `↓ ${nouvelles} new line(s)`)}
          </button>
        )}
      </div>
    </section>
  );
}
