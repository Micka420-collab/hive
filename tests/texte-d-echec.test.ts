// Ce qu'un échec DIT — la règle partagée par le nœud (échec d'infrastructure ?)
// et par le hub (Couveuse, signatures de l'essaim, Cerveau).
//
// Les flux enregistrés sur les vrais binaires sont rejoués dans
// tests/texte-final-ruche.test.ts ; ici, la règle elle-même, ligne à ligne.

import { describe, expect, it } from 'vitest';
import { signatureEchec } from '../src/orchestrator/essaim.js';
import { texteDEchec } from '../src/shared/texte-d-echec.js';

describe('texteDEchec — ce qu’un échec dit à un humain', () => {
  // Le flux JSON par lignes (Claude Code, Cursor, Cline) fait répondre
  // `MOTIF_ERREUR` à des CLÉS (`is_error`, `compact_error`) : ces lignes-là
  // sont des événements de machine, pas des phrases.
  const logs = [
    '{"type":"system","subtype":"init","apiKeySource":"ANTHROPIC_API_KEY"}',
    'Error: ENOSPC: no space left on device',
    '{"type":"result","is_error":true,"resu', // dernière ligne coupée par le plafond
    '\u001B[31m{"type":"user"}\u001B[0m',
    '[hive] timeout après 900000 ms — processus tué',
  ].join('\n');

  it('retire les événements JSON, même tronqués ou colorés ; garde stderr et les marqueurs', () => {
    expect(texteDEchec(logs)).toBe(
      'Error: ENOSPC: no space left on device\n[hive] timeout après 900000 ms — processus tué',
    );
  });

  it('rend la parole de l’agent quand des événements la cachaient', () => {
    expect(texteDEchec(logs, 'Disque plein').endsWith('\nDisque plein')).toBe(true);
  });

  it('ne double pas une sortie en texte, qui contient déjà la réponse (Codex, CLI en texte)', () => {
    const texte = 'ERROR: stream disconnected\nréponse';
    expect(texteDEchec(texte, 'réponse')).toBe(texte);
  });

  it('GARDE un corps d’erreur d’API recopié par un CLI en texte : c’est l’échec lui-même', () => {
    // Retiré comme un événement, il laissait la bannière seule — et la
    // signature de TOUTES les pannes de ce CLI devenait « hermes agent run ».
    const texte =
      'hermes agent run\n' +
      '{"error":{"message":"maximum context length is 128000 tokens","type":"invalid_request_error"}}';
    expect(texteDEchec(texte)).toBe(texte);
    expect(signatureEchec(texte)).toContain('maximum context length is <n> tokens');
  });

  it('GARDE l’erreur que Cline écrit en JSON sur stderr, retire ses événements', () => {
    const texte = [
      '{"ts":"2026-09-27T00:00:00Z","type":"run_start","providerId":"p","modelId":"m"}',
      '{"ts":"2026-09-27T00:00:01Z","type":"error","message":"Invalid API key"}',
    ].join('\n');
    expect(texteDEchec(texte)).toBe(
      '{"ts":"2026-09-27T00:00:01Z","type":"error","message":"Invalid API key"}',
    );
  });

  it('un CODE d’erreur dans un événement n’est pas un message : l’événement part', () => {
    // Forme réelle de Claude Code 2.1.283 (tests/fixtures/texte-final) :
    // `"error":"invalid_request"` sur l'événement `assistant` synthétique.
    const evenement =
      '{"type":"assistant","message":{"content":[{"type":"text","text":"Prompt is too long"}]},"error":"invalid_request"}';
    expect(texteDEchec(evenement, 'Prompt is too long').trim()).toBe('Prompt is too long');
  });
});
