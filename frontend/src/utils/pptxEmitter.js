/**
 * pptxEmitter.js — Editable 2D PPTX Slide Emitter
 * Transforms a Universal Document AST into an editable, presentation-ready PowerPoint (.pptx)
 * deck with native text frames, slide tables, and vector shapes.
 */

import PptxGenJS from 'pptxgenjs';
import { NodeType } from './documentAst.js';

/**
 * Maps PDF bottom-up coordinates to PowerPoint top-down coordinates in inches.
 */
function toSlideCoords(x, y, w, h, pageHeight) {
  const left = Math.max(0, (x || 54) / 72);
  const top = Math.max(0, (pageHeight - (y || 0) - (h || 20)) / 72);
  const width = Math.max(0.5, (w || 200) / 72);
  const height = Math.max(0.2, (h || 20) / 72);
  return { x: left, y: top, w: width, h: height };
}

/**
 * Builds a PptxGenJS presentation from a Universal Document AST.
 * @param {object} ast - Universal Document AST
 * @param {object} PptxConstructor - Optional PptxGenJS constructor override
 * @returns {object} PptxGenJS presentation instance
 */
export function buildPptxFromAst(ast, PptxConstructor = PptxGenJS) {
  const pptx = new PptxConstructor();
  pptx.title = ast.title || 'PDFForge Presentation';
  pptx.author = ast.author || 'PDFForge Universal WASM Engine';

  for (const page of ast.pages) {
    const pageWidth = page.width || 595.28;
    const pageHeight = page.height || 841.89;
    const widthInches = pageWidth / 72;
    const heightInches = pageHeight / 72;

    const layoutName = `LAYOUT_P${page.pageNumber}_${Math.round(pageWidth)}x${Math.round(pageHeight)}`;
    pptx.defineLayout({
      name: layoutName,
      width: widthInches,
      height: heightInches,
    });
    pptx.layout = layoutName;

    const slide = pptx.addSlide();

    // Track running vertical layout cursor if bounding boxes are absent
    let curYInches = 0.6;

    for (const child of page.children) {
      if (child.type === NodeType.PARAGRAPH) {
        const textRuns = child.runs.map((r) => ({
          text: r.text,
          options: {
            fontSize: r.size || (child.headingLevel === 1 ? 20 : child.headingLevel === 2 ? 14 : 11),
            bold: r.bold || Boolean(child.headingLevel),
            italic: r.italic,
            color: r.color ? r.color.replace('#', '') : '1E293B',
            fontFace: r.font || (child.headingLevel ? 'Calibri' : 'Arial'),
          },
        }));

        if (textRuns.length === 0) continue;

        let coords;
        if (child.bbox && typeof child.bbox.x === 'number') {
          coords = toSlideCoords(child.bbox.x, child.bbox.y, child.bbox.w, child.bbox.h, pageHeight);
        } else {
          coords = {
            x: 0.75,
            y: curYInches,
            w: widthInches - 1.5,
            h: child.headingLevel === 1 ? 0.6 : 0.35,
          };
          curYInches += coords.h + 0.1;
        }

        slide.addText(textRuns, {
          x: coords.x,
          y: coords.y,
          w: coords.w,
          h: coords.h,
          align: child.align || 'left',
          valign: 'top',
        });
      } else if (child.type === NodeType.TABLE) {
        const theme = child.theme || {};
        const headerBg = (theme.headerBg || '1E293B').replace('#', '');
        const borderColor = (theme.border || 'CBD5E1').replace('#', '');

        const pptxTableRows = child.rows.map((row) =>
          row.cells.map((cell) => ({
            text: cell.text,
            options: {
              bold: row.isHeader || cell.isHeader || cell.bold,
              color: row.isHeader || cell.isHeader ? 'FFFFFF' : '1E293B',
              fill: row.isHeader || cell.isHeader ? headerBg : cell.bg ? cell.bg.replace('#', '') : 'FFFFFF',
              fontSize: cell.fontSize || 9,
              align: cell.align || (cell.isNumeric ? 'right' : 'left'),
              valign: 'middle',
              border: { pt: 0.5, color: borderColor },
            },
          }))
        );

        const tableWidth = widthInches - 1.5;
        const colWidths = child.colWidths && child.colWidths.length > 0
          ? child.colWidths.map((w) => (w / 100) * tableWidth)
          : undefined;

        slide.addTable(pptxTableRows, {
          x: 0.75,
          y: curYInches,
          w: tableWidth,
          colWidth: colWidths,
          margin: 4,
        });

        curYInches += (child.rows.length * 0.3) + 0.25;
      } else if (child.type === NodeType.CALLOUT) {
        const bg = (child.bg || 'F8FAFC').replace('#', '');
        const border = (child.border || '3B82F6').replace('#', '');
        const text = child.children
          .map((c) => (c.runs ? c.runs.map((r) => r.text).join(' ') : ''))
          .join('\n');

        slide.addText(text || child.title || '', {
          x: 0.75,
          y: curYInches,
          w: widthInches - 1.5,
          h: 0.6,
          fill: { color: bg },
          line: { color: border, width: 2 },
          fontSize: 10,
          color: '334155',
          margin: 6,
        });
        curYInches += 0.75;
      } else if (child.type === NodeType.CODE_BLOCK) {
        const codeText = child.lines.join('\n');
        const codeHeight = Math.min(Math.max((child.lines.length || 1) * 0.25, 0.4), 3.0);
        slide.addText(codeText, {
          x: 0.75,
          y: curYInches,
          w: widthInches - 1.5,
          h: codeHeight,
          fill: { color: (child.bg || 'F1F5F9').replace('#', '') },
          line: { color: (child.border || 'CBD5E1').replace('#', ''), width: 1 },
          fontFace: 'Consolas',
          fontSize: 9,
          color: '0F172A',
          margin: 6,
        });
        curYInches += codeHeight + 0.2;
      } else if (child.type === NodeType.SHAPE) {
        const left = Math.max(0, (child.x || 0) / 72);
        const top = Math.max(0, (pageHeight - (child.y || 0) - (child.h || 20)) / 72);
        const width = Math.max(0.2, (child.w || 50) / 72);
        const height = Math.max(0.1, (child.h || 20) / 72);
        slide.addShape(pptx.ShapeType.rect, {
          x: left,
          y: top,
          w: width,
          h: height,
          fill: child.fill ? { color: child.fill.replace('#', '') } : undefined,
          line: child.stroke ? { color: child.stroke.replace('#', ''), width: child.lineWidth || 1 } : undefined,
        });
      }
    }
  }

  return pptx;
}

/**
 * Generates an editable PowerPoint (.pptx) binary Blob from a Universal Document AST.
 */
export async function exportAstToPptx(ast, PptxConstructor = PptxGenJS) {
  const pptx = buildPptxFromAst(ast, PptxConstructor);
  const blob = await pptx.write({ outputType: 'blob' });
  return blob;
}
