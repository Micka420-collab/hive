// Le réseau filtré au DÉMARRAGE du nœud : mesuré une fois avec le bac retenu,
// annoncé seulement s'il a été éprouvé, EXIGÉ par `HIVE_ISOLEMENT=exige`, et
// passé au client par les DEUX chemins de démarrage.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { optionReseau, preparerBac, type OutilsBac } from '../src/node-client/bac.js';
import { CODE } from '../src/codes-sortie.js';
import type { Fournisseur } from '../src/node-client/isolement.js';

const BWRAP: Fournisseur = {
  nom: 'bubblewrap',
  bin: 'bwrap',
  niveau: 'conteneur',
  installation: 'apt install bubblewrap',
  garanties: ['seul le répertoire de la tâche est accessible en écriture'],
};

/** Une machine où bubblewrap isole ; le réseau filtre ou non selon `filtre`. */
function machine(filtre: boolean, sondes: string[] = []): OutilsBac {
  return {
    moteurs: async () => [BWRAP],
    sonderAgent: async (_f, bin) => ({ executable: true, motif: `« ${bin} » exécutable` }),
    plateforme: 'linux',
    sonderReseau: async (f) => {
      sondes.push(f.nom);
      return filtre
        ? { filtre: true, motif: `réseau filtré par le proxy du nœud via ${f.nom}` }
        : { filtre: false, motif: 'réseau NON filtrable via bubblewrap : socket bloqué' };
    },
  };
}

const CLE = { ANTHROPIC_API_KEY: 'sk-x' };

describe('le réseau filtré, mesuré au démarrage', () => {
  it('« auto » + bac qui filtre : annoncé, et passé au client', async () => {
    const sondes: string[] = [];
    const bac = await preparerBac(CLE, 'claude-code', machine(true, sondes));
    expect(sondes).toEqual(['bubblewrap']);
    expect(bac.reseau).toEqual({
      filtre: true,
      exige: false,
      motif: 'réseau filtré par le proxy du nœud via bubblewrap',
    });
    const texte = bac.lignes.join('\n');
    expect(texte).toContain('Réseau : réseau filtré par le proxy du nœud');
    expect(texte).toMatch(/✔ réseau sortant filtré hors du bac/);
    expect(optionReseau(bac)).toEqual({ reseau: bac.reseau });
  });

  it('« auto » + bac qui NE filtre PAS : le nœud travaille, et l’annonce le dit', async () => {
    const bac = await preparerBac(CLE, 'claude-code', machine(false));
    expect(bac.refuse).toBe(false);
    expect(bac.reseau?.filtre).toBe(false);
    const texte = bac.lignes.join('\n');
    expect(texte).toContain('socket bloqué');
    expect(texte).toMatch(/ne sait pas le filtrer/);
  });

  it('« exige » + bac qui NE filtre PAS : le nœud REFUSE de démarrer, avec la cause', async () => {
    const bac = await preparerBac(
      { ...CLE, HIVE_ISOLEMENT: 'exige' },
      'claude-code',
      machine(false),
    );
    expect(bac.refuse).toBe(true);
    expect(bac.codeSortie).toBe(CODE.REFUS_SECURITE);
    expect(bac.decision.motif).toMatch(/HIVE_ISOLEMENT=exige : .*socket bloqué/);
    expect(optionReseau(bac)).toEqual({});
  });

  it('« exige » + bac qui filtre : le nœud démarre, et exige le filtre à chaque tâche', async () => {
    const bac = await preparerBac(
      { ...CLE, HIVE_ISOLEMENT: 'exige' },
      'claude-code',
      machine(true),
    );
    expect(bac.refuse).toBe(false);
    expect(bac.reseau).toMatchObject({ filtre: true, exige: true });
  });

  it('« off » ne sonde rien : pas de bac, pas de réseau filtré', async () => {
    const sondes: string[] = [];
    const bac = await preparerBac(
      { ...CLE, HIVE_ISOLEMENT: 'off' },
      'claude-code',
      machine(true, sondes),
    );
    expect(sondes).toEqual([]);
    expect(bac.reseau).toBeNull();
  });
});

describe('les DEUX chemins de démarrage passent la capacité réseau au client', () => {
  it.each(['main.ts', 'join.ts'])('%s appelle optionReseau(bac)', (fichier) => {
    const src = readFileSync(
      fileURLToPath(new URL(`../src/node-client/${fichier}`, import.meta.url)),
      'utf8',
    );
    expect(src).toContain('...optionReseau(bac)');
  });
});
