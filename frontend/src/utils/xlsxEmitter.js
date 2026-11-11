/**
 * xlsxEmitter.js — Multi-Sheet Accounting Excel (.xlsx) Emitter
 * Transforms a Universal Document AST into a styled, formula-ready Excel workbook
 * with typed numeric values, accounting formats, and authentic vector themes.
 */

import { NodeType, extractTablesFromAst } from './documentAst.js';

/**
 * Builds an ExcelJS Workbook from a Universal Document AST.
 * @param {object} ast - Universal Document AST
 * @param {object} ExcelJS - ExcelJS module
 * @param {object} options - Generation options (e.g. singleSheet: boolean)
 * @returns {object} ExcelJS.Workbook
 */
export function buildWorkbookFromAst(ast, ExcelJS, options = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = ast.creator || 'PDFForge Universal WASM Engine';
  wb.created = new Date();

  const tables = extractTablesFromAst(ast);

  if (tables.length === 0) {
    // If no tables, create a single sheet with document text
    const ws = wb.addWorksheet('Document Text', { views: [{ showGridLines: true }] });
    let rowIdx = 1;
    for (const page of ast.pages) {
      for (const child of page.children) {
        if (child.type === NodeType.PARAGRAPH) {
          const text = child.runs.map((r) => r.text).join(' ');
          if (text.trim()) {
            ws.getCell(`A${rowIdx++}`).value = text;
          }
        }
      }
    }
    return wb;
  }

  // Generate a worksheet per table or grouped
  tables.forEach((table, tIdx) => {
    const sheetName = `Table ${tIdx + 1}`.slice(0, 31);
    const ws = wb.addWorksheet(sheetName, { views: [{ showGridLines: true }] });

    const theme = table.theme || {};
    const headerBg = theme.headerBg ? 'FF' + theme.headerBg.replace('#', '') : 'FF1E293B';
    const borderColor = theme.border ? 'FF' + theme.border.replace('#', '') : 'FFCBD5E1';

    let curRow = 1;

    for (let rIdx = 0; rIdx < table.rows.length; rIdx++) {
      const row = table.rows[rIdx];
      const excelRow = ws.getRow(curRow);
      let curCol = 1;

      for (let cIdx = 0; cIdx < row.cells.length; cIdx++) {
        const cell = row.cells[cIdx];
        const excelCell = excelRow.getCell(curCol);

        // Assign numeric or string value
        if (cell.isNumeric && typeof cell.rawValue === 'number') {
          excelCell.value = cell.rawValue;
          if (cell.formatCode) {
            excelCell.numFmt = cell.formatCode;
          }
        } else {
          excelCell.value = cell.text;
        }

        // Alignments
        excelCell.alignment = {
          vertical: 'middle',
          horizontal: cell.align || (cell.isNumeric ? 'right' : 'left'),
          wrapText: true,
        };

        // Styling
        if (row.isHeader || cell.isHeader) {
          excelCell.font = {
            name: 'Calibri',
            size: 11,
            bold: true,
            color: { argb: 'FFFFFFFF' },
          };
          excelCell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: headerBg },
          };
        } else {
          excelCell.font = {
            name: 'Calibri',
            size: 10,
            bold: cell.bold || false,
          };
          if (cell.bg) {
            excelCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF' + cell.bg.replace('#', '') },
            };
          } else if (rIdx % 2 === 1 && theme.zebraBg) {
            excelCell.fill = {
              type: 'pattern',
              pattern: 'solid',
              fgColor: { argb: 'FF' + theme.zebraBg.replace('#', '') },
            };
          }
        }

        // Borders
        excelCell.border = {
          top: { style: 'thin', color: { argb: borderColor } },
          bottom: { style: 'thin', color: { argb: borderColor } },
          left: { style: 'thin', color: { argb: borderColor } },
          right: { style: 'thin', color: { argb: borderColor } },
        };

        // Handle colSpan merges
        if (cell.colSpan > 1) {
          ws.mergeCells(curRow, curCol, curRow, curCol + cell.colSpan - 1);
          curCol += cell.colSpan;
        } else {
          curCol++;
        }
      }

      excelRow.height = row.isHeader ? 26 : 20;
      curRow++;
    }

    // Auto-fit column widths
    ws.columns.forEach((col) => {
      let maxLen = 12;
      col.eachCell?.({ includeEmpty: false }, (c) => {
        const valStr = c.value ? String(c.value) : '';
        maxLen = Math.max(maxLen, Math.min(valStr.length + 3, 50));
      });
      col.width = maxLen;
    });
  });

  return wb;
}

/**
 * Generates an Excel (.xlsx) Blob from a Universal Document AST.
 */
export async function exportAstToXlsx(ast, options = {}) {
  const exceljsMod = await import('exceljs');
  const ExcelJS = exceljsMod.default || exceljsMod;
  const wb = buildWorkbookFromAst(ast, ExcelJS, options);
  const buffer = await wb.xlsx.writeBuffer();
  return new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
}
