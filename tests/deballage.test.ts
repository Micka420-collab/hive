// LE DÉBALLAGE — ce qu'une archive a le droit de contenir.
//
// Le transport garantit que le FICHIER REÇU porte un nom que le serveur n'a pas
// choisi. Il ne dit rien de ce que ce fichier CONTIENT — et une archive porte
// ses propres chemins, venus du même inconnu. C'est le tar slip, et il a touché
// à peu près tous les écosystèmes qui déballent des paquets.

import { describe, expect, it } from 'vitest';
import {
  DEBALLE_OCTETS_MAX,
  ENTREES_MAX,
  estAbsolu,
  jugerEntrees,
  normaliserChemin,
} from '../src/shared/deballage.js';
import type { EntreeArchive } from '../src/shared/deballage.js';

const f = (chemin: string, octets = 10): EntreeArchive => ({ chemin, sorte: 'fichier', octets });

/** Les motifs d'un verdict de refus, pour lire les bancs sans cérémonie. */
function motifs(v: ReturnType<typeof jugerEntrees>): string[] {
  return v.ok ? [] : v.refusees.map((r) => r.motif);
}

describe('normaliserChemin — la remontée se juge APRÈS normalisation', () => {
  it('réduit les segments inutiles', () => {
    expect(normaliserChemin('a/./b//c')).toBe('a/b/c');
    expect(normaliserChemin('a\\b\\c')).toBe('a/b/c');
  });

  it('applique `..` sans sortir tant qu’il reste de quoi remonter', () => {
    expect(normaliserChemin('a/b/../c')).toBe('a/c');
    expect(normaliserChemin('a/b/../../c')).toBe('c');
  });

  it('LA REMONTÉE QUI SORT rend `null` — et elle ne commence PAS par « ../ »', () => {
    // ─── LE CAS QUI TUE UNE GARDE ÉCRITE SUR LA CHAÎNE BRUTE ────────────────
    //
    // `a/b/../../../etc/passwd` ne contient aucun `../` en TÊTE, et une garde
    // qui cherche ce préfixe le laisse passer. Il sort pourtant d'un niveau
    // au-dessus de la quarantaine. C'est pour cela que la garde est sur la
    // normalisation, jamais sur le texte.
    expect(normaliserChemin('a/b/../../../etc/passwd')).toBeNull();
    expect(normaliserChemin('..')).toBeNull();
    expect(normaliserChemin('a/../..')).toBeNull();
  });

  it('LA BORNE : remonter EXACTEMENT autant qu’on est descendu ne sort pas', () => {
    // `a/..` retombe sur la racine — c'est vide, pas dehors. Refuser ici
    // écarterait des archives parfaitement ordinaires.
    expect(normaliserChemin('a/..')).toBe('');
    expect(normaliserChemin('a/b/../..')).toBe('');
  });
});

describe('estAbsolu — trois formes, et `path.join` n’en protège d’aucune', () => {
  it('la racine POSIX', () => {
    expect(estAbsolu('/etc/passwd')).toBe(true);
  });

  it('LA LETTRE DE LECTEUR, avec ou SANS séparateur', () => {
    // `C:sansbarre` est relatif au répertoire courant DU LECTEUR C — donc pas
    // à la quarantaine. La forme sans barre est celle qu'on oublie.
    expect(estAbsolu('C:\\Windows\\system32')).toBe(true);
    expect(estAbsolu('C:sansbarre')).toBe(true);
    expect(estAbsolu('d:/autre')).toBe(true);
  });

  it('LE PARTAGE RÉSEAU — `path.join` le garde tel quel sous Windows', () => {
    expect(estAbsolu('\\\\serveur\\partage\\x')).toBe(true);
    expect(estAbsolu('//serveur/partage/x')).toBe(true);
  });

  it('un chemin relatif ordinaire n’est pas absolu', () => {
    expect(estAbsolu('src/index.ts')).toBe(false);
    expect(estAbsolu('./a')).toBe(false);
  });
});

describe('jugerEntrees — tout ou rien', () => {
  it('une archive ordinaire passe, avec ses chemins NORMALISÉS', () => {
    const v = jugerEntrees([f('paquet/index.js'), f('paquet/./lib/a.js')]);
    expect(v.ok).toBe(true);
    if (!v.ok) return;
    expect(v.retenues.map((r) => r.chemin)).toEqual(['paquet/index.js', 'paquet/lib/a.js']);
  });

  it('LE TAR SLIP EST REFUSÉ', () => {
    const v = jugerEntrees([f('paquet/a.js'), f('paquet/../../../.ssh/authorized_keys')]);
    expect(motifs(v)).toContain('remontee');
  });

  it('UN CHEMIN ABSOLU EST REFUSÉ', () => {
    expect(motifs(jugerEntrees([f('/etc/cron.d/x')]))).toContain('chemin_absolu');
    expect(motifs(jugerEntrees([f('C:\\Windows\\x')]))).toContain('chemin_absolu');
  });

  it('UN LIEN EST REFUSÉ, JAMAIS VÉRIFIÉ', () => {
    // ─── POURQUOI ON NE CONTRÔLE PAS SA CIBLE ───────────────────────────────
    //
    // Contrôler puis extraire est une COURSE : `a` est un lien vers `/etc`,
    // puis `a/passwd` est un fichier tout à fait ordinaire — et l'écriture
    // part dans `/etc/passwd` sans qu'aucun chemin n'ait eu l'air suspect. Le
    // contournement classique de ce genre de garde. Un lien se refuse.
    const v = jugerEntrees([{ chemin: 'a', sorte: 'lien', octets: 0 }, f('a/passwd')]);
    expect(motifs(v)).toContain('lien');
  });

  it('UN FICHIER SPÉCIAL EST REFUSÉ', () => {
    const v = jugerEntrees([{ chemin: 'tuyau', sorte: 'special', octets: 0 }]);
    expect(motifs(v)).toContain('fichier_special');
  });

  it('UN OCTET NUL OU UN CARACTÈRE DE CONTRÔLE EST REFUSÉ', () => {
    // Le nom vérifié et le nom écrit ne seraient pas le même — toute
    // vérification en amont devient caduque.
    expect(motifs(jugerEntrees([f('a\u0000.js')]))).toContain('nom_reecrit');
    expect(motifs(jugerEntrees([f('a\u001b[1m.js')]))).toContain('nom_reecrit');
  });

  it('LES NOMS QUE WINDOWS RÉÉCRIT SONT REFUSÉS', () => {
    // `CON`, `NUL`, `COM1`… avec ou sans extension ; et le point ou l'espace
    // final que Windows retire en silence — « a. » et « a » deviennent le même
    // fichier après écriture.
    expect(motifs(jugerEntrees([f('paquet/CON')]))).toContain('nom_reecrit');
    expect(motifs(jugerEntrees([f('paquet/nul.txt')]))).toContain('nom_reecrit');
    expect(motifs(jugerEntrees([f('paquet/com1.js')]))).toContain('nom_reecrit');
    expect(motifs(jugerEntrees([f('paquet/a.')]))).toContain('nom_reecrit');
    expect(motifs(jugerEntrees([f('paquet/a ')]))).toContain('nom_reecrit');
    // Et un nom qui COMMENCE par ces lettres reste permis : `console.js` n'est
    // pas `con`. Une garde trop large casserait des archives légitimes.
    expect(jugerEntrees([f('paquet/console.js')]).ok).toBe(true);
  });

  it('DEUX ENTRÉES QUI DÉSIGNENT LE MÊME FICHIER SONT REFUSÉES', () => {
    // La seconde écrase la première : on vérifie un contenu, on en installe un
    // autre. Deux formes — la normalisation, et la CASSE (macOS, Windows).
    expect(motifs(jugerEntrees([f('a/b.js'), f('a/./b.js')]))).toContain('collision');
    expect(motifs(jugerEntrees([f('paquet/README'), f('paquet/readme')]))).toContain('collision');
  });

  it('UNE SEULE ENTRÉE REFUSÉE REFUSE L’ARCHIVE ENTIÈRE', () => {
    // La moitié qui tue « extraire les bonnes » : installer à moitié un paquet
    // dont on vient d'établir qu'on ne lui fait pas confiance n'a pas de sens.
    const v = jugerEntrees([f('bon/a.js'), f('bon/b.js'), f('../mauvais')]);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.motif).toBe('entrees_refusees');
  });

  it('TROP D’ENTRÉES : refus AVANT d’en juger une seule', () => {
    const beaucoup = Array.from({ length: 11 }, (_, i) => f(`a${i}.js`));
    const v = jugerEntrees(beaucoup, { entreesMax: 10 });
    expect(v.ok === false && v.motif).toBe('trop_d_entrees');
    // Et il ne rend PAS de liste d'entrées refusées : rien n'a été jugé.
    expect(v.ok === false && v.refusees).toHaveLength(0);
  });

  it('PILE SUR LE PLAFOND D’ENTRÉES : ça passe', () => {
    const pile = Array.from({ length: 10 }, (_, i) => f(`a${i}.js`));
    expect(jugerEntrees(pile, { entreesMax: 10 }).ok).toBe(true);
  });

  it('TROP GROS UNE FOIS DÉBALLÉ', () => {
    // Le plafond du transport porte sur l'archive REÇUE. Une archive minuscule
    // peut promettre des téraoctets — c'est la bombe de décompression, vue du
    // côté du manifeste plutôt que du flux.
    const v = jugerEntrees([f('a.bin', 900), f('b.bin', 200)], { octetsMax: 1000 });
    expect(v.ok === false && v.motif).toBe('trop_gros_deballe');
  });

  it('PILE SUR LE PLAFOND DE TAILLE : ça passe', () => {
    expect(jugerEntrees([f('a.bin', 600), f('b.bin', 400)], { octetsMax: 1000 }).ok).toBe(true);
  });

  it('LES DOSSIERS NE COMPTENT PAS DANS LA TAILLE', () => {
    // La moitié qui tue « additionner tout » : un lecteur d'archive annonce
    // parfois une taille sur les dossiers, et l'additionner refuserait des
    // archives sous le plafond.
    const v = jugerEntrees([{ chemin: 'd', sorte: 'dossier', octets: 4096 }, f('d/a.bin', 900)], {
      octetsMax: 1000,
    });
    expect(v.ok, v.ok === false ? v.detail : '').toBe(true);
  });

  it('les plafonds par défaut sont des constantes nommées', () => {
    expect(ENTREES_MAX).toBeGreaterThan(0);
    expect(DEBALLE_OCTETS_MAX).toBeGreaterThan(0);
  });

  it('CHAQUE REFUS DIT CE QU’IL COÛTE, pas ce que la règle a reconnu', () => {
    // Un message qui décrit la règle (« contient .. ») n'apprend rien ; celui
    // qui décrit la conséquence permet de décider. C'est la même exigence que
    // pour les constats du nectar.
    const v = jugerEntrees([f('../dehors')]);
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.refusees[0]?.pourquoi ?? '').toContain('quarantaine');
    expect((v.refusees[0]?.pourquoi ?? '').length).toBeGreaterThan(40);
  });
});
