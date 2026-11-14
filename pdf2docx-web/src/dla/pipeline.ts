import { DocumentIR, PageIR } from '../core/pageir.js';
import { DocAST, Block, Table } from '../core/ast.js';
import { clusterGlyphsIntoLines } from './lines.js';
import { reflowParagraphs } from './paragraphs.js';
import { extractHeaderFooterFurniture } from './headerFooter.js';
import { recursiveXYCut } from './xycut.js';
import { traverseReadingOrder } from './readingOrder.js';
import { extractSegments, findTableConnectedComponents, buildTableFromCandidate } from './tablesRuled.js';
import { findBorderlessCandidateBands, passesSharedBaselineTest, buildBorderlessTable } from './tablesBorderless.js';
import { extractFootnotes } from './footnotes.js';
import { detectCalloutContainers, convertImagesToBlocks } from './shapes.js';
import { computeBodyFontSize } from './headings.js';
import { buildDocAST, BuildOptions } from '../ast/build.js';
import { emitDocxBuffer } from '../emit/docxEmitter.js';
import { postfixDocx } from '../emit/postfix.js';

export type ConvertReport = {
  totalPages: number;
  totalGlyphs: number;
  totalParagraphs: number;
  totalTables: number;
  totalImages: number;
  warnings: string[];
  durationMs: number;
};

export async function convertDocumentIRToDocx(
  docIr: DocumentIR,
  options: BuildOptions = {}
): Promise<{ docx: Uint8Array; ast: DocAST; report: ConvertReport }> {
  const startTime = Date.now();
  let totalGlyphs = 0;
  let totalParagraphs = 0;
  let totalTables = 0;
  let totalImages = 0;

  // Step S2: Extract lines per page
  const pageLinePairs = docIr.pages.map((page) => {
    totalGlyphs += page.stats.glyphCount;
    totalImages += page.images.length;
    const lines = clusterGlyphsIntoLines(page.glyphs, page.fonts, page.links, page.strokes);
    return {
      ir: page,
      lines,
    };
  });

  // Step S4: Extract Header/Footer Furniture across pages
  const furniture = extractHeaderFooterFurniture(pageLinePairs);

  // Step S5, S6, S7, S8: Tables, Shapes, Images, Footnotes, Paragraphs
  const pageBlocks: { ir: PageIR; blocks: Block[] }[] = [];
  const scannedPageWarnings: string[] = [];

  for (let i = 0; i < pageLinePairs.length; i++) {
    const ir = pageLinePairs[i].ir;
    if (ir.stats.glyphCount === 0) {
      scannedPageWarnings.push(`Page ${ir.pageIndex + 1} contains no digital Unicode text (scanned document).`);
    }
    let lines = furniture.bodyLinesPerPage[i];
    const bodySize = computeBodyFontSize(lines);

    // S3 Footnote extraction
    const { bodyLines: nonFootnoteLines, footnotes } = extractFootnotes(
      lines,
      ir.strokes,
      ir.height,
      ir.width,
      bodySize
    );
    lines = nonFootnoteLines;

    const pageTables: Table[] = [];
    const consumedLineIndices = new Set<number>();

    // 1. S5A Ruled Tables
    const segments = extractSegments(ir);
    const tableCandidates = findTableConnectedComponents(segments);

    for (const cand of tableCandidates) {
      const { table, consumedLineIndices: tableConsumed } = buildTableFromCandidate(
        cand,
        lines,
        ir.fills,
        ir.pageIndex
      );
      if (table.rows.length > 0) {
        pageTables.push(table);
        for (const idx of tableConsumed) {
          consumedLineIndices.add(idx);
        }
      }
    }

    // 2. S5B Borderless Tables
    const borderlessBands = findBorderlessCandidateBands(lines, consumedLineIndices);
    for (const band of borderlessBands) {
      if (passesSharedBaselineTest(band)) {
        const { table, consumedIndices } = buildBorderlessTable(band, ir.pageIndex, ir.width);
        if (table.rows.length > 0) {
          pageTables.push(table);
          for (const idx of consumedIndices) {
            consumedLineIndices.add(idx);
          }
        }
      }
    }
    totalTables += pageTables.length;

    // Filter remaining body lines
    const remainingLines = lines.filter((_, idx) => !consumedLineIndices.has(idx));

    // Step S3: XY-Cut & Reading order
    const cutTree = recursiveXYCut(remainingLines);
    const readingOrderLeaves = traverseReadingOrder(cutTree);

    const initialBlocks: Block[] = [];
    const allElements: { y0: number; block: Block }[] = [];

    for (const tbl of pageTables) {
      allElements.push({ y0: tbl.src?.box.y0 || 0, block: tbl });
    }

    for (const leafLines of readingOrderLeaves) {
      const paragraphs = reflowParagraphs(leafLines, ir.pageIndex, ir.width);
      totalParagraphs += paragraphs.length;
      for (const p of paragraphs) {
        allElements.push({ y0: p.src?.box.y0 || 0, block: p });
      }
    }

    // Sort by y0
    allElements.sort((a, b) => a.y0 - b.y0);
    initialBlocks.push(...allElements.map((e) => e.block));

    // S8: Add Image blocks
    const imageBlocks = convertImagesToBlocks(ir.images, initialBlocks, ir.pageIndex);
    initialBlocks.push(...imageBlocks);

    // S8: Shaded panels and Callouts (converts to 1x1 table containers, never floating textboxes)
    const blocksWithCallouts = detectCalloutContainers(initialBlocks, ir.fills, ir.width, ir.height);

    // Append footnotes at end of page blocks
    if (footnotes.length > 0) {
      blocksWithCallouts.push(...footnotes);
    }

    pageBlocks.push({
      ir,
      blocks: blocksWithCallouts,
    });
  }

  // Step S9: Build and normalize AST with furniture
  const ast = buildDocAST(pageBlocks, {
    ...options,
    headers: furniture.headers.length > 0 ? furniture.headers : options.headers,
    footers: furniture.footers.length > 0 ? furniture.footers : options.footers,
  });

  // Step S10: Emit DOCX
  const rawBuffer = await emitDocxBuffer(ast, docIr.binaryStore);

  // Step S11: Post-fix OpenXML
  const docx = postfixDocx(rawBuffer);

  const durationMs = Date.now() - startTime;

  return {
    docx,
    ast,
    report: {
      totalPages: docIr.pages.length,
      totalGlyphs,
      totalParagraphs,
      totalTables,
      totalImages,
      warnings: [
        ...scannedPageWarnings,
        ...ast.meta.warnings.map((w) => w.message),
      ],
      durationMs,
    },
  };
}
