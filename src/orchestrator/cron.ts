// Le cron des Routines : une expression à cinq champs, lue dans un FUSEAU.
//
// ─── D'OÙ VIENT CE CODE ──────────────────────────────────────────────────────
//
// L'analyse des champs et la marche vers l'échéance suivante sont PORTÉES de
// Paperclip, `server/src/services/cron.ts` :
//
//   Copyright (c) 2025 Paperclip AI — licence MIT
//   https://github.com/paperclipai/paperclip
//
// La licence MIT autorise le portage à condition de garder cette notice ; elle
// est aussi recopiée dans THIRD_PARTY_NOTICES.md. Ce qui a changé, et pourquoi :
//
//   · LE FUSEAU. L'original ne connaît que l'UTC. Or « du lundi au vendredi à
//     9 h » est une phrase d'heure MURALE : en UTC, elle glisse d'une heure
//     deux fois par an et tombe un autre jour pour qui vit loin de Greenwich.
//     La marche se fait donc sur l'heure murale du fuseau, puis se reconvertit
//     en instant (`instantDeMurale`), heure d'été comprise.
//   · LE JOUR DU MOIS ET LE JOUR DE LA SEMAINE. L'original exige les DEUX ;
//     cron (Vixie, POSIX) prend l'UN OU L'AUTRE quand les deux sont restreints
//     — `0 9 1 * 1` veut dire « le 1er du mois, et chaque lundi ». Garder la
//     conjonction aurait fait taire, sans erreur, une routine copiée d'une
//     crontab. Quand l'un des deux vaut `*`, les deux lectures coïncident.
//   · `7` vaut dimanche, comme dans toute crontab.
//
// Module PUR : aucune I/O, aucune horloge lue — l'instant est toujours passé.

/** Une expression analysée : les valeurs admises de chaque champ, triées. */
export interface CronAnalyse {
  minutes: number[];
  heures: number[];
  joursDuMois: number[];
  mois: number[];
  joursSemaine: number[];
  /** Le champ « jour du mois » était-il `*…` ? (règle du OU de cron) */
  joursDuMoisLibres: boolean;
  /** Le champ « jour de semaine » était-il `*…` ? */
  joursSemaineLibres: boolean;
}

interface Champ {
  min: number;
  max: number;
  nom: string;
}

const CHAMPS: readonly Champ[] = [
  { min: 0, max: 59, nom: 'minute' },
  { min: 0, max: 23, nom: 'heure' },
  { min: 1, max: 31, nom: 'jour du mois' },
  { min: 1, max: 12, nom: 'mois' },
  // 7 est admis à la lecture et replié sur 0 : les deux disent dimanche.
  { min: 0, max: 7, nom: 'jour de semaine' },
];

function borner(v: number, c: Champ): void {
  if (!Number.isInteger(v) || v < c.min || v > c.max) {
    throw new Error(`valeur ${v} hors de [${c.min}–${c.max}] pour le champ ${c.nom}`);
  }
}

/** Un entier en chiffres seulement : `parseInt('5x')` rendrait 5 sans se plaindre. */
function entier(s: string, c: Champ): number {
  if (!/^\d+$/.test(s)) throw new Error(`« ${s} » n’est pas un nombre (champ ${c.nom})`);
  return Number(s);
}

/** Un champ (`5`, `1-3`, `*\/10`, `1,3,5`, `9-17/2`) → ses valeurs triées. */
function analyserChamp(jeton: string, c: Champ): number[] {
  const valeurs = new Set<number>();
  for (const brut of jeton.split(',')) {
    const part = brut.trim();
    if (part === '') throw new Error(`élément vide dans le champ ${c.nom}`);
    const [base = '', pasBrut] = part.split('/');
    const pas = pasBrut === undefined ? 1 : entier(pasBrut, c);
    if (pas <= 0) throw new Error(`pas nul dans le champ ${c.nom}`);
    let debut: number;
    let fin: number;
    if (base === '*') {
      [debut, fin] = [c.min, c.max === 7 ? 6 : c.max];
    } else if (base.includes('-')) {
      const [a = '', b = ''] = base.split('-');
      [debut, fin] = [entier(a, c), entier(b, c)];
      if (debut > fin) throw new Error(`intervalle ${debut}-${fin} à l’envers (champ ${c.nom})`);
    } else {
      debut = entier(base, c);
      // `N/S` : de N jusqu'au bout du champ ; `N` seul : N.
      fin = pasBrut === undefined ? debut : c.max;
    }
    borner(debut, c);
    borner(fin, c);
    for (let i = debut; i <= fin; i += pas) valeurs.add(c.max === 7 && i === 7 ? 0 : i);
  }
  return [...valeurs].sort((a, b) => a - b);
}

/** Analyse une expression à cinq champs. Lève une `Error` au message lisible. */
export function analyserCron(expression: string): CronAnalyse {
  const jetons = expression.trim().split(/\s+/);
  if (jetons.length !== 5 || jetons[0] === '') {
    throw new Error(`une expression cron a exactement 5 champs, pas ${jetons.length}`);
  }
  const [mi, h, jm, mo, js] = jetons as [string, string, string, string, string];
  return {
    minutes: analyserChamp(mi, CHAMPS[0]!),
    heures: analyserChamp(h, CHAMPS[1]!),
    joursDuMois: analyserChamp(jm, CHAMPS[2]!),
    mois: analyserChamp(mo, CHAMPS[3]!),
    joursSemaine: analyserChamp(js, CHAMPS[4]!),
    joursDuMoisLibres: jm.startsWith('*'),
    joursSemaineLibres: js.startsWith('*'),
  };
}

/** `null` si l'expression est valide, sinon la raison. */
export function motifCronInvalide(expression: string): string | null {
  try {
    analyserCron(expression);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

// ─── L'heure MURALE d'un fuseau ─────────────────────────────────────────────
//
// Une heure murale se représente ici comme un nombre de millisecondes dont les
// champs UTC SONT les champs muraux (`Date.UTC(année, mois, jour, h, min)`).
// Toute l'arithmétique de la marche se fait dessus sans jamais consulter le
// fuseau ; seules les deux conversions ci-dessous le lisent.

/**
 * Un formateur par fuseau, gardé : en construire un coûte ~1 ms de travail ICU
 * (mesuré par Paperclip, #8033), et la marche en demanderait des milliers.
 * Borné par le nombre de fuseaux IANA (~600) : aucune croissance sans fin.
 */
const formateurs = new Map<string, Intl.DateTimeFormat>();

function formateur(fuseau: string): Intl.DateTimeFormat {
  let f = formateurs.get(fuseau);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: fuseau,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
    formateurs.set(fuseau, f);
  }
  return f;
}

/** Le fuseau est-il un nom IANA que ce moteur JavaScript connaît ? */
export function fuseauValide(fuseau: string): boolean {
  if (fuseau.length === 0 || fuseau.length > 64) return false;
  try {
    formateur(fuseau);
    return true;
  } catch {
    return false;
  }
}

/** L'heure murale (à la seconde) d'un instant, dans un fuseau. */
export function murale(instant: number, fuseau: string): number {
  const champs: Record<string, number> = {};
  for (const p of formateur(fuseau).formatToParts(new Date(instant))) {
    if (p.type !== 'literal') champs[p.type] = Number(p.value);
  }
  return Date.UTC(
    champs.year ?? 1970,
    (champs.month ?? 1) - 1,
    champs.day ?? 1,
    champs.hour ?? 0,
    champs.minute ?? 0,
    champs.second ?? 0,
  );
}

/** Décalage du fuseau à cet instant, en ms (Paris l'hiver : +3 600 000). */
function decalage(instant: number, fuseau: string): number {
  return murale(instant, fuseau) - (instant - (((instant % 1000) + 1000) % 1000));
}

const DOUZE_HEURES = 12 * 60 * 60 * 1000;

/**
 * L'instant d'une heure murale.
 *
 * ─── LES DEUX CAS OÙ LA RÉPONSE N'EST PAS UNIQUE ─────────────────────────────
 *
 *   · HEURE QUI N'EXISTE PAS (on avance d'une heure, au printemps) : 2 h 30 à
 *     Paris n'a jamais lieu ce jour-là. La routine part à l'heure décalée
 *     (3 h 30), comme `cronie` : sauter la seule exécution quotidienne de
 *     l'année serait une panne muette.
 *   · HEURE QUI A LIEU DEUX FOIS (on recule, à l'automne) : la PREMIÈRE. La
 *     seconde est écartée par `prochaineEcheance`, qui exige un instant
 *     strictement postérieur — une routine horaire ne part pas deux fois.
 *
 * Deux changements d'heure ne sont jamais à moins de douze heures l'un de
 * l'autre : lire le décalage douze heures avant et après suffit.
 */
export function instantDeMurale(mur: number, fuseau: string): number {
  const avant = mur - decalage(mur - DOUZE_HEURES, fuseau);
  const apres = mur - decalage(mur + DOUZE_HEURES, fuseau);
  const valides = [avant, apres].filter((i) => murale(i, fuseau) === mur);
  if (valides.length > 0) return Math.min(...valides);
  return avant;
}

/** Jour de la semaine (0 = dimanche) et heure/minute murales d'un instant. */
export function champsMuraux(
  instant: number,
  fuseau: string,
): { jourSemaine: number; minuteDuJour: number } {
  const d = new Date(murale(instant, fuseau));
  return { jourSemaine: d.getUTCDay(), minuteDuJour: d.getUTCHours() * 60 + d.getUTCMinutes() };
}

// ─── La marche (portée de Paperclip `nextCronTick`) ─────────────────────────

function suivante(valeurs: readonly number[], courante: number): number | null {
  for (const v of valeurs) if (v > courante) return v;
  return null;
}

/** Le jour convient-il ? La règle du OU de cron quand les deux sont restreints. */
function jourConvient(c: CronAnalyse, d: Date): boolean {
  const jm = c.joursDuMois.includes(d.getUTCDate());
  const js = c.joursSemaine.includes(d.getUTCDay());
  if (!c.joursDuMoisLibres && !c.joursSemaineLibres) return jm || js;
  return jm && js;
}

/**
 * Plafond de la marche : quatre ans de minutes, comme l'original. Une
 * expression impossible (`0 0 31 2 *`) rend `null` au lieu de boucler.
 */
const ITERATIONS_MAX = 4 * 366 * 24 * 60;

/** L'heure murale suivante (strictement après `mur`, à la minute) qui convient. */
function prochaineMurale(c: CronAnalyse, mur: number): number | null {
  const d = new Date(mur);
  d.setUTCSeconds(0, 0);
  d.setUTCMinutes(d.getUTCMinutes() + 1);
  for (let i = 0; i < ITERATIONS_MAX; i++) {
    if (!c.mois.includes(d.getUTCMonth() + 1)) {
      // Premier jour du prochain mois admis (au plus 48 mois plus loin).
      let annee = d.getUTCFullYear();
      let mois = d.getUTCMonth() + 1;
      let trouve = false;
      for (let k = 0; k < 48 && !trouve; k++) {
        mois += 1;
        if (mois > 12) [mois, annee] = [1, annee + 1];
        trouve = c.mois.includes(mois);
      }
      if (!trouve) return null;
      d.setUTCFullYear(annee, mois - 1, 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!jourConvient(c, d)) {
      d.setUTCDate(d.getUTCDate() + 1);
      d.setUTCHours(0, 0, 0, 0);
      continue;
    }
    if (!c.heures.includes(d.getUTCHours())) {
      const h = suivante(c.heures, d.getUTCHours());
      if (h === null) {
        d.setUTCDate(d.getUTCDate() + 1);
        d.setUTCHours(0, 0, 0, 0);
      } else {
        d.setUTCHours(h, 0, 0, 0);
      }
      continue;
    }
    if (!c.minutes.includes(d.getUTCMinutes())) {
      const m = suivante(c.minutes, d.getUTCMinutes());
      if (m === null) d.setUTCHours(d.getUTCHours() + 1, 0, 0, 0);
      else d.setUTCMinutes(m, 0, 0);
      continue;
    }
    return d.getTime();
  }
  return null;
}

/**
 * L'échéance suivante, STRICTEMENT après l'instant `apres`, lue dans `fuseau`.
 * `null` : aucune dans les quatre ans (expression impossible).
 *
 * La boucle ne tourne plus d'une fois qu'à l'automne : l'heure murale suivante
 * peut retomber sur un instant déjà passé (l'heure rejouée), et l'on continue
 * alors depuis elle. Bornée, par prudence — jamais plus de deux tours en vrai.
 */
export function prochaineEcheance(c: CronAnalyse, fuseau: string, apres: number): number | null {
  let mur = murale(apres, fuseau);
  for (let tour = 0; tour < 8; tour++) {
    const suiv = prochaineMurale(c, mur);
    if (suiv === null) return null;
    const instant = instantDeMurale(suiv, fuseau);
    if (instant > apres) return instant;
    mur = suiv;
  }
  return null;
}
