// LA MACHINE QUI SE SIGNALE — sa porte d'offre et son répondeur, pris à part.
//
// ─── POURQUOI À PART ─────────────────────────────────────────────────────────
//
// `decouverte-rejoindre.test.ts` éprouve le parcours heureux et les refus du
// point de vue de la REINE. Ici, on frappe à la porte de la machine comme le
// ferait n'importe qui sur le segment — pas seulement une Reine polie : une
// requête qui n'est pas une offre, une rafale, un corps démesuré, une seconde
// offre après l'accueil. Chacun de ces coups a une réponse nommée, et aucun ne
// fait entrer personne.
//
// Et le répondeur : il ne répond qu'aux QUESTIONS qui le concernent, pas plus
// d'une fois par seconde — un voisin qui le bombarde ne le transforme pas en
// haut-parleur multicast.

import { afterEach, describe, expect, it } from 'vitest';
import {
  Annonceur,
  ESSAIS_PAR_CODE,
  annonceDeMachine,
  ecouterOffres,
  lignesAnnonce,
} from '../src/node-client/decouverte-noeud.js';
import type { EcouteOffres } from '../src/node-client/decouverte-noeud.js';
import { encoderBillet } from '../src/shared/acces.js';
import { scellerOffre } from '../src/shared/decouverte.js';
import { deriverEmpreinte } from '../src/orchestrator/auth.js';
import { TYPE_MDNS, decoderPaquet, encoderPaquet } from '../src/shared/mdns.js';
import { busMdns } from './harnais-mdns.js';

const INSTANCE = 'hive-0a1b2c3d';
const RUCHE = deriverEmpreinte('secret-de-la-ruche-du-banc-de-la-porte');
const BILLET = encoderBillet({
  url: 'ws://192.168.1.10:7777/ws',
  id: 'bil-porte',
  secret: 's'.repeat(43),
});

const ouvertes: EcouteOffres[] = [];
afterEach(async () => {
  for (const p of ouvertes.splice(0)) await p.fermer();
});

async function porte(codes: string[] = ['K7Q29XMP', 'N3W3C0DE']) {
  const dits: string[] = [];
  const p = await ecouterOffres({
    instance: INSTANCE,
    hote: '127.0.0.1',
    tirer: () => codes.shift() ?? 'ZZZZZZZZ',
    surCode: (c) => dits.push(c),
  });
  ouvertes.push(p);
  return { p, dits, url: `http://127.0.0.1:${p.port}/offre` };
}

const poster = (url: string, corps: unknown) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof corps === 'string' ? corps : JSON.stringify(corps),
  });

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('la porte d’offre', () => {
  it('ce qui n’est pas une offre : 404, et rien ne se passe', async () => {
    const { p } = await porte();
    const base = `http://127.0.0.1:${p.port}`;
    expect((await fetch(`${base}/offre`)).status, 'GET').toBe(404);
    expect((await fetch(`${base}/autre`, { method: 'POST', body: '{}' })).status).toBe(404);
  });

  it('un corps illisible : 400 « offre_illisible », et ce n’est pas un essai de code', async () => {
    const { url, dits } = await porte();
    for (const corps of ['pas du json', { v: 1 }, 'x'.repeat(20_000)]) {
      await pause(550);
      const r = await poster(url, corps).catch(() => null);
      // Un corps démesuré peut voir la connexion coupée avant la réponse :
      // les deux issues sont un refus, aucune n'est une entrée.
      if (r) {
        expect(r.status).toBe(400);
        expect(((await r.json()) as { issue: string }).issue).toBe('offre_illisible');
      }
    }
    expect(dits, 'aucun code brûlé par des requêtes malformées').toEqual(['K7Q29XMP']);
  });

  it('deux offres à moins d’une demi-seconde : la seconde attend son tour (429)', async () => {
    const { url } = await porte();
    const offre = await scellerOffre({ billet: BILLET, ruche: RUCHE }, 'AAAAAAAA', INSTANCE);
    const [a, b] = await Promise.all([poster(url, offre), poster(url, offre)]);
    const statuts = [a.status, b.status].sort();
    expect(statuts).toEqual([403, 429]);
  });

  it(`${ESSAIS_PAR_CODE} refus : nouveau code, dit sur la machine, et l’ancien est brûlé`, async () => {
    const { p, url, dits } = await porte();
    const faux = await scellerOffre({ billet: BILLET, ruche: RUCHE }, 'AAAAAAAA', INSTANCE);
    const issues: string[] = [];
    for (let i = 0; i < ESSAIS_PAR_CODE; i++) {
      await pause(550);
      issues.push(((await (await poster(url, faux)).json()) as { issue: string }).issue);
    }
    expect(issues).toEqual([
      ...new Array<string>(ESSAIS_PAR_CODE - 1).fill('code_refuse'),
      'code_renouvele',
    ]);
    expect(dits).toEqual(['K7Q29XMP', 'N3W3C0DE']);
    expect(p.code()).toBe('N3W3C0DE');

    await pause(550);
    const ancien = await scellerOffre({ billet: BILLET, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    expect((await poster(url, ancien)).status, 'l’ancien code ne vaut plus rien').toBe(403);
    await pause(550);
    const bon = await scellerOffre({ billet: BILLET, ruche: RUCHE }, 'N3W3C0DE', INSTANCE);
    expect((await poster(url, bon)).status).toBe(200);
    expect(await p.offre).toEqual({ billet: BILLET, ruche: RUCHE });
  });

  it('après l’accueil, plus aucune offre n’entre — même valide (409)', async () => {
    const { p, url } = await porte();
    const bon = await scellerOffre({ billet: BILLET, ruche: RUCHE }, 'K7Q29XMP', INSTANCE);
    expect((await poster(url, bon)).status).toBe(200);
    await p.offre;
    await pause(550);
    const r = await poster(url, bon);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { issue: string }).issue).toBe('deja_accueillie');
  });
});

describe('le répondeur', () => {
  const question = (nom: string, type: number) =>
    encoderPaquet({
      id: 0,
      reponse: false,
      questions: [{ nom, type, unicast: false }],
      reponses: [],
      additionnels: [],
    });

  it('répond à « qui offre _hive._tcp ? », une fois par seconde au plus, et à rien d’autre', async () => {
    const bus = busMdns();
    const a = new Annonceur({ transport: await bus.prise()(), adresses: () => ['127.0.0.1'] });
    const voisin = await bus.prise('192.168.1.40')();
    try {
      a.annoncer(
        { nom: 'Poste', os: 'linux', agents: [], places: 1, etat: 'libre', ruche: null },
        4242,
      );
      await pause(50);
      const avant = bus.emis.length;

      // Une question qui ne le concerne pas : silence.
      voisin.emettre(question('_imprimante._tcp.local', TYPE_MDNS.PTR));
      await pause(200);
      expect(bus.emis.length, 'question étrangère : aucune réponse').toBe(avant + 1);

      // LA question, en rafale de vingt et une DANS LE MÊME INSTANT : UNE
      // réponse, avec PTR + SRV + TXT + A. La rafale part d'un bloc — le banc
      // ne dépend donc d'aucune horloge pour tenir « dans la même seconde ».
      for (let i = 0; i < 21; i++) voisin.emettre(question('_hive._tcp.local', TYPE_MDNS.PTR));
      await pause(300);
      const reponses = bus.emis
        .slice(avant)
        .map((b) => decoderPaquet(b)!)
        .filter((p) => p.reponse);
      expect(reponses, 'une rafale n’achète pas de réponses').toHaveLength(1);
      expect(reponses[0]!.additionnels.map((e) => e.type).sort()).toEqual(['A', 'SRV', 'TXT']);
    } finally {
      await voisin.fermer();
      await a.arreter();
    }
  });

  it('en partant, il dit ADIEU (TTL 0) — puis se tait', async () => {
    const bus = busMdns();
    const a = new Annonceur({ transport: await bus.prise()(), adresses: () => ['127.0.0.1'] });
    a.annoncer({ nom: 'Poste', os: 'linux', agents: [], places: 1, etat: 'libre', ruche: null }, 1);
    await a.arreter();
    const dernier = decoderPaquet(bus.emis.at(-1)!)!;
    expect(dernier.reponses[0]).toMatchObject({ type: 'PTR', ttl: 0 });
    const n = bus.emis.length;
    a.annoncer({ nom: 'Poste', os: 'linux', agents: [], places: 1, etat: 'libre', ruche: null }, 1);
    expect(bus.emis.length, 'arrêté, il ne dit plus rien').toBe(n);
  });
});

describe('ce que la machine annonce d’elle', () => {
  it('les agents CONNECTÉS seulement (#492), jamais le simulacre', () => {
    const a = annonceDeMachine({
      nom: 'Poste',
      plateforme: 'win32',
      inventaire: { tous: ['claude-code', 'codex', 'shell'] },
      places: 3,
    });
    expect(a).toEqual({ nom: 'Poste', os: 'windows', agents: ['claude-code', 'codex'], places: 3 });
  });

  it('l’humain lit ce qui est diffusé AVANT de donner son code', () => {
    const lignes = lignesAnnonce({ nom: 'Poste', os: 'macos', agents: [], places: 1 }).join('\n');
    expect(lignes).toContain('« Poste »');
    expect(lignes).toContain('macOS');
    expect(lignes).toMatch(/aucun agent IA connecté/);
    expect(lignes).toMatch(/ni version, ni chemin, ni clé/);
  });
});
