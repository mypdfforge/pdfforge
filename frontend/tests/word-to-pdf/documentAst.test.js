import { describe, it, expect } from 'vitest';
import {
  NodeType,
  createDocument,
  createPage,
  createParagraph,
  createTextRun,
  createTable,
  createTableRow,
  createTableCell,
  walkAst,
  extractTablesFromAst,
  serializeAst,
} from '../../src/utils/documentAst.js';
import { parseNumericCell, buildDocumentAst } from '../../src/utils/documentLayoutAnalysis.js';

describe('Universal Document AST & DLA Engine', () => {
  it('creates a validated DocumentRoot and Page hierarchy', () => {
    const doc = createDocument({ title: 'Quarterly Report', author: 'CFO' });
    const page = createPage(1, { width: 612, height: 792 }); // US Letter
    const p = createParagraph({ headingLevel: 1, align: 'center' });
    p.runs.push(createTextRun({ text: 'Consolidated Balance Sheet', bold: true, size: 18 }));

    page.children.push(p);
    doc.pages.push(page);

    expect(doc.type).toBe(NodeType.DOCUMENT);
    expect(doc.title).toBe('Quarterly Report');
    expect(doc.pages.length).toBe(1);
    expect(page.orientation).toBe('portrait');
    expect(p.headingLevel).toBe(1);
    expect(p.runs[0].text).toBe('Consolidated Balance Sheet');
    expect(p.runs[0].bold).toBe(true);
  });

  it('correctly parses numerical and accounting cell values for spreadsheet emission', () => {
    const r1 = parseNumericCell('$1,250,000.50');
    expect(r1.isNumeric).toBe(true);
    expect(r1.rawValue).toBe(1250000.5);
    expect(r1.formatCode).toBe('$#,##0.00');

    const r2 = parseNumericCell('(450,200)');
    expect(r2.isNumeric).toBe(true);
    expect(r2.rawValue).toBe(-450200);

    const r3 = parseNumericCell('18.75%');
    expect(r3.isNumeric).toBe(true);
    expect(r3.rawValue).toBe(0.1875);
    expect(r3.formatCode).toBe('0.0%');

    const r4 = parseNumericCell('Non-numeric header cell');
    expect(r4.isNumeric).toBe(false);
    expect(r4.rawValue).toBeNull();
  });

  it('builds full AST with tables, callouts, and paragraphs from raw page data', () => {
    const mockPageData = [
      {
        pageWidth: 595.28,
        pageHeight: 841.89,
        items: [
          { str: 'Section 01: Executive Summary', x: 54, y: 750, w: 200, h: 20, size: 16, isBold: true },
          { str: 'This document presents the financial outlook.', x: 54, y: 720, w: 250, h: 12, size: 10, isBold: false },
          // Table Row 1 (Header)
          { str: 'Asset Category', x: 54, y: 650, w: 100, h: 12, size: 10, isBold: true },
          { str: 'Q1 Balance', x: 200, y: 650, w: 80, h: 12, size: 10, isBold: true },
          // Table Row 2 (Data)
          { str: 'Cash Equivalents', x: 54, y: 630, w: 100, h: 12, size: 10, isBold: false },
          { str: '$5,400,000', x: 200, y: 630, w: 80, h: 12, size: 10, isBold: false },
        ],
        vectorGeometry: {
          rects: [{ x: 54, y: 650, w: 400, h: 20, fill: '1E293B', stroke: null }],
          lines: [],
        },
      },
    ];

    const ast = buildDocumentAst(mockPageData, { title: 'Test AST' });

    expect(ast.type).toBe(NodeType.DOCUMENT);
    expect(ast.pages.length).toBe(1);
    const page = ast.pages[0];

    // Find table in children
    const tables = extractTablesFromAst(ast);
    expect(tables.length).toBe(1);
    const table = tables[0];
    expect(table.numCols).toBe(2);

    // Verify cell numeric typing
    const dataRow = table.rows.find((r) => !r.isHeader);
    expect(dataRow).toBeDefined();
    const cashCell = dataRow.cells.find((c) => c.text === '$5,400,000');
    expect(cashCell).toBeDefined();
    expect(cashCell.isNumeric).toBe(true);
    expect(cashCell.rawValue).toBe(5400000);
  });

  it('supports visitor traversal and JSON serialization', () => {
    const doc = createDocument({ title: 'Visitor Test' });
    const page = createPage(1);
    const table = createTable({ numCols: 2 });
    const row = createTableRow({ isHeader: true });
    row.cells.push(createTableCell({ text: 'Col A' }), createTableCell({ text: 'Col B' }));
    table.rows.push(row);
    page.children.push(table);
    doc.pages.push(page);

    let cellCount = 0;
    walkAst(doc, {
      [NodeType.TABLE_CELL]: () => cellCount++,
    });
    expect(cellCount).toBe(2);

    const json = serializeAst(doc);
    expect(json.type).toBe(NodeType.DOCUMENT);
    expect(json.pages[0].children[0].rows[0].cells[0].text).toBe('Col A');
  });
});
