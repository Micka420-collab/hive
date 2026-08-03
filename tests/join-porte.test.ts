// `hive join` — 107 lignes à 0 %, et c'est la porte DES AMIS.
//
// ─── POURQUOI CE CHEMIN PASSE DEVANT ─────────────────────────────────────────
//
// L'analyse du 3 août a montré `src/node-client/join.ts` jamais exécuté par un
// test. C'est le chemin B : celui de quelqu'un qui n'a pas lu `.env.example`,
// qui fait confiance à l'ami qui lui a envoyé le billet, et qui colle une
// longue chaîne dans son terminal. Chaque sortie de ce fichier est le PREMIER
// message que cette personne lit — et un billet, c'est un secret.
//
// ─── CE QU'ON TESTE, ET CE QU'ON NE PEUT PAS ─────────────────────────────────
//
// `join.ts` s'exécute à l'import (`await main()` en bas de fichier) : il se
// teste donc en SOUS-PROCESSUS, comme le CLI. Trois sorties précoces sont
// entièrement déterministes sans ruche :
//
//   · une invitation difforme → refus net, code 1 ;
//   · aucun billet et pas de terminal → code 3 (REPONSE_MANQUANTE), avec les
//     deux issues imprimées — c'est la garde anti-blocage des scripts et CI ;
//   · un billet valide vers une ruche injoignable → « Ruche injoignable »,
//     code 1, APRÈS avoir affiché l'URL réelle de connexion.
//
// Le démarrage RÉUSSI (client démarré, WebSocket ouvert) demande une ruche
// vivante : c'est le territoire de `join-cle.test.ts` et des tests d'e2e — pas
// d'ici, et ça se dit.

import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { encoderBillet } from '../src/shared/acces.js';
import { CODE } from '../src/codes-sortie.js';

const execFileAsync = promisify(execFile);
const RACINE = fileURLToPath(new URL('..', import.meta.url));
const JOIN = path.join(RACINE, 'src', 'node-client', 'join.ts');

const aNettoyer: string[] = [];
afterEach(() => {
  for (const d of aNettoyer.splice(0)) rmSync(d, { recursive: true, force: true });
});

/**
 * Lance `join` pour de vrai.
 *
 * Le cwd est LE DÉPÔT — pas un dossier jetable : `--import tsx` se résout
 * depuis le répertoire courant, et un cwd sans `node_modules` faisait échouer
 * les quatre tests sur ERR_MODULE_NOT_FOUND avant la première ligne de `join`
 * (mesuré). L'état que `join` écrit part, lui, dans un `HIVE_WORKDIR` jetable.
 * Le `.env` relatif reste celui du dépôt — absent aujourd'hui ; si un `.env`
 * y apparaissait un jour, ces tests le liraient, et c'est dit ici.
 *
 * `HIVE_AGENT=shell` court-circuite la détection d'agents : ses sondes valent
 * jusqu'à 4 s chacune et ne sont pas le sujet de ce fichier.
 */
async function lancer(
  args: string[],
  env: Record<string, string | undefined> = {},
): Promise<{ code: number; sortie: string }> {
  const travail = mkdtempSync(path.join(tmpdir(), 'ruche-join-'));
  aNettoyer.push(travail);
  const propre: NodeJS.ProcessEnv = {
    ...process.env,
    NO_COLOR: '1',
    HIVE_AGENT: 'shell',
    HIVE_WORKDIR: travail,
    ...env,
  };
  // L'environnement ambiant ne doit pas répondre à notre place — mais SEULEMENT
  // quand le test ne fournit pas la variable lui-même. La première version
  // effaçait sans condition, APRÈS le spread de `env` : elle supprimait donc le
  // HIVE_INVITE que le quatrième test venait de poser, et la garde TTY
  // répondait à sa place (code 3 au lieu de 1, mesuré).
  if (!('HIVE_INVITE' in env)) delete propre.HIVE_INVITE;
  try {
    const { stdout, stderr } = await execFileAsync(
      process.execPath,
      ['--import', 'tsx', JOIN, ...args],
      { cwd: RACINE, encoding: 'utf8', timeout: 60_000, env: propre },
    );
    return { code: 0, sortie: `${stdout}${stderr}` };
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string };
    return { code: err.code ?? -1, sortie: `${err.stdout ?? ''}${err.stderr ?? ''}` };
  }
}

describe('la porte des amis — les trois refus qui doivent être nets', () => {
  it('UNE INVITATION DIFFORME EST REFUSÉE EN LE DISANT — code 1', async () => {
    const r = await lancer(['ceci-nest-pas-une-invitation']);
    expect(r.code).toBe(1);
    expect(r.sortie).toContain('Invitation invalide');
    // Le refus dit QUOI FAIRE, pas seulement non : c'est un ami perdu sinon.
    expect(r.sortie).toContain('invite');
  });

  it('SANS BILLET ET SANS TERMINAL, ON ÉCHOUE EN LE DISANT — jamais un prompt figé', async () => {
    // La garde anti-blocage : dans un script, un pipe ou une CI, il n'y a
    // personne pour répondre. Avant elle, le processus restait suspendu
    // jusqu'au délai de l'appelant, sans un mot. stdin d'un sous-processus
    // `execFile` n'est pas un TTY : on est exactement dans ce cas.
    const r = await lancer([]);
    expect(r.code, 'le code de sortie doit être REPONSE_MANQUANTE').toBe(CODE.REPONSE_MANQUANTE);
    // Les DEUX issues sont imprimées — l'argument et la variable d'environnement.
    expect(r.sortie).toContain('hive join hive2_');
    expect(r.sortie).toContain('HIVE_INVITE=');
  });

  it('UN BILLET VALIDE VERS UNE RUCHE INJOIGNABLE : l’URL est montrée, puis le refus — code 1', async () => {
    // Le billet est encodé par le VRAI encodeur — pas une chaîne bricolée qui
    // dériverait du format (§ 6.6 ter : on donne au code ce que le produit
    // fabrique). L'URL pointe sur un port fermé : l'échange HTTP échoue
    // proprement, et c'est CE message-là qu'un ami verra le plus souvent.
    const billet = encoderBillet({
      url: 'ws://127.0.0.1:9/ws',
      id: 'billet-test-injoignable',
      secret: 'secret-de-test-suffisamment-long-pour-le-format',
      label: 'Ruche de test',
    });
    const r = await lancer([billet]);
    expect(r.code).toBe(1);
    // L'URL RÉELLE d'abord : c'est là que partirait la clé, l'invité doit
    // pouvoir la vérifier avant tout échange.
    expect(r.sortie).toContain('ws://127.0.0.1:9/ws');
    expect(r.sortie).toContain('Ruche injoignable');
    // Et le libellé du billet est affiché — c'est lui que l'ami reconnaît.
    expect(r.sortie).toContain('Ruche de test');
  });

  it('HIVE_INVITE SUFFIT — pas d’argument, pas de terminal, et pourtant on avance', async () => {
    // La promesse imprimée par la garde du dessus doit être VRAIE : si
    // `HIVE_INVITE` était lu après le test du TTY, le conseil donné serait un
    // mensonge. Le billet est difforme À DESSEIN : atteindre « Invitation
    // invalide » prouve qu'on a dépassé la demande interactive.
    const r = await lancer([], { HIVE_INVITE: 'difforme-mais-present' });
    expect(r.code).toBe(1);
    expect(r.sortie, 'HIVE_INVITE a été ignoré — la garde TTY a répondu à sa place').toContain(
      'Invitation invalide',
    );
  });
});
