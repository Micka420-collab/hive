// LE MESSAGE DE POSE — ce que le réseau a le droit de transporter.
//
// Ce banc ne défend pas « faut-il permettre la pose à distance » : c'est
// tranché. Il défend la BORNE — le message porte un identifiant, jamais une
// commande — parce que c'est elle qui empêche la contrepartie assumée de
// s'élargir en « exécution arbitraire à distance ».

import { describe, expect, it } from 'vitest';
import { parseClientMessage, parseServerMessage } from '../src/shared/protocol.js';

const POSE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const OUTIL = 'claude-code';

describe('hub → nœud : poser_outil', () => {
  it('un message bien formé passe', () => {
    const m = parseServerMessage(
      JSON.stringify({ type: 'poser_outil', poseId: POSE_ID, outilId: OUTIL }),
    );
    expect(m).toEqual({ type: 'poser_outil', poseId: POSE_ID, outilId: OUTIL });
  });

  it('UNE COMMANDE GLISSÉE DANS LE MESSAGE N’ARRIVE PAS DE L’AUTRE CÔTÉ', () => {
    // C'est la borne entière. Le validateur RECONSTRUIT l'objet champ par
    // champ au lieu de laisser passer celui qui arrive : tout ce qui n'est pas
    // déclaré tombe. Sans ça, un hub compromis ajouterait `commande` et le
    // nœud n'aurait plus qu'à l'exécuter.
    const m = parseServerMessage(
      JSON.stringify({
        type: 'poser_outil',
        poseId: POSE_ID,
        outilId: OUTIL,
        commande: ['rm', '-rf', '/'],
        prepareCommand: ['curl', 'evil.example'],
      }),
    );
    expect(m).not.toBeNull();
    expect(Object.keys(m!).sort()).toEqual(['outilId', 'poseId', 'type']);
    expect(JSON.stringify(m)).not.toContain('rm');
    expect(JSON.stringify(m)).not.toContain('curl');
  });

  it('les identifiants malformés sont refusés', () => {
    const cas = [
      { type: 'poser_outil', poseId: POSE_ID },
      { type: 'poser_outil', outilId: OUTIL },
      { type: 'poser_outil', poseId: '', outilId: OUTIL },
      { type: 'poser_outil', poseId: POSE_ID, outilId: '' },
      { type: 'poser_outil', poseId: POSE_ID, outilId: '../../etc/passwd' },
      { type: 'poser_outil', poseId: POSE_ID, outilId: 'a b' },
      { type: 'poser_outil', poseId: 42, outilId: OUTIL },
    ];
    for (const c of cas) {
      expect(parseServerMessage(JSON.stringify(c)), JSON.stringify(c)).toBeNull();
    }
  });
});

describe('nœud → hub : pose_result', () => {
  const ok = {
    type: 'pose_result',
    poseId: POSE_ID,
    outilId: OUTIL,
    code: 0,
    sortie: 'added 1 package',
    ok: true,
  };

  it('un résultat bien formé passe', () => {
    expect(parseClientMessage(JSON.stringify(ok))).toEqual(ok);
  });

  it('un refus est transporté quand il est là', () => {
    const m = parseClientMessage(
      JSON.stringify({ ...ok, ok: false, code: null, refuse: 'inconnu' }),
    );
    expect(m).not.toBeNull();
    expect((m as { refuse?: string }).refuse).toBe('inconnu');
  });

  it('LE CODE PEUT ÊTRE NULL — un processus qui n’a jamais démarré', () => {
    // `code: null` et `code: 0` disent des choses opposées ; refuser `null`
    // forcerait le nœud à inventer un code pour un processus absent.
    expect(parseClientMessage(JSON.stringify({ ...ok, code: null, ok: false }))).not.toBeNull();
  });

  it('les formes invalides sont refusées', () => {
    const cas = [
      { ...ok, ok: 'oui' },
      { ...ok, code: 1.5 },
      { ...ok, sortie: 42 },
      { ...ok, poseId: 'pas-un-id !' },
      { ...ok, outilId: '' },
    ];
    for (const c of cas) {
      expect(parseClientMessage(JSON.stringify(c)), JSON.stringify(c)).toBeNull();
    }
  });

  it('une sortie VIDE est légitime — une commande peut ne rien dire', () => {
    expect(parseClientMessage(JSON.stringify({ ...ok, sortie: '' }))).not.toBeNull();
  });
});
