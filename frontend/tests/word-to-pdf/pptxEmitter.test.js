import { describe, it, expect } from 'vitest';
import PptxGenJS from 'pptxgenjs';
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
} from '../../src/utils/documentAst.js';
import { buildPptxFromAst } from '../../src/utils/pptxEmitter.js';
import { runChunkedConversion } from '../../src/utils/conversionWorkerClient.js';

describe('Editable PPTX Slide Emitter & Web Worker Pipeline', () => {
  function createSampleSlideAst() {
    const doc = createDocument({ title: 'Executive Keynote' });
    const page = createPage(1, { width: 720, height: 405 }); // 16:9 widescreen in pt

    // Heading
    const titleP = createParagraph({ headingLevel: 1 });
    titleP.runs.push(createTextRun({ text: 'Q4 Product Roadmap', bold: true, size: 24, color: '1E293B' }));
    page.children.push(titleP);

    // Callout box
    const callout = createCallout({
      calloutType: 'tip',
      title: 'Strategic Milestone',
      bg: 'F0FDF4',
      border: '047857',
    });
    const cp = createParagraph();
    cp.runs.push(createTextRun({ text: 'All milestones delivered ahead of schedule.' }));
    callout.children.push(cp);
    page.children.push(callout);

    // Slide Table
    const table = createTable({
      numCols: 2,
      colWidths: [50, 50],
      theme: { headerBg: '047857', border: '03543F' },
    });
    const headerRow = createTableRow({ isHeader: true });
    headerRow.cells.push(
      createTableCell({ text: 'Initiative', isHeader: true }),
      createTableCell({ text: 'Status', isHeader: true })
    );
    table.rows.push(headerRow);

    const dataRow = createTableRow();
    dataRow.cells.push(
      createTableCell({ text: 'WASM Vector Engine' }),
      createTableCell({ text: '100% Complete', bold: true })
    );
    table.rows.push(dataRow);

    page.children.push(table);

    // Code block
    const code = createCodeBlock({
      lines: ['const wasmEngine = await initEngine();', 'await wasmEngine.convert(pdfBlob);'],
    });
    page.children.push(code);

    // Vector Shape
    const shape = createShape({
      shapeType: 'rectangle',
      x: 54,
      y: 50,
      w: 200,
      h: 20,
      fill: '1E293B',
      stroke: '047857',
    });
    page.children.push(shape);

    doc.pages.push(page);
    return doc;
  }

  it('builds editable PPTX presentation from AST with slides and tables', async () => {
    const ast = createSampleSlideAst();
    const pptx = buildPptxFromAst(ast, PptxGenJS);

    expect(pptx).toBeDefined();
    expect(pptx.title).toBe('Executive Keynote');

    // Test serializing to buffer in Node/Vitest
    const buffer = await pptx.write({ outputType: 'nodebuffer' });
    expect(buffer).toBeDefined();
    expect(buffer.length).toBeGreaterThan(1000);
  });

  it('executes chunked page conversion with responsive progress updates', async () => {
    const mockPages = [1, 2, 3, 4];
    const progressLog = [];

    const results = await runChunkedConversion(
      mockPages,
      async (page, idx) => {
        return `Page ${page} Result`;
      },
      (p) => {
        progressLog.push(p);
      }
    );

    expect(results.length).toBe(4);
    expect(results[0]).toBe('Page 1 Result');
    expect(results[3]).toBe('Page 4 Result');

    // Verify progress callbacks
    expect(progressLog.length).toBeGreaterThanOrEqual(4);
    const lastProgress = progressLog[progressLog.length - 1];
    expect(lastProgress.done).toBe(4);
    expect(lastProgress.percent).toBe(100);
  });
});
