// LA SONDE D'ISOLEMENT — le client répond, le service est mort.
//
// ─── LE FAUX VERT QUE CE BANC FERME ──────────────────────────────────────────
//
// `hive doctor` affichait, sur une machine sans démon Docker :
//
//     ✔ isolement      bac à sable disponible : docker
//
// La sonde lançait `docker --version`, qui répond 0 EN LISANT UNE CONSTANTE,
// sans jamais ouvrir la socket du démon. Mesuré dans le conteneur où le défaut
// a été trouvé, sans tube (§ « CODE=$? sans tube ») :
//
//     docker --version  → code=0   Docker version 29.3.1, build c2be9cc
//     docker info       → code=1   failed to connect to the docker API at
//                                  unix:///var/run/docker.sock
//
// Ce que l'arrivant vivait juste après : sa première tâche ratée TROIS FOIS,
// zéro diff à chaque tentative, et le message brut du démon rangé dans les
// journaux. Le docteur — dont c'est la raison d'être — lui avait dit que tout
// allait bien.
//
// ─── COMMENT CE DÉFAUT A ÉTÉ TROUVÉ ──────────────────────────────────────────
//
// Par le pas 7/7 (`scripts/essai-travail.mjs`), écrit le même jour parce que le
// parcours de seuil s'arrêtait à « un invité est dans la ruche » et ne menait
// jamais un travail jusqu'à un résultat. À sa PREMIÈRE exécution contre une
// ruche réellement installée :
//
//     ✘ 7/7 — la ruche a pris le travail et l'a raté (334d09b5…)
//
// Comme les pas 4/5 et 6/6 avant lui, il a trouvé un défaut réel du premier
// coup. C'est ce que vaut un pas qui joue vraiment le geste.
//
// ─── CE QUI ÉTAIT NU, ET CE QUE LA MESURE A DIT ──────────────────────────────
//
// Deux mutants, chacun vérifié posé. Le premier remet le faux vert, le second
// rend un fournisseur sans rien lancer du tout.
//
// LA MESURE DE NUDITÉ A ÉTÉ REFAITE : le premier crible avait TROIS fichiers au
// rouge, et aucun ne venait des mutants — une ruche laissée tourner sur le port
// 7777 par l'épreuve manuelle polluait les bancs d'installeur. Un crible se lit
// sur une suite verte, sinon il attribue à la garde ce qui vient du décor
// (§ 9 quincenties, ici payé sur ma propre pollution).

import { describe, expect, it } from 'vitest';
import { SONDE_ISOLEMENT, isolementDisponible } from '../src/doctor-releve.js';
import { FOURNISSEURS } from '../src/node-client/isolement.js';
import type { Fournisseur } from '../src/node-client/isolement.js';

/** Ce que chaque fournisseur s'est vu demander. */
type Demande = { bin: string; args: readonly string[] };

/**
 * Un lanceur de laboratoire.
 *
 * `repond` décide, à partir de l'argument, si le binaire rend 0 — c'est
 * exactement la distinction qu'on éprouve : le client parle, le service non.
 */
function lanceur(repond: (bin: string, args: readonly string[]) => boolean) {
  const vues: Demande[] = [];
  const lancer = (bin: string, args: readonly string[]): Promise<boolean> => {
    vues.push({ bin, args });
    return Promise.resolve(repond(bin, args));
  };
  return { lancer, vues };
}

describe('la sonde d’isolement interroge le SERVICE, pas le client', () => {
  it('UN FOURNISSEUR JOIGNABLE EST RENDU — sinon rien ici ne mesure rien', async () => {
    // ─── LE CAS NOMINAL, ÉCRIT EN PREMIER (§ 9 unvicicenties) ──────────────
    const { lancer } = lanceur(() => true);
    expect(await isolementDisponible(lancer)).toBe(FOURNISSEURS[0]!.nom);
  });

  it('LE CLIENT RÉPOND, LE DÉMON EST MORT : AUCUN BAC À SABLE', async () => {
    // ─── L'ENTRÉE QUI SÉPARE LES DEUX SONDES ───────────────────────────────
    //
    // C'est la SEULE machine qui les départage. Là où le démon tourne, les deux
    // versions rendent « docker » ; là où rien n'est installé, les deux rendent
    // `null`. Le poste d'un arrivant qui a le client sans le service — un
    // Docker Desktop pas démarré, un démon arrêté, un conteneur sans socket —
    // est exactement le cas où le docteur mentait.
    const { lancer, vues } = lanceur((_bin, args) => args[0] === '--version');

    expect(
      await isolementDisponible(lancer),
      'un client sans démon passe pour un bac à sable disponible',
    ).toBeNull();

    // Et l'on vérifie ce qui a été DEMANDÉ, pas seulement ce qui est rendu :
    // un `null` obtenu en ne lançant rien du tout serait vert pour la mauvaise
    // raison.
    expect(
      vues.map((v) => v.bin),
      'les fournisseurs ne sont pas tous sondés',
    ).toEqual(FOURNISSEURS.map((f: Fournisseur) => f.bin));
    for (const v of vues) {
      expect(v.args, `« ${v.bin} » n’est pas interrogé sur son service`).toEqual([SONDE_ISOLEMENT]);
    }
  });

  it('AUCUN BINAIRE : AUCUN BAC À SABLE — et tous ont été essayés', async () => {
    const { lancer, vues } = lanceur(() => false);
    expect(await isolementDisponible(lancer)).toBeNull();
    expect(vues, 'un fournisseur a été écarté sans être essayé').toHaveLength(FOURNISSEURS.length);
  });

  it('LE PREMIER QUI RÉPOND ARRÊTE LA RECHERCHE — on ne sonde pas pour rien', async () => {
    // L'ordre de `FOURNISSEURS` est une préférence (podman d'abord : sans démon,
    // sans root). Le second ne doit pas être interrogé quand le premier a dit
    // oui — et c'est aussi ce qui garantit que le nom rendu est le PRÉFÉRÉ, pas
    // le dernier essayé.
    const premier = FOURNISSEURS[0]!;
    const { lancer, vues } = lanceur((bin) => bin === premier.bin);

    expect(await isolementDisponible(lancer)).toBe(premier.nom);
    expect(vues, 'la recherche continue après avoir trouvé').toHaveLength(1);
  });

  it('LA QUESTION POSÉE TOUCHE LE DÉMON — « --version » ne le fait pas', () => {
    // La constante est nommée pour qu'on puisse la lire ici. Ce cas n'est pas un
    // doublon du deuxième : celui-là éprouve le COMPORTEMENT, celui-ci ancre la
    // RAISON, pour que le prochain lecteur ne « simplifie » pas `info` en
    // `--version` en croyant alléger la sonde.
    expect(SONDE_ISOLEMENT, 'la sonde est retombée sur une lecture de constante').not.toBe(
      '--version',
    );
    expect(SONDE_ISOLEMENT, 'la sonde n’interroge plus le service').toBe('info');
  });
});
