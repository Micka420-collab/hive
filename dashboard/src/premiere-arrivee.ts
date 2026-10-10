// L'ASSISTANT DE PREMIÈRE ARRIVÉE — ses décisions, hors du JSX.
//
// Comme `differees.ts` et `projets-rendu.ts` : ce qui décide (s'ouvrir ou non,
// quelle étape suit laquelle) vit ici, PUR, pour qu'un banc l'éprouve sans
// monter l'écran.

import { ETAPES_ASSISTANT } from '../../src/shared/configuration-initiale';
import type {
  ConnecteurInitial,
  EtapeAssistant,
  ModeRuche,
  PolitiqueSecrets,
  PreferenceGit,
} from '../../src/shared/configuration-initiale';
import type { EtatConfigurationInitiale } from './api';
import type { Translate } from './i18n';

type Traduire = Translate;

/** L'événement qui relance l'assistant, d'où qu'on soit (l'Intendance le lève). */
export const EVENT_PREMIERE_ARRIVEE = 'hive:premiere-arrivee';

/** Levé quand l'assistant a rangé une configuration terminée : les encarts se relisent. */
export const EVENT_CONFIGURATION_CHANGEE = 'hive:configuration-changee';

/**
 * « Plus tard » vaut pour CET onglet. Rangé en `sessionStorage` : fermer
 * l'assistant ne doit pas le rouvrir à chaque changement de vue, mais un
 * nouvel onglet, lui, le repropose — la ruche n'est toujours pas configurée.
 */
const CLE_PLUS_TARD = 'hive.premiere-arrivee.plus-tard';

export function remettreAPlusTard(): void {
  try {
    sessionStorage.setItem(CLE_PLUS_TARD, '1');
  } catch {
    // Stockage coupé : « plus tard » vaut jusqu'au rechargement, pas au-delà.
  }
}

export function renvoyeAPlusTard(): boolean {
  try {
    return sessionStorage.getItem(CLE_PLUS_TARD) === '1';
  } catch {
    return false;
  }
}

/**
 * L'assistant s'ouvre-t-il SEUL ?
 *
 * Seulement quand la ruche n'a jamais été configurée (`termineeA` absent) ET
 * que la personne peut l'écrire. Un membre ne se voit pas proposer un
 * assistant qui lui dirait non à chaque étape ; une ruche déjà configurée ne
 * le repropose jamais — il se relance à la main, depuis l'Intendance.
 */
export function doitOuvrirSeul(etat: EtatConfigurationInitiale | null, plusTard: boolean): boolean {
  if (!etat || plusTard) return false;
  return etat.ecriture === 'permis' && (etat.configuration?.termineeA ?? null) === null;
}

/** L'étape où reprendre : celle qui a été rangée, l'accueil sinon. */
export function etapeDeReprise(etat: EtatConfigurationInitiale | null): EtapeAssistant {
  return etat?.configuration?.etape ?? 'accueil';
}

export function etapeSuivante(e: EtapeAssistant): EtapeAssistant {
  const i = ETAPES_ASSISTANT.indexOf(e);
  return ETAPES_ASSISTANT[Math.min(i + 1, ETAPES_ASSISTANT.length - 1)]!;
}

export function etapePrecedente(e: EtapeAssistant): EtapeAssistant {
  const i = ETAPES_ASSISTANT.indexOf(e);
  return ETAPES_ASSISTANT[Math.max(i - 1, 0)]!;
}

// ─── Les mots des choix — partagés par l'assistant et l'encart de la Santé ───

export function libelleEtape(e: EtapeAssistant, t: Traduire): string {
  const L: Record<EtapeAssistant, [string, string]> = {
    accueil: ['Bienvenue', 'Welcome'],
    mode: ['Mode', 'Mode'],
    agents: ['Agents', 'Agents'],
    stockage: ['Stockage', 'Storage'],
    git: ['Git', 'Git'],
    secrets: ['Secrets', 'Secrets'],
    connecteurs: ['Connecteurs', 'Connectors'],
    projet: ['Premier projet', 'First project'],
    sante: ['Santé', 'Health'],
    recap: ['Récapitulatif', 'Summary'],
  };
  return t(L[e][0], L[e][1]);
}

export function libelleMode(m: ModeRuche, t: Traduire): { titre: string; texte: string } {
  switch (m) {
    case 'local':
      return {
        titre: t('Local — tout sur cette machine', 'Local — everything on this machine'),
        texte: t(
          'La Reine n’écoute que cette machine (127.0.0.1), aucune ouvrière distante. Le plus fermé : rien ne sort du poste.',
          'The Queen only listens on this machine (127.0.0.1), no remote worker. The most closed: nothing leaves the computer.',
        ),
      };
    case 'hybride':
      return {
        titre: t(
          'Hybride — des postes rejoignent la Reine',
          'Hybrid — other computers join the Queen',
        ),
        texte: t(
          'La Reine reste chez vous ; d’autres machines (réseau local ou ailleurs) la rejoignent avec un billet (« hive invite »).',
          'The Queen stays at home; other machines (LAN or elsewhere) join it with a ticket (“hive invite”).',
        ),
      };
    case 'cloud':
      return {
        titre: t('Cloud — Reine exposée, avec des comptes', 'Cloud — exposed Queen, with accounts'),
        texte: t(
          'La Reine est servie derrière Caddy (HTTPS), chacun se connecte avec son compte. Voir docs/CLOUD.md.',
          'The Queen is served behind Caddy (HTTPS), everyone signs in with an account. See docs/CLOUD.md.',
        ),
      };
  }
}

export function libelleSecrets(p: PolitiqueSecrets, t: Traduire): { titre: string; texte: string } {
  switch (p) {
    case 'sessions_cli':
      return {
        titre: t('Connexion de chaque CLI', 'Each CLI’s own sign-in'),
        texte: t(
          'Chaque agent utilise sa propre connexion (« claude /login », « codex login ») : Hive ne range aucune clé.',
          'Each agent uses its own sign-in (“claude /login”, “codex login”): Hive stores no key.',
        ),
      };
    case 'cles_reine':
      return {
        titre: t('Clés gardées par la Reine', 'Keys held by the Queen'),
        texte: t(
          'Les clés d’API sont posées chez la Reine et remises à une ouvrière sur réquisition, depuis la Chambre.',
          'API keys are set at the Queen and handed to a worker on request, from the Chambre.',
        ),
      };
    case 'cles_noeud':
      return {
        titre: t('Clés sur chaque machine', 'Keys on each machine'),
        texte: t(
          'Chaque machine garde ses clés dans son propre .env ; la Reine n’en voit aucune.',
          'Each machine keeps its keys in its own .env; the Queen sees none.',
        ),
      };
  }
}

export function libelleGit(g: PreferenceGit, t: Traduire): { titre: string; texte: string } {
  return g === 'local'
    ? {
        titre: t('Dépôt local', 'Local repository'),
        texte: t(
          'Le travail relu est livré sur une branche du dépôt de la machine, jamais poussé.',
          'Reviewed work is delivered to a branch of the machine’s repository, never pushed.',
        ),
      }
    : {
        titre: t('Dépôt distant (GitHub)', 'Remote repository (GitHub)'),
        texte: t(
          'Le travail relu part en pull request, avec le jeton GitHub de l’hôte (connecteur GitHub, dans Projets).',
          'Reviewed work goes out as a pull request, with the host’s GitHub token (GitHub connector, in Projects).',
        ),
      };
}

export function libelleConnecteur(
  c: ConnecteurInitial,
  t: Traduire,
): { titre: string; texte: string } {
  return c === 'github'
    ? {
        titre: 'GitHub',
        texte: t(
          'Importer un dépôt, ouvrir et suivre les pull requests.',
          'Import a repository, open and follow pull requests.',
        ),
      }
    : {
        titre: 'OpenAlex',
        texte: t(
          'La veille de littérature scientifique ouverte (Intendance).',
          'Open scientific literature watch (Stewardship).',
        ),
      };
}
