// ═══════════════════════════════════════════════════════════════════════════
// La Balance — le pèse-ruche, côté opérateur.
//
// OÙ VIT LA BALANCE, ET POURQUOI.
//
// Elle vit à DEUX échelles, parce qu'elle répond à deux questions différentes
// et qu'un seul écran les aurait confondues :
//
//  1. LE BILAN GLOBAL → vue Santé (`CarteBalance`). C'est là qu'on juge la
//     RUCHE : signes vitaux, thermorégulation, fantômes. La Balance y est le
//     pendant économique de ces cartes — mais elle n'est PAS un signe vital,
//     et le rendu le dit : elle a sa propre carte, son propre vocabulaire
//     (temps prêté, postes, fenêtre) et ne rejoint jamais les tuiles de
//     `PulseTiles`. Un rendement bas n'est pas une maladie : c'est un coût.
//     Le tableau par nœud vit ici, et non dans l'Essaim, précisément pour
//     rester À DISTANCE du Waggle Board — voir la note de `TableauNoeuds`.
//
//  2. LE DÉTAIL PAR PROJET → vue Projets (`BalanceProjet`), dans la carte du
//     projet, sous son rapport d'avancement. C'est l'échelle à laquelle un
//     opérateur juge un projet, et c'est celle du PLAFOND (la table `budgets`
//     est 1:1 avec `projects`) : le plafond se pose là, à côté du solde — pas à
//     côté du devis. Le geste « borner » vit donc ICI, et nulle part ailleurs.
//
//  3. LE DEVIS → vue Projets, atelier Queen Bee (`CarteDevis`), collé au plan
//     qu'il chiffre. Un devis est une PRÉVISION sur un DAG proposé ; il n'a
//     rien à faire près d'un solde constaté, et encore moins près d'un
//     plafond. Il porte toujours la taille de son échantillon.
//
// UNITÉS. Tout est en secondes-ouvrière : du temps machine PRÊTÉ par les
// membres de la ruche. Aucun symbole monétaire nulle part — la ruche ne
// connaît aucun tarif, et en inventer un serait fabriquer un chiffre faux
// (`enEuros` de balance.ts exige un tarif fourni par l'appelant ; personne
// n'en fournit).
// ═══════════════════════════════════════════════════════════════════════════

import { useEffect, useRef, useState } from 'react';
import { fetchProjectBalance, setProjectPlafond } from '../api';
import type { BalanceState, Compte, DevisPlan, Poste, SoldeProjet } from '../api';
import { useT } from '../i18n';
import type { Translate } from '../i18n';
import { DOMAINE_LABEL, formatDuree } from '../ui';
import type { StateSnapshot } from '../../../src/shared/types';
import './balance.css';

/** Ordre de lecture des postes : du travail qui a servi à celui qui a été jeté. */
const POSTES: Poste[] = ['utile', 'reprise', 'echec', 'rebute'];

/** Double libellé fr/en (constante de module) — résolu via `t` au rendu. */
const POSTE_LABEL: Record<Poste, { fr: string; en: string }> = {
  utile: { fr: 'utile', en: 'useful' },
  reprise: { fr: 'reprise', en: 'rework' },
  echec: { fr: 'échec', en: 'failure' },
  rebute: { fr: 'rebuté', en: 'rejected' },
};

/**
 * Une phrase par poste — l'opérateur qui découvre la Balance doit pouvoir
 * comprendre chaque mot sans quitter l'écran. `rebute` est le plus important
 * des quatre : c'est le seul chiffre qui rend la boucle de revue humaine
 * économiquement lisible, et le seul dont le nom ne se devine pas.
 */
const POSTE_AIDE: Record<Poste, { fr: string; en: string }> = {
  utile: {
    fr: 'la tentative retenue d’une tâche aboutie — le travail qui a servi.',
    en: 'the kept attempt of a completed task — the work that served.',
  },
  reprise: {
    fr: 'les autres tentatives d’une tâche aboutie, et tout ce qui est encore en vol.',
    en: 'the other attempts of a completed task, plus everything still in flight.',
  },
  echec: {
    fr: 'toutes les tentatives d’une tâche définitivement échouée.',
    en: 'every attempt of a task that failed for good.',
  },
  rebute: {
    fr: 'du travail terminé, puis REJETÉ à la revue humaine (Miellerie) : le temps qu’a coûté la boucle de revue.',
    en: 'work that completed, then was REJECTED at human review (Honey House): what the review loop cost.',
  },
};

/** Poste → champ de `Compte`. Une seule table, comme côté serveur. */
const POSTE_MS: Record<Poste, 'utileMs' | 'repriseMs' | 'echecMs' | 'rebuteMs'> = {
  utile: 'utileMs',
  reprise: 'repriseMs',
  echec: 'echecMs',
  rebute: 'rebuteMs',
};

interface Segment {
  poste: Poste;
  ms: number;
  /** Part exacte du total, en pourcentage (la largeur de la barre). */
  pct: number;
  libelle: string;
}

function decouper(compte: Compte, libelle: (poste: Poste) => string): Segment[] {
  return POSTES.map((poste) => {
    const ms = compte[POSTE_MS[poste]];
    return {
      poste,
      ms,
      pct: compte.totalMs > 0 ? (ms / compte.totalMs) * 100 : 0,
      libelle: libelle(poste),
    };
  });
}

/** Part utile, en points de pourcentage entiers (le chiffre de tête). */
function rendementPct(compte: Compte): number {
  return Math.round(compte.rendement * 100);
}

/**
 * Barre empilée proportionnelle : où est passé le temps, en une lecture.
 *
 * ACCESSIBILITÉ. La barre est une IMAGE DE DONNÉES : `role="img"` + un
 * `aria-label` qui énonce les quatre postes avec leur durée et leur part — un
 * lecteur d'écran obtient donc l'information complète sans jamais dépendre des
 * couleurs. La légende visible dessous répète les mêmes libellés, durées et
 * parts EN TEXTE pour les yeux (daltonisme, écran monochrome, impression) ;
 * elle est `aria-hidden` parce qu'elle serait sinon lue une seconde fois,
 * mot pour mot. Aucune information n'est portée par la seule couleur.
 */
function BarreEmpilee({ compte, compact }: { compte: Compte; compact?: boolean }) {
  const t = useT();
  const segments = decouper(compte, (poste) => t(POSTE_LABEL[poste].fr, POSTE_LABEL[poste].en));
  const detail = (s: Segment): string =>
    `${s.libelle} ${formatDuree(s.ms)} (${Math.round(s.pct)} %)`;
  const resume = segments.map(detail).join(' · ');

  return (
    <div className={compact ? 'bal-bar-wrap compact' : 'bal-bar-wrap'}>
      <div
        className="bal-bar"
        role="img"
        aria-label={t(
          `Répartition du temps prêté : ${resume}.`,
          `Breakdown of lent time: ${resume}.`,
        )}
      >
        {segments.map((s) =>
          s.pct > 0 ? (
            <span
              key={s.poste}
              className={`bal-seg ${s.poste}`}
              style={{ width: `${s.pct}%` }}
              title={detail(s)}
            />
          ) : null,
        )}
      </div>
      <ul className="bal-legend" aria-hidden="true">
        {segments.map((s) => (
          <li key={s.poste} className="bal-legend-item">
            <span className={`bal-dot ${s.poste}`} />
            <span className="bal-legend-name">{s.libelle}</span>
            <span className="bal-legend-ms">{formatDuree(s.ms)}</span>
            <span className="bal-legend-pct">{Math.round(s.pct)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Provenance du temps prêté, nœud par nœud.
 *
 * DOCTRINE, RÈGLE 4 — à lire avant de toucher à l'ordre de ce tableau.
 * `durationMs` mesure le temps machine PRÊTÉ, pas le travail accompli. Un nœud
 * modeste met plus longtemps à faire la même chose : le classer dessus serait
 * le punir d'être modeste, et amorcerait une course vers le bas. Ce tableau est
 * donc une table de PROVENANCE, pas un classement — il répond à « d'où vient le
 * temps que la ruche a emprunté ? », jamais à « qui coûte le plus cher ? ».
 *
 * Il vit dans la vue Santé et non dans l'Essaim, à dessein : le Waggle Board
 * (le nectar, qui EST un classement) vit dans l'Essaim, et deux tableaux de
 * nœuds côte à côte finissent toujours par fusionner. « Séparé du nectar »
 * (balance.ts, règle 4) est ici une séparation d'écran, la plus solide.
 */
function TableauNoeuds({
  pesee,
  snapshot,
}: {
  pesee: BalanceState['pesee'];
  snapshot: StateSnapshot;
}) {
  const t = useT();
  const total = pesee.global.totalMs;
  const nomDe = (nodeId: string): string =>
    snapshot.nodes.find((n) => n.id === nodeId)?.name ?? `${nodeId.slice(0, 8)}…`;

  return (
    <details className="bal-noeuds">
      <summary>
        {t('Par nœud', 'By node')} <span className="bal-count">{pesee.parNoeud.length}</span>
      </summary>
      <p className="bal-note">
        {t(
          'Table de provenance : d’où vient le temps machine que la ruche a emprunté. Ce n’est pas un classement — le temps prêté mesure la machine, pas le travail accompli, et la Balance n’entre jamais dans le choix du nœud.',
          'A provenance table: where the machine time the hive borrowed came from. It is not a ranking — lent time measures the machine, not the work done, and the Balance never takes part in node selection.',
        )}
      </p>
      <table className="bal-table">
        <thead>
          <tr>
            <th scope="col">{t('Nœud', 'Node')}</th>
            <th scope="col">{t('Temps prêté', 'Lent time')}</th>
            <th scope="col">{t('Part', 'Share')}</th>
            <th scope="col">{t('Tentatives', 'Attempts')}</th>
          </tr>
        </thead>
        <tbody>
          {/* ORDRE SERVEUR CONSERVÉ TEL QUEL (nodeId croissant — balance.ts,
              `parNoeud`). Aucun `.sort()` ici, et il ne doit jamais y en avoir
              un par temps prêté, part ou rendement : ce serait exactement le
              « pire contributeur » que la doctrine (règle 4) interdit, et un
              test de source le vérifie côté serveur. Si vous passez par là pour
              « améliorer » ce tableau avec un tri décroissant : c'est le point
              précis à ne pas franchir. Un tri alphabétique par nom, lui, serait
              neutre — mais l'ordre serveur est stable et suffit. */}
          {pesee.parNoeud.map((n) => (
            <tr key={n.nodeId}>
              <th scope="row" title={nomDe(n.nodeId)}>
                {nomDe(n.nodeId)}
              </th>
              <td>{formatDuree(n.totalMs)}</td>
              <td>{total > 0 ? `${Math.round((n.totalMs / total) * 100)} %` : '—'}</td>
              <td>{n.tentatives}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}

/**
 * Le bilan global de la ruche (vue Santé).
 *
 * `balance === null` : première réponse pas encore arrivée. `erreur` non nulle
 * APRÈS un premier relevé : le relevé est gardé à l'écran et annoté « figé » —
 * un chiffre périmé annoncé comme tel vaut mieux qu'une carte vide. La
 * disparition complète de la carte (route absente) est décidée par l'appelant,
 * comme pour la thermorégulation et les phéromones.
 */
export function CarteBalance({
  balance,
  erreur,
  snapshot,
}: {
  balance: BalanceState | null;
  erreur: string | null;
  snapshot: StateSnapshot;
}) {
  const t = useT();
  const pesee = balance?.pesee;
  const global = pesee?.global;

  return (
    <section className="card bal-card">
      <header className="panel-head">
        <h2>{t('🧮 La Balance', '🧮 The Balance')}</h2>
        {global && (
          <span className="panel-count">
            {global.tentatives} {t('tentative(s) pesée(s)', 'attempt(s) weighed')}
          </span>
        )}
      </header>

      {!balance || !pesee || !global ? (
        <p className="empty pad">{t('Pesée de la ruche…', 'Weighing the hive…')}</p>
      ) : global.totalMs === 0 ? (
        // Corpus vide : le rendement vaut 1 par convention (jamais NaN) — mais
        // afficher « 100 % » sur une ruche qui n'a rien dépensé serait un
        // mensonge flatteur. On se tait, et on dit pourquoi.
        <p className="empty pad">
          {t(
            'Rien à peser pour l’instant — la Balance s’exprime dès les premiers résultats de butinage.',
            'Nothing to weigh yet — the Balance speaks up as soon as the first foraging results land.',
          )}
        </p>
      ) : (
        <div className="bal-body">
          <div className="bal-head">
            <span className="bal-rendement">
              {rendementPct(global)} <span className="bal-unit">%</span>
            </span>
            <span className="bal-rendement-label">
              {t('de rendement', 'efficiency')}
              <span className="bal-rendement-sub">
                {t('la part du temps qui a servi', 'the share of time that served')}
              </span>
            </span>
            <span className="bal-total">
              <strong>{formatDuree(global.totalMs)}</strong>
              <span className="bal-total-label">
                {t('de temps-ouvrière prêté', 'of worker-time lent')}
              </span>
            </span>
          </div>

          <BarreEmpilee compte={global} />

          <ul className="bal-aide">
            {POSTES.map((poste) => (
              <li key={poste}>
                <strong>{t(POSTE_LABEL[poste].fr, POSTE_LABEL[poste].en)}</strong>{' '}
                {t(POSTE_AIDE[poste].fr, POSTE_AIDE[poste].en)}
              </li>
            ))}
          </ul>

          <p className="bal-reprises">
            ↺{' '}
            {t(
              `${pesee.reprises.taches} tâche(s) aboutie(s) ont demandé ${pesee.reprises.tentatives} tentative(s) supplémentaire(s).`,
              `${pesee.reprises.taches} completed task(s) needed ${pesee.reprises.tentatives} extra attempt(s).`,
            )}
          </p>

          <p className="bal-note">
            {t(
              'Unité : la seconde-ouvrière — du temps machine prêté par les membres de la ruche. La Balance ne convertit rien en monnaie : aucun tarif ne lui est connu.',
              'Unit: the worker-second — machine time lent by the hive’s members. The Balance converts nothing into money: it knows no rate.',
            )}
          </p>

          {/* Transparence : un chiffre qui ne dit pas ce qu'il n'a pas vu ment. */}
          <p className="bal-corpus">
            {t(
              `Lu : ${pesee.corpus.tentatives} tentative(s) sur ${pesee.corpus.taches} tâche(s), dans une fenêtre de ${balance.fenetre} résultats.`,
              `Read: ${pesee.corpus.tentatives} attempt(s) over ${pesee.corpus.taches} task(s), within a window of ${balance.fenetre} results.`,
            )}
            {pesee.corpus.ignorees > 0 &&
              ` ${t(
                `${pesee.corpus.ignorees} ignorée(s) : leur tâche a disparu du corpus, aucune cause imputable.`,
                `${pesee.corpus.ignorees} ignored: their task left the corpus, no attributable cause.`,
              )}`}
          </p>

          {balance.mode === 'off' ? (
            <p className="bal-note">
              {t(
                'Grand livre à l’arrêt (mode « off ») : les soldes par projet ne sont pas tenus. La pesée ci-dessus, elle, reste calculée à la demande.',
                'Ledger stopped (“off” mode): per-project balances are not kept. The weighing above is still computed on demand.',
              )}
            </p>
          ) : (
            !balance.aJour && (
              <p className="bal-rattrapage">
                ⏳{' '}
                {t(
                  'Rattrapage du grand livre en cours : les soldes par projet sont encore incomplets.',
                  'Ledger still catching up: per-project balances are incomplete for now.',
                )}
              </p>
            )
          )}

          {/* Panne SURVENUE après un premier relevé : le relevé reste à l'écran,
              annoté — un chiffre périmé annoncé comme tel vaut mieux qu'un vide
              inexplicable. (Panne AVANT tout relevé : la carte n'apparaît pas,
              décision de la vue appelante.) */}
          {erreur && (
            <p className="panel-error">
              {t('relevé figé :', 'reading frozen:')} {erreur}
            </p>
          )}

          <TableauNoeuds pesee={pesee} snapshot={snapshot} />
        </div>
      )}
    </section>
  );
}

// ─── Borner : le plafond d'un projet ────────────────────────────────────────
// Troisième question de la Balance (peser, prévoir, BORNER), et la seule qui
// n'observe pas : elle agit. Tout ce qui suit vit dans la carte projet, à côté
// du solde qu'elle borne — jamais près du devis (voir `CarteDevis`).

/**
 * Part du plafond déjà consommée, en points entiers. MÊME formule que le
 * serveur (`signalerPlafond`) : arrondi PAR DÉFAUT, et 100 % sur un plafond nul
 * — un plafond de zéro est atteint par définition, pas une division par zéro.
 */
function partPlafond(depenseMs: number, plafondMs: number): number {
  return plafondMs > 0 ? Math.floor((depenseMs * 100) / plafondMs) : 100;
}

/** Heures saisies → millisecondes ENTIÈRES (le schéma serveur refuse un flottant). */
function heuresEnMs(heures: number): number {
  return Math.round(heures * 3_600_000);
}

/**
 * Ce qu'un plafond arrête RÉELLEMENT, selon le mode en vigueur — en clair, au
 * moment où l'opérateur confirme. Poser un plafond en « observation » en
 * croyant fermer la porte est l'erreur exacte que cette phrase empêche.
 *
 * La branche « off » est une ceinture : dans ce mode le serveur ne renvoie
 * aucun solde, donc aucune carte n'affiche de plafond ni son contrôle. Si cela
 * changeait, l'écran dirait la vérité plutôt que de promettre un blocage.
 */
function effetDuMode(mode: BalanceState['mode'], t: Translate): string {
  if (mode === 'strict')
    return t(
      'la ruche cessera d’assigner de nouvelles tâches de ce projet ; celles déjà en vol iront à leur terme.',
      'the hive will stop assigning new tasks for this project; those already in flight will run to completion.',
    );
  if (mode === 'observation')
    return t(
      'la ruche est en « observation » : le franchissement sera journalisé, mais RIEN ne sera arrêté.',
      'the hive runs in “observation”: the crossing will be journaled, but NOTHING will be stopped.',
    );
  return t(
    'la ruche est en « off » : le grand livre ne tourne pas, le plafond est enregistré mais ne sera pas évalué.',
    'the hive runs in “off”: the ledger is not running, the cap is recorded but will not be evaluated.',
  );
}

/**
 * L'état d'un projet plafonné, EN TOUTES LETTRES.
 *
 * TROIS ÉTATS, JAMAIS CONFONDUS — c'est tout l'intérêt d'avoir `etat` ET
 * `bloque` :
 *  - `bloque` : la porte est réellement fermée (verdict au plafond ET mode
 *    `strict`). Les tâches du projet restent `ready` indéfiniment, et c'est le
 *    comportement voulu — un opérateur qui ne lirait pas cette ligne croirait
 *    à une famine, une panne de nœud, un scheduler coincé ;
 *  - verdict au plafond SANS blocage (mode `observation`) : le fait est
 *    constaté, la ruche butine toujours. Le taire ferait croire l'inverse ;
 *  - `alerte` : le seuil d'alerte est franchi, rien n'est bloqué.
 *
 * ACCESSIBILITÉ. Aucune information n'est portée par la seule couleur : chaque
 * badge est un pictogramme SUIVI D'UNE PHRASE, la consommation est écrite en
 * toutes lettres (« X sur Y · Z % ») et la barre qui la double est décorative
 * (`aria-hidden`) — elle ne dit rien que le texte ne dise déjà. Le badge de
 * blocage est un `role="status"` : il s'annonce sans qu'on relise la carte.
 */
function EtatPlafond({ solde }: { solde: SoldeProjet }) {
  const t = useT();
  const plafondMs = solde.plafondMs ?? null;
  if (plafondMs === null) return null;
  const part = partPlafond(solde.depenseMs, plafondMs);
  const etat = solde.etat ?? 'passe';
  const bloque = solde.bloque === true;

  return (
    <div className="bal-plafond">
      <p className="bal-plafond-jauge">
        <span className="bal-plafond-titre">{t('Plafond', 'Cap')}</span>{' '}
        <span className="bal-plafond-chiffres">
          {t(
            `${formatDuree(solde.depenseMs)} sur ${formatDuree(plafondMs)} · ${part} %`,
            `${formatDuree(solde.depenseMs)} of ${formatDuree(plafondMs)} · ${part}%`,
          )}
        </span>
      </p>
      <div className={`bal-plafond-bar ${etat}`} aria-hidden="true">
        <span className="bal-plafond-fill" style={{ width: `${Math.min(100, part)}%` }} />
      </div>

      {bloque && (
        <p className="bal-plafond-badge bloque" role="status">
          ⛔{' '}
          {t(
            'Assignation ARRÊTÉE — plafond atteint. Les tâches de ce projet restent prêtes tant que le plafond n’est pas relevé ou retiré.',
            'Assignment STOPPED — cap reached. This project’s tasks stay ready until the cap is raised or removed.',
          )}
        </p>
      )}
      {!bloque && etat === 'bloque' && (
        <p className="bal-plafond-badge atteint">
          ⛔{' '}
          {t(
            'Plafond atteint, mais rien n’est arrêté : la ruche ne tourne pas en « strict ».',
            'Cap reached, yet nothing is stopped: the hive is not running in “strict”.',
          )}
        </p>
      )}
      {etat === 'alerte' && (
        <p className="bal-plafond-badge alerte">
          ⚠{' '}
          {t(
            `Alerte : ${part} % du plafond consommés. La ruche prévient, elle ne bloque pas.`,
            `Alert: ${part}% of the cap spent. The hive warns, it does not block.`,
          )}
        </p>
      )}
    </div>
  );
}

/**
 * Poser et retirer le plafond, depuis la carte projet.
 *
 * POURQUOI ICI ET PAS AILLEURS. C'est le seul geste du dashboard qui peut
 * arrêter la ruche pour cause d'économie, et le seul qui peut la redémarrer :
 * sans lui, un projet bloqué n'a d'issue qu'un `curl`, et « pourquoi ce projet
 * ne part-il plus ? » n'a de réponse nulle part à l'écran.
 *
 * DEUX GESTES, DEUX EXIGENCES DIFFÉRENTES. Poser un plafond peut fermer la
 * porte d'un projet : premier clic = armement, second (sous 3 s) = confirmation
 * — motif exact de la coulée du miel en Miellerie. Le RETRAIT, lui, part au
 * premier clic : il ne peut qu'ouvrir la porte, jamais la fermer, et faire
 * attendre un opérateur qui débloque son projet serait une friction gratuite.
 * La symétrie serait ici une fausse rigueur.
 *
 * ACCESSIBILITÉ. Rien que des `button` et un `input` natifs : tabulation,
 * Entrée et Espace fonctionnent sans une ligne de code. Chaque contrôle porte
 * un libellé explicite (jamais une icône seule), le bouton d'ouverture porte
 * son `aria-expanded`, et l'avertissement d'armement est un `role="status"` —
 * la confirmation demandée est ANNONCÉE, pas seulement colorée en rouge.
 */
function ControlePlafond({
  projectId,
  projectName,
  solde,
  mode,
  onPlafondChange,
}: {
  projectId: string;
  projectName: string;
  solde: SoldeProjet;
  mode: BalanceState['mode'];
  onPlafondChange?: () => void;
}) {
  const t = useT();
  const plafondMs = solde.plafondMs ?? null;
  const [trace, setTrace] = useState<{ definiPar: string | null; updatedAt: number | null } | null>(
    null,
  );
  const [ouvert, setOuvert] = useState(false);
  const [saisie, setSaisie] = useState('');
  const [arme, setArme] = useState(false);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const armTimer = useRef<number | undefined>(undefined);

  // Qui a posé le plafond, et quand. `/api/balance` porte le plafond mais pas
  // sa trace : on la lit UNIQUEMENT pour les projets qui en ont un. Le coût est
  // donc borné par le nombre de plafonds posés — un geste humain, rare — et non
  // par le nombre de cartes affichées. Un relevé raté laisse le plafond à
  // l'écran sans sa trace : mieux vaut « qui ? » manquant que le plafond caché.
  useEffect(() => {
    if (plafondMs === null) {
      setTrace(null);
      return;
    }
    let alive = true;
    void fetchProjectBalance(projectId)
      .then((detail) => {
        if (alive)
          setTrace({ definiPar: detail.definiPar ?? null, updatedAt: detail.updatedAt ?? null });
      })
      .catch(() => {
        /* trace indisponible : le plafond, lui, reste affiché */
      });
    return () => {
      alive = false;
    };
  }, [projectId, plafondMs]);

  useEffect(() => () => window.clearTimeout(armTimer.current), []);

  const heures = Number(saisie.replace(',', '.'));
  const valide = saisie.trim() !== '' && Number.isFinite(heures) && heures >= 0;
  const cible = valide ? heuresEnMs(heures) : null;

  const desarmer = (): void => {
    window.clearTimeout(armTimer.current);
    setArme(false);
  };

  const appliquer = (ms: number | null): void => {
    desarmer();
    setBusy(true);
    setErreur(null);
    setProjectPlafond(projectId, ms)
      .then((detail) => {
        setTrace({ definiPar: detail.definiPar ?? null, updatedAt: detail.updatedAt ?? null });
        setSaisie('');
        setOuvert(false);
        // Le solde affiché vient du relevé de ruche : on le redemande, sinon
        // l'écran garderait l'ancien plafond jusqu'au prochain battement.
        onPlafondChange?.();
      })
      .catch((e: unknown) => setErreur(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };

  const poser = (): void => {
    if (cible === null || busy) return;
    if (!arme) {
      setArme(true);
      window.clearTimeout(armTimer.current);
      armTimer.current = window.setTimeout(() => setArme(false), 3_000);
      return;
    }
    appliquer(cible);
  };

  return (
    <div className="bal-plafond-ctl">
      {plafondMs !== null && trace && (
        <p className="bal-plafond-trace">
          {t('Posé par', 'Set by')}{' '}
          {trace.definiPar ? (
            <span className="mono" title={trace.definiPar}>
              {trace.definiPar.slice(0, 8)}
            </span>
          ) : (
            t(
              'un opérateur non identifié (jeton de ruche)',
              'an unidentified operator (hive token)',
            )
          )}
          {trace.updatedAt !== null && ` · ${new Date(trace.updatedAt).toLocaleString()}`}
        </p>
      )}

      <div className="bal-plafond-actions">
        <button
          className="btn ghost bal-plafond-btn"
          aria-expanded={ouvert}
          disabled={busy}
          onClick={() => {
            setOuvert((v) => !v);
            desarmer();
            setErreur(null);
          }}
        >
          {plafondMs === null
            ? t('Poser un plafond', 'Set a cap')
            : t('Modifier le plafond', 'Change the cap')}
        </button>
        {plafondMs !== null && (
          <button
            className="btn ghost bal-plafond-btn"
            disabled={busy}
            onClick={() => appliquer(null)}
          >
            {t('Retirer le plafond', 'Remove the cap')}
          </button>
        )}
      </div>

      {ouvert && (
        <div className="bal-plafond-form">
          <label className="bal-plafond-label">
            <span>{t('Plafond, en heures de temps-ouvrière', 'Cap, in hours of worker-time')}</span>
            <input
              className="bal-plafond-input"
              type="number"
              min={0}
              step={0.5}
              inputMode="decimal"
              value={saisie}
              disabled={busy}
              onChange={(e) => {
                setSaisie(e.target.value);
                desarmer();
              }}
            />
          </label>
          {/* Ce que la saisie vaut vraiment, dans l'unité de la Balance : un
              opérateur ne doit jamais découvrir après coup qu'il a posé 30 h
              en croyant poser 30 min. */}
          <p className="bal-plafond-apercu">
            {cible === null
              ? t(
                  'Un nombre d’heures — « 0 » est licite et veut dire : ce projet ne dépense plus rien.',
                  'A number of hours — “0” is valid and means: this project spends nothing more.',
                )
              : t(
                  `soit ${formatDuree(cible)} de temps machine prêté`,
                  `that is ${formatDuree(cible)} of lent machine time`,
                )}
          </p>
          <div className="bal-plafond-actions">
            <button
              className={`btn primary${arme ? ' bal-arme' : ''}`}
              disabled={cible === null || busy}
              onClick={poser}
            >
              {busy
                ? t('Envoi…', 'Sending…')
                : arme
                  ? t('Confirmer le plafond ?', 'Confirm the cap?')
                  : t('Poser le plafond', 'Set the cap')}
            </button>
            <button
              className="btn ghost bal-plafond-btn"
              disabled={busy}
              onClick={() => {
                setOuvert(false);
                desarmer();
                setErreur(null);
              }}
            >
              {t('Annuler', 'Cancel')}
            </button>
          </div>
          {arme && cible !== null && (
            <p className="bal-plafond-avert" role="status">
              {t(
                `« ${projectName} » sera plafonné à ${formatDuree(cible)} : ${effetDuMode(mode, t)}`,
                `“${projectName}” will be capped at ${formatDuree(cible)}: ${effetDuMode(mode, t)}`,
              )}
            </p>
          )}
          {erreur && (
            <p className="panel-error">
              {t('Plafond refusé :', 'Cap refused:')} {erreur}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * La Balance d'UN projet (carte projet, vue Projets).
 *
 * Deux chiffres de natures différentes y cohabitent, et le rendu les nomme
 * explicitement pour qu'on ne les additionne jamais :
 *  - la PESÉE, imputée sur la fenêtre courante (les N derniers résultats) ;
 *  - le SOLDE du grand livre, dépense totale du projet depuis toujours.
 * Le solde est supérieur à la pesée dès que le projet déborde de la fenêtre —
 * ce n'est pas une incohérence, c'est la différence entre « récemment » et
 * « depuis toujours ».
 *
 * L'échelle projet est celle du PLAFOND (`budgets`, 1:1 avec `projects`) : il se
 * pose ICI, à côté du solde qu'il borne — et jamais à côté du devis de l'atelier
 * Queen Bee, qui est une prévision sur un plan non engagé. Un projet plafonné
 * dit donc ici, et sans qu'on ait à ouvrir quoi que ce soit, ce qu'il a
 * consommé de son plafond, si l'assignation est arrêtée, et qui l'a posé.
 */
export function BalanceProjet({
  projectId,
  projectName,
  compte,
  solde,
  mode,
  aJour,
  onPlafondChange,
}: {
  projectId: string;
  projectName: string;
  compte: Compte | null;
  solde: SoldeProjet | null;
  mode: BalanceState['mode'];
  aJour: boolean;
  onPlafondChange?: () => void;
}) {
  const t = useT();
  // Silence complet : ni pesée exploitable, ni solde tenu, ni plafond posé ⇒
  // rien à dire sur ce projet, et surtout pas un bloc vide qui laisserait
  // croire à une panne. Un plafond, lui, se montre TOUJOURS dès qu'il existe :
  // le serveur fait apparaître au grand livre un projet plafonné même s'il n'a
  // jamais rien dépensé — c'est précisément le projet (bloqué à zéro dépense)
  // qu'il ne faut pas rendre invisible.
  const aPesee = compte !== null && compte.totalMs > 0;
  const aSolde = mode !== 'off' && solde !== null;
  const aPlafond = (solde?.plafondMs ?? null) !== null;
  if (!aPesee && !aSolde && !aPlafond) return null;

  // Le geste « borner » ne s'offre que si le serveur le sert : un orchestrateur
  // d'AVANT ce lot ne renvoie pas `plafondMs` du tout (`undefined`, et non
  // `null`), et proposer un bouton qui ne peut que tomber en 404 serait une
  // promesse en l'air. Le reste de la carte est rigoureusement inchangé.
  const bornable = solde !== null && solde.plafondMs !== undefined;

  return (
    <div className="bal-projet">
      <div className="bal-projet-head">
        <span className="bal-projet-title">{t('🧮 Balance', '🧮 Balance')}</span>
        {aPesee && compte && (
          <>
            <span className="bal-projet-rendement">
              {rendementPct(compte)} % {t('de rendement', 'efficiency')}
            </span>
            <span className="bal-projet-total">
              {formatDuree(compte.totalMs)} {t('prêtées (fenêtre)', 'lent (window)')}
            </span>
          </>
        )}
      </div>

      {aPesee && compte && <BarreEmpilee compte={compte} compact />}

      {/* Le grand livre n'existe pas en mode « off » : pas de solde, et surtout
          pas un « 0 » qui laisserait croire que ce projet n'a rien coûté. */}
      {aSolde && solde && (
        <p className="bal-projet-solde">
          {t(
            `Grand livre : ${formatDuree(solde.depenseMs)} sur ${solde.tentatives} tentative(s), depuis toujours.`,
            `Ledger: ${formatDuree(solde.depenseMs)} over ${solde.tentatives} attempt(s), all-time.`,
          )}
          {!aJour && ` ⏳ ${t('rattrapage en cours', 'still catching up')}`}
        </p>
      )}

      {solde && <EtatPlafond solde={solde} />}
      {bornable && solde && (
        <ControlePlafond
          projectId={projectId}
          projectName={projectName}
          solde={solde}
          mode={mode}
          onPlafondChange={onPlafondChange}
        />
      )}
    </div>
  );
}

/**
 * Le devis d'un plan (atelier Queen Bee, vue Projets).
 *
 * SÉPARÉ DE TOUT PLAFOND, visuellement et conceptuellement : un devis est une
 * prévision sur un DAG qui n'est même pas encore déposé, un plafond est une
 * intention humaine posée sur un projet existant (elle vit dans la carte
 * projet, `ControlePlafond`). Ils ne se lisent pas ensemble, et ce bloc n'a
 * aucune place pour l'un d'eux.
 *
 * Il porte TOUJOURS la taille de son échantillon : un devis fondé sur 3 tâches
 * comparables et un devis fondé sur 300 s'affichent pareil sans ce chiffre, et
 * se lisent alors exactement pareil — ce qui serait la fausse précision que le
 * serveur refuse déjà (il se tait sous 3 tâches).
 */
export function CarteDevis({ devis, nbTaches }: { devis: DevisPlan; nbTaches: number }) {
  const t = useT();
  const echantillons = devis.parTache.map((d) => d.echantillon);
  const min = Math.min(...echantillons);
  const max = Math.max(...echantillons);
  const plage = min === max ? `${min}` : `${min}–${max}`;
  const chiffrees = devis.parTache.length;

  return (
    <section className="bal-devis" aria-label={t('Devis indicatif', 'Indicative estimate')}>
      <header className="bal-devis-head">
        <span className="bal-devis-title">{t('🧮 Devis indicatif', '🧮 Indicative estimate')}</span>
        <span className="bal-devis-sample">
          {t(
            `échantillon : ${plage} tâche(s) comparable(s) déjà terminée(s)`,
            `sample: ${plage} comparable task(s) already completed`,
          )}
        </span>
      </header>

      <p className="bal-devis-totals">
        <strong>{formatDuree(devis.totalMedianeMs)}</strong>{' '}
        <span className="bal-devis-tag">{t('en médiane', 'median')}</span>
        {' · '}
        <strong>{formatDuree(devis.totalP90Ms)}</strong>{' '}
        <span className="bal-devis-tag">{t('au p90', 'p90')}</span>
      </p>

      <ul className="bal-devis-list">
        {devis.parTache.map((d, i) => (
          <li key={`${d.title}-${i}`}>
            <span className="bal-devis-task" title={d.title}>
              {d.title}
            </span>
            <span className="bal-devis-dom">
              {t(DOMAINE_LABEL[d.domaine].fr, DOMAINE_LABEL[d.domaine].en)}
            </span>
            <span className="bal-devis-nums">
              {formatDuree(d.medianeMs)} · p90 {formatDuree(d.p90Ms)}
              {/* « n = 42 » est une notation, pas une phrase : identique en
                  français et en anglais. C'est l'infobulle qui l'explique, et
                  elle, elle est bilingue — un devis sans sa taille
                  d'échantillon se lit exactement comme un devis solide. */}
              <span
                className="bal-devis-n"
                title={t(
                  `échantillon : ${d.echantillon} tâche(s) comparable(s) déjà terminée(s)`,
                  `sample: ${d.echantillon} comparable task(s) already completed`,
                )}
              >
                {' '}
                n = {d.echantillon}
              </span>
            </span>
          </li>
        ))}
      </ul>

      {chiffrees < nbTaches && (
        <p className="bal-note">
          {t(
            `${chiffrees} tâche(s) chiffrée(s) sur ${nbTaches} : les autres n’ont pas encore assez de tâches comparables terminées pour qu’un devis soit honnête.`,
            `${chiffrees} of ${nbTaches} task(s) estimated: the others lack enough comparable completed tasks for an honest estimate.`,
          )}
        </p>
      )}

      {/* L'affirmation est RESTREINTE À SON SUJET : c'est le devis qui ne borne
          rien, pas la ruche. Depuis le geste « borner », un seul dispositif peut
          réellement arrêter une dépense — le plafond du projet, posé à la main
          dans sa carte — et la note le nomme plutôt que de laisser croire qu'il
          n'existe pas. */}
      <p className="bal-note">
        {t(
          'Le total p90 additionne les p90 : il suppose que toutes les tâches ont un mauvais jour en même temps. Un devis se lit comme un ordre de grandeur — il ne borne rien et n’autorise rien. Le seul dispositif qui puisse arrêter une dépense est le plafond du projet, posé à la main dans sa carte.',
          'The p90 total adds up the p90s: it assumes every task has a bad day at once. An estimate reads as an order of magnitude — it caps nothing and authorizes nothing. The only thing that can actually stop spending is the project cap, set by hand on its card.',
        )}
      </p>
      <p className="bal-note">
        {t(
          'Exprimé en temps-ouvrière (temps machine prêté), jamais en monnaie.',
          'Expressed in worker-time (lent machine time), never in money.',
        )}
      </p>
    </section>
  );
}
