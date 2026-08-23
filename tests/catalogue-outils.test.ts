// Le catalogue des outils IA — et les sentinelles qui l'empêchent de mentir.
//
// ─── CE QUE CES BANCS DÉFENDENT VRAIMENT ─────────────────────────────────────
//
// Un catalogue de capacités est un document qui se périme tout seul. Quelqu'un
// retire `ctx.modele` d'un adaptateur ; la déclaration continue d'annoncer
// `modeleChoisi: true` ; la Reine choisit cet agent POUR sa capacité à honorer
// un modèle, et le modèle est ignoré en silence.
//
// Les bancs de forme ci-dessous ne suffiraient pas : ils vérifieraient que le
// catalogue est cohérent AVEC LUI-MÊME. Les sentinelles, elles, le confrontent
// au CODE des adaptateurs — c'est-à-dire à la seule chose qui décide.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  direNiveau,
  NIVEAUX,
  OUTILS,
  outil,
  outilsExecutants,
  outilsInstallables,
  rangNiveau,
} from '../src/shared/catalogue-outils.js';

function sourceAdaptateur(id: string): string | null {
  try {
    return readFileSync(new URL(`../src/adapters/${id}.ts`, import.meta.url), 'utf8');
  } catch {
    return null;
  }
}

describe('la forme du catalogue', () => {
  it('aucun identifiant en double', () => {
    const ids = OUTILS.map((o) => o.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('il est gelé — personne ne le modifie à chaud', () => {
    expect(Object.isFrozen(OUTILS)).toBe(true);
  });

  it('`outil()` retrouve par identifiant, et rend `undefined` pour un inconnu', () => {
    expect(outil('claude-code')?.nom).toBe('Claude Code');
    expect(outil('un-outil-qui-n-existe-pas')).toBeUndefined();
  });

  it('les niveaux sont ORDONNÉS, du moins au plus intégré', () => {
    expect(rangNiveau('detecte')).toBe(0);
    expect(rangNiveau('orchestre')).toBe(NIVEAUX.length - 1);
    for (let i = 1; i < NIVEAUX.length; i++) {
      expect(rangNiveau(NIVEAUX[i]!)).toBeGreaterThan(rangNiveau(NIVEAUX[i - 1]!));
    }
  });

  it('chaque niveau a sa propre phrase, dans chaque langue', () => {
    const fr = NIVEAUX.map((n) => direNiveau(n));
    const en = NIVEAUX.map((n) => direNiveau(n, 'en'));
    expect(new Set(fr).size, 'deux niveaux se diraient pareil en français').toBe(NIVEAUX.length);
    expect(new Set(en).size, 'deux niveaux se diraient pareil en anglais').toBe(NIVEAUX.length);
  });

  it('l’anglais n’est pas le français déguisé', () => {
    // Le premier jet exigeait que CHAQUE niveau diffère d'une langue à l'autre.
    // La suite a eu raison contre lui : « configurable » est le même mot des
    // deux côtés, et le forcer aurait déformé la traduction pour satisfaire un
    // banc. Ce qu'il faut vraiment attraper est plus étroit — quelqu'un qui
    // brancherait `en` sur la table `fr` rendrait TOUT identique.
    const identiques = NIVEAUX.filter((n) => direNiveau(n) === direNiveau(n, 'en'));
    expect(
      identiques.length,
      'toutes les phrases coïncident : la table anglaise est probablement la française',
    ).toBeLessThan(NIVEAUX.length);
  });
});

describe('l’honnêteté du catalogue', () => {
  it('un outil qui n’exécute pas ne prétend RIEN d’autre', () => {
    // La règle qui empêche un « à moitié intégré » de se faire passer pour un
    // agent. Sans exécution, aucune autre capacité n'a de sens.
    for (const o of OUTILS.filter((x) => !x.capacites.executionTache)) {
      expect(o.capacites.productionReelle, `${o.id}`).toBe(false);
      expect(o.capacites.sousAgents, `${o.id}`).toBe(false);
      expect(o.capacites.modeleChoisi, `${o.id}`).toBe(false);
      expect(rangNiveau(o.niveau), `${o.id} ne peut pas dépasser « connecté »`).toBeLessThan(
        rangNiveau('execute'),
      );
    }
  });

  it('un outil qu’on ne sait pas piloter DIT pourquoi', () => {
    for (const o of OUTILS.filter((x) => !x.capacites.executionTache)) {
      expect(o.limite, `${o.id} doit expliquer sa limite`).toBeTruthy();
    }
  });

  it('Windsurf est déclaré non pilotable — le cas qui justifie le champ', () => {
    const w = outil('windsurf')!;
    expect(w.capacites.executionTache).toBe(false);
    expect(w.niveau).toBe('detecte');
    expect(w.limite).toContain('MCP');
  });

  it('`shell` exécute mais ne produit RIEN de réel', () => {
    const s = outil('shell')!;
    expect(s.capacites.executionTache).toBe(true);
    expect(s.capacites.productionReelle).toBe(false);
    expect(outilsExecutants().map((o) => o.id)).toContain('shell');
  });

  it('tout paquet installable porte une portée npm, sauf `cline` qui n’en a pas', () => {
    // `cline` s'installe par `npm i -g cline`, sans portée — c'est son nom
    // publié, vérifié sur sa documentation. On ne l'invente pas, et on ne le
    // refuse pas au nom d'une règle que le registre ne suit pas.
    for (const o of outilsInstallables()) {
      const nom = o.installation![o.installation!.length - 1]!;
      if (o.id === 'cline') expect(nom).toBe('cline');
      else expect(nom, `${o.id}`).toMatch(/^@[^/]+\/[^/]+$/);
    }
  });

  it('aucune commande d’installation ne porte de secret', () => {
    for (const o of outilsInstallables()) {
      for (const a of o.installation!) expect(a).not.toMatch(/key|token|secret|sk-/i);
    }
  });
});

describe('les sentinelles — le catalogue confronté au CODE', () => {
  it('déclarer `modeleChoisi` exige que l’adaptateur LISE `ctx.modele`', () => {
    for (const o of OUTILS) {
      const src = sourceAdaptateur(o.id);
      if (src === null) continue; // pas encore d'adaptateur : rien à confronter
      if (!o.capacites.modeleChoisi) continue;
      expect(
        src.includes('ctx.modele'),
        `${o.id} annonce accepter un modèle, mais son adaptateur ne lit jamais ctx.modele`,
      ).toBe(true);
    }
  });

  it('déclarer `sousAgents` exige que l’adaptateur n’en rende pas une liste VIDE en dur', () => {
    // `subAgents: []` écrit en dur est la marque d'un adaptateur qui n'en
    // remonte aucun. Le mesurer évite de croire une déclaration optimiste.
    for (const o of OUTILS) {
      const src = sourceAdaptateur(o.id);
      if (src === null || !o.capacites.sousAgents) continue;
      expect(
        src.includes('subAgents: []'),
        `${o.id} annonce des sous-agents, mais son adaptateur rend une liste vide en dur`,
      ).toBe(false);
    }
  });

  it('tout outil déclaré exécutant a un adaptateur, ou dit qu’il reste à écrire', () => {
    for (const o of OUTILS.filter((x) => x.capacites.executionTache)) {
      if (sourceAdaptateur(o.id) !== null) continue;
      expect(o.limite, `${o.id} se dit exécutant sans adaptateur et sans le dire`).toMatch(
        /adaptateur/i,
      );
    }
  });

  it('les binaires sondés ne se recouvrent pas sans signature pour les départager', () => {
    // `agent` appartient à Cursor ET pourrait être n'importe quoi d'autre : la
    // signature est ce qui les sépare. Deux outils réclamant le même binaire
    // sans signature s'attribueraient les tâches l'un de l'autre.
    const vus = new Map<string, string[]>();
    for (const o of OUTILS) {
      for (const b of o.bins) vus.set(b, [...(vus.get(b) ?? []), o.id]);
    }
    for (const [bin, ids] of vus) {
      if (ids.length < 2) continue;
      for (const id of ids) {
        expect(outil(id)!.signature, `« ${bin} » est réclamé par ${ids.join(' et ')}`).toBeTruthy();
      }
    }
  });
});

describe('l’accord avec ce que le dépôt savait déjà', () => {
  it('tout adaptateur existant figure au catalogue', () => {
    const source = readFileSync(new URL('../src/adapters/index.ts', import.meta.url), 'utf8');
    const branches = [...source.matchAll(/case '([a-z-]+)':/g)].map((m) => m[1]!);
    const ids = new Set(OUTILS.map((o) => o.id));
    const absents = branches.filter((b) => !ids.has(b));
    expect(absents, `adaptateurs absents du catalogue : ${absents.join(', ')}`).toEqual([]);
  });

  it('le catalogue ne promet aucun adaptateur qui n’existe pas sans le dire', () => {
    const manquants = OUTILS.filter(
      (o) => o.capacites.executionTache && sourceAdaptateur(o.id) === null,
    ).map((o) => o.id);
    // Plus aucun : `cline` a reçu son adaptateur. Si un outil est déclaré
    // exécutant sans code pour l'exécuter, la Reine le choisira et la tâche
    // mourra sur « Adaptateur inconnu ».
    expect(manquants, `déclarés exécutants sans adaptateur : ${manquants.join(', ')}`).toEqual([]);
  });
});
