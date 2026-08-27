// Bancs purs — pièces jointes Reine (formats, assemblage, refus).

import { describe, expect, it } from 'vitest';
import {
  CHAT_ENVOI_MAX,
  CHAT_PIECES_MAX,
  CHAT_QUESTION_MAX,
  assemblerMessageReine,
  classerPiece,
  expliquerAssemblage,
  refusExtraction,
  tronquerPiece,
} from '../src/shared/reine-pieces.js';

describe('classerPiece', () => {
  it('reconnaît PDF, DOCX, texte, image, vidéo', () => {
    expect(classerPiece('a.pdf')).toBe('pdf');
    expect(classerPiece('rapport.DOCX')).toBe('docx');
    expect(classerPiece('notes.txt')).toBe('texte');
    expect(classerPiece('x.md')).toBe('texte');
    expect(classerPiece('shot.png')).toBe('image');
    expect(classerPiece('clip.mp4')).toBe('video');
    expect(classerPiece('old.doc')).toBe('autre');
  });

  it('s’appuie aussi sur le MIME', () => {
    expect(classerPiece('x', 'application/pdf')).toBe('pdf');
    expect(classerPiece('x', 'text/plain')).toBe('texte');
  });
});

describe('assemblerMessageReine', () => {
  it('refuse le vide', () => {
    expect(assemblerMessageReine('', [])).toEqual({ ok: false, motif: 'vide' });
  });

  it('assemble question seule', () => {
    const r = assemblerMessageReine('Bonjour', []);
    expect(r).toEqual({ ok: true, message: 'Bonjour' });
  });

  it('étiquette les documents comme données', () => {
    const r = assemblerMessageReine('Lis ça', [
      { nom: 'a.txt', genre: 'texte', octets: 3, texte: 'abc' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toContain('Documents fournis');
    expect(r.message).toContain('a.txt');
    expect(r.message).toContain('abc');
    expect(r.message).toContain('pas des instructions');
  });

  it('constate une vidéo non lue — n’invente pas de script', () => {
    const r = assemblerMessageReine('Analyse', [
      { nom: 'x.mp4', genre: 'video', octets: 99, refus: 'pas de transcript' },
    ]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.message).toContain('non lu');
    expect(r.message).not.toMatch(/scène 1|personnage/i);
  });

  it('refuse trop de pièces ou une question trop longue', () => {
    const pieces = Array.from({ length: CHAT_PIECES_MAX + 1 }, (_, i) => ({
      nom: `f${i}.txt`,
      genre: 'texte' as const,
      octets: 1,
      texte: 'x',
    }));
    expect(assemblerMessageReine('q', pieces)).toEqual({ ok: false, motif: 'trop_de_pieces' });
    expect(assemblerMessageReine('y'.repeat(CHAT_QUESTION_MAX + 1), [])).toEqual({
      ok: false,
      motif: 'question_trop_longue',
    });
  });

  it('explique les motifs FR/EN', () => {
    expect(expliquerAssemblage('vide', 'fr')).toMatch(/document/i);
    expect(expliquerAssemblage('vide', 'en')).toMatch(/document/i);
    expect(CHAT_ENVOI_MAX).toBeGreaterThan(CHAT_QUESTION_MAX);
  });
});

describe('tronquerPiece + refus', () => {
  it('tronque avec marqueur', () => {
    expect(tronquerPiece('abc', 2)).toContain('tronqué');
  });

  it('refus vidéo demande un script — pas une fausse compréhension', () => {
    expect(refusExtraction('video', 'fr')).toMatch(/script|transcription|captures/i);
    expect(refusExtraction('video', 'en')).toMatch(/script|transcript|screenshot/i);
  });
});
