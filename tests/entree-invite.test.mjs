// LES DÉCISIONS DE L'ESSAI D'ENTRÉE — celles qu'un bout-en-bout ne peut pas muter.
//
// ─── POURQUOI CE BANC EXISTE À CÔTÉ DE L'ESSAI ───────────────────────────────
//
// `scripts/essai-entree.mjs` joue le geste en vrai : il frappe un billet sur une
// ruche vivante, lance le script d'entrée, et attend l'invité. Ce qu'il ne peut
// PAS faire, c'est se tromper à volonté — on ne fabrique pas sur commande une
// ruche qui remet un billet sans commandes, ni un script d'entrée qui réinstalle
// par surprise.
//
// Ses trois décisions vivent donc à part, pures, où elles se mutent.
//
// C'est la même séparation que `premier-quart-heure.mjs` pour le pas 4/5, et
// pour la même raison : la partie où l'on se trompe est celle qu'on veut pouvoir
// faire rougir.

import { describe, expect, it } from 'vitest';
import {
  RAISON_ENTREE,
  defautDuBillet,
  noeudsConnus,
  nouveauNoeud,
  verdictEntree,
} from '../scripts/entree-invite.mjs';

/** Ce que la ruche remet quand tout va bien — la forme MESURÉE sur une ruche vivante. */
const BILLET = 'hive2_eyJ2IjoyfQ-abc_DEF';
const REPONSE = {
  billet: BILLET,
  id: 'b-1',
  url: 'ws://127.0.0.1:7911/ws',
  joinCommand: `npm run join -- ${BILLET}`,
  entree: {
    posix: `curl -fsSL https://exemple.test/rejoindre.sh | sh -s -- ${BILLET}`,
    windows: `irm https://exemple.test/rejoindre.ps1 -OutFile "…"; powershell -File "…" -Billet ${BILLET}`,
  },
};

describe('ce que le script d’entrée a FAIT', () => {
  it('LA RÉINSTALLATION L’EMPORTE — sinon l’essai mesure `main` et le dit vert', () => {
    // ─── L'ASSERTION QUI PORTE LE FICHIER ──────────────────────────────────
    //
    // La branche « installer » de `rejoindre.sh` va chercher `install.sh` SUR
    // LE DÉPÔT PUBLIC. Prise par accident — un `node_modules` oublié dans le
    // dossier d'invité suffit — l'essai mesurerait le code de `main` au lieu de
    // celui qu'on livre, en restant parfaitement vert.
    //
    // ⚠ CE CAS A ÉTÉ ÉCRIT FAUX UNE PREMIÈRE FOIS, et la mutation l'a dit.
    //
    // Il ne portait que le marqueur d'installation. Le mutant qui INVERSE les
    // deux tests SURVIVAIT (« 11 passed »), parce qu'aucune entrée ne les
    // opposait : la garde d'ordre n'était défendue par rien, et le cas avait
    // pourtant l'air de la défendre.
    //
    // L'entrée qui tranche doit porter LES DEUX. Aujourd'hui aucun vrai
    // parcours ne la produit — la branche « installer » n'imprime pas la ligne
    // de l'autre. C'est précisément pourquoi la garde compte : le jour où l'un
    // des deux jumeaux dira les deux choses (une trace ajoutée, un message
    // recopié), l'ordre décidera seul, et il doit décider dans le sens sûr.
    const lesDeux =
      '→ Installation de Hive dans /tmp/x…\n' +
      '→ Hive est déjà installé dans /tmp/x — on rejoint directement.\n' +
      '→ Entrée dans la ruche…';
    expect(verdictEntree(lesDeux), 'une réinstallation passe pour une entrée propre').toBe(
      'reinstalle',
    );
  });

  it('une installation reconnue est une ENTRÉE, pas une réinstallation', () => {
    expect(verdictEntree('→ Hive est déjà installé dans /tmp/x — on rejoint directement.')).toBe(
      'rejoint',
    );
    // Le jumeau PowerShell écrit SANS ACCENTS — la console Windows les rend en
    // mojibake. Le marqueur cherché doit donc survivre aux deux graphies, et
    // c'est le cas : « on rejoint directement » n'en porte aucun.
    expect(
      verdictEntree('-> Hive est deja installe dans C:\\x - on rejoint directement.'),
      'le jumeau PowerShell n’est pas reconnu',
    ).toBe('rejoint');
  });

  it('un silence ne se lit pas comme un succès', () => {
    // Un script mort avant d'avoir rien dit rendrait « rejoint » si l'on
    // partait du succès. On part de l'ignorance.
    expect(verdictEntree('')).toBe('inconnu');
    expect(verdictEntree(null)).toBe('inconnu');
    expect(verdictEntree('✘ Ce billet n’a pas la forme attendue')).toBe('inconnu');
    // Chaque verdict a sa phrase : un essai qui échoue en disant « ce n'est pas
    // ça » oblige à rouvrir le code.
    for (const v of ['rejoint', 'reinstalle', 'inconnu']) {
      expect(RAISON_ENTREE[v]?.length, v).toBeGreaterThan(10);
    }
  });
});

describe('le billet que la ruche VIVANTE remet', () => {
  it('la réponse nominale ne porte AUCUN défaut — sinon le banc ne mesure rien', () => {
    // Une garde qui refuserait le cas normal serait retirée le lendemain.
    expect(defautDuBillet(REPONSE), 'une réponse saine est refusée').toBeNull();
  });

  it('UNE RUCHE SANS COMMANDES D’ENTRÉE EST UN DÉFAUT, PAS UN DÉTAIL', () => {
    // ─── CE QU'AUCUN BANC PUR NE PEUT DIRE ─────────────────────────────────
    //
    // `commande-entree.ts` est éprouvé sur des billets fabriqués à la main. Que
    // la ROUTE les remette vraiment, seule une ruche vivante peut le prouver :
    // un champ renommé côté serveur, et le panneau retombe sur `joinCommand`
    // sans qu'un seul test unitaire ne bouge. L'invité se retrouve devant le
    // parcours en deux temps qu'on vient justement de retirer.
    expect(defautDuBillet({ ...REPONSE, entree: undefined })).toMatch(/deux temps/);
    expect(defautDuBillet({ ...REPONSE, entree: { posix: REPONSE.entree.posix } })).toMatch(
      /windows/,
    );
    expect(defautDuBillet({ ...REPONSE, entree: { ...REPONSE.entree, posix: '' } })).toMatch(
      /posix/,
    );
  });

  it('UNE COMMANDE QUI NE PORTE PAS LE BILLET N’OUVRE RIEN', () => {
    // Le cas est plus vicieux que l'absence : la commande EXISTE, elle a l'air
    // juste, elle se copie, elle se colle — et elle installe Hive chez l'invité
    // sans jamais le faire entrer nulle part.
    const sansBillet = {
      ...REPONSE,
      entree: { ...REPONSE.entree, posix: 'curl -fsSL https://exemple.test/rejoindre.sh | sh' },
    };
    expect(defautDuBillet(sansBillet)).toMatch(/ne porte pas le billet/);
  });

  it('DEUX SYSTÈMES, DEUX INVOCATIONS — une commande POSIX dans PowerShell ne dit rien', () => {
    const jumelles = {
      ...REPONSE,
      entree: { posix: REPONSE.entree.posix, windows: REPONSE.entree.posix },
    };
    expect(defautDuBillet(jumelles)).toMatch(/identiques/);
  });

  it('ce qui n’est pas un billet du tout est refusé d’abord', () => {
    expect(defautDuBillet({})).toMatch(/hive2_/);
    expect(defautDuBillet(null)).toMatch(/hive2_/);
    expect(defautDuBillet({ ...REPONSE, billet: 'deadbeef' })).toMatch(/hive2_/);
  });
});

describe('l’invité EST-IL entré ?', () => {
  const etat = (...ids) => ({ nodes: ids.map((id) => ({ id, status: 'online' })) });

  it('COMPTER LES NŒUDS NE MESURERAIT RIEN — l’essai en a déjà un', () => {
    // ─── LA RAISON D'ÊTRE DU RELEVÉ D'AVANT ────────────────────────────────
    //
    // L'essai de seuil lance `npm run ruche` SANS DRAPEAU : la Reine, une
    // ouvrière, et l'écran. Il y a donc déjà un nœud connecté quand l'invité
    // arrive. Une garde qui compterait les nœuds serait verte avant même que le
    // script d'entrée ne soit lancé — du décor, pas une mesure.
    const avant = noeudsConnus(etat('node-ouvriere-locale'));
    expect(avant.has('node-ouvriere-locale')).toBe(true);

    // Rien de neuf : l'ouvrière locale seule ne prouve pas l'entrée.
    expect(
      nouveauNoeud(etat('node-ouvriere-locale'), avant),
      'l’ouvrière déjà là passe pour l’invité',
    ).toBeNull();

    // L'invité arrive.
    expect(nouveauNoeud(etat('node-ouvriere-locale', 'node-invite'), avant)).toBe('node-invite');
  });

  it('un instantané sans nœuds, ou informe, ne fabrique pas d’invité', () => {
    expect(nouveauNoeud({ nodes: [] }, new Set())).toBeNull();
    expect(nouveauNoeud({}, new Set())).toBeNull();
    expect(nouveauNoeud(null, new Set())).toBeNull();
    // Un nœud sans identifiant n'est pas un invité : le prendre rendrait un
    // verdict positif sur une ligne vide.
    expect(nouveauNoeud({ nodes: [{ status: 'online' }, { id: '' }] }, new Set())).toBeNull();
  });

  it('le relevé d’avant accepte aussi bien un tableau qu’un ensemble', () => {
    // L'appelant relève une fois et interroge N fois ; qu'il passe l'un ou
    // l'autre ne doit pas changer le verdict.
    expect(nouveauNoeud(etat('a', 'b'), ['a'])).toBe('b');
    expect(nouveauNoeud(etat('a', 'b'), new Set(['a']))).toBe('b');
    expect(noeudsConnus({}).size).toBe(0);
    expect(noeudsConnus({ nodes: [{ id: 'a' }, {}, { id: '' }] }).size).toBe(1);
  });
});
