// Le réseau d'UNE tâche, côté nœud : filtré, libre — et dit —, ou impossible
// — et alors la tâche ne tourne pas. Aucune des trois issues n'est muette.

import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { NOM_RELAIS, SOURCE_RELAIS } from '../src/node-client/proxy-egress.js';
import {
  bilanRefus,
  ouvrirReseauTache,
  refusExige,
  type CapaciteReseau,
} from '../src/node-client/reseau-tache.js';
import type { ReservationPont } from '../src/node-client/rendez-vous-pont.js';

let racine: string;
beforeEach(() => {
  racine = mkdtempSync(path.join(os.tmpdir(), 'hive-rt-'));
});
afterEach(() => rmSync(racine, { recursive: true, force: true }));

/** Une réservation dans le dossier du banc — celle du nœud vit sous tmpdir. */
function reservation(): ReservationPont {
  let n = 0;
  return {
    reserver: () => {
      const dossier = mkdtempSync(path.join(racine, `r${n++}-`));
      return { dossier, extremite: path.join(dossier, 's') };
    },
  };
}

const FILTRE: CapaciteReseau = { filtre: true, exige: false, motif: 'sondé' };
const ENV = { PATH: '/usr/bin', CLAUDE_CODE_OAUTH_TOKEN: 'sk-ant-oat01-VRAI-JETON' };

function ouvrir(p: Partial<Parameters<typeof ouvrirReseauTache>[0]> = {}) {
  return ouvrirReseauTache({
    niveau: 'dependances',
    capacite: FILTRE,
    agent: 'claude-code',
    repoUrl: 'https://github.com/org/depot.git',
    cwd: racine,
    env: ENV,
    envHote: {},
    reservation: reservation(),
    surRefus: () => {},
    ...p,
  });
}

describe('la tâche au réseau FILTRÉ', () => {
  it('reçoit ses leurres, sa passerelle, son relais — et la vraie clé reste au nœud', async () => {
    const r = await ouvrir();
    expect(r.etat).toBe('filtre');
    if (r.etat !== 'filtre') return;
    try {
      expect(Object.values(r.env).join('\n')).not.toContain('VRAI-JETON');
      expect(r.env.CLAUDE_CODE_OAUTH_TOKEN).toMatch(/^sk-ant-oat01-hive-leurre-/);
      expect(r.reseau.variables.ANTHROPIC_BASE_URL).toBe(
        'http://127.0.0.1:3128/hive-api/anthropic',
      );
      expect(r.reseau.variables.HTTPS_PROXY).toBe('http://127.0.0.1:3128');
      expect(r.reseau.variables.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC).toBe('1');
      // Les variables du bac passent en arguments : aucune ne porte un secret.
      expect(JSON.stringify(r.reseau.variables)).not.toContain('VRAI-JETON');
      expect(readFileSync(path.join(r.reseau.dossier, NOM_RELAIS), 'utf8')).toBe(SOURCE_RELAIS);
      expect(existsSync(r.reseau.socket)).toBe(true);
      expect(r.note).toContain('réseau filtré (niveau « dependances »)');
      expect(r.note).toContain('api.anthropic.com, github.com');
    } finally {
      await r.fermer();
    }
    expect(existsSync(r.reseau.dossier)).toBe(false);
  });

  it('un agent sans passerelle (Cursor) garde ses clés — le proxy ne peut pas les substituer', async () => {
    const r = await ouvrir({ agent: 'cursor', env: { CURSOR_API_KEY: 'k-vraie' } });
    expect(r.etat).toBe('filtre');
    if (r.etat !== 'filtre') return;
    await r.fermer();
    expect(r.env.CURSOR_API_KEY).toBe('k-vraie');
    expect(r.reseau.variables).not.toHaveProperty('ANTHROPIC_BASE_URL');
  });
});

describe('la tâche au réseau LIBRE — et qui le dit', () => {
  it('« ouvert » : comme avant, sans note', async () => {
    const r = await ouvrir({ niveau: 'ouvert' });
    expect(r).toMatchObject({ etat: 'libre', env: ENV, note: null });
  });

  it('sans bac (sandbox de processus) : non filtré, et la note le dit', async () => {
    const r = await ouvrir({ capacite: undefined });
    expect(r.etat).toBe('libre');
    if (r.etat === 'libre') expect(r.note).toMatch(/réseau NON filtré.*pas de bac à sable/);
  });

  it('un bac qui ne sait pas filtrer : la note cite la sonde', async () => {
    const r = await ouvrir({
      capacite: { filtre: false, exige: false, motif: 'socket bloqué par la VM' },
    });
    if (r.etat === 'libre') expect(r.note).toContain('socket bloqué par la VM');
    else expect.fail(r.etat);
  });
});

describe('la tâche au réseau IMPOSSIBLE ne tourne pas', () => {
  it('un proxy qui ne s’ouvre pas rend `impossible`, jamais un réseau libre', async () => {
    const r = await ouvrir({
      reservation: {
        reserver: () => {
          throw new Error('chemin du socket trop long');
        },
      },
    });
    expect(r).toEqual({
      etat: 'impossible',
      motif: 'réseau filtré impossible : chemin du socket trop long',
    });
  });
});

describe('HIVE_ISOLEMENT=exige', () => {
  it('refuse un projet « ouvert », et lui seul', () => {
    const exige = { ...FILTRE, exige: true };
    expect(refusExige('ouvert', exige)).toMatch(/HIVE_ISOLEMENT=exige/);
    expect(refusExige('dependances', exige)).toBeNull();
    expect(refusExige('ouvert', FILTRE)).toBeNull();
    expect(refusExige('ouvert')).toBeNull();
  });
});

describe('le bilan des refus', () => {
  it('rien à dire sans refus ; sinon chaque destination, ses répétitions et son motif', () => {
    expect(bilanRefus([])).toBeNull();
    const b = bilanRefus([{ hote: 'exfil.example.org', port: 443, motif: 'hors liste', fois: 3 }]);
    expect(b).toContain('1 destination(s) refusée(s)');
    expect(b).toContain('exfil.example.org:443 (×3) — hors liste');
  });
});
