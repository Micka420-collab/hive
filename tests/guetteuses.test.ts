// Les Guetteuses — et la seule chose qui décide de leur valeur.
//
// ─── L'INVARIANT ─────────────────────────────────────────────────────────────
//
// ZÉRO FAUX POSITIF. Une alerte qui se trompe une fois sur dix est une alerte
// qu'on apprend à ignorer — et une alerte ignorée est PIRE que pas d'alerte,
// parce qu'elle donne l'illusion d'une surveillance.
//
// Le premier test de ce fichier relit les routes réellement déclarées par
// `server.ts` et vérifie qu'aucun leurre n'en croise une. C'est lui qui rend
// le mécanisme digne de confiance : sans lui, ajouter un jour une route
// `/config.json` transformerait chaque chargement du dashboard en fausse
// alerte, et l'hôte cesserait de lire ses alertes en une semaine.
//
// ─── CE QU'ELLES NE FONT PAS ─────────────────────────────────────────────────
//
// Elles ne ferment rien et ne bloquent personne. Une ruche derrière un reverse
// proxy voit toutes ses requêtes venir de la même adresse : un blocage
// automatique y couperait tout le monde d'un coup, sur la foi d'un seul
// visiteur curieux.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FENETRE_MS,
  LEURRES,
  Registre,
  SEUIL_BALAYAGE,
  juger,
  leurreTouche,
  normaliserChemin,
  type Passage,
} from '../src/orchestrator/guetteuses.js';

const SERVEUR = readFileSync(
  fileURLToPath(new URL('../src/orchestrator/server.ts', import.meta.url)),
  'utf8',
);

/** Toutes les routes que le serveur déclare réellement. */
function routesDeclarees(): string[] {
  return [...SERVEUR.matchAll(/app\.(?:get|post|put|delete|patch)[^(]*\(\s*'([^']+)'/g)].map(
    (m) => m[1]!,
  );
}

describe('ZÉRO FAUX POSITIF — l’invariant qui rend l’alerte crédible', () => {
  it('le serveur déclare bien des routes (méta-test anti-faux-vert)', () => {
    expect(routesDeclarees().length).toBeGreaterThan(20);
  });

  it('AUCUN LEURRE NE CROISE UNE ROUTE RÉELLE', () => {
    // Si un jour quelqu'un ajoute `/config.json`, chaque chargement du
    // dashboard deviendrait une fausse alerte — et l'hôte cesserait de lire
    // ses alertes en une semaine.
    const reelles = routesDeclarees().map(normaliserChemin);
    for (const leurre of LEURRES) {
      for (const route of reelles) {
        expect(route, `le leurre ${leurre.chemin} croise la route ${route}`).not.toBe(
          leurre.chemin,
        );
        expect(route.startsWith(`${leurre.chemin}/`), `${route} tombe sous ${leurre.chemin}`).toBe(
          false,
        );
      }
    }
  });

  it('AUCUN LEURRE NE COMMENCE PAR /api — c’est notre espace, pas un piège', () => {
    // Un leurre sous `/api` risquerait de croiser une route future, et un
    // client légitime qui se trompe de version d'API serait dénoncé comme un
    // attaquant.
    for (const l of LEURRES) expect(l.chemin.startsWith('/api'), l.chemin).toBe(false);
  });

  it('les chemins que la ruche sert vraiment ne déclenchent RIEN', () => {
    for (const innocent of [
      '/',
      '/index.html',
      '/assets/index-abc123.js',
      '/api/state',
      '/api/health',
      '/api/projects/abc/tasks',
      '/favicon.ico',
      '/ws',
    ]) {
      expect(leurreTouche(innocent), innocent).toBeNull();
    }
  });
});

describe('un scanner n’écrit pas proprement', () => {
  it('LES CONTOURNEMENTS CLASSIQUES SONT VUS', () => {
    // Un leurre qu'on esquive avec un `%2E` ou un double slash ne détecte que
    // les outils les plus paresseux — c'est-à-dire ceux dont on se moque.
    for (const forme of [
      '/.env',
      '//.env',
      '/./.env',
      '/.env?x=1',
      '/.env#fragment',
      '/%2Eenv',
      '/.ENV',
      '/.env/',
      '\\.env',
    ]) {
      expect(leurreTouche(forme), forme).not.toBeNull();
    }
  });

  it('un sous-chemin d’un leurre compte aussi', () => {
    expect(leurreTouche('/.git/config')).not.toBeNull();
    expect(leurreTouche('/wp-admin/setup-config.php')).not.toBeNull();
  });

  it('un pourcentage isolé ne fait pas TOMBER la normalisation', () => {
    // `decodeURIComponent('%')` lève. Laisser l'exception remonter ferait
    // planter le gestionnaire de 404 sur une requête d'une seule frappe —
    // c'est-à-dire offrir un déni de service à qui sait taper « % ».
    for (const tordu of ['/%', '/%zz', '/.env%', '/%%%%']) {
      expect(() => normaliserChemin(tordu), tordu).not.toThrow();
      expect(() => leurreTouche(tordu), tordu).not.toThrow();
    }
    // `/.env%` n'est PAS `/.env` : ne pas le signaler est correct, pas une
    // faiblesse. Un serveur ne servirait pas davantage le fichier pour ce
    // chemin-là. L'encodage qui compte, lui, est bien vu :
    expect(leurreTouche('/%2Eenv')).not.toBeNull();
  });

  it('un chemin voisin mais légitime n’est PAS un leurre', () => {
    // La frontière doit être nette dans les deux sens.
    for (const proche of ['/environnement', '/.environment-page', '/git', '/administration-x']) {
      expect(leurreTouche(proche), proche).toBeNull();
    }
  });
});

describe('le jugement', () => {
  const p = (quand: number, source = 'a', appat: Passage['appat'] = 'secrets'): Passage => ({
    source,
    chemin: '/.env',
    appat,
    quand,
  });

  it('rien vu = calme, et le dit sans dramatiser', () => {
    const v = juger([], 1_000_000);
    expect(v.niveau).toBe('calme');
    expect(v.passages).toBe(0);
  });

  it('quelques passages = reniflage, et l’hôte apprend que sa ruche est visible', () => {
    const v = juger([p(1000), p(2000)], 3000);
    expect(v.niveau).toBe('reniflage');
    expect(v.conseil).toMatch(/visible/i);
    expect(v.conseil, 'un conseil sans marche à suivre ne sert à rien').toMatch(/HIVE_HOST|tunnel/);
  });

  it('AU-DELÀ DU SEUIL, C’EST UN OUTIL QUI DÉROULE SA LISTE', () => {
    const passages = Array.from({ length: SEUIL_BALAYAGE }, (_, i) => p(1000 + i));
    const v = juger(passages, 2000);
    expect(v.niveau).toBe('balayage');
    // Le conseil doit être actionnable MAINTENANT, pendant que ça ne coûte rien.
    expect(v.conseil).toMatch(/membres|HIVE_TOKEN|HIVE_INSCRIPTION/);
  });

  it('CE QUI EST VIEUX NE COMPTE PLUS — sinon l’alerte ne redescend jamais', () => {
    // Une alerte qui reste allumée pour toujours après un scan d'il y a trois
    // mois est une alerte qu'on finit par masquer.
    const vieux = Array.from({ length: SEUIL_BALAYAGE * 2 }, (_, i) => p(i));
    expect(juger(vieux, FENETRE_MS + 10_000).niveau).toBe('calme');
  });

  it('compte les sources distinctes et classe ce qu’on cherchait', () => {
    const v = juger([p(1, 'a', 'secrets'), p(2, 'b', 'secrets'), p(3, 'b', 'panneau')], 100);
    expect(v.sources).toBe(2);
    expect(v.appats[0], 'le plus fréquent en tête').toBe('secrets');
  });
});

describe('le registre', () => {
  it('n’enregistre QUE les leurres — pas les 404 ordinaires', () => {
    const r = new Registre();
    expect(r.noter('/une/page/qui/nexiste/pas', '1.2.3.4', 1000)).toBeNull();
    expect(r.verdict(1000).passages).toBe(0);
    expect(r.noter('/.env', '1.2.3.4', 1000)).not.toBeNull();
    expect(r.verdict(1000).passages).toBe(1);
  });

  it('EST BORNÉ — un scanner ne peut pas faire enfler la mémoire de sa victime', () => {
    const r = new Registre(10);
    for (let i = 0; i < 1000; i++) r.noter('/.env', `ip-${i}`, 1000 + i);
    expect(r.derniers(1000)).toHaveLength(10);
  });

  it('garde les plus RÉCENTS, jamais les plus vieux', () => {
    const r = new Registre(3);
    for (let i = 0; i < 10; i++) r.noter('/.env', `ip-${i}`, 1000 + i);
    expect(r.derniers()[0]?.source).toBe('ip-9');
  });

  it('chaque leurre dit ce qu’on cherchait chez vous', () => {
    for (const l of LEURRES) {
      expect(l.intention.length, l.chemin).toBeGreaterThan(15);
      expect(l.chemin.startsWith('/'), l.chemin).toBe(true);
      expect(l.chemin, 'un leurre en majuscules ne matcherait jamais').toBe(l.chemin.toLowerCase());
    }
  });
});
