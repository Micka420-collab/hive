// @vitest-environment happy-dom
//
// HIVE STUDIO — LES MODULES PURS DE LA COQUILLE, chacun sur son banc.
//
// ─── POURQUOI CES BANCS EXISTENT ─────────────────────────────────────────────
//
// La coquille de Hive Studio (#579) affiche des FAITS : la mission en cours,
// ce que font les agents, ce qui attend une décision. Chaque fait est calculé
// par un module pur (`dashboard/src/studio/*.ts`) avant d'être peint. Ces
// bancs tiennent les règles qui empêchent l'écran de mentir :
//
//   · aucune page existante ne sort du rail (navigation ↔ `NAV` d'App.tsx) ;
//   · une mission ne compte que les tâches de SON projet, jamais les ombres ;
//   · une préférence illisible n'est jamais crue ;
//   · le voyant d'IA garde les mots du bandeau historique ;
//   · la palette trouve une page par son ANCIEN nom (« Miellerie »).

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { activiteRecente, ilYA, itemDe } from '../dashboard/src/studio/activite';
import { cartesAgents, etatAgent, initiales } from '../dashboard/src/studio/agents-vue';
import { etapesGuide } from '../dashboard/src/studio/ColonneDroite';
import { idsUniques } from '../dashboard/src/studio/Composeur';
import { lireConversation } from '../dashboard/src/studio/conversation';
import { titreOnglet } from '../dashboard/src/studio/EnteteSection';
import { validationsEnVue } from '../dashboard/src/studio/EspaceTravail';
import {
  compteDuResume,
  compterTaches,
  enVol,
  missionCourante,
  pourcentage,
  titreMission,
} from '../dashboard/src/studio/mission-courante';
import type { MissionLue } from '../dashboard/src/studio/mission-courante';
import {
  ongletsDe,
  SECTIONS,
  sectionDeVue,
  VUES_ADMIN,
  vueDeSection,
} from '../dashboard/src/studio/navigation';
import { entreesPalette } from '../dashboard/src/studio/Palette';
import {
  ajouterBrief,
  lireBooleen,
  lireBriefs,
  lireGuide,
  lireListe,
  lirePartage,
  lireTheme,
  themeApplique,
} from '../dashboard/src/studio/preferences';
import { projetParDefaut, resoudreProjetActif } from '../dashboard/src/studio/projet-actif';
import { aPlat, normaliser, rechercher, scoreTexte } from '../dashboard/src/studio/recherche';
import type { EntreePalette } from '../dashboard/src/studio/recherche';
import { etatLiaison, motIA, titreIA } from '../dashboard/src/studio/Topbar';
import { salutation } from '../dashboard/src/views/Studio';
import type { ViewId } from '../dashboard/src/views/shared';
import type { HiveEvent, HiveNode, Project, Task } from '../src/shared/types';

const fr = (f: string) => f;
const en = (_f: string, e: string) => e;

function tache(p: Partial<Task> & Pick<Task, 'id'>): Task {
  return {
    projectId: 'p1',
    title: `Tâche ${p.id}`,
    prompt: 'x',
    status: 'pending',
    dependsOn: [],
    assignedNodeId: null,
    result: null,
    branch: null,
    attempts: 0,
    createdAt: 1_000,
    updatedAt: 1_000,
    ...p,
  } as Task;
}

function projet(p: Partial<Project> & Pick<Project, 'id'>): Project {
  return { name: `Projet ${p.id}`, repoUrl: null, createdAt: 1, ...p } as unknown as Project;
}

function noeud(p: Partial<HiveNode> & Pick<HiveNode, 'id'>): HiveNode {
  return {
    name: p.id,
    ownerName: 'moi',
    agentType: 'claude-code',
    maxConcurrency: 2,
    running: 0,
    status: 'online',
    lastSeen: 1,
    ...p,
  } as HiveNode;
}

/** Les pages déclarées par `NAV`, LUES DANS LA SOURCE — comme les autres gardes. */
function pagesDeNav(): string[] {
  // `process.cwd()` et non `new URL(…, import.meta.url)` : sous happy-dom, `URL` est
  // celle du navigateur simulé, qui ne connaît pas le schéma `file:`.
  const src = readFileSync(path.join(process.cwd(), 'dashboard/src/App.tsx'), 'utf8');
  const bloc = src.slice(src.indexOf('const NAV: NavItem[] = ['), src.indexOf('\n];'));
  return [...bloc.matchAll(/id:\s*'([a-z]+)'/g)].map((m) => m[1]!);
}

describe('la navigation : sept sections, et chaque page y a sa place', () => {
  it('le relevé lit bien les pages de NAV — sinon tout ce qui suit est creux', () => {
    expect(pagesDeNav().length).toBeGreaterThan(12);
  });

  it('CHAQUE PAGE DE NAV EST RANGÉE DANS UNE SECTION — aucune ne sort du rail', () => {
    const rangees = new Set(SECTIONS.flatMap((s) => s.vues));
    const orphelines = pagesDeNav().filter((v) => !rangees.has(v as ViewId));
    expect(orphelines, 'page(s) sans section : atteignables seulement par leur URL').toEqual([]);
  });

  it('…et AUCUNE SECTION NE RANGE UNE PAGE INCONNUE (hors la Chambre, sans onglet)', () => {
    const nav = new Set(pagesDeNav());
    const inconnues = SECTIONS.flatMap((s) => s.vues).filter((v) => !nav.has(v) && v !== 'chambre');
    expect(inconnues).toEqual([]);
  });

  it('UNE PAGE N’EST RANGÉE QU’UNE FOIS', () => {
    const toutes = SECTIONS.flatMap((s) => s.vues);
    expect(new Set(toutes).size).toBe(toutes.length);
  });

  it('les sept sections de la maquette, dans son ordre', () => {
    expect(SECTIONS.map((s) => s.id)).toEqual([
      'accueil',
      'projets',
      'missions',
      'agents',
      'equipe',
      'automatisations',
      'marketplace',
    ]);
  });

  it('une page inconnue retombe sur l’accueil ; une section ouvre sa première page', () => {
    expect(sectionDeVue('miellerie')).toBe('missions');
    expect(sectionDeVue('inconnue' as ViewId)).toBe('accueil');
    expect(vueDeSection('missions')).toBe('ruche');
    expect(vueDeSection('accueil')).toBe('studio');
  });

  it('LES ONGLETS D’ADMINISTRATION NE S’OFFRENT QU’AUX ADMINS — sauf à qui y est déjà', () => {
    expect(ongletsDe('essaim', false)).not.toContain('cerveau');
    expect(ongletsDe('essaim', true)).toContain('cerveau');
    // Un admin arrivé par son signet AVANT que la session ne réponde garde
    // l'onglet de la page où il est.
    expect(ongletsDe('cerveau', false)).toContain('cerveau');
    for (const v of VUES_ADMIN) expect(ongletsDe(sectionVue(v), false)).not.toContain(v);
  });

  it('LA CHAMBRE N’A D’ONGLET QUE QUAND ON Y EST', () => {
    expect(ongletsDe('essaim', true)).not.toContain('chambre');
    expect(ongletsDe('chambre', false)).toContain('chambre');
  });
});

/** Une page de la même section que `v`, autre que `v`. */
function sectionVue(v: ViewId): ViewId {
  return SECTIONS.find((s) => s.vues.includes(v))!.vues.find((x) => x !== v)!;
}

describe('les préférences : une valeur illisible n’est jamais crue', () => {
  it('le thème : sombre par défaut, et rien d’autre que les trois choix', () => {
    expect(lireTheme(null)).toBe('sombre');
    expect(lireTheme('clair')).toBe('clair');
    expect(lireTheme('auto')).toBe('auto');
    expect(lireTheme('fuchsia')).toBe('sombre');
    expect(themeApplique('auto', true)).toBe('sombre');
    expect(themeApplique('auto', false)).toBe('clair');
    expect(themeApplique('clair', true)).toBe('clair');
  });

  it('les booléens et le guide', () => {
    expect(lireBooleen('1', false)).toBe(true);
    expect(lireBooleen('0', true)).toBe(false);
    expect(lireBooleen('oui', true)).toBe(true);
    expect(lireGuide('ignore')).toBe('ignore');
    expect(lireGuide('n’importe quoi')).toBe('nouveau');
  });

  it('une liste : uniques, non vides, bornée — et du JSON cassé vaut vide', () => {
    expect(lireListe('["a","a","",3,"b"]')).toEqual(['a', 'b']);
    expect(lireListe('{"a":1}')).toEqual([]);
    expect(lireListe('[pas du json')).toEqual([]);
    expect(lireListe(JSON.stringify(['a', 'b', 'c']), 2)).toEqual(['a', 'b']);
  });

  it('le partage des panneaux est borné à [0,3 ; 0,7]', () => {
    expect(lirePartage(null)).toBe(0.5);
    expect(lirePartage('0.1')).toBe(0.3);
    expect(lirePartage('0.9')).toBe(0.7);
    expect(lirePartage('NaN')).toBe(0.5);
  });

  it('les briefs : un objet de chaînes, rien d’autre ; ajouter garde les plus récents', () => {
    expect(lireBriefs('{"t1":"faire","t2":3}')).toEqual({ t1: 'faire' });
    expect(lireBriefs('["t1"]')).toEqual({});
    const b = ajouterBrief({ a: 'vieux', b: 'autre' }, ['c', 'd'], 'neuf', 3);
    expect(Object.keys(b)).toEqual(['b', 'c', 'd']);
    expect(b.c).toBe('neuf');
  });
});

describe('la recherche de la palette', () => {
  it('normalise accents, casse et espaces', () => {
    expect(normaliser('  Équipe   ROUGE ')).toBe('equipe rouge');
  });

  it('classe : exact > préfixe > début de mot > inclusion > tous les mots', () => {
    expect(scoreTexte('Validation', 'validation')).toBe(100);
    expect(scoreTexte('Validation des diffs', 'valid')).toBe(80);
    expect(scoreTexte('Les diffs validés', 'diffs')).toBe(60);
    expect(scoreTexte('Revalidation', 'valid')).toBe(40);
    expect(scoreTexte('tests du parseur', 'parseur tests')).toBe(30);
    expect(scoreTexte('Santé', 'zzz')).toBe(0);
  });

  it('groupe dans l’ordre fixe, borne chaque groupe, et départage par la récence', () => {
    const e = (id: string, groupe: EntreePalette['groupe'], titre: string, recence = 0) => ({
      id,
      groupe,
      titre,
      recence,
      action: id,
    });
    const groupes = rechercher(
      [
        e('v1', 'vues', 'Projets'),
        e('p1', 'projets', 'Projet A', 1),
        e('p2', 'projets', 'Projet B', 9),
        e('c1', 'commandes', 'Nouveau projet'),
      ],
      'projet',
      1,
    );
    expect(groupes.map((g) => g.groupe)).toEqual(['commandes', 'projets', 'vues']);
    expect(groupes[1]!.entrees.map((x) => x.id)).toEqual(['p2']);
    expect(aPlat(groupes).map((x) => x.id)).toEqual(['c1', 'p2', 'v1']);
  });
});

describe('le projet actif', () => {
  const a = projet({ id: 'a', createdAt: 10 });
  const b = projet({ id: 'b', createdAt: 20 });

  it('sans choix : la dernière activité, puis la création la plus récente', () => {
    expect(projetParDefaut([a, b], [])?.id).toBe('b');
    expect(projetParDefaut([a, b], [tache({ id: 't', projectId: 'a', updatedAt: 99 })])?.id).toBe(
      'a',
    );
    expect(projetParDefaut([], [])).toBeNull();
  });

  it('un choix qui n’existe plus (supprimé, illisible) n’est jamais cru', () => {
    expect(resoudreProjetActif('a', [a, b], [])?.id).toBe('a');
    expect(resoudreProjetActif('disparu', [a, b], [])?.id).toBe('b');
  });
});

describe('la mission en cours', () => {
  const sansRevue = () => false;

  it('sans liste de la Reine : seulement ce qui VOLE, du projet, sans les ombres', () => {
    const m = missionCourante({
      projectId: 'p1',
      taches: [
        tache({ id: 'a', status: 'running' }),
        tache({ id: 'b', status: 'done' }),
        tache({ id: 'c', status: 'pending', projectId: 'p2' }),
        tache({ id: 'd', status: 'pending', ombre: true }),
      ],
      missions: null,
      iaEnLigne: true,
      aRevoir: sansRevue,
    });
    expect(m.etat).toBe('en_cours');
    expect(m.taches.map((x) => x.id)).toEqual(['a']);
    expect(m.statut).toBe('execution');
    expect(m.source).toBe('instantane');
  });

  it('rien ne vole et pas de liste : AUCUNE mission — on ne la reconstruit pas sur des dates', () => {
    const m = missionCourante({
      projectId: 'p1',
      taches: [tache({ id: 'b', status: 'done' })],
      missions: null,
      iaEnLigne: true,
      aRevoir: sansRevue,
    });
    expect(m.etat).toBe('aucune');
    expect(m.statut).toBeNull();
  });

  it('des tâches en file sans IA en ligne : « en attente d’un agent », pas « en exécution »', () => {
    const base = {
      projectId: 'p1',
      taches: [tache({ id: 'a', status: 'pending' })],
      missions: null,
      aRevoir: sansRevue,
    };
    expect(missionCourante({ ...base, iaEnLigne: false }).statut).toBe('attente_agent');
    expect(missionCourante({ ...base, iaEnLigne: true }).statut).toBe('attente');
  });

  it('la mission OUVERTE de la Reine fait foi : son compte, ses dates', () => {
    const ouverte: MissionLue = {
      id: 'm1',
      ouverteA: 5_000,
      closeA: null,
      resume: { taches: { done: 2, running: 1, pending: 1, failed: 0 } },
    } as unknown as MissionLue;
    const m = missionCourante({
      projectId: 'p1',
      taches: [
        tache({ id: 'vieille', status: 'done', createdAt: 100, updatedAt: 200 }),
        tache({ id: 'a', status: 'done', createdAt: 5_000, updatedAt: 6_000 }),
        tache({ id: 'b', status: 'running', createdAt: 5_000, updatedAt: 6_000 }),
      ],
      missions: [ouverte],
      iaEnLigne: true,
      aRevoir: sansRevue,
    });
    expect(m.etat).toBe('en_cours');
    expect(m.missionId).toBe('m1');
    expect(m.taches.map((x) => x.id)).toEqual(['a', 'b']);
    expect(m.compte).toEqual({ total: 4, faites: 2, enCours: 1, enAttente: 1, echouees: 0 });
    expect(m.source).toBe('reine');
  });

  it('une mission CLOSE : réussie, en échec, ou à valider — jamais « en cours »', () => {
    const close = (resume: Record<string, number>) =>
      ({
        id: 'm',
        ouverteA: 1_000,
        closeA: 9_000,
        resume: { taches: resume },
      }) as unknown as MissionLue;
    const taches = [tache({ id: 'a', status: 'done', createdAt: 1_000, updatedAt: 2_000 })];
    const voir = (m: MissionLue, aRevoir: (t: Task) => boolean) =>
      missionCourante({ projectId: 'p1', taches, missions: [m], iaEnLigne: true, aRevoir });
    expect(voir(close({ done: 1 }), sansRevue).statut).toBe('reussie');
    expect(voir(close({ done: 1 }), () => true).statut).toBe('a_valider');
    const echec = missionCourante({
      projectId: 'p1',
      taches: [tache({ id: 'a', status: 'failed', createdAt: 1_000, updatedAt: 2_000 })],
      missions: [close({ failed: 1 })],
      iaEnLigne: true,
      aRevoir: sansRevue,
    });
    expect(echec.etat).toBe('terminee');
    expect(echec.statut).toBe('echouee');
  });

  it('les comptes : annulée = échouée ; un résumé vide est illisible', () => {
    expect(compteDuResume({ taches: { cancelled: 2, done: 1 } } as never)).toEqual({
      total: 3,
      faites: 1,
      enCours: 0,
      enAttente: 0,
      echouees: 2,
    });
    expect(compteDuResume({ taches: {} } as never)).toBeNull();
    expect(compterTaches([{ status: 'assigned' }, { status: 'ready' }]).enCours).toBe(1);
    expect(enVol({ status: 'ready' })).toBe(true);
    expect(enVol({ status: 'done' })).toBe(false);
  });

  it('le pourcentage est un compte arrondi, et rien sans tâche', () => {
    expect(pourcentage({ total: 0, faites: 0, enCours: 0, enAttente: 0, echouees: 0 })).toBeNull();
    expect(pourcentage({ total: 3, faites: 2, enCours: 1, enAttente: 0, echouees: 0 })).toBe(67);
  });

  it('le titre : le brief lancé d’ici, sinon la première tâche', () => {
    const m = { taches: [tache({ id: 'a', title: 'Socle' }), tache({ id: 'b' })] };
    expect(titreMission(m, {})).toBe('Socle');
    expect(titreMission(m, { b: 'Ajoute le paiement' })).toBe('Ajoute le paiement');
    expect(titreMission({ taches: [] }, {})).toBeNull();
  });
});

describe('l’activité de la colonne', () => {
  const taches = [tache({ id: 't1', title: 'Parseur', projectId: 'p1' })];
  const ev = (id: number, type: string, payload: Record<string, unknown>): HiveEvent =>
    ({ id, ts: id * 1000, type, payload }) as HiveEvent;

  it('une fin de tâche se dit avec le TITRE de la tâche, et mène à elle', () => {
    const c = { taches: new Map(taches.map((x) => [x.id, x])), noeuds: new Map(), t: fr };
    expect(itemDe(ev(1, 'task_done', { taskId: 't1' }), c)).toEqual({
      genre: 'succes',
      texte: '« Parseur » terminée',
      tacheId: 't1',
    });
    expect(itemDe(ev(2, 'task_progress', { taskId: 't1' }), c)).toBeNull();
    expect(itemDe(ev(3, 'task_reviewed', { taskId: 't1', state: null }), c)).toBeNull();
  });

  it('le projet actif filtre : ses faits et ceux de la ruche, JAMAIS ceux d’un autre projet', () => {
    const events = [
      ev(1, 'node_online', { name: 'poste-a' }),
      ev(2, 'task_done', { taskId: 't1' }),
      ev(3, 'mission_ouverte', { projectId: 'p2', taches: 3 }),
      ev(4, 'mission_close', { projectId: 'p1', reussie: true }),
    ];
    const items = activiteRecente(events, taches, [], fr, { projetId: 'p1', limite: 10 });
    expect(items.map((i) => i.id)).toEqual([4, 2, 1]);
    expect(items[0]!.texte).toBe('Mission terminée avec succès');
  });

  it('« confiée » ne se dit qu’une fois par tâche', () => {
    const events = [
      ev(1, 'task_assigned', { taskId: 't1', nodeId: 'n1' }),
      ev(2, 'task_started', { taskId: 't1', nodeId: 'n1' }),
    ];
    expect(activiteRecente(events, taches, [noeud({ id: 'n1', name: 'poste' })], fr)).toHaveLength(
      1,
    );
  });

  it('l’heure relative', () => {
    expect(ilYA(1_000, 1_000 + 30_000, fr)).toMatch(/instant|s/);
    expect(ilYA(0, 5 * 60_000, en)).toMatch(/5/);
  });
});

describe('les cartes d’agents', () => {
  it('le rôle affiché est l’OUTIL déclaré — aucun rôle inventé', () => {
    const [c] = cartesAgents([noeud({ id: 'n1', agentType: 'codex' })], []);
    expect(c!.outil).toBe('Codex');
    expect(c!.tache).toBeNull();
  });

  it('la tâche tenue est la plus récente en vol ; la charge ne ment pas par défaut', () => {
    const cartes = cartesAgents(
      [noeud({ id: 'n1', running: 0, maxConcurrency: 1 })],
      [
        tache({ id: 'a', status: 'running', assignedNodeId: 'n1', updatedAt: 5 }),
        tache({
          id: 'b',
          status: 'assigned',
          assignedNodeId: 'n1',
          updatedAt: 9,
          title: 'Récente',
        }),
      ],
    );
    expect(cartes[0]!.tache?.titre).toBe('Récente');
    expect(cartes[0]!.actives).toBe(2);
    expect(etatAgent(cartes[0]!)).toBe('plein');
  });

  it('en ligne d’abord, le simulé après les vraies IA', () => {
    const noms = cartesAgents(
      [
        noeud({ id: 'z', name: 'z', status: 'offline' }),
        noeud({ id: 's', name: 's', agentType: 'shell' }),
        noeud({ id: 'c', name: 'c' }),
      ],
      [],
    ).map((x) => x.id);
    expect(noms).toEqual(['c', 's', 'z']);
  });

  it('des initiales, jamais une photo inventée', () => {
    expect(initiales('Micka Delcato')).toBe('MD');
    expect(initiales('hive')).toBe('HI');
    expect(initiales('***')).toBe('?');
  });
});

describe('la conversation rangée dans l’onglet', () => {
  it('ne relit que des messages bien formés, et seulement les 60 derniers', () => {
    const bons = Array.from({ length: 70 }, (_, i) => ({
      id: String(i),
      role: i % 2 ? 'moi' : 'reine',
      texte: 't',
      ts: i,
    }));
    expect(lireConversation(JSON.stringify(bons))).toHaveLength(60);
    expect(lireConversation('[{"role":"pirate","texte":"x","id":"1","ts":1}]')).toEqual([]);
    expect(lireConversation('{cassé')).toEqual([]);
  });
});

describe('le plan lancé depuis l’accueil', () => {
  it('rend des identifiants UNIQUES et remappe les dépendances', () => {
    const taches = idsUniques(
      [
        { title: 'Socle', prompt: 'a', id: 'socle' },
        { title: 'Tests', prompt: 'b', id: 'tests', dependsOn: ['socle', 'externe'] },
      ],
      'k1',
    );
    expect(taches.map((x) => x.id)).toEqual(['socle-k1', 'tests-k1']);
    expect(taches[1]!.dependsOn).toEqual(['socle-k1', 'externe']);
  });
});

describe('les voyants de la barre', () => {
  it('la liaison : un jeton refusé l’emporte ; « trop lent » se dit « reconnexion »', () => {
    expect(etatLiaison(true, true, false)).toBe('refuse');
    expect(etatLiaison(true, false, false)).toBe('connecte');
    expect(etatLiaison(false, false, true)).toBe('reconnexion');
    expect(etatLiaison(false, false, false)).toBe('hors_ligne');
  });

  it('l’IA : les MOTS du bandeau historique, et la commande à taper dans le cas rouge', () => {
    expect(motIA('reelle', ['Claude Code', 'Codex'], fr)).toBe('Claude Code · Codex');
    expect(motIA('simulee', [], fr)).toBe('simulé — aucune IA');
    expect(motIA('aucune_ia', [], fr)).toBe('aucune ouvrière en ligne');
    expect(motIA('aucun_noeud', [], en)).toBe('no worker');
    expect(titreIA('aucun_noeud', fr)).toContain('npm run node');
  });

  it('un onglet garde son ANCIEN nom en infobulle, et sa touche', () => {
    const v = {
      id: 'miellerie' as const,
      label: 'Validation',
      labelEn: 'Review',
      ancien: 'Miellerie',
      ancienEn: 'Honey House',
      key: '3',
    };
    expect(titreOnglet(v, false)).toBe('Validation — ex-Miellerie (touche 3)');
    expect(titreOnglet(v, true)).toBe('Review — formerly Honey House (key 3)');
    expect(titreOnglet({ id: 'chambre', label: 'Chambre', labelEn: 'Room', key: '' }, false)).toBe(
      'Chambre',
    );
  });
});

describe('l’accueil', () => {
  it('« Bonjour » le jour, « Bonsoir » le soir, et le prénom seulement', () => {
    expect(salutation(9, 'Micka Delcato', fr)).toBe('Bonjour Micka');
    expect(salutation(20, null, fr)).toBe('Bonsoir');
    expect(salutation(3, '  ', en)).toBe('Good evening');
  });

  it('le guide se coche sur des FAITS de la ruche, pas sur des clics', () => {
    expect(etapesGuide([], [], [])).toEqual({ projet: false, agent: false, mission: false });
    const e = etapesGuide(
      [projet({ id: 'a' })],
      [noeud({ id: 'n', agentType: 'shell' })],
      [tache({ id: 't', ombre: true })],
    );
    // Un shell n'est pas une IA ; une tâche d'ombre n'est pas une mission.
    expect(e).toEqual({ projet: true, agent: false, mission: false });
    expect(etapesGuide([], [noeud({ id: 'n' })], [tache({ id: 't' })]).agent).toBe(true);
  });
});

describe('la palette', () => {
  const vues = [
    {
      id: 'miellerie' as const,
      label: 'Validation',
      labelEn: 'Review',
      ancien: 'Miellerie',
      ancienEn: 'Honey House',
      key: '3',
    },
  ];
  const base = {
    mode: 'tout' as const,
    commandes: [
      { id: 'x', titre: 'Nouvelle mission', icone: 'etincelles' as const, faire: () => {} },
    ],
    vues,
    projets: [projet({ id: 'p1', name: 'NextendoDrop' })],
    taches: [tache({ id: 't1', title: 'Corriger le parseur' }), tache({ id: 'o', ombre: true })],
    noeuds: [noeud({ id: 'n1', name: 'poste-micka' })],
    onNavigate: () => {},
    onOuvrirTache: () => {},
    onChoisirProjet: () => {},
  };

  it('« Miellerie » trouve toujours la validation — l’ancien nom n’est pas perdu', () => {
    const groupes = rechercher(entreesPalette(base, false), 'miellerie');
    expect(aPlat(groupes).map((e) => e.id)).toContain('v:miellerie');
  });

  it('les tâches d’ombre ne s’y cherchent pas ; le mode « actions » ne liste que des actions', () => {
    const ids = entreesPalette(base, false).map((e) => e.id);
    expect(ids).toContain('t:t1');
    expect(ids).not.toContain('t:o');
    expect(entreesPalette({ ...base, mode: 'commandes' }, false).map((e) => e.groupe)).toEqual([
      'commandes',
    ]);
  });
});

describe('le responsive de la coquille', () => {
  // ─── CE QUE LA MESURE A TROUVÉ, ET CE QUI LE TIENT ─────────────────────────
  //
  // Mesuré sur la démo, de 320 à 1440 px : la barre se chevauchait sous 768 px
  // (le bouton du projet plafonné à 150 px dans une boîte de 43), le tiroir
  // fermé gardait ses liens dans l'ordre de tabulation, l'espace de travail
  // s'empilait sur la FENÊTRE (à 1024 px, le code passait sous le pli), et huit
  // cartes de validation faisaient trois mille pixels de téléphone. Ces bancs
  // tiennent les règles qui l'ont corrigé.
  const css = readFileSync(path.join(process.cwd(), 'dashboard/src/studio/studio.css'), 'utf8');
  const bloc768 = css.slice(css.indexOf('@media (max-width: 768px)'));

  it('TROIS VALIDATIONS EN VUE, les autres sur demande — et toutes quand on le demande', () => {
    const sept = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
    expect(validationsEnVue(sept, false)).toEqual({ vues: ['a', 'b', 'c'], repliees: 4 });
    expect(validationsEnVue(sept, true)).toEqual({ vues: sept, repliees: 0 });
    expect(validationsEnVue(['a', 'b'], false)).toEqual({ vues: ['a', 'b'], repliees: 0 });
    expect(validationsEnVue([], false)).toEqual({ vues: [], repliees: 0 });
  });

  it('LE TIROIR FERMÉ SORT DE L’ORDRE DU FOCUS — caché, visible seulement ouvert', () => {
    expect(bloc768).toMatch(
      /> \.hs-rail \{[^}]*transform: translateX\(-105%\);[^}]*visibility: hidden;/,
    );
    expect(bloc768).toMatch(/data-rail-mobile='ouvert'\] > \.hs-rail \{[^}]*visibility: visible;/);
  });

  it('L’ESPACE S’EMPILE SELON SA PLACE (conteneur), plus selon la fenêtre', () => {
    expect(css).toMatch(/\.hs-studio \{\s*container: studio \/ inline-size;/);
    expect(css).toMatch(
      /@container studio \(max-width: \d+px\) \{\s*\.hs-espace \{[^}]*grid-template-columns: minmax\(0, 1fr\);/,
    );
    const medias = [...css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)].map((m) => m[1] ?? '');
    expect(
      medias.some((b) => /\.hs-espace \{[^}]*grid-template-columns: minmax\(0, 1fr\)/.test(b)),
      'une règle de FENÊTRE empile encore l’espace',
    ).toBe(false);
  });

  it('SOUS 768 PX, LE PROJET PREND CE QUI RESTE — sans plafond fixe qui déborde', () => {
    expect(bloc768).toMatch(/\.hs-selecteur \{\s*flex: 1 1 0;/);
    expect(bloc768).not.toMatch(/\.hs-selecteur-btn \{\s*max-width: \d+px;/);
  });

  it('LE PLANCHER WCAG 2.5.8 : 24 px pour les liens-boutons, les bascules et les champs', () => {
    expect(css).toMatch(/button\.hs-lien:not\(p \*\),[^{]*\{\s*min-height: 24px;/);
  });

  it('LES MOTS QUI SE REPLIENT GARDENT LEUR NOM ACCESSIBLE', () => {
    const compte = readFileSync(path.join(process.cwd(), 'dashboard/src/AccountPanel.tsx'), 'utf8');
    expect(compte).toMatch(/aria-label=\{t\('Se connecter', 'Sign in'\)\}/);
    // « + Projet » est caché VISUELLEMENT sur téléphone, jamais retiré.
    const repli = css.slice(css.indexOf('.hs-nouveau-projet-mot {'));
    expect(repli).toMatch(/clip-path: inset\(50%\)/);
    expect(repli.slice(0, 200)).not.toMatch(/display: none/);
  });
});
