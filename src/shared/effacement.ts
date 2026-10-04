// Effacer un arbre que git a rempli — la seule porte par laquelle la ruche
// efface récursivement ce qu'un fichier tenu peut retenir : le dossier d'une
// tâche et ses voisins (TEMP, registre, réserve, rejeux à part de la base et de
// l'arbre livré), le miroir de la porte de sécurité, les clones de fusion et de
// chantier, le TEMP et le transit d'une fusion — chez le nœud —, le miroir d'un
// projet et son reclone voisin — chez la Reine.
//
// Une seule porte parce que le piège est le même partout, et qu'il ne se voit
// que sous Windows : le miroir de la Reine effaçait encore avec les `maxRetries`
// de `fs.rm` après que le nœud en était sorti (#538), et un fichier tenu dans le
// miroir faisait attendre la suppression d'un projet une journée.

import { promises as fs } from 'node:fs';
import { setTimeout as attendre } from 'node:timers/promises';

/** Les codes que le rimraf de Node reprend lui-même (`retryErrorCodes`). */
const VERROUS_PASSAGERS = new Set(['EBUSY', 'EMFILE', 'ENFILE', 'ENOTEMPTY', 'EPERM']);

/** Reprises de l'effacement ENTIER : 100 ms, 200 ms… 1 s — 5,5 s d'attente au plus. */
const REPRISES = 10;

/**
 * Efface `chemin` et tout ce qu'il contient — sous le Node du terminal comme
 * sous l'Electron de l'app de bureau. Un chemin absent n'est pas une erreur.
 * Lève l'erreur du disque, son `code` et son `path` — tout de suite si elle
 * n'est pas passagère (EACCES), sinon au bout des reprises : c'est à
 * l'appelant de la DIRE.
 *
 * ─── `rmSync` N'Y ARRIVE PAS DANS L'APP, SOUS WINDOWS ────────────────────────
 *
 * Depuis nodejs/node#53617, `fs.rmSync` est du C++ posé sur
 * `std::filesystem::remove_all`. La STL de MSVC (le Node officiel) efface un
 * fichier en lecture seule ; la libc++, avec laquelle Electron compile Node,
 * le REFUSE (nodejs/node#64374, electron/electron#52253). Or git pose ses
 * objets et ses packs en lecture seule. Dans Hive 0.5.0 (Electron 44), tout
 * dossier de tâche qui avait vu un clone devenait ineffaçable : « EPERM,
 * Permission denied » à la tentative suivante, la tâche refusée
 * (« clone impossible ») de nœud en nœud sans qu'aucun agent ne tourne. Le
 * banc Node officiel de la CI ne pouvait pas le voir ; l'étape « effacement
 * sous Electron » d'`app-bureau.yml` le voit.
 *
 * `fs.promises.rm` passe par le rimraf JavaScript de Node et les appels de
 * libuv, dont `unlink` passe outre l'attribut lecture seule sous Windows —
 * et rimraf refait un `chmod` sur EPERM. Le même geste partout, quelle que
 * soit la STL.
 *
 * ─── LES REPRISES SONT ICI, PAS DANS SES `maxRetries` ────────────────────────
 *
 * Les reprises absorbent les verrous passagers de Windows (antivirus, handle
 * git résiduel) sans bloquer le fil du processus — les `maxRetries` de
 * `rmSync` y dormaient, battements de cœur compris. Mais celles de
 * `fs.promises.rm` se MULTIPLIENT par la profondeur : son rimraf relance
 * chaque sous-dossier avec ses propres reprises (`_rmchildren` rappelle
 * `rimraf`). Un fichier tenu sous `.git/objects/pack/` coûtait 11⁵ essais,
 * près de 25 heures à dix reprises de 100 ms : le refus qui nomme le dossier
 * tenu ne partait jamais — la tâche restait « en cours » sans agent
 * (`dossier-tache-tenu.test.ts`), la suppression d'un projet ne répondait pas
 * (`miroir-tenu.test.ts`). Reprendre l'effacement ENTIER garde le budget
 * d'avant — dix reprises, 5,5 s d'attente — à toute profondeur. Ne jamais lui
 * passer `maxRetries` : la multiplication reviendrait avec.
 */
export async function effacerDossier(chemin: string): Promise<void> {
  for (let reprise = 0; ; reprise++) {
    try {
      return await fs.rm(chemin, { recursive: true, force: true });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code ?? '';
      if (reprise === REPRISES || !VERROUS_PASSAGERS.has(code)) throw err;
      await attendre((reprise + 1) * 100);
    }
  }
}
