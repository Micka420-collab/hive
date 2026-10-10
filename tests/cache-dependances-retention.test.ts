// LA RÉTENTION DU MAGASIN DE DÉPENDANCES (G18 D).
//
// Sans elle, le magasin grandit d'une entrée par lockfile, pour toujours, et
// survit à un nœud qui a tourné sans bac — là où l'agent atteint le disque
// entier. Ces bancs construisent des magasins au FORMAT du magasin (une
// entrée = sa clé pour nom, son manifeste, son marqueur d'usage daté), puis
// ramassent, et regardent ce qui reste :
//
//   · une entrée qui n'a servi depuis plus de `INUTILISEE_MAX_MS` part ;
//   · au-delà de `ENTREES_PAR_PROJET` dans un projet, puis de
//     `MAGASIN_OCTETS_MAX` en tout, les moins récemment servies partent
//     d'abord, jusqu'à la borne ;
//   · un changement de niveau d'isolement vide le magasin entier — et un
//     magasin sans marque (peuplé avant la rétention) aussi ;
//   · au démarrage, les restes d'un peuplement ou d'un effacement interrompus
//     partent ; ils ne comptent jamais pour une entrée, et un ramassage en
//     cours de route laisse un peuplement en vol tranquille ;
//   · par le vrai client du nœud : un démarrage sans bac vide le magasin
//     qu'un bac avait peuplé.
//
// Chacun rouge sur le magasin d'avant la rétention (G18 C), qui ne ramassait rien.

import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentAdapter } from '../src/adapters/index.js';
import {
  ENTREES_PAR_PROJET,
  INUTILISEE_MAX_MS,
  MAGASIN_OCTETS_MAX,
  direRamassage,
  dossierDuMagasin,
  ramasserMagasin,
} from '../src/node-client/cache-dependances.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { VERSION_MAGASIN } from '../src/shared/cache-dependances.js';

const HEURE = 60 * 60_000;
const GIO = 1024 ** 3;
const dossiers: string[] = [];

afterEach(() => {
  for (const d of dossiers.splice(0)) rmSync(d, { recursive: true, force: true, maxRetries: 3 });
});

/** Un atelier neuf ; son magasin est `dossierDuMagasin(travail)`, marqué « conteneur ». */
function atelier(marque: string | null = 'conteneur'): { travail: string; racine: string } {
  const travail = mkdtempSync(path.join(os.tmpdir(), 'hive-retention-'));
  dossiers.push(travail);
  const racine = dossierDuMagasin(travail);
  mkdirSync(racine);
  if (marque !== null) writeFileSync(path.join(racine, '.niveau-isolement'), marque);
  return { travail, racine };
}

let numero = 0;

/**
 * Une entrée publiée, au format du magasin : sa clé pour nom, son manifeste
 * (son poids), son `node_modules`, et son marqueur d'usage — servie il y a
 * `servieIlYa` ms.
 */
function entree(
  racine: string,
  projet: string,
  p: { servieIlYa?: number; octets?: number; nom?: string } = {},
): string {
  numero += 1;
  const cle = numero.toString(16).padStart(32, '0');
  const dir = path.join(racine, projet, p.nom ?? cle);
  mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
  writeFileSync(path.join(dir, 'node_modules', 'dep', 'index.js'), 'module.exports = 1;\n');
  writeFileSync(
    path.join(dir, 'manifeste.json'),
    JSON.stringify({
      version: VERSION_MAGASIN,
      cle,
      fichiers: 1,
      octets: p.octets ?? 1024,
      liens: 0,
    }),
  );
  writeFileSync(path.join(dir, 'servie'), '');
  const quand = (Date.now() - (p.servieIlYa ?? 0)) / 1000;
  utimesSync(path.join(dir, 'servie'), quand, quand);
  return dir;
}

const noms = (dossier: string): string[] =>
  existsSync(dossier) ? readdirSync(dossier).sort() : [];

/** Les entrées d'un projet : leur clé pour nom — pas une entrée écartée qu'on efface. */
const entreesDe = (dossier: string): string[] =>
  noms(dossier).filter((n) => /^[0-9a-f]{32}$/.test(n));

describe('la rétention du magasin de dépendances', () => {
  it('une entrée qui n’a servi depuis plus de 7 jours part ; une autre reste', async () => {
    const { racine } = atelier();
    const perimee = entree(racine, 'p', { servieIlYa: INUTILISEE_MAX_MS + HEURE });
    const recente = entree(racine, 'p', { servieIlYa: INUTILISEE_MAX_MS - HEURE });

    const bilan = await ramasserMagasin(racine);

    expect(existsSync(perimee)).toBe(false);
    expect(existsSync(recente)).toBe(true);
    expect(bilan).toMatchObject({ vide: false, evincees: 1, octets: 1024 });
  });

  it('au-delà de 3 entrées dans un projet, les moins récemment servies partent', async () => {
    const { racine } = atelier();
    const p = [5, 4, 3, 2, 1].map((h) => entree(racine, 'p', { servieIlYa: h * HEURE }));
    const autre = entree(racine, 'q', { servieIlYa: 9 * HEURE });

    const bilan = await ramasserMagasin(racine);

    expect(p.map((e) => existsSync(e))).toEqual([false, false, true, true, true]);
    expect(existsSync(autre)).toBe(true);
    expect(entreesDe(path.join(racine, 'p'))).toHaveLength(ENTREES_PAR_PROJET);
    expect(bilan.evincees).toBe(2);
  });

  it('au-delà de 4 Gio en tout, les moins récemment servies partent — jusqu’à la borne, pas plus', async () => {
    const { racine } = atelier();
    // Cinq projets, une entrée chacun : aucune borne de projet ne joue.
    const e = [5, 4, 3, 2, 1].map((h) =>
      entree(racine, `p${h}`, { servieIlYa: h * HEURE, octets: GIO }),
    );

    const bilan = await ramasserMagasin(racine);

    // 5 Gio → 4 Gio : la moins récemment servie, et elle seule.
    expect(e.map((x) => existsSync(x))).toEqual([false, true, true, true, true]);
    expect(bilan).toMatchObject({ evincees: 1, octets: GIO });
    expect(4 * GIO).toBe(MAGASIN_OCTETS_MAX);
  });

  it('le niveau d’isolement change : le magasin ENTIER part ; le même niveau le garde', async () => {
    const { racine } = atelier('conteneur');
    const gardee = entree(racine, 'p', { servieIlYa: HEURE });

    const memeNiveau = await ramasserMagasin(racine, { niveau: 'conteneur' });
    expect(memeNiveau.vide).toBe(false);
    expect(existsSync(gardee)).toBe(true);

    const bilan = await ramasserMagasin(racine, { niveau: 'processus' });

    expect(bilan.vide).toBe(true);
    expect(existsSync(racine)).toBe(false);
    // Effacé, pas seulement écarté : rien ne reste à côté du magasin non plus.
    expect(noms(path.dirname(racine)).filter((n) => n.startsWith('dependances'))).toEqual([]);
    expect(direRamassage(bilan)).toBe(
      'magasin de dépendances : vidé : le niveau d’isolement du nœud a changé depuis son peuplement',
    );
  });

  it('un magasin sans marque — peuplé avant la rétention — part au premier démarrage', async () => {
    const { racine } = atelier(null);
    entree(racine, 'p', { servieIlYa: HEURE });

    const bilan = await ramasserMagasin(racine, { niveau: 'conteneur' });

    expect(bilan.vide).toBe(true);
    expect(existsSync(racine)).toBe(false);
  });

  it('au démarrage, les restes d’un peuplement ou d’un effacement interrompus partent — jamais une entrée', async () => {
    const { travail, racine } = atelier();
    const cle = 'a'.repeat(32);
    // Un peuplement tué APRÈS son manifeste : il en a l'air, pas le nom.
    const neuf = entree(racine, 'p', { nom: `${cle}.neuf-1`, servieIlYa: HEURE });
    const supprimee = entree(racine, 'p', { nom: `${cle}.supprimee-2`, servieIlYa: HEURE });
    const magasinEcarte = path.join(travail, 'dependances.supprimee-3');
    mkdirSync(path.join(magasinEcarte, 'p'), { recursive: true });
    const vraies = [3, 2, 1].map((h) => entree(racine, 'p', { servieIlYa: h * HEURE }));

    // En cours de route, un peuplement en vol a son `.neuf` : on ne le touche
    // pas — et les restes ne comptent pas pour la borne du projet.
    const enRoute = await ramasserMagasin(racine);
    expect(enRoute).toMatchObject({ evincees: 0, restes: 0 });
    expect(existsSync(neuf)).toBe(true);

    const bilan = await ramasserMagasin(racine, { niveau: 'conteneur' });

    expect(bilan).toMatchObject({ vide: false, evincees: 0, restes: 3 });
    expect([neuf, supprimee, magasinEcarte].map((d) => existsSync(d))).toEqual([
      false,
      false,
      false,
    ]);
    expect(vraies.every((d) => existsSync(d))).toBe(true);
  });

  it('une entrée au manifeste illisible ou d’un autre format part, sans compter pour une entrée', async () => {
    const { racine } = atelier();
    const illisible = entree(racine, 'p', { servieIlYa: HEURE });
    writeFileSync(path.join(illisible, 'manifeste.json'), '{ pas du json');
    const autreFormat = entree(racine, 'p', { servieIlYa: HEURE });
    writeFileSync(
      path.join(autreFormat, 'manifeste.json'),
      JSON.stringify({ version: VERSION_MAGASIN + 1, cle: path.basename(autreFormat), octets: 1 }),
    );

    const bilan = await ramasserMagasin(racine);

    expect(existsSync(illisible)).toBe(false);
    expect(existsSync(autreFormat)).toBe(false);
    expect(bilan).toMatchObject({ evincees: 0, restes: 2 });
  });

  it('par le vrai client : un nœud qui démarre sans bac vide le magasin peuplé sous un bac', async () => {
    const { travail, racine } = atelier('conteneur');
    entree(racine, 'p', { servieIlYa: HEURE });
    const adapter: AgentAdapter = {
      name: 'shell',
      run: async () => ({ success: true, diff: '', logs: '', subAgents: [] }),
    };
    const client = new HiveNodeClient({
      // Aucune ruche n'écoute là : le ramassage du démarrage n'en dépend pas.
      url: 'ws://127.0.0.1:9/ws',
      token: 'jeton-de-ruche-suffisamment-long',
      name: 'poste-retention',
      ownerName: 'membre',
      agentType: 'shell',
      nodeId: 'n-retention',
      maxConcurrency: 1,
      workRoot: travail,
      adapter,
      quiet: true,
    });
    try {
      client.start();
      const limite = Date.now() + 10_000;
      while (existsSync(racine) && Date.now() < limite) {
        await new Promise((fin) => setTimeout(fin, 25));
      }
    } finally {
      client.stop();
    }
    expect(existsSync(racine)).toBe(false);
  });
});
