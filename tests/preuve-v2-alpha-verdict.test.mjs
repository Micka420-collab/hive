// LE VERDICT DE LA PREUVE V2 ALPHA — chaque critère, de ses trois côtés.
//
// Un instrument de preuve qui dirait « prouvé » sur un fait absent serait pire
// que pas d'instrument. Chaque critère est donc joué avec son fait PRÉSENT et
// conforme (prouvé), ABSENT (inconnu), et quand il a un contraire, PRÉSENT et
// contraire (échec).

import { describe, expect, it } from 'vitest';
import {
  jugerV2Alpha,
  missionReelleProuvee,
  productionRetenue,
  rapportV2Alpha,
} from '../scripts/preuve-v2-alpha-verdict.mjs';

const DIFF =
  '--- /dev/null\n+++ b/somme.mjs\n@@ -0,0 +1 @@\n+export const somme = (a, b) => a + b;\n';

/** Une mission réelle complète, telle qu'une Reine la rendrait. */
const complet = () => ({
  noeud: {
    id: 'n1',
    name: 'poste',
    agentType: 'claude-code',
    isolement: { niveau: 'conteneur', fournisseur: 'podman' },
  },
  tache: {
    id: 't1',
    status: 'done',
    result: {
      success: true,
      nodeId: 'n1',
      durationMs: 9_000,
      usage: {
        userCpuMicros: 40_000,
        systemCpuMicros: 10_000,
        maxRssBytes: 64 * 1_048_576,
        rssBytes: 1,
        heapUsedBytes: 1,
      },
    },
  },
  resultats: [
    { nodeId: 'n1', success: false, diff: '' },
    { nodeId: 'n1', success: true, diff: DIFF },
  ],
  routage: {
    affectations: [
      { nodeId: 'n1', modele: 'sonnet', raisonModele: [{ modele: 'sonnet' }, { modele: 'opus' }] },
    ],
  },
  chronologie: {
    attenteWorkerMs: 120,
    dureeWorkerTotaleMs: 9_000,
    dureeModele: { total: 6_500, declarees: 1, tentatives: 1 },
    coutFournisseur: { total: 0.0421, declarees: 1, tentatives: 1 },
  },
  evaluation: { decision: 'human_review_required', canMerge: false },
  genome: {
    lignes: [
      { modele: 'sonnet', categorie: 'code', rendus: 1, modelesExacts: ['claude-sonnet-4-5'] },
      { modele: 'opus', categorie: 'code', rendus: 4, modelesExacts: [] },
    ],
  },
  workers: { workers: [{ id: 'n1', reputationParCategorie: { code: { essais: 2 } } }] },
  attendu: /somme/,
});

const etat = (verdicts, critere) => verdicts.find((v) => v.critere === critere);

describe('preuve V2 Alpha — le verdict', () => {
  it('UNE MISSION RÉELLE COMPLÈTE PROUVE CHAQUE CRITÈRE — et dit ce qui est déclaré', () => {
    const v = jugerV2Alpha(complet());

    expect(
      v.every((x) => x.etat === 'prouve'),
      rapportV2Alpha(v),
    ).toBe(true);
    expect(etat(v, 'A-agent').detail).toContain('déclaré « claude-code »');
    expect(etat(v, 'A-bac').detail).toBe('conteneur (podman), déclaré par le nœud');
    expect(etat(v, 'B').detail).toBe('0.0421 $ déclarés par le CLI');
    expect(etat(v, 'C').detail).toContain('modèle 6.5 s');
    expect(etat(v, 'D').detail).toBe('50 ms CPU · 64.0 MiB RSS (processus Worker)');
    expect(etat(v, 'E').detail, 'le Genome du modèle ÉLU, pas un autre').toContain(
      '1 rendu(s) rangé(s) sous « sonnet » (exact : claude-sonnet-4-5)',
    );
    expect(etat(v, 'G').detail).toContain('classement de 2 modèle(s)');
    expect(missionReelleProuvee(v)).toBe(true);
  });

  it('UN AGENT SIMULÉ EST UN ÉCHEC — la mission réelle n’est pas prouvée', () => {
    const f = complet();
    f.noeud.agentType = 'shell';
    const v = jugerV2Alpha(f);

    expect(etat(v, 'A-agent').etat).toBe('echec');
    expect(missionReelleProuvee(v)).toBe(false);
  });

  it('SANS PRODUCTION, OU AVEC UN DIFF VIDE OU HORS SUJET, LE TRAVAIL N’EST PAS PRODUIT', () => {
    const sans = complet();
    sans.resultats = [{ nodeId: 'n1', success: false, diff: 'x' }];
    sans.tache.status = 'failed';
    expect(etat(jugerV2Alpha(sans), 'A-diff')).toMatchObject({
      etat: 'echec',
      detail: 'aucune production réussie (tâche failed)',
    });

    const vide = complet();
    vide.resultats = [{ nodeId: 'n1', success: true, diff: '  ' }];
    expect(etat(jugerV2Alpha(vide), 'A-diff').detail).toBe('production réussie mais diff vide');

    const horsSujet = complet();
    horsSujet.resultats = [{ nodeId: 'n1', success: true, diff: '+++ b/autre.txt\n+rien\n' }];
    expect(etat(jugerV2Alpha(horsSujet), 'A-diff').etat).toBe('echec');
    expect(missionReelleProuvee(jugerV2Alpha(horsSujet))).toBe(false);
  });

  it('UN BAC « PROCESSUS » N’EST PAS UN CONTENEUR, ET UN BAC NON DÉCLARÉ EST INCONNU', () => {
    const proc = complet();
    proc.noeud.isolement = { niveau: 'processus' };
    expect(etat(jugerV2Alpha(proc), 'A-bac').etat).toBe('echec');

    const muet = complet();
    delete muet.noeud.isolement;
    expect(etat(jugerV2Alpha(muet), 'A-bac').etat).toBe('inconnu');
  });

  it('CE QUI N’EST PAS DÉCLARÉ RESTE INCONNU — jamais prouvé par défaut', () => {
    const f = complet();
    f.chronologie = {
      attenteWorkerMs: null,
      dureeWorkerTotaleMs: null,
      dureeModele: 'inconnu',
      coutFournisseur: 'inconnu',
    };
    f.tache.result = { success: true, nodeId: 'n1', durationMs: 1 };
    f.evaluation = null;
    f.workers = { workers: [{ id: 'n1', reputationParCategorie: {} }] };
    const v = jugerV2Alpha(f);

    for (const critere of ['B', 'C', 'D', 'F', 'Evaluator']) {
      expect(etat(v, critere).etat, critere).toBe('inconnu');
    }
    // La mission elle-même reste prouvée : ces manques ne la contredisent pas.
    expect(missionReelleProuvee(v)).toBe(true);
  });

  it('SANS MODÈLE DÉCLARÉ, ROUTAGE ET GENOME SONT INCONNUS — et le dit avec la marche à suivre', () => {
    const f = complet();
    f.routage = { affectations: [{ nodeId: 'n1', modele: null, raisonModele: [] }] };
    const v = jugerV2Alpha(f);

    expect(etat(v, 'G')).toMatchObject({ etat: 'inconnu' });
    expect(etat(v, 'G').detail).toContain('HIVE_MODELES');
    expect(etat(v, 'E').etat).toBe('inconnu');
  });

  it('UNE COUVERTURE PARTIELLE SE LIT « AU MOINS »', () => {
    const f = complet();
    f.chronologie.coutFournisseur = { total: 0.5, declarees: 1, tentatives: 3 };
    expect(etat(jugerV2Alpha(f), 'B').detail).toBe(
      '≥ 0.50 $ déclarés par le CLI (1/3 tentatives déclarées)',
    );
  });

  it('LA PRODUCTION RETENUE EST LA DERNIÈRE RÉUSSIE — pas la première', () => {
    expect(
      productionRetenue([
        { success: true, diff: 'a' },
        { success: false, diff: 'b' },
        { success: true, diff: 'c' },
      ])?.diff,
    ).toBe('c');
    expect(productionRetenue(null)).toBeNull();
  });

  it('LE RAPPORT DIT CHAQUE CRITÈRE SUR UNE LIGNE, AVEC SON SIGNE', () => {
    const f = complet();
    f.noeud.agentType = 'shell';
    delete f.noeud.isolement;
    const lignes = rapportV2Alpha(jugerV2Alpha(f)).split('\n');

    expect(lignes).toHaveLength(10);
    expect(lignes[0]).toMatch(/^✘ A-agent\s+Agent réel — /);
    expect(lignes[2]).toMatch(/^\? A-bac\s+Bac à sable — /);
    expect(lignes.at(-1)).toMatch(/^✔ Evaluator/);
  });
});
