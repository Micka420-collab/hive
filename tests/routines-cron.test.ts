// Le cron des Routines, lu dans un FUSEAU (src/orchestrator/cron.ts).
//
// Ce que ce banc tient : « du lundi au vendredi à 9 h, Europe/Paris » tombe à
// 9 h À PARIS toute l'année — 7 h UTC l'été, 8 h UTC l'hiver —, une heure qui
// n'existe pas (printemps) part à l'heure décalée au lieu d'être sautée, une
// heure qui a lieu deux fois (automne) ne part qu'une fois, et la règle du OU
// de cron (jour du mois OU jour de semaine) n'est pas celle de l'original UTC.

import { describe, expect, it } from 'vitest';
import {
  analyserCron,
  fuseauValide,
  motifCronInvalide,
  prochaineEcheance,
} from '../src/orchestrator/cron.js';

const PARIS = 'Europe/Paris';
const utc = (iso: string): number => Date.parse(iso);
const iso = (ms: number | null): string | null => (ms === null ? null : new Date(ms).toISOString());

describe('l’analyse d’une expression', () => {
  it('lit les cinq champs, pas, intervalles et listes', () => {
    const c = analyserCron('*/15 9-17/4 1,15 * 1-5');
    expect(c.minutes).toEqual([0, 15, 30, 45]);
    expect(c.heures).toEqual([9, 13, 17]);
    expect(c.joursDuMois).toEqual([1, 15]);
    expect(c.joursSemaine).toEqual([1, 2, 3, 4, 5]);
    expect(c.joursDuMoisLibres).toBe(false);
  });

  it('7 vaut dimanche, comme dans toute crontab', () => {
    expect(analyserCron('0 0 * * 7').joursSemaine).toEqual([0]);
    expect(analyserCron('0 0 * * 5-7').joursSemaine).toEqual([0, 5, 6]);
  });

  it.each([
    ['0 9 * *', /5 champs/],
    ['60 * * * *', /hors de/],
    ['5x * * * *', /pas un nombre/],
    ['0 9 * * 5-1', /à l’envers/],
    ['*/0 * * * *', /pas nul/],
  ])('refuse « %s » avec un motif lisible', (expr, motif) => {
    expect(motifCronInvalide(expr)).toMatch(motif);
  });

  it('les fuseaux : un nom IANA passe, un nom inventé non', () => {
    expect(fuseauValide(PARIS)).toBe(true);
    expect(fuseauValide('UTC')).toBe(true);
    expect(fuseauValide('Mars/Olympus_Mons')).toBe(false);
    expect(fuseauValide('')).toBe(false);
  });
});

describe('l’échéance suivante, dans un fuseau', () => {
  const ouvres9h = analyserCron('0 9 * * 1-5');

  it('« DU LUNDI AU VENDREDI À 9 H, EUROPE/PARIS » — le vendredi après 9 h mène au lundi', () => {
    // Vendredi 2 octobre 2026, 10 h à Paris (heure d'été, UTC+2).
    const apres = utc('2026-10-02T08:00:00Z');
    expect(iso(prochaineEcheance(ouvres9h, PARIS, apres))).toBe('2026-10-05T07:00:00.000Z');
  });

  it('LE CHANGEMENT D’HEURE NE DÉPLACE PAS 9 H — 7 h UTC l’été, 8 h UTC l’hiver', () => {
    const quotidien = analyserCron('0 9 * * *');
    // Samedi 24 octobre (été) puis lundi 26 (hiver : le 25 à 3 h on recule).
    const samedi = prochaineEcheance(quotidien, PARIS, utc('2026-10-23T12:00:00Z'));
    expect(iso(samedi)).toBe('2026-10-24T07:00:00.000Z');
    const dimanche = prochaineEcheance(quotidien, PARIS, samedi!);
    expect(iso(dimanche)).toBe('2026-10-25T08:00:00.000Z');
    // Lu en UTC (l'original), le même cron part à 11 h à Paris ce samedi-là.
    expect(iso(prochaineEcheance(quotidien, 'UTC', samedi!))).toBe('2026-10-24T09:00:00.000Z');
  });

  it('UNE HEURE QUI N’EXISTE PAS (printemps) part à l’heure décalée, pas jamais', () => {
    // Le 28 mars 2027, à Paris, on passe de 2 h à 3 h : 2 h 30 n'a pas lieu.
    const c = analyserCron('30 2 * * *');
    const jour = prochaineEcheance(c, PARIS, utc('2027-03-27T02:00:00Z'));
    expect(iso(jour)).toBe('2027-03-28T01:30:00.000Z'); // 3 h 30 heure d'été
    expect(iso(prochaineEcheance(c, PARIS, jour!))).toBe('2027-03-29T00:30:00.000Z');
  });

  it('UNE HEURE QUI A LIEU DEUX FOIS (automne) ne part qu’une fois — la première', () => {
    // Le 25 octobre 2026, 2 h 30 a lieu à 00:30Z (été) PUIS à 01:30Z (hiver).
    const c = analyserCron('30 2 * * *');
    const premiere = prochaineEcheance(c, PARIS, utc('2026-10-24T12:00:00Z'));
    expect(iso(premiere)).toBe('2026-10-25T00:30:00.000Z');
    expect(iso(prochaineEcheance(c, PARIS, premiere!))).toBe('2026-10-26T01:30:00.000Z');
    // Même depuis l'intérieur de l'heure rejouée : pas de second départ.
    expect(iso(prochaineEcheance(c, PARIS, utc('2026-10-25T01:10:00Z')))).toBe(
      '2026-10-26T01:30:00.000Z',
    );
  });

  it('une routine horaire traverse l’heure rejouée sans partir deux fois à la même heure murale', () => {
    const c = analyserCron('30 * * * *');
    const vus: string[] = [];
    let t = utc('2026-10-24T22:00:00Z');
    for (let i = 0; i < 5; i++) {
      t = prochaineEcheance(c, PARIS, t)!;
      vus.push(iso(t)!);
    }
    // 0 h 30, 1 h 30, 2 h 30 (été), 3 h 30 (hiver), 4 h 30 : jamais deux 2 h 30.
    expect(vus).toEqual([
      '2026-10-24T22:30:00.000Z',
      '2026-10-24T23:30:00.000Z',
      '2026-10-25T00:30:00.000Z',
      '2026-10-25T02:30:00.000Z',
      '2026-10-25T03:30:00.000Z',
    ]);
  });

  it('LA RÈGLE DU OU : « le 1er du mois, et chaque lundi » (l’original exigeait les deux)', () => {
    const c = analyserCron('0 9 1 * 1');
    const lundi = prochaineEcheance(c, 'UTC', utc('2026-10-02T00:00:00Z'));
    expect(iso(lundi)).toBe('2026-10-05T09:00:00.000Z');
    // Le 1er novembre 2026 est un dimanche : il part quand même.
    const premier = prochaineEcheance(c, 'UTC', utc('2026-10-27T00:00:00Z'));
    expect(iso(premier)).toBe('2026-11-01T09:00:00.000Z');
  });

  it('une expression impossible rend null au lieu de boucler', () => {
    expect(prochaineEcheance(analyserCron('0 0 31 2 *'), 'UTC', utc('2026-01-01T00:00:00Z'))).toBe(
      null,
    );
  });

  it('strictement APRÈS : un créneau exact n’est pas sa propre échéance suivante', () => {
    const t = utc('2026-10-05T07:00:00Z');
    expect(iso(prochaineEcheance(ouvres9h, PARIS, t))).toBe('2026-10-06T07:00:00.000Z');
  });
});
