// L'AMORCE — dire TOUT ce qui manque, d'un coup, et où l'on a frappé.
//
// ═══ LE DÉFAUT QUE CE MODULE RETIRE ════════════════════════════════════════
//
// Mesuré en jouant le parcours d'un hôte qui monte sa ruche pour la première
// fois, avant un vrai test à distance :
//
//   1. `npm run dev`  → « HIVE_TOKEN trivial refusé »          … il corrige
//   2. `npm run dev`  → « HIVE_JWT_SECRET manquant »           … il corrige
//   3. `npm run dev`  → debout
//
// Trois démarrages là où un seul suffisait. Chaque message était juste, clair,
// et donnait le remède — mais ils arrivaient l'un APRÈS l'autre, parce que
// chaque garde levait au lieu de s'ajouter à un constat commun.
//
// Un contrôle qui s'arrête au premier manque fait découvrir la liste par
// tâtonnement. Ce n'est pas seulement pénible : quelqu'un qui installe pendant
// que son collègue attend au téléphone abandonne au deuxième aller-retour.
//
// ═══ ET LA SECONDE MOITIÉ : OÙ A-T-ON FRAPPÉ ? ═════════════════════════════
//
// La même sonde a rendu ceci, côté hôte, en créant l'invitation :
//
//     Erreur : fetch failed
//
// Quatre mots. Ni l'adresse visée, ni la cause, ni la variable qui la décide.
// Or c'est le mode d'échec le PLUS courant d'un premier essai — la CLI pointe
// ailleurs que la ruche —, et c'était le message le moins utile possible.
//
// Le nom d'une variable d'environnement ne se devine pas. Le dire coûte une
// ligne ; le taire coûte une session.

/** Une chose qui manque pour démarrer, et de quoi la régler. */
export interface Manque {
  /** La variable ou le réglage en cause. */
  readonly quoi: string;
  /** Ce que ça coûte de s'en passer — pas ce que la règle a détecté. */
  readonly pourquoi: string;
  /** La commande ou la valeur qui règle le cas, telle qu'on la tape. */
  readonly remede: string;
}

export interface EtatAmorce {
  readonly simulation: boolean;
  readonly token: string;
  readonly corsOrigins: readonly string[];
  /** Le secret de session RÉSOLU (vide s'il est absent, trop court ou public). */
  readonly secretJwt: string;
}

export const TOKEN_PAR_DEFAUT = 'change-me';
export const TOKEN_LONGUEUR_MIN = 16;
export const SECRET_JWT_LONGUEUR_MIN = 24;

/**
 * TOUT ce qui empêche cette ruche de démarrer, en une passe.
 *
 * L'ordre est celui du coût : le jeton d'abord (il ouvre la ruche entière), le
 * secret de session ensuite (il permet de se forger une session
 * d'administrateur), les origines en dernier (elles n'ouvrent que le
 * navigateur d'un tiers).
 *
 * Rend une liste VIDE quand tout va bien — l'appelant lève, ou non, mais la
 * décision de lever ne se prend pas ici : ce module est pur pour pouvoir être
 * éprouvé sans démarrer un serveur.
 */
export function manquesDeDemarrage(etat: EtatAmorce): readonly Manque[] {
  // La simulation est une démo STRICTEMENT locale : on n'y demande rien, et
  // c'est la seule porte qui s'ouvre sans secret. Testée en premier parce
  // qu'elle rend toutes les autres questions sans objet.
  if (etat.simulation) return [];

  const manques: Manque[] = [];

  if (etat.token === TOKEN_PAR_DEFAUT || etat.token.length < TOKEN_LONGUEUR_MIN) {
    manques.push({
      quoi: 'HIVE_TOKEN',
      pourquoi:
        'Ce jeton est la porte de la ruche : qui l’a peut créer des tâches, lire les ' +
        'diffs et exclure des nœuds. Celui par défaut est publié.',
      remede:
        "HIVE_TOKEN=$(node -e \"console.log(require('crypto').randomBytes(24).toString('hex'))\")",
    });
  }

  if (etat.secretJwt === '') {
    manques.push({
      quoi: 'HIVE_JWT_SECRET',
      pourquoi:
        'Il signe les sessions. Absent, trop court ou laissé à la valeur publiée, se forger ' +
        'la session de l’administrateur devient un exercice de cinq lignes.',
      remede:
        "HIVE_JWT_SECRET=$(node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\")",
    });
  }

  if (etat.corsOrigins.length === 0 || etat.corsOrigins.includes('*')) {
    manques.push({
      quoi: 'HIVE_CORS_ORIGIN',
      pourquoi:
        'Avec « * », n’importe quelle page ouverte dans votre navigateur peut parler à ' +
        'votre ruche en votre nom.',
      remede: 'HIVE_CORS_ORIGIN=http://127.0.0.1:7777',
    });
  }

  return manques;
}

/**
 * Les manques, dits d'un seul tenant.
 *
 * `« npm run install:hive » les pose tous` est rappelé À LA FIN : celui qui lit
 * a d'abord besoin de savoir CE QUI manque — s'il voit d'emblée une commande
 * magique, il la lance sans comprendre ce qu'elle règle, et ne saura pas quoi
 * faire le jour où elle ne s'applique pas (un conteneur, une CI, un service).
 */
export function direManques(manques: readonly Manque[]): string {
  if (manques.length === 0) return '';
  const titre =
    manques.length === 1
      ? 'Il manque une chose pour démarrer cette ruche :'
      : `Il manque ${manques.length} choses pour démarrer cette ruche :`;
  const corps = manques
    .map((m, i) => `  ${i + 1}. ${m.quoi} — ${m.pourquoi}\n     → ${m.remede}`)
    .join('\n\n');
  return (
    `${titre}\n\n${corps}\n\n` +
    '  « npm run install:hive » les pose pour vous.\n' +
    '  « HIVE_SIMULATION=1 » ouvre une démo strictement locale, sans aucun de ces secrets.'
  );
}

/**
 * Pourquoi la CLI n'a pas joint la ruche — en nommant l'adresse ET la variable.
 *
 * ─── CE QUE `fetch failed` NE DIT PAS ────────────────────────────────────────
 *
 * `fetch` rend un `TypeError: fetch failed` identique pour un port fermé, un
 * nom qui ne résout pas, un certificat refusé et un mandataire qui bloque. Le
 * message brut est donc à la fois le plus fréquent et le moins informatif.
 *
 * On ne DEVINE pas laquelle des quatre : on donne ce dont on est sûr — l'URL
 * visée, la variable qui la décide, et la cause profonde quand Node la joint
 * (`err.cause`, où vit le vrai `ECONNREFUSED`).
 */
export function expliquerRucheInjoignable(err: unknown, base: string, variable: string): string {
  const cause = causeProfonde(err);
  return (
    `\n✘ Ruche injoignable à ${base}${cause === '' ? '' : ` (${cause})`}.\n\n` +
    '  Trois choses à vérifier, dans cet ordre :\n' +
    '    1. la ruche tourne-t-elle ?      `npm run dev` dans le dossier de l’hôte\n' +
    `    2. est-ce la bonne adresse ?     c'est ${variable} qui la décide\n` +
    `                                     ex. ${variable}=http://127.0.0.1:7777\n` +
    '    3. le port est-il joignable ?    `npm run cli -- doctor`\n'
  );
}

/** La cause la plus profonde qu'on puisse nommer, ou rien plutôt qu'un à-peu-près. */
function causeProfonde(err: unknown): string {
  if (!(err instanceof Error)) return '';
  // `fetch` enveloppe : le `ECONNREFUSED` qui informe vraiment est dans
  // `cause`, jamais dans le message de surface.
  const dessous = (err as { cause?: unknown }).cause;
  if (dessous instanceof Error && dessous.message !== '') return dessous.message;
  if (typeof dessous === 'object' && dessous !== null && 'code' in dessous) {
    const code = (dessous as { code?: unknown }).code;
    if (typeof code === 'string' && code !== '') return code;
  }
  return err.message;
}

/** Cette panne est-elle « je n'ai pas pu joindre », par opposition à un refus ? */
export function estInjoignable(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  // `fetch failed` est le message que Node donne à TOUTES les pannes de
  // transport. Un refus applicatif (401, 409…) arrive par un autre chemin, avec
  // un message que la ruche a écrit — et qu'il ne faut surtout pas remplacer
  // par un conseil de dépannage réseau.
  return err.message.includes('fetch failed') || err.name === 'TypeError';
}
