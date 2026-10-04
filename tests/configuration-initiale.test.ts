// LA CONFIGURATION INITIALE — rangée chez la Reine, reprise où on l'a laissée,
// écrite par qui répond de la ruche, confrontée à ce qui tourne.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as creerServeurTcp } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  agentsDetectes,
  choixManquants,
  coherenceDuMode,
  fusionnerChoix,
  porteConfiguration,
  relireChoix,
} from '../src/shared/configuration-initiale.js';
import type { FaitsDeploiement } from '../src/shared/configuration-initiale.js';
import { diagnostiquer, pire } from '../src/shared/doctor.js';
import type { Releve } from '../src/shared/doctor.js';
import type { InventaireAgents } from '../src/node-client/agent-detect.js';
import { relever } from '../src/doctor-releve.js';
import { HiveStore } from '../src/orchestrator/store.js';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';

describe('porteConfiguration — un verdict, jamais un booléen', () => {
  it('le jeton règle une ruche SANS compte, et plus rien dès qu’un compte existe', () => {
    expect(porteConfiguration({ compte: null, jetonValide: true, comptes: 0 })).toBe('permis');
    expect(porteConfiguration({ compte: null, jetonValide: true, comptes: 1 })).toBe('reserve');
    expect(porteConfiguration({ compte: null, jetonValide: false, comptes: 0 })).toBe('anonyme');
  });

  it('un administrateur règle ; un membre, même avec le jeton, non', () => {
    expect(porteConfiguration({ compte: { admin: true }, jetonValide: false, comptes: 3 })).toBe(
      'permis',
    );
    expect(porteConfiguration({ compte: { admin: false }, jetonValide: true, comptes: 3 })).toBe(
      'reserve',
    );
  });
});

describe('les choix', () => {
  it('une valeur inconnue redevient « pas encore choisi », jamais un voisin deviné', () => {
    expect(
      relireChoix({
        mode: 'nuage',
        secrets: 'cles_reine',
        git: 42,
        connecteurs: '["openalex","slack","github","github"]',
        etape: 'etape-du-futur',
      }),
    ).toEqual({
      mode: null,
      secrets: 'cles_reine',
      git: null,
      connecteurs: ['github', 'openalex'],
      etape: 'accueil',
    });
    expect(
      relireChoix({ mode: null, secrets: null, git: null, connecteurs: '{', etape: 'git' }),
    ).toMatchObject({ connecteurs: [], etape: 'git' });
  });

  it('une modification ne touche que ce qu’elle nomme ; `null` efface un choix', () => {
    const a = fusionnerChoix(null, { mode: 'hybride', etape: 'agents' });
    expect(a).toEqual({
      mode: 'hybride',
      secrets: null,
      git: null,
      connecteurs: [],
      etape: 'agents',
    });
    const b = fusionnerChoix(a, { git: 'local' });
    expect(b).toMatchObject({ mode: 'hybride', git: 'local', etape: 'agents' });
    expect(fusionnerChoix(b, { mode: null }).mode).toBeNull();
    expect(choixManquants(b)).toEqual(['secrets']);
  });
});

describe('coherenceDuMode — le choix confronté à la Reine qui tourne', () => {
  const faits: FaitsDeploiement = {
    hote: '127.0.0.1',
    urlPublique: null,
    confianceProxy: false,
    comptes: 0,
    admins: 0,
    inscription: 'ouverte',
  };

  it('aucun mode choisi : aucun verdict, surtout pas « tout va bien »', () => {
    expect(coherenceDuMode(null, faits)).toEqual([]);
  });

  it('local sur la boucle : ok ; local ouvert au réseau : dit, avec la ligne à poser', () => {
    expect(coherenceDuMode('local', faits).map((d) => d.gravite)).toEqual(['ok']);
    const ouvert = coherenceDuMode('local', { ...faits, hote: '0.0.0.0' });
    expect(ouvert[0]).toMatchObject({ gravite: 'risque', cle: 'mode_ecoute' });
    expect(ouvert[0]!.reparation).toContain('HIVE_HOST=127.0.0.1');
  });

  it('hybride sur la boucle : aucun poste ne rejoindra ; adresse non posée : inconnu', () => {
    const d = coherenceDuMode('hybride', faits);
    expect(d.map((x) => [x.cle, x.gravite])).toEqual([
      ['mode_ecoute', 'risque'],
      ['mode_adresse', 'inconnu'],
    ]);
  });

  it('cloud : adresse chiffrée, proxy cru, comptes, inscription tenue', () => {
    expect(coherenceDuMode('cloud', faits).filter((x) => x.gravite === 'risque')).toHaveLength(4);
    const tenu = coherenceDuMode('cloud', {
      hote: '0.0.0.0',
      urlPublique: 'wss://hive.example.com/ws',
      confianceProxy: 'uniquelocal',
      comptes: 2,
      admins: 1,
      inscription: 'sur_invitation',
    });
    expect(tenu.every((x) => x.gravite === 'ok')).toBe(true);
  });
});

describe('agentsDetectes', () => {
  it('rend la session réelle, écarte le simulé, et le remède du non-connecté', () => {
    expect(
      agentsDetectes({
        presents: [
          { agent: 'claude-code', session: 'connectee' },
          { agent: 'codex', session: 'non_connectee' },
          { agent: 'cursor', session: 'inconnue' },
          { agent: 'shell', session: 'inconnue' },
        ],
        nonConnectes: [{ agent: 'codex', detail: 'codex login' }],
      }),
    ).toEqual([
      { agent: 'claude-code', session: 'connectee', travaille: true, remede: null },
      { agent: 'codex', session: 'non_connectee', travaille: false, remede: 'codex login' },
      { agent: 'cursor', session: 'inconnue', travaille: true, remede: null },
    ]);
  });
});

// ─── L'API ───────────────────────────────────────────────────────────────────

const TOKEN = 'configuration-initiale-jeton-long';
const jeton = { 'x-hive-token': TOKEN, 'content-type': 'application/json' };

/** Un relevé du docteur tout vert, sauf ce qu'on y change. */
function releveVert(): Releve {
  return {
    // Au-dessus du plancher, comme le relevé sain de `doctor.test.ts`.
    versionNode: '26.10.0',
    glibc: '2.36',
    fichierEnv: { present: true, lisible: true, permissions: 0o600 },
    jeton: { present: true, longueur: TOKEN.length, trivial: false },
    secretSession: { utilisable: true, longueur: 64, publie: false, simulation: false },
    port: { numero: 7777, libre: false, parNous: true },
    moteur: { manquants: [], raison: null },
    base: { presente: true, integre: true, inscriptible: true },
    dashboardConstruit: true,
    agent: 'claude-code',
    agentsNonConnectes: [],
    isolement: 'bubblewrap',
    imageBac: null,
    wsJoignable: true,
    reglages: { runner: 'off', bindPublic: false, gardiennes: 'consultatif', corsOuvert: false },
    espace: { octetsLibres: 10 * 1024 ** 3, inscriptible: true },
    decouverte: { ruche: false, machine: false, ecouteLocale: true },
  };
}

const INVENTAIRE: InventaireAgents = {
  tous: ['claude-code', 'shell'],
  nonConnectes: [{ agent: 'codex', detail: 'codex login' }],
  presents: [
    { agent: 'claude-code', session: 'connectee' },
    { agent: 'codex', session: 'non_connectee' },
  ],
};

describe('/api/configuration-initiale', () => {
  let server: HiveServer | null = null;
  let dir: string | null = null;
  const releverSante = vi.fn(() => Promise.resolve({ releve: releveVert(), agents: INVENTAIRE }));

  afterEach(async () => {
    await server?.stop();
    server = null;
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
    dir = null;
    releverSante.mockClear();
  });

  async function demarrer(): Promise<string> {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-config-initiale-'));
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'hive.db'),
      simulation: false,
      tickMs: 60_000,
      releverSante,
    });
    return `http://127.0.0.1:${server.port}`;
  }

  const inscrire = async (url: string, email: string, entetes: Record<string, string> = {}) => {
    const res = await fetch(`${url}/api/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...entetes },
      body: JSON.stringify({ email, password: 'motdepasse-assez-long-42', displayName: email }),
    });
    return ((await res.json()) as { token: string }).token;
  };

  it('une ruche neuve : rien de choisi, et le jeton peut écrire (l’amorce)', async () => {
    const url = await demarrer();
    expect((await fetch(`${url}/api/configuration-initiale`)).status).toBe(401);
    const r = await fetch(`${url}/api/configuration-initiale`, { headers: jeton });
    expect(await r.json()).toEqual({ configuration: null, ecriture: 'permis', coherence: [] });
  });

  it('LE BROUILLON SE REPREND : chaque étape rangée, l’étape courante aussi', async () => {
    const url = await demarrer();
    const put = await fetch(`${url}/api/configuration-initiale`, {
      method: 'PUT',
      headers: jeton,
      body: JSON.stringify({ mode: 'local', etape: 'git' }),
    });
    expect(put.status).toBe(200);
    // « Fermer l'onglet » : une lecture neuve retrouve l'étape et le choix.
    const repris = (await (
      await fetch(`${url}/api/configuration-initiale`, { headers: jeton })
    ).json()) as { configuration: { mode: string; etape: string; termineeA: number | null } };
    expect(repris.configuration).toMatchObject({ mode: 'local', etape: 'git', termineeA: null });

    // Une valeur hors catalogue est refusée par le schéma, rien n'est rangé.
    const faux = await fetch(`${url}/api/configuration-initiale`, {
      method: 'PUT',
      headers: jeton,
      body: JSON.stringify({ mode: 'partout' }),
    });
    expect(faux.status).toBe(400);
  });

  it('TERMINER exige mode, secrets et Git — 409 nomme ce qui manque — puis journalise', async () => {
    const url = await demarrer();
    const incomplet = await fetch(`${url}/api/configuration-initiale/terminer`, {
      method: 'POST',
      headers: jeton,
      body: JSON.stringify({ mode: 'local' }),
    });
    expect(incomplet.status).toBe(409);
    expect(((await incomplet.json()) as { manquants: string[] }).manquants).toEqual([
      'secrets',
      'git',
    ]);
    const fini = await fetch(`${url}/api/configuration-initiale/terminer`, {
      method: 'POST',
      headers: jeton,
      // Un TERMINER refusé n'a rien rangé : le corps redit tout.
      body: JSON.stringify({
        mode: 'local',
        secrets: 'sessions_cli',
        git: 'local',
        connecteurs: ['github'],
      }),
    });
    expect(fini.status).toBe(200);
    const etat = (await fini.json()) as {
      configuration: { termineeA: number | null; etape: string; majPar: { genre: string } };
      coherence: Array<{ cle: string; gravite: string }>;
    };
    expect(etat.configuration.termineeA).toEqual(expect.any(Number));
    expect(etat.configuration.etape).toBe('recap');
    expect(etat.configuration.majPar).toEqual({ genre: 'jeton_de_ruche' });
    expect(etat.coherence).toEqual([
      expect.objectContaining({ cle: 'mode_ecoute', gravite: 'ok' }),
    ]);
    const ev = server!.store.evenementsParTypes(['configuration_initiale_terminee'], 10);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ mode: 'local', connecteurs: ['github'] });

    // Relancer l'assistant ne rouvre pas la première arrivée, et son brouillon
    // ne touche pas une configuration arrêtée : seule l'étape se range — un
    // « Plus tard » après avoir changé de choix ne change rien, et un `null`
    // ne laisse pas une configuration « terminée » sans mode.
    const termineeA = etat.configuration.termineeA;
    for (const corps of [
      { git: 'distant', etape: 'git' },
      { mode: null, etape: 'mode' },
    ]) {
      const brouillon = await fetch(`${url}/api/configuration-initiale`, {
        method: 'PUT',
        headers: jeton,
        body: JSON.stringify(corps),
      });
      expect(brouillon.status).toBe(200);
      expect(server!.store.lireConfigurationInitiale()).toMatchObject({
        mode: 'local',
        git: 'local',
        etape: corps.etape,
        termineeA,
      });
    }
    // Changer une configuration arrêtée, c'est la terminer à nouveau : le
    // geste revérifie les choix et se journalise.
    const change = await fetch(`${url}/api/configuration-initiale/terminer`, {
      method: 'POST',
      headers: jeton,
      body: JSON.stringify({ git: 'distant' }),
    });
    expect(change.status).toBe(200);
    expect(server!.store.lireConfigurationInitiale()).toMatchObject({ git: 'distant' });
    expect(server!.store.evenementsParTypes(['configuration_initiale_terminee'], 10)).toHaveLength(
      2,
    );
  });

  it('dès qu’un compte existe, le jeton ne règle plus rien ; l’admin, si', async () => {
    const url = await demarrer();
    const admin = await inscrire(url, 'hote@ruche.test', { 'x-hive-token': TOKEN });
    const membre = await inscrire(url, 'ami@ruche.test');
    const corps = JSON.stringify({ mode: 'cloud' });
    const parJeton = await fetch(`${url}/api/configuration-initiale`, {
      method: 'PUT',
      headers: jeton,
      body: corps,
    });
    expect(parJeton.status).toBe(403);
    expect(((await parJeton.json()) as { error: string }).error).toMatch(/administrateur/);
    const lecture = (await (
      await fetch(`${url}/api/configuration-initiale`, { headers: jeton })
    ).json()) as { ecriture: string };
    expect(lecture.ecriture).toBe('reserve');
    const parMembre = await fetch(`${url}/api/configuration-initiale`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${membre}` },
      body: corps,
    });
    expect(parMembre.status).toBe(403);
    const parAdmin = await fetch(`${url}/api/configuration-initiale`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${admin}` },
      body: corps,
    });
    expect(parAdmin.status).toBe(200);
    expect(server!.store.lireConfigurationInitiale()?.majPar).toMatchObject({ genre: 'compte' });
    // Le bilan de santé suit la même porte.
    const sante = await fetch(`${url}/api/configuration-initiale/sante`, { headers: jeton });
    expect(sante.status).toBe(403);
    expect(releverSante).not.toHaveBeenCalled();
  });

  it('LE BILAN : docteur, agents avec leur session réelle, stockage — relevé une fois', async () => {
    const url = await demarrer();
    const r = await fetch(`${url}/api/configuration-initiale/sante`, { headers: jeton });
    expect(r.status).toBe(200);
    const sante = (await r.json()) as {
      verdict: string;
      diagnostics: Array<{ cle: string }>;
      agents: Array<{ agent: string; travaille: boolean; remede: string | null }>;
      isolement: string | null;
      stockage: { chemin: string; integre: boolean | null };
      noeuds: { inscrits: number };
      coherence: unknown[];
    };
    expect(sante.verdict).toBe(pire(diagnostiquer(releveVert())));
    expect(sante.diagnostics.map((d) => d.cle)).toContain('isolement');
    expect(sante.agents).toEqual([
      { agent: 'claude-code', session: 'connectee', travaille: true, remede: null },
      { agent: 'codex', session: 'non_connectee', travaille: false, remede: 'codex login' },
    ]);
    expect(sante.isolement).toBe('bubblewrap');
    expect(sante.stockage.chemin).toBe(path.resolve(dir!, 'hive.db'));
    expect(sante.noeuds.inscrits).toBe(0);
    // Deux lectures rapprochées : UNE passe de sondes.
    await fetch(`${url}/api/configuration-initiale/sante`, { headers: jeton });
    expect(releverSante).toHaveBeenCalledTimes(1);
    // « Relancer le bilan » refait la passe.
    await fetch(`${url}/api/configuration-initiale/sante?relancer=true`, { headers: jeton });
    expect(releverSante).toHaveBeenCalledTimes(2);
  });

  it('LA TABLE EST ADDITIVE ET IDEMPOTENTE : une base rouverte garde la configuration', () => {
    dir = mkdtempSync(path.join(os.tmpdir(), 'hive-config-idem-'));
    const chemin = path.join(dir, 'hive.db');
    const a = new HiveStore(chemin);
    a.rangerConfigurationInitiale(
      { mode: 'hybride', secrets: 'cles_noeud', git: 'distant', connecteurs: [], etape: 'recap' },
      { genre: 'jeton_de_ruche' },
      { terminer: true, now: 5 },
    );
    a.close();
    const b = new HiveStore(chemin);
    expect(b.lireConfigurationInitiale()).toMatchObject({ mode: 'hybride', termineeA: 5 });
    b.close();
  });
});

describe('le bilan de la Reine relevé EN PROCESSUS', () => {
  it('ne sonde pas son propre port, et mesure la base qu’elle sert', async () => {
    // Un port tenu par un programme muet : sondé, le docteur conclurait
    // « indéterminable » après son délai. La Reine, elle, SAIT qu'elle écoute.
    const muet = creerServeurTcp(() => undefined);
    await new Promise<void>((ok) => muet.listen(0, '127.0.0.1', ok));
    const port = (muet.address() as { port: number }).port;
    const racine = mkdtempSync(path.join(os.tmpdir(), 'hive-releve-soi-'));
    // La base vit AILLEURS que `<racine>/data/hive.db` : c'est celle-ci qu'on
    // doit mesurer, pas le défaut relatif à la racine.
    const ailleurs = mkdtempSync(path.join(os.tmpdir(), 'hive-releve-base-'));
    const base = path.join(ailleurs, 'hive.db');
    new HiveStore(base).close();
    try {
      const r = await relever(
        racine,
        { HIVE_PORT: String(port), HIVE_HOST: '127.0.0.1', HIVE_DB: base },
        'linux',
        async (): Promise<InventaireAgents> => ({
          tous: ['shell'],
          nonConnectes: [],
          presents: [],
        }),
        true,
      );
      expect(r.port).toEqual({ numero: port, libre: false, parNous: true });
      expect(r.wsJoignable).toBe(true);
      expect(r.base).toMatchObject({ presente: true, integre: true, inscriptible: true });
    } finally {
      await new Promise((ok) => muet.close(ok));
      rmSync(racine, { recursive: true, force: true, maxRetries: 3 });
      rmSync(ailleurs, { recursive: true, force: true, maxRetries: 3 });
    }
  });
});
