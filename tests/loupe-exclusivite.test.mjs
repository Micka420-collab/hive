// L'EXCLUSIVITÉ DE LA LOUPE — la règle qui existait et que rien n'appliquait.
//
// ─── D'OÙ VIENT CE FICHIER ───────────────────────────────────────────────────
//
// La loupe MUTE l'arbre : elle écrit une ligne fausse, lance la suite, restaure.
// Deux loupes dans le même atelier se marchent donc littéralement dessus, et
// les verdicts des DEUX perdent toute valeur — pas « à moitié faux » : sans
// valeur, puisqu'on ne sait plus quelle version du fichier a été éprouvée.
//
// C'est au carnet (§ 2 unvicies) depuis qu'une première collision a fait jeter
// un balayage entier : refaits seuls, les chiffres différaient (26 contre 30,
// 1 contre 2).
//
// La règle était donc connue, écrite, et chèrement apprise. Elle a quand même
// été enfreinte le soir même — un balayage large lancé en tâche de fond, puis
// une seconde loupe dans le même atelier pour valider une PR, parce qu'entre
// les deux on ne pense plus au processus qu'on ne voit pas.
//
// C'est le motif de toute la nuit, retourné contre celui qui l'écrivait : UNE
// RÈGLE QUE RIEN N'APPLIQUE FINIT PAR ÊTRE ENFREINTE. D'où un verrou, et non
// une résolution.
//
// ─── POURQUOI `vivant` EST INJECTÉ ───────────────────────────────────────────
//
// Savoir si un pid tourne est un accès système. L'injecter est ce qui permet
// d'éprouver les quatre branches sans lancer — ni tuer — de vrai processus,
// donc sans qu'un banc devienne une course entre deux horloges.

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  VERROU_PERIME_MS,
  contenuVerrou,
  jugerVerrou,
  refusExclusivite,
} from '../scripts/loupe.mjs';

/** Personne n'est jamais vivant — pour isoler les branches qui ne consultent pas le pid. */
const MORT = () => false;
/** Tout le monde est vivant — le cas qui doit BLOQUER. */
const VIVANT = () => true;

const MAINTENANT = 1_000_000_000_000;

describe('le verrou d’exclusivité de la loupe', () => {
  it('UN VERROU TENU PAR UN PROCESSUS VIVANT BLOQUE — c’est toute la raison d’être', () => {
    // LA garde. Sans elle, la collision du soir se reproduit à l'identique.
    const v = jugerVerrou(contenuVerrou(4242, MAINTENANT), MAINTENANT + 1000, VIVANT);
    expect(v.libre, 'une loupe tourne : la seconde doit refuser').toBe(false);
    expect(v).toMatchObject({ motif: 'tenu', pid: 4242 });
  });

  it('PAS DE VERROU : la voie est libre', () => {
    expect(jugerVerrou(null, MAINTENANT, VIVANT).libre).toBe(true);
    expect(jugerVerrou('', MAINTENANT, VIVANT).libre).toBe(true);
    expect(jugerVerrou('   \n ', MAINTENANT, VIVANT).libre).toBe(true);
  });

  it('UN VERROU DONT LE PROCESSUS EST MORT NE BLOQUE PAS — sinon Ctrl+C condamne l’atelier', () => {
    // Le cas vécu à l'essai : une loupe tuée laisse son fichier derrière elle.
    // Attendre la péremption pour s'en apercevoir ferait contourner le verrou,
    // donc le rendrait faux.
    const v = jugerVerrou(contenuVerrou(4242, MAINTENANT), MAINTENANT + 1000, MORT);
    expect(v.libre).toBe(true);
    expect(v).toMatchObject({ motif: 'perime', pid: 4242 });
  });

  it('UN VERROU TROP VIEUX NE BLOQUE PAS, MÊME SI SON PID EST VIVANT', () => {
    // Le filet contre le pid RECYCLÉ : le système a réattribué le numéro à un
    // processus étranger, bien vivant, qui n'a jamais tenu ce verrou. Sans la
    // péremption, l'atelier resterait bloqué pour toujours.
    const v = jugerVerrou(
      contenuVerrou(4242, MAINTENANT),
      MAINTENANT + VERROU_PERIME_MS + 1,
      VIVANT,
    );
    expect(v.libre, 'un pid recyclé ne doit pas condamner l’atelier').toBe(true);
    expect(v).toMatchObject({ motif: 'perime' });
  });

  it('L’ÂGE EST JUGÉ AVANT LE PID — et ce banc le prouve par le CONTRASTE', () => {
    // Deux appels qui ne diffèrent QUE par l'instant : le même verrou, le même
    // pid vivant. Si l'ordre s'inversait, le second bloquerait aussi.
    const verrou = contenuVerrou(4242, MAINTENANT);
    expect(jugerVerrou(verrou, MAINTENANT + 1000, VIVANT).libre, 'récent : bloque').toBe(false);
    expect(
      jugerVerrou(verrou, MAINTENANT + VERROU_PERIME_MS + 1, VIVANT).libre,
      'périmé : passe',
    ).toBe(true);
  });

  it('PILE À LA PÉREMPTION, LE VERROU TIENT ENCORE — la borne est stricte', () => {
    // `>` et non `>=` : à la milliseconde exacte, la loupe qui l'a posé peut
    // encore être en train d'écrire. Éprouver la borne des DEUX côtés est ce
    // qui distingue une borne d'un à-peu-près.
    const verrou = contenuVerrou(4242, MAINTENANT);
    expect(jugerVerrou(verrou, MAINTENANT + VERROU_PERIME_MS, VIVANT).libre).toBe(false);
    expect(jugerVerrou(verrou, MAINTENANT + VERROU_PERIME_MS + 1, VIVANT).libre).toBe(true);
  });

  it('UN VERROU ILLISIBLE NE BLOQUE PAS — on ne condamne pas sur du bruit', () => {
    // Un fichier tronqué par un disque plein, ou écrit par une version
    // antérieure. Bloquer là-dessus serait une panne sans issue lisible.
    for (const brut of ['pas du json', '{', '[]', 'null', '42', '"texte"']) {
      const v = jugerVerrou(brut, MAINTENANT, VIVANT);
      expect(v.libre, `« ${brut} » ne doit pas condamner l’atelier`).toBe(true);
    }
  });

  it('UN PID ABSURDE NE BLOQUE PAS', () => {
    // `process.kill(0, 0)` vise le GROUPE entier, et un pid négatif aussi :
    // les accepter ferait poser une question dangereuse au système.
    for (const pid of [0, -1, -4242, 1.5, Number.NaN, 'douze', null]) {
      const brut = JSON.stringify({ pid, depuis: MAINTENANT });
      expect(jugerVerrou(brut, MAINTENANT, VIVANT).libre, `pid ${String(pid)}`).toBe(true);
    }
  });

  it('UNE DATE ABSURDE NE BLOQUE PAS', () => {
    for (const depuis of [Number.NaN, Number.POSITIVE_INFINITY, 'hier', null, undefined]) {
      const brut = JSON.stringify({ pid: 4242, depuis });
      expect(jugerVerrou(brut, MAINTENANT, VIVANT).libre, `depuis ${String(depuis)}`).toBe(true);
    }
  });

  it('LE REFUS NOMME LE COUPABLE ET DIT QUOI FAIRE', () => {
    // Un refus muet ferait supprimer le fichier au hasard — ce qui rétablit
    // exactement le défaut que le verrou existe pour empêcher.
    const m = refusExclusivite(4242);
    expect(m, 'le pid, pour pouvoir aller voir').toContain('4242');
    expect(m, 'la raison, pour ne pas croire à un caprice').toContain('§ 2 unvicies');
    expect(m, 'la marche à suivre').toMatch(/Attendez|arrêtez/);
  });

  it('LA RÈGLE EST RÉELLEMENT CÂBLÉE DANS `principal()` — pas seulement écrite', () => {
    // LA LEÇON DES REGISTRES 1, 2 ET 3, APPLIQUÉE À MOI-MÊME.
    //
    // Tout ce qui précède éprouve la RÈGLE. Rien n'éprouverait le CÂBLAGE :
    // supprimer l'appel dans `principal()` laisserait ce fichier entièrement
    // vert, et la loupe repartirait sans verrou — exactement le défaut que le
    // lot corrige, revenu par la porte de service.
    //
    // Les commentaires sont retirés AVANT de chercher (§ 2 quatervicies) : une
    // garde de source qui ne le fait pas accepte une ligne MISE EN COMMENTAIRE
    // comme preuve de vie, et c'est le geste de débogage qu'on oublie le plus
    // souvent de défaire.
    const brut = readFileSync(new URL('../scripts/loupe.mjs', import.meta.url), 'utf8');
    const vif = brut
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .filter((l) => !/^\s*(?:\/\/|\*)/.test(l))
      .join('\n');

    // ─── CHERCHER DANS `principal()`, ET NULLE PART AILLEURS ─────────────────
    //
    // CE BANC A DÉJÀ ÉCHOUÉ À SON PROPRE REJEU, et c'est pour ça qu'il est
    // écrit ainsi. La première version cherchait `jugerVerrou(` dans TOUT le
    // fichier : elle trouvait la DÉFINITION de la fonction, pas son APPEL.
    // Commenter le câblage, ou le supprimer, la laissait donc VERTE — la
    // troisième fois de la nuit que « le texte est là » se fait passer pour
    // « la règle est appliquée ».
    //
    // On isole donc le corps de `principal()` en suivant les accolades, et on
    // ne cherche que dedans.
    const lignes = vif.split('\n');
    const depart = lignes.findIndex((l) => /^function principal\(\)/.test(l));
    expect(depart, '`principal()` doit être trouvée').toBeGreaterThanOrEqual(0);
    let prof = 0;
    const corps = [];
    for (let k = depart; k < lignes.length; k++) {
      const l = lignes[k] ?? '';
      corps.push(l);
      prof += (l.match(/\{/g)?.length ?? 0) - (l.match(/\}/g)?.length ?? 0);
      if (prof <= 0 && k > depart) break;
    }
    const dedans = corps.join('\n');

    expect(dedans, '`principal()` doit CONSULTER le verrou').toContain('jugerVerrou(');
    expect(dedans, 'et REFUSER quand il est tenu').toContain('refusExclusivite(');
    expect(dedans, 'et POSER le sien').toContain('contenuVerrou(');
    expect(dedans, 'et le RETIRER en sortant').toContain('unlinkSync(');
    // Le compteur qui empêche cette garde d'être verte à vide : si le corps
    // extrait était minuscule, tout ce qui précède serait cherché dans le vide.
    expect(dedans.length, 'le corps de `principal()` doit être lu').toBeGreaterThan(400);
  });

  it('CE QUI EST ÉCRIT EST CE QUI EST RELU — le format a UN seul auteur', () => {
    // La boucle complète : ce que pose la loupe est exactement ce que juge la
    // règle. Deux sérialisations différentes se seraient tues jusqu'au jour où
    // le verrou aurait cessé de bloquer, sans que rien ne le dise.
    const v = jugerVerrou(contenuVerrou(process.pid, MAINTENANT), MAINTENANT + 1, VIVANT);
    expect(v).toMatchObject({ libre: false, motif: 'tenu', pid: process.pid });
  });
});
