// L'INVITATION QUI NE MÈNE NULLE PART.
//
// ─── CE QUI SE PASSAIT ───────────────────────────────────────────────────────
//
// La ruche écoute sur `127.0.0.1` par défaut (`HIVE_HOST`), et c'est le bon
// défaut : rien ne s'expose au réseau sans qu'on le demande. Mais l'invitation,
// elle, annonce l'IP LAN détectée (`detectLanWsUrl`) — donc une adresse sur
// laquelle PERSONNE n'écoute.
//
// L'hôte copie une commande d'apparence parfaite, son ami la colle, et le nœud
// tourne indéfiniment sur une connexion refusée. Les deux cherchent l'erreur
// dans le token, le pare-feu, le port — jamais dans une invitation qui, dès sa
// génération, était injoignable. Mesuré ici : `host = 127.0.0.1`, invitation
// `ws://172.16.20.2:7777/ws`.
//
// ─── CE QUE CE MODULE FAIT, ET CE QU'IL NE FAIT PAS ──────────────────────────
//
// Il ne CHANGE rien : ouvrir l'écoute au LAN est une décision de l'hôte, pas
// un effet de bord du bouton « Inviter un ami ». Il DIT, au moment exact où la
// commande est fabriquée, qu'elle ne pourra pas aboutir — et comment y
// remédier. Pur, sans réseau : le serveur l'appelle, le test le déroule.

/** Un hôte d'écoute qui ne reçoit que la machine elle-même. */
function boucleLocale(hote: string): boolean {
  const h = hote
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  return h === 'localhost' || h === '::1' || /^127\./.test(h);
}

/** L'hôte contenu dans une URL WebSocket, ou `null` si elle est illisible. */
function hoteDe(wsUrl: string): string | null {
  try {
    return new URL(wsUrl).hostname;
  } catch {
    return null;
  }
}

/**
 * L'avertissement à joindre à une invitation, ou `null` si elle est joignable.
 *
 * Le cas visé est UNIQUEMENT celui qui trompe : la ruche n'écoute qu'en boucle
 * locale alors que l'adresse annoncée, elle, désigne le réseau. Une invitation
 * `ws://localhost` sur une écoute locale est cohérente (c'est un nœud sur la
 * même machine) et ne dit rien ; une écoute ouverte (`0.0.0.0`) non plus.
 */
export function inviteInjoignable(hoteEcoute: string, wsUrl: string): string | null {
  if (!boucleLocale(hoteEcoute)) return null;
  const cible = hoteDe(wsUrl);
  if (!cible || boucleLocale(cible)) return null;
  return (
    `Cette ruche n'écoute que sur ${hoteEcoute} : personne d'autre que cette machine ne peut ` +
    `joindre ${cible}. Relancez-la avec HIVE_HOST=0.0.0.0 pour ouvrir l'écoute au réseau local, ` +
    "puis regénérez l'invitation."
  );
}
