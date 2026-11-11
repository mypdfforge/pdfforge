import { describe, it, expect } from 'vitest';
import { emitDocxBuffer } from '../../src/emit/docxEmitter.js';
import { DocAST } from '../../src/core/ast.js';
import { postfixDocx } from '../../src/emit/postfix.js';
import { unzipSync } from 'fflate';

describe('Docx Emitter (§5 S10, S11)', () => {
  it('emits a valid docx zip buffer from DocAST', async () => {
    const ast: DocAST = {
      sections: [
        {
          page: { w: 612, h: 792, orient: 'portrait' },
          margins: { t: 72, r: 72, b: 72, l: 72 },
          blocks: [
            {
              type: 'p',
              align: 'left',
              runs: [{ text: 'Hello from pdf2docx-web!', bold: true, size: 14 }],
            },
          ],
        },
      ],
      numbering: [],
      styles: [],
      meta: { pages: 1, warnings: [] },
    };

    const buffer = await emitDocxBuffer(ast);
    expect(buffer).toBeInstanceOf(Uint8Array);
    expect(buffer.length).toBeGreaterThan(100);

    const postfixed = postfixDocx(buffer);
    const unzipped = unzipSync(postfixed);

    expect(unzipped['[Content_Types].xml']).toBeDefined();
    expect(unzipped['word/document.xml']).toBeDefined();

    const docXml = new TextDecoder().decode(unzipped['word/document.xml']);
    expect(docXml).toContain('Hello from pdf2docx-web!');
  });
});
