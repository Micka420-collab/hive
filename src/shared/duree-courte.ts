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
 * Les minutes se découpent dans les secondes ARRONDIES : arrondir le reste
 * après coup rendait « 1 min 60 s » pour 119,6 s.
 *
 * La virgule est décimale : c'est un installeur en français.
 */
export function dureeCourte(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = ms / 1000;
  if (s < 10) return `${s.toFixed(1).replace('.', ',')} s`;
  if (s < 60) return `${String(Math.round(s))} s`;
  const secondes = Math.round(s);
  const min = Math.floor(secondes / 60);
  const reste = secondes - min * 60;
  return reste === 0 ? `${String(min)} min` : `${String(min)} min ${String(reste)} s`;
}
