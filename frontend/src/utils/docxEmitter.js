/**
 * docxEmitter.js — High-Accuracy Word (.docx) Emitter
 * Transforms a Universal Document AST into an authentic, flowing OpenXML (.docx) document
 * with native paragraphs, tables, callouts, and vector shading.
 */

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  AlignmentType,
  ShadingType,
  PageOrientation,
} from 'docx';
import { NodeType } from './documentAst.js';
import { wrapUnbrokenStrings } from './pdfLayoutSegmenter.js';

function mapAlign(align) {
  if (align === 'center') return AlignmentType.CENTER;
  if (align === 'right') return AlignmentType.RIGHT;
  if (align === 'justify') return AlignmentType.JUSTIFIED;
  return AlignmentType.LEFT;
}

function mapHeading(level) {
  if (level === 1) return 'Heading1';
  if (level === 2) return 'Heading2';
  if (level === 3) return 'Heading3';
  return undefined;
}

/**
 * Converts a ParagraphNode into a docx.Paragraph
 */
export function renderParagraphNode(pNode) {
  const children = [];

  for (const r of pNode.runs) {
    const text = wrapUnbrokenStrings(r.text);
    if (!text) continue;

    const fontName =
      r.script === 'devanagari'
        ? 'Nirmala UI'
        : r.script === 'cjk'
        ? 'Microsoft YaHei'
        : r.script === 'arabic'
        ? 'Traditional Arabic'
        : r.font || undefined;

    children.push(
      new TextRun({
        text,
        bold: r.bold || Boolean(pNode.headingLevel),
        italics: r.italic,
        underline: r.underline ? {} : undefined,
        strike: r.strike,
        color: r.color ? r.color.replace('#', '') : pNode.headingLevel ? '1E293B' : undefined,
        superScript: r.superScript,
        subScript: r.subScript,
        font: fontName ? { name: fontName } : undefined,
        rightToLeft: r.isRTL,
        size: Math.round((r.size || 11) * 2), // docx uses half-points
      })
    );
  }

  if (children.length === 0) {
    children.push(new TextRun({ text: '' }));
  }

  return new Paragraph({
    heading: mapHeading(pNode.headingLevel),
    alignment: mapAlign(pNode.align),
    children,
    spacing: {
      before: pNode.headingLevel ? 160 : undefined,
      after: pNode.headingLevel ? 120 : pNode.listLevel !== null ? 40 : 80,
      line: Math.round((pNode.lineSpacing || 1.15) * 240),
    },
  });
}

/**
 * Converts a TableNode into a docx.Table
 */
export function renderTableNode(tNode) {
  const tableRows = [];
  const theme = tNode.theme || {};
  const headerBg = theme.headerBg || '1D283B';
  const borderColor = theme.border || 'CBD5E1';

  for (let rIdx = 0; rIdx < tNode.rows.length; rIdx++) {
    const r = tNode.rows[rIdx];
    const cells = [];

    for (let cIdx = 0; cIdx < r.cells.length; cIdx++) {
      const c = r.cells[cIdx];
      const isHeader = r.isHeader || c.isHeader;
      const cellBg = isHeader ? headerBg : c.bg || (rIdx % 2 === 0 ? 'FFFFFF' : theme.zebraBg || 'FFFFFF');

      const cellTextRun = new TextRun({
        text: c.text,
        bold: isHeader || c.bold,
        color: isHeader ? 'FFFFFF' : undefined,
        size: Math.round((c.fontSize || 10) * 2),
      });

      const cellParagraph = new Paragraph({
        alignment: mapAlign(c.align),
        children: [cellTextRun],
      });

      const borders = {
        top: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        bottom: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        left: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
        right: { style: BorderStyle.SINGLE, size: 4, color: borderColor },
      };

      const tableCellOpts = {
        children: [cellParagraph],
        columnSpan: c.colSpan > 1 ? c.colSpan : undefined,
        rowSpan: c.rowSpan > 1 ? c.rowSpan : undefined,
        shading: cellBg ? { type: ShadingType.CLEAR, fill: cellBg } : undefined,
        borders,
        margins: { top: 80, bottom: 80, left: 100, right: 100 },
      };

      if (tNode.colWidths && tNode.colWidths[cIdx]) {
        tableCellOpts.width = {
          size: Math.round(tNode.colWidths[cIdx] * 50),
          type: WidthType.DXA,
        };
      }

      cells.push(new TableCell(tableCellOpts));
    }

    tableRows.push(
      new TableRow({
        children: cells,
        tableHeader: r.isHeader,
      })
    );
  }

  return new Table({
    rows: tableRows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: {
      top: { style: BorderStyle.SINGLE, size: 6, color: borderColor },
      bottom: { style: BorderStyle.SINGLE, size: 6, color: borderColor },
      left: { style: BorderStyle.NONE },
      right: { style: BorderStyle.NONE },
    },
  });
}

/**
 * Converts a CalloutNode into a native highlighted Paragraph
 */
export function renderCalloutNode(calloutNode) {
  const children = [];
  for (const child of calloutNode.children) {
    if (child.type === NodeType.PARAGRAPH) {
      for (const r of child.runs) {
        children.push(
          new TextRun({
            text: r.text,
            bold: r.bold,
            italics: r.italic,
            font: r.font ? { name: r.font } : undefined,
            size: Math.round((r.size || 10.5) * 2),
          })
        );
      }
    }
  }

  return new Paragraph({
    children,
    spacing: { before: 80, after: 80, line: 260 },
    border: {
      left: { style: BorderStyle.SINGLE, size: 24, color: calloutNode.border || '3B82F6', space: 10 },
    },
    shading: {
      type: ShadingType.CLEAR,
      fill: calloutNode.bg || 'F8FAFC',
    },
  });
}

/**
 * Converts an entire Universal Document AST into a Word (.docx) Document object.
 */
export function buildDocxFromAst(ast) {
  const sections = [];

  for (const page of ast.pages) {
    const pageChildren = [];

    for (const child of page.children) {
      if (child.type === NodeType.PARAGRAPH) {
        pageChildren.push(renderParagraphNode(child));
      } else if (child.type === NodeType.TABLE) {
        pageChildren.push(renderTableNode(child));
        pageChildren.push(new Paragraph({ spacing: { after: 100 } })); // spacer
      } else if (child.type === NodeType.CALLOUT) {
        pageChildren.push(renderCalloutNode(child));
      } else if (child.type === NodeType.CODE_BLOCK) {
        const textRuns = child.lines.map((l, idx) => new TextRun({ text: (idx > 0 ? '\n' : '') + l, font: { name: 'Consolas' }, size: 20 }));
        pageChildren.push(
          new Paragraph({
            children: textRuns,
            shading: { type: ShadingType.CLEAR, fill: child.bg || 'F1F5F9' },
            spacing: { before: 60, after: 60 },
          })
        );
      }
    }

    if (pageChildren.length === 0) {
      pageChildren.push(new Paragraph({}));
    }

    const pWidth = page.width || 612;
    const pHeight = page.height || 792;
    const isLandscape = pWidth > pHeight;

    sections.push({
      properties: {
        page: {
          size: {
            width: Math.round(pWidth * 20),
            height: Math.round(pHeight * 20),
            orientation: isLandscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT,
          },
          margin: {
            top: 720,
            bottom: 720,
            left: 720,
            right: 720,
          },
        },
      },
      children: pageChildren,
    });
  }

  return new Document({ sections });
}

/**
 * Generates a .docx binary Blob from a Universal Document AST.
 */
export async function exportAstToDocx(ast) {
  const doc = buildDocxFromAst(ast);
  return await Packer.toBlob(doc);
}
