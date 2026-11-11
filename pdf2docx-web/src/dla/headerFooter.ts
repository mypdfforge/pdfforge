import { TextLine } from './lines.js';
import { PageIR } from '../core/pageir.js';
import { Block, Para } from '../core/ast.js';

export type FurnitureExtraction = {
  bodyLinesPerPage: TextLine[][];
  headers: Block[];
  footers: Block[];
};

export function normalizeFurnitureText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isPageNumberText(text: string): boolean {
  const norm = text.trim().toLowerCase();
  return /^(page\s*)?\d+(\s*(of|\/)\s*\d+)?$/.test(norm);
}

export function extractHeaderFooterFurniture(
  pages: { ir: PageIR; lines: TextLine[] }[]
): FurnitureExtraction {
  if (pages.length < 2) {
    // If fewer than 2 pages, don't risk stripping real content (§5 S4)
    return {
      bodyLinesPerPage: pages.map((p) => p.lines),
      headers: [],
      footers: [],
    };
  }

  const topCandidates: { pageIdx: number; line: TextLine; norm: string }[] = [];
  const bottomCandidates: { pageIdx: number; line: TextLine; norm: string }[] = [];

  for (let i = 0; i < pages.length; i++) {
    const { ir, lines } = pages[i];
    const topLimit = ir.height * 0.12; // top 12%
    const bottomLimit = ir.height * 0.88; // bottom 12%

    for (const l of lines) {
      const text = l.segments[0]?.text || '';
      const norm = normalizeFurnitureText(text);

      if (l.box.y1 <= topLimit) {
        topCandidates.push({ pageIdx: i, line: l, norm });
      } else if (l.box.y0 >= bottomLimit) {
        bottomCandidates.push({ pageIdx: i, line: l, norm });
      }
    }
  }

  // Count occurrences across pages
  const topCounts = new Map<string, Set<number>>();
  for (const c of topCandidates) {
    if (!topCounts.has(c.norm)) topCounts.set(c.norm, new Set());
    topCounts.get(c.norm)!.add(c.pageIdx);
  }

  const bottomCounts = new Map<string, Set<number>>();
  for (const c of bottomCandidates) {
    if (!bottomCounts.has(c.norm)) bottomCounts.set(c.norm, new Set());
    bottomCounts.get(c.norm)!.add(c.pageIdx);
  }

  const minPages = Math.ceil(pages.length * 0.5); // appears on >= 50% of pages

  const headerNorms = new Set<string>();
  for (const [norm, pageSet] of topCounts.entries()) {
    if (pageSet.size >= minPages || isPageNumberText(norm)) {
      headerNorms.add(norm);
    }
  }

  const footerNorms = new Set<string>();
  for (const [norm, pageSet] of bottomCounts.entries()) {
    if (pageSet.size >= minPages || isPageNumberText(norm)) {
      footerNorms.add(norm);
    }
  }

  const headers: Block[] = [];
  const footers: Block[] = [];

  const bodyLinesPerPage: TextLine[][] = [];

  for (let i = 0; i < pages.length; i++) {
    const { lines } = pages[i];
    const pageBodyLines: TextLine[] = [];

    for (const l of lines) {
      const text = l.segments[0]?.text || '';
      const norm = normalizeFurnitureText(text);

      if (headerNorms.has(norm)) {
        if (headers.length === 0) {
          headers.push(createFurnitureBlock(l, isPageNumberText(text)));
        }
      } else if (footerNorms.has(norm)) {
        if (footers.length === 0) {
          footers.push(createFurnitureBlock(l, isPageNumberText(text)));
        }
      } else {
        pageBodyLines.push(l);
      }
    }

    bodyLinesPerPage.push(pageBodyLines);
  }

  return {
    bodyLinesPerPage,
    headers,
    footers,
  };
}

function createFurnitureBlock(line: TextLine, isPageNumber: boolean): Para {
  return {
    type: 'p',
    runs: isPageNumber
      ? [{ text: 'PAGE', font: 'Calibri', size: 9 }]
      : line.segments[0]?.runs.map((r) => ({ ...r, size: 9 })) || [{ text: '' }],
    align: 'center',
  };
}
