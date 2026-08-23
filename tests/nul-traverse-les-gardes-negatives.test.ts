// SEPT GARDES NUES DE LA FORME NÉGATIVE — `typeof x !== 'object' || x === null`.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// Suite du recensement de la forme négative (§ 9 quaterseptuagicenties : un
// recensement est une mesure, et son motif de recherche en est le
// dénominateur). Trente occurrences au dépôt ; treize restaient à juger après
// la fermeture des cinq de `protocol.ts`.
//
// Chacune a été LUE avant d'être mise au banc, parce que la moitié du lot
// précédent s'était révélée indéfendable — non par manque de soin, mais parce
// qu'un `catch` enveloppant ou une garde amont rendait le mutant équivalent.
// Le partage des treize :
//
//   · SEPT sont nues — elles vivent ici.
//   · SIX ne le sont pas, et sont marquées dans le code, pas éprouvées ici :
//       `partage.ts:164`     — la garde vit DANS un `try { … } catch { null }`.
//       `nuage.ts:79`        — `objetStripe` n'a qu'un appelant, en aval d'une
//                              garde qui a déjà écarté `null`. Inatteignable.
//       `nuage.ts:84`        — équivalente par une preuve moins évidente : le
//                              `meta()` en aval lit `.metadata` sur une valeur
//                              non-objet sans lever, et le `!projectId` qui
//                              suit rend `null` de toute façon.
//       `eclaireuse.ts:233`  — `RE_PROPOSITION` n'accepte qu'une charge entre
//       `eclaireuse.ts:272`    accolades : `JSON.parse` lève (rattrapé) ou rend
//                              un objet non nul. Jamais `null`.
//       `server.ts:5558`     — `catch` enveloppant, comme sa jumelle du dessus.
//
// ─── CE QUE LA MUTATION FAIT ─────────────────────────────────────────────────
//
// `typeof null` rend `'object'` : c'est le `||` qui écarte `null`, et lui seul.
// Mué en `&&`, le refus exige que les DEUX conditions tombent — `null` traverse
// la garde, et l'indexation qui suit lève un TypeError.
//
// Un `null` là où on attendait un objet n'est pas une bizarrerie théorique :
// c'est la forme que prend un champ absent dans presque toutes les API JSON.

import { describe, expect, it } from 'vitest';
import { lireRun } from '../src/shared/workflow.js';
import { decodeInvite } from '../src/shared/invite.js';
import { cheminDepuisInput } from '../src/shared/presence.js';
import { createPresenceTracker } from '../src/adapters/presence-parser.js';
import { createSubAgentTracker } from '../src/adapters/subagent-parser.js';
import { evenementDepuisStripe } from '../src/orchestrator/nuage.js';

describe('lireRun — un `null` dans `workflow_runs` ne fait pas tomber la liste', () => {
  // `lireRuns` boucle sur le tableau que GitHub rend et appelle `lireRun` sur
  // chaque élément, SANS try/catch nulle part sur ce chemin. Une levée ici ne
  // gâche pas une ligne : elle rejette la promesse, et la vue Chantiers passe
  // d'« un run illisible ignoré » à « rien ne s'affiche ».
  it('rend `null` au lieu de lever', () => {
    expect(() => lireRun(null)).not.toThrow();
    expect(lireRun(null)).toBeNull();
  });

  // Le bord positif : sans lui, un `lireRun` qui rendrait TOUJOURS `null`
  // passerait le cas ci-dessus sans rien mesurer.
  it('un run BIEN FORMÉ est toujours lu', () => {
    const r = lireRun({ id: 7, name: 'CI', status: 'completed', conclusion: 'success' });
    expect(r, 'un run valide devrait être lu').not.toBeNull();
    expect(r?.id).toBe(7);
  });
});

describe('decodeInvite — une invitation dont la charge vaut `null`', () => {
  // Le `try` de `decodeInvite` n'enveloppe QUE `JSON.parse`. Or `JSON.parse`
  // de la chaîne `null` réussit et rend `null` : le `catch` ne le voit jamais
  // passer. Seule la garde l'arrête — et c'est la ruche du destinataire qui
  // tombe, sur un lien qu'un inconnu lui a envoyé.
  const lien = 'hive1_' + Buffer.from('null', 'utf8').toString('base64url');

  it('est refusée, pas fatale', () => {
    expect(() => decodeInvite(lien)).not.toThrow();
    expect(decodeInvite(lien)).toBeNull();
  });

  it('une invitation BIEN FORMÉE est toujours acceptée', () => {
    const bonne =
      'hive1_' +
      Buffer.from(
        JSON.stringify({ url: 'wss://ruche.example/ws', token: 'jeton-de-test' }),
        'utf8',
      ).toString('base64url');
    const inv = decodeInvite(bonne);
    expect(inv, 'une invitation valide devrait être lue').not.toBeNull();
    expect(inv?.url).toBe('wss://ruche.example/ws');
  });
});

describe('cheminDepuisInput — un outil sans arguments', () => {
  // `presence-parser` appelle cette fonction avec `block.input`, le champ
  // `input` d'un bloc `tool_use` du flux de l'agent. Un outil appelé sans
  // arguments porte `"input": null` — pas une malformation, une forme normale.
  it('rend un refus au lieu de lever', () => {
    expect(() => cheminDepuisInput(null)).not.toThrow();
    expect(cheminDepuisInput(null)).toEqual({ ok: false, motif: 'vide' });
  });
});

describe('les deux liseuses du flux — un `null` dans `content`', () => {
  // Les deux `feed` partagent la même garde, à la même place : après le
  // `try/catch` qui n'enveloppe que `JSON.parse`. Un `content: [null]` traverse
  // donc le `catch` sans être vu.
  //
  // Ce que coûte la levée : `feed` est appelée sur CHAQUE ligne du flux d'une
  // ouvrière. Une levée n'écarte pas une ligne — elle interrompt la lecture du
  // flux, et la ruche cesse de voir ce que l'ouvrière fait.
  const ligne = (contenu: unknown) => JSON.stringify({ message: { content: contenu } });

  it('la liseuse de présences ignore le `null` sans lever', () => {
    const t = createPresenceTracker();
    expect(() => t.feed(ligne([null]))).not.toThrow();
    expect(t.feed(ligne([null]))).toBeNull();
  });

  it('la liseuse de sous-agents ignore le `null` sans lever', () => {
    const t = createSubAgentTracker();
    expect(() => t.feed(ligne([null]))).not.toThrow();
    expect(t.feed(ligne([null]))).toBeNull();
  });

  // Les bords positifs : un `null` VOISIN d'un bloc valide ne doit pas
  // empêcher ce dernier d'être lu. Sans eux, une liseuse qui rendrait
  // toujours `null` passerait les deux cas ci-dessus.
  it('la liseuse de présences lit quand même le bloc valide qui SUIT le `null`', () => {
    const t = createPresenceTracker();
    const vu = t.feed(
      ligne([null, { type: 'tool_use', id: 'tu-1', name: 'Edit', input: { file_path: 'a.ts' } }]),
    );
    expect(vu, 'le bloc valide devrait être vu').not.toBeNull();
    expect(vu?.[0]?.chemin).toBe('a.ts');
  });

  it('la liseuse de sous-agents lit quand même le bloc valide qui SUIT le `null`', () => {
    const t = createSubAgentTracker();
    const vu = t.feed(
      ligne([null, { type: 'tool_use', id: 'tu-1', name: 'Task', input: { description: 'x' } }]),
    );
    expect(vu, 'le bloc valide devrait être vu').not.toBeNull();
    expect(vu?.[0]?.id).toBe('sa-1');
  });
});

describe('evenementDepuisStripe — deux gardes, deux profondeurs', () => {
  // `nuage.ts:105` — la charge entière. Le module n'a AUCUN try/catch : la
  // levée remonte jusqu'à la route du crochet Stripe, qui répond 500. Stripe
  // relivre alors le même événement, qui lève encore : une boucle de
  // relivraison sur une charge qu'il aurait suffi de refuser.
  it('une charge valant `null` est refusée, pas fatale', () => {
    expect(() => evenementDepuisStripe(null)).not.toThrow();
    expect(evenementDepuisStripe(null)).toBeNull();
  });

  // `nuage.ts:82` — le `data` INTERNE. La charge est un objet ; c'est son
  // champ `data` qui vaut `null`. La garde du dessus ne voit rien.
  it('un `data` valant `null` est refusé, pas fatal', () => {
    const charge = { type: 'customer.subscription.created', data: null, created: 1_700_000_000 };
    expect(() => evenementDepuisStripe(charge)).not.toThrow();
    expect(evenementDepuisStripe(charge)).toBeNull();
  });
});
