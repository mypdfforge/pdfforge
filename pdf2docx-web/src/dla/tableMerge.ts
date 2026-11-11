import { Table, TableRow } from '../core/ast.js';

export function mergeCrossPageTables(tablesByPage: Table[][]): Table[] {
  const merged: Table[] = [];

  for (let pIdx = 0; pIdx < tablesByPage.length; pIdx++) {
    const pageTables = tablesByPage[pIdx];
    for (const t of pageTables) {
      if (merged.length > 0) {
        const prev = merged[merged.length - 1];
        if (canMergeTablesAcrossPages(prev, t)) {
          // Merge t into prev
          // Check for repeated header in t
          const rowsToAppend = isRepeatedHeader(prev.rows[0], t.rows[0])
            ? t.rows.slice(1)
            : t.rows;

          prev.rows.push(...rowsToAppend);
          continue;
        }
      }
      merged.push({ ...t });
    }
  }

  return merged;
}

export function canMergeTablesAcrossPages(prev: Table, next: Table): boolean {
  if (prev.colWidths.length !== next.colWidths.length) return false;

  // Check column widths similarity within 3pt
  for (let i = 0; i < prev.colWidths.length; i++) {
    if (Math.abs(prev.colWidths[i] - next.colWidths[i]) > 3.0) {
      return false;
    }
  }

  return true;
}

function isRepeatedHeader(rowA?: TableRow, rowB?: TableRow): boolean {
  if (!rowA || !rowB || rowA.cells.length !== rowB.cells.length) return false;

  const textA = rowA.cells.map(getCellText).join('|');
  const textB = rowB.cells.map(getCellText).join('|');

  return textA.length > 0 && textA === textB;
}

function getCellText(cell: any): string {
  if (!cell.blocks) return '';
  return cell.blocks
    .flatMap((b: any) => b.runs || [])
    .map((r: any) => r.text)
    .join('')
    .trim();
}
