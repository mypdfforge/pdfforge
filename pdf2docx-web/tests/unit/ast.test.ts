import { describe, it, expect } from 'vitest';
import { buildDocAST } from '../../src/ast/build.js';
import { validateDocAST } from '../../src/ast/validate.js';
import { normalizeDocAST } from '../../src/ast/normalize.js';
import { DocAST } from '../../src/core/ast.js';

describe('AST: validate, normalize, build', () => {
  it('detects invalid table dimensions and missing blocks', () => {
    const invalidAst: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            {
              type: 'tbl',
              colWidths: [100, 100],
              rows: [
                {
                  cells: [
                    {
                      blocks: [], // Empty cell block!
                      colSpan: 1,
                      rowSpan: 1,
                      width: 100,
                    },
                  ], // Only 1 cell with span 1, but colWidths has 2 columns!
                },
              ],
            },
          ],
        },
      ],
      numbering: [],
      styles: [],
      meta: { pages: 1, warnings: [] },
    };

    const res = validateDocAST(invalidAst);
    expect(res.valid).toBe(false);
    expect(res.errors.length).toBeGreaterThanOrEqual(2);
  });

  it('normalizes adjacent runs with identical styling', () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            {
              type: 'p',
              align: 'left',
              runs: [
                { text: 'Hello ', bold: true, size: 12 },
                { text: 'World!', bold: true, size: 12 },
                { text: ' Different', bold: false, size: 12 },
              ],
            },
          ],
        },
      ],
      numbering: [],
      styles: [],
      meta: { pages: 1, warnings: [] },
    };

    const normalized = normalizeDocAST(ast);
    const runs = (normalized.sections[0].blocks[0] as any).runs;
    expect(runs.length).toBe(2);
    expect(runs[0].text).toBe('Hello World!');
    expect(runs[0].bold).toBe(true);
    expect(runs[1].text).toBe(' Different');
  });
});
