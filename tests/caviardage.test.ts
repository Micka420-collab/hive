// LE CAVIARDAGE AU NŒUD — ce qui ne doit jamais quitter la machine du membre.
//
// `creerCaviardeur` tient deux frontières : le TEXTE (logs, sortie en direct,
// réponse finale), où tous les motifs connus de la ruche s'appliquent, et le
// DIFF, que Honeycomb Merge appliquera ensuite, où seuls les formats littéraux
// de jetons et les valeurs exactes s'appliquent — `token: string` est du code.

import { describe, expect, it } from 'vitest';
import {
  creerCaviardeur,
  MARQUE_LIGNE_TRONQUEE,
  SECRET_CAVIARDE,
  valeursSecretes,
} from '../src/shared/caviardage.js';

const CLE = 'cle-du-fournisseur-inconnu-0123456789';

describe('valeursSecretes — les variables d’identification, pas les chemins', () => {
  it('garde les clés et jetons, écarte HOME, les URL de base et les dossiers', () => {
    expect(
      valeursSecretes({
        HOME: '/home/membre',
        APPDATA: 'C:\\Users\\membre\\AppData',
        ANTHROPIC_BASE_URL: 'https://proxy.local',
        GROK_HOME: '/home/membre/.grok',
        ANTHROPIC_API_KEY: 'a-1',
        CLAUDE_CODE_OAUTH_TOKEN: 'a-2',
        ANTHROPIC_AUTH_TOKEN: 'a-3',
        CURSOR_API_KEY: 'a-4',
        VIDE: undefined,
      }).sort(),
    ).toEqual(['a-1', 'a-2', 'a-3', 'a-4']);
  });
});

describe('creerCaviardeur — texte', () => {
  it('remplace la valeur EXACTE d’une clé qu’aucun motif ne reconnaît', () => {
    const c = creerCaviardeur([CLE]);
    expect(c.texte(`auth avec ${CLE} puis ${CLE}`)).toBe(
      `auth avec ${SECRET_CAVIARDE} puis ${SECRET_CAVIARDE}`,
    );
  });

  it('applique aussi les motifs connus de la ruche (jetons GitHub, Bearer, URL)', () => {
    const c = creerCaviardeur([]);
    const sortie = c.texte(
      'ghp_abcdefghij0123 Bearer eyJhbGciOi https://moi:motdepasse@github.com/o/d.git',
    );
    expect(sortie).not.toMatch(/ghp_|eyJ|motdepasse/);
  });

  it('ignore une « valeur » trop courte pour être un identifiant', () => {
    expect(creerCaviardeur(['1', 'true']).texte('exit 1 : true')).toBe('exit 1 : true');
  });

  it('une valeur qui en contient une autre disparaît ENTIÈRE, sans laisser ses bords', () => {
    const courte = 'secretcourt';
    const longue = `prefixe-${courte}-suffixe`;
    expect(creerCaviardeur([courte, longue]).texte(longue)).toBe(SECRET_CAVIARDE);
  });

  it('masque un DÉBUT de clé coupé net par la marque de ligne tronquée', () => {
    const coupee = `… ${CLE.slice(0, 20)}${MARQUE_LIGNE_TRONQUEE}`;
    const sortie = creerCaviardeur([CLE]).texte(coupee);
    expect(sortie).not.toContain(CLE.slice(0, 20));
    expect(sortie).toBe(`… ${SECRET_CAVIARDE}${MARQUE_LIGNE_TRONQUEE}`);
  });
});

describe('creerCaviardeur — diff', () => {
  it('remplace une clé écrite dans un fichier, et les formats littéraux de jetons', () => {
    const c = creerCaviardeur([CLE]);
    const diff = `+const cle = '${CLE}';\n+const gh = 'ghp_abcdefghij0123';\n`;
    expect(c.diff(diff)).toBe(
      `+const cle = '${SECRET_CAVIARDE}';\n+const gh = '${SECRET_CAVIARDE}';\n`,
    );
  });

  it('ne réécrit PAS le code ordinaire que les motifs d’affectation reconnaîtraient', () => {
    const code =
      "+  token: string;\n+  headers: { authorization: 'Bearer ' + jeton },\n" +
      '+  const url = `https://${user}:${pass}@github.com/o/d.git`;\n';
    expect(creerCaviardeur([CLE]).diff(code)).toBe(code);
    // Le même texte, traité comme un log, serait caviardé : c'est bien la
    // frontière qui protège le patch.
    expect(creerCaviardeur([CLE]).texte(code)).not.toBe(code);
  });
});
