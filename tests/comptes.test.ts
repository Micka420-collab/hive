// Les comptes : rôles, inscription, et la porte d'entrée.
//
// Le fichier tourne autour de trois propriétés qu'un lancement public exige :
//
//   1. Une ruche ne peut jamais se retrouver SANS administrateur, ni au
//      démarrage (le premier compte l'est) ni après coup (le dernier admin ne
//      peut pas se retirer).
//   2. Personne ne se promeut soi-même.
//   3. La porte d'entrée résiste à la force brute ET ne dit pas qui est
//      inscrit — deux propriétés distinctes, chacune indispensable.

import { describe, expect, it } from 'vitest';
import {
  ACTIONS,
  ECHECS_COMPTE,
  ECHECS_IP,
  FENETRE_MS,
  INSCRIPTIONS,
  LONGUEUR_MIN,
  ROLES,
  VERROU_MS,
  cleCompte,
  compteurVide,
  echec,
  etatInscription,
  inscriptionPermise,
  jugerMotDePasse,
  modeInscriptionDepuisEnv,
  peut,
  peutChangerRole,
  rafraichir,
  roleALaCreation,
  tentativeAutorisee,
} from '../src/orchestrator/comptes.js';
import type { Compteur } from '../src/orchestrator/comptes.js';

const NOW = 1_800_000_000_000;

describe('comptes — les rôles', () => {
  it('un membre ne peut rien administrer', () => {
    for (const a of [
      'voir_tous_les_projets',
      'gerer_membres',
      'gerer_serveurs',
      'changer_role',
    ] as const) {
      expect(peut('membre', a), a).toBe(false);
    }
  });

  it('un membre peut travailler sur ses propres projets', () => {
    expect(peut('membre', 'voir_ses_projets')).toBe(true);
    expect(peut('membre', 'creer_projet')).toBe(true);
    expect(peut('membre', 'regler_autonomie')).toBe(true);
  });

  it('un admin peut tout ce qui est déclaré', () => {
    for (const a of ACTIONS) expect(peut('admin', a), a).toBe(true);
  });

  it('une action non déclarée est REFUSÉE à tout le monde', () => {
    // La matrice est écrite en entier plutôt que par différence : le jour où
    // l'on ajoute une action sans la déclarer, elle est refusée — le bon
    // défaut. Un « admin : tout sauf… » l'aurait accordée en silence.
    for (const role of ROLES) {
      expect(peut(role, 'action_inventee' as never), role).toBe(false);
    }
  });
});

describe('comptes — une ruche a TOUJOURS un administrateur', () => {
  it('le premier compte est admin, les suivants membres', () => {
    // La seule amorce qui ne demande ni mot de passe par défaut, ni variable
    // d'environnement, ni route secrète.
    expect(roleALaCreation(0)).toBe('admin');
    expect(roleALaCreation(1)).toBe('membre');
    expect(roleALaCreation(999)).toBe('membre');
  });

  it('le DERNIER admin ne peut pas se retirer son rôle', () => {
    // Une ruche sans admin ne s'administre plus, et il n'y a pas de « mot de
    // passe root » pour s'en sortir.
    const r = peutChangerRole({
      auteur: 'admin',
      auteurId: 'u1',
      cibleId: 'u1',
      nouveauRole: 'membre',
      admins: 1,
    });
    expect(r.autorise).toBe(false);
    expect(r.motif).toMatch(/dernier administrateur/);
  });

  it('…mais il le peut s’il en reste un autre', () => {
    const r = peutChangerRole({
      auteur: 'admin',
      auteurId: 'u1',
      cibleId: 'u1',
      nouveauRole: 'membre',
      admins: 2,
    });
    expect(r.autorise).toBe(true);
  });

  it('un admin peut rétrograder QUELQU’UN D’AUTRE, même seul', () => {
    const r = peutChangerRole({
      auteur: 'admin',
      auteurId: 'u1',
      cibleId: 'u2',
      nouveauRole: 'membre',
      admins: 1,
    });
    expect(r.autorise).toBe(true);
  });
});

describe('comptes — personne ne se promeut soi-même', () => {
  it('un membre ne change aucun rôle, pas même le sien', () => {
    const r = peutChangerRole({
      auteur: 'membre',
      auteurId: 'u2',
      cibleId: 'u2',
      nouveauRole: 'admin',
      admins: 1,
    });
    expect(r.autorise).toBe(false);
    expect(r.motif).toMatch(/seul un administrateur/);
  });

  it('aucune combinaison ne laisse un membre toucher aux rôles', () => {
    // Balayage exhaustif : la garantie ne doit pas dépendre d'un cas oublié.
    for (const cibleId of ['u2', 'u3']) {
      for (const nouveauRole of ROLES) {
        for (const admins of [0, 1, 5]) {
          const r = peutChangerRole({
            auteur: 'membre',
            auteurId: 'u2',
            cibleId,
            nouveauRole,
            admins,
          });
          expect(r.autorise, `${cibleId}/${nouveauRole}/${admins}`).toBe(false);
        }
      }
    }
  });
});

describe('comptes — l’inscription', () => {
  it('le PREMIER compte passe toujours, même « fermée »', () => {
    // Sans ça, une ruche installée avec HIVE_INSCRIPTION=fermee serait
    // définitivement inutilisable : aucun moyen de créer son admin.
    for (const mode of INSCRIPTIONS) {
      const r = inscriptionPermise({ mode, comptesExistants: 0 });
      expect(r.permise, mode).toBe(true);
    }
  });

  it('« fermée » refuse ensuite', () => {
    expect(inscriptionPermise({ mode: 'fermee', comptesExistants: 1 }).permise).toBe(false);
  });

  it('« sur invitation » exige un billet valide', () => {
    expect(
      inscriptionPermise({ mode: 'sur_invitation', comptesExistants: 1, billetValide: false })
        .permise,
    ).toBe(false);
    expect(
      inscriptionPermise({ mode: 'sur_invitation', comptesExistants: 1, billetValide: true })
        .permise,
    ).toBe(true);
    // Billet absent = billet invalide : fermé par défaut.
    expect(inscriptionPermise({ mode: 'sur_invitation', comptesExistants: 1 }).permise).toBe(false);
  });

  it('« ouverte » avertit l’hôte dès qu’un compte existe', () => {
    // Une ruche exposée avec les inscriptions ouvertes donne un compte à
    // quiconque trouve l'URL. On le DIT plutôt que de l'espérer.
    expect(etatInscription('ouverte', 0).avertissement).toBe('');
    expect(etatInscription('ouverte', 1).avertissement).toMatch(/OUVERTES/);
    expect(etatInscription('sur_invitation', 5).avertissement).toBe('');
  });

  it('une faute de frappe retombe sur le défaut', () => {
    expect(modeInscriptionDepuisEnv({})).toBe('ouverte');
    expect(modeInscriptionDepuisEnv({ HIVE_INSCRIPTION: 'FERMEE' })).toBe('ouverte');
    for (const m of INSCRIPTIONS) {
      expect(modeInscriptionDepuisEnv({ HIVE_INSCRIPTION: m })).toBe(m);
    }
  });
});

describe('comptes — la porte d’entrée résiste à la force brute', () => {
  const vide = compteurVide();

  it('une tentative sur un compteur vierge passe', () => {
    expect(tentativeAutorisee(vide, vide, NOW).autorisee).toBe(true);
  });

  it('le seuil PAR COMPTE verrouille', () => {
    let c = vide;
    for (let i = 0; i < ECHECS_COMPTE; i++) c = echec(c, NOW, ECHECS_COMPTE);
    const r = tentativeAutorisee(c, vide, NOW);
    expect(r.autorisee).toBe(false);
    expect(r.attendreMs).toBeGreaterThan(0);
  });

  it('juste en dessous du seuil, on passe encore', () => {
    let c = vide;
    for (let i = 0; i < ECHECS_COMPTE - 1; i++) c = echec(c, NOW, ECHECS_COMPTE);
    expect(tentativeAutorisee(c, vide, NOW).autorisee).toBe(true);
  });

  it('le seuil PAR IP verrouille AUSSI, indépendamment', () => {
    // Le cas que le compteur par compte ne voit pas : une IP qui essaie le
    // même mot de passe sur mille comptes différents.
    let ip = vide;
    for (let i = 0; i < ECHECS_IP; i++) ip = echec(ip, NOW, ECHECS_IP);
    expect(tentativeAutorisee(vide, ip, NOW).autorisee).toBe(false);
  });

  it('le seuil par IP est plus haut que celui par compte', () => {
    // Une famille, un bureau, un atelier partagent une IP publique.
    expect(ECHECS_IP).toBeGreaterThan(ECHECS_COMPTE);
  });

  it('le verrou se lève après son délai', () => {
    let c = vide;
    for (let i = 0; i < ECHECS_COMPTE; i++) c = echec(c, NOW, ECHECS_COMPTE);
    expect(tentativeAutorisee(c, vide, NOW + VERROU_MS - 1).autorisee).toBe(false);
    expect(tentativeAutorisee(c, vide, NOW + VERROU_MS).autorisee).toBe(true);
  });

  it('un verrou EN COURS ne s’efface pas par expiration de fenêtre', () => {
    // L'invariant est construit directement plutôt que déduit du rapport entre
    // VERROU_MS et FENETRE_MS : le jour où l'on allonge le verrou, cette
    // garantie doit tenir sans qu'on ait à réécrire le test.
    const verrouille: Compteur = {
      echecs: ECHECS_COMPTE,
      depuis: NOW,
      verrouJusqua: NOW + 10 * FENETRE_MS,
    };
    const pendant = rafraichir(verrouille, NOW + FENETRE_MS + 1);
    expect(pendant.verrouJusqua).toBe(verrouille.verrouJusqua);
    expect(tentativeAutorisee(verrouille, vide, NOW + FENETRE_MS + 1).autorisee).toBe(false);
  });

  it('des échecs espacés ne verrouillent jamais un humain', () => {
    // Quelqu'un qui se trompe une fois par mois ne doit pas finir verrouillé.
    let c = vide;
    for (let i = 0; i < 50; i++) c = echec(c, NOW + i * (FENETRE_MS + 1), ECHECS_COMPTE);
    expect(c.echecs).toBe(1);
    expect(tentativeAutorisee(c, vide, NOW + 50 * (FENETRE_MS + 1)).autorisee).toBe(true);
  });

  it('compter pendant un verrou ne le prolonge pas indéfiniment', () => {
    // Sinon un attaquant qui continue de marteler verrouillerait le compte
    // d'un utilisateur légitime pour toujours — un déni de service ciblé.
    let c = vide;
    for (let i = 0; i < ECHECS_COMPTE; i++) c = echec(c, NOW, ECHECS_COMPTE);
    const fin = c.verrouJusqua;
    for (let i = 0; i < 100; i++) c = echec(c, NOW + 1000, ECHECS_COMPTE);
    expect(c.verrouJusqua).toBe(fin);
  });

  it('le motif ne dit JAMAIS lequel des deux compteurs a mordu', () => {
    // Le savoir apprendrait à l'attaquant s'il a trouvé un compte existant.
    let compte = vide;
    for (let i = 0; i < ECHECS_COMPTE; i++) compte = echec(compte, NOW, ECHECS_COMPTE);
    let ip = vide;
    for (let i = 0; i < ECHECS_IP; i++) ip = echec(ip, NOW, ECHECS_IP);

    const parCompte = tentativeAutorisee(compte, vide, NOW);
    const parIp = tentativeAutorisee(vide, ip, NOW);
    expect(parCompte.motif).toBe(parIp.motif);
  });

  it('est PURE : le compteur passé n’est jamais muté', () => {
    const c: Compteur = compteurVide();
    const copie = { ...c };
    echec(c, NOW, ECHECS_COMPTE);
    tentativeAutorisee(c, c, NOW);
    expect(c).toEqual(copie);
  });
});

describe('comptes — la clé de compteur', () => {
  it('la casse ne double pas le quota', () => {
    // Sans normalisation, il suffirait d'alterner la casse pour repartir à
    // zéro — une évasion triviale que la validation de forme ne rattrape pas.
    expect(cleCompte('Alice@X.COM')).toBe(cleCompte('alice@x.com'));
    expect(cleCompte('  alice@x.com  ')).toBe('alice@x.com');
  });

  it('est bornée', () => {
    expect(cleCompte('a'.repeat(9_000)).length).toBeLessThanOrEqual(254);
  });
});

describe('comptes — le mot de passe', () => {
  it('exige une longueur qui rend la force brute inutile', () => {
    expect(jugerMotDePasse('a'.repeat(LONGUEUR_MIN - 1)).accepte).toBe(false);
    expect(jugerMotDePasse('cheval agrafe batterie').accepte).toBe(true);
  });

  it('le motif suggère une phrase plutôt que des symboles', () => {
    // Les scores de force apprennent surtout aux gens à ajouter « ! » à la fin.
    expect(jugerMotDePasse('court').motif).toMatch(/phrase de trois mots/);
  });

  it('refuse ce qui est dans toutes les listes, même rallongé', () => {
    // Le rallongement est exactement ce que font les gens quand un formulaire
    // exige douze caractères : « motdepasse » devient « motdepassemm ».
    for (const mdp of ['motdepassemm', 'password1234', 'changeme1234', 'azertyazerty']) {
      expect(jugerMotDePasse(mdp).accepte, mdp).toBe(false);
    }
  });

  it('…mais une longue phrase contenant un mot commun reste acceptée', () => {
    // « admin » dans une phrase de trente caractères n'a rien de faible ; la
    // refuser apprendrait aux gens à contourner la règle plutôt qu'à choisir
    // un bon mot de passe.
    expect(jugerMotDePasse('je suis admin de cette ruche depuis mars').accepte).toBe(true);
  });

  it('refuse un mot de passe long mais vide de variété', () => {
    // « aaaaaaaaaaaa » est deviné avant « password ».
    expect(jugerMotDePasse('aaaaaaaaaaaaaaaa').accepte).toBe(false);
    expect(jugerMotDePasse('ababababababab').accepte).toBe(false);
  });

  it('accepte une vraie phrase de passe', () => {
    for (const mdp of [
      'la ruche bourdonne au petit matin',
      'Correct-Horse-Battery-Staple',
      'j aime les abeilles 42',
    ]) {
      expect(jugerMotDePasse(mdp).accepte, mdp).toBe(true);
    }
  });
});
