// Une durée MESURÉE, dite à la précision que l'œil peut lire — partagée par
// l'accueil du terminal (`tui/rendu.ts`) et les lignes de progrès d'une tâche
// (`node-client/workspace.ts`, `node-client/validations-bac.ts`). Module pur.

/**
 * Une durée, en français, à la précision que l'œil peut lire.
 *
 * ─── POURQUOI PAS TOUJOURS LA MÊME UNITÉ ────────────────────────────────────
 *
 * `0,412 s` demande de compter les décimales ; `12,138 s` ne dit rien de plus
 * que `12 s` ; et `128,4 s` oblige à diviser de tête. La précision utile décroît
 * quand la durée croît — un chiffre après la virgule sous dix secondes, aucun
 * au-delà, et des minutes dès qu'il y en a.
 *
 * L'unité suit la valeur AFFICHÉE, arrondie d'abord : 9,96 s se lit déjà
 * « 10 s » (jamais « 10,0 s »), 59,6 s « 1 min » (jamais « 60 s »), et les
 * minutes se découpent dans les secondes arrondies (jamais « 1 min 60 s »).
 *
 * La virgule est décimale : c'est un installeur en français.
 */
export function dureeCourte(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const dixiemes = Math.round(ms / 100);
  if (dixiemes < 100) return `${(dixiemes / 10).toFixed(1).replace('.', ',')} s`;
  const secondes = Math.round(ms / 1000);
  if (secondes < 60) return `${String(secondes)} s`;
  const min = Math.floor(secondes / 60);
  const reste = secondes - min * 60;
  return reste === 0 ? `${String(min)} min` : `${String(min)} min ${String(reste)} s`;
}
