import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import { Packer } from 'docx';
import {
  createDocument,
  createPage,
  createParagraph,
  createTextRun,
  createTable,
  createTableRow,
  createTableCell,
  createCallout,
} from '../../src/utils/documentAst.js';
import { buildDocxFromAst, renderParagraphNode, renderTableNode } from '../../src/utils/docxEmitter.js';
import { buildWorkbookFromAst } from '../../src/utils/xlsxEmitter.js';

describe('High-Accuracy DOCX & Multi-Sheet XLSX Emitters', () => {
  function createSampleAst() {
    const doc = createDocument({ title: 'Financial Audit Report' });
    const page = createPage(1);

    // Title paragraph
    const p1 = createParagraph({ headingLevel: 1 });
    p1.runs.push(createTextRun({ text: 'Consolidated Statements', bold: true, size: 16 }));
    page.children.push(p1);

    // Callout box
    const callout = createCallout({
      calloutType: 'info',
      title: 'Auditor Note',
      bg: 'EFF6FF',
      border: '3B82F6',
    });
    const cp = createParagraph();
    cp.runs.push(createTextRun({ text: 'Values are reported in thousands USD.', italic: true }));
    callout.children.push(cp);
    page.children.push(callout);

    // Multi-column data table
    const table = createTable({
      numCols: 3,
      colWidths: [33, 33, 34],
      theme: { headerBg: '1E293B', border: 'CBD5E1' },
    });

    const headerRow = createTableRow({ isHeader: true });
    headerRow.cells.push(
      createTableCell({ text: 'Category', isHeader: true }),
      createTableCell({ text: 'Q1 Balance', isHeader: true }),
      createTableCell({ text: 'Growth Rate', isHeader: true })
    );
    table.rows.push(headerRow);

    const dataRow = createTableRow();
    dataRow.cells.push(
      createTableCell({ text: 'Enterprise SaaS' }),
      createTableCell({ text: '$1,450,000.00', isNumeric: true, rawValue: 1450000, formatCode: '$#,##0.00' }),
      createTableCell({ text: '14.2%', isNumeric: true, rawValue: 0.142, formatCode: '0.0%' })
    );
    table.rows.push(dataRow);

    page.children.push(table);
    doc.pages.push(page);
    return doc;
  }

  it('renders DOCX elements correctly from AST and packs valid OOXML binary', async () => {
    const ast = createSampleAst();
    const docxDoc = buildDocxFromAst(ast);

    expect(docxDoc).toBeDefined();
    const buf = await Packer.toBuffer(docxDoc);
    expect(buf).toBeDefined();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });

  it('generates multi-sheet Excel workbook with typed numerical cells and formatting', async () => {
    const ast = createSampleAst();
    const wb = buildWorkbookFromAst(ast, ExcelJS);

    expect(wb).toBeDefined();
    expect(wb.worksheets.length).toBe(1);

    const ws = wb.worksheets[0];
    expect(ws.name).toBe('Table 1');

    // Header row verification
    const headerRow = ws.getRow(1);
    expect(headerRow.getCell(1).value).toBe('Category');
    expect(headerRow.getCell(1).font.bold).toBe(true);

    // Data row verification
    const dataRow = ws.getRow(2);
    expect(dataRow.getCell(1).value).toBe('Enterprise SaaS');

    // Typed numeric cell check: value MUST be number 1450000, NOT a string
    const numCell = dataRow.getCell(2);
    expect(typeof numCell.value).toBe('number');
    expect(numCell.value).toBe(1450000);
    expect(numCell.numFmt).toBe('$#,##0.00');

    // Percentage cell check
    const pctCell = dataRow.getCell(3);
    expect(typeof pctCell.value).toBe('number');
    expect(pctCell.value).toBe(0.142);
    expect(pctCell.numFmt).toBe('0.0%');

    // Test writing buffer
    const buf = await wb.xlsx.writeBuffer();
    expect(buf.byteLength).toBeGreaterThan(1000);
  });
});
