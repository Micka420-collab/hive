// Le rendez-vous des ponts d'un nœud : ce qu'un nœud TUÉ laisse, le démarrage
// suivant l'efface — sans jamais toucher au rendez-vous d'un nœud vivant.
//
// Un `kill -9` n'appelle pas `stop()` : sans ce balayage, chaque nœud tué
// laisserait un dossier 0700 sous le dossier temporaire du système, pour
// toujours. Et un balayage trop large effacerait le socket d'un nœud voisin
// en pleine tâche — sa tâche Claude Code ou Codex perdrait son pont.

import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { balayerPontsOrphelins, RendezVousPont } from '../src/node-client/rendez-vous-pont.js';
import { PREFIXE_PONT } from '../src/shared/empreinte.js';

let tmp = '';

afterEach(() => {
  vi.unstubAllEnvs();
  if (tmp) rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
  tmp = '';
});

/**
 * Un dossier temporaire du système à part, pour ne balayer que le nôtre.
 * Préfixe COURT : sous macOS, le dossier temporaire réel
 * (`/private/var/folders/xx/…/T`, 57 octets) plus ce niveau de banc plus le
 * rendez-vous frôlent déjà la borne `sun_path` de 103 octets — `hive-rdv-` y
 * menait à 104, et le banc aurait mesuré son propre préfixe, pas le module.
 */
function tmpDuBanc(): string {
  tmp = realpathSync(mkdtempSync(path.join(os.tmpdir(), 'rdv-')));
  for (const v of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(v, tmp);
  expect(os.tmpdir()).toBe(tmp);
  return tmp;
}

/** Le pid d'un processus qui a existé et n'existe plus. */
function pidMort(): number {
  const r = spawnSync(process.execPath, ['-e', 'process.stdout.write(String(process.pid))']);
  return Number(r.stdout.toString());
}

describe('rendez-vous des ponts de délégation', () => {
  it('le démarrage efface le rendez-vous d’un nœud mort, jamais celui d’un vivant', () => {
    const dossier = tmpDuBanc();
    const mort = path.join(dossier, `${PREFIXE_PONT}${pidMort()}-AbC123`);
    mkdirSync(path.join(mort, 'XyZ789'), { recursive: true, mode: 0o700 });
    writeFileSync(path.join(mort, 'XyZ789', 'mcp.json'), '{}');
    // Un nœud vivant (ce processus) avec un pont ouvert.
    const vivant = new RendezVousPont();
    const pont = vivant.reserver();
    // Un nom qui ressemble sans être le nôtre : jamais touché.
    const etranger = path.join(dossier, `${PREFIXE_PONT}autre-chose`);
    mkdirSync(etranger);

    expect(balayerPontsOrphelins()).toEqual([mort]);
    expect(existsSync(mort)).toBe(false);
    expect(existsSync(pont.dossier)).toBe(true);
    expect(existsSync(etranger)).toBe(true);

    vivant.fermer();
    expect(existsSync(path.dirname(pont.dossier)), 'l’arrêt du nœud efface son rendez-vous').toBe(
      false,
    );
  });

  it('un nœud ARRÊTÉ n’ouvre plus de pont — une tâche annulée qui finit de se dérouler ne laisse rien ; le démarrage les rouvre', () => {
    const dossier = tmpDuBanc();
    const rdv = new RendezVousPont();
    rdv.fermer();
    expect(() => rdv.reserver()).toThrow(/nœud arrêté/);
    expect(
      readdirSync(dossier).filter((n) => n.startsWith(PREFIXE_PONT)),
      'rien créé après l’arrêt : personne ne l’effacerait',
    ).toEqual([]);
    rdv.ouvrir();
    const pont = rdv.reserver();
    expect(existsSync(pont.dossier)).toBe(true);
    rdv.fermer();
    expect(existsSync(path.dirname(pont.dossier))).toBe(false);
  });

  // Hors Windows : le dossier temporaire et le dépôt y vivent souvent sur deux
  // lecteurs (`C:` / `D:` en CI), entre lesquels aucun chemin relatif n'existe.
  it.skipIf(process.platform === 'win32')(
    'un TMPDIR relatif donne quand même un socket ABSOLU — le CLI le résout depuis la tâche',
    () => {
      // Le serveur MCP enfant part dans le dossier de la tâche : un socket
      // relatif y pointerait ailleurs (ENOENT), et Claude Code tournerait sans
      // les outils de délégation sans rien dire.
      const dossier = tmpDuBanc();
      const relatif = path.relative(process.cwd(), dossier);
      expect(path.isAbsolute(relatif)).toBe(false);
      for (const v of ['TMPDIR', 'TEMP', 'TMP']) vi.stubEnv(v, relatif);
      const rdv = new RendezVousPont();
      try {
        const pont = rdv.reserver();
        expect(path.isAbsolute(pont.dossier), pont.dossier).toBe(true);
        expect(pont.dossier.startsWith(dossier + path.sep), pont.dossier).toBe(true);
        expect(path.isAbsolute(pont.extremite)).toBe(true);
      } finally {
        rdv.fermer();
      }
    },
  );

  it.skipIf(process.platform === 'win32')(
    'un dossier temporaire trop profond est dit AVANT toute création, avec sa cause',
    () => {
      const profond = path.join(tmpDuBanc(), 'd'.padEnd(110, 'd'));
      mkdirSync(profond);
      vi.stubEnv('TMPDIR', profond);
      const rdv = new RendezVousPont();
      expect(rdv.alerte()).toMatch(/trop long.*TMPDIR/s);
      expect(() => rdv.reserver()).toThrow(/socket du pont de délégation trop long/);
      expect(readdirSync(profond), 'rien créé').toEqual([]);
    },
  );
});
