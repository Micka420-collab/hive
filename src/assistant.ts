// L'assistant de configuration — MODULE PUR.
//
// ─── POURQUOI CE FICHIER EXISTE ──────────────────────────────────────────────
//
// L'installeur pose le `.env` et s'arrête là. Restaient deux marches, et ce
// sont les deux qui font abandonner :
//
//   1. « J'ai une ruche. Et maintenant, je fais quoi ? » — il faut un premier
//      projet, et rien ne dit comment.
//   2. « Comment mes amis s'y connectent ? » — il faut choisir entre quatre
//      façons d'être joignable, dont trois se configurent mal.
//
// Ce module prend des RÉPONSES et rend trois choses : les réglages à poser,
// les étapes à suivre, et les refus. Il ne lit rien, n'écrit rien, ne sonde
// rien — ce qui permet de tester la partie qui décide, y compris les refus de
// sécurité, sans ouvrir un port ni toucher à un fichier.
//
// ─── CE QU'IL NE FAIT PAS, ET C'EST DÉLIBÉRÉ ─────────────────────────────────
//
// Il ne lance aucune commande. Il compose celles que l'humain lancera, en les
// AFFICHANT. Poser un tunnel Cloudflare ou un reverse proxy touche à des
// comptes, à du DNS et à des ports : ce sont des gestes qui se font les yeux
// ouverts, pas dans le dos de quelqu'un qui voulait juste installer une ruche.

import { etapesTunnelNomme, hoteValide, urlStable } from './node-client/cloudflare.js';
import { LIMITS } from './shared/protocol.js';
import { DEFAULT_TOKEN, MIN_TOKEN_LENGTH } from './shared/types.js';

// ─── Comment la ruche est joignable ──────────────────────────────────────────

/**
 * Les quatre façons d'être joignable, dans l'ordre de préférence du §8 de la
 * mission — et « locale » d'abord, parce que c'est la seule qui n'expose rien.
 */
export const EXPOSITIONS = ['locale', 'reseau_local', 'tunnel', 'proxy'] as const;
export type Exposition = (typeof EXPOSITIONS)[number];

/** Une ligne de `.env` que l'assistant propose de poser. */
export interface ReglagePropose {
  cle: string;
  valeur: string;
  pourquoi: string;
}

/** Une chose que l'humain devra faire, avec la commande exacte. */
export interface Etape {
  titre: string;
  commande: string;
  pourquoi: string;
}

export interface PlanExposition {
  reglages: ReglagePropose[];
  etapes: Etape[];
  /** Non nul quand la ruche REFUSE cette configuration. Rien n'est posé. */
  refus: string | null;
  /** Ce qui est vrai et déplaisant. Ne bloque pas ; se dit quand même. */
  avertissements: string[];
}

export interface ReponsesExposition {
  exposition: Exposition;
  port: number;
  /** Le jeton en service, pour juger si une écoute publique est acceptable. */
  jeton: string;
  /** Le domaine, pour le tunnel et le reverse proxy. */
  domaine?: string | undefined;
  /** Le nom du tunnel Cloudflare. Un défaut suffit. */
  nomTunnel?: string | undefined;
}

/**
 * Un jeton qui ne protège rien.
 *
 * La règle du §8 : `0.0.0.0` exige DEUX choses, le choix explicite **et** un
 * jeton non trivial. Exposer une ruche protégée par « change-me » sur un
 * réseau, c'est la donner ; le refus vaut mieux que l'avertissement, parce
 * qu'un avertissement se lit après coup.
 */
function jetonTrivial(jeton: string): boolean {
  return jeton.trim() === '' || jeton === DEFAULT_TOKEN || jeton.trim().length < MIN_TOKEN_LENGTH;
}

/** Le bloc Caddy, qui gère le WebSocket sans qu'on le lui demande. */
function extraitCaddy(domaine: string, port: number): string {
  return `${domaine} { reverse_proxy 127.0.0.1:${port} }`;
}

/**
 * Le bloc nginx — avec les en-têtes `Upgrade`.
 *
 * C'EST LE PIÈGE CLASSIQUE, et il est vicieux : sans ces quatre lignes, le
 * dashboard se charge parfaitement et paraît fonctionner, mais le WebSocket
 * échoue en silence — donc aucun nœud ne se connecte, aucune tâche ne part, et
 * rien n'explique pourquoi. Le laisser au lecteur, c'est le condamner à une
 * soirée de recherche.
 */
function extraitNginx(domaine: string, port: number): string {
  return [
    `server {`,
    `  server_name ${domaine};`,
    `  location / {`,
    `    proxy_pass http://127.0.0.1:${port};`,
    `    proxy_http_version 1.1;`,
    `    proxy_set_header Upgrade $http_upgrade;`,
    `    proxy_set_header Connection "upgrade";`,
    `    proxy_set_header Host $host;`,
    `    proxy_read_timeout 3600s;`,
    `  }`,
    `}`,
  ].join('\n');
}

/**
 * Traduit un choix d'exposition en réglages, en étapes et en refus.
 *
 * Aucune des quatre branches ne se contente d'un réglage : chacune dit AUSSI
 * ce qui reste à faire à la main, parce qu'un `.env` correct devant un port
 * fermé ne rend service à personne.
 */
export function planExposition(r: ReponsesExposition): PlanExposition {
  const vide: PlanExposition = { reglages: [], etapes: [], refus: null, avertissements: [] };
  const domaine = (r.domaine ?? '').trim();

  if (r.exposition === 'locale') {
    return {
      ...vide,
      reglages: [
        {
          cle: 'HIVE_HOST',
          valeur: '127.0.0.1',
          pourquoi: 'la ruche n’écoute que cette machine — rien ne sort',
        },
        {
          cle: 'HIVE_CORS_ORIGIN',
          valeur: `http://localhost:${r.port}`,
          pourquoi: 'l’origine exacte du dashboard, jamais « * »',
        },
      ],
    };
  }

  if (r.exposition === 'reseau_local') {
    if (jetonTrivial(r.jeton)) {
      return {
        ...vide,
        refus:
          'Écouter sur 0.0.0.0 avec ce jeton reviendrait à ouvrir la ruche à ' +
          `quiconque atteint la machine. Posez d’abord un HIVE_TOKEN d’au moins ` +
          `${MIN_TOKEN_LENGTH} caractères — « npm run install:hive » en engendre un.`,
      };
    }
    return {
      ...vide,
      reglages: [
        {
          cle: 'HIVE_HOST',
          valeur: '0.0.0.0',
          pourquoi: 'accepte les nœuds du réseau local',
        },
      ],
      avertissements: [
        'Le trafic circulera EN CLAIR : Hive ne fait pas de TLS lui-même. Sur un ' +
          'réseau de confiance c’est l’usage ; sur un réseau partagé, préférez le tunnel.',
        'Pensez à annoncer HIVE_PUBLIC_URL si l’IP détectée automatiquement n’est pas ' +
          'celle que vos amis peuvent joindre.',
      ],
    };
  }

  if (r.exposition === 'tunnel') {
    if (!hoteValide(domaine)) {
      return {
        ...vide,
        refus:
          'Un tunnel nommé demande un nom de domaine que vous contrôlez chez ' +
          'Cloudflare (par exemple ruche.mondomaine.fr). Sans lui, l’URL changerait ' +
          'à chaque démarrage et vos invitations deviendraient caduques.',
      };
    }
    const nom = (r.nomTunnel ?? '').trim() || 'hive';
    return {
      ...vide,
      reglages: [
        {
          cle: 'HIVE_HOST',
          valeur: '127.0.0.1',
          pourquoi: 'AUCUN port ouvert : c’est le tunnel qui sort, pas le réseau qui entre',
        },
        {
          cle: 'HIVE_CORS_ORIGIN',
          valeur: `https://${domaine}`,
          pourquoi: 'l’origine par laquelle le dashboard sera servi',
        },
        {
          cle: 'HIVE_PUBLIC_URL',
          valeur: urlStable(domaine),
          pourquoi: 'l’URL stable qui partira dans vos invitations',
        },
      ],
      etapes: etapesTunnelNomme(nom, domaine, r.port).map((e) => ({
        titre: e.titre,
        commande: e.commande,
        pourquoi: e.pourquoi,
      })),
      avertissements: [
        'Le tunnel doit tourner en même temps que la ruche. « cloudflared service ' +
          'install » le relance au démarrage de la machine.',
      ],
    };
  }

  // proxy
  if (!hoteValide(domaine)) {
    return {
      ...vide,
      refus:
        'Un reverse proxy a besoin du domaine qu’il servira (par exemple ' +
        'ruche.mondomaine.fr) pour obtenir un certificat et pour l’origine CORS.',
    };
  }
  return {
    ...vide,
    reglages: [
      {
        cle: 'HIVE_HOST',
        valeur: '127.0.0.1',
        pourquoi: 'seul le proxy parle à la ruche ; elle n’est pas exposée directement',
      },
      {
        cle: 'HIVE_CORS_ORIGIN',
        valeur: `https://${domaine}`,
        pourquoi: 'l’origine exacte servie par le proxy',
      },
      {
        cle: 'HIVE_PUBLIC_URL',
        valeur: urlStable(domaine),
        pourquoi: 'l’URL annoncée dans les invitations',
      },
    ],
    etapes: [
      {
        titre: 'Caddy — le plus court, TLS automatique',
        commande: extraitCaddy(domaine, r.port),
        pourquoi:
          'Caddy relaie le WebSocket sans configuration supplémentaire et obtient\n' +
          '     le certificat tout seul.',
      },
      {
        titre: 'nginx — les en-têtes Upgrade sont OBLIGATOIRES',
        commande: extraitNginx(domaine, r.port),
        pourquoi:
          'Sans « Upgrade » ni « Connection », le dashboard se charge et paraît\n' +
          '     marcher, mais le WebSocket échoue EN SILENCE : aucun nœud ne se\n' +
          '     connecte et rien n’explique pourquoi.',
      },
    ],
    avertissements: ['Le certificat TLS est la responsabilité du proxy. Hive n’en pose aucun.'],
  };
}

// ─── Le premier projet ───────────────────────────────────────────────────────

export interface PlanProjet {
  /** La commande exacte à lancer, une fois la ruche démarrée. */
  commande: string;
  refus: string | null;
  avertissements: string[];
}

/**
 * Compose la commande qui crée le premier projet.
 *
 * L'assistant ne la LANCE pas : créer un projet suppose que l'orchestrateur
 * tourne, ce qui n'est pas le cas pendant l'installation. Rendre la commande
 * plutôt que l'exécuter évite la classe entière d'erreurs « ça a échoué et je
 * ne sais pas dans quel état c'est ».
 */
export function planProjet(nom: string, repoUrl?: string): PlanProjet {
  const propre = nom.trim();
  const vide: PlanProjet = { commande: '', refus: null, avertissements: [] };

  if (propre === '') return { ...vide, refus: 'Un projet a besoin d’un nom.' };
  if (propre.length > LIMITS.name) {
    return { ...vide, refus: `Le nom dépasse ${LIMITS.name} caractères.` };
  }
  // Un caractère de contrôle dans un nom finit dans un terminal, un journal et
  // une page web. On le refuse à l'entrée plutôt que de l'échapper partout.
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f]/.test(propre)) {
    return { ...vide, refus: 'Le nom contient un caractère de contrôle.' };
  }

  const depot = (repoUrl ?? '').trim();
  if (depot !== '' && !/^(https?:\/\/|git@)/.test(depot)) {
    return {
      ...vide,
      refus:
        'L’adresse du dépôt doit commencer par https:// ou git@ — ' +
        'c’est ce que Hive sait cloner.',
    };
  }

  return {
    commande:
      depot === ''
        ? `npm run cli -- project ${JSON.stringify(propre)}`
        : `npm run cli -- project ${JSON.stringify(propre)} ${depot}`,
    refus: null,
    avertissements:
      depot === ''
        ? [
            'Sans dépôt, la ruche travaillera dans un espace vide : parfait pour ' +
              'essayer, insuffisant pour livrer. Vous pourrez en connecter un plus ' +
              'tard avec « npm run cli -- github ».',
          ]
        : [],
  };
}

// ─── Ce qui change dans le `.env` ────────────────────────────────────────────

export interface Fusion {
  /** Clés absentes du fichier : elles seront ajoutées. */
  ajouts: ReglagePropose[];
  /** Clés présentes avec une AUTRE valeur : elles seront remplacées. */
  changements: Array<ReglagePropose & { ancienne: string }>;
  /** Clés déjà à la bonne valeur : rien à faire. */
  inchangees: ReglagePropose[];
}

/**
 * Range les réglages proposés en trois tas, pour que le récapitulatif dise la
 * vérité.
 *
 * « Ajouter HIVE_PUBLIC_URL » et « remplacer HIVE_CORS_ORIGIN qui valait autre
 * chose » ne se valent pas : le second efface une décision antérieure. Les
 * confondre sous un même « écrire le .env » est exactement ce qui rend un
 * installeur effrayant.
 */
export function fusionner(
  existant: ReadonlyMap<string, string>,
  proposes: readonly ReglagePropose[],
): Fusion {
  const fusion: Fusion = { ajouts: [], changements: [], inchangees: [] };
  for (const r of proposes) {
    const ancienne = existant.get(r.cle);
    if (ancienne === undefined) fusion.ajouts.push(r);
    else if (ancienne === r.valeur) fusion.inchangees.push(r);
    else fusion.changements.push({ ...r, ancienne });
  }
  return fusion;
}
