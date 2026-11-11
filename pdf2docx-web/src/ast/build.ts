import { DocAST, Section, Block, SectionProps } from '../core/ast.js';
import { PageIR } from '../core/pageir.js';
import { normalizeDocAST } from './normalize.js';
import { validateDocAST } from './validate.js';
import { ptToInches } from '../core/units.js';

export type BuildOptions = {
  mode?: 'flow' | 'faithful';
  defaultMargins?: { t: number; r: number; b: number; l: number };
  headers?: Block[];
  footers?: Block[];
};

export function buildDocAST(
  pages: { ir: PageIR; blocks: Block[] }[],
  options: BuildOptions = {}
): DocAST {
  const mode = options.mode || 'flow';
  const defaultMargins = options.defaultMargins || { t: 72, r: 72, b: 72, l: 72 }; // 1 inch default

  const sections: Section[] = [];
  let currentSect: Section | null = null;

  for (let i = 0; i < pages.length; i++) {
    const { ir, blocks } = pages[i];
    const isLandscape = ir.width > ir.height;
    const sectProps: SectionProps = {
      page: {
        w: ir.width,
        h: ir.height,
        orient: isLandscape ? 'landscape' : 'portrait',
      },
      margins: { ...defaultMargins },
    };

    // Group consecutive pages with identical dimensions into the same section
    if (
      !currentSect ||
      currentSect.page.w !== sectProps.page.w ||
      currentSect.page.h !== sectProps.page.h ||
      currentSect.page.orient !== sectProps.page.orient
    ) {
      currentSect = {
        ...sectProps,
        header: options.headers,
        footer: options.footers,
        blocks: [],
      };
      sections.push(currentSect);
    } else if (mode === 'faithful' && i > 0) {
      // In faithful mode, add a page break between pages
      currentSect.blocks.push({ type: 'pagebreak' });
    }

    currentSect.blocks.push(...blocks);
  }

  const rawAst: DocAST = {
    sections: sections.length > 0 ? sections : [
      {
        page: { w: 612, h: 792, orient: 'portrait' },
        margins: defaultMargins,
        blocks: [{ type: 'p', runs: [{ text: '' }], align: 'left' }],
      },
    ],
    numbering: [],
    styles: [],
    meta: {
      pages: pages.length,
      warnings: [],
    },
  };

  const normalized = normalizeDocAST(rawAst);
  const validation = validateDocAST(normalized);
  if (!validation.valid) {
    normalized.meta.warnings.push(
      ...validation.errors.map((err) => ({
        stage: 'AST Validation',
        message: err,
      }))
    );
  }

  return normalized;
}
