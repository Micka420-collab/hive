// Les Guetteuses — rendre une intrusion BRUYANTE.
//
// ─── CE QUE CE MODULE NE PRÉTEND PAS ÊTRE ────────────────────────────────────
//
// Il n'existe pas de sécurité inviolable, et un projet qui le prétendrait
// rendrait le pire service à ses utilisateurs : on baisse la garde devant ce
// qu'on croit imprenable. Ce fichier ne ferme aucune porte de plus.
//
// Il fait autre chose, et c'est ce qui manquait : il transforme le RECONNAISSANCE
// SILENCIEUSE en signal. Aujourd'hui, quelqu'un peut passer une nuit à sonder
// une ruche exposée — chercher un `.env`, un `/phpmyadmin`, une sauvegarde
// oubliée — sans que son propriétaire l'apprenne jamais. Après ce module,
// la première requête de ce genre est datée, comptée, et dite.
//
// Le renseignement précède l'intrusion. Le voir, c'est gagner le temps de
// réagir — révoquer un billet, couper une écoute publique, monter un tunnel —
// avant que quelque chose de vraiment coûteux n'arrive.
//
// ─── L'INVARIANT QUI DÉCIDE DE TOUT : ZÉRO FAUX POSITIF ──────────────────────
//
// Une alerte qui se trompe une fois sur dix est une alerte qu'on apprend à
// ignorer — et une alerte ignorée est pire que pas d'alerte, parce qu'elle
// donne l'illusion d'une surveillance.
//
// D'où le choix des leurres : ce sont des chemins qu'AUCUN client légitime de
// Hive ne demande jamais. Ni le dashboard, ni la CLI, ni un nœud membre, ni un
// navigateur qui charge la page. Les toucher n'est pas un accident — c'est un
// scanner. Un test relit les routes réellement déclarées par le serveur et
// vérifie qu'aucun leurre n'en croise une.
//
// ─── ET CE QU'IL NE FAIT PAS NON PLUS ────────────────────────────────────────
//
// Il ne BLOQUE rien par défaut. Bloquer sur détection est tentant, mais une
// ruche derrière un reverse proxy voit toutes ses requêtes venir de la même
// adresse : un blocage automatique y couperait tout le monde d'un coup, sur la
// foi d'un seul visiteur curieux. On observe, on compte, on prévient — comme
// les Gardiennes, qui annotent longtemps avant de contraindre.

/** Une catégorie de leurre, pour que l'hôte sache ce qu'on cherchait chez lui. */
export type Appat =
  | 'secrets' // `.env`, clés, sauvegardes : on cherche à VOLER
  | 'panneau' // phpMyAdmin, wp-admin : on cherche une console d'administration
  | 'depot' // `.git/` : on cherche le code source et son historique
  | 'inventaire'; // routes d'API d'autres produits : on cherche à identifier

export interface Leurre {
  chemin: string;
  appat: Appat;
  /** Ce que la personne cherchait, dit à l'hôte en une phrase. */
  intention: string;
}

/**
 * Les chemins qu'aucun client légitime ne demande.
 *
 * Chacun est le premier coup d'un outil de reconnaissance courant. Le
 * dashboard de Hive ne les connaît pas, la CLI non plus, et un nœud membre
 * parle exclusivement en WebSocket et en `/api/*`.
 */
export const LEURRES: readonly Leurre[] = [
  { chemin: '/.env', appat: 'secrets', intention: 'lire vos secrets de configuration' },
  { chemin: '/.env.local', appat: 'secrets', intention: 'lire vos secrets de configuration' },
  { chemin: '/config.json', appat: 'secrets', intention: 'lire votre configuration' },
  { chemin: '/backup.sql', appat: 'secrets', intention: 'récupérer une sauvegarde de base' },
  { chemin: '/dump.sql', appat: 'secrets', intention: 'récupérer une sauvegarde de base' },
  { chemin: '/id_rsa', appat: 'secrets', intention: 'récupérer une clé SSH' },
  { chemin: '/.git/config', appat: 'depot', intention: 'télécharger votre dépôt git' },
  { chemin: '/.git/head', appat: 'depot', intention: 'télécharger votre dépôt git' },
  { chemin: '/phpmyadmin', appat: 'panneau', intention: 'trouver une console de base de données' },
  { chemin: '/wp-login.php', appat: 'panneau', intention: 'trouver une administration WordPress' },
  { chemin: '/wp-admin', appat: 'panneau', intention: 'trouver une administration WordPress' },
  { chemin: '/administrator', appat: 'panneau', intention: 'trouver une console d’administration' },
  { chemin: '/actuator/env', appat: 'inventaire', intention: 'interroger une application Spring' },
  { chemin: '/server-status', appat: 'inventaire', intention: 'interroger un serveur Apache' },
  {
    chemin: '/vendor/phpunit',
    appat: 'inventaire',
    intention: 'exploiter une faille PHPUnit connue',
  },
  { chemin: '/cgi-bin', appat: 'inventaire', intention: 'trouver un script CGI exécutable' },
] as const;

/**
 * Normalise un chemin avant comparaison.
 *
 * Un scanner n'écrit pas proprement : il envoie `//.env`, `/./.env`,
 * `/.env?x=1`, `/%2Ee%6Ev`. Comparer la chaîne brute laisserait passer tout
 * cela — et un leurre qu'on peut contourner par un `%2E` ne détecte que les
 * outils les plus paresseux.
 */
export function normaliserChemin(brut: string): string {
  let chemin = brut;
  // Le décodage peut échouer sur un `%` isolé : ce n'est pas une raison de
  // renoncer à examiner ce qu'on a.
  try {
    chemin = decodeURIComponent(chemin);
  } catch {
    /* chemin gardé tel quel */
  }
  chemin = chemin.split('?')[0]!.split('#')[0]!;
  chemin = chemin.replace(/\\/g, '/');
  chemin = chemin.replace(/\/+/g, '/');
  chemin = chemin.replace(/\/\.\//g, '/');
  chemin = chemin.toLowerCase();
  if (chemin.length > 1 && chemin.endsWith('/')) chemin = chemin.slice(0, -1);
  return chemin === '' ? '/' : chemin;
}

/** Le leurre touché, ou `null`. */
export function leurreTouche(cheminBrut: string): Leurre | null {
  const chemin = normaliserChemin(cheminBrut);
  return LEURRES.find((l) => chemin === l.chemin || chemin.startsWith(`${l.chemin}/`)) ?? null;
}

// ─── Le jugement ─────────────────────────────────────────────────────────────

/** Un passage repéré au trou de vol. */
export interface Passage {
  /** L'adresse d'où ça venait. Derrière un proxy, ce sera celle du proxy. */
  source: string;
  chemin: string;
  appat: Appat;
  quand: number;
}

export type Niveau = 'calme' | 'reniflage' | 'balayage';

export interface Verdict {
  niveau: Niveau;
  /** Combien de passages dans la fenêtre. */
  passages: number;
  /** Combien d'adresses distinctes. */
  sources: number;
  /** Ce qu'on cherchait chez vous, du plus fréquent au moins. */
  appats: Appat[];
  /** Ce qu'il faut en penser, et ce qu'il y a à faire. */
  conseil: string;
}

/** La fenêtre d'observation. Assez longue pour voir un balayage lent. */
export const FENETRE_MS = 60 * 60 * 1000;

/** Au-delà, ce n'est plus une curiosité : c'est un outil qui déroule sa liste. */
export const SEUIL_BALAYAGE = 5;

/**
 * Que faut-il penser de ce qu'on a vu ?
 *
 * Trois niveaux seulement. Une échelle plus fine donnerait l'illusion d'une
 * précision qu'on n'a pas : on ne sait pas QUI sonde, on sait seulement que
 * quelqu'un sonde, et à quel rythme.
 */
export function juger(passages: readonly Passage[], maintenant: number): Verdict {
  const recents = passages.filter((p) => maintenant - p.quand <= FENETRE_MS);
  const sources = new Set(recents.map((p) => p.source));

  const compte = new Map<Appat, number>();
  for (const p of recents) compte.set(p.appat, (compte.get(p.appat) ?? 0) + 1);
  const appats = [...compte.entries()].sort((a, b) => b[1] - a[1]).map(([a]) => a);

  if (recents.length === 0) {
    return {
      niveau: 'calme',
      passages: 0,
      sources: 0,
      appats: [],
      conseil: 'Rien à signaler : personne n’a cherché de porte dérobée cette dernière heure.',
    };
  }

  if (recents.length < SEUIL_BALAYAGE) {
    return {
      niveau: 'reniflage',
      passages: recents.length,
      sources: sources.size,
      appats,
      conseil:
        'Quelqu’un a cherché des chemins qui n’existent pas chez nous. C’est courant sur ' +
        'une adresse publique et rarement ciblé — mais ça confirme que votre ruche est ' +
        'visible depuis Internet. Si ce n’était pas voulu, repassez HIVE_HOST à 127.0.0.1 ' +
        'et exposez-la par un tunnel (`npm run cli -- tunnel`).',
    };
  }

  return {
    niveau: 'balayage',
    passages: recents.length,
    sources: sources.size,
    appats,
    conseil:
      'Un outil déroule sa liste sur votre ruche. Ce n’est pas encore une intrusion, ' +
      'c’est ce qui la précède. Vérifiez maintenant, pendant que ça ne coûte rien : ' +
      'les billets en circulation (`npm run cli -- membres`), que HIVE_TOKEN fait bien ' +
      'plus de 16 caractères, et que HIVE_INSCRIPTION n’est pas resté sur « ouverte » ' +
      'si la ruche est publique.',
  };
}

/**
 * Le registre des passages — borné, et par construction.
 *
 * Il vit en mémoire et ne va pas en base : une table qui grossit à chaque
 * requête d'un scanner offrirait à l'attaquant un moyen de remplir le disque
 * de sa victime. Le tampon est circulaire, sa taille est fixe, et un redémarrage
 * l'oublie — ce qui est acceptable pour un signal dont l'intérêt est de dire
 * « en ce moment », pas « il y a trois mois ».
 */
export class Registre {
  private readonly passages: Passage[] = [];

  constructor(private readonly maximum = 500) {}

  /** Enregistre un passage et rend le leurre touché, s'il y en a un. */
  noter(chemin: string, source: string, quand: number): Leurre | null {
    const leurre = leurreTouche(chemin);
    if (!leurre) return null;
    this.passages.push({ source, chemin: normaliserChemin(chemin), appat: leurre.appat, quand });
    // Borne dure : on jette les plus vieux, jamais les plus récents.
    if (this.passages.length > this.maximum) {
      this.passages.splice(0, this.passages.length - this.maximum);
    }
    return leurre;
  }

  verdict(maintenant: number): Verdict {
    return juger(this.passages, maintenant);
  }

  /** Les derniers passages, du plus récent au plus ancien. */
  derniers(combien = 20): Passage[] {
    return [...this.passages].reverse().slice(0, combien);
  }
}
