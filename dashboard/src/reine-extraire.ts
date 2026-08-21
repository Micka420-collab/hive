// Extraction navigateur des pièces pour la Reine.
//
// PDF → pdfjs-dist (devDependency, bundlé Vite — jamais une dep runtime nœud).
// DOCX → mammoth (idem). Texte → FileReader. Vidéo/audio/image → refus clair
// (reine-pieces.refusExtraction) : on n'invente pas une transcription.

import {
  CHAT_FICHIER_OCTETS_MAX,
  CHAT_PIECE_TEXTE_MAX,
  classerPiece,
  refusExtraction,
  tronquerPiece,
  type GenrePiece,
  type PieceJointeTexte,
} from '../../src/shared/reine-pieces.js';

async function lireTexteFichier(file: File): Promise<string> {
  return await file.text();
}

async function extrairePdf(file: File): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  // Worker Vite : évite le worker CDN (hors-ligne / CSP).
  pdfjs.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();
  const data = new Uint8Array(await file.arrayBuffer());
  const doc = await pdfjs.getDocument({ data }).promise;
  const pages: string[] = [];
  const maxPages = Math.min(doc.numPages, 40);
  for (let i = 1; i <= maxPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const line = content.items
      .map((it) => ('str' in it && typeof it.str === 'string' ? it.str : ''))
      .filter(Boolean)
      .join(' ');
    if (line.trim()) pages.push(line);
  }
  if (doc.numPages > maxPages) {
    pages.push(`[… ${doc.numPages - maxPages} pages non lues]`);
  }
  return pages.join('\n\n');
}

async function extraireDocx(file: File): Promise<string> {
  const mammoth = await import('mammoth');
  const buf = await file.arrayBuffer();
  const result = await mammoth.extractRawText({ arrayBuffer: buf });
  return result.value ?? '';
}

/**
 * Transforme un `File` en pièce jointe texte (ou refus constaté).
 */
export async function extrairePiece(
  file: File,
  lang: 'fr' | 'en' = 'fr',
): Promise<PieceJointeTexte> {
  const nom = file.name || (lang === 'en' ? 'untitled' : 'sans-titre');
  const genre: GenrePiece = classerPiece(nom, file.type);
  const meta = { nom, genre, octets: file.size };

  if (file.size <= 0) {
    return { ...meta, refus: refusExtraction(genre, lang) };
  }
  if (file.size > CHAT_FICHIER_OCTETS_MAX) {
    return {
      ...meta,
      refus:
        lang === 'en'
          ? `File too large (max ${CHAT_FICHIER_OCTETS_MAX} bytes).`
          : `Fichier trop volumineux (max ${CHAT_FICHIER_OCTETS_MAX} octets).`,
    };
  }

  try {
    if (genre === 'pdf') {
      const texte = tronquerPiece(await extrairePdf(file), CHAT_PIECE_TEXTE_MAX);
      if (!texte.trim()) return { ...meta, refus: refusExtraction('pdf', lang) };
      return { ...meta, texte };
    }
    if (genre === 'docx') {
      const texte = tronquerPiece(await extraireDocx(file), CHAT_PIECE_TEXTE_MAX);
      if (!texte.trim()) return { ...meta, refus: refusExtraction('docx', lang) };
      return { ...meta, texte };
    }
    if (genre === 'texte' || genre === 'markdown') {
      const texte = tronquerPiece(await lireTexteFichier(file), CHAT_PIECE_TEXTE_MAX);
      if (!texte.trim()) return { ...meta, refus: refusExtraction(genre, lang) };
      return { ...meta, texte };
    }
    return { ...meta, refus: refusExtraction(genre, lang) };
  } catch {
    return { ...meta, refus: refusExtraction(genre, lang) };
  }
}
