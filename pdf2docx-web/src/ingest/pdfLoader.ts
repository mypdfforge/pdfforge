import * as pdfjsLib from 'pdfjs-dist';
import { PageIR, DocumentIR, Glyph, FontInfo, LinkObj } from '../core/pageir.js';
import { OperatorInterpreter } from './opInterpreter.js';
import { parseFontDescriptor } from './fontMap.js';

export async function loadPdfDocument(
  source: ArrayBuffer | Uint8Array,
  onPageProgress?: (current: number, total: number) => void
): Promise<DocumentIR> {
  let uint8Data: Uint8Array;
  if (source instanceof Uint8Array) {
    uint8Data = new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  } else {
    uint8Data = new Uint8Array(source);
  }

  const loadingTask = pdfjsLib.getDocument({
    data: uint8Data,
    disableFontFace: false,
    useSystemFonts: false,
    isEvalSupported: false,
  });

  const doc = await loadingTask.promise;
  const numPages = doc.numPages;
  const pages: PageIR[] = [];
  const binaryStore = new Map<string, Uint8Array>();

  for (let pageNum = 1; pageNum <= numPages; pageNum++) {
    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: 1.0 });
    const width = viewport.width;
    const height = viewport.height;
    const rotation = page.rotate as 0 | 90 | 180 | 270;

    const interpreter = new OperatorInterpreter(height);

    // Extract text content items
    const textContent = await page.getTextContent();
    const fontsMap = new Map<string, FontInfo>();

    for (const item of textContent.items as any[]) {
      if (!('str' in item) || !item.str) continue;

      const str: string = item.str;
      const tx = item.transform; // [scaleX, skewY, skewX, scaleY, transX, transY]
      const fontSize = Math.sqrt(tx[0] * tx[0] + tx[1] * tx[1]);
      const fontName = item.fontName || 'Calibri';
      const fontInfo = parseFontDescriptor(fontName);
      if (!fontsMap.has(fontInfo.key)) {
        fontsMap.set(fontInfo.key, fontInfo);
      }

      // Compute character advance boxes
      const totalWidth = item.width || 0;
      const charCount = str.length;
      const avgCharWidth = charCount > 0 ? totalWidth / charCount : fontSize * 0.5;

      let currentX = tx[4];
      const pdfY = tx[5];

      for (let i = 0; i < charCount; i++) {
        const char = str[i];
        interpreter.addGlyph(
          char,
          currentX,
          pdfY,
          avgCharWidth,
          fontSize,
          fontInfo.key,
          '#000000'
        );
        currentX += avgCharWidth;
      }
    }

    // Extract link annotations
    const annotations = await page.getAnnotations();
    const links: LinkObj[] = [];
    for (const annot of annotations) {
      if (annot.subtype === 'Link' && annot.rect) {
        const [x0, y0, x1, y1] = annot.rect;
        const normY0 = height - y1;
        const normY1 = height - y0;
        links.push({
          box: {
            x0: Math.min(x0, x1),
            y0: Math.min(normY0, normY1),
            x1: Math.max(x0, x1),
            y1: Math.max(normY0, normY1),
          },
          url: annot.url || undefined,
          destPage: typeof annot.dest === 'number' ? annot.dest : undefined,
        });
      }
    }

    const pageIr: PageIR = {
      pageIndex: pageNum - 1,
      width,
      height,
      rotation,
      glyphs: interpreter.glyphs,
      fonts: Array.from(fontsMap.values()),
      strokes: interpreter.strokes,
      fills: interpreter.fills,
      images: interpreter.images,
      links,
      stats: {
        glyphCount: interpreter.glyphs.length,
        puaCount: interpreter.puaCount,
      },
    };

    pages.push(pageIr);

    // Free memory
    page.cleanup();

    if (onPageProgress) {
      onPageProgress(pageNum, numPages);
    }
  }

  return {
    pages,
    binaryStore,
    meta: {
      totalPages: numPages,
    },
  };
}
