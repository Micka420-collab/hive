// « SUR VOTRE RÉSEAU LOCAL » → Rejoindre — le parcours entier, avec le VRAI billet.
//
// ─── CE QUE CE BANC MONTE ────────────────────────────────────────────────────
//
// Une Reine RÉELLE (`createServer`, base jetable, `HIVE_DECOUVERTE` allumée) et
// une machine RÉELLE qui attend (`attendreUneRuche` — ce que lance `hive join
// --decouvrable`), reliées par un segment mDNS en mémoire (`harnais-mdns.ts`).
// Le vrai multicast a son propre banc (`decouverte-multicast.test.ts`), qui
// s'abstient en le disant là où la boucle multicast n'existe pas ; celui-ci
// tourne partout, parce que c'est lui qui porte la promesse.
//
// Tout le reste est le vrai chemin : la route `POST /api/decouverte/:id/
// rejoindre` émet un billet par le store, le scelle sous le code, le dépose en
// HTTP à la porte de la machine ; la machine l'ouvre, et l'échange par
// `POST /api/rejoindre` à l'adresse que le billet porte — exactement le geste
// de `join.ts` —, puis se connecte avec sa clé et se dit membre de CETTE ruche.
//
// ─── LES PROMESSES ÉPROUVÉES ─────────────────────────────────────────────────
//
//   · jamais d'entrée sans le code affiché sur la machine ;
//   · tout billet qui n'a pas été ouvert est révoqué sur-le-champ ;
//   · la liste ne croit que les adresses privées, et seulement les admins la lisent ;
//   · éteinte (le défaut), la découverte le dit et dit comment l'allumer.

import { mkdtempSync, rmSync } from 'node:fs';
import { createServer as serveurTcp } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createServer } from '../src/orchestrator/server.js';
import type { HiveServer } from '../src/orchestrator/server.js';
import { decoderBillet, urlHttpDeRuche } from '../src/shared/acces.js';
import { HiveNodeClient } from '../src/node-client/client.js';
import { Annonceur, Signalement, attendreUneRuche } from '../src/node-client/decouverte-noeud.js';
import type { AnnonceBase } from '../src/node-client/decouverte-noeud.js';
import { formaterEmpreinte, tirerEmpreinte } from '../src/shared/empreinte-ruche.js';
import type { ContenuOffre } from '../src/shared/decouverte.js';
import { attendreQue, busMdns } from './harnais-mdns.js';
import type { BusMdns } from './harnais-mdns.js';

const TOKEN = 'jeton-decouverte-assez-long-pour-la-garde';
const LIMITES = { id: 64, nom: 120 };

const CAMILLE: AnnonceBase = {
  nom: 'Le portable de Camille',
  os: 'linux',
  agents: ['claude-code', 'codex'],
  places: 2,
};

interface Decouvert {
  id: string;
  nom: string;
  os: string;
  agents: string[];
  places: number;
  etat: string;
  ruche: string | null;
  adresse: string;
  port: number;
}
interface Liste {
  active: boolean;
  empreinte: string;
  decouverts: Decouvert[];
  motif?: string;
  cause?: string;
  conseil?: string;
  injoignable?: string;
}

let dir: string;
let server: HiveServer | null = null;
let base = '';
let admin = '';
let bus: BusMdns;
const aFermer: (() => Promise<unknown>)[] = [];

/** Un port libre, pour que l'URL du billet désigne la ruche RÉELLE. */
function portLibre(): Promise<number> {
  return new Promise((resoudre) => {
    const s = serveurTcp();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address() as { port: number };
      s.close(() => resoudre(port));
    });
  });
}

async function monter(
  opts: { decouverte?: boolean; host?: string; publicUrl?: (port: number) => string } = {},
): Promise<void> {
  const port = await portLibre();
  server = await createServer({
    port,
    host: opts.host ?? '127.0.0.1',
    token: TOKEN,
    corsOrigins: ['http://localhost:5173'],
    dbPath: path.join(dir, 'decouverte.db'),
    simulation: false,
    tickMs: 10_000,
    publicUrl: (opts.publicUrl ?? ((p) => `ws://127.0.0.1:${p}/ws`))(port),
    ...(opts.decouverte === false ? {} : { decouverte: { ouvrirTransport: bus.prise() } }),
  });
  base = `http://127.0.0.1:${server.port}`;
  admin = await inscrire('admin@hive.test');
}

/** Un compte ; le PREMIER inscrit d'une ruche en est l'administrateur. */
async function inscrire(email: string): Promise<string> {
  const r = await fetch(`${base}/api/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-hive-token': TOKEN },
    body: JSON.stringify({ email, password: 'mot-de-passe-test', displayName: email }),
  });
  return ((await r.json()) as { token: string }).token;
}

const compte = (t: string) => ({ authorization: `Bearer ${t}`, 'x-hive-token': TOKEN });

async function liste(t = admin): Promise<Liste> {
  return (await (await fetch(`${base}/api/decouverte`, { headers: compte(t) })).json()) as Liste;
}

async function rejoindre(id: string, code: string): Promise<Response> {
  return fetch(`${base}/api/decouverte/${id}/rejoindre`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...compte(admin) },
    body: JSON.stringify({ code }),
  });
}

/** Une machine qui attend, comme `hive join --decouvrable` ; son code se lit dans ce qu'elle DIT. */
function machine(annonce: AnnonceBase = CAMILLE, source = '127.0.0.1') {
  const lignes: string[] = [];
  let recue: { contenu: ContenuOffre } | null = null;
  const attente = attendreUneRuche({
    annonce,
    ouvrirTransport: bus.prise(source),
    hote: '127.0.0.1',
    dire: (l) => lignes.push(l),
  }).then((r) => {
    recue = r;
    return r;
  });
  const codes = () =>
    lignes.flatMap((l) =>
      [...l.matchAll(/(?:appariement|code) : ([0-9A-Z]{4}-[0-9A-Z]{4})/g)].map((m) => m[1]!),
    );
  return {
    attente,
    lignes,
    /** Le code AFFICHÉ en ce moment — le dernier dit. */
    code: () => codes().at(-1) ?? '',
    codes,
    recue: () => recue,
  };
}

/** L'entrée de la liste portant ce nom, une fois entendue. */
async function entendue(nom: string, etat = 'libre'): Promise<Decouvert> {
  let trouvee: Decouvert | undefined;
  await attendreQue(async () => {
    trouvee = (await liste()).decouverts.find((d) => d.nom === nom && d.etat === etat);
    return trouvee !== undefined;
  }, `« ${nom} » (${etat}) dans la liste de la Reine`);
  return trouvee!;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => {
  dir = mkdtempSync(path.join(os.tmpdir(), 'hive-decouverte-'));
  bus = busMdns();
});

afterEach(async () => {
  for (const f of aFermer.splice(0)) await f().catch(() => {});
  await server?.stop();
  server = null;
  rmSync(dir, { recursive: true, force: true, maxRetries: 5 });
});

describe('la liste « Sur votre réseau local »', () => {
  it('RÉSERVÉE AUX ADMINISTRATEURS — ni l’anonyme, ni le seul jeton de ruche, ni un membre', async () => {
    await monter();
    expect((await fetch(`${base}/api/decouverte`)).status).toBe(401);
    expect(
      (await fetch(`${base}/api/decouverte`, { headers: { 'x-hive-token': TOKEN } })).status,
      'le jeton de ruche se recopie sur chaque machine : il ne lit pas le réseau de l’hôte',
    ).toBe(401);
    const membre = await inscrire('membre@hive.test');
    expect((await fetch(`${base}/api/decouverte`, { headers: compte(membre) })).status).toBe(403);
    const r = await fetch(`${base}/api/decouverte/hive-00000000/rejoindre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...compte(membre) },
      body: JSON.stringify({ code: 'K7Q2-9XMP' }),
    });
    expect(r.status).toBe(403);
  });

  it('une machine qui se signale APPARAÎT, avec les seuls champs du contrat', async () => {
    await monter();
    machine();
    const d = await entendue(CAMILLE.nom);
    expect(d).toMatchObject({
      nom: 'Le portable de Camille',
      os: 'linux',
      agents: ['claude-code', 'codex'],
      places: 2,
      etat: 'libre',
      ruche: null,
      adresse: '127.0.0.1',
    });
    expect(d.id).toMatch(/^hive-[0-9a-f]{8}$/);
    expect(d.port).toBeGreaterThan(0);
    // L'empreinte de CETTE ruche est montrée : c'est elle que la machine
    // affichera en recevant l'offre, pour que l'humain compare.
    expect((await liste()).empreinte).toMatch(/^[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/);
  });

  it('une annonce venue d’une adresse PUBLIQUE est ignorée — la Reine n’y enverra jamais rien', async () => {
    await monter();
    machine({ ...CAMILLE, nom: 'Imposteur public' }, '8.8.8.8');
    // Le bus livre dans l'ordre : quand la machine privée émise APRÈS est
    // entendue, l'annonce publique a forcément déjà été lue — et écartée.
    machine({ ...CAMILLE, nom: 'Voisine privée' });
    await entendue('Voisine privée');
    expect((await liste()).decouverts.map((d) => d.nom)).not.toContain('Imposteur public');
  });

  it('une machine qui PART (adieu) quitte la liste tout de suite', async () => {
    await monter();
    const annonceur = new Annonceur({ transport: await bus.prise()() });
    annonceur.annoncer({ ...CAMILLE, nom: 'Partante', etat: 'libre', ruche: null }, 4242);
    await entendue('Partante');
    await annonceur.arreter();
    await attendreQue(
      async () => !(await liste()).decouverts.some((d) => d.nom === 'Partante'),
      'la machine partie a quitté la liste',
    );
  });
});

describe('Rejoindre — le parcours entier, avec le vrai billet', () => {
  it('LE BON CODE : offre ouverte, billet échangé contre une clé, puis MEMBRE de cette ruche', async () => {
    await monter();
    const m = machine();
    const d = await entendue(CAMILLE.nom);

    // Saisi comme un humain le recopie : minuscules, tiret.
    const r = await rejoindre(d.id, m.code().toLowerCase());
    expect(r.status, await r.clone().text()).toBe(201);
    const corps = (await r.json()) as { ok: boolean; billetId: string; nom: string };
    expect(corps).toMatchObject({ ok: true, nom: CAMILLE.nom });

    const { contenu } = await m.attente;
    expect(
      formaterEmpreinte(contenu.ruche),
      'la machine reçoit l’empreinte de LA ruche qui l’accueille — celle que montre l’écran',
    ).toBe((await liste()).empreinte);

    // L'offre acceptée, la machine dit ADIEU et se TAIT : elle n'est pas
    // encore membre (billet à échanger, prérequis, inscription — tout peut
    // encore échouer). Elle ne se dira membre qu'au vrai `registered`.
    await attendreQue(
      async () => !(await liste()).decouverts.some((d) => d.nom === CAMILLE.nom),
      'la machine accueillie a quitté la liste en attendant son inscription',
    );
    const billet = decoderBillet(contenu.billet, LIMITES)!;
    expect(billet.id).toBe(corps.billetId);

    // Le geste de `join.ts` : l'échange, à l'adresse que le billet porte.
    const echange = await fetch(`${urlHttpDeRuche(billet.url)}/api/rejoindre`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ billet: contenu.billet, nodeId: 'noeud-camille', label: CAMILLE.nom }),
    });
    expect(echange.status).toBe(201);
    const { cle } = (await echange.json()) as { cle: string };
    expect(server!.store.getCleNoeud('noeud-camille')?.revokedAt).toBeNull();
    expect(server!.store.getBillet(billet.id)?.usesLeft, 'billet à usage unique, consommé').toBe(0);
    expect(
      server!.store.getBillet(billet.id)?.createdBy,
      'émis au nom de qui a cliqué',
    ).toBeTruthy();

    // Et la machine se connecte avec SA clé, puis se dit membre de CETTE ruche.
    const signalement = new Signalement(CAMILLE, { ouvrirTransport: bus.prise() });
    aFermer.push(() => signalement.arreter());
    const client = new HiveNodeClient({
      url: billet.url,
      token: cle,
      nodeId: 'noeud-camille',
      name: CAMILLE.nom,
      ownerName: 'camille',
      agentType: 'shell',
      maxConcurrency: 1,
      workRoot: path.join(dir, 'work'),
      adapter: {
        name: 'noop',
        async run() {
          return { success: true, diff: '', logs: '', subAgents: [] };
        },
      },
      quiet: true,
      surInscription: ({ ruche }) => signalement.inscrit(ruche),
    });
    aFermer.push(async () => client.stop());
    client.start();
    const membre = await entendue(CAMILLE.nom, 'membre');
    expect(membre.ruche).toBe('cette_ruche');
    expect(membre.port, 'un membre n’ouvre plus de porte d’offre').toBe(0);

    // La trace : le billet de l'offre est journalisé comme tout billet, avec son canal.
    const evenements = server!.store.listEvents(0, 500);
    expect(
      evenements.some(
        (e) =>
          e.type === 'invite_created' && (e.payload as { canal?: string }).canal === 'reseau_local',
      ),
    ).toBe(true);
  });

  it('un MAUVAIS CODE : rien n’entre, le billet est révoqué, et le bon code passe encore', async () => {
    await monter();
    const m = machine();
    const d = await entendue(CAMILLE.nom);
    const faux = m.code() === 'AAAA-AAAA' ? 'BBBB-BBBB' : 'AAAA-AAAA';

    const r = await rejoindre(d.id, faux);
    expect(r.status).toBe(422);
    const refus = (await r.json()) as { motif: string; detail: string };
    expect(refus.motif).toBe('code_refuse');
    expect(refus.detail).toMatch(/4 essais/);
    // LE BILLET PARTI VERS UNE MACHINE QUI NE L'A PAS OUVERT NE SURVIT PAS.
    const billets = server!.store.listBillets();
    expect(billets).toHaveLength(1);
    expect(billets[0]!.revokedAt, 'billet révoqué sur-le-champ').not.toBeNull();
    expect(m.recue(), 'la machine n’a rien accepté').toBeNull();

    // La machine attend toujours : le bon code l'accueille.
    await pause(550);
    expect((await rejoindre(d.id, m.code())).status).toBe(201);
    await m.attente;
  });

  it('CINQ mauvais codes : la machine en tire un nouveau, et l’ancien ne vaut plus rien', async () => {
    await monter();
    const m = machine();
    const d = await entendue(CAMILLE.nom);
    const ancien = m.code();
    const faux = ancien === 'AAAA-AAAA' ? 'BBBB-BBBB' : 'AAAA-AAAA';
    let dernier: { motif: string } | null = null;
    for (let i = 0; i < 5; i++) {
      // La porte refuse deux offres à moins d'une demi-seconde : chacune lui
      // coûte un PBKDF2.
      await pause(550);
      dernier = (await (await rejoindre(d.id, faux)).json()) as { motif: string };
    }
    expect(dernier?.motif).toBe('code_renouvele');
    expect(m.codes(), 'le nouveau code est DIT sur la machine').toHaveLength(2);
    expect(m.code()).not.toBe(ancien);
    await pause(550);
    expect(((await (await rejoindre(d.id, ancien)).json()) as { motif: string }).motif).toBe(
      'code_refuse',
    );
    await pause(550);
    expect((await rejoindre(d.id, m.code())).status).toBe(201);
    await m.attente;
    // Sept billets émis, UN seul encore valide : celui qui a été ouvert.
    const vivants = server!.store.listBillets().filter((b) => b.revokedAt === null);
    expect(vivants).toHaveLength(1);
  });

  it('un code ILLISIBLE est refusé avant tout billet', async () => {
    await monter();
    const m = machine();
    const d = await entendue(CAMILLE.nom);
    expect((await rejoindre(d.id, 'trop-court')).status).toBe(400);
    expect(server!.store.listBillets(), 'aucun billet émis').toHaveLength(0);
    expect(m.recue()).toBeNull();
  });

  it('une machine MEMBRE ne se « rejoint » pas — d’une autre ruche comme de celle-ci', async () => {
    await monter();
    const s = new Signalement(
      { ...CAMILLE, nom: 'Chez la voisine' },
      { ouvrirTransport: bus.prise() },
    );
    aFermer.push(() => s.arreter());
    s.inscrit(tirerEmpreinte());
    const d = await entendue('Chez la voisine', 'membre');
    expect(d.ruche).toBe('autre_ruche');
    expect((await rejoindre(d.id, 'K7Q2-9XMP')).status).toBe(409);
    expect(server!.store.listBillets()).toHaveLength(0);
  });

  it('une machine INJOIGNABLE : 502, et le billet ne lui survit pas', async () => {
    await monter();
    // Une annonce vers une porte où personne n'écoute plus.
    const port = await portLibre();
    const a = new Annonceur({ transport: await bus.prise()() });
    aFermer.push(() => a.arreter());
    a.annoncer({ ...CAMILLE, nom: 'Éteinte', etat: 'libre', ruche: null }, port);
    const d = await entendue('Éteinte');
    const r = await rejoindre(d.id, 'K7Q2-9XMP');
    expect(r.status).toBe(502);
    expect(((await r.json()) as { motif: string }).motif).toBe('injoignable');
    expect(server!.store.listBillets()[0]!.revokedAt).not.toBeNull();
  });

  it('une machine qui n’est plus entendue : 404, sans billet', async () => {
    await monter();
    expect((await rejoindre('hive-deadbeef', 'K7Q2-9XMP')).status).toBe(404);
    expect(server!.store.listBillets()).toHaveLength(0);
  });
});

describe('les gardes de la ruche elle-même', () => {
  it('écoute en boucle locale + adresse réseau : dit AVANT le clic, refusé SANS billet', async () => {
    // Le cas qui trompe (`joignable.ts`) : la ruche n'écoute que sur elle-même,
    // mais le billet annoncerait l'adresse du réseau. La machine découverte
    // n'aurait jamais pu l'échanger.
    await monter({ publicUrl: (p) => `ws://192.168.1.50:${p}/ws` });
    expect((await liste()).injoignable).toMatch(/HIVE_HOST=0\.0\.0\.0/);
    const m = machine();
    const d = await entendue(CAMILLE.nom);
    const r = await rejoindre(d.id, m.code());
    expect(r.status).toBe(409);
    expect(((await r.json()) as { detail: string }).detail).toMatch(/HIVE_HOST/);
    expect(server!.store.listBillets(), 'aucun billet vers une ruche injoignable').toHaveLength(0);
    expect(m.recue()).toBeNull();
  });

  it('ÉTEINTE (le défaut) : la liste le dit, avec le chemin pour l’allumer', async () => {
    await monter({ decouverte: false });
    const l = await liste();
    expect(l.active).toBe(false);
    expect(l.decouverts).toEqual([]);
    expect(l.motif, 'un code fermé, que l’écran traduit').toBe('eteinte');
    expect(l.conseil).toContain('HIVE_DECOUVERTE=1');
    expect(l.conseil).toContain('--decouvrable');
    const r = await rejoindre('hive-00000000', 'K7Q2-9XMP');
    expect(r.status).toBe(404);
    expect(((await r.json()) as { detail: string }).detail).toContain('HIVE_DECOUVERTE=1');
  });

  it('une prise qui ne s’ouvre pas n’arrête PAS la ruche — et la cause est dite', async () => {
    const port = await portLibre();
    server = await createServer({
      port,
      host: '127.0.0.1',
      token: TOKEN,
      corsOrigins: ['http://localhost:5173'],
      dbPath: path.join(dir, 'decouverte.db'),
      simulation: false,
      tickMs: 10_000,
      decouverte: {
        ouvrirTransport: () => Promise.reject(new Error('port 5353 tenu en exclusivité')),
      },
    });
    base = `http://127.0.0.1:${server.port}`;
    admin = await inscrire('admin@hive.test');
    const l = await liste();
    expect(l.active).toBe(false);
    expect(l).toMatchObject({ motif: 'indisponible', cause: 'port 5353 tenu en exclusivité' });
    expect(l.conseil).toContain('port 5353 tenu en exclusivité');
  });
});
