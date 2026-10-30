// Le thème CHOISI, posé avant la première image : le module de l'application
// ne tourne qu'après l'analyse du document, et un choix « clair » sur un OS
// sombre (ou l'inverse) flasherait le temps d'une image. Même clé et mêmes
// valeurs que src/theme.ts ; stockage absent ou qui lève = « système », sans
// attribut.
//
// Un fichier à part, chargé en script CLASSIQUE dans <head> (bloquant, donc
// joué avant la première peinture) — et pas un script en ligne : la coquille
// de bureau pose `script-src 'self'` (desktop/src/csp.ts), qui refuse tout
// script en ligne ; son banc de fumée le compte comme une violation de CSP.
try {
  const t = localStorage.getItem('hive.theme');
  if (t === 'sombre' || t === 'clair')
    document.documentElement.setAttribute('data-theme', t === 'sombre' ? 'dark' : 'light');
} catch {
  // Stockage coupé (navigation privée, politique du poste) : « système ».
}
