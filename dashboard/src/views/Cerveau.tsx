// Vue « Le Cerveau » — le savoir de la ruche, vu comme un graphe vivant.
//
// ─── CE QU'ON REGARDE, ET POURQUOI ───────────────────────────────────────────
//
// Le Cerveau grossit tout seul : chaque échec y dépose un épisode, chaque
// consolidation y propose une leçon. Personne ne le voyait. Un dossier de
// markdown, ça se lit note par note — et une note à la fois ne dit rien de la
// FORME de l'ensemble : ce qui se raccroche à quoi, ce qui sert vraiment, ce
// qui dort depuis trois mois.
//
// D'où cet écran. Il ne montre pas le CONTENU des notes (l'API ne l'envoie
// même pas) : il montre leur forme et leur usage.
//
// ─── POURQUOI LA PHYSIQUE EST ÉCRITE À LA MAIN ───────────────────────────────
//
// Le dépôt tient un critère : zéro nouvelle dépendance. Le TUI est en ANSI à
// la main pour la même raison. Une bibliothèque de graphe pèserait plus lourd
// que tout le reste du tableau de bord, pour trois forces qu'on écrit en
// cinquante lignes : répulsion, ressort, rappel au centre.
//
// Écrire la simulation donne en prime ce qu'une bibliothèque rendrait pénible :
// une note qui APPARAÎT grandit depuis zéro, et une note qui a servi
// récemment respire. C'est la demande — voir le cerveau bouger, pas juste le
// consulter.
//
// ─── CE QUI EST DÉCIDÉ AILLEURS ──────────────────────────────────────────────
//
// Quelles arêtes existent, laquelle est morte, laquelle est orpheline : tout
// cela vient de `src/shared/cerveau-graphe.ts`, qui est pur et testé. Ici, on
// ne fait que dessiner. Un lien mort n'arrive jamais jusqu'à ce fichier.

import { useEffect, useMemo, useRef, useState } from 'react';
import { fetchCerveau } from '../api';
import type { CerveauGraphe, NoeudGraphe } from '../api';
import { useT } from '../i18n';
import { useApiPoll } from './shared';
import type { ViewProps } from './shared';
import './cerveau.css';

/** Une couleur par genre — l'ordre des genres EST leur priorité. */
const COULEUR: Record<string, string> = {
  invariant: '#ff5c5c',
  lecon: '#ffc93c',
  decision: '#7cc4ff',
  carte: '#b98cff',
  episode: '#7a8899',
};

const LIBELLE: Record<string, { fr: string; en: string }> = {
  invariant: { fr: 'invariants', en: 'invariants' },
  lecon: { fr: 'leçons', en: 'lessons' },
  decision: { fr: 'décisions', en: 'decisions' },
  carte: { fr: 'cartes', en: 'maps' },
  episode: { fr: 'épisodes', en: 'episodes' },
};

/** Un corps en mouvement dans la simulation. */
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

/**
 * Rayon d'une note.
 *
 * Les récurrences sont écrasées par une racine : une panne vue cinquante fois
 * ne doit pas faire un disque cinquante fois plus large que les autres — elle
 * mangerait l'écran et cacherait précisément ce qu'elle explique.
 */
function rayon(n: NoeudGraphe): number {
  return 4 + Math.sqrt(n.recurrences) * 2.6 + Math.min(6, n.degre * 0.9);
}

/**
 * La « chaleur » d'une note : 1 si elle vient de servir, 0 si jamais.
 *
 * C'est la mesure d'usage rendue visible. `null` (jamais servie) et 0 jour
 * (servie aujourd'hui) sont aux deux extrêmes — les confondre ferait passer du
 * savoir dormant pour actif, ce que cet écran existe pour éviter.
 */
function chaleur(n: NoeudGraphe): number {
  if (n.serviIlYaJours === null) return 0;
  return Math.max(0, 1 - n.serviIlYaJours / 30);
}

export default function Cerveau(_props: ViewProps) {
  const t = useT();
  const poll = useApiPoll<CerveauGraphe>(fetchCerveau, 10_000);
  const canvas = useRef<HTMLCanvasElement | null>(null);
  const corps = useRef<Map<string, Corps>>(new Map());
  const survole = useRef<string | null>(null);
  const [choisi, setChoisi] = useState<NoeudGraphe | null>(null);
  const graphe = poll.data;

  /** Voisins immédiats, pour éteindre le reste au survol. */
  const voisins = useMemo(() => {
    const m = new Map<string, Set<string>>();
    for (const a of graphe?.aretes ?? []) {
      if (!m.has(a.de)) m.set(a.de, new Set());
      if (!m.has(a.vers)) m.set(a.vers, new Set());
      m.get(a.de)!.add(a.vers);
      m.get(a.vers)!.add(a.de);
    }
    return m;
  }, [graphe]);

  // ── La simulation ─────────────────────────────────────────────────────────
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;

    let vivant = true;
    let t0 = 0;

    const boucle = (temps: number) => {
      if (!vivant) return;
      const dt = t0 === 0 ? 16 : Math.min(48, temps - t0);
      t0 = temps;

      const dpr = window.devicePixelRatio || 1;
      const L = c.clientWidth;
      const H = c.clientHeight;
      if (c.width !== L * dpr || c.height !== H * dpr) {
        c.width = L * dpr;
        c.height = H * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      const g = graphe;
      const bodies = corps.current;

      if (g) {
        // Naissances : une note nouvelle démarre au centre, en tout petit.
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
            x: L / 2 + Math.cos(angle) * 40,
            y: H / 2 + Math.sin(angle) * 40,
            vx: 0,
            vy: 0,
            naissance: 0,
            n,
          });
        }
        // Morts : une note élaguée disparaît de la simulation.
        for (const id of [...bodies.keys()]) if (!vus.has(id)) bodies.delete(id);
      }

      const liste = [...bodies.values()];

      // ── Force 1 : répulsion, tout le monde contre tout le monde ────────────
      // O(n²) assumé : le Cerveau est BORNÉ (élagage à 500 épisodes), donc on
      // reste dans des ordres de grandeur où c'est gratuit. Un quadtree ici
      // serait de la complexité payée pour un cas qui n'arrive pas.
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
          // Répulsion large : un graphe tassé est illisible, et la première
          // version l'était. Le plafond évite qu'un chevauchement momentané
          // catapulte deux notes à l'autre bout de la toile.
          const f = Math.min(3, 2600 / d2);
          const ux = (dx / d) * f;
          const uy = (dy / d) * f;
          a.vx -= ux;
          a.vy -= uy;
          b.vx += ux;
          b.vy += uy;
        }
      }

      // ── Force 2 : le ressort des liens ─────────────────────────────────────
      for (const a of graphe?.aretes ?? []) {
        const p = bodies.get(a.de);
        const q = bodies.get(a.vers);
        if (!p || !q) continue;
        const dx = q.x - p.x;
        const dy = q.y - p.y;
        const d = Math.max(1, Math.hypot(dx, dy));
        const repos = 118;
        const f = (d - repos) * 0.0016;
        p.vx += (dx / d) * f * d * 0.5;
        p.vy += (dy / d) * f * d * 0.5;
        q.vx -= (dx / d) * f * d * 0.5;
        q.vy -= (dy / d) * f * d * 0.5;
      }

      // ── Force 3 : rappel au centre, sinon le graphe s'évade ────────────────
      for (const p of liste) {
        p.vx += (L / 2 - p.x) * 0.0009;
        p.vy += (H / 2 - p.y) * 0.0009;
        p.vx *= 0.86;
        p.vy *= 0.86;
        p.x += p.vx * (dt / 16);
        p.y += p.vy * (dt / 16);
        if (p.naissance < 1) p.naissance = Math.min(1, p.naissance + dt / 420);
      }

      // ── Le dessin ─────────────────────────────────────────────────────────
      ctx.clearRect(0, 0, L, H);
      const actif = survole.current;
      const proches = actif ? (voisins.get(actif) ?? new Set<string>()) : null;

      for (const a of graphe?.aretes ?? []) {
        const p = bodies.get(a.de);
        const q = bodies.get(a.vers);
        if (!p || !q) continue;
        const eteint = actif !== null && a.de !== actif && a.vers !== actif;
        ctx.globalAlpha = (eteint ? 0.07 : 0.34) * Math.min(p.naissance, q.naissance);
        ctx.strokeStyle = a.reciproque ? '#ffc93c' : '#5a6b7d';
        ctx.lineWidth = a.reciproque ? 1.6 : 1;
        ctx.beginPath();
        ctx.moveTo(p.x, p.y);
        ctx.lineTo(q.x, q.y);
        ctx.stroke();
      }

      for (const p of liste) {
        const r = rayon(p.n) * p.naissance;
        const ch = chaleur(p.n);
        const eteint = actif !== null && p.id !== actif && !proches?.has(p.id);
        ctx.globalAlpha = eteint ? 0.16 : 1;

        // Le halo : une note qui a servi récemment RESPIRE. C'est l'usage,
        // rendu visible sans un chiffre de plus à lire.
        if (ch > 0 && !eteint) {
          const pulse = 1 + Math.sin(temps / 520 + p.x * 0.02) * 0.16;
          ctx.globalAlpha = ch * 0.3;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r * 2.5 * pulse, 0, Math.PI * 2);
          ctx.fillStyle = COULEUR[p.n.genre] ?? '#888';
          ctx.fill();
          ctx.globalAlpha = 1;
        }

        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fillStyle = COULEUR[p.n.genre] ?? '#888';
        ctx.fill();

        // Une note JAMAIS servie est creuse : elle se voit au premier coup
        // d'œil, et c'est exactement le savoir qu'on stocke sans s'en servir.
        if (p.n.serviIlYaJours === null) {
          ctx.globalAlpha = eteint ? 0.16 : 1;
          ctx.beginPath();
          ctx.arc(p.x, p.y, Math.max(1, r - 2.4), 0, Math.PI * 2);
          ctx.fillStyle = '#0e1720';
          ctx.fill();
        }

        // ─── QUI PORTE UN LIBELLÉ ────────────────────────────────────────
        //
        // Première version : tout ce qui dépassait un certain rayon. Sur un
        // cerveau réel, les épisodes sont l'écrasante majorité — trente
        // « épisode 12 — fetch failed » se chevauchaient et cachaient
        // exactement les notes qu'il fallait lire. Vu à l'écran, pas déduit.
        //
        // On nomme donc la CHARPENTE (invariants, leçons, décisions, cartes
        // qui ont au moins un lien), plus la note survolée. Les épisodes
        // restent des points : ils se lisent au survol, un par un.
        const charpente = p.n.genre !== 'episode' && p.n.degre > 0;
        if (!eteint && (actif === p.id || charpente)) {
          ctx.globalAlpha = actif === p.id ? 1 : 0.72;
          ctx.font =
            actif === p.id ? '600 12px ui-monospace, monospace' : '11px ui-monospace, monospace';
          // Un liseré sombre sous le texte : sans lui, un libellé posé sur une
          // arête ou un halo devient illisible.
          ctx.lineWidth = 3;
          ctx.strokeStyle = 'rgba(8,14,20,0.92)';
          ctx.strokeText(p.n.titre.slice(0, 34), p.x + r + 6, p.y + 3.5);
          ctx.fillStyle = '#e6eef7';
          ctx.fillText(p.n.titre.slice(0, 34), p.x + r + 6, p.y + 3.5);
        }
      }
      ctx.globalAlpha = 1;
      requestAnimationFrame(boucle);
    };

    const id = requestAnimationFrame(boucle);
    return () => {
      vivant = false;
      cancelAnimationFrame(id);
    };
  }, [graphe, voisins]);

  /** Le corps sous le curseur, ou null. */
  const sous = (ev: React.MouseEvent<HTMLCanvasElement>): Corps | null => {
    const c = canvas.current;
    if (!c) return null;
    const r = c.getBoundingClientRect();
    const x = ev.clientX - r.left;
    const y = ev.clientY - r.top;
    let trouve: Corps | null = null;
    let meilleur = Infinity;
    for (const p of corps.current.values()) {
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < rayon(p.n) + 7 && d < meilleur) {
        meilleur = d;
        trouve = p;
      }
    }
    return trouve;
  };

  const vide = graphe !== null && graphe.total === 0;

  return (
    <section className="cerveau">
      <header className="cerveau-tete">
        <h2>
          🧠 {t('Le Cerveau', 'The Brain')}
          {graphe && (
            <span className="cerveau-compte">
              {graphe.total} {t('notes', 'notes')} · {graphe.aretes.length} {t('liens', 'links')} ·{' '}
              {graphe.servies}/{graphe.total} {t('ont servi', 'have been used')}
            </span>
          )}
        </h2>
        <p className="cerveau-sous">
          {t(
            'Ce que la ruche a retenu, et ce qui lui sert vraiment. Un point creux n’a jamais servi ; un halo qui respire a servi récemment.',
            'What the hive has retained, and what it actually uses. A hollow dot has never been used; a breathing halo was used recently.',
          )}
        </p>
      </header>

      {poll.error !== null && <p className="cerveau-erreur">{poll.error}</p>}

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
          <code>{graphe?.dossier}</code>
        </div>
      ) : (
        <div className="cerveau-scene">
          <canvas
            ref={canvas}
            className="cerveau-toile"
            onMouseMove={(ev) => {
              survole.current = sous(ev)?.id ?? null;
            }}
            onMouseLeave={() => {
              survole.current = null;
            }}
            onClick={(ev) => setChoisi(sous(ev)?.n ?? null)}
          />

          <aside className="cerveau-cote">
            <ul className="cerveau-legende">
              {Object.entries(graphe?.parGenre ?? {}).map(([g, n]) => (
                <li key={g}>
                  <i style={{ background: COULEUR[g] }} />
                  {t(LIBELLE[g]?.fr ?? g, LIBELLE[g]?.en ?? g)}
                  <b>{n}</b>
                </li>
              ))}
            </ul>

            {choisi && (
              <div className="cerveau-fiche">
                <h3>{choisi.titre}</h3>
                <code>{choisi.id}</code>
                <dl>
                  <dt>{t('genre', 'kind')}</dt>
                  <dd>{t(LIBELLE[choisi.genre]?.fr ?? '', LIBELLE[choisi.genre]?.en ?? '')}</dd>
                  <dt>{t('récurrences', 'recurrences')}</dt>
                  <dd>{choisi.recurrences}</dd>
                  <dt>{t('liens', 'links')}</dt>
                  <dd>{choisi.degre}</dd>
                  <dt>{t('âge', 'age')}</dt>
                  {/* Une date illisible affiche « ? » plutôt qu'un âge inventé :
                      les notes s'éditent à la main, et « 0 j » sur une date
                      ratée ferait passer une vieille note pour toute neuve. */}
                  <dd>{choisi.ageJours === null ? '?' : `${choisi.ageJours} j`}</dd>
                  <dt>{t('a servi', 'used')}</dt>
                  <dd>
                    {choisi.serviIlYaJours === null
                      ? t('jamais', 'never')
                      : t(`il y a ${choisi.serviIlYaJours} j`, `${choisi.serviIlYaJours} d ago`)}
                  </dd>
                </dl>
              </div>
            )}

            {(graphe?.liensMorts.length ?? 0) > 0 && (
              <div className="cerveau-alerte">
                <b>
                  {graphe?.liensMorts.length} {t('liens morts', 'dead links')}
                </b>
                <p>
                  {t(
                    'Cités mais introuvables. Ils ne sont PAS dessinés — les tracer vers le vide inventerait une note qui n’existe pas.',
                    'Cited but missing. They are NOT drawn — drawing them into the void would invent a note that does not exist.',
                  )}
                </p>
                <ul>
                  {graphe?.liensMorts.slice(0, 6).map((l) => (
                    <li key={`${l.de}->${l.vers}`}>
                      {l.de} → <em>{l.vers}</em>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {(graphe?.orphelines.length ?? 0) > 0 && (
              <div className="cerveau-alerte douce">
                <b>
                  {graphe?.orphelines.length} {t('orphelines', 'orphans')}
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
