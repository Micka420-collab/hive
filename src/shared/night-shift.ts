// Night Shift (palier 4) — politique d'exécution en heures creuses.
//
// Un membre prête sa machine à la ruche, mais pas forcément 24h/24 : « fais
// travailler mon agent seulement la nuit » ou « pendant ma pause déjeuner ». Ce
// module PUR répond à une seule question : à l'instant T, ce nœud accepte-t-il
// du travail ? Il gère les fenêtres qui passent minuit (22h→8h) et se configure
// simplement via HIVE_SHIFT (ex. « 22-8 » ou « 22:30-8,13-14 »).
//
// Sans dépendance ni I/O : la décision est déterministe pour une heure donnée.
// L'heure est celle de la machine DU MEMBRE (sa préférence, son fuseau) — jamais
// imposée par le hub.

/** Fenêtre de disponibilité, en minutes depuis minuit [0, 1440). */
export interface ShiftWindow {
  startMin: number;
  endMin: number;
}

export interface NightShiftPolicy {
  /** Fenêtres pendant lesquelles le nœud accepte du travail. Vide ⇒ 24h/24. */
  windows: ShiftWindow[];
}

const MINUTES_PER_DAY = 24 * 60;

/** Parse « HH » ou « HH:MM » en minutes depuis minuit. Lève sur valeur invalide. */
function parseTime(token: string): number {
  const m = /^(\d{1,2})(?::(\d{2}))?$/.exec(token.trim());
  if (!m) throw new Error(`Heure invalide : « ${token} » (attendu HH ou HH:MM).`);
  const hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  if (hours > 23 || minutes > 59) {
    throw new Error(`Heure hors bornes : « ${token} » (00:00–23:59).`);
  }
  return hours * 60 + minutes;
}

/**
 * Parse une spec de fenêtres : fenêtres séparées par des virgules, chaque
 * fenêtre « début-fin » (ex. « 22-8,13:30-14 »). Une fenêtre « X-X » (début =
 * fin) couvre la journée entière. Lève une erreur claire sur toute fenêtre mal
 * formée — pour qu'une mauvaise config soit visible plutôt que silencieuse.
 */
export function parseWindows(spec: string): ShiftWindow[] {
  const trimmed = spec.trim();
  if (trimmed === '') return [];
  return trimmed.split(',').map((part) => {
    const bounds = part.split('-');
    if (bounds.length !== 2) {
      throw new Error(`Fenêtre invalide : « ${part} » (attendu « début-fin »).`);
    }
    return { startMin: parseTime(bounds[0] ?? ''), endMin: parseTime(bounds[1] ?? '') };
  });
}

/** Vrai si `minute` (0–1439) tombe dans la fenêtre, en gérant le passage minuit. */
function isWithin(window: ShiftWindow, minute: number): boolean {
  const { startMin, endMin } = window;
  if (startMin === endMin) return true; // fenêtre « pleine journée »
  if (startMin < endMin) return minute >= startMin && minute < endMin;
  return minute >= startMin || minute < endMin; // la fenêtre enjambe minuit
}

/** Minutes depuis minuit pour une Date (heure locale de la machine). */
function minutesOfDay(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Le nœud est-il « de service » à l'instant donné ? Aucune fenêtre ⇒ toujours
 * disponible (24h/24). Sinon, disponible s'il est dans au moins une fenêtre.
 */
export function isOnShift(policy: NightShiftPolicy, date: Date): boolean {
  if (policy.windows.length === 0) return true;
  const minute = minutesOfDay(date);
  return policy.windows.some((w) => isWithin(w, minute));
}

/**
 * Minutes à attendre avant la prochaine ouverture : 0 si le nœud est déjà de
 * service (ou disponible 24h/24), sinon le délai jusqu'à la prochaine fenêtre
 * (recherche bornée sur 24 h — toujours concluante puisqu'il existe une fenêtre).
 */
export function minutesUntilOpen(policy: NightShiftPolicy, date: Date): number {
  if (isOnShift(policy, date)) return 0;
  const start = minutesOfDay(date);
  for (let delta = 1; delta <= MINUTES_PER_DAY; delta++) {
    const minute = (start + delta) % MINUTES_PER_DAY;
    if (policy.windows.some((w) => isWithin(w, minute))) return delta;
  }
  return 0; // inatteignable si des fenêtres existent (couvertes par isOnShift)
}

/** Construit la politique depuis l'environnement du membre (HIVE_SHIFT). */
export function nightShiftFromEnv(env: NodeJS.ProcessEnv = process.env): NightShiftPolicy {
  return { windows: parseWindows(env.HIVE_SHIFT ?? '') };
}

/** Formate une fenêtre en « HH:MM-HH:MM » (pour l'affichage). */
export function formatWindow(window: ShiftWindow): string {
  const hhmm = (min: number): string => {
    const h = Math.floor(min / 60)
      .toString()
      .padStart(2, '0');
    const m = (min % 60).toString().padStart(2, '0');
    return `${h}:${m}`;
  };
  return `${hhmm(window.startMin)}-${hhmm(window.endMin)}`;
}
