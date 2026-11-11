import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { loadPdfDocument } from '../../src/ingest/pdfLoader.js';
import { convertDocumentIRToDocx } from '../../src/dla/pipeline.js';
import { validateDocxFile } from '../../tools/docx-validate.js';
import { computeCER } from '../../tools/compare-text.js';

describe('Milestone M1 Exit Gate: Tier A (Simple Letters / Memos)', () => {
  it('converts Tier A sample PDF to a fully compliant DOCX with 0 errors', async () => {
    const samplePath = path.resolve('corpus/tierA/letter_sample.pdf');
    expect(fs.existsSync(samplePath)).toBe(true);

    const buffer = fs.readFileSync(samplePath);
    const docIr = await loadPdfDocument(buffer);

    expect(docIr.pages.length).toBe(1);
    expect(docIr.pages[0].stats.glyphCount).toBeGreaterThan(100);

    const { docx, ast, report } = await convertDocumentIRToDocx(docIr);

    // Gate requirement 1: DOCX output is non-empty
    expect(docx.length).toBeGreaterThan(1000);

    // Gate requirement 2: 0 validator failures (100% compliant OpenXML, no repair prompts)
    const validation = validateDocxFile(docx);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    // Gate requirement 3: Page dimensions & orientation exact
    expect(ast.sections[0].page.w).toBeCloseTo(docIr.pages[0].width, 1);
    expect(ast.sections[0].page.h).toBeCloseTo(docIr.pages[0].height, 1);

    // Gate requirement 4: No floating textboxes
    const docXmlStr = new TextDecoder().decode(docx);
    expect(docXmlStr.includes('w:txbxContent')).toBe(false);

    // Save test output artifact
    fs.writeFileSync('corpus/tierA/letter_sample.converted.docx', docx);
  });
});
