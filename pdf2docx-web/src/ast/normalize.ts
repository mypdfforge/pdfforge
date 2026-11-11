import { DocAST, Block, Para, Run, Table } from '../core/ast.js';
import { sanitizeXmlString } from '../emit/xmlSafe.js';

export function normalizeDocAST(ast: DocAST): DocAST {
  const normalizedSections = ast.sections.map((sect) => {
    const normalizedBlocks = sect.blocks
      .map(normalizeBlock)
      .filter((b): b is Block => b !== null);

    return {
      ...sect,
      blocks: normalizedBlocks.length > 0 ? normalizedBlocks : [createEmptyPara()],
    };
  });

  return {
    ...ast,
    sections: normalizedSections,
  };
}

function createEmptyPara(): Para {
  return {
    type: 'p',
    runs: [{ text: '' }],
    align: 'left',
  };
}

function normalizeBlock(block: Block): Block | null {
  if (block.type === 'p') {
    return normalizePara(block as Para);
  } else if (block.type === 'tbl') {
    return normalizeTable(block as Table);
  }
  return block;
}

function normalizePara(para: Para): Para | null {
  const runs: Run[] = [];
  for (const rawRun of para.runs) {
    const text = sanitizeXmlString(rawRun.text);
    if (!text && !rawRun.link) continue;

    const run: Run = { ...rawRun, text };
    if (runs.length > 0) {
      const prev = runs[runs.length - 1];
      if (canMergeRuns(prev, run)) {
        prev.text += run.text;
        continue;
      }
    }
    runs.push(run);
  }

  return {
    ...para,
    runs: runs.length > 0 ? runs : [{ text: '' }],
  };
}

function canMergeRuns(a: Run, b: Run): boolean {
  return (
    Boolean(a.bold) === Boolean(b.bold) &&
    Boolean(a.italic) === Boolean(b.italic) &&
    Boolean(a.underline) === Boolean(b.underline) &&
    Boolean(a.strike) === Boolean(b.strike) &&
    Boolean(a.sup) === Boolean(b.sup) &&
    Boolean(a.sub) === Boolean(b.sub) &&
    a.color === b.color &&
    a.font === b.font &&
    Math.abs((a.size || 11) - (b.size || 11)) < 0.2 &&
    a.link?.url === b.link?.url
  );
}

function normalizeTable(tbl: Table): Table {
  const normalizedRows = tbl.rows.map((row) => ({
    ...row,
    cells: row.cells.map((cell) => {
      const blocks = cell.blocks
        .map(normalizeBlock)
        .filter((b): b is Block => b !== null);
      return {
        ...cell,
        blocks: blocks.length > 0 ? blocks : [createEmptyPara()],
      };
    }),
  }));

  return {
    ...tbl,
    rows: normalizedRows,
  };
}
