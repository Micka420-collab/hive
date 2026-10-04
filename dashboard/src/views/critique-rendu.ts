// CE QUE L'ÉCRAN DIT D'UNE CRITIQUE STRUCTURÉE — sévérités, critères, comptes.
//
// Un relecteur qui termine par `HIVE_CRITIQUE` rend des constats typés
// (`src/shared/critique-structuree.ts`) : une sévérité, un critère, une
// preuve. La Reine les range tels quels, jamais en phrases ; la Miellerie et
// la War Room les disent ici, dans la langue de l'écran, avec les MÊMES mots —
// deux écrans qui nommeraient différemment « majeur » feraient douter de ce
// qu'on lit.
//
// Des comptes par critère, pas une note : une note unique cacherait QUEL
// critère a péché, c'est-à-dire la seule chose que le relecteur humain vient
// chercher. Pur, sans DOM : un banc l'éprouve sans monter de vue.

import { SEVERITES } from '../../../src/shared/critique-structuree';
import type {
  CompteCritere,
  Constat,
  Critere,
  Severite,
} from '../../../src/shared/critique-structuree';
import type { Traduire } from './projets-rendu';

/** Le nom d'une sévérité à l'écran. */
export function libelleSeverite(s: Severite, t: Traduire): string {
  switch (s) {
    case 'bloquant':
      return t('bloquant', 'blocker');
    case 'majeur':
      return t('majeur', 'major');
    case 'mineur':
      return t('mineur', 'minor');
    case 'info':
      return t('info', 'info');
  }
}

/** Le nom d'un critère à l'écran. */
export function libelleCritere(c: Critere, t: Traduire): string {
  switch (c) {
    case 'correction':
      return t('correction', 'correctness');
    case 'securite':
      return t('sécurité', 'security');
    case 'tests':
      return t('tests', 'tests');
    case 'performance':
      return t('performance', 'performance');
    case 'lisibilite':
      return t('lisibilité', 'readability');
    case 'conformite':
      return t('conformité', 'compliance');
  }
}

/**
 * Un critère et ce qu'il a reçu : « sécurité 1 majeur, 2 mineur ». Les
 * sévérités à zéro se taisent — la grille est connue, un « 0 bloquant » par
 * critère noierait les vrais comptes.
 */
export function direCompteCritere(compte: CompteCritere, t: Traduire): string {
  const detail = SEVERITES.filter((s) => compte.parSeverite[s] > 0)
    .map((s) => `${compte.parSeverite[s]} ${libelleSeverite(s, t)}`)
    .join(', ');
  return `${libelleCritere(compte.critere, t)} ${detail}`;
}

/** Tous les critères touchés, sur une ligne ; vide quand il n'y a rien. */
export function direComptesCriteres(comptes: readonly CompteCritere[], t: Traduire): string {
  return comptes.map((c) => direCompteCritere(c, t)).join(' · ');
}

/** L'en-tête d'un constat : sa sévérité, son critère, et le fichier visé. */
export function enteteConstat(c: Constat, t: Traduire): string {
  return [
    libelleSeverite(c.severite, t),
    libelleCritere(c.critere, t),
    ...(c.fichier ? [c.fichier] : []),
  ].join(' · ');
}
