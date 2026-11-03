// Le thème de Hive Studio, posé sur <html> AVANT la première peinture.
//
// Sans ce fichier, la page s'afficherait d'abord dans le thème par défaut de
// la feuille, puis basculerait quand React lirait la préférence : un éclair
// blanc à chaque ouverture pour qui a choisi le clair, ou l'inverse. Un
// fichier, et non un script en ligne : la politique de sécurité de
// l'application de bureau n'autorise que les scripts servis par l'origine
// (`script-src 'self'`).
//
// Même règle que `dashboard/src/studio/preferences.ts` (`lireTheme`,
// `themeApplique`) : une valeur illisible vaut « sombre », le thème de la
// maquette validée.
//
// Servi tel quel par la ruche, hors de Vite : ESLint ne le sait pas dans un
// navigateur, d'où la déclaration de ses globales.
/* global localStorage, window, document */
(function () {
  var choix = 'sombre';
  try {
    var v = localStorage.getItem('hive.theme');
    if (v === 'clair' || v === 'auto' || v === 'sombre') choix = v;
  } catch {
    // Stockage refusé (navigation privée) : le défaut.
  }
  var applique = choix;
  if (choix === 'auto') {
    var sombre = true;
    try {
      sombre = window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      // matchMedia absent : le défaut.
    }
    applique = sombre ? 'sombre' : 'clair';
  }
  document.documentElement.setAttribute('data-theme', applique);
  document.documentElement.style.colorScheme = applique === 'sombre' ? 'dark' : 'light';
})();
