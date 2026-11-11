import { DocAST, Block, Para, Table, ImageBlock } from '../core/ast.js';
import { ValidationError } from '../core/errors.js';

export function validateDocAST(ast: DocAST): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!ast.sections || ast.sections.length === 0) {
    errors.push('DocAST must contain at least one section.');
  }

  for (let sIdx = 0; sIdx < (ast.sections || []).length; sIdx++) {
    const sect = ast.sections[sIdx];
    if (!sect.page || sect.page.w <= 0 || sect.page.h <= 0) {
      errors.push(`Section ${sIdx}: page dimensions must be strictly positive.`);
    }

    if (!sect.blocks || sect.blocks.length === 0) {
      errors.push(`Section ${sIdx}: section must contain at least one block.`);
    }

    for (let bIdx = 0; bIdx < (sect.blocks || []).length; bIdx++) {
      const block = sect.blocks[bIdx];
      validateBlock(block, `Section ${sIdx} Block ${bIdx}`, errors);
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}

function validateBlock(block: Block, path: string, errors: string[]) {
  if (block.type === 'p') {
    const para = block as Para;
    if (!Array.isArray(para.runs)) {
      errors.push(`${path}: Paragraph must have an array of runs.`);
    }
  } else if (block.type === 'tbl') {
    const tbl = block as Table;
    if (!tbl.rows || tbl.rows.length === 0) {
      errors.push(`${path}: Table must contain at least one row.`);
    }
    const numCols = tbl.colWidths?.length || 0;
    if (numCols === 0) {
      errors.push(`${path}: Table must have non-empty colWidths.`);
    }

    for (let rIdx = 0; rIdx < (tbl.rows || []).length; rIdx++) {
      const row = tbl.rows[rIdx];
      if (!row.cells || row.cells.length === 0) {
        errors.push(`${path} Row ${rIdx}: must contain at least one cell.`);
      }
      let spanSum = 0;
      for (let cIdx = 0; cIdx < (row.cells || []).length; cIdx++) {
        const cell = row.cells[cIdx];
        spanSum += cell.colSpan || 1;
        if (!cell.blocks || cell.blocks.length === 0) {
          errors.push(`${path} Row ${rIdx} Cell ${cIdx}: cell must contain at least one block (paragraph).`);
        }
      }
      if (numCols > 0 && spanSum !== numCols) {
        errors.push(
          `${path} Row ${rIdx}: total cell span sum (${spanSum}) does not match table colWidths count (${numCols}).`
        );
      }
    }
  } else if (block.type === 'img') {
    const img = block as ImageBlock;
    if (!img.ref) {
      errors.push(`${path}: Image must have a valid data reference.`);
    }
    if (img.w <= 0 || img.h <= 0) {
      errors.push(`${path}: Image width and height must be strictly positive.`);
    }
  }
}
