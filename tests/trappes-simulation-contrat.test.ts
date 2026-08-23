// LE MESSAGE PROMET DEUX TRAPPES. LES DEUX DOIVENT EXISTER — ET N'OUVRIR QUE
// CE QU'ELLES DISENT OUVRIR.
//
// ─── LE DÉFAUT QUI A FAIT NAÎTRE CE BANC ─────────────────────────────────────
//
// `messageRefusShellProduction` annonce à l'humain :
//
//     « Pour une démo simulée uniquement : HIVE_SIMULATION=1 ou HIVE_AGENT=shell »
//
// Deux portes lisent cette promesse, et elles ne la lisaient pas pareil :
//
//   · `demarrageNoeudAutorise` honorait LES DEUX → le nœud démarrait ;
//   · l'ordonnanceur n'honorait que `HIVE_SIMULATION` → il ne lui assignait
//     rien.
//
// Un nœud démarré sur la foi du message restait éligible à RIEN. L'essai
// d'installation, qui pose `HIVE_AGENT=shell`, allait jusqu'à
// « ✘ 7/7 — la tâche court encore après 90 s ». Pas une panne : une attente
// sans fin, la forme la plus coûteuse à diagnostiquer.
//
// ─── ET LE PIÈGE DE LA RÉPARATION ÉVIDENTE ───────────────────────────────────
//
// Élargir `config.simulation` aurait suffi à faire passer la CI. C'eût été une
// RÉGRESSION DE SÉCURITÉ : ce drapeau relâche aussi trois gardes de
// `createServer` — jeton trivial toléré, secret de session absent toléré,
// secret de webhook absent toléré. `HIVE_AGENT=shell` les aurait toutes
// ouvertes à qui pose une variable d'environnement.
//
// Le troisième banc ci-dessous est le plus important du fichier : il ne
// défend pas la correction, il défend contre SA version paresseuse.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  demarrageNoeudAutorise,
  messageRefusShellProduction,
  shellForce,
  modeSimulationOrchestrateur,
} from '../src/shared/agent-production.js';

const SERVEUR = readFileSync(new URL('../src/orchestrator/server.ts', import.meta.url), 'utf8');

describe('les deux trappes que le message promet', () => {
  // On lit les trappes DANS LE MESSAGE, pas dans une liste écrite à côté :
  // une seconde liste dériverait du texte que l'humain lit vraiment.
  const message = messageRefusShellProduction('fr');

  it('le message nomme bien les deux, dans les deux langues', () => {
    for (const lang of ['fr', 'en'] as const) {
      const m = messageRefusShellProduction(lang);
      expect(m, `${lang} devrait nommer HIVE_SIMULATION`).toContain('HIVE_SIMULATION=1');
      expect(m, `${lang} devrait nommer HIVE_AGENT=shell`).toContain('HIVE_AGENT=shell');
    }
  });

  // ─── CE BANC-CI EXISTE PARCE QUE LE PRÉCÉDENT NE SUFFISAIT PAS ─────────────
  //
  // `HIVE_SIMULATION=1` et `HIVE_AGENT=shell` sont des noms de VARIABLES
  // D'ENVIRONNEMENT : ils s'écrivent pareil dans les deux langues. La boucle
  // ci-dessus affirme donc uniquement ce que les deux branches ONT EN COMMUN —
  // et le sélecteur `lang === 'en' ? en : fr` lui est invisible.
  //
  // La loupe l'a montré : mué en `!==`, les deux langues s'échangent, et pas
  // une assertion ne bouge. Un francophone lirait l'anglais, un anglophone le
  // français, sur le message qu'on lit précisément quand plus rien ne marche.
  //
  // Un banc qui n'affirme que le PARTAGÉ ne peut pas voir quelle branche a été
  // prise. Il faut ancrer ce qui DISTINGUE.
  it('chaque langue rend SA version — le sélecteur est éprouvé', () => {
    const fr = messageRefusShellProduction('fr');
    const en = messageRefusShellProduction('en');
    expect(fr).toContain('Aucun agent de codage détecté');
    expect(en).toContain('No coding agent detected');
    expect(fr).not.toContain('No coding agent detected');
    expect(en).not.toContain('Aucun agent de codage détecté');
    // Et le défaut est le français : un appel sans langue ne doit pas basculer.
    expect(messageRefusShellProduction()).toBe(fr);
  });

  it('la porte du NŒUD honore chacune des deux', () => {
    expect(message).toContain('HIVE_SIMULATION=1');
    expect(demarrageNoeudAutorise('shell', { HIVE_SIMULATION: '1' })).toBe(true);
    expect(demarrageNoeudAutorise('shell', { HIVE_AGENT: 'shell' })).toBe(true);
    // Et sans aucune des deux, elle refuse — sinon la garde ne garde rien.
    expect(demarrageNoeudAutorise('shell', {})).toBe(false);
  });

  it('la porte de l’ORDONNANCEUR honore chacune des deux', () => {
    // Le câblage est structurel : on le lit dans la source, comme
    // `tests/readme.test.ts` lit les `case` du `switch`. Une sonde par appel
    // demanderait un serveur vivant, et mesurerait autre chose.
    expect(
      SERVEUR,
      'le Scheduler doit recevoir les DEUX trappes, pas la seule HIVE_SIMULATION',
    ).toContain('simulation: config.simulation || shellForce(process.env)');
  });
});

describe('mais la trappe `HIVE_AGENT=shell` n’ouvre RIEN d’autre', () => {
  // ─── LE BANC QUI DÉFEND CONTRE LA RÉPARATION PARESSEUSE ────────────────────
  //
  // Si quelqu'un « simplifie » un jour en élargissant `config.simulation`,
  // c'est ici que ça doit rougir — pas en production, six mois plus tard,
  // sur une ruche démarrée sans secret de session.
  it('`config.simulation` reste dérivée de HIVE_SIMULATION SEULE', () => {
    expect(
      SERVEUR,
      'config.simulation relâche trois gardes de sécurité : elle ne doit pas s’élargir',
    ).toContain("simulation: env.HIVE_SIMULATION === '1'");
    expect(SERVEUR).not.toContain("simulation: env.HIVE_SIMULATION === '1' || shellForce");
  });

  it('les trois gardes de sécurité regardent bien `config.simulation`', () => {
    const gardes = [...SERVEUR.matchAll(/!config\.simulation/g)];
    expect(gardes.length, 'les gardes de sécurité ont disparu ou changé de forme').toBeGreaterThan(
      1,
    );
  });

  it('les deux prédicats restent distincts — l’un ne lit pas l’autre', () => {
    expect(shellForce({ HIVE_SIMULATION: '1' })).toBe(false);
    expect(modeSimulationOrchestrateur({ HIVE_AGENT: 'shell' })).toBe(false);
    expect(shellForce({ HIVE_AGENT: 'shell' })).toBe(true);
    expect(modeSimulationOrchestrateur({ HIVE_SIMULATION: '1' })).toBe(true);
  });
});
