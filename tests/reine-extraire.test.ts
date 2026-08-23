// @vitest-environment happy-dom
//
// L'extraction navigateur des pièces de la Reine.
//
// `pdfjs-dist` et `mammoth` sont remplacés par des doubles : le banc ne juge
// pas leur capacité à lire un PDF, il juge CE QUE FAIT le module de ce qu'ils
// rendent — les pages recollées, le plafond de 40 pages, le texte vide qui
// devient un refus, et l'exception qui ne remonte jamais à l'appelant.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAT_FICHIER_OCTETS_MAX,
  CHAT_PIECE_TEXTE_MAX,
  refusExtraction,
} from '../src/shared/reine-pieces.js';

/**
 * Pages rendues par le faux pdfjs — un banc les repose avant chaque cas.
 *
 * `unknown[]` et non `string[]` À DESSEIN : le module garde ses items par
 * `'str' in it && typeof it.str === 'string'`, et cette garde ne peut se
 * défendre que si un banc peut lui donner un `str` qui n'est PAS une chaîne.
 */
let pagesPdf: unknown[][] = [];
/** Posé par un banc pour que `getDocument` jette, comme un PDF chiffré. */
let pdfJette = false;
/** Texte rendu par le faux mammoth (`undefined` = champ absent). */
let texteDocx: string | undefined = '';
let docxJette = false;

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: (async () => {
      if (pdfJette) throw new Error('PDF chiffré');
      return {
        numPages: pagesPdf.length,
        getPage: async (n: number) => ({
          getTextContent: async () => ({
            // Une chaîne est le cas courant, et s'écrit court. Un objet passe
            // TEL QUEL : c'est ainsi qu'un banc pose un item mal formé.
            items: (pagesPdf[n - 1] ?? []).map((v) =>
              typeof v === 'object' && v !== null ? v : { str: v },
            ),
          }),
        }),
      };
    })(),
  }),
}));

vi.mock('mammoth', () => ({
  extractRawText: async () => {
    if (docxJette) throw new Error('archive corrompue');
    return { value: texteDocx };
  },
}));

const { extrairePiece } = await import('../dashboard/src/reine-extraire.js');

/** Combien de fois le module a demandé le CONTENU d'un fichier. */
let lectures = 0;

/** Un `File` de la taille voulue, sans allouer 8 Mio pour autant. */
function fichier(
  nom: string,
  contenu: string,
  opts: { type?: string; octets?: number } = {},
): File {
  const f = new File([contenu], nom, { type: opts.type ?? '' });
  if (opts.octets !== undefined) {
    Object.defineProperty(f, 'size', { value: opts.octets, configurable: true });
  }
  // Compter les OUVERTURES, sans changer ce qui est lu. C'est la seule façon de
  // distinguer « refusé sans être ouvert » de « ouvert, puis trouvé vide » : les
  // deux rendent exactement le même refus, seul le travail fait diffère.
  const texte = f.text.bind(f);
  const tampon = f.arrayBuffer.bind(f);
  Object.defineProperty(f, 'text', {
    configurable: true,
    value: () => {
      lectures++;
      return texte();
    },
  });
  Object.defineProperty(f, 'arrayBuffer', {
    configurable: true,
    value: () => {
      lectures++;
      return tampon();
    },
  });
  return f;
}

beforeEach(() => {
  pagesPdf = [];
  pdfJette = false;
  texteDocx = '';
  docxJette = false;
  lectures = 0;
});

describe('les constats faits avant toute lecture', () => {
  it('un fichier vide est refusé sans être ouvert', async () => {
    const piece = await extrairePiece(fichier('vide.txt', ''));
    expect(piece.texte).toBeUndefined();
    expect(piece.refus).toBe(refusExtraction('texte'));
    expect(piece.octets).toBe(0);
    // Le refus seul ne prouve RIEN : un fichier de zéro octet lu jusqu'au bout
    // rendrait le même refus par le chemin « texte vide ». C'est le compteur
    // qui distingue — et c'est lui qui défend la borne `size <= 0`, que la
    // loupe a mutée en `size < 0` sans que rien ne rougisse.
    expect(lectures).toBe(0);
  });

  it('un PDF de zéro octet n’est pas ouvert non plus', async () => {
    pagesPdf = [['jamais lu']];
    const piece = await extrairePiece(fichier('vide.pdf', '', { type: 'application/pdf' }));
    expect(piece.refus).toBe(refusExtraction('pdf'));
    expect(piece.texte).toBeUndefined();
    expect(lectures).toBe(0);
  });

  it('un fichier trop lourd est refusé en nommant le plafond', async () => {
    const piece = await extrairePiece(
      fichier('gros.txt', 'x', { octets: CHAT_FICHIER_OCTETS_MAX + 1 }),
    );
    expect(piece.refus).toContain(String(CHAT_FICHIER_OCTETS_MAX));
    expect(piece.refus).toMatch(/volumineux/);
  });

  it('le même refus se dit en anglais quand on le demande', async () => {
    const piece = await extrairePiece(
      fichier('big.txt', 'x', { octets: CHAT_FICHIER_OCTETS_MAX + 1 }),
      'en',
    );
    expect(piece.refus).toMatch(/too large/);
  });

  it('exactement le plafond passe — la borne est acceptée, pas rejetée', async () => {
    const piece = await extrairePiece(
      fichier('pile.txt', 'bonjour', { octets: CHAT_FICHIER_OCTETS_MAX }),
    );
    expect(piece.texte).toBe('bonjour');
  });

  it('un fichier sans nom en reçoit un, dans la langue demandée', async () => {
    const fr = await extrairePiece(fichier('', 'x'));
    const en = await extrairePiece(fichier('', 'x'), 'en');
    expect(fr.nom).toBe('sans-titre');
    expect(en.nom).toBe('untitled');
  });
});

describe('les genres que le navigateur ne lit pas', () => {
  it('une vidéo est refusée, et le refus dit quoi joindre à la place', async () => {
    const piece = await extrairePiece(fichier('demo.mp4', 'xxx', { type: 'video/mp4' }));
    expect(piece.genre).toBe('video');
    expect(piece.texte).toBeUndefined();
    expect(piece.refus).toBe(refusExtraction('video'));
  });

  it('une image est refusée sans prétendre la décrire', async () => {
    const piece = await extrairePiece(fichier('plan.png', 'xxx', { type: 'image/png' }));
    expect(piece.genre).toBe('image');
    expect(piece.refus).toBe(refusExtraction('image'));
  });

  it('un ancien .doc binaire renvoie vers un format exportable', async () => {
    const piece = await extrairePiece(fichier('vieux.doc', 'xxx'));
    expect(piece.genre).toBe('autre');
    expect(piece.refus).toBe(refusExtraction('autre'));
  });
});

describe('le texte', () => {
  it('un fichier texte est rendu tel quel', async () => {
    const piece = await extrairePiece(fichier('notes.txt', 'bonjour la ruche'));
    expect(piece.texte).toBe('bonjour la ruche');
    expect(piece.refus).toBeUndefined();
  });

  it('du code est lu comme du texte', async () => {
    const piece = await extrairePiece(fichier('index.ts', 'export const x = 1;'));
    expect(piece.genre).toBe('texte');
    expect(piece.texte).toBe('export const x = 1;');
  });

  it('un texte plus long que le plafond est tronqué et le DIT', async () => {
    const piece = await extrairePiece(fichier('long.txt', 'a'.repeat(CHAT_PIECE_TEXTE_MAX + 500)));
    expect(piece.texte).toContain('tronqué');
    expect(piece.texte!.startsWith('a'.repeat(CHAT_PIECE_TEXTE_MAX))).toBe(true);
  });

  it('un fichier fait de blancs seulement est un refus, pas une pièce vide', async () => {
    const piece = await extrairePiece(fichier('blanc.txt', '   \n\t  '));
    expect(piece.texte).toBeUndefined();
    expect(piece.refus).toBe(refusExtraction('texte'));
  });
});

describe('le PDF', () => {
  it('les pages sont recollées, mots séparés par une espace', async () => {
    pagesPdf = [
      ['Bonjour', 'la', 'ruche'],
      ['Seconde', 'page'],
    ];
    const piece = await extrairePiece(fichier('doc.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.genre).toBe('pdf');
    expect(piece.texte).toBe('Bonjour la ruche\n\nSeconde page');
  });

  it('un item dont le « str » n’est pas une chaîne est écarté', async () => {
    // pdfjs mêle des items de texte et des marqueurs de contenu : seul un `str`
    // de type chaîne est du texte. Sans la garde de TYPE, un nombre entrerait
    // dans la page — c'est exactement ce qu'autorisait le mutant `&&` → `||`.
    pagesPdf = [[{ str: 42 }, { str: 'vrai texte' }, { str: { nom: 'piège' } }]];
    const piece = await extrairePiece(fichier('doc.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.texte).toBe('vrai texte');
  });

  it('une page sans texte ne laisse pas de trou entre les autres', async () => {
    pagesPdf = [['Un'], ['   '], ['Trois']];
    const piece = await extrairePiece(fichier('doc.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.texte).toBe('Un\n\nTrois');
  });

  it('au-delà de 40 pages, le reste est ANNONCÉ non lu plutôt que passé sous silence', async () => {
    pagesPdf = Array.from({ length: 43 }, (_, i) => [`p${i + 1}`]);
    const piece = await extrairePiece(fichier('doc.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.texte).toContain('p40');
    expect(piece.texte).not.toContain('p41');
    expect(piece.texte).toContain('[… 3 pages non lues]');
  });

  it('exactement 40 pages sont lues sans mention de reste', async () => {
    pagesPdf = Array.from({ length: 40 }, (_, i) => [`p${i + 1}`]);
    const piece = await extrairePiece(fichier('doc.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.texte).toContain('p40');
    expect(piece.texte).not.toContain('non lues');
  });

  it('un PDF sans aucun texte (scan) devient un refus, pas une pièce muette', async () => {
    pagesPdf = [[''], ['  ']];
    const piece = await extrairePiece(fichier('scan.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.texte).toBeUndefined();
    expect(piece.refus).toBe(refusExtraction('pdf'));
  });

  it('un PDF qui fait jeter la bibliothèque ne remonte pas l’exception', async () => {
    pdfJette = true;
    const piece = await extrairePiece(fichier('chiffre.pdf', 'xxx', { type: 'application/pdf' }));
    expect(piece.refus).toBe(refusExtraction('pdf'));
  });
});

describe('le DOCX', () => {
  it('le texte brut du document est rendu', async () => {
    texteDocx = 'Rapport de chantier';
    const piece = await extrairePiece(fichier('rapport.docx', 'xxx'));
    expect(piece.genre).toBe('docx');
    expect(piece.texte).toBe('Rapport de chantier');
  });

  it('un document reconnu à son type MIME, sans extension parlante', async () => {
    texteDocx = 'Sans extension';
    const piece = await extrairePiece(
      fichier('piece', 'xxx', {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      }),
    );
    expect(piece.genre).toBe('docx');
    expect(piece.texte).toBe('Sans extension');
  });

  it('un document sans champ texte devient un refus, jamais « undefined »', async () => {
    texteDocx = undefined;
    const piece = await extrairePiece(fichier('vide.docx', 'xxx'));
    expect(piece.texte).toBeUndefined();
    expect(piece.refus).toBe(refusExtraction('docx'));
  });

  it('une archive corrompue est un refus, pas une exception', async () => {
    docxJette = true;
    const piece = await extrairePiece(fichier('casse.docx', 'xxx'));
    expect(piece.refus).toBe(refusExtraction('docx'));
  });
});
