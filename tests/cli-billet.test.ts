// Le billet d'invitation — ce que la CLI ENVOIE, éprouvé hors de la CLI.
//
// ─── POURQUOI CE FICHIER ─────────────────────────────────────────────────────
//
// `cmdInvite` composait le corps de la requête sur place, dans `src/cli.ts`,
// qui n'exporte rien. Un balayage élargi y a montré `uses !== undefined` muté
// en `===` sans qu'une assertion bouge.
//
// Ce mutant n'est pas cosmétique : avec `===`, `--uses 3` n'atteint plus jamais
// la ruche. Le champ est omis, la ruche applique SON défaut, et la personne
// croit avoir posé un billet à trois usages. Un billet est un droit d'entrée
// COMPTÉ — se tromper sur le compte est une faille.

import { describe, expect, it } from 'vitest';
import { corpsDuBillet, valeurNumerique } from '../src/shared/cli-billet.js';

describe('le corps du billet — ce que la ruche recevra', () => {
  it('SANS RIEN, ON N’ENGAGE RIEN — la ruche garde ses défauts', () => {
    // Un champ absent dit « je n'ai pas d'avis » ; un champ présent engage.
    expect(corpsDuBillet([])).toEqual({});
  });

  it('`--uses N` ARRIVE JUSQU’À LA RUCHE — c’est le mutant du balayage', () => {
    // Avec la garde inversée, ce champ disparaissait : billet à trois usages
    // demandé, billet au défaut de la ruche obtenu.
    expect(corpsDuBillet(['--uses', '3'])).toEqual({ uses: 3 });
  });

  it('« zéro usage » n’est pas « pas d’avis » — 0 est une demande, et elle passe', () => {
    // `0` est falsy : une garde écrite `if (uses)` l'aurait avalé. La ruche
    // jugera si un billet à zéro usage a un sens ; ce n'est pas à la CLI de
    // décider en silence que la personne s'est trompée.
    expect(corpsDuBillet(['--uses', '0'])).toEqual({ uses: 0 });
  });

  it('une valeur ILLISIBLE laisse la ruche décider — jamais un NaN sur le fil', () => {
    // `JSON.stringify({uses: NaN})` rend `{"uses":null}` : une valeur que
    // personne n'a tapée, et que la ruche devrait interpréter.
    for (const brut of ['abc', 'Infinity', '-Infinity']) {
      expect(corpsDuBillet(['--uses', brut]), `pour « ${brut} »`).toEqual({});
    }
    // Et un drapeau en fin de ligne, sans valeur du tout.
    expect(corpsDuBillet(['--uses'])).toEqual({});
  });

  it('UNE CHAÎNE VIDE EST UNE ABSENCE, PAS UN ZÉRO', () => {
    // `Number('')` vaut 0 en JavaScript, et `Number('  ')` aussi. Sans garde,
    // `--uses ""` posait un billet à ZÉRO usage — inutilisable, et sans un mot.
    // Ce défaut n'a pas été trouvé en relisant le code : il est tombé en
    // écrivant le banc, sur un cas qu'on croyait acquis.
    for (const vide of ['', '   ', '\t']) {
      expect(corpsDuBillet(['--uses', vide]), `pour ${JSON.stringify(vide)}`).toEqual({});
      expect(corpsDuBillet(['--hours', vide]), `pour ${JSON.stringify(vide)}`).toEqual({});
    }
  });

  it('`--hours` devient des millisecondes, arrondies', () => {
    expect(corpsDuBillet(['--hours', '2'])).toEqual({ ttlMs: 7_200_000 });
    expect(corpsDuBillet(['--hours', '0.5'])).toEqual({ ttlMs: 1_800_000 });
  });

  it('l’URL est POSITIONNELLE et commence par « ws » — pas n’importe quel mot', () => {
    expect(corpsDuBillet(['wss://ruche.exemple.com'])).toEqual({
      url: 'wss://ruche.exemple.com',
    });
    // Un positionnel qui n'est pas une URL de ruche n'est pas promu en URL.
    expect(corpsDuBillet(['bonjour'])).toEqual({});
    // Et un drapeau ne peut pas être pris pour un positionnel.
    expect(corpsDuBillet(['--insecure'])).toEqual({ insecure: true });
  });

  it('tout ensemble, sans se marcher dessus', () => {
    expect(
      corpsDuBillet(['wss://ruche.exemple.com', '--uses', '5', '--hours', '1', '--insecure']),
    ).toEqual({
      url: 'wss://ruche.exemple.com',
      uses: 5,
      ttlMs: 3_600_000,
      insecure: true,
    });
  });
});

describe('valeurNumerique — lire ce qui suit un drapeau', () => {
  it('rend `undefined` quand le drapeau est absent, jamais 0', () => {
    // Confondre « absent » et « zéro » est exactement l'erreur que la garde
    // `!== undefined` existe pour éviter.
    expect(valeurNumerique([], '--uses')).toBeUndefined();
    expect(valeurNumerique(['--hours', '4'], '--uses')).toBeUndefined();
  });

  it('lit la valeur qui SUIT, pas une autre', () => {
    expect(valeurNumerique(['--uses', '7', '--hours', '2'], '--uses')).toBe(7);
    expect(valeurNumerique(['--uses', '7', '--hours', '2'], '--hours')).toBe(2);
  });
});
