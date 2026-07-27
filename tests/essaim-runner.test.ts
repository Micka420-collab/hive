// Le runner d'essaim.
//
// C'est le seul endroit du dépôt où la ruche agit sans qu'un humain ait
// cliqué. Les tests portent donc moins sur « est-ce que ça marche » que sur
// « est-ce que ça S'ARRÊTE » : deux interrupteurs en série, un seul cycle à la
// fois, recul exponentiel, pause après cinq échecs, et relecture des
// interrupteurs entre la décision et l'effet.

import { describe, expect, it, vi } from 'vitest';
import {
  CADENCE_MS,
  Cadencier,
  ECHECS_AVANT_PAUSE,
  RECUL_MAX_MS,
  RECUL_MIN_MS,
  agit,
  apresEchec,
  apresSucces,
  doitTourner,
  enPause,
  estUnSucces,
  faireUnTour,
  modeRunnerDepuisEnv,
  recul,
  reprendre,
  suiviNeuf,
} from '../src/orchestrator/essaim-runner.js';
import type {
  ActionsEssaim,
  DependancesRunner,
  ModeRunner,
} from '../src/orchestrator/essaim-runner.js';
import type { Decision, NiveauAutonomie, Pas } from '../src/orchestrator/essaim.js';

const NOW = 1_800_000_000_000;

const decision = (pas: Pas, motif = 'parce que'): Decision => ({
  pas,
  motif,
  gouvernantes: ['a', 'b'],
});

interface Faux {
  deps: DependancesRunner;
  appels: string[];
  evenements: Array<{ type: string; payload: Record<string, unknown> }>;
  mode: { valeur: ModeRunner };
  niveau: { valeur: NiveauAutonomie };
}

function faux(pas: Pas, actions?: ActionsEssaim, horloge?: () => number): Faux {
  const appels: string[] = [];
  const evenements: Array<{ type: string; payload: Record<string, unknown> }> = [];
  const mode = { valeur: 'on' as ModeRunner };
  const niveau = { valeur: 'plein' as NiveauAutonomie };
  const parDefaut: ActionsEssaim = {
    deliberer: async (id) => {
      appels.push(`deliberer:${id}`);
      return 'conseil ouvert';
    },
    planifier: async (id) => {
      appels.push(`planifier:${id}`);
      return 'plan posé';
    },
    corriger: async (id) => {
      appels.push(`corriger:${id}`);
      return 'correctif engagé';
    },
    livrer: async (id) => {
      appels.push(`livrer:${id}`);
      return 'pr ouverte';
    },
    fusionner: async (id) => {
      appels.push(`fusionner:${id}`);
      return 'fusionné';
    },
  };
  return {
    appels,
    evenements,
    mode,
    niveau,
    deps: {
      lireDecision: () => decision(pas),
      lireNiveau: () => niveau.valeur,
      lireMode: () => mode.valeur,
      actions: actions ?? parDefaut,
      emettre: (type, payload) => evenements.push({ type, payload }),
      now: horloge ?? (() => NOW),
    },
  };
}

describe('runner — le commutateur de l’hôte', () => {
  it('est ÉTEINT par défaut', () => {
    // Une fonctionnalité qui dépense de l'argent ne s'active pas par le seul
    // fait d'exister.
    expect(modeRunnerDepuisEnv({})).toBe('off');
  });

  it('ne s’allume que sur « on », exactement', () => {
    expect(modeRunnerDepuisEnv({ HIVE_RUNNER: 'on' })).toBe('on');
    expect(modeRunnerDepuisEnv({ HIVE_RUNNER: ' on ' })).toBe('on');
    // Tout le reste est éteint — y compris ce qui « a l'air » d'un oui.
    for (const v of ['1', 'true', 'yes', 'oui', 'ON', 'off', '']) {
      expect(modeRunnerDepuisEnv({ HIVE_RUNNER: v }), v).toBe('off');
    }
  });
});

describe('runner — quels pas agissent', () => {
  it('les pas d’ARRÊT n’agissent jamais', () => {
    for (const pas of ['inerte', 'halte', 'plafond', 'butiner'] as Pas[]) {
      expect(agit(pas), pas).toBe(false);
    }
  });

  it('les pas de TRAVAIL agissent', () => {
    for (const pas of ['deliberer', 'planifier', 'corriger', 'livrer', 'fusionner'] as Pas[]) {
      expect(agit(pas), pas).toBe(true);
    }
  });
});

describe('runner — la cadence', () => {
  it('un projet neuf peut tourner tout de suite', () => {
    expect(doitTourner(suiviNeuf('p'), NOW)).toBe(true);
  });

  it('un cycle EN VOL bloque le suivant', () => {
    const s = { ...suiviNeuf('p'), enVol: true };
    expect(doitTourner(s, NOW + 10 * CADENCE_MS)).toBe(false);
  });

  it('LA CADENCE SE COMPTE DEPUIS LA FIN, pas depuis le début', () => {
    // Un cycle plus long que la cadence autoriserait sinon le suivant
    // immédiatement — c'est-à-dire exactement quand la ruche peine déjà.
    const fin = NOW + 5 * CADENCE_MS; // cycle très long
    const s = apresSucces({ ...suiviNeuf('p'), enVol: true }, fin);
    expect(doitTourner(s, fin)).toBe(false);
    expect(doitTourner(s, fin + CADENCE_MS - 1)).toBe(false);
    expect(doitTourner(s, fin + CADENCE_MS)).toBe(true);
  });
});

describe('runner — le recul après échec', () => {
  it('double, puis plafonne', () => {
    expect(recul(1)).toBe(RECUL_MIN_MS);
    expect(recul(2)).toBe(2 * RECUL_MIN_MS);
    expect(recul(3)).toBe(4 * RECUL_MIN_MS);
    expect(recul(50)).toBe(RECUL_MAX_MS);
  });

  it('un échec repousse le prochain essai', () => {
    const s = apresEchec(suiviNeuf('p'), NOW);
    expect(s.echecs).toBe(1);
    expect(doitTourner(s, NOW + CADENCE_MS)).toBe(false);
    expect(doitTourner(s, NOW + RECUL_MIN_MS)).toBe(true);
  });

  it('UN SUCCÈS EFFACE L’ARDOISE', () => {
    // Sinon un projet qui a connu quatre échecs il y a une semaine se mettrait
    // en pause au premier accroc suivant.
    let s = suiviNeuf('p');
    for (let i = 0; i < ECHECS_AVANT_PAUSE - 1; i++) s = apresEchec(s, NOW);
    expect(s.echecs).toBe(ECHECS_AVANT_PAUSE - 1);
    s = apresSucces(s, NOW);
    expect(s.echecs).toBe(0);
    expect(s.pasAvant).toBe(0);
  });

  it('APRÈS CINQ ÉCHECS, LA RUCHE CESSE D’Y TOUCHER', () => {
    // Une action qui échoue à coup sûr — dépôt injoignable, quota d'API épuisé
    // — brûlerait le budget en la retentant toute la nuit.
    let s = suiviNeuf('p');
    for (let i = 0; i < ECHECS_AVANT_PAUSE; i++) s = apresEchec(s, NOW);
    expect(enPause(s)).toBe(true);
    // …et le temps ne suffit PAS à lever la pause.
    expect(doitTourner(s, NOW + 365 * 86_400_000)).toBe(false);
  });

  it('seul un GESTE HUMAIN lève la pause', () => {
    let s = suiviNeuf('p');
    for (let i = 0; i < ECHECS_AVANT_PAUSE; i++) s = apresEchec(s, NOW);
    s = reprendre(s);
    expect(enPause(s)).toBe(false);
    expect(doitTourner(s, NOW + CADENCE_MS)).toBe(true);
  });
});

describe('runner — un cycle', () => {
  it('un pas d’ARRÊT est observé et journalisé, pas exécuté', () => {
    // Une ruche qui se tait parce qu'elle a halté doit être discernable d'une
    // ruche qui se tait parce que le runner est cassé.
    return (async () => {
      const f = faux('halte');
      const r = await faireUnTour('p', f.deps);
      expect(r.issue).toBe('observe');
      expect(f.appels).toEqual([]);
      expect(f.evenements[0]?.type).toBe('essaim_cycle');
      expect(f.evenements[0]?.payload.pas).toBe('halte');
    })();
  });

  it('un pas de travail appelle SON action, et une seule', async () => {
    const f = faux('livrer');
    const r = await faireUnTour('p1', f.deps);
    expect(r.issue).toBe('agi');
    expect(f.appels).toEqual(['livrer:p1']);
  });

  it('LE GROS BOUTON ROUGE ARRÊTE AVANT L’EFFET', async () => {
    // L'hôte coupe la ruche entre la décision et l'action : rien ne doit
    // partir. Arrêter « au tour suivant » ne serait pas un arrêt.
    const f = faux('fusionner');
    f.deps.lireDecision = () => {
      f.mode.valeur = 'off'; // coupé pile après la décision
      return decision('fusionner');
    };
    const r = await faireUnTour('p', f.deps);
    expect(r.issue).toBe('abandonne');
    expect(f.appels).toEqual([]);
  });

  it('couper l’autonomie DU PROJET arrête aussi avant l’effet', async () => {
    const f = faux('fusionner');
    f.deps.lireDecision = () => {
      f.niveau.valeur = 'off';
      return decision('fusionner');
    };
    const r = await faireUnTour('p', f.deps);
    expect(r.issue).toBe('abandonne');
    expect(f.appels).toEqual([]);
  });

  it('un pas NON BRANCHÉ le dit, au lieu de ne rien faire en silence', async () => {
    // Une ruche qui ne livre pas parce que la livraison n'est pas câblée doit
    // être discernable d'une ruche qui n'a rien à livrer.
    const f = faux('livrer', {}); // aucune action
    const r = await faireUnTour('p', f.deps);
    expect(r.issue).toBe('non_branche');
    expect(r.detail).toMatch(/livrer/);
  });

  it('un pas non branché n’est PAS un échec', () => {
    // Le compter en échec ferait reculer puis mettre en pause un projet
    // parfaitement sain, et l'humain chercherait la panne là où il n'y en a pas.
    expect(
      estUnSucces({ projectId: 'p', pas: 'livrer', issue: 'non_branche', motif: '', detail: '' }),
    ).toBe(true);
    expect(
      estUnSucces({ projectId: 'p', pas: 'livrer', issue: 'echoue', motif: '', detail: 'boum' }),
    ).toBe(false);
  });

  it('UNE ACTION QUI LÈVE NE FAIT PAS TOMBER LA RUCHE', async () => {
    // Une boucle d'autonomie qui remonterait ses exceptions arrêterait la
    // ruche entière au premier dépôt injoignable.
    const f = faux('deliberer', {
      deliberer: () => Promise.reject(new Error('dépôt injoignable')),
    });
    const r = await faireUnTour('p', f.deps);
    expect(r.issue).toBe('echoue');
    expect(r.detail).toBe('dépôt injoignable');
  });

  it('« corriger » reçoit la décision, pas seulement l’identifiant', async () => {
    // Le motif porte la leçon systémique : sans lui, le correctif ne sait pas
    // quoi corriger.
    const vu: Decision[] = [];
    const f = faux('corriger', {
      corriger: async (_id, d) => {
        vu.push(d);
        return 'ok';
      },
    });
    f.deps.lireDecision = () => decision('corriger', 'leçon systémique sur 3 nœuds : ENOENT');
    await faireUnTour('p', f.deps);
    expect(vu[0]?.motif).toMatch(/systémique/);
  });
});

describe('runner — le cadencier', () => {
  it('ne tourne pas quand la ruche de l’hôte est éteinte', async () => {
    const f = faux('deliberer');
    f.mode.valeur = 'off';
    const c = new Cadencier(f.deps);
    expect(await c.tour(['p1'])).toBeNull();
    expect(f.appels).toEqual([]);
  });

  it('UN SEUL PROJET PAR TOUR', async () => {
    // Deux délibérations qui partent ensemble doublent la facture de la
    // minute, et la seconde n'a pas vu ce que la première a décidé.
    const f = faux('deliberer');
    const c = new Cadencier(f.deps);
    await c.tour(['p1', 'p2', 'p3']);
    expect(f.appels).toEqual(['deliberer:p1']);
  });

  it('le projet qui vient de tourner laisse la main au suivant', async () => {
    let t = NOW;
    const f = faux('deliberer', undefined, () => t);
    const c = new Cadencier(f.deps);
    await c.tour(['p1', 'p2']);
    await c.tour(['p1', 'p2']);
    expect(f.appels).toEqual(['deliberer:p1', 'deliberer:p2']);
    // p1 ne repart qu'après la cadence.
    await c.tour(['p1', 'p2']);
    expect(f.appels).toHaveLength(2);
    t += CADENCE_MS;
    await c.tour(['p1', 'p2']);
    expect(f.appels).toEqual(['deliberer:p1', 'deliberer:p2', 'deliberer:p1']);
  });

  it('DEUX TOURS CONCURRENTS NE SE CHEVAUCHENT PAS', async () => {
    // Le tick appelle le cadencier toutes les deux secondes ; un cycle lent
    // doit refuser le suivant plutôt que de doubler.
    let debloquer: (() => void) | null = null;
    const f = faux('deliberer', {
      deliberer: () =>
        new Promise<string>((res) => {
          debloquer = () => res('fait');
        }),
    });
    const c = new Cadencier(f.deps);
    const premier = c.tour(['p1']);
    // Pendant que le premier est en vol, tout autre tour est refusé.
    expect(await c.tour(['p1'])).toBeNull();
    expect(await c.tour(['p2'])).toBeNull();
    debloquer!();
    expect((await premier)?.issue).toBe('agi');
  });

  it('un échec fait reculer, un succès remet à zéro', async () => {
    let t = NOW;
    let casse = true;
    const f = faux('deliberer', {
      deliberer: () => (casse ? Promise.reject(new Error('boum')) : Promise.resolve('ok')),
    });
    f.deps.now = () => t;
    const c = new Cadencier(f.deps);

    await c.tour(['p1']);
    expect(c.suivi('p1').echecs).toBe(1);
    // La cadence seule ne suffit plus : le recul est plus long.
    t += CADENCE_MS;
    expect(await c.tour(['p1'])).toBeNull();

    t += RECUL_MIN_MS;
    casse = false;
    const r = await c.tour(['p1']);
    expect(r?.issue).toBe('agi');
    expect(c.suivi('p1').echecs).toBe(0);
  });

  it('LA PAUSE EST ANNONCÉE, pas silencieuse', async () => {
    // Une ruche qui abandonne un projet doit le dire : sinon on croit qu'elle
    // travaille encore.
    let t = NOW;
    const f = faux('deliberer', { deliberer: () => Promise.reject(new Error('boum')) });
    f.deps.now = () => t;
    const c = new Cadencier(f.deps);
    for (let i = 0; i < ECHECS_AVANT_PAUSE; i++) {
      await c.tour(['p1']);
      t += RECUL_MAX_MS;
    }
    expect(enPause(c.suivi('p1'))).toBe(true);
    expect(f.evenements.some((e) => e.type === 'essaim_pause')).toBe(true);
    // …et plus rien ne part.
    t += 365 * 86_400_000;
    expect(await c.tour(['p1'])).toBeNull();
  });

  it('un geste humain fait repartir un projet en pause', async () => {
    let t = NOW;
    let casse = true;
    const f = faux('deliberer', {
      deliberer: () => (casse ? Promise.reject(new Error('boum')) : Promise.resolve('ok')),
    });
    f.deps.now = () => t;
    const c = new Cadencier(f.deps);
    for (let i = 0; i < ECHECS_AVANT_PAUSE; i++) {
      await c.tour(['p1']);
      t += RECUL_MAX_MS;
    }
    casse = false;
    c.reprendre('p1');
    expect((await c.tour(['p1']))?.issue).toBe('agi');
  });

  it('LE VOL RETOMBE MÊME SUR UNE EXCEPTION INATTENDUE', async () => {
    // Sans le `finally`, la ruche entière resterait figée pour toujours sur
    // une seule exception hors des actions (ici : la lecture de décision).
    const f = faux('deliberer');
    let premier = true;
    f.deps.lireDecision = () => {
      if (premier) {
        premier = false;
        throw new Error('base verrouillée');
      }
      return decision('deliberer');
    };
    const c = new Cadencier(f.deps);
    await expect(c.tour(['p1'])).rejects.toThrow('base verrouillée');
    // La ruche n'est PAS figée : le tour suivant repart.
    expect((await c.tour(['p1']))?.issue).toBe('agi');
  });

  it('un projet oublié ne laisse pas de trace', () => {
    const f = faux('butiner');
    const c = new Cadencier(f.deps);
    c.reprendre('p1');
    expect(c.etat().map((s) => s.projectId)).toEqual(['p1']);
    c.oublier('p1');
    expect(c.etat()).toEqual([]);
  });

  it('l’état est rendu dans un ordre STABLE', () => {
    const f = faux('butiner');
    const c = new Cadencier(f.deps);
    for (const id of ['zeta', 'alpha', 'mu']) c.reprendre(id);
    expect(c.etat().map((s) => s.projectId)).toEqual(['alpha', 'mu', 'zeta']);
  });
});

describe('runner — ce que le journal raconte', () => {
  it('chaque cycle laisse un fait typé, quel qu’en soit le sort', async () => {
    for (const [pas, actions] of [
      ['halte', undefined],
      ['deliberer', undefined],
      ['livrer', {}],
      ['deliberer', { deliberer: () => Promise.reject(new Error('x')) }],
    ] as const) {
      const f = faux(pas as Pas, actions as ActionsEssaim | undefined);
      await faireUnTour('p', f.deps);
      expect(f.evenements.filter((e) => e.type === 'essaim_cycle')).toHaveLength(1);
    }
  });

  it('le journal ne porte JAMAIS le contenu produit, seulement des faits', async () => {
    // Le Journal est lisible par tout membre de la ruche. Y déverser un diff
    // ou un log d'agent en ferait une fuite par inadvertance.
    const f = faux('livrer', {
      livrer: async () => 'pr #12 ouverte',
    });
    await faireUnTour('p', f.deps);
    const p = f.evenements[0]?.payload ?? {};
    expect(Object.keys(p).sort()).toEqual(['detail', 'issue', 'motif', 'pas', 'projectId']);
    expect(String(p.detail).length).toBeLessThan(200);
  });
});

describe('runner — vi n’est pas nécessaire, mais l’horloge est injectable', () => {
  it('aucun appel à Date.now n’échappe au cadencier', async () => {
    // Une horloge implicite rendrait le module intestable et le rejeu
    // impossible : on vérifie que l'injection est réellement branchée.
    const espion = vi.fn(() => NOW);
    const f = faux('butiner');
    f.deps.now = espion;
    const c = new Cadencier(f.deps);
    await c.tour(['p1']);
    expect(espion).toHaveBeenCalled();
  });
});
