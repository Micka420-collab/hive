// LA PASTILLE D'ALERTES — ce qui l'allume, et ce qui doit la laisser éteinte.
//
// Une pastille de navigation est une promesse minuscule et coûteuse : allumée à
// tort, elle envoie chercher un problème qui n'existe pas ; éteinte à tort, elle
// laisse passer un `effacement_imminent` que rien ne rattrape.
//
// Les trois règles éprouvées ici sont exactement celles qu'un JSX aurait
// enfouies hors d'atteinte : `null` n'est pas « info », un serveur sans
// `graviteMax` n'allume rien, et la gravité vient du SERVEUR — jamais d'un
// classement refait dans l'écran.

import { describe, expect, it } from 'vitest';
import {
  ENTREE_PASTILLE,
  compteAffiche,
  doitSonder,
  pastilleDesAlertes,
  phraseAlertes,
  porteLaPastille,
} from '../dashboard/src/views/pastille-alertes.js';
import type { Pastille } from '../dashboard/src/views/pastille-alertes.js';

/** Un tableau quelconque : seuls le nombre d'alertes et la gravité comptent. */
const source = (nb: number, graviteMax: Pastille['gravite'] | null) => ({
  alertes: Array.from({ length: nb }, (_, i) => ({ i })),
  graviteMax,
});

describe('le câblage, sorti du JSX parce que la loupe l’a trouvé NU', () => {
  // Ces trois règles vivaient dans le rendu de `App.tsx`. La loupe les a mutées
  // sans faire rougir un seul banc — donc elles étaient au mauvais endroit
  // (§ 2 quaterdecies), pas seulement mal testées.

  it('ON NE SONDE PAS SANS SESSION — la route rend 401', () => {
    // Muté, ce test sondait exactement quand il ne fallait pas : un cliquetis
    // de refus toutes les 30 s pour un visiteur anonyme, et un message d'erreur
    // allumé en permanence dans une interface où rien ne va mal.
    expect(doitSonder(null)).toBe(false);
    expect(doitSonder(undefined)).toBe(false);
    expect(doitSonder({ id: 'u1', email: 'a@b.c' })).toBe(true);
  });

  it('UNE SEULE entrée de navigation porte la pastille', () => {
    const p = { total: 2, gravite: 'critique' } as const;
    expect(porteLaPastille(ENTREE_PASTILLE, p)).toBe(true);
    // Muté en `!==`, la pastille serait apparue sur TOUTES les autres.
    for (const ailleurs of ['miellerie', 'ruche', 'sante', 'essaim']) {
      expect(porteLaPastille(ailleurs, p), `pastille égarée sur ${ailleurs}`).toBe(false);
    }
  });

  it('pas de pastille à porter ⇒ aucune entrée ne la porte', () => {
    expect(porteLaPastille(ENTREE_PASTILLE, null)).toBe(false);
  });
});

describe('la pastille s’allume — et sur la gravité du SERVEUR', () => {
  it('reprend le compte et la gravité tels quels', () => {
    expect(pastilleDesAlertes(source(3, 'critique'))).toEqual({ total: 3, gravite: 'critique' });
    expect(pastilleDesAlertes(source(1, 'attention'))).toEqual({ total: 1, gravite: 'attention' });
  });

  it('NE RECALCULE RIEN : elle transporte le verdict, elle ne le refait pas', () => {
    // Le serveur classe par nature d'abord ; sa `graviteMax` peut donc ne pas
    // être celle de la première alerte. Si ce module « corrigeait » quoi que ce
    // soit, il fabriquerait une seconde décision — celle que MonEspace
    // s'interdit. On lui donne une gravité que rien dans la liste ne justifie :
    // il doit la rendre telle quelle.
    expect(pastilleDesAlertes(source(2, 'critique'))?.gravite).toBe('critique');
    expect(pastilleDesAlertes(source(2, 'info'))?.gravite).toBe('info');
  });
});

describe('la pastille reste ÉTEINTE — les trois cas', () => {
  it('sans tableau (pas de session, ou pas encore chargé)', () => {
    expect(pastilleDesAlertes(null)).toBeNull();
  });

  it('SANS ALERTE : « aucune » n’est pas « info »', () => {
    // Le piège central. Une ruche saine ne doit porter AUCUNE pastille : une
    // pastille toujours allumée n'attire plus l'œil le jour où elle compte.
    expect(pastilleDesAlertes(source(0, null))).toBeNull();
    // Et même si un serveur rendait une gravité avec zéro alerte, on n'allume
    // pas : c'est le COMPTE qui décide de l'allumage.
    expect(pastilleDesAlertes(source(0, 'critique'))).toBeNull();
  });

  it('SANS GRAVITÉ : un serveur ancien n’invente pas une couleur', () => {
    // Le contrat porte un `version` : un client peut parler à une ruche d'avant
    // `graviteMax`. Peindre « info » par défaut mentirait sur l'urgence — mieux
    // vaut pas de pastille qu'une pastille fausse.
    expect(pastilleDesAlertes(source(5, null))).toBeNull();
  });
});

describe('ce que la pastille MONTRE et ce qu’elle DIT', () => {
  it('le compte affiché plafonne sans mentir sur le compte réel', () => {
    expect(compteAffiche(1)).toBe('1');
    expect(compteAffiche(99)).toBe('99');
    expect(compteAffiche(100)).toBe('99+');
    // Le plafond est un fait d'AFFICHAGE : la pastille garde le vrai total.
    expect(pastilleDesAlertes(source(150, 'attention'))?.total).toBe(150);
  });

  it('LA GRAVITÉ EST DITE EN TOUTES LETTRES, jamais laissée à la couleur', () => {
    // § 9 vicies : un état qui ne tient qu'à un pixel n'est vérifiable ni par un
    // banc, ni par un lecteur d'écran.
    const p: Pastille = { total: 3, gravite: 'critique' };
    expect(phraseAlertes(p, 'fr')).toBe('3 alertes, la plus grave : critique');
    expect(phraseAlertes(p, 'en')).toBe('3 alerts, most severe: critical');
  });

  it('une seule alerte ne se dit pas « la plus grave »', () => {
    // « 1 alerte, la plus grave : critique » est du charabia : il n'y a pas de
    // hiérarchie à une seule.
    expect(phraseAlertes({ total: 1, gravite: 'critique' }, 'fr')).toBe('1 alerte, critique');
    expect(phraseAlertes({ total: 1, gravite: 'attention' }, 'en')).toBe(
      '1 alert, needs attention',
    );
  });

  it('les trois gravités ont chacune leur mot, dans les deux langues', () => {
    const gravites = ['critique', 'attention', 'info'] as const;
    const dits = gravites.flatMap((g) => [
      phraseAlertes({ total: 2, gravite: g }, 'fr'),
      phraseAlertes({ total: 2, gravite: g }, 'en'),
    ]);
    // Six phrases DISTINCTES : si deux gravités se disaient pareil, l'une
    // d'elles serait indiscernable à l'oreille.
    expect(new Set(dits).size).toBe(6);
    for (const d of dits) expect(d.length).toBeGreaterThan(10);
  });

  it('CHAQUE gravité dit SON mot — la distinction ne suffit pas', () => {
    // ─── LE TROU QUE CE BANC FERME, ET QUI A ÉTÉ MESURÉ ────────────────────
    //
    // Le banc ci-dessus exige six phrases distinctes. Il laisse donc passer un
    // ÉCHANGE : intervertir les mots de `attention` et `info` garde six
    // phrases distinctes, et rien ne rougit. Mesuré avant correction — les 12
    // bancs sont restés verts pendant qu'un « à surveiller » se disait « pour
    // information ».
    //
    // Une distinction n'est pas une correspondance. Ce qu'il faut épingler,
    // c'est quel mot va à quelle gravité — l'utilisateur qui lit « pour
    // information » sur un quota au bord ne remarquera rien, et c'est bien le
    // problème.
    expect(phraseAlertes({ total: 2, gravite: 'attention' }, 'fr')).toContain('à surveiller');
    expect(phraseAlertes({ total: 2, gravite: 'attention' }, 'en')).toContain('needs attention');
    expect(phraseAlertes({ total: 2, gravite: 'info' }, 'fr')).toContain('pour information');
    expect(phraseAlertes({ total: 2, gravite: 'info' }, 'en')).toContain('informational');
    expect(phraseAlertes({ total: 2, gravite: 'critique' }, 'fr')).toContain('critique');
    expect(phraseAlertes({ total: 2, gravite: 'critique' }, 'en')).toContain('critical');
  });
});
