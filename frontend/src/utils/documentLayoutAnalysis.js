/**
 * documentLayoutAnalysis.js — Multi-Format Document Layout Analysis (DLA)
 * Transforms raw spatial text items and vector geometries into a structured
 * Universal Document AST ready for Word, Excel, and PowerPoint emitters.
 */

import {
  createDocument,
  createPage,
  createParagraph,
  createTextRun,
  createTable,
  createTableRow,
  createTableCell,
  createCallout,
  createCodeBlock,
  createShape,
} from './documentAst.js';
import { segmentIntoColumns, mergeParagraphBlocks } from './pdfLayoutSegmenter.js';
import { detectTableRegions } from './pdfTableDetector.js';

const CURRENCY_OR_NUM_CLEAN_RE = /[\$€£¥\s,]/g;

/**
 * Robust numerical and accounting format parser for spreadsheet cell binding.
 * Parses currency, percentages, negative parenthetical numbers (e.g. (1,200.50) -> -1200.50).
 */
export function parseNumericCell(str) {
  if (!str || typeof str !== 'string') {
    return { isNumeric: false, rawValue: null, formatCode: null };
  }

  const trimmed = str.trim();

  // Check for parenthetical negative: (1,250.00) or ($1,250)
  const isParenNegative = /^\(\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*\)$/.test(trimmed);
  // Check for percentage: 12.5%
  const isPercent = /^[+-]?\s*[\d,]+(\.\d+)?\s*%$/.test(trimmed);
  // Check standard numeric / currency
  const isCurrency = /^[\$€£¥]/.test(trimmed) || /[\$€£¥]$/.test(trimmed);
  const isGeneralNum = /^[+-]?\s*[\$€£¥]?\s*[\d,]+(\.\d+)?\s*$/.test(trimmed);

  if (isParenNegative || isPercent || isGeneralNum) {
    let cleanStr = trimmed.replace(CURRENCY_OR_NUM_CLEAN_RE, '').replace(/[%()]/g, '');
    let val = parseFloat(cleanStr);
    if (!isNaN(val)) {
      if (isParenNegative) val = -Math.abs(val);
      if (isPercent) val = val / 100;

      let formatCode = '0.00';
      if (isCurrency) formatCode = '$#,##0.00';
      if (isPercent) formatCode = '0.0%';

      return {
        isNumeric: true,
        rawValue: val,
        formatCode,
      };
    }
  }

  return { isNumeric: false, rawValue: null, formatCode: null };
}

/**
 * Builds a complete Universal Document AST from an array of analyzed page layouts and vector states.
 * @param {Array<{ items: Array, pageWidth: number, pageHeight: number, vectorGeometry: object }>} pagesData
 * @param {object} metadata - Document metadata (title, author, etc.)
 * @returns {object} Universal Document AST
 */
export function buildDocumentAst(pagesData = [], metadata = {}) {
  const doc = createDocument(metadata);
  if (!pagesData || pagesData.length === 0) return doc;

  // Global pass: determine median body size for heading classification
  const allSizes = [];
  for (const p of pagesData) {
    if (p.items) {
      for (const it of p.items) {
        if (it.size > 0) allSizes.push(it.size);
      }
    }
  }
  allSizes.sort((a, b) => a - b);
  const bodySize = allSizes.length > 0 ? allSizes[Math.floor(allSizes.length / 2)] : 11;
  const h1Threshold = bodySize * 1.45;
  const h2Threshold = bodySize * 1.18;

  // Process each page into AST
  pagesData.forEach((pageData, idx) => {
    const { items = [], pageWidth = 595.28, pageHeight = 841.89, vectorGeometry = null } = pageData;
    const pageNode = createPage(idx + 1, { width: pageWidth, height: pageHeight });

    // Segment lines into reading order and identify tables/callouts
    const orderedLines = segmentIntoColumns(items, pageWidth);
    const initialBlocks = detectTableRegions(orderedLines, pageWidth, vectorGeometry);
    const blocks = mergeParagraphBlocks(initialBlocks);

    // Convert blocks to AST nodes
    for (const block of blocks) {
      if (block.type === 'table') {
        const tableNode = createTable({
          numCols: block.numCols,
          colWidths: block.colWidths,
          theme: block.theme,
        });

        for (const r of block.rows) {
          const rowNode = createTableRow({
            isHeader: r.isHeader,
            isMergedHeader: r.isMergedHeader,
          });

          for (const c of r.cells) {
            const numInfo = parseNumericCell(c.text);
            const cellNode = createTableCell({
              text: c.text,
              colSpan: c.columnSpan || 1,
              rowSpan: c.rowSpan || 1,
              align: c.align || (numInfo.isNumeric ? 'right' : 'left'),
              isHeader: c.isHeader,
              bold: c.bold,
              fontSize: c.fontSize || 10,
              isNumeric: numInfo.isNumeric,
              rawValue: numInfo.rawValue,
              formatCode: numInfo.formatCode,
            });
            rowNode.cells.push(cellNode);
          }
          tableNode.rows.push(rowNode);
        }
        pageNode.children.push(tableNode);
      } else if (block.type === 'callout') {
        const calloutNode = createCallout({
          calloutType: block.admonition?.type || 'info',
          title: block.admonition?.label || '',
        });

        for (const l of block.lines) {
          const pNode = createParagraph({
            lineSpacing: 1.1,
            bbox: { x: l.x, y: l.y, w: l.w, h: l.h },
          });
          pNode.runs.push(
            createTextRun({
              text: l.text,
              size: l.size,
              bold: l.isBold,
              italic: l.isItalic,
              font: l.fontName,
            })
          );
          calloutNode.children.push(pNode);
        }
        pageNode.children.push(calloutNode);
      } else if (block.type === 'code') {
        const codeNode = createCodeBlock({
          lines: block.lines.map((l) => l.text),
        });
        pageNode.children.push(codeNode);
      } else if (block.type === 'columns') {
        // Two-column editorial section
        const p1 = createParagraph({ isTwoColumn: true, columnIndex: 1 });
        p1.runs.push(createTextRun({ text: block.col1Lines.map((l) => l.text).join(' ') }));
        const p2 = createParagraph({ isTwoColumn: true, columnIndex: 2 });
        p2.runs.push(createTextRun({ text: block.col2Lines.map((l) => l.text).join(' ') }));
        pageNode.children.push(p1, p2);
      } else if (block.type === 'paragraph' && block.line) {
        const line = block.line;
        const headingLevel = line.size >= h1Threshold ? 1 : line.size >= h2Threshold ? 2 : null;
        const pNode = createParagraph({
          headingLevel,
          align: line.align || 'left',
          bbox: { x: line.x, y: line.y, w: line.w, h: line.h },
        });

        const spans = line.spans && line.spans.length > 0 ? line.spans : [
          { text: line.text, size: line.size, bold: line.isBold, italic: line.isItalic }
        ];

        for (const sp of spans) {
          pNode.runs.push(
            createTextRun({
              text: sp.text,
              size: sp.size || line.size,
              bold: sp.bold || false,
              italic: sp.italic || false,
              underline: sp.underline || false,
              strike: sp.strike || false,
              color: sp.color || null,
              superScript: sp.superScript || false,
              subScript: sp.subScript || false,
              isRTL: sp.isRTL || false,
              script: sp.script || 'latin',
            })
          );
        }
        pageNode.children.push(pNode);
      }
    }

    // Attach vector shapes if present (for PowerPoint emitter)
    if (vectorGeometry && vectorGeometry.rects) {
      for (const r of vectorGeometry.rects.slice(0, 10)) {
        if (r.fill || r.stroke) {
          pageNode.children.push(
            createShape({
              shapeType: 'rectangle',
              x: r.x,
              y: r.y,
              w: r.w,
              h: r.h,
              fill: r.fill,
              stroke: r.stroke,
              lineWidth: r.lineWidth,
            })
          );
        }
      }
    }

    doc.pages.push(pageNode);
  });

  return doc;
}
