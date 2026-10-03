// Ce que dit une recherche de mise à jour qui échoue — sans Electron, pour
// être éprouvé (tests/bureau-coquille.test.ts).
//
// ─── « RIEN N'EST PUBLIÉ » N'EST PAS UNE PANNE ───────────────────────────────
//
// electron-updater lit `latest.yml` (`latest-mac.yml`, `latest-linux.yml`)
// dans la DERNIÈRE Release publiée. Une Release publiée sans ce fichier — la
// v0.4.0, d'avant l'app —, ou aucune Release du tout : il lève. Son propre
// écouteur d'`error` en écrivait alors la pile entière en `[error]`, en-têtes
// HTTP compris, et l'app la répétait deux fois en `[warn]` (son `error`, puis
// le rejet de `checkForUpdates`). Le journal de Hive 0.5.0 s'ouvrait ainsi sur
// une soixantaine de lignes d'erreur pour dire qu'il n'y avait rien à
// installer — et un vrai incident se serait lu comme ce bruit-là.
//
// Ces deux codes disent « pas de mise à jour ». Pas
// `ERR_UPDATER_LATEST_VERSION_NOT_FOUND` : electron-updater y range AUSSI un
// réseau coupé (`getLatestTagName`), qui reste une panne dite.

const RIEN_DE_PUBLIE: ReadonlySet<string> = new Set([
  'ERR_UPDATER_CHANNEL_FILE_NOT_FOUND',
  'ERR_UPDATER_NO_PUBLISHED_VERSIONS',
]);

/** L'échec dit seulement qu'aucune version n'est publiée pour ce système. */
export function rienDePublie(e: unknown): boolean {
  if (typeof e !== 'object' || e === null || !('code' in e)) return false;
  return typeof e.code === 'string' && RIEN_DE_PUBLIE.has(e.code);
}

/**
 * Une vraie panne, en UNE ligne : les messages d'electron-updater embarquent
 * la pile et les en-têtes de la réponse HTTP, qui n'apprennent rien à
 * l'opérateur et noient le journal.
 */
export function ligneDePanne(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  return message.split('\n', 1)[0]?.trim() || 'échec sans message';
}
