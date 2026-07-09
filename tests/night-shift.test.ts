// Tests de Night Shift (palier 4) : politique d'heures creuses pure. On vérifie
// le parse des fenêtres, le passage minuit, la disponibilité et l'attente.

import { describe, expect, it } from 'vitest';
import {
  formatWindow,
  isOnShift,
  minutesUntilOpen,
  nightShiftFromEnv,
  parseWindows,
} from '../src/shared/night-shift.js';

/** Date locale à HH:MM un jour fixe (l'API n'utilise que l'heure locale). */
const at = (h: number, m = 0): Date => new Date(2026, 0, 1, h, m, 0);

describe('parseWindows', () => {
  it('parse « HH » et « HH:MM », plusieurs fenêtres', () => {
    expect(parseWindows('22-8')).toEqual([{ startMin: 1320, endMin: 480 }]);
    expect(parseWindows('22:30-8,13-14')).toEqual([
      { startMin: 1350, endMin: 480 },
      { startMin: 780, endMin: 840 },
    ]);
  });

  it('spec vide → aucune fenêtre (24h/24)', () => {
    expect(parseWindows('')).toEqual([]);
    expect(parseWindows('   ')).toEqual([]);
  });

  it('lève sur fenêtre ou heure invalide', () => {
    expect(() => parseWindows('22')).toThrow(); // pas de « - »
    expect(() => parseWindows('25-8')).toThrow(); // heure hors bornes
    expect(() => parseWindows('22-8-9')).toThrow(); // trois bornes
    expect(() => parseWindows('aa-8')).toThrow();
  });
});

describe('isOnShift', () => {
  it('aucune fenêtre ⇒ toujours disponible', () => {
    expect(isOnShift({ windows: [] }, at(3))).toBe(true);
    expect(isOnShift({ windows: [] }, at(15))).toBe(true);
  });

  it('fenêtre qui enjambe minuit (22h→8h)', () => {
    const policy = { windows: parseWindows('22-8') };
    expect(isOnShift(policy, at(23))).toBe(true); // nuit
    expect(isOnShift(policy, at(2))).toBe(true); // petit matin
    expect(isOnShift(policy, at(7, 59))).toBe(true); // juste avant la fin
    expect(isOnShift(policy, at(8))).toBe(false); // fin exclusive
    expect(isOnShift(policy, at(12))).toBe(false); // journée
  });

  it('fenêtre intra-journée (13h→14h)', () => {
    const policy = { windows: parseWindows('13-14') };
    expect(isOnShift(policy, at(13, 30))).toBe(true);
    expect(isOnShift(policy, at(14))).toBe(false);
    expect(isOnShift(policy, at(9))).toBe(false);
  });

  it('fenêtre « X-X » couvre la journée entière', () => {
    const policy = { windows: parseWindows('9-9') };
    expect(isOnShift(policy, at(0))).toBe(true);
    expect(isOnShift(policy, at(23, 59))).toBe(true);
  });
});

describe('minutesUntilOpen', () => {
  it('0 si déjà de service (ou 24h/24)', () => {
    expect(minutesUntilOpen({ windows: [] }, at(4))).toBe(0);
    expect(minutesUntilOpen({ windows: parseWindows('22-8') }, at(23))).toBe(0);
  });

  it('délai jusqu’à la prochaine ouverture', () => {
    const policy = { windows: parseWindows('22-8') };
    // à 20h00, ouverture à 22h00 → 120 min.
    expect(minutesUntilOpen(policy, at(20))).toBe(120);
    // à 21h30 → 30 min.
    expect(minutesUntilOpen(policy, at(21, 30))).toBe(30);
  });
});

describe('nightShiftFromEnv & formatWindow', () => {
  it('lit HIVE_SHIFT', () => {
    expect(nightShiftFromEnv({ HIVE_SHIFT: '22-8' } as NodeJS.ProcessEnv).windows).toEqual([
      { startMin: 1320, endMin: 480 },
    ]);
    expect(nightShiftFromEnv({} as NodeJS.ProcessEnv).windows).toEqual([]);
  });

  it('formate une fenêtre en HH:MM-HH:MM', () => {
    expect(formatWindow({ startMin: 1350, endMin: 480 })).toBe('22:30-08:00');
  });
});
