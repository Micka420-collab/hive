// Copier du texte dans le presse-papiers — UNE fois, pour tout le tableau de bord.
//
// ─── POURQUOI CE MODULE EXISTE ───────────────────────────────────────────────
//
// Trois endroits copiaient déjà du texte, avec trois réponses différentes à la
// même question :
//
//   · `InvitePanel` — `navigator.clipboard` PUIS un repli par zone de texte ;
//   · `SauvegardesTimeline` — `navigator.clipboard` seul, donc en échec sur
//     toute ruche servie en http ;
//   · et le troisième arrivait avec la fiche des outils IA.
//
// La question est la même partout : « mettre ce texte dans le presse-papiers ».
// Une seule source, donc, et les autres en dérivent. C'est la règle du § 2.6
// ter du journal, appliquée à l'endroit où elle vient d'être écrite.
//
// ─── LE PIÈGE QUE LE REPLI ÉVITE ────────────────────────────────────────────
//
// `navigator.clipboard` n'existe QUE dans un contexte sécurisé : https, ou
// localhost. Hive est LAN-first — on l'ouvre sur `http://192.168.x.x`, et là
// l'API n'est pas là. Sans repli, le bouton « copier » échoue TOUJOURS chez les
// gens qui utilisent la ruche comme elle est faite pour l'être.

/**
 * Le repli pour les contextes non sécurisés : une zone de texte hors écran,
 * sélectionnée, puis `execCommand('copy')`.
 *
 * Obsolète au sens des standards, et sans remplaçant dans un contexte non
 * sécurisé. Le retirer casserait la copie sur le mode de déploiement principal
 * du projet.
 */
function repliZoneDeTexte(texte: string): boolean {
  const ta = document.createElement('textarea');
  ta.value = texte;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  let ok: boolean;
  try {
    ok = document.execCommand('copy');
  } catch {
    ok = false;
  }
  document.body.removeChild(ta);
  return ok;
}

/**
 * Copie `texte`. Rend `true` si ça a marché, `false` sinon — et ne LÈVE jamais.
 *
 * Pas d'exception, parce qu'aucun appelant n'a de meilleure conduite à tenir
 * qu'afficher « copiez à la main ». Une promesse rejetée oubliée dans un
 * composant devient un rejet non capté, et un rejet non capté dans un banc de
 * rendu retombe dans la fenêtre du banc suivant (§ 2.14 bis).
 *
 * Une chaîne VIDE n'est pas copiée : c'est un appelant qui n'a rien à donner,
 * et écraser le presse-papiers de quelqu'un avec du vide est une petite
 * trahison qu'on peut s'épargner.
 */
export async function copierTexte(texte: string): Promise<boolean> {
  if (texte === '') return false;
  try {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texte);
      return true;
    }
    return repliZoneDeTexte(texte);
  } catch {
    // `writeText` peut rejeter même en contexte sécurisé — permission refusée,
    // document sans focus. Le repli reste la bonne conduite.
    try {
      return repliZoneDeTexte(texte);
    } catch {
      return false;
    }
  }
}
