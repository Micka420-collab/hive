// UN PÉRIMÈTRE QUI NE DÉSIGNE RIEN N'EST PAS UN PÉRIMÈTRE VIDE.
//
// ─── LE DÉFAUT QUI A FAIT NAÎTRE CE BANC ─────────────────────────────────────
//
// `LOUPE_CHEMINS` se découpe sur des VIRGULES. Un balayage lancé avec des
// ESPACES — « a.ts b.ts » — passe donc UN chemin, qui n'existe pas. `git diff`
// sur un chemin inexistant rend le vide, et la loupe concluait :
//
//     LOUPE : aucune ligne mutable ajoutée par cette branche.
//             (rien à conclure — ce n’est PAS un feu vert.)
//
// Deuxième ligne sauve l'honneur, et le mal est fait : le verdict est le MÊME
// que pour un diff réellement sans candidate. Deux situations que tout sépare
// — « j'ai regardé, il n'y a rien » et « je n'ai rien regardé » — rendues
// indistinguables en sortie.
//
// C'est le retour, sous une forme neuve, du défaut que `lignesAjoutees()`
// documente déjà : la loupe avait répondu « aucune ligne mutable » sur un diff
// qui en ajoutait deux cents, parce que `scripts/` était hors de sa portée par
// défaut. Là, la portée par DÉFAUT était trop étroite ; ici, c'est la portée
// DEMANDÉE qui ne correspond à rien.

import { describe, expect, it } from 'vitest';
import { cheminsDuBalayage, diagnosticSansCandidate } from '../scripts/loupe.mjs';

describe('diagnosticSansCandidate — distinguer « rien vu » de « rien à voir »', () => {
  it('aucun fichier suivi ⇒ périmètre fautif, et le code de sortie DIFFÈRE', () => {
    const d = diagnosticSansCandidate(0, ['src/nexiste.pas']);
    expect(d.motif).toBe('perimetre_vide');
    // Le code compte autant que le message : un harnais qui enchaîne doit
    // s'arrêter. Sortir 0 ferait passer une invocation fautive pour un succès.
    expect(d.code).toBe(2);
  });

  it('des fichiers suivis ⇒ le diff est vraiment sans candidate', () => {
    const d = diagnosticSansCandidate(12, ['src']);
    expect(d.motif).toBe('rien_a_muter');
    expect(d.code).toBe(0);
  });

  // Le bord qui départage : un seul fichier suffit à rendre le verdict légitime.
  it('UN seul fichier suivi suffit — la borne se lit dans les deux sens', () => {
    expect(diagnosticSansCandidate(1, ['src/a.ts']).motif).toBe('rien_a_muter');
    expect(diagnosticSansCandidate(0, ['src/a.ts']).motif).toBe('perimetre_vide');
  });
});

describe('la TROISIÈME manière de ne rien mesurer : n’avoir rien commis', () => {
  // ─── LE DÉFAUT QUI A FAIT NAÎTRE CE BLOC ───────────────────────────────────
  //
  // La loupe lit `BASE...HEAD` — l'HISTOIRE, jamais l'arbre de travail. Un lot
  // entier écrit et éprouvé mais pas encore commis lui est donc invisible :
  // `HEAD` vaut la base, le diff est vide, et elle rendait « aucune ligne
  // mutable ». Vrai, et vrai à propos de rien.
  //
  // Ce cas-ci n'est pas une invocation fautive — il n'y a rien à corriger dans
  // la ligne de commande. C'est la question posée et la question répondue qui
  // divergent. D'où un motif distinct : les deux autres se réparent en changeant
  // l'appel, celui-ci se répare en commitant.

  it('du travail non commis dans le périmètre ⇒ code 2, et il NOMME les fichiers', () => {
    const d = diagnosticSansCandidate(5, ['src'], ['src/neuf.ts', 'src/modifie.ts']);
    expect(d.motif).toBe('arbre_non_commis');
    expect(d.code).toBe(2);
    // Nommer les fichiers n'est pas décoratif : sans la liste, le message
    // laisse chercher ce qui n'a pas été commis dans un périmètre entier.
    expect(d.nonCommis).toEqual(['src/neuf.ts', 'src/modifie.ts']);
  });

  it('L’ORDRE COMPTE : un périmètre vide l’emporte sur du non-commis', () => {
    // Les deux peuvent être vrais ensemble — un chemin mal découpé ET un arbre
    // sale. Celui qui doit parler est le périmètre : tant qu'il ne désigne
    // rien, commiter ne changerait rigoureusement rien au verdict. Inverser les
    // deux tests enverrait commiter quelqu'un dont l'invocation est cassée.
    const d = diagnosticSansCandidate(0, ['src/a.ts src/b.ts'], ['src/a.ts']);
    expect(d.motif).toBe('perimetre_vide');
  });

  it('ARBRE PROPRE : on retombe sur « rien à muter », et sur le code 0', () => {
    // La moitié qui tue « toujours arbre_non_commis ». Une liste VIDE doit
    // laisser passer le verdict légitime — sinon la loupe ne rendrait plus
    // jamais de vert sur un diff honnêtement sans candidate.
    const d = diagnosticSansCandidate(5, ['src'], []);
    expect(d.motif).toBe('rien_a_muter');
    expect(d.code).toBe(0);
  });

  it('SANS TROISIÈME ARGUMENT, le comportement d’avant est intact', () => {
    // Le défaut `= []` est ce qui rend l'ajout rétro-compatible. S'il sautait,
    // `nonCommis.length` lèverait sur chaque appel à deux arguments — et la
    // loupe mourrait là où elle rendait un verdict.
    expect(diagnosticSansCandidate(5, ['src']).motif).toBe('rien_a_muter');
    expect(diagnosticSansCandidate(0, ['src']).motif).toBe('perimetre_vide');
  });
});

describe('cheminsDuBalayage — le piège des espaces, éprouvé', () => {
  // LE CAS EXACT QUI A COÛTÉ UN BALAYAGE. Sans ce banc, rien n'empêcherait
  // quelqu'un de « simplifier » le découpage un jour.
  it('les espaces ne séparent PAS : « a b » est UN chemin', () => {
    const c = cheminsDuBalayage('src/a.ts src/b.ts').filter((x) => !x.startsWith(':(exclude)'));
    expect(c).toEqual(['src/a.ts src/b.ts']);
    expect(c.length, 'deux fichiers séparés par un espace font UN chemin').toBe(1);
  });

  it('les virgules séparent, et l’espace autour est coupé', () => {
    const c = cheminsDuBalayage(' src/a.ts , src/b.ts ').filter((x) => !x.startsWith(':(exclude)'));
    expect(c).toEqual(['src/a.ts', 'src/b.ts']);
  });

  it('le juge reste dehors, quoi qu’on demande', () => {
    expect(cheminsDuBalayage('scripts')).toContain(':(exclude)scripts/loupe.mjs');
    expect(cheminsDuBalayage('')).toContain(':(exclude)scripts/loupe.mjs');
  });

  it('vide ou fait de virgules ⇒ la portée par DÉFAUT, jamais le vide', () => {
    for (const brut of ['', '   ', ',,,', undefined]) {
      const c = cheminsDuBalayage(brut).filter((x) => !x.startsWith(':(exclude)'));
      expect(c.length, `« ${String(brut)} » devrait rendre la portée par défaut`).toBeGreaterThan(
        1,
      );
    }
  });
});
