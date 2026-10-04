// L'application de bureau — ce que la coquille laisse passer, et ce qu'elle dit.
//
// La fenêtre porte le jeton maître de la ruche : où elle peut aller, ce qu'un
// lien `hive://` peut ouvrir, quels fichiers `bureau://` sert, quelle CSP
// l'écran reçoit (ADR 0013 § 13). Puis ce que l'app dit à l'humain : les
// notifications, la barre système, l'entrée de session sous Linux, et le
// verdict du banc de fumée des paquets.

import { describe, expect, it } from 'vitest';
import {
  cheminAutostart,
  executableDeSession,
  fichierAutostart,
} from '../desktop/src/autostart-linux.js';
import { avecCsp, politiqueCsp } from '../desktop/src/csp.js';
import { defautsDuRapport, type RapportDiagnostic } from '../desktop/src/diagnostic-verdict.js';
import {
  fichierDeCoquille,
  lienDansArgv,
  lienExterne,
  navigationPermise,
  pageVoulue,
  routeDepuisLien,
  SCHEMA_APERCU,
  URL_ACCUEIL,
} from '../desktop/src/navigation.js';
import {
  libelleEtat,
  notificationMortOuvriere,
  notificationPour,
  TYPES_NOTIFIES,
} from '../desktop/src/notifications.js';

const REINE = 'http://127.0.0.1:7777';

describe('la navigation de la fenêtre — l’origine de SA Reine, et l’accueil', () => {
  it('l’écran de la Reine et l’accueil exact passent', () => {
    expect(navigationPermise(`${REINE}/#/projets`, REINE)).toBe(true);
    expect(navigationPermise(URL_ACCUEIL, REINE)).toBe(true);
    expect(navigationPermise(`${URL_ACCUEIL}#erreur`, null)).toBe(true);
  });

  it('tout le reste est refusé — même port ailleurs, autre port, autre page de la coquille', () => {
    for (const url of [
      'http://127.0.0.1:7778/',
      'http://localhost:7777/',
      'https://example.com/',
      'file:///etc/passwd',
      'bureau://app/marque/icon.png',
      'bureau://autre/accueil/index.html',
      'pas une url',
    ]) {
      expect(navigationPermise(url, REINE), url).toBe(false);
    }
    // Avant que la Reine ne s'annonce, aucune origine http n'est permise.
    expect(navigationPermise(`${REINE}/`, null)).toBe(false);
  });

  it('seuls les liens `https:` partent au navigateur du système', () => {
    expect(lienExterne('https://github.com/Micka420-collab/hive')).toBe(true);
    // Le « Plein écran » de l'atelier : noVNC sur un autre port de la boucle locale.
    expect(lienExterne('http://127.0.0.1:6080/vnc.html?view_only=1')).toBe(true);
    expect(lienExterne('http://localhost:6080/')).toBe(true);
    for (const url of [
      'http://example.com',
      'http://127.0.0.1.evil.test/',
      'file:///x',
      'javascript:alert(1)',
      'hive://ouvrir',
    ]) {
      expect(lienExterne(url), url).toBe(false);
    }
  });
});

describe('les liens `hive://` — une route de l’écran, rien d’autre', () => {
  it('`hive://ouvrir/<route>` ouvre la route ; sans route, l’accueil de l’écran', () => {
    expect(routeDepuisLien('hive://ouvrir/projets')).toBe('#/projets');
    expect(routeDepuisLien('hive://ouvrir/chambre/abc-123')).toBe('#/chambre/abc-123');
    expect(routeDepuisLien('hive://ouvrir/')).toBe('#/');
    expect(routeDepuisLien('hive://ouvrir')).toBe('#/');
  });

  it('tout autre lien est refusé', () => {
    for (const lien of [
      'hive://supprimer/tout',
      'hive://ouvrir/projets?jeton=x',
      'hive://ouvrir/projets#x',
      'hive://ouvrir/a b',
      'https://ouvrir/projets',
      'hive://user:pass@ouvrir/x',
      'n’importe quoi',
    ]) {
      expect(routeDepuisLien(lien), lien).toBeNull();
    }
  });

  it('une remontée (`..`, `%2e%2e`) est résolue par l’analyseur d’URL : il en reste une ROUTE, jamais un chemin', () => {
    // Le parseur WHATWG normalise les segments `..` avant nous : ce qu'il en
    // reste est une route de l'écran comme une autre (une vue inconnue y
    // retombe sur la Ruche). Rien ne sort de `#/…`.
    expect(routeDepuisLien('hive://ouvrir/../../etc')).toBe('#/etc');
    expect(routeDepuisLien('hive://ouvrir/%2e%2e/secret')).toBe('#/secret');
  });

  it('le second lancement passe son lien par la ligne de commande', () => {
    expect(lienDansArgv(['/opt/Hive/hive', '--flag', 'hive://ouvrir/sante'])).toBe(
      'hive://ouvrir/sante',
    );
    expect(lienDansArgv(['/opt/Hive/hive'])).toBeNull();
  });
});

describe('`bureau://` — l’accueil et la marque, rien d’autre de la coquille', () => {
  it('sert `accueil/` et `marque/`', () => {
    expect(fichierDeCoquille('bureau://app/accueil/index.html')).toEqual(['accueil', 'index.html']);
    expect(fichierDeCoquille('bureau://app/marque/polices/x.woff2')).toEqual([
      'marque',
      'polices',
      'x.woff2',
    ]);
  });

  it('refuse le reste de la coquille, la remontée et l’encodage hostile', () => {
    for (const url of [
      'bureau://app/dist/main.js',
      'bureau://app/package.json',
      'bureau://app/accueil/../dist/main.js',
      'bureau://app/accueil/%2e%2e/dist/main.js',
      'bureau://app/marque/..%2f..%2fpackage.json',
      'bureau://app/accueil/%5c..%5cmain.js',
      'bureau://app/accueil/%E0%A4%A',
      'bureau://autre/accueil/index.html',
      'bureau://app/accueil',
      'file:///accueil/index.html',
    ]) {
      expect(fichierDeCoquille(url), url).toBeNull();
    }
  });
});

describe('la CSP posée sur l’écran', () => {
  it('le flux `/ws` de SA Reine, et aucune autre origine', () => {
    const csp = politiqueCsp(40123);
    expect(csp).toContain("connect-src 'self' ws://127.0.0.1:40123");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toContain('unsafe-eval');
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  it('les cadres de l’écran : l’Aperçu servi par la coquille et l’atelier local, rien d’autre', () => {
    // Sans `frame-src`, `default-src 'self'` bloquait noVNC (un autre port) ;
    // l'Aperçu passe par `apercu:` parce qu'un `srcdoc` hérite `script-src`.
    const frame = politiqueCsp(7777)
      .split('; ')
      .find((d) => d.startsWith('frame-src'));
    expect(frame).toBe(`frame-src 'self' ${SCHEMA_APERCU}: http://127.0.0.1:*`);
  });

  it('une CSP déjà envoyée par la Reine n’est jamais écrasée', () => {
    const deja = { 'content-security-policy': ["default-src 'none'"] };
    expect(avecCsp(deja, 'x')).toEqual(deja);
    expect(avecCsp({ 'X-A': ['1'] }, 'x')).toEqual({
      'X-A': ['1'],
      'Content-Security-Policy': ['x'],
    });
  });
});

describe('les notifications — ce qui attend un humain, et rien d’autre', () => {
  it('chaque type notifié rend une notification ; la vie normale de la ruche, aucune', () => {
    for (const type of TYPES_NOTIFIES) {
      expect(notificationPour({ type, payload: {} }), type).not.toBeNull();
    }
    for (const type of [
      'task_completed',
      'heartbeat',
      'node_registered',
      'human_review_required',
    ]) {
      expect(notificationPour({ type, payload: {} }), type).toBeNull();
    }
  });

  it('une réquisition ouvre la Chambre du nœud qui la porte — si son id est une route', () => {
    const n = notificationPour({
      type: 'requisition_ouverte',
      payload: { nodeId: 'noeud-42', libelle: 'GITHUB_TOKEN' },
    });
    expect(n?.route).toBe('chambre/noeud-42');
    expect(n?.corps).toContain('GITHUB_TOKEN');
    const hostile = notificationPour({
      type: 'requisition_ouverte',
      payload: { nodeId: '../../x' },
    });
    expect(hostile?.route).toBe('chambre');
  });

  it('un plafond appliqué et un plafond consultatif ne disent pas la même chose', () => {
    const strict = notificationPour({ type: 'balance_cap_reached', payload: { applique: true } });
    const doux = notificationPour({ type: 'balance_cap_reached', payload: { applique: false } });
    expect(strict?.corps).not.toBe(doux?.corps);
  });

  it('la mort d’une ouvrière cite sa dernière phrase, sans le ✘ du terminal', () => {
    const n = notificationMortOuvriere('ouvrière codex', '✘ arrêtée (code 5) — « non connecté »');
    expect(n.titre).toBe('ouvrière codex s’est arrêtée');
    expect(n.corps).toBe('arrêtée (code 5) — « non connecté »');
  });

  it('la barre système dit l’état en une ligne', () => {
    expect(libelleEtat({ reine: 'en-ligne', ouvrieres: 1 })).toBe('Reine en ligne · 1 ouvrière');
    expect(libelleEtat({ reine: 'en-ligne', ouvrieres: 2 })).toBe('Reine en ligne · 2 ouvrières');
    expect(libelleEtat({ reine: 'relance', ouvrieres: 0 })).toBe('La Reine redémarre…');
  });
});

describe('le lancement à l’ouverture de session, sous Linux', () => {
  it('une AppImage se relance par SON fichier, pas par son point de montage temporaire', () => {
    expect(executableDeSession({ APPIMAGE: '/home/a/Hive.AppImage' }, '/tmp/.mount_x/hive')).toBe(
      '/home/a/Hive.AppImage',
    );
    expect(executableDeSession({}, '/opt/Hive/hive')).toBe('/opt/Hive/hive');
  });

  it('l’entrée XDG cite un chemin à espaces, et suit `XDG_CONFIG_HOME`', () => {
    expect(fichierAutostart('/opt/Hive/hive')).toContain('Exec=/opt/Hive/hive --session');
    expect(fichierAutostart('/home/a b/Hive.AppImage')).toContain(
      'Exec="/home/a b/Hive.AppImage" --session',
    );
    expect(cheminAutostart({ XDG_CONFIG_HOME: '/cfg' }, '/home/a')).toBe(
      '/cfg/autostart/hive.desktop',
    );
    expect(cheminAutostart({}, '/home/a')).toBe('/home/a/.config/autostart/hive.desktop');
  });
});

describe('le verdict du banc de fumée des paquets', () => {
  const vert: RapportDiagnostic = {
    version: '0.4.0',
    plateforme: 'linux-x64',
    reine: { enLigne: true, origine: REINE },
    sante: { statut: 200, corps: { ok: true } },
    ecran: { url: `${REINE}/#/`, rendu: true, titre: 'Hive — Mission Control' },
    csp: { posee: true, violations: [] },
    apercu: true,
    session: false,
    ouvrieres: 1,
    capture: '/tmp/r.png',
    erreur: null,
  };

  it('un rapport complet est vert', () => {
    expect(defautsDuRapport(vert)).toEqual([]);
  });

  it('chaque manque se nomme', () => {
    const cas: [Partial<RapportDiagnostic>, string][] = [
      [{ reine: { enLigne: false, origine: null } }, 'annoncée'],
      [{ sante: { statut: 500, corps: null } }, '/api/health'],
      [{ sante: { statut: 200, corps: { ok: false } } }, '/api/health'],
      [{ ecran: { url: 'bureau://app/accueil/index.html', rendu: true, titre: null } }, 'origine'],
      [{ ecran: { url: `${REINE}/`, rendu: false, titre: null } }, 'rendu'],
      [{ csp: { posee: false, violations: [] } }, 'CSP'],
      [{ csp: { posee: true, violations: ['script-src eval'] } }, 'violation'],
      [{ capture: null }, 'capture'],
      [{ apercu: false }, 'Aperçu'],
      [{ erreur: 'délai' }, 'délai'],
    ];
    for (const [changement, attendu] of cas) {
      const d = defautsDuRapport({ ...vert, ...changement });
      expect(d.join(' ; '), attendu).toContain(attendu);
    }
  });
});

describe('la page de la fenêtre — décidée sur les faits de l’état (#532)', () => {
  const connecte = { nonConnecte: null };
  const nonConnecte = { nonConnecte: 'lancez `claude` puis `/login`' };
  const base = { erreur: null, origine: REINE, portChange: null, agents: [connecte] };

  it('une erreur montre l’accueil, quelle que soit la route qui y mène', () => {
    const erreur = { titre: 'La Reine s’est arrêtée', lignes: [] };
    // La mort APRÈS une relance : l'origine était déjà nulle, l'écran déjà
    // « oublié » — l'ancienne règle laissait la fenêtre sur une Reine morte.
    for (const montree of [null, REINE]) {
      expect(pageVoulue({ ...base, origine: null, erreur }, montree, false)).toBe('accueil');
      expect(pageVoulue({ ...base, origine: null, erreur }, montree, true)).toBe('accueil');
    }
  });

  it('une Reine annoncée ouvre l’écran une fois ; partie sans erreur, la fenêtre reste', () => {
    expect(pageVoulue(base, null, false)).toBe('ecran');
    expect(pageVoulue(base, REINE, false)).toBeNull();
    expect(pageVoulue({ ...base, origine: null }, REINE, false)).toBeNull();
  });

  it('l’accueil qui a quelque chose à dire garde la fenêtre jusqu’au geste', () => {
    for (const s of [
      { ...base, agents: [] },
      { ...base, agents: [nonConnecte] },
      { ...base, portChange: 40123 },
    ]) {
      expect(pageVoulue(s, null, false), JSON.stringify(s)).toBeNull();
      expect(pageVoulue(s, null, true), JSON.stringify(s)).toBe('ecran');
    }
    // Un agent connecté parmi d'autres : rien qui retienne.
    expect(pageVoulue({ ...base, agents: [nonConnecte, connecte] }, null, false)).toBe('ecran');
    // Une ruche externe n'a pas sondé d'agents : elle s'ouvre.
    expect(pageVoulue({ ...base, agents: null }, null, false)).toBe('ecran');
  });
});
