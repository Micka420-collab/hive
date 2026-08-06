// Vue « Le Cerveau » — le savoir de la ruche, exploré.
//
// ─── CE QU'ON REGARDE, ET POURQUOI ───────────────────────────────────────────
//
// Le Cerveau grossit tout seul : chaque échec y dépose un épisode, chaque
// consolidation y propose une leçon. Un dossier de markdown se lit note par
// note — et une note à la fois ne dit rien de la FORME de l'ensemble : ce qui
// se raccroche à quoi, ce qui sert vraiment, ce qui dort depuis trois mois.
//
// L'écran ne montre pas le CONTENU des notes (l'API ne l'envoie même pas). Il
// montre leur forme, leur usage, et il laisse CHERCHER dedans.
//
// ─── LES QUATRE DÉCISIONS D'INTERFACE ────────────────────────────────────────
//
//   1. DEUX MODES, PAS UN. Un canevas est muet pour un lecteur d'écran et
//      inutilisable au clavier. La vue LISTE n'est donc pas un repli dégradé :
//      c'est la même information, dans un tableau navigable, et elle rend le
//      graphe accessible sans l'appauvrir. Le dépôt tient déjà `NO_COLOR`,
//      `TERM=dumb` et l'absence de TTY — un écran qui n'existerait qu'en pixels
//      serait le seul endroit où cette exigence s'arrête.
//
//   2. L'INFORMATION NE PASSE JAMAIS PAR LA SEULE ANIMATION. Le halo qui
//      respire dit « ça a servi récemment » ; la COULEUR et le point CREUX le
//      disent aussi. Sous `prefers-reduced-motion`, la pulsation s'arrête et
//      rien ne se perd — sinon réduire le mouvement effacerait une mesure.
//
//   3. FILTRER NE DOIT PAS MENTIR. Le sous-graphe vient de `filtrer()`, qui est
//      pur et testé : une arête ne survit que si ses deux bouts survivent. Ce
//      fichier ne décide rien de tout cela, il le dessine.
//
//   4. LES CHIFFRES DE L'EN-TÊTE PARLENT DU CERVEAU ENTIER, ceux des panneaux
//      de ce qui est affiché. Les confondre ferait lire « 3 notes » sur un
//      écran qui en montre trente — ou l'inverse.
//
// ─── POURQUOI LA PHYSIQUE EST ÉCRITE À LA MAIN ───────────────────────────────
//
// Le critère 3 du dépôt est « 0 nouvelle dépendance », et il vaut aussi pour le
// tableau de bord. Une bibliothèque de graphe pèserait plus lourd que tout le
// reste, pour trois forces qu'on écrit en cinquante lignes.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCerveau } from '../api';
import type { CerveauGraphe, NoeudGraphe } from '../api';
import { filtrer, voisins } from '../../../src/shared/cerveau-graphe.js';
import type { Genre } from '../../../src/shared/cerveau.js';
import { useT } from '../i18n';
import { useApiPoll } from './shared';
import type { ViewProps } from './shared';
import './cerveau.css';
import { rappelerAuCentre } from './cerveau-physique';
import {
  chaleur,
  corpsSousLePoint,
  estEteinte,
  rayon,
  selectionAuRelacher,
} from './cerveau-designation';

/** Une couleur par genre — l'ordre des genres EST leur priorité. */
const COULEUR: Record<string, string> = {
  invariant: '#ff6b6b',
  lecon: '#f6c445',
  decision: '#6bb8e8',
  carte: '#c48cff',
  episode: '#a2957d',
};

const LIBELLE: Record<string, { fr: string; en: string }> = {
  invariant: { fr: 'invariants', en: 'invariants' },
  lecon: { fr: 'leçons', en: 'lessons' },
  decision: { fr: 'décisions', en: 'decisions' },
  carte: { fr: 'cartes', en: 'maps' },
  episode: { fr: 'épisodes', en: 'episodes' },
};

const GENRES_ORDRE: Genre[] = ['invariant', 'lecon', 'decision', 'carte', 'episode'];

interface Corps {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** 0 → 1 : l'apparition. Une note nouvelle GRANDIT au lieu de surgir. */
  naissance: number;
  n: NoeudGraphe;
}

// Le rayon d'une note vit désormais dans `cerveau-designation.ts` avec le test
// de proximité qui s'en sert : les deux règles se jugent ensemble, hors du
// canevas où rien ne s'exécute sous banc. `chaleur` (ancienneté → 0..1) a
// rejoint `cerveau-designation.ts`, aux côtés de `rayon` : une garde survivante
// du balayage, sortie de la boucle de dessin pour s'éprouver au point près.

/** Le système demande-t-il moins de mouvement ? */
function mouvementReduit(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export default function Cerveau(_props: ViewProps) {
  const t = useT();
  const poll = useApiPoll<CerveauGraphe>(fetchCerveau, 10_000);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const corps = useRef<Map<string, Corps>>(new Map());
  const vue = useRef({ zoom: 1, dx: 0, dy: 0 });
  const attrape = useRef<{ id: string | null; fond: boolean; x: number; y: number }>({
    id: null,
    fond: false,
    x: 0,
    y: 0,
  });
  const survole = useRef<string | null>(null);

  const [mode, setMode] = useState<'graphe' | 'liste'>('graphe');
  const [texte, setTexte] = useState('');
  const [genres, setGenres] = useState<Genre[]>([]);
  const [dormantes, setDormantes] = useState(false);
  const [choisi, setChoisi] = useState<string | null>(null);
  const [bulle, setBulle] = useState<{ x: number; y: number; n: NoeudGraphe } | null>(null);

  const entier = poll.data;
  const g = useMemo(
    () => (entier ? filtrer(entier, { texte, genres, dormantes }) : null),
    [entier, texte, genres, dormantes],
  );

  const parId = useMemo(() => new Map((g?.noeuds ?? []).map((n) => [n.id, n])), [g]);
  const proches = useMemo(() => (g && choisi ? new Set(voisins(g, choisi)) : null), [g, choisi]);
  const noteChoisie = choisi === null ? null : (parId.get(choisi) ?? null);

  const basculerGenre = (x: Genre): void =>
    setGenres((liste) => (liste.includes(x) ? liste.filter((y) => y !== x) : [...liste, x]));

  const recentrer = (): void => {
    vue.current = { zoom: 1, dx: 0, dy: 0 };
    corps.current.clear();
  };

  // ── La simulation ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (mode !== 'graphe') return;
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    const calme = mouvementReduit();
    let vivant = true;
    let t0 = 0;
    let tours = 0;

    const boucle = (temps: number) => {
      if (!vivant) return;
      const dt = t0 === 0 ? 16 : Math.min(48, temps - t0);
      t0 = temps;
      tours += 1;

      const dpr = window.devicePixelRatio || 1;
      const L = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== L * dpr || c.height !== H * dpr) {
        c.width = L * dpr;
        c.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const bodies = corps.current;
      if (g) {
        const vus = new Set(g.noeuds.map((n) => n.id));
        for (const n of g.noeuds) {
          const deja = bodies.get(n.id);
          if (deja) {
            deja.n = n;
            continue;
          }
          const angle = Math.random() * Math.PI * 2;
          bodies.set(n.id, {
            id: n.id,
            x: L / 2 + Math.cos(angle) * 50,
            y: H / 2 + Math.sin(angle) * 50,
            vx: 0,
            vy: 0,
            // Mouvement réduit : la note est là d'emblée, à sa taille.
            naissance: calme ? 1 : 0,
            n,
          });
        }
        for (const id of [...bodies.keys()]) if (!vus.has(id)) bodies.delete(id);
      }

      const liste = [...bodies.values()];

      // Sous mouvement réduit, on laisse la disposition se poser puis on fige :
      // un graphe qui frémit en permanence est exactement ce que ce réglage
      // demande d'éviter.
      const fige = calme && tours > 200;

      if (!fige) {
        // ── Force 1 : répulsion ─────────────────────────────────────────────
        // O(n²) assumé : le Cerveau est BORNÉ (élagage à 500 épisodes). Un
        // quadtree serait de la complexité payée pour un cas qui n'arrive pas.
        for (let i = 0; i < liste.length; i++) {
          for (let j = i + 1; j < liste.length; j++) {
            const a = liste[i]!;
            const b = liste[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            if (d2 < 0.01) {
              // Deux corps exactement superposés : sans ce coup de pouce, la
              // division par zéro les fige l'un dans l'autre pour toujours.
              dx = Math.random() - 0.5;
              dy = Math.random() - 0.5;
              d2 = 0.01;
            }
            const d = Math.sqrt(d2);
            const f = Math.min(3, 2600 / d2);
            a.vx -= (dx / d) * f;
            a.vy -= (dy / d) * f;
            b.vx += (dx / d) * f;
            b.vy += (dy / d) * f;
          }
        }
        // ── Force 2 : le ressort des liens ──────────────────────────────────
        for (const a of g?.aretes ?? []) {
          const p = bodies.get(a.de);
          const q = bodies.get(a.vers);
          if (!p || !q) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          const f = (d - 118) * 0.0016;
          p.vx += (dx / d) * f * d * 0.5;
          p.vy += (dy / d) * f * d * 0.5;
          q.vx -= (dx / d) * f * d * 0.5;
          q.vy -= (dy / d) * f * d * 0.5;
        }
        // ── Force 3 : rappel au centre ──────────────────────────────────────
        //
        // SORTIE DU CANEVAS, et c'est délibéré : `getContext` rend null sous
        // happy-dom, donc rien de cette boucle n'était éprouvé — le balayage
        // par mutation l'a montré sur « le doigt gagne ». Voir
        // `cerveau-physique.ts`, qui porte la règle et ses tests.
        rappelerAuCentre(liste, { L, H, dt, attrapeId: attrape.current.id });
      }
      for (const p of liste) {
        if (p.naissance < 1) p.naissance = Math.min(1, p.naissance + dt / 420);
      }

      // ── Le dessin ─────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, L, H);
      ctx.save();
      ctx.translate(vue.current.dx, vue.current.dy);
      ctx.scale(vue.current.zoom, vue.current.zoom);

      const actif = choisi ?? survole.current;
      // `proches` est DÉJÀ null quand rien n'est choisi (son useMemo l'exige) :
      // le `choisi !== null ?` qui vivait ici ne retirait jamais rien. Une
      // garde qui ne garde rien reste une garde qu'un jour on mute — le
      // balayage l'avait justement signalée survivante.

      for (const a of g?.aretes ?? []) {
        const p = bodies.get(a.de);
        const q = bodies.get(a.vers);
        if (!p || !q) continue;
        const touche = actif === null || a.de === actif || a.vers === actif;
        ctx.globalAlpha = (touche ? 0.4 : 0.06) * Math.min(p.naissance, q.naissance);
        ctx.strokeStyle = a.reciproque ? '#f6c445' : '#4a3c26';
        ctx.lineWidth = (a.reciproque ? 1.7 : 1.1) / vue.current.zoom;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      for (const p of liste) {
        const r = rayon(p.n) * p.naissance;
        const ch = chaleur(p.n);
        const eteint = estEteinte(p.id, actif, proches);
        const couleur = COULEUR[p.n.genre] ?? '#888';

        // Le halo : une note qui a servi récemment RESPIRE. Sous mouvement
        // réduit il reste, fixe — c'est une mesure, pas une décoration.
        if (ch > 0 && !eteint) {
          const pulse = calme ? 1 : 1 + Math.sin(temps / 520 + p.x * 0.02) * 0.16;
          ctx.globalAlpha = ch * 0.28;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.4 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = couleur;
          ctx.fill();
        }

        ctx.globalAlpha = eteint ? 0.14 : 1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = couleur;
        ctx.fill();

        // Une note JAMAIS servie est creuse : du savoir stocké sans usage,
        // visible au premier coup d'œil.
        if (p.n.serviIlYaJours === null) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, r - 2.6), 0, Math.PI * 2);
          ctx.fillStyle = '#14100b';
          ctx.fill();
        }

        if (p.id === choisi) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / vue.current.zoom;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r + 5, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // ─── LES LIBELLÉS, EN UNE PASSE À PART ────────────────────────────────
      //
      // Deux raisons de les sortir de la boucle des nœuds.
      //
      // D'ABORD, QUI EN PORTE UN. Première version : tout ce qui dépassait un
      // certain rayon. Sur un cerveau réel, les épisodes sont l'écrasante
      // majorité — trente « épisode 12 — fetch failed » se chevauchaient et
      // cachaient exactement les notes qu'il fallait lire. Vu à l'écran, pas
      // déduit. Seule la CHARPENTE est nommée ; les épisodes se lisent au
      // survol, un par un.
      //
      // ENSUITE, LES COLLISIONS. Même réduits à la charpente, deux libellés
      // voisins se superposent et deviennent illisibles TOUS LES DEUX — on
      // perd deux informations au lieu d'une. On les pose donc par ordre de
      // priorité (le nœud actif d'abord, puis les mieux reliés), et un
      // libellé qui recouvrirait un déjà posé est SAUTÉ. Mieux vaut un nom
      // manquant qu'une bouillie : le nom manquant se retrouve au survol.
      const boites: { x: number; y: number; l: number; h: number }[] = [];
      const candidats = liste
        .filter((p) => {
          const eteint = estEteinte(p.id, actif, proches);
          const charpente = p.n.genre !== 'episode' && p.n.degre > 0;
          return !eteint && (p.id === actif || charpente);
        })
        .sort((a, b) => {
          if (a.id === actif) return -1;
          if (b.id === actif) return 1;
          return b.n.degre - a.n.degre || a.id.localeCompare(b.id);
        });

      const taille = 11 / vue.current.zoom;
      for (const p of candidats) {
        const r = rayon(p.n) * p.naissance;
        const mot = p.n.titre.slice(0, 34);
        ctx.font = `${p.id === actif ? '600 ' : ''}${taille}px ui-monospace, monospace`;
        const l = ctx.measureText(mot).width;
        const x = p.x + r + 6;
        const y = p.y + 3.5;
        const boite = { x, y: y - taille, l, h: taille * 1.35 };
        const heurte = boites.some(
          (b) =>
            boite.x < b.x + b.l &&
            boite.x + boite.l > b.x &&
            boite.y < b.y + b.h &&
            boite.y + boite.h > b.y,
        );
        // Le nœud actif passe TOUJOURS : c'est celui qu'on regarde.
        if (heurte && p.id !== actif) continue;
        boites.push(boite);

        ctx.globalAlpha = p.id === actif ? 1 : 0.78;
        // Un liseré sombre sous le texte : sans lui, un libellé posé sur une
        // arête ou un halo devient illisible.
        ctx.lineWidth = 3 / vue.current.zoom;
        ctx.strokeStyle = 'rgba(6,12,18,0.94)';
        ctx.strokeText(mot, x, y);
        ctx.fillStyle = '#f4eee0';
        ctx.fillText(mot, x, y);
      }
      ctx.restore();
      ctx.globalAlpha = 1;
      requestAnimationFrame(boucle);
    };

    const id = requestAnimationFrame(boucle);
    return () => {
      vivant = false;
      cancelAnimationFrame(id);
    };
  }, [g, choisi, proches, mode]);

  /** Coordonnées d'un événement, ramenées au repère du graphe. */
  const auGraphe = (ev: { clientX: number; clientY: number }): { x: number; y: number } => {
    const c = canvas.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    return {
      x: (ev.clientX - r.left - vue.current.dx) / vue.current.zoom,
      y: (ev.clientY - r.top - vue.current.dy) / vue.current.zoom,
    };
  };

  // La conversion écran → graphe reste ici (elle seule connaît le cadrage) ;
  // le choix du corps visé, lui, est une règle pure et éprouvée.
  const sous = (ev: { clientX: number; clientY: number }): Corps | null =>
    corpsSousLePoint(auGraphe(ev), corps.current.values());

  const vide = entier !== null && entier.total === 0;
  const rienDeFiltre = g !== null && g.total === 0 && entier !== null && entier.total > 0;

  return (
    <section className="cerveau">
      <header className="cerveau-tete">
        <div className="cerveau-titre">
          <h2>🧠 {t('Le Cerveau', 'The Brain')}</h2>
          <p>
            {t(
              'Ce que la ruche a retenu, et ce qui lui sert vraiment.',
              'What the hive has retained, and what it actually uses.',
            )}
          </p>
        </div>
        {/* Les tuiles parlent du cerveau ENTIER, jamais du sous-graphe filtré. */}
        {entier && (
          <ul className="cerveau-tuiles">
            <li>
              <div className="cerveau-tuile">
                <b>{entier.total}</b>
                <span>{t('notes', 'notes')}</span>
              </div>
            </li>
            <li>
              <div className="cerveau-tuile">
                <b>{entier.servies}</b>
                <span>{t('ont servi', 'used')}</span>
              </div>
            </li>
            <li>
              <button
                type="button"
                className={`cerveau-tuile cliquable${dormantes ? ' on' : ''}`}
                aria-pressed={dormantes}
                onClick={() => setDormantes((v) => !v)}
                title={t(
                  'N’afficher que les notes qui n’ont jamais servi',
                  'Show only notes that have never been used',
                )}
              >
                <b>{entier.total - entier.servies}</b>
                <span>{t('dorment', 'dormant')}</span>
              </button>
            </li>
            <li>
              <div className={`cerveau-tuile${entier.liensMorts.length > 0 ? ' alerte' : ''}`}>
                <b>{entier.liensMorts.length}</b>
                <span>{t('liens morts', 'dead links')}</span>
              </div>
            </li>
          </ul>
        )}
      </header>

      {poll.error !== null && <p className="cerveau-erreur">{poll.error}</p>}

      {!vide && entier !== null && (
        <div className="cerveau-barre">
          <input
            type="search"
            className="cerveau-recherche"
            value={texte}
            onChange={(e) => setTexte(e.target.value)}
            placeholder={t('Chercher une note…', 'Search a note…')}
            aria-label={t('Chercher une note', 'Search a note')}
          />
          <div className="cerveau-genres" role="group" aria-label={t('Genres', 'Kinds')}>
            {GENRES_ORDRE.map((x) => {
              const on = genres.includes(x);
              return (
                <button
                  key={x}
                  type="button"
                  className={`cerveau-puce${on ? ' on' : ''}`}
                  aria-pressed={on}
                  onClick={() => basculerGenre(x)}
                  style={on ? { borderColor: COULEUR[x], color: COULEUR[x] } : undefined}
                >
                  <i style={{ background: COULEUR[x] }} />
                  {t(LIBELLE[x]?.fr ?? x, LIBELLE[x]?.en ?? x)}
                  <b>{entier.parGenre[x]}</b>
                </button>
              );
            })}
          </div>
          <div className="cerveau-modes" role="group" aria-label={t('Affichage', 'Display')}>
            <button
              type="button"
              className={mode === 'graphe' ? 'on' : ''}
              aria-pressed={mode === 'graphe'}
              onClick={() => setMode('graphe')}
            >
              {t('Graphe', 'Graph')}
            </button>
            <button
              type="button"
              className={mode === 'liste' ? 'on' : ''}
              aria-pressed={mode === 'liste'}
              onClick={() => setMode('liste')}
            >
              {t('Liste', 'List')}
            </button>
          </div>
          {mode === 'graphe' && (
            <button type="button" className="cerveau-recentrer" onClick={recentrer}>
              {t('Recentrer', 'Recenter')}
            </button>
          )}
        </div>
      )}

      {vide ? (
        <div className="cerveau-vide">
          <p>
            {t(
              'Le Cerveau est vide — c’est l’état normal d’une ruche neuve.',
              'The Brain is empty — that is the normal state of a fresh hive.',
            )}
          </p>
          <p className="cerveau-vide-detail">
            {t(
              'Il se remplit tout seul : chaque échec y dépose un épisode, et une panne revue trois fois propose une leçon.',
              'It fills itself: every failure deposits an episode, and a fault seen three times proposes a lesson.',
            )}
          </p>
          <code>{entier?.dossier}</code>
        </div>
      ) : (
        <div className="cerveau-scene">
          {mode === 'graphe' ? (
            <div className="cerveau-toile-boite">
              <canvas
                ref={canvas}
                className="cerveau-toile"
                onMouseDown={(ev) => {
                  const p = sous(ev);
                  attrape.current = p
                    ? { id: p.id, fond: false, x: ev.clientX, y: ev.clientY }
                    : { id: null, fond: true, x: ev.clientX, y: ev.clientY };
                }}
                onMouseMove={(ev) => {
                  const a = attrape.current;
                  if (a.id !== null) {
                    const p = corps.current.get(a.id);
                    if (p) {
                      const { x, y } = auGraphe(ev);
                      p.x = x;
                      p.y = y;
                      p.vx = 0;
                      p.vy = 0;
                    }
                    return;
                  }
                  if (a.fond) {
                    vue.current.dx += ev.clientX - a.x;
                    vue.current.dy += ev.clientY - a.y;
                    attrape.current = { ...a, x: ev.clientX, y: ev.clientY };
                    return;
                  }
                  const p = sous(ev);
                  survole.current = p?.id ?? null;
                  const r = canvas.current?.getBoundingClientRect();
                  setBulle(
                    p && r
                      ? { x: ev.clientX - r.left + 14, y: ev.clientY - r.top + 12, n: p.n }
                      : null,
                  );
                }}
                onMouseUp={(ev) => {
                  const a = attrape.current;
                  // Un glisser n'est pas un clic : sans ce départage, déplacer
                  // une note la sélectionnerait toujours au relâcher. La DÉCISION
                  // (le seuil, et « un glisser ne choisit rien ») vit dans
                  // `selectionAuRelacher`, pure et éprouvée hors canevas ; ce qui
                  // reste ici n'est que la tuyauterie du canevas.
                  const choix = selectionAuRelacher(
                    { x: a.x, y: a.y },
                    { x: ev.clientX, y: ev.clientY },
                    sous(ev)?.id ?? null,
                  );
                  if (choix.choisir) setChoisi(choix.id);
                  attrape.current = { id: null, fond: false, x: 0, y: 0 };
                }}
                onMouseLeave={() => {
                  attrape.current = { id: null, fond: false, x: 0, y: 0 };
                  survole.current = null;
                  setBulle(null);
                }}
                onWheel={(ev) => {
                  const c = canvas.current;
                  if (!c) return;
                  const r = c.getBoundingClientRect();
                  const mx = ev.clientX - r.left;
                  const my = ev.clientY - r.top;
                  const avant = vue.current.zoom;
                  const apres = Math.min(4, Math.max(0.3, avant * (ev.deltaY < 0 ? 1.12 : 0.89)));
                  // Zoomer SOUS LE CURSEUR : un zoom centré sur la toile
                  // éloigne ce qu'on regardait, et on perd ce qu'on visait.
                  vue.current.dx = mx - ((mx - vue.current.dx) / avant) * apres;
                  vue.current.dy = my - ((my - vue.current.dy) / avant) * apres;
                  vue.current.zoom = apres;
                }}
              />
              {bulle && (
                <div className="cerveau-bulle" style={{ left: bulle.x, top: bulle.y }}>
                  <b>{bulle.n.titre}</b>
                  <span>
                    {t(LIBELLE[bulle.n.genre]?.fr ?? '', LIBELLE[bulle.n.genre]?.en ?? '')} ·{' '}
                    {bulle.n.degre} {t('liens', 'links')} ·{' '}
                    {bulle.n.serviIlYaJours === null
                      ? t('jamais servie', 'never used')
                      : t(
                          `servie il y a ${bulle.n.serviIlYaJours} j`,
                          `used ${bulle.n.serviIlYaJours} d ago`,
                        )}
                  </span>
                </div>
              )}
              {rienDeFiltre && (
                <p className="cerveau-rien">
                  {t('Aucune note ne correspond.', 'No note matches.')}
                </p>
              )}
            </div>
          ) : (
            <div className="cerveau-liste-boite">
              {rienDeFiltre ? (
                <p className="cerveau-rien statique">
                  {t('Aucune note ne correspond.', 'No note matches.')}
                </p>
              ) : (
                <table className="cerveau-liste">
                  <caption>
                    {t(
                      'Les notes du Cerveau : genre, titre, liens, dernier usage.',
                      'The Brain’s notes: kind, title, links, last use.',
                    )}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">{t('Genre', 'Kind')}</th>
                      <th scope="col">{t('Titre', 'Title')}</th>
                      <th scope="col">{t('Liens', 'Links')}</th>
                      <th scope="col">{t('Récurrences', 'Recurrences')}</th>
                      <th scope="col">{t('Dernier usage', 'Last use')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(g?.noeuds ?? []).map((n) => (
                      <tr
                        key={n.id}
                        className={n.id === choisi ? 'on' : undefined}
                        onClick={() => setChoisi(n.id)}
                      >
                        <td>
                          <i style={{ background: COULEUR[n.genre] }} />
                          {t(LIBELLE[n.genre]?.fr ?? '', LIBELLE[n.genre]?.en ?? '')}
                        </td>
                        <th scope="row">{n.titre}</th>
                        <td>{n.degre}</td>
                        <td>{n.recurrences}</td>
                        <td className={n.serviIlYaJours === null ? 'dort' : undefined}>
                          {n.serviIlYaJours === null
                            ? t('jamais', 'never')
                            : t(`il y a ${n.serviIlYaJours} j`, `${n.serviIlYaJours} d ago`)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          <aside className="cerveau-cote">
            {noteChoisie ? (
              <div className="cerveau-fiche">
                <button
                  type="button"
                  className="cerveau-fermer"
                  onClick={() => setChoisi(null)}
                  aria-label={t('Fermer', 'Close')}
                >
                  ×
                </button>
                <span className="cerveau-genre" style={{ color: COULEUR[noteChoisie.genre] }}>
                  {t(LIBELLE[noteChoisie.genre]?.fr ?? '', LIBELLE[noteChoisie.genre]?.en ?? '')}
                </span>
                <h3>{noteChoisie.titre}</h3>
                <code>{noteChoisie.id}</code>
                <dl>
                  <dt>{t('récurrences', 'recurrences')}</dt>
                  <dd>{noteChoisie.recurrences}</dd>
                  <dt>{t('liens', 'links')}</dt>
                  <dd>{noteChoisie.degre}</dd>
                  <dt>{t('âge', 'age')}</dt>
                  {/* Une date illisible affiche « ? » plutôt qu'un âge inventé :
                      les notes s'éditent à la main, et « 0 j » sur une date
                      ratée ferait passer une vieille note pour toute neuve. */}
                  <dd>{noteChoisie.ageJours === null ? '?' : `${noteChoisie.ageJours} j`}</dd>
                  <dt>{t('a servi', 'used')}</dt>
                  <dd>
                    {noteChoisie.serviIlYaJours === null
                      ? t('jamais', 'never')
                      : t(
                          `il y a ${noteChoisie.serviIlYaJours} j`,
                          `${noteChoisie.serviIlYaJours} d ago`,
                        )}
                  </dd>
                </dl>
                {proches && proches.size > 0 && (
                  <>
                    <h4>{t('Relié à', 'Linked to')}</h4>
                    <ul className="cerveau-voisins">
                      {[...proches].map((id) => (
                        <li key={id}>
                          <button type="button" onClick={() => setChoisi(id)}>
                            <i style={{ background: COULEUR[parId.get(id)?.genre ?? ''] }} />
                            {parId.get(id)?.titre ?? id}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
            ) : (
              <p className="cerveau-invite">
                {mode === 'graphe'
                  ? t(
                      'Cliquez une note pour l’isoler. Molette pour zoomer, glissez pour déplacer.',
                      'Click a note to isolate it. Wheel to zoom, drag to pan.',
                    )
                  : t('Cliquez une ligne pour voir son détail.', 'Click a row to see its detail.')}
              </p>
            )}

            {(g?.liensMorts.length ?? 0) > 0 && (
              <div className="cerveau-alerte">
                <b>
                  {g?.liensMorts.length} {t('liens morts', 'dead links')}
                </b>
                <p>
                  {t(
                    'Cités mais introuvables. Ils ne sont PAS dessinés — les tracer vers le vide inventerait une note qui n’existe pas.',
                    'Cited but missing. They are NOT drawn — drawing them into the void would invent a note that does not exist.',
                  )}
                </p>
                <ul>
                  {g?.liensMorts.slice(0, 6).map((l) => (
                    <li key={`${l.de}->${l.vers}`}>
                      {l.de} → <em>{l.vers}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(g?.orphelines.length ?? 0) > 0 && (
              <div className="cerveau-alerte douce">
                <b>
                  {g?.orphelines.length} {t('orphelines', 'orphans')}
                </b>
                <p>
                  {t(
                    'Ni citées, ni citantes : du savoir qui ne se raccroche à rien.',
                    'Neither cited nor citing: knowledge attached to nothing.',
                  )}
                </p>
              </div>
            )}
          </aside>
        </div>
      )}
    </section>
  );
}
