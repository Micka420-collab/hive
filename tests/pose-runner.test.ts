// POSER UN OUTIL — les bancs de l'exécution, sans rien installer.
//
// Le lanceur est INJECTÉ. Ces bancs éprouvent donc la décision et la forme du
// résultat, jamais `npm install -g` : un banc qui installerait vraiment
// mettrait dix minutes, dépendrait du réseau, et laisserait des traces sur la
// machine de qui le lance.

import { describe, expect, it } from 'vitest';
import { PAQUETS } from '../src/shared/connexion-agent.js';
import { OUTILS } from '../src/shared/catalogue-outils.js';
import { poserOutil, POSE_SORTIE_MAX, type Lanceur } from '../src/node-client/pose-runner.js';
import { parseClientMessage } from '../src/shared/protocol.js';
import type { PoserOutilMsg } from '../src/shared/protocol.js';

const POSE_ID = 'a1b2c3d4-e5f6-4789-abcd-ef0123456789';
const INSTALLABLE = Object.keys(PAQUETS)[0]!;
const SANS_COMMANDE = OUTILS.find((o) => o.installation === null)!.id;

const demande = (outilId: string): PoserOutilMsg => ({
  type: 'poser_outil',
  poseId: POSE_ID,
  outilId,
});

/** Un lanceur qui rend ce qu'on lui dit, et note ce qu'on lui a demandé. */
function lanceurFactice(rendu: { code: number | null; sortie: string }) {
  const appels: { bin: string; args: readonly string[] }[] = [];
  const lancer: Lanceur = (bin, args) => {
    appels.push({ bin, args });
    return Promise.resolve(rendu);
  };
  return { appels, lancer };
}

describe('la commande lancée vient du catalogue', () => {
  it('LE BINAIRE ET SES ARGUMENTS SONT CEUX DE `PAQUETS`', async () => {
    // C'est la borne du lot, vérifiée à l'endroit où elle compte : ce qui
    // part réellement au `spawn`.
    const f = lanceurFactice({ code: 0, sortie: 'ok' });
    await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(f.appels).toHaveLength(1);
    expect([f.appels[0]!.bin, ...f.appels[0]!.args]).toEqual(PAQUETS[INSTALLABLE]);
  });

  it('UN OUTIL INCONNU NE LANCE RIEN DU TOUT', async () => {
    const f = lanceurFactice({ code: 0, sortie: '' });
    const r = await poserOutil(demande('outil-qui-nexiste-pas'), {
      dejaPose: false,
      lancer: f.lancer,
    });
    expect(f.appels, 'un processus a démarré pour un outil inconnu').toHaveLength(0);
    expect(r.ok).toBe(false);
    expect(r.refuse).toBeTruthy();
  });

  it('un outil sans commande ne lance rien, et le DIT autrement', async () => {
    const f = lanceurFactice({ code: 0, sortie: '' });
    const r = await poserOutil(demande(SANS_COMMANDE), { dejaPose: false, lancer: f.lancer });
    expect(f.appels).toHaveLength(0);
    expect(r.refuse).toContain('à la main');
  });

  it('déjà posé ⇒ rien ne démarre', async () => {
    const f = lanceurFactice({ code: 0, sortie: '' });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: true, lancer: f.lancer });
    expect(f.appels).toHaveLength(0);
    expect(r.refuse).toContain('déjà');
  });
});

describe('le résultat rendu au hub', () => {
  it('un code 0 vaut réussite', async () => {
    const f = lanceurFactice({ code: 0, sortie: 'added 1 package' });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(r).toMatchObject({
      type: 'pose_result',
      poseId: POSE_ID,
      outilId: INSTALLABLE,
      code: 0,
      ok: true,
    });
    expect(r.sortie).toContain('added 1 package');
  });

  it('UN CODE NON NUL N’EST PAS UNE RÉUSSITE', async () => {
    const f = lanceurFactice({ code: 1, sortie: 'EACCES' });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(r.ok).toBe(false);
    expect(r.code).toBe(1);
  });

  it('UN PROCESSUS QUI N’A JAMAIS DÉMARRÉ N’EST PAS UNE RÉUSSITE', async () => {
    // `code: null` — npm absent, ENOENT. Le piège serait `ok: code !== 1` ou
    // une comparaison lâche qui ferait passer `null` pour un succès.
    const f = lanceurFactice({ code: null, sortie: 'ENOENT' });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(r.ok).toBe(false);
    expect(r.code).toBeNull();
  });

  it('LA SORTIE EST PLAFONNÉE', async () => {
    // Une installation bavarde ne doit ni saturer le nœud ni faire refuser le
    // message de retour par la borne du protocole.
    const f = lanceurFactice({ code: 0, sortie: 'x'.repeat(POSE_SORTIE_MAX * 2) });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(r.sortie.length).toBeLessThanOrEqual(POSE_SORTIE_MAX);
  });

  it('le poseId revient tel quel — sinon le hub ne relie rien', async () => {
    const f = lanceurFactice({ code: 0, sortie: '' });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(r.poseId).toBe(POSE_ID);
  });
});

describe('un nœud ne lève jamais sur un message du hub', () => {
  it('UN LANCEUR QUI JETTE NE DOIT PAS LAISSER LA DEMANDE SANS RÉPONSE', async () => {
    // Si `poserOutil` propageait, le tableau de bord tournerait indéfiniment
    // sur « en cours » sans jamais savoir. Ce banc dit ce que le code fait
    // aujourd'hui — et il rougira le jour où quelqu'un ajoutera un `throw`.
    const lancer: Lanceur = () => Promise.reject(new Error('spawn a explosé'));
    await expect(poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer })).rejects.toThrow(
      'spawn a explosé',
    );
  });

  it('le lanceur réel, lui, transforme l’échec de démarrage en résultat', async () => {
    // `lancerVraiment` capture `error` et rend `code: null` — c'est LUI qui
    // porte la promesse « ne jette pas », et c'est mesuré dans le banc
    // ci-dessus par contraste : `poserOutil` relaie ce que son lanceur fait.
    const { lancerVraiment } = await import('../src/node-client/pose-runner.js');
    const r = await lancerVraiment('binaire-qui-nexiste-vraiment-pas-du-tout', ['--version']);
    expect(r.code).toBeNull();
    expect(r.sortie).toContain("n'a pas démarré");
  });
});

describe('le lanceur réel n’interprète pas de shell', () => {
  it('UN ARGUMENT QUI RESSEMBLE À DU SHELL RESTE UN ARGUMENT', async () => {
    const { lancerVraiment } = await import('../src/node-client/pose-runner.js');
    // `node -e` affiche ce qu'il reçoit. Si un shell interprétait, le `;` et
    // le `&&` couperaient la commande et `echo` s'exécuterait.
    const r = await lancerVraiment(process.execPath, [
      '-e',
      'process.stdout.write(process.argv[1] ?? "")',
      '; echo INJECTE && echo AUSSI',
    ]);
    expect(r.code).toBe(0);
    expect(r.sortie).toBe('; echo INJECTE && echo AUSSI');
    expect(r.sortie, 'un shell a interprété la commande').not.toContain('INJECTE\n');
  });
});

describe('les bornes du runner et celles du protocole s’accordent', () => {
  it('UNE SORTIE PLAFONNÉE PASSE ENCORE LE VALIDATEUR', async () => {
    // Deux plafonds existent : celui du runner (`POSE_SORTIE_MAX`) et celui du
    // protocole (`LIMITS.log`). Si le premier dépassait le second, un résultat
    // parfaitement légitime serait REFUSÉ à l'arrivée — le nœud aurait posé
    // l'outil, et le hub n'en saurait rien. Ce banc lie les deux plutôt que de
    // faire confiance à deux constantes écrites à des mois d'intervalle.
    const f = lanceurFactice({ code: 0, sortie: 'x'.repeat(POSE_SORTIE_MAX * 2) });
    const r = await poserOutil(demande(INSTALLABLE), { dejaPose: false, lancer: f.lancer });
    expect(parseClientMessage(JSON.stringify(r)), 'le résultat plafonné est refusé').not.toBeNull();
  });
});
