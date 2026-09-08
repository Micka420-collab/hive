// Adaptateurs d'outils de sécurité pour Cyber Hive.
// Chaque adaptateur encapsule l'exécution d'un outil de sécurité.

import type { OutilSecurite, ResultatOutil } from '../../cyber-hive/types.js';

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Interface commune
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export interface AdaptateurSecurite {
  nom: string;
  executer(cible: string, args: string[]): Promise<ResultatOutil>;
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Helper d'exécution
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

async function executerCommande(
  outilId: string,
  commande: string,
  cible: string,
  args: string[],
): Promise<ResultatOutil> {
  const debut = Date.now();
  // En production : exécution via Docker exec dans le conteneur Kali.
  // Pour l'instant, on simule.
  return {
    outilId,
    succes: true,
    codeSortie: 0,
    stdout: `[SIMULATION] ${commande} ${args.join(' ')} ${cible}`,
    stderr: '',
    dureeMs: Date.now() - debut,
    ts: Date.now(),
  };
}

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Adaptateurs individuels
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

export const nmap: AdaptateurSecurite = {
  nom: 'nmap',
  async executer(cible, args) {
    return executerCommande('nmap', 'nmap', cible, args);
  },
};

export const sqlmap: AdaptateurSecurite = {
  nom: 'sqlmap',
  async executer(cible, args) {
    return executerCommande('sqlmap', 'sqlmap', cible, args);
  },
};

export const nuclei: AdaptateurSecurite = {
  nom: 'nuclei',
  async executer(cible, args) {
    return executerCommande('nuclei', 'nuclei', cible, args);
  },
};

export const hydra: AdaptateurSecurite = {
  nom: 'hydra',
  async executer(cible, args) {
    return executerCommande('hydra', 'hydra', cible, args);
  },
};

export const hashcat: AdaptateurSecurite = {
  nom: 'hashcat',
  async executer(cible, args) {
    return executerCommande('hashcat', 'hashcat', cible, args);
  },
};

export const metasploit: AdaptateurSecurite = {
  nom: 'metasploit',
  async executer(cible, args) {
    return executerCommande('metasploit', 'msfconsole', cible, args);
  },
};

export const ffuf: AdaptateurSecurite = {
  nom: 'ffuf',
  async executer(cible, args) {
    return executerCommande('ffuf', 'ffuf', cible, args);
  },
};

export const masscan: AdaptateurSecurite = {
  nom: 'masscan',
  async executer(cible, args) {
    return executerCommande('masscan', 'masscan', cible, args);
  },
};

export const nikto: AdaptateurSecurite = {
  nom: 'nikto',
  async executer(cible, args) {
    return executerCommande('nikto', 'nikto', cible, args);
  },
};

// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌
//  Registre des adaptateurs
// ╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌╌

const adaptateurs = new Map<string, AdaptateurSecurite>([
  ['nmap', nmap],
  ['sqlmap', sqlmap],
  ['nuclei', nuclei],
  ['hydra', hydra],
  ['hashcat', hashcat],
  ['metasploit', metasploit],
  ['ffuf', ffuf],
  ['masscan', masscan],
  ['nikto', nikto],
]);

/** Retourne l'adaptateur pour un outil donné. */
export function obtenirAdaptateur(id: string): AdaptateurSecurite | undefined {
  return adaptateurs.get(id);
}

/** Exécute un outil via son adaptateur. */
export async function execOutil(
  outil: OutilSecurite,
  cible: string,
  args: string[],
): Promise<ResultatOutil> {
  const adaptateur = adaptateurs.get(outil.id);
  if (!adaptateur) {
    throw new Error(`Aucun adaptateur pour l'outil : ${outil.id}`);
  }
  return adaptateur.executer(cible, args);
}