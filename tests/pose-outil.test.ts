// POSER UN OUTIL À DISTANCE — les bancs de la décision.
//
// Le tableau de bord LANCE désormais l'installation, décision de l'utilisateur
// prise en connaissance de la contrepartie. Ce que ces bancs défendent n'est
// donc pas « faut-il le permettre » — c'est tranché — mais la borne qui
// empêche la contrepartie de s'élargir toute seule :
//
//     le message porte un IDENTIFIANT, le catalogue décide de la commande.

import { describe, expect, it } from 'vitest';
import { OUTILS } from '../src/shared/catalogue-outils.js';
import { PAQUETS } from '../src/shared/connexion-agent.js';
import {
  commandeDePose,
  direRefusPose,
  jugerPose,
  type MotifRefusPose,
} from '../src/shared/pose-outil.js';

/** Un outil réellement installable, pris au catalogue plutôt qu'inventé. */
const INSTALLABLE = Object.keys(PAQUETS)[0]!;
/** Un outil du catalogue qui n'a PAS de commande — il y en a sept. */
const SANS_COMMANDE = OUTILS.find((o) => o.installation === null)!.id;

describe('le décor de ces bancs est le vrai catalogue', () => {
  it('les deux familles existent, sinon ces bancs ne prouvent rien', () => {
    // Un banc qui suppose son décor mesure le décor, pas le code. Si un jour
    // tous les outils deviennent installables, ce banc rougit et prévient que
    // la moitié des cas ci-dessous est devenue inatteignable.
    expect(Object.keys(PAQUETS).length, 'aucun outil installable').toBeGreaterThan(0);
    expect(
      OUTILS.filter((o) => o.installation === null).length,
      'aucun outil sans commande',
    ).toBeGreaterThan(0);
  });
});

describe('la commande vient du catalogue', () => {
  it('un outil installable rend SA commande, en arguments séparés', () => {
    const c = commandeDePose(INSTALLABLE);
    expect(c).not.toBeNull();
    expect(Array.isArray(c)).toBe(true);
    expect(c!.length, 'une commande vide ne pose rien').toBeGreaterThan(1);
    expect(c).toEqual(PAQUETS[INSTALLABLE]);
  });

  it('UN IDENTIFIANT INCONNU NE REND RIEN — jamais une commande devinée', () => {
    // C'est la borne entière du lot. Si cette ligne cède, le message réseau
    // redevient « exécute ceci » au lieu de « pose cet outil-là ».
    expect(commandeDePose('outil-qui-nexiste-pas')).toBeNull();
    expect(commandeDePose('')).toBeNull();
  });

  it('les clés héritées d’Object ne sont pas des outils', () => {
    // `PAQUETS['constructor']` rendrait une fonction sur un objet ordinaire.
    // La recherche passe par `hasOwnProperty`, pas par un accès direct.
    expect(commandeDePose('constructor')).toBeNull();
    expect(commandeDePose('toString')).toBeNull();
    expect(commandeDePose('__proto__')).toBeNull();
  });
});

describe('le verdict', () => {
  it('installable et absent ⇒ accordée, avec la commande', () => {
    const v = jugerPose({ outilId: INSTALLABLE, dejaPose: false });
    expect(v.accordee).toBe(true);
    if (v.accordee) expect(v.commande).toEqual(PAQUETS[INSTALLABLE]);
  });

  it('DÉJÀ POSÉ ⇒ REFUS, et le refus passe AVANT la recherche', () => {
    // Réinstaller par-dessus un binaire présent ne règle rien et peut casser
    // une installation que le membre a faite à sa façon.
    const v = jugerPose({ outilId: INSTALLABLE, dejaPose: true });
    expect(v.accordee).toBe(false);
    if (!v.accordee) expect(v.motif).toBe('deja-pose');
  });

  it('UN OUTIL CONNU MAIS SANS COMMANDE N’EST PAS « INCONNU »', () => {
    // Sept outils du catalogue s'installent à la main. Les annoncer
    // « inconnus » enverrait le membre chercher une faute de frappe dans un
    // identifiant parfaitement juste.
    const v = jugerPose({ outilId: SANS_COMMANDE, dejaPose: false });
    expect(v.accordee).toBe(false);
    if (!v.accordee) expect(v.motif).toBe('sans-commande');
  });

  it('un identifiant hors catalogue ⇒ inconnu', () => {
    const v = jugerPose({ outilId: 'outil-qui-nexiste-pas', dejaPose: false });
    expect(v.accordee).toBe(false);
    if (!v.accordee) expect(v.motif).toBe('outil-inconnu');
  });

  it('« déjà posé » l’emporte même sur un identifiant inconnu', () => {
    // L'ordre est délibéré : si la machine dit qu'elle a déjà l'outil, la
    // question de savoir si le catalogue le connaît ne se pose plus.
    const v = jugerPose({ outilId: 'outil-qui-nexiste-pas', dejaPose: true });
    expect(v.accordee).toBe(false);
    if (!v.accordee) expect(v.motif).toBe('deja-pose');
  });
});

describe('ce qu’on dit au membre', () => {
  const MOTIFS: readonly MotifRefusPose[] = ['outil-inconnu', 'sans-commande', 'deja-pose'];

  it('chaque motif a sa phrase, et elles diffèrent', () => {
    const fr = new Set(MOTIFS.map((m) => direRefusPose(m)));
    expect(fr.size, 'deux motifs rendent la même phrase').toBe(MOTIFS.length);
  });

  it('LES DEUX LANGUES, DANS LES DEUX SENS', () => {
    for (const m of MOTIFS) {
      const fr = direRefusPose(m, 'fr');
      const en = direRefusPose(m, 'en');
      expect(fr, `motif ${m} : fr et en identiques`).not.toBe(en);
    }
    // Et la forme, pour qu'un `lang === 'en'` inversé ne reste pas vert.
    expect(direRefusPose('deja-pose', 'fr')).toContain('déjà posé');
    expect(direRefusPose('deja-pose', 'fr')).not.toContain('already installed');
    expect(direRefusPose('deja-pose', 'en')).toContain('already installed');
    expect(direRefusPose('deja-pose', 'en')).not.toContain('déjà posé');
  });

  it('le français est le défaut', () => {
    expect(direRefusPose('sans-commande')).toBe(direRefusPose('sans-commande', 'fr'));
  });

  it('« sans commande » dit que ça se pose À LA MAIN', () => {
    // Sinon le membre lit « non » sans savoir qu'il y a une issue.
    expect(direRefusPose('sans-commande', 'fr')).toContain('à la main');
    expect(direRefusPose('sans-commande', 'en')).toContain('by hand');
  });
});
